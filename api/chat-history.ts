import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { PublicKey } from '@solana/web3.js'

type Network = 'solana' | 'megaeth'
type ReplyPreview = { id: string; name: string; message: string }
type ChatRecord = { id: string; name: string; message: string; network: Network; wallet: string; sentAt: number; replyTo?: ReplyPreview }

const CHAT_HISTORY_KEY = 'testnet-games:chat-history:v1'

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

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const redis = redisClient()
    if (request.method === 'GET') {
      const rows = await redis.lrange<string>(CHAT_HISTORY_KEY, 0, 29)
      const messages = rows.map(row => { try { return parseRecord(JSON.parse(row)) } catch { return null } }).filter((item): item is ChatRecord => Boolean(item)).sort((a, b) => a.sentAt - b.sentAt)
      return response.status(200).json({ messages })
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
