import type { VercelRequest, VercelResponse } from '@vercel/node'
import { randomUUID } from 'node:crypto'
import { Connection, PublicKey } from '@solana/web3.js'
import { redis, requireRedis } from './redis.js'

const JOIN_FEE_LAMPORTS = 10_000_000
const ALL_TIME_LEADERBOARD_KEY = 'dinorun:leaderboard:scores:v1'
const HOUR_MS = 60 * 60 * 1000
const solana = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed')
const feeReceiver = process.env.JOIN_FEE_RECEIVER ?? ''
const whitelist = new Set((process.env.PLAYER_WHITELIST ?? '').split(',').map(value => value.trim()).filter(Boolean))
const allowAll = process.env.ALLOW_ALL_PLAYERS === 'true'

type LeaderboardRow = { rank: number; wallet: string; score: number }

const hourId = (timestamp = Date.now()) => Math.floor(timestamp / HOUR_MS)
const hourlyScoresKey = (hour: number) => `dinorun:hour:${hour}:scores`
const hourlyPoolKey = (hour: number) => `dinorun:hour:${hour}:pool`

async function getLeaderboard(hour = hourId()): Promise<LeaderboardRow[]> {
  if (!redis) return []
  const rows = await redis.zrange<(string | number)[]>(hourlyScoresKey(hour), 0, 9, { rev: true, withScores: true })
  const result: LeaderboardRow[] = []
  for (let index = 0; index < rows.length; index += 2) {
    result.push({ rank: result.length + 1, wallet: String(rows[index]), score: Number(rows[index + 1]) })
  }
  return result
}

function requireConfigured() {
  requireRedis()
  if (!feeReceiver) throw new Error('JOIN_FEE_RECEIVER is not configured on Vercel.')
  new PublicKey(feeReceiver)
}

async function verifyPayment(wallet: string, signature: string) {
  requireConfigured()
  const player = new PublicKey(wallet)
  if (!allowAll && !whitelist.has(wallet)) throw new Error('This wallet is not whitelisted.')
  const balance = await solana.getBalance(player, 'confirmed')
  if (balance < 5_000) throw new Error('The wallet needs enough devnet SOL for the network fee.')

  const signatureKey = `dinorun:payment:${signature}`
  if (await redis!.exists(signatureKey)) throw new Error('This transaction was already used.')
  let transaction = await solana.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  for (let attempt = 0; !transaction && attempt < 8; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 700))
    transaction = await solana.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  }
  if (!transaction || transaction.meta?.err) throw new Error('The entry transaction is not confirmed.')
  if (!transaction.blockTime || transaction.blockTime * 1000 < Date.now() - 15 * 60_000) throw new Error('The entry transaction is too old.')

  const validTransfer = transaction.transaction.message.instructions.some(instruction => {
    if (!('parsed' in instruction)) return false
    const parsed = instruction.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } }
    return parsed.type === 'transfer' && parsed.info?.source === wallet && parsed.info?.destination === feeReceiver && Number(parsed.info?.lamports) >= JOIN_FEE_LAMPORTS
  })
  if (!validTransfer) throw new Error('The transaction does not contain the required 0.01 SOL entry transfer.')

  const token = randomUUID()
  const startAt = Date.now()
  const seed = Math.floor(Math.random() * 10_000) + 1
  const hour = hourId(startAt)
  const pool = await redis!.eval<string[], number>(
    `if redis.call('exists', KEYS[1]) == 1 then return -1 end
     redis.call('set', KEYS[1], ARGV[1])
     redis.call('set', KEYS[2], ARGV[2], 'EX', 3600)
     local total = redis.call('incrby', KEYS[3], ARGV[3])
     redis.call('zadd', KEYS[4], 'NX', 0, ARGV[1])
     redis.call('expire', KEYS[3], 2592000)
     redis.call('expire', KEYS[4], 2592000)
     return total`,
    [signatureKey, `dinorun:run:${token}`, hourlyPoolKey(hour), hourlyScoresKey(hour)],
    [wallet, JSON.stringify({ wallet, startAt, seed, hour }), String(JOIN_FEE_LAMPORTS)],
  )
  if (Number(pool) < 0) throw new Error('This transaction was already used.')
  return { token, startAt, seed, poolLamports: Number(pool) }
}

async function submitScore(wallet: string, token: string, requestedScore: number) {
  const database = requireRedis()
  const key = `dinorun:run:${token}`
  const raw = await database.get<string>(key)
  if (!raw) throw new Error('This run expired or was already submitted.')
  const run = JSON.parse(raw) as { wallet: string; startAt: number; hour: number }
  if (run.wallet !== wallet) throw new Error('This run belongs to another wallet.')
  const score = Math.floor(requestedScore)
  const elapsed = Date.now() - run.startAt
  if (!Number.isFinite(score) || score < 0 || score > elapsed + 2_000 || score > 3_600_000) throw new Error('The submitted score is invalid.')

  const consumed = await database.del(key)
  if (!consumed) throw new Error('This run was already submitted.')
  await database.multi()
    .zadd(ALL_TIME_LEADERBOARD_KEY, { gt: true }, { score, member: wallet })
    .zadd(hourlyScoresKey(run.hour), { gt: true }, { score, member: wallet })
    .exec()
  return getLeaderboard(run.hour)
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    if (request.method === 'GET') {
      requireConfigured()
      const hour = hourId()
      return response.status(200).json({
        recipient: feeReceiver,
        lamports: JOIN_FEE_LAMPORTS,
        leaderboard: await getLeaderboard(hour),
        poolLamports: Number(await redis!.get<number>(hourlyPoolKey(hour)) ?? 0),
        periodEndsAt: (hour + 1) * HOUR_MS,
        build: 'singleplayer-hourly-v2',
      })
    }
    if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })

    const { action, wallet, signature, token, score } = request.body ?? {}
    if (typeof wallet !== 'string') throw new Error('A wallet address is required.')
    new PublicKey(wallet)
    if (action === 'verify-payment') {
      if (typeof signature !== 'string') throw new Error('A transaction signature is required.')
      return response.status(200).json(await verifyPayment(wallet, signature))
    }
    if (action === 'submit-score') {
      if (typeof token !== 'string' || typeof score !== 'number') throw new Error('A run token and score are required.')
      return response.status(200).json({ leaderboard: await submitScore(wallet, token, score) })
    }
    return response.status(400).json({ message: 'Unknown action.' })
  } catch (error) {
    console.error('Game API error', error)
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Game request failed.' })
  }
}
