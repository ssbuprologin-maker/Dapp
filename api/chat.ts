import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { PublicKey } from '@solana/web3.js'

const CHAT_KEY = 'testnet-games:chat:v1'
type Network = 'solana' | 'megaeth'
type ChatMessage = { id: string; name: string; message: string; network: Network; sentAt: number }

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Online chat is not configured.')
  return new Redis({ url, token, automaticDeserialization: false })
}

function normalizeWallet(network: Network, wallet: string) {
  if (network === 'solana') return new PublicKey(wallet).toBase58()
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid wallet address.')
  return wallet.toLowerCase()
}

function parseName(raw: unknown) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
    return typeof parsed === 'string' ? parsed : (parsed as { displayName?: string } | null)?.displayName ?? ''
  } catch { return '' }
}

async function readMessages(redis: Redis) {
  const rows = await redis.lrange<string>(CHAT_KEY, 0, 99)
  return rows.flatMap(row => {
    try { return [JSON.parse(row) as ChatMessage] } catch { return [] }
  }).reverse()
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const redis = redisClient()
    if (request.method === 'GET') return response.status(200).json({ messages: await readMessages(redis) })
    if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })

    const network = request.body?.network as Network
    const walletInput = typeof request.body?.wallet === 'string' ? request.body.wallet.trim() : ''
    const message = typeof request.body?.message === 'string' ? request.body.message.trim().replace(/[\u0000-\u001f\u007f]/g, ' ') : ''
    if (network !== 'solana' && network !== 'megaeth') throw new Error('Invalid network.')
    if (!message || message.length > 240) throw new Error('Chat messages must be 1–240 characters.')
    const wallet = normalizeWallet(network, walletInput)
    const forwarded = request.headers['x-forwarded-for']
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? 'unknown').split(',')[0].trim()
    const allowed = await redis.set(`testnet-games:chat-rate:${network}:${wallet}:${ip}`, '1', { nx: true, ex: 3 })
    if (allowed !== 'OK') return response.status(429).json({ message: 'Slow down—wait a few seconds before chatting again.' })

    const profile = await redis.get<unknown>(`testnet-games:profile:${network}:${wallet}`)
    const name = parseName(profile) || `${wallet.slice(0, 5)}...${wallet.slice(-4)}`
    const record: ChatMessage = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, name, message, network, sentAt: Date.now() }
    await redis.lpush(CHAT_KEY, JSON.stringify(record))
    await redis.ltrim(CHAT_KEY, 0, 99)
    return response.status(200).json({ messages: await readMessages(redis) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat request failed.'
    return response.status(/not configured/i.test(message) ? 503 : 400).json({ message })
  }
}
