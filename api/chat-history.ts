import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { PublicKey } from '@solana/web3.js'
import Ably from 'ably'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'

type Network = 'solana' | 'megaeth'
type ReplyPreview = { id: string; name: string; message: string }
type ChatRecord = { id: string; name: string; message: string; network: Network; wallet: string; sentAt: number; replyTo?: ReplyPreview }

const CHAT_HISTORY_KEY = 'testnet-games:chat-history:v1'
const DELETED_MESSAGES_KEY = 'testnet-games:chat-deleted:v1'
const MODERATORS_KEY = 'testnet-games:moderators:v1'
const CHANNEL = 'testnet-games-global-chat'
const encoder = new TextEncoder()

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Chat history is not configured.')
  return new Redis({ url, token, automaticDeserialization: false })
}

function parseRecord(value: unknown): ChatRecord | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<ChatRecord>
  if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.message !== 'string' || typeof record.sentAt !== 'number' || (record.network !== 'solana' && record.network !== 'megaeth') || typeof record.wallet !== 'string') return null
  try {
    if (record.network === 'solana') new PublicKey(record.wallet)
    else if (!/^0x[a-fA-F0-9]{40}$/.test(record.wallet)) return null
  } catch { return null }
  const reply = record.replyTo
  const replyTo = reply && typeof reply.id === 'string' && typeof reply.name === 'string' && typeof reply.message === 'string'
    ? { id: reply.id.slice(0, 100), name: reply.name.slice(0, 40), message: reply.message.slice(0, 100) }
    : undefined
  return { id: record.id.slice(0, 120), name: record.name.slice(0, 40), message: record.message.slice(0, 140), network: record.network, wallet: record.wallet, sentAt: record.sentAt, replyTo }
}

function normalizeWallet(network: Network, wallet: string) {
  if (network === 'solana') return new PublicKey(wallet).toBase58()
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid MegaETH wallet address.')
  return wallet.toLowerCase()
}

function deletionMessage(network: Network, moderator: string, messageId: string, timestamp: number) {
  return `Testnet Games chat deletion\nModerator: ${network}:${normalizeWallet(network, moderator)}\nMessage ID: ${messageId}\nTimestamp: ${timestamp}`
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
    const redis = redisClient()
    if (request.method === 'GET') {
      if (typeof request.query.deleted === 'string') {
        const deleted = (await redis.zscore(DELETED_MESSAGES_KEY, request.query.deleted)) !== null
        return response.status(200).json({ deleted })
      }
      const rows = await redis.lrange<string>(CHAT_HISTORY_KEY, 0, 29)
      const messages = rows.map(row => { try { return parseRecord(JSON.parse(row)) } catch { return null } }).filter((item): item is ChatRecord => Boolean(item)).sort((a, b) => a.sentAt - b.sentAt)
      const deletedIds = await redis.zrange<string[]>(DELETED_MESSAGES_KEY, 0, -1)
      return response.status(200).json({ messages: messages.filter(message => !deletedIds.includes(message.id)), deletedIds })
    }
    if (request.method === 'DELETE') {
      const network = request.body?.network as Network
      const moderator = typeof request.body?.moderator === 'string' ? request.body.moderator : ''
      const messageId = typeof request.body?.messageId === 'string' ? request.body.messageId : ''
      const timestamp = Number(request.body?.timestamp)
      const signature = typeof request.body?.signature === 'string' ? request.body.signature : ''
      if ((network !== 'solana' && network !== 'megaeth') || !moderator || !messageId || messageId.length > 120) throw new Error('Invalid message deletion request.')
      if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new Error('Message deletion request expired. Try again.')
      const cleanModerator = normalizeWallet(network, moderator)
      verifySignature(network, cleanModerator, deletionMessage(network, cleanModerator, messageId, timestamp), signature)
      if (!await redis.sismember(MODERATORS_KEY, `${network}:${cleanModerator}`)) throw new Error('This wallet is not a moderator.')
      const rows = await redis.lrange<string>(CHAT_HISTORY_KEY, 0, 29)
      const storedRow = rows.find(row => { try { return (JSON.parse(row) as { id?: string }).id === messageId } catch { return false } })
      if (storedRow) await redis.lrem(CHAT_HISTORY_KEY, 0, storedRow)
      await redis.zadd(DELETED_MESSAGES_KEY, { score: Date.now(), member: messageId })
      const deletedCount = await redis.zcard(DELETED_MESSAGES_KEY)
      if (deletedCount > 500) await redis.zremrangebyrank(DELETED_MESSAGES_KEY, 0, deletedCount - 501)
      const ablyKey = process.env.ABLY_API_KEY?.trim()
      if (ablyKey) await new Ably.Rest(ablyKey).channels.get(CHANNEL).publish('chat-delete', { id: messageId })
      return response.status(200).json({ deleted: true })
    }
    if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })
    const record = parseRecord(request.body)
    if (!record) throw new Error('Invalid chat message.')
    await redis.lpush(CHAT_HISTORY_KEY, JSON.stringify(record))
    // Trim only after inserting message 31. Therefore a smaller chat is never deleted.
    await redis.ltrim(CHAT_HISTORY_KEY, 0, 29)
    return response.status(200).json({ ok: true })
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Chat history request failed.' })
  }
}
