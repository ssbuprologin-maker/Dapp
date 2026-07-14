import { useCallback, useEffect, useRef, useState } from 'react'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { ShieldCheck } from 'lucide-react'

type ScoreRow = { rank: number; score: number; playedAt: number }
type StoredScore = { score: number; playedAt: number }
type Phase = 'ready' | 'running' | 'finished'

const ENTRY_LAMPORTS = 10_000_000
const rawReceiverAddress = String(import.meta.env.VITE_JOIN_FEE_RECEIVER ?? '').trim()
const receiverAddress = rawReceiverAddress
  .replace(/^['"]|['"]$/g, '')
  .replace(/^solana:/i, '')
  .split('?')[0]
  .trim()
const receiverConfig = (() => {
  if (!receiverAddress) return { publicKey: null, error: 'VITE_JOIN_FEE_RECEIVER is not configured.' }
  if (/YOUR_|WALLET_ADDRESS|PUBLIC_ADDRESS/i.test(receiverAddress)) {
    return { publicKey: null, error: 'Replace the placeholder with the public address copied from your devnet wallet.' }
  }
  try {
    const publicKey = new PublicKey(receiverAddress)
    return { publicKey, error: '' }
  } catch {
    return { publicKey: null, error: 'VITE_JOIN_FEE_RECEIVER is invalid. Paste only the public Solana wallet address, without labels or spaces.' }
  }
})()
const short = (value: string) => `${value.slice(0, 5)}...${value.slice(-5)}`
const storageKey = (wallet: string) => `dinorun:local-scores:${wallet}`

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
  const [status, setStatus] = useState(receiverConfig.publicKey ? 'Ready to play' : receiverConfig.error)
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
      const speed = Math.min(0.55, 0.28 + elapsed / 180_000)
      const offsets = [120 + seed % 190, 490 + (seed * 7) % 170, 810 + (seed * 13) % 100]
      const collision = offsets.some(offset => {
        const x = 900 - ((elapsed * speed + offset) % 940)
        return x > 58 && x < 116 && yRef.current < 42
      })

      setY(yRef.current)
      setNow(current)
      if (collision) { finishGame(elapsed); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [finishGame, phase, seed, startAt])

  const payEntry = useCallback(async () => {
    if (paying) return
    setPaying(true)
    setPaymentError('')
    try {
      if (!receiverConfig.publicKey) throw new Error(receiverConfig.error)
      const transaction = new Transaction().add(SystemProgram.transfer({
        fromPubkey: new PublicKey(address),
        toPubkey: receiverConfig.publicKey,
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
      setPaymentError(error instanceof Error ? error.message : 'Entry transaction failed.')
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
    setStatus(receiverConfig.publicKey ? 'Ready to play' : receiverConfig.error)
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
  const speed = Math.min(0.55, 0.28 + elapsed / 180_000)
  const offsets = seed ? [120 + seed % 190, 490 + (seed * 7) % 170, 810 + (seed * 13) % 100] : []
  const obstacles = offsets.map(offset => 100 * (900 - ((elapsed * speed + offset) % 940)) / 900)

  return <section className="game-page">
    <div className="game-header"><div><span>LOCAL SINGLEPLAYER - BUILD V5</span><h1>Dino Run</h1></div><button onClick={onExit}>Leave game</button></div>
    <div className="game-layout">
      <div className="arena-card">
        <div className="arena-top"><span className={`live-pill ${phase}`}><i /> {phase.toUpperCase()}</span><strong>{Math.floor(elapsed / 1000).toString().padStart(3, '0')}M</strong></div>
        <button className="dino-stage" onClick={jump} aria-label="Jump">
          <div className="sky-line" /><div className="ground-line" />
          {obstacles.map((left, index) => <span className="cactus" key={index} style={{ left: `${left}%` }}><i /><i /><b /></span>)}
          {phase !== 'ready' && <span className="dino" style={{ transform: `translateY(-${y}px)` }}><i className="eye" /><i className="leg one" /><i className="leg two" /></span>}
          {phase === 'finished' && <div className="arena-message result"><strong>Game over</strong><span>You ran {Math.floor(elapsed / 1000)} meters</span><button onClick={event => { event.stopPropagation(); reset() }}>Play again</button></div>}
          {phase === 'ready' && <div className="arena-message payment-message"><strong>{receiverConfig.publicKey ? 'Ready to play?' : 'Receiver address required'}</strong><span>Start a local singleplayer run for 0.01 devnet SOL.</span>{receiverConfig.publicKey && <code>Receiver: {short(receiverConfig.publicKey.toBase58())}</code>}{paymentError && <p>{paymentError}</p>}{!receiverConfig.publicKey && <p>{receiverConfig.error}</p>}<button className="join-game-button" disabled={paying || !receiverConfig.publicKey} onClick={event => { event.stopPropagation(); payEntry() }}>{paying ? 'CONFIRMING TRANSACTION...' : 'START PLAYING · 0.01 SOL'}</button><small>No API or database connection is used.</small></div>}
        </button>
        <div className="controls-note"><span>SPACE / UP ARROW / TAP TO JUMP</span><p>{status}</p></div>
      </div>
      <aside className="players-card"><div className="players-title"><div><span>THIS BROWSER</span><h2>Local high scores</h2></div><i className="online" /></div><div className="leaderboard score-board">{leaderboard.length ? leaderboard.map(row => <div key={`${row.playedAt}-${row.rank}`}><b>#{row.rank}</b><strong>{new Date(row.playedAt).toLocaleDateString()}</strong><em>{Math.floor(row.score / 1000)}m</em></div>) : <p>Finish a run to record your first score.</p>}</div><div className="server-note"><ShieldCheck /><p><strong>Stored locally</strong><span>Scores remain in this browser and are never uploaded.</span></p></div></aside>
    </div>
  </section>
}
