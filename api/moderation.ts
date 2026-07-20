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

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    if (request.method === 'GET') {
      const network = request.query.network as Network
      const wallet = typeof request.query.wallet === 'string' ? normalizeWallet(network, request.query.wallet) : ''
      if ((network !== 'solana' && network !== 'megaeth') || !wallet) throw new Error('A valid wallet and network are required.')
      const redis = redisClient()
      const rows = await redis.lrange<string>(notificationKey(network, wallet), 0, 29)
      const notifications = rows.flatMap(row => { try { return [JSON.parse(row)] } catch { return [] } })
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
    }
    const record = { action: effectiveAction, requestedAction: action, moderator: `${moderatorNetwork}:${cleanModerator}`, target: `${targetNetwork}:${cleanTarget}`, note, durationMinutes: effectiveDuration, warningCount, automatic, createdAt }
    const auditKey = `testnet-games:moderation-history:${targetNetwork}:${cleanTarget}`
    await redis.lpush(auditKey, JSON.stringify(record))
    await redis.ltrim(auditKey, 0, 49)
    if (effectiveAction === 'timeout') await redis.set(`testnet-games:chat-timeout:${targetNetwork}:${cleanTarget}`, JSON.stringify(record), { px: effectiveDuration * 60_000 })
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
