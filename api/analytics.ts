import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'

const TOTALS_KEY = 'testnet-games:analytics:totals'
const UNIQUE_VISITORS_KEY = 'testnet-games:analytics:unique-visitors'
const allowedEvents = new Set([
  'site_visit', 'session_ended', 'wallet_connected',
  'game_transaction_confirmed', 'game_finished',
])

type EventBody = {
  event?: string
  visitor_id?: string
  properties?: Record<string, unknown>
}

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Redis analytics is not configured.')
  return new Redis({ url, token })
}

function requestBody(request: VercelRequest): EventBody {
  if (typeof request.body === 'string') {
    try { return JSON.parse(request.body) as EventBody }
    catch { return {} }
  }
  return request.body && typeof request.body === 'object' ? request.body as EventBody : {}
}

const safeField = (value: unknown, allowed: string[], fallback: string) =>
  typeof value === 'string' && allowed.includes(value) ? value : fallback

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })
  try {
    const body = requestBody(request)
    if (!body.event || !allowedEvents.has(body.event)) return response.status(400).json({ message: 'Invalid analytics event.' })
    const properties = body.properties ?? {}
    const day = new Date().toISOString().slice(0, 10)
    const dailyKey = `testnet-games:analytics:daily:${day}`
    const redis = redisClient()
    const pipeline = redis.pipeline()

    if (body.event === 'site_visit') {
      pipeline.hincrby(TOTALS_KEY, 'site_visits', 1)
      pipeline.hincrby(dailyKey, 'site_visits', 1)
      if (typeof body.visitor_id === 'string' && /^[a-f0-9-]{20,64}$/i.test(body.visitor_id)) {
        pipeline.pfadd(UNIQUE_VISITORS_KEY, body.visitor_id)
      }
    }

    if (body.event === 'session_ended') {
      const seconds = Math.min(86_400, Math.max(1, Math.floor(Number(properties.duration_seconds) || 0)))
      pipeline.hincrby(TOTALS_KEY, 'sessions_measured', 1)
      pipeline.hincrby(TOTALS_KEY, 'session_seconds_total', seconds)
      pipeline.hincrby(dailyKey, 'sessions_measured', 1)
      pipeline.hincrby(dailyKey, 'session_seconds_total', seconds)
    }

    if (body.event === 'wallet_connected') {
      const walletType = safeField(properties.wallet_type, ['metamask', 'site_wallet', 'Phantom', 'Solflare'], 'other')
      const network = safeField(properties.network, ['solana_devnet', 'megaeth_testnet'], 'other')
      pipeline.hincrby(TOTALS_KEY, 'wallet_connections', 1)
      pipeline.hincrby(TOTALS_KEY, `wallet_${walletType.toLowerCase()}`, 1)
      pipeline.hincrby(TOTALS_KEY, `wallet_network_${network}`, 1)
      pipeline.hincrby(dailyKey, 'wallet_connections', 1)
    }

    if (body.event === 'game_transaction_confirmed') {
      const network = safeField(properties.network, ['solana_devnet', 'megaeth_testnet'], 'other')
      pipeline.hincrby(TOTALS_KEY, 'game_transactions', 1)
      pipeline.hincrby(TOTALS_KEY, `game_transactions_${network}`, 1)
      pipeline.hincrby(dailyKey, 'game_transactions', 1)
      pipeline.hincrby(dailyKey, `game_transactions_${network}`, 1)
    }

    if (body.event === 'game_finished') {
      const won = properties.won === true
      pipeline.hincrby(TOTALS_KEY, 'games_finished', 1)
      pipeline.hincrby(TOTALS_KEY, won ? 'player_wins' : 'player_losses', 1)
      pipeline.hincrby(dailyKey, 'games_finished', 1)
      pipeline.hincrby(dailyKey, won ? 'player_wins' : 'player_losses', 1)
    }

    await pipeline.exec()
    return response.status(204).end()
  } catch (error) {
    console.error('Redis analytics failed', error)
    return response.status(503).json({ message: 'Analytics storage unavailable.' })
  }
}

