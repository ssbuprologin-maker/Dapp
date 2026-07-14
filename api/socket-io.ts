import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Connection, PublicKey } from '@solana/web3.js'
import { createAdapter } from '@socket.io/redis-adapter'
import { Redis } from 'ioredis'
import nacl from 'tweetnacl'
import { Server, Socket } from 'socket.io'

type Phase = 'lobby' | 'countdown' | 'running' | 'finished'
type Player = { wallet: string; alive: boolean; score: number; color: string }
type GameState = {
  phase: Phase
  roundId: string
  startAt: number | null
  seed: number
  players: Player[]
  winner: string | null
}
type Physics = { y: number; velocity: number; lastTick: number; lastSync: number }
type AuthedSocket = Socket & { data: { wallet?: string; authenticated?: boolean; spectator?: boolean; paid?: boolean } }

const httpServer = createServer()
const io = new Server(httpServer, {
  // Vercel routes /api/socket-io/socket.io to this function and strips the
  // function prefix. Inside the function Socket.IO receives /socket.io.
  path: '/socket.io',
  transports: ['websocket'],
  cors: { origin: true, credentials: true },
})

const redisUrl = process.env.REDIS_URL
const redis = redisUrl ? new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false }) : null
if (redisUrl) {
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false })
  const subscriber = publisher.duplicate()
  io.adapter(createAdapter(publisher, subscriber))
}

const STATE_KEY = 'dinorun:game:v1'
const LOCK_KEY = `${STATE_KEY}:lock`
const LEADERBOARD_KEY = 'dinorun:leaderboard:wins:v1'
const JOIN_FEE_LAMPORTS = 10_000_000
const feeReceiver = process.env.JOIN_FEE_RECEIVER ?? ''
const challenges = new Map<string, { value: string; expires: number }>()
const physics = new Map<string, Physics>()
const whitelist = new Set((process.env.PLAYER_WHITELIST ?? '').split(',').map(value => value.trim()).filter(Boolean))
const allowAll = process.env.ALLOW_ALL_PLAYERS === 'true'
const solana = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed')
let memoryState: GameState = freshState()
let memoryLock: Promise<void> = Promise.resolve()
const memoryPaid = new Set<string>()
const memorySignatures = new Set<string>()
const memoryLeaderboard = new Map<string, number>()

function freshState(): GameState {
  return { phase: 'lobby', roundId: randomUUID(), startAt: null, seed: Math.floor(Math.random() * 10_000), players: [], winner: null }
}

async function readState() {
  if (!redis) return memoryState
  const raw = await redis.get(STATE_KEY)
  if (raw) return JSON.parse(raw) as GameState
  const initial = freshState()
  await redis.set(STATE_KEY, JSON.stringify(initial), 'NX')
  return (await redis.get(STATE_KEY).then(value => value ? JSON.parse(value) as GameState : initial))
}

async function mutateState(change: (state: GameState) => void | GameState): Promise<GameState> {
  if (!redis) {
    let release!: () => void
    const prior = memoryLock
    memoryLock = new Promise<void>(resolve => { release = resolve })
    await prior
    try {
      const next = structuredClone(memoryState)
      const result = change(next)
      memoryState = result ? result : next
      return memoryState
    } finally { release() }
  }
  const token = randomUUID()
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const acquired = await redis.set(LOCK_KEY, token, 'PX', 2500, 'NX')
    if (acquired) {
      try {
        const state = await readState()
        const result = change(state)
        const next = result ? result : state
        await redis.set(STATE_KEY, JSON.stringify(next))
        return next
      } finally {
        await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, LOCK_KEY, token)
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20 + attempt * 4))
  }
  throw new Error('Game state is busy.')
}

const publicState = (state: GameState) => ({ ...state, serverTime: Date.now(), redis: Boolean(redis) })
const broadcastState = async (state?: GameState) => io.to('arena').emit('game_state', publicState(state ?? await readState()))

async function getLeaderboard() {
  if (!redis) return [...memoryLeaderboard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([wallet, wins], index) => ({ rank: index + 1, wallet, wins }))
  const rows = await redis.zrevrange(LEADERBOARD_KEY, 0, 9, 'WITHSCORES')
  const result: { rank: number; wallet: string; wins: number }[] = []
  for (let index = 0; index < rows.length; index += 2) result.push({ rank: result.length + 1, wallet: rows[index], wins: Number(rows[index + 1]) })
  return result
}

async function broadcastLeaderboard() {
  io.to('arena').emit('leaderboard', await getLeaderboard())
}

async function recordWin(wallet: string) {
  if (redis) await redis.zincrby(LEADERBOARD_KEY, 1, wallet)
  else memoryLeaderboard.set(wallet, (memoryLeaderboard.get(wallet) ?? 0) + 1)
  await broadcastLeaderboard()
}

function isObstacleCollision(elapsed: number, seed: number, y: number) {
  const speed = Math.min(0.55, 0.28 + elapsed / 180_000)
  const track = 940
  const offsets = [120 + seed % 190, 490 + (seed * 7) % 170, 810 + (seed * 13) % 100]
  return offsets.some(offset => {
    const x = 900 - ((elapsed * speed + offset) % track)
    return x > 58 && x < 116 && y < 42
  })
}

async function eliminate(wallet: string, score: number) {
  let newWinner: string | null = null
  const state = await mutateState(current => {
    const player = current.players.find(item => item.wallet === wallet)
    if (!player?.alive || current.phase !== 'running') return
    player.alive = false
    player.score = score
    const alive = current.players.filter(item => item.alive)
    if (current.players.length >= 2 && alive.length <= 1) {
      current.phase = 'finished'
      current.winner = alive[0]?.wallet ?? null
      newWinner = current.winner
    }
  })
  io.to('arena').emit('player_eliminated', { wallet, score })
  if (newWinner) await recordWin(newWinner)
  await broadcastState(state)
}

async function addPlayer(socket: AuthedSocket) {
  if (!socket.data.wallet) return
  socket.data.spectator = false
  const state = await mutateState(current => {
    const existing = current.players.find(player => player.wallet === socket.data.wallet)
    if (existing) { existing.alive = true; existing.score = 0 }
    else current.players.push({ wallet: socket.data.wallet!, alive: true, score: 0, color: `hsl(${Math.abs(socket.data.wallet!.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 360} 80% 62%)` })
    if (current.players.length >= 2 && current.phase === 'lobby') { current.phase = 'countdown'; current.startAt = Date.now() + 8_000 }
  })
  socket.data.paid = true
  socket.emit('admitted', { roundId: state.roundId })
  await broadcastState(state)
  await broadcastLeaderboard()
}

async function requirePaymentOrAdmit(socket: AuthedSocket) {
  if (!socket.data.wallet) return
  const state = await readState()
  if (state.phase === 'running' || state.phase === 'finished') {
    socket.data.spectator = true
    socket.emit('admitted', { spectator: true, roundId: state.roundId })
    await broadcastState(state)
    await broadcastLeaderboard()
    return
  }
  const paidKey = `${STATE_KEY}:paid:${state.roundId}:${socket.data.wallet}`
  const paid = redis ? Boolean(await redis.exists(paidKey)) : memoryPaid.has(paidKey)
  if (paid) return addPlayer(socket)
  if (!feeReceiver) return socket.emit('payment_error', { message: 'JOIN_FEE_RECEIVER is not configured on the server.' })
  socket.emit('payment_required', { roundId: state.roundId, recipient: feeReceiver, lamports: JOIN_FEE_LAMPORTS })
}

async function verifyAndStorePayment(socket: AuthedSocket, signature: string) {
  if (!socket.data.wallet || !feeReceiver) throw new Error('Entry payment is not configured.')
  const state = await readState()
  if (state.phase !== 'lobby' && state.phase !== 'countdown') throw new Error('This round already started. You can spectate for free.')
  const signatureKey = `${STATE_KEY}:signature:${signature}`
  if (redis ? await redis.exists(signatureKey) : memorySignatures.has(signatureKey)) throw new Error('This transaction was already used.')
  let transaction = await solana.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  for (let attempt = 0; !transaction && attempt < 8; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 800))
    transaction = await solana.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  }
  if (!transaction || transaction.meta?.err) throw new Error('The entry transaction is not confirmed.')
  if (!transaction.blockTime || transaction.blockTime * 1000 < Date.now() - 15 * 60_000) throw new Error('The entry transaction is too old.')
  const transfer = transaction.transaction.message.instructions.find(instruction => {
    if (!('parsed' in instruction)) return false
    const parsed = instruction.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } }
    return parsed.type === 'transfer' && parsed.info?.source === socket.data.wallet && parsed.info?.destination === feeReceiver && Number(parsed.info?.lamports) >= JOIN_FEE_LAMPORTS
  })
  if (!transfer) throw new Error('The transaction does not contain the required 0.01 SOL entry transfer.')
  const paidKey = `${STATE_KEY}:paid:${state.roundId}:${socket.data.wallet}`
  if (redis) {
    const accepted = await redis.set(signatureKey, socket.data.wallet, 'NX')
    if (!accepted) throw new Error('This transaction was already used.')
    await redis.set(paidKey, signature)
  } else {
    if (memorySignatures.has(signatureKey)) throw new Error('This transaction was already used.')
    memorySignatures.add(signatureKey)
    memoryPaid.add(paidKey)
  }
  await addPlayer(socket)
}

io.on('connection', (socket: AuthedSocket) => {
  const challenge = randomUUID()
  challenges.set(socket.id, { value: challenge, expires: Date.now() + 60_000 })
  socket.emit('auth_challenge', { challenge, message: `Dino Run authentication\n${challenge}` })

  socket.on('authenticate', async (payload: { wallet?: string; signature?: string }) => {
    try {
      const pending = challenges.get(socket.id)
      if (!pending || pending.expires < Date.now() || !payload.wallet || !payload.signature) throw new Error('Authentication challenge expired.')
      if (!allowAll && !whitelist.has(payload.wallet)) throw new Error('This wallet is not whitelisted.')
      const message = new TextEncoder().encode(`Dino Run authentication\n${pending.value}`)
      const valid = nacl.sign.detached.verify(message, Buffer.from(payload.signature, 'base64'), new PublicKey(payload.wallet).toBytes())
      if (!valid) throw new Error('Wallet signature is invalid.')
      const balance = await solana.getBalance(new PublicKey(payload.wallet), 'confirmed')
      if (balance < JOIN_FEE_LAMPORTS + 5_000) throw new Error('At least 0.01 devnet SOL plus the network fee is required.')
      challenges.delete(socket.id)
      socket.data.wallet = payload.wallet
      socket.data.authenticated = true
      socket.join('arena')
      socket.emit('authenticated', { wallet: payload.wallet })
      await requirePaymentOrAdmit(socket)
    } catch (error) {
      socket.emit('auth_error', { message: error instanceof Error ? error.message : 'Authentication failed.' })
    }
  })

  socket.on('submit_payment', async ({ signature }: { signature?: string }) => {
    try {
      if (!socket.data.authenticated || !signature) throw new Error('Authenticate before submitting payment.')
      await verifyAndStorePayment(socket, signature)
    } catch (error) { socket.emit('payment_error', { message: error instanceof Error ? error.message : 'Payment verification failed.' }) }
  })

  socket.on('jump', async () => {
    if (!socket.data.authenticated || !socket.data.paid || socket.data.spectator) return
    const state = await readState()
    const player = state.players.find(item => item.wallet === socket.data.wallet)
    const body = physics.get(socket.id)
    if (state.phase === 'running' && player?.alive && body && body.y <= 1) body.velocity = 680
  })

  socket.on('play_again', async () => {
    if (!socket.data.authenticated || !socket.data.wallet) return
    socket.data.spectator = false
    socket.data.paid = false
    physics.delete(socket.id)
    const state = await mutateState(current => {
      if (current.phase === 'finished') return freshState()
      return current
    })
    await broadcastState(state)
    await requirePaymentOrAdmit(socket)
  })

  socket.on('disconnect', async () => {
    challenges.delete(socket.id)
    physics.delete(socket.id)
    if (socket.data.wallet) {
      const state = await readState()
      if (state.phase === 'running') await eliminate(socket.data.wallet, Math.max(0, Date.now() - (state.startAt ?? Date.now())))
    }
  })
})

setInterval(async () => {
  try {
    let state = await readState()
    if (state.phase === 'countdown' && state.startAt && Date.now() >= state.startAt) {
      state = await mutateState(current => { if (current.phase === 'countdown') current.phase = 'running' })
      await broadcastState(state)
    }
    if (state.phase !== 'running' || !state.startAt) return
    const now = Date.now()
    for (const socket of io.sockets.sockets.values() as IterableIterator<AuthedSocket>) {
      const wallet = socket.data.wallet
      const player = state.players.find(item => item.wallet === wallet)
      if (!wallet || !player?.alive || socket.data.spectator) continue
      const body = physics.get(socket.id) ?? { y: 0, velocity: 0, lastTick: now, lastSync: 0 }
      const delta = Math.min(0.05, (now - body.lastTick) / 1000)
      body.lastTick = now
      body.velocity -= 1900 * delta
      body.y = Math.max(0, body.y + body.velocity * delta)
      if (body.y === 0 && body.velocity < 0) body.velocity = 0
      physics.set(socket.id, body)
      const elapsed = now - state.startAt
      if (isObstacleCollision(elapsed, state.seed, body.y)) await eliminate(wallet, elapsed)
      else if (now - body.lastSync > 80) {
        body.lastSync = now
        io.to('arena').emit('player_sync', { wallet, y: body.y, score: elapsed, at: now })
      }
    }
  } catch (error) { console.error('Dino Run tick failed', error) }
}, 32)

export default httpServer
