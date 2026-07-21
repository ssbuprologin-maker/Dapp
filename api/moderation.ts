import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'

type Network = 'solana' | 'megaeth'
type ModerationAction = 'warn' | 'timeout'

const MODERATORS_KEY = 'testnet-games:moderators:v1'
const encoder = new TextEncoder()
const warningKey = (network: Network, wallet: string) => `testnet-games:moderation-warnings:${network}:${wallet}`
const notificationKey = (network: Network, wallet: string) => `testnet-games:notifications:${network}:${wallet}`
const timeoutKey = (network: Network, wallet: string) => `testnet-games:chat-timeout:${network}:${wallet}`
const pendingTimeoutEndKey = (network: Network, wallet: string) => `testnet-games:chat-timeout-end-pending:${network}:${wallet}`
const completedTimeoutEndKey = (network: Network, wallet: string, expiresAt: number) => `testnet-games:chat-timeout-end-completed:${network}:${wallet}:${expiresAt}`

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Moderation is not configured.')
  return new Redis({ url, token })
}

function normalizeWallet(network: Network, wallet: string) {
  if (network === 'solana') return new PublicKey(wallet).toBase58()
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid MegaETH wallet address.')
  return wallet.toLowerCase()
}

function moderationMessage(action: ModerationAction, moderatorNetwork: Network, moderator: string, targetNetwork: Network, target: string, durationMinutes: number, note: string, timestamp: number) {
  return `Testnet Games moderation\nAction: ${action}\nModerator: ${moderatorNetwork}:${normalizeWallet(moderatorNetwork, moderator)}\nTarget: ${targetNetwork}:${normalizeWallet(targetNetwork, target)}\nDuration minutes: ${durationMinutes}\nNote: ${note}\nTimestamp: ${timestamp}`
}

function verifySignature(network: Network, wallet: string, message: string, signature: string) {
  if (network === 'solana') {
    if (!ed25519.verify(bs58.decode(signature), encoder.encode(message), new PublicKey(wallet).toBytes())) throw new Error('Moderator wallet signature is invalid.')
    return
  }
  const bytes = signature.startsWith('0x') ? signature.slice(2) : signature
  if (!/^[a-fA-F0-9]{130}$/.test(bytes)) throw new Error('Moderator wallet signature is invalid.')
  const raw = Uint8Array.from(bytes.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16)))
  const messageBytes = encoder.encode(message)
  const prefix = encoder.encode(`\x19Ethereum Signed Message:\n${messageBytes.length}`)
  const payload = new Uint8Array(prefix.length + messageBytes.length)
  payload.set(prefix); payload.set(messageBytes, prefix.length)
  const hash = keccak_256(payload)
  const recovery = raw[64] >= 27 ? raw[64] - 27 : raw[64]
  const publicKey = secp256k1.Signature.fromCompact(raw.slice(0, 64)).addRecoveryBit(recovery).recoverPublicKey(hash).toRawBytes(false)
  const recovered = `0x${Array.from(keccak_256(publicKey.slice(1)).slice(-20), byte => byte.toString(16).padStart(2, '0')).join('')}`
  if (recovered !== wallet.toLowerCase()) throw new Error('Moderator wallet signature is invalid.')
}

async function publishEndedTimeout(redis: Redis, network: Network, wallet: string) {
  const stored = await redis.get<unknown>(pendingTimeoutEndKey(network, wallet))
  if (!stored) return
  let pending: { expiresAt?: number } | null = null
  if (typeof stored === 'object') pending = stored as { expiresAt?: number }
  else if (typeof stored === 'string') {
    try { pending = JSON.parse(stored) as { expiresAt?: number } } catch { /* Invalid legacy data is removed below. */ }
  }
  const expiresAt = Number(pending?.expiresAt)
  if (!Number.isFinite(expiresAt)) {
    await redis.del(pendingTimeoutEndKey(network, wallet))
    return
  }
  if (Date.now() < expiresAt) return

  // NX makes polling from multiple browser tabs safe: only one request can
  // publish the completion notification for this exact timeout.
  const claimed = await redis.set(completedTimeoutEndKey(network, wallet, expiresAt), '1', { nx: true, ex: 7 * 24 * 60 * 60 })
  if (claimed) {
    const notification = {
      id: `timeout-ended-${network}-${wallet}-${expiresAt}`,
      type: 'timeout-ended',
      title: 'Timeout ended',
      message: 'Your chat timeout has ended. You can send messages again.',
      receivedAt: Date.now(),
      read: false,
    }
    await redis.lpush(notificationKey(network, wallet), JSON.stringify(notification))
    await redis.ltrim(notificationKey(network, wallet), 0, 29)
  }
  await redis.del(pendingTimeoutEndKey(network, wallet))
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    if (request.method === 'GET') {
      const network = request.query.network as Network
      const wallet = typeof request.query.wallet === 'string' ? normalizeWallet(network, request.query.wallet) : ''
      if ((network !== 'solana' && network !== 'megaeth') || !wallet) throw new Error('A valid wallet and network are required.')
      const redis = redisClient()
      await publishEndedTimeout(redis, network, wallet)
      const rows = await redis.lrange<unknown>(notificationKey(network, wallet), 0, 29)
      const notifications = rows.flatMap(row => {
        if (row && typeof row === 'object') return [row]
        if (typeof row !== 'string') return []
        try {
          const parsed: unknown = JSON.parse(row)
          return parsed && typeof parsed === 'object' ? [parsed] : []
        } catch { return [] }
      })
      return response.status(200).json({ notifications })
    }
    if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })
    const action = request.body?.action
    const moderatorNetwork = request.body?.moderatorNetwork
    const targetNetwork = request.body?.targetNetwork
    const moderator = request.body?.moderator
    const target = request.body?.target
    const durationMinutes = Number(request.body?.durationMinutes ?? 0)
    const note = typeof request.body?.note === 'string' ? request.body.note.trim().replace(/\s+/g, ' ') : ''
    const timestamp = Number(request.body?.timestamp)
    const signature = typeof request.body?.signature === 'string' ? request.body.signature : ''
    if ((action !== 'warn' && action !== 'timeout') || (moderatorNetwork !== 'solana' && moderatorNetwork !== 'megaeth') || (targetNetwork !== 'solana' && targetNetwork !== 'megaeth') || typeof moderator !== 'string' || typeof target !== 'string') throw new Error('Invalid moderation request.')
    if (!note || note.length > 240) throw new Error('A moderation note of 1–240 characters is required.')
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new Error('Moderation request expired. Try again.')
    if (action === 'timeout' && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10_080)) throw new Error('Timeout duration must be between 1 minute and 7 days.')
    const cleanModerator = normalizeWallet(moderatorNetwork, moderator)
    const cleanTarget = normalizeWallet(targetNetwork, target)
    if (`${moderatorNetwork}:${cleanModerator}` === `${targetNetwork}:${cleanTarget}`) throw new Error('You cannot moderate your own wallet.')
    verifySignature(moderatorNetwork, cleanModerator, moderationMessage(action, moderatorNetwork, cleanModerator, targetNetwork, cleanTarget, action === 'timeout' ? durationMinutes : 0, note, timestamp), signature)
    const redis = redisClient()
    if (!await redis.sismember(MODERATORS_KEY, `${moderatorNetwork}:${cleanModerator}`)) throw new Error('This wallet is not a moderator.')
    if (action === 'timeout' && await redis.sismember(MODERATORS_KEY, `${targetNetwork}:${cleanTarget}`)) {
      throw new Error('Moderators cannot timeout another moderator.')
    }
    const createdAt = Date.now()
    let warningCount = Number(await redis.get(warningKey(targetNetwork, cleanTarget)) ?? 0)
    let effectiveAction = action
    let effectiveDuration = action === 'timeout' ? durationMinutes : 0
    let automatic = false
    if (action === 'warn') {
      warningCount = Number(await redis.incr(warningKey(targetNetwork, cleanTarget)))
      if (warningCount > 3) { effectiveAction = 'timeout'; effectiveDuration = 10; automatic = true }
    } else {
      // A manual timeout is one moderation strike and is shown alongside
      // warnings in the moderator-only player view.
      warningCount = Number(await redis.incr(warningKey(targetNetwork, cleanTarget)))
    }
    const record = { action: effectiveAction, requestedAction: action, moderator: `${moderatorNetwork}:${cleanModerator}`, target: `${targetNetwork}:${cleanTarget}`, note, durationMinutes: effectiveDuration, warningCount, automatic, createdAt }
    const auditKey = `testnet-games:moderation-history:${targetNetwork}:${cleanTarget}`
    await redis.lpush(auditKey, JSON.stringify(record))
    await redis.ltrim(auditKey, 0, 49)
    if (effectiveAction === 'timeout') {
      const expiresAt = createdAt + effectiveDuration * 60_000
      await redis.set(timeoutKey(targetNetwork, cleanTarget), JSON.stringify(record), { px: effectiveDuration * 60_000 })
      await redis.set(pendingTimeoutEndKey(targetNetwork, cleanTarget), JSON.stringify({ expiresAt }))
    }
    const notification = {
      id: `moderation-${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      type: effectiveAction,
      title: effectiveAction === 'timeout' ? (automatic ? 'Timed out after warnings' : 'Chat timeout') : 'Warning received',
      message: automatic ? `You received warning #${warningCount}: ${note}. You have been timed out for 10 minutes.` : effectiveAction === 'timeout' ? `${note}. You are timed out for ${effectiveDuration} minute${effectiveDuration === 1 ? '' : 's'}.` : `Warning #${warningCount}: ${note}`,
      receivedAt: createdAt,
      read: false,
    }
    await redis.lpush(notificationKey(targetNetwork, cleanTarget), JSON.stringify(notification))
    await redis.ltrim(notificationKey(targetNetwork, cleanTarget), 0, 29)
    return response.status(200).json({ action: effectiveAction, warningCount, automatic, expiresAt: effectiveAction === 'timeout' ? createdAt + effectiveDuration * 60_000 : null })
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Moderation request failed.' })
  }
}
