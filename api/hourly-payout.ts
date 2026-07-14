import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { requireRedis } from './redis.js'

const HOUR_MS = 60 * 60 * 1000
const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const solana = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed')

const scoresKey = (hour: number) => `dinorun:hour:${hour}:scores`
const poolKey = (hour: number) => `dinorun:hour:${hour}:pool`
const payoutKey = (hour: number) => `dinorun:hour:${hour}:payout`
const lockKey = (hour: number) => `dinorun:hour:${hour}:payout-lock`

type PayoutRecord = {
  state: 'sending' | 'confirmed'
  signature: string
  winner: string
  lamports: number
  createdAt: number
}

function loadPayoutWallet() {
  const raw = process.env.PAYOUT_WALLET_SECRET_KEY
  if (!raw) throw new Error('PAYOUT_WALLET_SECRET_KEY is not configured.')
  let values: unknown
  try { values = JSON.parse(raw) } catch { throw new Error('PAYOUT_WALLET_SECRET_KEY must be a JSON number array.') }
  if (!Array.isArray(values) || values.length !== 64 || values.some(value => !Number.isInteger(value) || Number(value) < 0 || Number(value) > 255)) {
    throw new Error('PAYOUT_WALLET_SECRET_KEY must contain the 64 secret-key bytes.')
  }
  return Keypair.fromSecretKey(Uint8Array.from(values as number[]))
}

async function settleHour(hour: number) {
  const redis = requireRedis()
  const authority = loadPayoutWallet()
  const receiver = new PublicKey(process.env.JOIN_FEE_RECEIVER ?? '')
  if (!authority.publicKey.equals(receiver)) throw new Error('The payout key does not match JOIN_FEE_RECEIVER.')
  if (await solana.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Hourly payouts are locked to Solana devnet.')

  const existing = await redis.get<PayoutRecord>(payoutKey(hour))
  if (existing) {
    if (existing.state === 'confirmed') return { alreadyPaid: true, ...existing }
    const chainStatus = (await solana.getSignatureStatuses([existing.signature], { searchTransactionHistory: true })).value[0]
    if (chainStatus && !chainStatus.err && (chainStatus.confirmationStatus === 'confirmed' || chainStatus.confirmationStatus === 'finalized')) {
      const confirmed = { ...existing, state: 'confirmed' as const }
      await redis.set(payoutKey(hour), confirmed, { ex: 60 * 60 * 24 * 90 })
      return { alreadyPaid: true, ...confirmed }
    }
    if (!chainStatus?.err && Date.now() - existing.createdAt < 3 * 60_000) return { pending: true, ...existing }
    await redis.del(payoutKey(hour))
  }

  const lock = await redis.set(lockKey(hour), String(Date.now()), { ex: 300, nx: true })
  if (!lock) return { pending: true, message: 'Another payout invocation owns the lock.' }
  try {
    const [winner] = await redis.zrange<string[]>(scoresKey(hour), 0, 0, { rev: true })
    const lamports = Number(await redis.get<number>(poolKey(hour)) ?? 0)
    if (!winner || lamports <= 0) return { skipped: true, message: 'This hour has no paid entries.' }
    const winnerKey = new PublicKey(winner)
    const balance = await solana.getBalance(authority.publicKey, 'confirmed')
    if (balance < lamports + 5_000) throw new Error('The payout wallet needs the tracked pool plus a small devnet transaction-fee buffer.')

    const latest = await solana.getLatestBlockhash('confirmed')
    const transaction = new Transaction({ feePayer: authority.publicKey, recentBlockhash: latest.blockhash }).add(
      SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: winnerKey, lamports }),
    )
    transaction.sign(authority)
    const signature = bs58.encode(transaction.signature!)
    const record: PayoutRecord = { state: 'sending', signature, winner, lamports, createdAt: Date.now() }
    await redis.set(payoutKey(hour), record, { ex: 60 * 60 * 24 * 90 })
    await solana.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 })
    await solana.confirmTransaction({ signature, ...latest }, 'confirmed')
    const confirmed = { ...record, state: 'confirmed' as const }
    await redis.set(payoutKey(hour), confirmed, { ex: 60 * 60 * 24 * 90 })
    return confirmed
  } finally {
    await redis.del(lockKey(hour))
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'GET') return response.status(405).json({ message: 'Method not allowed.' })
  if (!process.env.CRON_SECRET || request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return response.status(401).json({ message: 'Unauthorized.' })
  }
  try {
    const previousHour = Math.floor(Date.now() / HOUR_MS) - 1
    return response.status(200).json({ hour: previousHour, result: await settleHour(previousHour) })
  } catch (error) {
    console.error('Hourly payout failed', error)
    return response.status(500).json({ message: error instanceof Error ? error.message : 'Hourly payout failed.' })
  }
}
