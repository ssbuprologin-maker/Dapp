import type { VercelRequest, VercelResponse } from '@vercel/node'
import Ably from 'ably'
import { PublicKey } from '@solana/web3.js'
import { Redis } from '@upstash/redis'

const CHANNEL = 'testnet-games-global-chat'
const GAME_HISTORY_KEY = 'testnet-games:game-history:v1'
const LEADERBOARD_KEY = 'testnet-games:leaderboard:v1'
const TIMEOUT_PREFIX = 'testnet-games:chat-timeout:'

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Player progression is not configured.')
  return new Redis({ url, token })
}

async function verifiedGameCount(network: string, wallet: string) {
  const redis = redisClient()
  const statsKey = `testnet-games:player-stats:${network}:${wallet}`
  const savedCount = Number(await redis.hget(statsKey, 'games') ?? 0)
  if (savedCount >= 3) return savedCount

  // Legacy verified games may predate the player-stats counter. Count their
  // unique transactions so the UI and Ably authorization make the same choice.
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim()
  const rawRedis = new Redis({ url, token, automaticDeserialization: false })
  const [history, leaderboard] = await Promise.all([
    rawRedis.zrange<string[]>(GAME_HISTORY_KEY, 0, 4_999, { rev: true }),
    rawRedis.zrange<string[]>(LEADERBOARD_KEY, 0, 499, { rev: true }),
  ])
  const transactions = new Set<string>()
  for (const row of [...history, ...leaderboard]) {
    try {
      const game = JSON.parse(row) as { network?: string; walletAddress?: string; transaction?: string }
      const gameWallet = game.network === 'megaeth' ? game.walletAddress?.toLowerCase() : game.walletAddress
      if (game.network === network && gameWallet === wallet && game.transaction) transactions.add(game.transaction)
      if (transactions.size >= 3) return transactions.size
    } catch { /* Ignore malformed legacy rows. */ }
  }
  return Math.max(savedCount, transactions.size)
}

function validIdentity(network: unknown, wallet: unknown) {
  if (network === 'solana' && typeof wallet === 'string') {
    try { return new PublicKey(wallet).toBase58() } catch { return '' }
  }
  if (network === 'megaeth' && typeof wallet === 'string' && /^0x[a-fA-F0-9]{40}$/.test(wallet)) return wallet.toLowerCase()
  return ''
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    if (request.method !== 'GET') return response.status(405).json({ message: 'Method not allowed.' })
    const key = process.env.ABLY_API_KEY?.trim()
    if (!key) return response.status(503).json({ message: 'Live chat is not configured. Add ABLY_API_KEY in Vercel.' })
    const wallet = validIdentity(request.query.network, request.query.wallet)
    const clientId = wallet ? `${request.query.network}:${wallet}` : `visitor-${crypto.randomUUID()}`
    const network = request.query.network === 'solana' || request.query.network === 'megaeth' ? request.query.network : ''
    const gamesPlayed = wallet ? await verifiedGameCount(network, wallet) : 0
    const timedOut = wallet && network ? Boolean(await redisClient().get(`${TIMEOUT_PREFIX}${network}:${wallet}`)) : false
    const operations = wallet && gamesPlayed >= 3 && !timedOut
      ? ['subscribe', 'history', 'publish', 'presence']
      : ['subscribe', 'history', 'presence']
    const ably = new Ably.Rest(key)
    const tokenRequest = await ably.auth.createTokenRequest({ clientId, capability: JSON.stringify({ [CHANNEL]: operations }), ttl: 60_000 })
    return response.status(200).json(tokenRequest)
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Could not authorize live chat.' })
  }
}
