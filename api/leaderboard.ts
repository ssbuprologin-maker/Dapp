import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { Connection, PublicKey } from '@solana/web3.js'

const LEADERBOARD_KEY = 'testnet-games:leaderboard:v1'
const GAME_HISTORY_KEY = 'testnet-games:game-history:v1'
const TOTAL_BETS_KEY = 'testnet-games:verified-bets:v1'
const TOTAL_BETS_MIGRATION_KEY = 'testnet-games:verified-bets-migrated:v1'
const SOLANA_RECEIVER = '3aLAsDDF7JBhGGWdENyoFGP36PftRKpufHCN64myPLtN'
const MEGAETH_RECEIVER = '0x4caf2b570acf0600810fec32373880fc8b94aa18'
const SOLANA_ENTRY_LAMPORTS = 10_000_000
const MEGAETH_ENTRY_WEI = 10_000_000_000_000_000n
const MEGAETH_RPC_URL = 'https://carrot.megaeth.com/rpc'
const PRICE_HIGH_WATER_KEY = 'testnet-games:xp-usd-high-water:v1'
const DINO_TOKENS_LEADERBOARD_KEY = 'testnet-games:dino-tokens:v1'
const ENTRY_ASSET_AMOUNT = 0.01
const MICROSOL = 1_000_000
const MICROUSD = 1_000_000

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
  xp?: number
  wagerEquivalentSol?: number
  level?: number
}

type PlayerLeaderboardState = {
  playerRows: { member: string; saved: LeaderboardRecord }[]
  previousBest: LeaderboardRecord | null
}

function requiredSolForLevel(level: number) {
  if (level <= 1) return 0
  if (level > 30) return 450 * 1.06 ** (level - 30)
  const n = level - 1
  const x = n - 1
  return 0.1 * n ** 2 * Math.exp(0.0342 * x + 0.000917 * x ** 2)
}

function levelFromWagerMicrosol(wagerMicrosol: number) {
  const wagerSol = Math.max(0, wagerMicrosol) / MICROSOL
  for (let level = 2; level <= 100; level += 1) {
    if (wagerSol < requiredSolForLevel(level)) return level - 1
  }
  return 100
}

const playerStatsKey = (network: Network, wallet: string) =>
  `testnet-games:player-stats:${network}:${network === 'megaeth' ? wallet.toLowerCase() : wallet}`

async function highWaterUsdPrice(redis: Redis, asset: 'SOL' | 'ETH') {
  let spotPrice = 0
  try {
    const priceResponse = await fetch(`https://api.coinbase.com/v2/prices/${asset}-USD/spot`, {
      headers: { Accept: 'application/json', 'User-Agent': 'testnet-games-vercel/1.0' },
      signal: AbortSignal.timeout(4_000),
    })
    const priceBody = await priceResponse.json() as { data?: { amount?: string } }
    spotPrice = Number(priceBody.data?.amount)
    if (!priceResponse.ok || !Number.isFinite(spotPrice) || spotPrice <= 0) spotPrice = 0
  } catch { /* The last stored high-water price remains usable. */ }

  // This Lua update is atomic: simultaneous requests can raise the remembered
  // price, but a lower market quote can never overwrite it.
  const highWaterPrice = Number(await redis.eval(
    `local old=tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '0'); local incoming=tonumber(ARGV[2]) or 0; if incoming>old then redis.call('HSET',KEYS[1],ARGV[1],incoming); return incoming; end; return old`,
    [PRICE_HIGH_WATER_KEY],
    [asset, String(spotPrice)],
  ))
  return highWaterPrice
}

async function entryEquivalentMicrosol(redis: Redis, network: Network) {
  if (network === 'solana') return Math.round(ENTRY_ASSET_AMOUNT * MICROSOL)
  const [ethUsd, solUsd] = await Promise.all([
    highWaterUsdPrice(redis, 'ETH'),
    highWaterUsdPrice(redis, 'SOL'),
  ])
  // If the public quote service is unavailable before Redis has any saved
  // quotes, give the ETH entry the same minimum progress as a SOL entry.
  if (ethUsd <= 0 || solUsd <= 0) return Math.round(ENTRY_ASSET_AMOUNT * MICROSOL)
  const currentRatio = ethUsd / solUsd
  const highWaterRatio = Number(await redis.eval(
    `local old=tonumber(redis.call('HGET',KEYS[1],ARGV[1]) or '0'); local incoming=tonumber(ARGV[2]) or 0; if incoming>old then redis.call('HSET',KEYS[1],ARGV[1],incoming); return incoming; end; return old`,
    [PRICE_HIGH_WATER_KEY],
    ['ETH_SOL_RATIO', String(currentRatio)],
  ))
  return Math.max(1, Math.round(ENTRY_ASSET_AMOUNT * highWaterRatio * MICROSOL))
}

// DT is denominated in USD at the moment a verified entry is recorded. We use
// the same high-water quote policy as progression, so a later price drop never
// removes already-earned value.
async function entryUsdWagerMicros(redis: Redis, network: Network) {
  const asset = network === 'solana' ? 'SOL' : 'ETH'
  const usd = await highWaterUsdPrice(redis, asset)
  return Math.max(1, Math.round(ENTRY_ASSET_AMOUNT * Math.max(usd, 1) * MICROUSD))
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
        wagerEquivalentSol: record.wagerEquivalentSol ?? 0,
        level: record.wagerEquivalentSol === undefined ? 1 : record.level ?? 1,
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

async function readTotalBets(redis: Redis) {
  // Backfill accepted entries that predate the global counter. The set makes
  // this safe to retry and keeps one bet per verified transaction forever.
  if (!await redis.get(TOTAL_BETS_MIGRATION_KEY)) {
    const history = await redis.zrange<string[]>(GAME_HISTORY_KEY, 0, -1)
    const entries = history.flatMap(member => {
      try {
        const record = JSON.parse(member) as LeaderboardRecord
        return record.transaction && (record.network === 'solana' || record.network === 'megaeth')
          ? [`${record.network}:${record.transaction.toLowerCase()}`]
          : []
      } catch { return [] }
    })
    const [firstEntry, ...remainingEntries] = entries
    if (firstEntry) await redis.sadd(TOTAL_BETS_KEY, firstEntry, ...remainingEntries)
    await redis.set(TOTAL_BETS_MIGRATION_KEY, '1', { nx: true })
  }
  return Number(await redis.scard(TOTAL_BETS_KEY))
}

async function leaderboardResponse(redis: Redis) {
  const [scores, totalBets] = await Promise.all([readLeaderboard(redis), readTotalBets(redis)])
  return { scores, totalBets }
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

async function readPlayerLeaderboardState(redis: Redis, record: LeaderboardRecord): Promise<PlayerLeaderboardState> {
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
  return { playerRows, previousBest }
}

async function awardProgression(redis: Redis, record: LeaderboardRecord, isNewPersonalBest: boolean) {
  const survivalSeconds = Math.floor(record.score / 1000)
  const [entryMicrosol, entryWagerUsdMicros] = await Promise.all([
    entryEquivalentMicrosol(redis, record.network), entryUsdWagerMicros(redis, record.network),
  ])
  const key = playerStatsKey(record.network, record.walletAddress ?? '')
  const [wagerMicrosol, wagerUsdMicros, dtBonus] = await Promise.all([
    redis.hincrby(key, 'wager_microsol', entryMicrosol),
    redis.hincrby(key, 'wager_usd_micros', entryWagerUsdMicros),
    redis.hget<number>(key, 'dt_bonus'),
  ])
  const dinoTokens = Number(wagerUsdMicros) / MICROUSD + Number(dtBonus ?? 0)
  await Promise.all([
    redis.hincrby(key, 'games', 1),
    redis.hincrby(key, record.won ? 'wins' : 'losses', 1),
    redis.hincrby(key, 'survival_seconds', survivalSeconds),
    redis.hset(key, { last_entry_microsol: entryMicrosol }),
    redis.zadd(DINO_TOKENS_LEADERBOARD_KEY, { score: dinoTokens, member: `${record.network}:${record.walletAddress ?? ''}` }),
    ...(isNewPersonalBest ? [redis.hset(key, { best_score: record.score })] : []),
  ])
  return { wagerMicrosol, level: levelFromWagerMicrosol(wagerMicrosol) }
}

async function updatePersonalBest(redis: Redis, record: LeaderboardRecord, state: PlayerLeaderboardState) {
  const bestResult = state.previousBest && state.previousBest.score >= record.score ? state.previousBest : record
  const best = { ...bestResult, wagerEquivalentSol: record.wagerEquivalentSol, level: record.level }

  // Rebuild this player's entry so legacy duplicate rows are collapsed as soon
  // as that player completes another verified game.
  if (state.playerRows.length) await redis.zrem(LEADERBOARD_KEY, ...state.playerRows.map(row => row.member))
  await redis.zadd(LEADERBOARD_KEY, { score: best.score, member: JSON.stringify(best) })
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', request.method === 'GET' ? 'public, max-age=10, s-maxage=10' : 'no-store')
  try {
    const redis = redisClient()
    if (request.method === 'GET') return response.status(200).json(await leaderboardResponse(redis))
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

    // A Redis set is the durable counter: the same on-chain payment can never
    // increase Total Bets twice, even when a browser retries the request.
    await redis.sadd(TOTAL_BETS_KEY, `${network}:${transaction.toLowerCase()}`)

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
    let xpAwarded = false
    try {
      const state = await readPlayerLeaderboardState(redis, record)
      const isNewPersonalBest = !state.previousBest || score > state.previousBest.score
      const progress = await awardProgression(redis, record, isNewPersonalBest)
      xpAwarded = true
      record.wagerEquivalentSol = progress.wagerMicrosol / MICROSOL
      record.level = progress.level
      // Every verified run belongs in player history, but only a personal best
      // belongs on the worldwide leaderboard.
      await redis.zadd(GAME_HISTORY_KEY, { score: playedAt, member: JSON.stringify(record) })
      await updatePersonalBest(redis, record, state)
      const total = await redis.zcard(LEADERBOARD_KEY)
      if (total > 500) await redis.zremrangebyrank(LEADERBOARD_KEY, 0, total - 501)
      const historyTotal = await redis.zcard(GAME_HISTORY_KEY)
      if (historyTotal > 5_000) await redis.zremrangebyrank(GAME_HISTORY_KEY, 0, historyTotal - 5_001)
    } catch (error) {
      await redis.zrem(GAME_HISTORY_KEY, JSON.stringify(record))
      if (!xpAwarded) await redis.del(usedKey)
      throw error
    }
    return response.status(200).json(await leaderboardResponse(redis))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Leaderboard request failed.'
    return response.status(/not configured/i.test(message) ? 503 : 400).json({ message })
  }
}
