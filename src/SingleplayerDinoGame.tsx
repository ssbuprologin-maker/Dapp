import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { ShieldCheck } from 'lucide-react'

type ScoreRow = { rank: number; score: number; playedAt: number }
type StoredScore = { score: number; playedAt: number }
type Phase = 'ready' | 'running' | 'finished'

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
  const yRef = useRef(0)
  const velocityRef = useRef(0)
  const lastFrameRef = useRef(0)
  const finishedRef = useRef(false)
  const obstacleCourse = useMemo(() => createObstacleCourse(seed), [seed])

  useEffect(() => { setLeaderboard(loadScores(address)) }, [address])

  const jump = useCallback(() => {
    if (phase === 'running' && yRef.current <= 1) velocityRef.current = 680
  }, [phase])

  const finishGame = useCallback((score: number) => {
    if (finishedRef.current) return
    finishedRef.current = true
    const next = [...loadScores(address), { rank: 0, score: Math.floor(score), playedAt: Date.now() }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((row, index) => ({ ...row, rank: index + 1 }))
    localStorage.setItem(storageKey(address), JSON.stringify(next.map(({ score: savedScore, playedAt }) => ({ score: savedScore, playedAt }))))
    setLeaderboard(next)
    setPhase('finished')
    setStatus('High score saved on this device')
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

      const current = Date.now()
      const elapsed = current - startAt
      const activeElapsed = Math.max(0, elapsed - SAFE_START_MS)
      const speed = Math.min(0.55, 0.28 + activeElapsed / 180_000)
      const travel = activeElapsed * speed
      const collision = elapsed >= SAFE_START_MS && obstacleCourse.some(position => {
        const x = position - travel
        return x > 58 && x < 116 && yRef.current < 42
      })

      setY(yRef.current)
      setNow(current)
      if (collision) { finishGame(elapsed); return }
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

      if (localWallet) {
        const latest = await connection.getLatestBlockhash('confirmed')
        transaction.feePayer = localWallet.publicKey
        transaction.recentBlockhash = latest.blockhash
        transaction.sign(localWallet)
        const signature = await connection.sendRawTransaction(transaction.serialize())
        await connection.confirmTransaction({ signature, ...latest }, 'confirmed')
      } else {
        const signature = await sendTransaction(transaction, connection)
        await connection.confirmTransaction(signature, 'confirmed')
      }

      const started = Date.now()
      setSeed(Math.floor(Math.random() * 10_000) + 1)
      setStartAt(started)
      setNow(started)
      yRef.current = 0
      velocityRef.current = 0
      finishedRef.current = false
      setY(0)
      setPhase('running')
      setStatus('Run!')
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Entry transaction failed.'
      setPaymentError(/base58/i.test(detail) ? 'Your wallet returned invalid transaction data. Disconnect the wallet, refresh the page, reconnect, and try again.' : detail)
      setStatus('Ready to play')
    } finally {
      setPaying(false)
    }
  }, [address, connection, localWallet, paying, sendTransaction])

  const reset = useCallback(() => {
    finishedRef.current = false
    setStartAt(null)
    setY(0)
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
    <div className="game-header"><div><span>LOCAL SINGLEPLAYER - BUILD V7</span><h1>Dino Run</h1></div><button onClick={onExit}>Leave game</button></div>
    <div className="game-layout">
      <div className="arena-card">
        <div className="arena-top"><span className={`live-pill ${phase}`}><i /> {phase.toUpperCase()}</span><strong>{Math.floor(elapsed / 1000).toString().padStart(3, '0')}M</strong></div>
        <button className="dino-stage" onClick={jump} aria-label="Jump">
          <div className="sky-line" /><div className="ground-line" />
          {obstacles.map(obstacle => <span className="cactus" key={obstacle.position} style={{ left: `${obstacle.left}%` }}><i /><i /><b /></span>)}
          {phase !== 'ready' && <span className="dino" style={{ transform: `translateY(-${y}px)` }}><i className="eye" /><i className="leg one" /><i className="leg two" /></span>}
          {phase === 'finished' && <div className="arena-message result"><strong>Game over</strong><span>You ran {Math.floor(elapsed / 1000)} meters</span><button onClick={event => { event.stopPropagation(); reset() }}>Play again</button></div>}
          {phase === 'ready' && <div className="arena-message payment-message"><strong>Ready to play?</strong><span>Start a local singleplayer run for 0.01 devnet SOL.</span><code>Receiver: {short(receiverAddress)}</code>{paymentError && <p>{paymentError}</p>}<button className="join-game-button" disabled={paying} onClick={event => { event.stopPropagation(); payEntry() }}>{paying ? 'CONFIRMING TRANSACTION...' : 'START PLAYING · 0.01 SOL'}</button><small>No API or database connection is used.</small></div>}
        </button>
        <div className="controls-note"><span>SPACE / UP ARROW / TAP TO JUMP</span><p>{status}</p></div>
      </div>
      <aside className="players-card"><div className="players-title"><div><span>THIS BROWSER</span><h2>Local high scores</h2></div><i className="online" /></div><div className="leaderboard score-board">{leaderboard.length ? leaderboard.map(row => <div key={`${row.playedAt}-${row.rank}`}><b>#{row.rank}</b><strong>{new Date(row.playedAt).toLocaleDateString()}</strong><em>{Math.floor(row.score / 1000)}m</em></div>) : <p>Finish a run to record your first score.</p>}</div><div className="server-note"><ShieldCheck /><p><strong>Stored locally</strong><span>Scores remain in this browser and are never uploaded.</span></p></div></aside>
    </div>
  </section>
}
