import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { sha256 } from '@noble/hashes/sha2'

type Network = 'solana' | 'megaeth'
type Profile = { displayName: string; changedAt: number; createdAt?: number; avatarUrl?: string; discordId?: string; referralCode?: string }
type LeaderboardRecord = { score: number; playedAt: number; won: boolean; transaction: string; network: Network; walletAddress?: string }

const LEADERBOARD_KEY = 'testnet-games:leaderboard:v1'
const GAME_HISTORY_KEY = 'testnet-games:game-history:v1'
const VERIFIED_WALLETS_KEY = 'testnet-games:verified-wallets:v1'
const MODERATORS_KEY = 'testnet-games:moderators:v1'
const STREAMERS_KEY = 'testnet-games:streamers:v1'
const KICK_CHANNELS_KEY = 'testnet-games:kick-channels:v1'
const notificationKey = (network: Network, wallet: string) => `testnet-games:notifications:${network}:${normalizedWallet(network, wallet)}`
const USERNAME_OWNER_PREFIX = 'testnet-games:username-owner:v1:'
const MICROSOL = 1_000_000
const warningKey = (network: Network, wallet: string) => `testnet-games:moderation-warnings:${network}:${normalizedWallet(network, wallet)}`

// Keep this policy at the profile boundary so every consumer (profiles, chat,
// and future tag UIs) receives a safe, consistently ordered tag list.
function allowedPlayerTags(requestedTags: string[]) {
  const unique = [...new Set(requestedTags.filter(tag => /^[a-z0-9_-]{1,24}$/i.test(tag)))]
  const otherTags = unique.filter(tag => tag !== 'verified')
  // Verified is the only tag permitted beside another tag. Everyone else gets
  // one role tag at most, even when more role sets are added in the future.
  return unique.includes('verified') ? ['verified', ...otherTags.slice(0, 1)] : otherTags.slice(0, 1)
}

function requiredSolForLevel(level: number) {
  if (level <= 1) return 0
  if (level > 30) return 450 * 1.06 ** (level - 30)
  const n = level - 1
  const x = n - 1
  return 0.1 * n ** 2 * Math.exp(0.0342 * x + 0.000917 * x ** 2)
}
function levelFromWager(wagerSol: number) {
  for (let level = 2; level <= 100; level += 1) if (wagerSol < requiredSolForLevel(level)) return level - 1
  return 100
}

const COOLDOWN_MS = 10 * 60_000
const MIN_SOL_LAMPORTS = Math.floor(0.1 * LAMPORTS_PER_SOL)
const MIN_MEGAETH_WEI = 100_000_000_000_000_000n
const MEGAETH_RPC_URL = 'https://carrot.megaeth.com/rpc'
const encoder = new TextEncoder()

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Worldwide profiles are not configured.')
  return new Redis({ url, token })
}

function normalizedWallet(network: Network, wallet: string) {
  if (network === 'solana') return new PublicKey(wallet).toBase58()
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid MegaETH wallet address.')
  return wallet.toLowerCase()
}

export function profileKey(network: Network, wallet: string) {
  return `testnet-games:profile:${network}:${normalizedWallet(network, wallet)}`
}

function playerStatsKey(network: Network, wallet: string) {
  return `testnet-games:player-stats:${network}:${normalizedWallet(network, wallet)}`
}

const normalizedUsername = (displayName: string) => displayName.normalize('NFKC').toLowerCase()
const usernameOwnerKey = (displayName: string) => `${USERNAME_OWNER_PREFIX}${encodeURIComponent(normalizedUsername(displayName))}`

async function claimUniqueUsername(redis: Redis, displayName: string, owner: string) {
  const wanted = normalizedUsername(displayName)
  let cursor = '0'
  do {
    const [nextCursor, scanned] = await redis.scan(cursor, { match: 'testnet-games:profile:*', count: 200 })
    cursor = nextCursor
    const profileKeys = scanned.filter(key => key.split(':').length === 4)
    if (!profileKeys.length) continue
    const profiles = await redis.mget<(Profile | null)[]>(...profileKeys)
    for (let index = 0; index < profileKeys.length; index += 1) {
      const existing = profiles[index]
      if (!existing?.displayName || normalizedUsername(existing.displayName) !== wanted) continue
      const [, , existingNetwork, existingWallet] = profileKeys[index].split(':')
      const existingOwner = `${existingNetwork}:${existingNetwork === 'megaeth' ? existingWallet.toLowerCase() : existingWallet}`
      if (existingOwner !== owner) throw new Error('That username is already taken.')
    }
  } while (cursor !== '0')

  const key = usernameOwnerKey(displayName)
  const existingOwner = await redis.get<string>(key)
  if (existingOwner && existingOwner !== owner) throw new Error('That username is already taken.')
  if (existingOwner === owner) return false
  const claimed = await redis.set(key, owner, { nx: true })
  if (claimed !== 'OK') {
    const winner = await redis.get<string>(key)
    if (winner !== owner) throw new Error('That username is already taken.')
    return false
  }
  return true
}

export function nameChangeMessage(network: Network, wallet: string, displayName: string, timestamp: number, referralCode = '') {
  return `Testnet Games name change\nNetwork: ${network}\nWallet: ${normalizedWallet(network, wallet)}\nName: ${displayName}${referralCode ? `\nReferral: ${referralCode}` : ''}\nTimestamp: ${timestamp}`
}

function avatarChangeMessage(network: Network, wallet: string, avatar: string, timestamp: number) {
  const hash = Array.from(sha256(encoder.encode(avatar)), byte => byte.toString(16).padStart(2, '0')).join('')
  return `Testnet Games avatar change\nNetwork: ${network}\nWallet: ${normalizedWallet(network, wallet)}\nAvatar SHA-256: ${hash}\nTimestamp: ${timestamp}`
}

function joinedReferralMessage(network: Network, wallet: string, referralCode: string, timestamp: number) {
  return `Testnet Games joined referral\nNetwork: ${network}\nWallet: ${normalizedWallet(network, wallet)}\nReferral: ${referralCode}\nTimestamp: ${timestamp}`
}

export function kickChannelChangeMessage(network: Network, wallet: string, kickSlug: string, timestamp: number) {
  return `Testnet Games Kick channel change\nNetwork: ${network}\nWallet: ${normalizedWallet(network, wallet)}\nKick channel: ${kickSlug || 'none'}\nTimestamp: ${timestamp}`
}

function verifySignature(network: Network, wallet: string, message: string, signature: string) {
  if (network === 'solana') {
    if (!ed25519.verify(bs58.decode(signature), encoder.encode(message), new PublicKey(wallet).toBytes())) {
      throw new Error('Wallet signature is invalid.')
    }
    return
  }
  const bytes = signature.startsWith('0x') ? signature.slice(2) : signature
  if (!/^[a-fA-F0-9]{130}$/.test(bytes)) throw new Error('Wallet signature is invalid.')
  const raw = Uint8Array.from(bytes.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16)))
  const messageBytes = encoder.encode(message)
  const prefix = encoder.encode(`\x19Ethereum Signed Message:\n${messageBytes.length}`)
  const payload = new Uint8Array(prefix.length + messageBytes.length)
  payload.set(prefix); payload.set(messageBytes, prefix.length)
  const hash = keccak_256(payload)
  const recovery = raw[64] >= 27 ? raw[64] - 27 : raw[64]
  const publicKey = secp256k1.Signature.fromCompact(raw.slice(0, 64)).addRecoveryBit(recovery).recoverPublicKey(hash).toRawBytes(false)
  const recovered = `0x${Array.from(keccak_256(publicKey.slice(1)).slice(-20), byte => byte.toString(16).padStart(2, '0')).join('')}`
  if (recovered !== wallet.toLowerCase()) throw new Error('Wallet signature is invalid.')
}

async function verifyBalance(network: Network, wallet: string) {
  if (network === 'solana') {
    const endpoints = [...new Set([process.env.SOLANA_RPC_URL?.trim(), 'https://api.devnet.solana.com'].filter(Boolean) as string[])]
    let balance: number | null = null
    for (const endpoint of endpoints) {
      try { balance = await new Connection(endpoint, 'confirmed').getBalance(new PublicKey(wallet)); break } catch { /* Try fallback. */ }
    }
    if (balance === null) throw new Error('Could not verify the Solana balance.')
    if (balance <= MIN_SOL_LAMPORTS) throw new Error('More than 0.1 devnet SOL is required to change your name.')
    return
  }
  const rpc = await fetch(MEGAETH_RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet, 'latest'] }) })
  const body = await rpc.json() as { result?: string }
  if (!body.result) throw new Error('Could not verify the MegaETH balance.')
  if (BigInt(body.result) <= MIN_MEGAETH_WEI) throw new Error('More than 0.1 MegaETH testnet ETH is required to change your name.')
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const network = request.method === 'GET' ? request.query.network : request.body?.network
    const wallet = request.method === 'GET' ? request.query.wallet : request.body?.wallet
    if ((network !== 'solana' && network !== 'megaeth') || typeof wallet !== 'string') throw new Error('Wallet and network are required.')
    const redis = redisClient()
    const key = profileKey(network, wallet)
    if (request.method === 'GET') {
      const profile = await redis.get<Profile>(key)
      if (profile?.displayName) {
        const label = `${wallet.slice(0, 5)}...${wallet.slice(-4)}`
        await redis.set(`testnet-games:profile-label:${network}:${label}`, profile.displayName)
      }
      const url = process.env.UPSTASH_REDIS_REST_URL!.trim()
      const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim()
      const rawRedis = new Redis({ url, token, automaticDeserialization: false })
      const normalized = normalizedWallet(network, wallet)
      const [historyRows, leaderboardRows, progression, verified, moderator, streamer, warnings, kickSlug] = await Promise.all([
        rawRedis.zrange<string[]>(GAME_HISTORY_KEY, 0, 4_999, { rev: true }),
        // Include legacy games written before game history was separated from
        // personal-best leaderboard entries.
        rawRedis.zrange<string[]>(LEADERBOARD_KEY, 0, 499, { rev: true }),
        redis.hgetall<Record<string, string | number>>(playerStatsKey(network, wallet)),
        redis.sismember(VERIFIED_WALLETS_KEY, `${network}:${normalized}`),
        redis.sismember(MODERATORS_KEY, `${network}:${normalized}`),
        redis.sismember(STREAMERS_KEY, `${network}:${normalized}`),
        redis.get(warningKey(network, normalized)),
        redis.hget<string>(KICK_CHANNELS_KEY, `${network}:${normalized}`),
      ])
      const gamesByTransaction = new Map<string, LeaderboardRecord>()
      ;[...historyRows, ...leaderboardRows].forEach(row => {
        try {
          const record = JSON.parse(row) as LeaderboardRecord
          const recordWallet = record.network === 'megaeth' ? record.walletAddress?.toLowerCase() : record.walletAddress
          if (record.network === network && recordWallet === normalized) gamesByTransaction.set(record.transaction, record)
        } catch { /* Ignore malformed legacy rows. */ }
      })
      const games = [...gamesByTransaction.values()].sort((a, b) => b.playedAt - a.playedAt)
      const gamesPlayed = Math.max(games.length, Number(progression?.games ?? 0))
      const wagerEquivalentSol = Number(progression?.wager_microsol ?? 0) / MICROSOL
      const level = levelFromWager(wagerEquivalentSol)
      const currentLevelWager = requiredSolForLevel(level)
      const nextLevelWager = level >= 100 ? currentLevelWager : requiredSolForLevel(level + 1)
      // Role order is also role priority. A moderator keeps the single role slot
      // if a wallet is accidentally present in both role sets.
      const tags = allowedPlayerTags([Boolean(verified) ? 'verified' : '', Boolean(moderator) ? 'moderator' : '', Boolean(streamer) ? 'streamer' : ''])
      return response.status(200).json({
        displayName: profile?.displayName ?? '', avatarUrl: profile?.avatarUrl ?? '', referralCode: profile?.referralCode ?? '', createdAt: profile?.createdAt ?? (games.length ? Math.min(...games.map(game => game.playedAt)) : 0), tags, verified: tags.includes('verified'), moderator: tags.includes('moderator'), streamer: tags.includes('streamer'), kickSlug: typeof kickSlug === 'string' ? kickSlug : '', kickUrl: typeof kickSlug === 'string' && kickSlug ? `https://kick.com/${kickSlug}` : '', warningCount: Number(warnings ?? 0), discordConnected: Boolean(profile?.discordId),
        nextChangeAt: (profile?.changedAt ?? 0) + COOLDOWN_MS,
        level, wagerEquivalentSol, wagerIntoLevelSol: level >= 100 ? 0 : wagerEquivalentSol - currentLevelWager,
        wagerForNextLevelSol: level >= 100 ? 0 : nextLevelWager - currentLevelWager,
        stats: {
          gamesPlayed, wins: Number(progression?.wins ?? 0), losses: Number(progression?.losses ?? 0), bestScore: Number(progression?.best_score ?? 0),
          solWagered: network === 'solana' ? gamesPlayed * 0.01 : 0, ethWagered: network === 'megaeth' ? gamesPlayed * 0.01 : 0,
        },
        transactions: games.slice(0, 25).map(game => ({ hash: game.transaction, network: game.network, playedAt: game.playedAt, score: game.score, won: game.won })),
      })
    }
    if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })
    if (request.body?.action === 'set-referral') {
      const referralCode = typeof request.body?.referralCode === 'string' ? request.body.referralCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : ''
      const timestamp = Number(request.body?.timestamp)
      const signature = typeof request.body?.signature === 'string' ? request.body.signature : ''
      if (referralCode.length < 3) throw new Error('Referral code must contain at least three letters or numbers.')
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new Error('Referral request expired. Try again.')
      verifySignature(network, wallet, joinedReferralMessage(network, wallet, referralCode, timestamp), signature)
      const current = await redis.get<Profile>(key)
      if (!current?.displayName) throw new Error('Create your profile first.')
      if (current.referralCode) throw new Error('The referral code used by this account is already locked.')
      const owner = `${network}:${normalizedWallet(network, wallet)}`
      const affiliateOwner = await redis.get<string>(`testnet-games:affiliate-code-owner:v1:${referralCode}`)
      if (!affiliateOwner) throw new Error('That affiliate code does not exist.')
      if (affiliateOwner === owner) throw new Error('You cannot use your own affiliate code.')
      await redis.set(key, { ...current, referralCode })
      await redis.sadd(`testnet-games:affiliate-referrals:v1:${referralCode}`, owner)
      return response.status(200).json({ referralCode })
    }
    if (request.body?.action === 'kick-channel') {
      const timestamp = Number(request.body?.timestamp)
      const signature = typeof request.body?.signature === 'string' ? request.body.signature : ''
      const kickSlug = typeof request.body?.kickSlug === 'string' ? request.body.kickSlug.trim().toLowerCase() : ''
      if (kickSlug && !/^[a-z0-9_-]{2,32}$/.test(kickSlug)) throw new Error('Enter a valid kick.com channel link.')
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new Error('Kick channel request expired. Try again.')
      const normalized = normalizedWallet(network, wallet)
      if (!await redis.sismember(STREAMERS_KEY, `${network}:${normalized}`)) throw new Error('Only assigned Streamers can add a Kick channel.')
      verifySignature(network, wallet, kickChannelChangeMessage(network, wallet, kickSlug, timestamp), signature)
      if (kickSlug) await redis.hset(KICK_CHANNELS_KEY, { [`${network}:${normalized}`]: kickSlug })
      else await redis.hdel(KICK_CHANNELS_KEY, `${network}:${normalized}`)
      return response.status(200).json({ kickSlug, kickUrl: kickSlug ? `https://kick.com/${kickSlug}` : '' })
    }
    if (request.body?.action === 'avatar') {
      const avatarUrl = typeof request.body?.avatarUrl === 'string' ? request.body.avatarUrl : ''
      const timestamp = Number(request.body?.timestamp)
      const signature = typeof request.body?.signature === 'string' ? request.body.signature : ''
      if (avatarUrl && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatarUrl) || avatarUrl.length > 200_000)) throw new Error('Avatar must be a cropped JPEG smaller than 150 KB.')
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new Error('Avatar request expired. Try again.')
      verifySignature(network, wallet, avatarChangeMessage(network, wallet, avatarUrl, timestamp), signature)
      const current = await redis.get<Profile>(key)
      await redis.set(key, { displayName: current?.displayName ?? '', changedAt: current?.changedAt ?? 0, createdAt: current?.createdAt, discordId: current?.discordId, referralCode: current?.referralCode, avatarUrl })
      return response.status(200).json({ avatarUrl })
    }
    const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim().replace(/\s+/g, ' ') : ''
    const referralCode = typeof request.body?.referralCode === 'string' ? request.body.referralCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : ''
    const timestamp = Number(request.body?.timestamp)
    const signature = typeof request.body?.signature === 'string' ? request.body.signature : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,18}[A-Za-z0-9]$/.test(displayName)) throw new Error('Name must be 3–20 characters using letters, numbers, spaces, _ or -.')
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new Error('Name-change request expired. Try again.')
    if (referralCode && referralCode.length < 3) throw new Error('Referral code must contain at least 3 letters or numbers.')
    verifySignature(network, wallet, nameChangeMessage(network, wallet, displayName, timestamp, referralCode), signature)
    const current = await redis.get<Profile>(key)
    if (current?.displayName && referralCode) throw new Error('The referral code used at signup cannot be changed.')
    // The first username is required for entry and only needs a valid wallet
    // signature. Later username changes keep the balance and cooldown checks.
    if (current?.displayName) await verifyBalance(network, wallet)
    const nextChangeAt = (current?.changedAt ?? 0) + COOLDOWN_MS
    if (current?.displayName && nextChangeAt > Date.now()) throw new Error(`Name can be changed again in ${Math.ceil((nextChangeAt - Date.now()) / 60_000)} minute(s).`)
    const owner = `${network}:${normalizedWallet(network, wallet)}`
    if (!current?.displayName && referralCode) {
      const affiliateOwner = await redis.get<string>(`testnet-games:affiliate-code-owner:v1:${referralCode}`)
      if (!affiliateOwner) throw new Error('That affiliate code does not exist.')
      if (affiliateOwner === owner) throw new Error('You cannot use your own affiliate code.')
    }
    const newlyClaimed = await claimUniqueUsername(redis, displayName, owner)
    let profileSaved = false
    try {
      const cooldownKey = `${key}:name-change-cooldown`
      if (current?.displayName) {
        const claimed = await redis.set(cooldownKey, '1', { nx: true, px: COOLDOWN_MS })
        if (claimed !== 'OK') throw new Error('Name can only be changed once every 10 minutes.')
      }
      const firstProfile = !current?.displayName
      const profile: Profile = { ...current, displayName, changedAt: Date.now(), createdAt: current?.createdAt ?? Date.now(), referralCode: firstProfile ? referralCode || undefined : current?.referralCode }
      await redis.set(key, profile)
      profileSaved = true
      if (firstProfile) {
        if (referralCode) await redis.sadd(`testnet-games:affiliate-referrals:v1:${referralCode}`, owner)
        const welcome = {
          id: `welcome-${network}-${normalizedWallet(network, wallet)}`,
          type: 'welcome',
          title: 'Welcome to DINOGAME',
          message: 'Your player profile is ready. Play verified games, earn Dino Tokens, and climb the leaderboard.',
          receivedAt: Date.now(),
          read: false,
        }
        await redis.lpush(notificationKey(network, wallet), JSON.stringify(welcome))
        await redis.ltrim(notificationKey(network, wallet), 0, 29)
      }
      if (current?.displayName && normalizedUsername(current.displayName) !== normalizedUsername(displayName)) {
        const previousKey = usernameOwnerKey(current.displayName)
        if (await redis.get<string>(previousKey) === owner) await redis.del(previousKey)
      }
      const label = `${wallet.slice(0, 5)}...${wallet.slice(-4)}`
      await redis.set(`testnet-games:profile-label:${network}:${label}`, displayName)
      return response.status(200).json({ displayName, nextChangeAt: profile.changedAt + COOLDOWN_MS })
    } catch (error) {
      if (newlyClaimed && !profileSaved) await redis.del(usernameOwnerKey(displayName))
      throw error
    }
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Profile request failed.' })
  }
}
