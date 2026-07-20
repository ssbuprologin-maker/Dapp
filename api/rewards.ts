import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'

type Network = 'solana' | 'megaeth'
type Action = 'daily-case' | 'cashback'
const MICROSOL = 1_000_000
const MICROUSD = 1_000_000
const DINO_TOKENS_LEADERBOARD_KEY = 'testnet-games:dino-tokens:v1'
const TOKENS_PER_USD = 1
const encoder = new TextEncoder()

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Rewards are not configured. Add the Upstash Redis REST variables in Vercel.')
  return new Redis({ url, token })
}

function normalizedWallet(network: Network, wallet: string) {
  if (network === 'solana') return new PublicKey(wallet).toBase58()
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid MegaETH wallet address.')
  return wallet.toLowerCase()
}

const statsKey = (network: Network, wallet: string) => `testnet-games:player-stats:${network}:${normalizedWallet(network, wallet)}`
const profileKey = (network: Network, wallet: string) => `testnet-games:profile:${network}:${normalizedWallet(network, wallet)}`
const caseKey = (network: Network, wallet: string) => `testnet-games:daily-case:${network}:${normalizedWallet(network, wallet)}`

function rewardMessage(action: Action, network: Network, wallet: string, timestamp: number) {
  return `Testnet Games rewards\nAction: ${action}\nNetwork: ${network}\nWallet: ${normalizedWallet(network, wallet)}\nTimestamp: ${timestamp}`
}

function verifySignature(network: Network, wallet: string, message: string, signature: string) {
  if (network === 'solana') {
    if (!ed25519.verify(bs58.decode(signature), encoder.encode(message), new PublicKey(wallet).toBytes())) throw new Error('Wallet signature is invalid.')
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

function tokenBalance(stats: Record<string, string | number> | null) {
  const wagerUsdMicros = Number(stats?.wager_usd_micros ?? 0)
  const wagerMicrosol = Number(stats?.wager_microsol ?? 0)
  // Older verified rounds predate USD wager tracking. Preserve their already
  // earned DT at the previous rate, while every new verified round uses the
  // 1 DT per $1 rule recorded by api/leaderboard.
  const earnedFromWager = wagerUsdMicros > 0
    ? (wagerUsdMicros / MICROUSD) * TOKENS_PER_USD
    : (wagerMicrosol / MICROSOL) * 64
  return Math.round((earnedFromWager + Number(stats?.dt_bonus ?? 0)) * 10_000) / 10_000
}

function cashbackAvailableMicrosol(stats: Record<string, string | number> | null) {
  return Math.max(0, Math.floor(Number(stats?.wager_microsol ?? 0) * 0.002) - Number(stats?.cashback_claimed_microsol ?? 0))
}

function midnightDelay() {
  const next = new Date()
  next.setUTCHours(24, 0, 0, 0)
  return Math.max(1, next.getTime() - Date.now())
}

function pickCasePrize() {
  const roll = Math.random() * 100
  if (roll < 0.001) return { label: '10 SOL credit', kind: 'sol', microsol: 10 * MICROSOL, chance: '0.001%' }
  if (roll < 0.005) return { label: '2.5 SOL credit', kind: 'sol', microsol: 2.5 * MICROSOL, chance: '0.004%' }
  if (roll < 0.014) return { label: '1 SOL credit', kind: 'sol', microsol: MICROSOL, chance: '0.009%' }
  if (roll < 0.09) return { label: '0.1 SOL credit', kind: 'sol', microsol: 0.1 * MICROSOL, chance: '0.076%' }
  if (roll < 10.425) return { label: '0.001 SOL credit', kind: 'sol', microsol: 0.001 * MICROSOL, chance: '10.335%' }
  return { label: '15 DT', kind: 'dt', tokens: 15, chance: '89.575%' }
}

async function readLeaderboard(redis: Redis) {
  const members = await redis.zrange<string[]>(DINO_TOKENS_LEADERBOARD_KEY, 0, 49, { rev: true })
  if (members.length) {
    const players = members.flatMap(member => {
      const separator = member.indexOf(':')
      const network = member.slice(0, separator) as Network
      const wallet = member.slice(separator + 1)
      return (network === 'solana' || network === 'megaeth') && wallet ? [{ network, wallet }] : []
    })
    const [stats, profiles] = await Promise.all([
      Promise.all(players.map(player => redis.hgetall<Record<string, string | number>>(statsKey(player.network, player.wallet)))),
      redis.mget<(Record<string, string> | null)[]>(...players.map(player => profileKey(player.network, player.wallet))),
    ])
    return players.map((player, index) => ({
      rank: index + 1, wallet: player.wallet, network: player.network, tokens: tokenBalance(stats[index]),
      name: profiles[index]?.displayName || `${player.wallet.slice(0, 5)}...${player.wallet.slice(-4)}`,
    })).filter(row => row.tokens > 0)
  }
  let cursor = '0'
  const rows: { wallet: string; network: Network; tokens: number }[] = []
  do {
    const [next, keys] = await redis.scan(cursor, { match: 'testnet-games:player-stats:*', count: 250 })
    cursor = next
    if (!keys.length) continue
    // Player statistics are Redis hashes, so they must be read with HGETALL.
    // MGET only supports string keys and was the reason populated players
    // could appear as an empty DT leaderboard.
    const stats = await Promise.all(keys.map(key => redis.hgetall<Record<string, string | number>>(key)))
    keys.forEach((key, index) => {
      const [, , network, ...walletParts] = key.split(':')
      const wallet = walletParts.join(':')
      if ((network !== 'solana' && network !== 'megaeth') || !wallet) return
      rows.push({ wallet, network, tokens: tokenBalance(stats[index]) })
    })
  } while (cursor !== '0' && rows.length < 2_000)
  const ranked = rows.filter(row => row.tokens > 0).sort((a, b) => b.tokens - a.tokens).slice(0, 50)
  const profiles = ranked.length ? await redis.mget<(Record<string, string> | null)[]>(...ranked.map(row => profileKey(row.network, row.wallet))) : []
  return ranked.map((row, index) => ({ rank: index + 1, ...row, name: profiles[index]?.displayName || `${row.wallet.slice(0, 5)}...${row.wallet.slice(-4)}` }))
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const network = (request.method === 'GET' ? request.query.network : request.body?.network) as Network
    const walletValue = request.method === 'GET' ? request.query.wallet : request.body?.wallet
    const wallet = typeof walletValue === 'string' ? normalizedWallet(network, walletValue) : ''
    if ((network !== 'solana' && network !== 'megaeth') || !wallet) throw new Error('A valid wallet and network are required.')
    const redis = redisClient()

    if (request.method === 'GET') {
      const [stats, dailyCase] = await Promise.all([
        redis.hgetall<Record<string, string | number>>(statsKey(network, wallet)), redis.get(caseKey(network, wallet)),
      ])
      // Ensures the signed-in player's existing balance is represented in the
      // global sorted set even if it was earned before this leaderboard update.
      const tokens = tokenBalance(stats)
      if (tokens > 0) await redis.zadd(DINO_TOKENS_LEADERBOARD_KEY, { score: tokens, member: `${network}:${wallet}` })
      const leaderboard = await readLeaderboard(redis)
      return response.status(200).json({
        dinoTokens: tokens, cashbackMicrosol: cashbackAvailableMicrosol(stats), caseAvailable: !dailyCase,
        leaderboard, tokensPerDollar: TOKENS_PER_USD, cashbackRate: 0.002,
      })
    }

    if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })
    const action = request.body?.action as Action
    const timestamp = Number(request.body?.timestamp)
    const signature = typeof request.body?.signature === 'string' ? request.body.signature : ''
    if ((action !== 'daily-case' && action !== 'cashback') || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000 || !signature) throw new Error('Invalid reward claim.')
    verifySignature(network, wallet, rewardMessage(action, network, wallet, timestamp), signature)
    const key = statsKey(network, wallet)

    if (action === 'cashback') {
      const stats = await redis.hgetall<Record<string, string | number>>(key)
      const claimedMicrosol = cashbackAvailableMicrosol(stats)
      if (claimedMicrosol <= 0) throw new Error('No cashback is available yet.')
      await redis.hincrby(key, 'cashback_claimed_microsol', claimedMicrosol)
      return response.status(200).json({ message: 'Cashback claim recorded for the future rewards ledger.', claimedMicrosol })
    }

    const claimed = await redis.set(caseKey(network, wallet), String(Date.now()), { nx: true, px: midnightDelay() })
    if (claimed !== 'OK') throw new Error('Your Daily Case has already been opened. Come back after UTC midnight.')
    const prize = pickCasePrize()
    if (prize.kind === 'dt') {
      const bonus = Number(await redis.hincrby(key, 'dt_bonus', prize.tokens))
      const stats = await redis.hgetall<Record<string, string | number>>(key)
      await redis.zadd(DINO_TOKENS_LEADERBOARD_KEY, { score: tokenBalance({ ...stats, dt_bonus: bonus }), member: `${network}:${wallet}` })
    }
    else await redis.hincrby(key, 'case_credit_microsol', prize.microsol)
    await redis.hset(key, { last_case: JSON.stringify({ ...prize, openedAt: Date.now() }) })
    return response.status(200).json({ message: 'Daily Case opened.', prize })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rewards request failed.'
    return response.status(/not configured/i.test(message) ? 503 : 400).json({ message })
  }
}
