import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { ShieldCheck } from 'lucide-react'

type ScoreRow = { rank: number; score: number; playedAt: number }
type StoredScore = { score: number; playedAt: number }
type Phase = 'ready' | 'running' | 'finished'
type Winner = 'player' | 'bot' | null

const ENTRY_LAMPORTS = 10_000_000
const receiverAddress = '3aLAsDDF7JBhGGWdENyoFGP36PftRKpufHCN64myPLtN'
const receiverPublicKey = new PublicKey(receiverAddress)
const short = (value: string) => `${value.slice(0, 5)}...${value.slice(-5)}`
const storageKey = (wallet: string) => `dinorun:local-scores:${wallet}`
const SAFE_START_MS = 5_000

function createObstacleCourse(seed: number) {
  let state = seed || 1
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
  const course: number[] = []
  let position = 900
  for (let wave = 0; wave < 500; wave += 1) {
    const triple = random() < 0.2
    course.push(position)
    if (triple) course.push(position + 32, position + 64)
    position += 1_050 + random() * 550
  }
  return course
}

function loadScores(wallet: string): ScoreRow[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(wallet)) ?? '[]') as StoredScore[]
    return parsed
      .filter(row => Number.isFinite(row.score) && Number.isFinite(row.playedAt))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((row, index) => ({ ...row, rank: index + 1 }))
  } catch {
    return []
  }
}

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))
const isRateLimit = (error: unknown) => /429|too many requests|rate.?limit/i.test(error instanceof Error ? error.message : String(error))

async function retryRateLimited<T>(operation: () => Promise<T>) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation() }
    catch (error) {
      lastError = error
      if (!isRateLimit(error) || attempt === 2) throw error
      await wait(700 * (attempt + 1))
    }
  }
  throw lastError
}

async function claimDevnetPayout(wallet: string, entrySignature: string) {
  const response = await fetch('/api/payout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, entrySignature }),
  })
  const text = await response.text()
  let body: { message?: string; payoutSignature?: string; amount?: number }
  try { body = JSON.parse(text) as typeof body }
  catch { throw new Error(`Payout service unavailable (${response.status}).`) }
  if (!response.ok) throw new Error(body.message ?? 'Payout failed.')
  return body
}

export default function SingleplayerDinoGame({ address, localWallet, sendTransaction, connection, onExit }: {
  address: string
  localWallet: Keypair | null
  sendTransaction: (transaction: Transaction, connection: Connection) => Promise<string>
  connection: Connection
  onExit: () => void
}) {
  const [phase, setPhase] = useState<Phase>('ready')
  const [status, setStatus] = useState('Ready to play')
  const [now, setNow] = useState(Date.now())
  const [paying, setPaying] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [leaderboard, setLeaderboard] = useState<ScoreRow[]>([])
  const [seed, setSeed] = useState(0)
  const [startAt, setStartAt] = useState<number | null>(null)
  const [y, setY] = useState(0)
  const [botY, setBotY] = useState(0)
  const [winner, setWinner] = useState<Winner>(null)
  const yRef = useRef(0)
  const velocityRef = useRef(0)
  const botYRef = useRef(0)
  const botVelocityRef = useRef(0)
  const lastFrameRef = useRef(0)
  const finishedRef = useRef(false)
  const entrySignatureRef = useRef('')
  const obstacleCourse = useMemo(() => createObstacleCourse(seed), [seed])

  useEffect(() => { setLeaderboard(loadScores(address)) }, [address])

  const jump = useCallback(() => {
    if (phase === 'running' && yRef.current <= 1) velocityRef.current = 680
  }, [phase])

  const finishGame = useCallback((score: number, raceWinner: Exclude<Winner, null>) => {
    if (finishedRef.current) return
    finishedRef.current = true
    const next = [...loadScores(address), { rank: 0, score: Math.floor(score), playedAt: Date.now() }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((row, index) => ({ ...row, rank: index + 1 }))
    localStorage.setItem(storageKey(address), JSON.stringify(next.map(({ score: savedScore, playedAt }) => ({ score: savedScore, playedAt }))))
    setLeaderboard(next)
    setWinner(raceWinner)
    setPhase('finished')
    if (raceWinner === 'player' && entrySignatureRef.current) {
      const paidEntry = entrySignatureRef.current
      setStatus('You beat the bot! Requesting 0.02 SOL devnet payout...')
      void claimDevnetPayout(address, paidEntry)
        .then(result => setStatus(`2x payout sent: ${short(result.payoutSignature ?? '')}`))
        .catch(error => setStatus(error instanceof Error ? `Payout error: ${error.message}` : 'Payout failed.'))
    } else {
      setStatus('The bot beat you')
    }
  }, [address])

  useEffect(() => {
    if (phase !== 'running' || !startAt) return
    let frame = 0
    lastFrameRef.current = performance.now()
    const tick = (time: number) => {
      const delta = Math.min(0.05, (time - lastFrameRef.current) / 1000)
      lastFrameRef.current = time
      velocityRef.current -= 1900 * delta
      yRef.current = Math.max(0, yRef.current + velocityRef.current * delta)
      if (yRef.current === 0 && velocityRef.current < 0) velocityRef.current = 0
      botVelocityRef.current -= 1900 * delta
      botYRef.current = Math.max(0, botYRef.current + botVelocityRef.current * delta)
      if (botYRef.current === 0 && botVelocityRef.current < 0) botVelocityRef.current = 0

      const current = Date.now()
      const elapsed = current - startAt
      const activeElapsed = Math.max(0, elapsed - SAFE_START_MS)
      const speed = Math.min(0.55, 0.28 + activeElapsed / 180_000)
      const travel = activeElapsed * speed
      const nextObstacle = elapsed >= SAFE_START_MS ? obstacleCourse.find(position => {
        const x = position - travel
        return x > 205 && x < 285
      }) : undefined
      if (nextObstacle !== undefined && botYRef.current <= 1) {
        const botMakesJump = (Math.floor(nextObstacle) + seed * 17) % 7 !== 0
        if (botMakesJump) botVelocityRef.current = 670
      }
      const playerCollision = elapsed >= SAFE_START_MS && obstacleCourse.some(position => {
        const x = position - travel
        return x > 58 && x < 116 && yRef.current < 42
      })
      const botCollision = elapsed >= SAFE_START_MS && obstacleCourse.some(position => {
        const x = position - travel
        return x > 120 && x < 180 && botYRef.current < 42
      })

      setY(yRef.current)
      setBotY(botYRef.current)
      setNow(current)
      if (playerCollision) { finishGame(elapsed, 'bot'); return }
      if (botCollision) { finishGame(elapsed, 'player'); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [finishGame, obstacleCourse, phase, startAt])

  const payEntry = useCallback(async () => {
    if (paying) return
    setPaying(true)
    setPaymentError('')
    try {
      let playerPublicKey: PublicKey
      try { playerPublicKey = new PublicKey(address) }
      catch { throw new Error('The connected wallet returned an invalid public address. Disconnect it, refresh, and reconnect.') }
      const transaction = new Transaction().add(SystemProgram.transfer({
        fromPubkey: playerPublicKey,
        toPubkey: receiverPublicKey,
        lamports: ENTRY_LAMPORTS,
      }))

      let entrySignature: string
      if (localWallet) {
        const latest = await retryRateLimited(() => connection.getLatestBlockhash('confirmed'))
        transaction.feePayer = localWallet.publicKey
        transaction.recentBlockhash = latest.blockhash
        transaction.sign(localWallet)
        const serialized = transaction.serialize()
        entrySignature = await retryRateLimited(() => connection.sendRawTransaction(serialized))
        await retryRateLimited(() => connection.confirmTransaction({ signature: entrySignature, ...latest }, 'confirmed'))
      } else {
        entrySignature = await sendTransaction(transaction, connection)
        await retryRateLimited(() => connection.confirmTransaction(entrySignature, 'confirmed'))
      }

      const started = Date.now()
      entrySignatureRef.current = entrySignature
      setSeed(Math.floor(Math.random() * 10_000) + 1)
      setStartAt(started)
      setNow(started)
      yRef.current = 0
      velocityRef.current = 0
      botYRef.current = 0
      botVelocityRef.current = 0
      finishedRef.current = false
      setY(0)
      setBotY(0)
      setWinner(null)
      setPhase('running')
      setStatus('Run!')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Entry transaction failed.'
      setPaymentError(/base58/i.test(detail)
        ? 'Your wallet returned invalid transaction data. Disconnect the wallet, refresh the page, reconnect, and try again.'
        : isRateLimit(error)
          ? 'Solana devnet is rate-limiting requests (429). Wait a minute and retry, or set VITE_SOLANA_RPC_URL to a dedicated devnet RPC URL.'
          : detail)
      setStatus('Ready to play')
    } finally {
      setPaying(false)
    }
  }, [address, connection, localWallet, paying, sendTransaction])

  const reset = useCallback(() => {
    finishedRef.current = false
    entrySignatureRef.current = ''
    setStartAt(null)
    setY(0)
    setBotY(0)
    setWinner(null)
    setPaymentError('')
    setPhase('ready')
    setStatus('Ready to play')
  }, [])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ArrowUp') {
        event.preventDefault()
        jump()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [jump])

  const elapsed = startAt ? Math.max(0, now - startAt) : 0
  const activeElapsed = Math.max(0, elapsed - SAFE_START_MS)
  const speed = Math.min(0.55, 0.28 + activeElapsed / 180_000)
  const travel = activeElapsed * speed
  const obstacles = elapsed < SAFE_START_MS ? [] : obstacleCourse
    .map(position => ({ position, left: 100 * (position - travel) / 900 }))
    .filter(obstacle => obstacle.left > -8 && obstacle.left < 108)

  return <section className="game-page">
    <div className="game-header"><div><span>2X DEVNET BOT RACE - BUILD V9</span><h1>Dino Run</h1></div><button onClick={onExit}>Leave game</button></div>
    <div className="game-layout">
      <div className="arena-card">
        <div className="arena-top"><span className={`live-pill ${phase}`}><i /> {phase.toUpperCase()}</span><strong>{Math.floor(elapsed / 1000).toString().padStart(3, '0')}M</strong></div>
        <button className="dino-stage" onClick={jump} aria-label="Jump">
          <div className="sky-line" /><div className="ground-line" />
          {obstacles.map(obstacle => <span className="cactus" key={obstacle.position} style={{ left: `${obstacle.left}%` }}><i /><i /><b /></span>)}
          {phase !== 'ready' && <span className="dino" style={{ transform: `translateY(-${y}px)` }}><i className="eye" /><i className="leg one" /><i className="leg two" /></span>}
          {phase !== 'ready' && <><span className="dino bot-dino" style={{ transform: `translateY(-${botY}px)` }}><i className="eye" /><i className="leg one" /><i className="leg two" /></span><span className="bot-label" style={{ transform: `translateY(-${botY}px)` }}>BOT</span></>}
          {phase === 'finished' && <div className="arena-message result"><strong>{winner === 'player' ? 'You beat the bot!' : 'Bot wins'}</strong><span>You ran {Math.floor(elapsed / 1000)} meters</span><button onClick={event => { event.stopPropagation(); reset() }}>Play again</button></div>}
          {phase === 'ready' && <div className="arena-message payment-message"><strong>Race the bot for 2x</strong><span>Pay 0.01 devnet SOL. Beat the bot to receive 0.02.</span><code>Receiver: {short(receiverAddress)}</code>{paymentError && <p>{paymentError}</p>}<button className="join-game-button" disabled={paying} onClick={event => { event.stopPropagation(); payEntry() }}>{paying ? 'CONFIRMING TRANSACTION...' : 'START 2X RACE · 0.01 SOL'}</button><small>Devnet prototype. The browser reports the winner to the payout function.</small></div>}
        </button>
        <div className="controls-note"><span>SPACE / UP ARROW / TAP TO JUMP</span><p>{status}</p></div>
      </div>
      <aside className="players-card"><div className="players-title"><div><span>THIS BROWSER</span><h2>Local high scores</h2></div><i className="online" /></div><div className="leaderboard score-board">{leaderboard.length ? leaderboard.map(row => <div key={`${row.playedAt}-${row.rank}`}><b>#{row.rank}</b><strong>{new Date(row.playedAt).toLocaleDateString()}</strong><em>{Math.floor(row.score / 1000)}m</em></div>) : <p>Finish a run to record your first score.</p>}</div><div className="server-note"><ShieldCheck /><p><strong>Stored locally</strong><span>Scores remain in this browser and are never uploaded.</span></p></div></aside>
    </div>
  </section>
}
