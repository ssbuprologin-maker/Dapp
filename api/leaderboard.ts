import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { Connection, PublicKey } from '@solana/web3.js'

const LEADERBOARD_KEY = 'testnet-games:leaderboard:v1'
const GAME_HISTORY_KEY = 'testnet-games:game-history:v1'
const SOLANA_RECEIVER = '3aLAsDDF7JBhGGWdENyoFGP36PftRKpufHCN64myPLtN'
const MEGAETH_RECEIVER = '0x4caf2b570acf0600810fec32373880fc8b94aa18'
const SOLANA_ENTRY_LAMPORTS = 10_000_000
const MEGAETH_ENTRY_WEI = 10_000_000_000_000_000n
const MEGAETH_RPC_URL = 'https://carrot.megaeth.com/rpc'

type Network = 'solana' | 'megaeth'
type LeaderboardRecord = {
  score: number
  playedAt: number
  playedAtUtc: string
  won: boolean
  transaction: string
  network: Network
  wallet: string
  walletAddress?: string
}

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Worldwide leaderboard is not configured. Add the Upstash Redis REST variables in Vercel.')
  return new Redis({ url, token, automaticDeserialization: false })
}

function profileRedisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim()
  return new Redis({ url, token })
}

const solanaConnections = [...new Set([
  process.env.SOLANA_RPC_URL?.trim(),
  'https://solana-devnet.gateway.tatum.io',
  'https://api.devnet.solana.com',
].filter(Boolean) as string[])].map(endpoint => new Connection(endpoint, 'confirmed'))

async function verifySolanaEntry(wallet: string, signature: string) {
  const player = new PublicKey(wallet).toBase58()
  let transaction = null
  let lastError: unknown
  for (let round = 0; round < 3 && !transaction; round += 1) {
    for (const connection of solanaConnections) {
      try {
        transaction = await connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
        if (transaction) break
      } catch (error) { lastError = error }
    }
    if (!transaction && round < 2) await new Promise(resolve => setTimeout(resolve, 700 * (round + 1)))
  }
  if (!transaction) throw lastError instanceof Error ? lastError : new Error('The Solana entry transaction was not found.')
  if (transaction.meta?.err) throw new Error('The Solana entry transaction failed.')
  if (!transaction.blockTime || transaction.blockTime * 1000 < Date.now() - 30 * 60_000) throw new Error('The Solana entry transaction is too old.')
  const valid = transaction.transaction.message.instructions.some(instruction => {
    if (!('parsed' in instruction)) return false
    const parsed = instruction.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } }
    return parsed.type === 'transfer'
      && parsed.info?.source === player
      && parsed.info?.destination === SOLANA_RECEIVER
      && Number(parsed.info?.lamports) >= SOLANA_ENTRY_LAMPORTS
  })
  if (!valid) throw new Error('This is not a valid 0.01 SOL game entry.')
}

async function megaEthRpc<T>(method: string, params: unknown[]) {
  const response = await fetch(MEGAETH_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await response.json() as { result?: T; error?: { message?: string } }
  if (!response.ok || body.error) throw new Error(body.error?.message ?? `MegaETH RPC returned ${response.status}.`)
  return body.result
}

async function verifyMegaEthEntry(wallet: string, hash: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid EVM wallet address.')
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) throw new Error('Invalid MegaETH transaction hash.')
  const transaction = await megaEthRpc<{ from: string; to: string | null; value: string; blockNumber: string | null }>('eth_getTransactionByHash', [hash])
  const receipt = await megaEthRpc<{ status: string; blockNumber: string }>('eth_getTransactionReceipt', [hash])
  if (!transaction || !receipt || receipt.status !== '0x1') throw new Error('The MegaETH entry transaction is not confirmed.')
  if (transaction.from.toLowerCase() !== wallet.toLowerCase() || transaction.to?.toLowerCase() !== MEGAETH_RECEIVER) {
    throw new Error('The MegaETH entry sender or receiver is incorrect.')
  }
  if (BigInt(transaction.value) < MEGAETH_ENTRY_WEI) throw new Error('This is not a valid 0.01 ETH game entry.')
  const block = await megaEthRpc<{ timestamp: string }>('eth_getBlockByNumber', [receipt.blockNumber, false])
  if (!block || Number(BigInt(block.timestamp)) * 1000 < Date.now() - 30 * 60_000) throw new Error('The MegaETH entry transaction is too old.')
}

function publicWalletLabel(wallet: string) {
  return `${wallet.slice(0, 5)}...${wallet.slice(-4)}`
}

async function readLeaderboard(redis: Redis) {
  const rows = await redis.zrange<string[]>(LEADERBOARD_KEY, 0, 499, { rev: true })
  const seenPlayers = new Set<string>()
  const records = rows.flatMap(row => {
    try {
      const record = JSON.parse(row) as LeaderboardRecord
      const identity = record.walletAddress
        ? `${record.network}:${record.network === 'megaeth' ? record.walletAddress.toLowerCase() : record.walletAddress}`
        : `${record.network}:legacy:${record.wallet}`
      if (seenPlayers.has(identity)) return []
      seenPlayers.add(identity)
      return [{
        ...record,
        playedAtUtc: record.playedAtUtc ?? new Date(record.playedAt).toISOString(),
      }]
    }
    catch { return [] }
  }).slice(0, 50).map((record, index) => ({ ...record, rank: index + 1 }))
  const profileRedis = profileRedisClient()
  return Promise.all(records.map(async record => {
    const { walletAddress, ...publicRecord } = record
    const wallet = walletAddress && (record.network === 'megaeth' ? walletAddress.toLowerCase() : walletAddress)
    const key = wallet
      ? `testnet-games:profile:${record.network}:${wallet}`
      : `testnet-games:profile-label:${record.network}:${record.wallet}`
    const profileValue = await profileRedis.get<{ displayName?: string } | string>(key)
    const displayName = typeof profileValue === 'string' ? profileValue : profileValue?.displayName
    return { ...publicRecord, wallet: displayName || record.wallet, profileWallet: walletAddress }
  }))
}

function belongsToPlayer(record: LeaderboardRecord, network: Network, wallet: string) {
  if (record.network !== network) return false
  if (record.walletAddress) {
    return network === 'megaeth'
      ? record.walletAddress.toLowerCase() === wallet.toLowerCase()
      : record.walletAddress === wallet
  }
  return record.wallet === publicWalletLabel(wallet)
}

async function updatePersonalBest(redis: Redis, record: LeaderboardRecord) {
  const rows = await redis.zrange<string[]>(LEADERBOARD_KEY, 0, 499, { rev: true })
  const playerRows = rows.flatMap(member => {
    try {
      const saved = JSON.parse(member) as LeaderboardRecord
      return belongsToPlayer(saved, record.network, record.walletAddress ?? '') ? [{ member, saved }] : []
    } catch { return [] }
  })
  const previousBest = playerRows.reduce<LeaderboardRecord | null>((best, row) => (
    !best || row.saved.score > best.score ? row.saved : best
  ), null)
  const best = previousBest && previousBest.score >= record.score ? previousBest : record

  // Rebuild this player's entry so legacy duplicate rows are collapsed as soon
  // as that player completes another verified game.
  if (playerRows.length) await redis.zrem(LEADERBOARD_KEY, ...playerRows.map(row => row.member))
  await redis.zadd(LEADERBOARD_KEY, { score: best.score, member: JSON.stringify(best) })
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', request.method === 'GET' ? 'public, max-age=10, s-maxage=10' : 'no-store')
  try {
    const redis = redisClient()
    if (request.method === 'GET') return response.status(200).json({ scores: await readLeaderboard(redis) })
    if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })

    const network = request.body?.network as Network
    const wallet = typeof request.body?.wallet === 'string' ? request.body.wallet.trim() : ''
    const transaction = typeof request.body?.transaction === 'string' ? request.body.transaction.trim() : ''
    const score = Math.floor(Number(request.body?.score))
    const won = request.body?.won === true
    if (network !== 'solana' && network !== 'megaeth') throw new Error('Invalid leaderboard network.')
    if (!Number.isFinite(score) || score < 0 || score > 3_600_000) throw new Error('Invalid leaderboard score.')
    if (!wallet || !transaction) throw new Error('Wallet and entry transaction are required.')

    if (network === 'solana') await verifySolanaEntry(wallet, transaction)
    else await verifyMegaEthEntry(wallet, transaction)

    const usedKey = `testnet-games:leaderboard-entry:${network}:${transaction}`
    const claimed = await redis.set(usedKey, '1', { nx: true })
    if (claimed !== 'OK') throw new Error('This entry transaction already has a worldwide score.')

    const playedAt = Date.now()
    const record: LeaderboardRecord = {
      score,
      playedAt,
      playedAtUtc: new Date(playedAt).toISOString(),
      won,
      transaction,
      network,
      wallet: publicWalletLabel(wallet),
      walletAddress: wallet,
    }
    try {
      // Every verified run belongs in player history, but only a personal best
      // belongs on the worldwide leaderboard.
      await redis.zadd(GAME_HISTORY_KEY, { score: playedAt, member: JSON.stringify(record) })
      await updatePersonalBest(redis, record)
      const total = await redis.zcard(LEADERBOARD_KEY)
      if (total > 500) await redis.zremrangebyrank(LEADERBOARD_KEY, 0, total - 501)
      const historyTotal = await redis.zcard(GAME_HISTORY_KEY)
      if (historyTotal > 5_000) await redis.zremrangebyrank(GAME_HISTORY_KEY, 0, historyTotal - 5_001)
    } catch (error) {
      await redis.zrem(GAME_HISTORY_KEY, JSON.stringify(record))
      await redis.del(usedKey)
      throw error
    }
    return response.status(200).json({ scores: await readLeaderboard(redis) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Leaderboard request failed.'
    return response.status(/not configured/i.test(message) ? 503 : 400).json({ message })
  }
}
