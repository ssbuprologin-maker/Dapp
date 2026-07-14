import { useCallback, useEffect, useRef, useState } from 'react'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { ShieldCheck } from 'lucide-react'

type LeaderboardRow = { rank: number; wallet: string; score: number }
type GameConfig = { recipient: string; lamports: number; leaderboard: LeaderboardRow[] }
type Phase = 'ready' | 'running' | 'finished'

const short = (value: string) => `${value.slice(0, 5)}...${value.slice(-5)}`

export default function SingleplayerDinoGame({ address, localWallet, sendTransaction, connection, onExit }: {
  address: string
  localWallet: Keypair | null
  sendTransaction: (transaction: Transaction, connection: Connection) => Promise<string>
  connection: Connection
  onExit: () => void
}) {
  const [phase, setPhase] = useState<Phase>('ready')
  const [status, setStatus] = useState('Loading leaderboard...')
  const [now, setNow] = useState(Date.now())
  const [config, setConfig] = useState<GameConfig | null>(null)
  const [paying, setPaying] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
  const [seed, setSeed] = useState(0)
  const [startAt, setStartAt] = useState<number | null>(null)
  const [y, setY] = useState(0)
  const gameToken = useRef('')
  const yRef = useRef(0)
  const velocityRef = useRef(0)
  const lastFrameRef = useRef(0)
  const finishedRef = useRef(false)

  const loadGame = useCallback(async () => {
    try {
      const response = await fetch('/api/game')
      const body = await response.json()
      if (!response.ok) throw new Error(body.message ?? 'Could not load game.')
      setConfig(body)
      setLeaderboard(body.leaderboard)
      setStatus('Ready to play')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load game.')
    }
  }, [])

  useEffect(() => { loadGame() }, [loadGame])

  const jump = useCallback(() => {
    if (phase === 'running' && yRef.current <= 1) velocityRef.current = 680
  }, [phase])

  const finishGame = useCallback(async (score: number) => {
    if (finishedRef.current) return
    finishedRef.current = true
    setPhase('finished')
    setStatus('Submitting score...')
    try {
      const response = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit-score', wallet: address, token: gameToken.current, score }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message ?? 'Could not submit score.')
      setLeaderboard(body.leaderboard)
      setStatus('Score saved')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Score could not be saved.')
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
    if (!config || paying) return
    setPaying(true)
    setPaymentError('')
    try {
      const transaction = new Transaction().add(SystemProgram.transfer({
        fromPubkey: new PublicKey(address),
        toPubkey: new PublicKey(config.recipient),
        lamports: config.lamports,
      }))
      let signature: string
      if (localWallet) {
        const latest = await connection.getLatestBlockhash('confirmed')
        transaction.feePayer = localWallet.publicKey
        transaction.recentBlockhash = latest.blockhash
        transaction.sign(localWallet)
        signature = await connection.sendRawTransaction(transaction.serialize())
        await connection.confirmTransaction({ signature, ...latest }, 'confirmed')
      } else {
        signature = await sendTransaction(transaction, connection)
        await connection.confirmTransaction(signature, 'confirmed')
      }

      setStatus('Verifying entry transaction...')
      const response = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-payment', wallet: address, signature }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message ?? 'Payment verification failed.')
      gameToken.current = body.token
      setSeed(body.seed)
      setStartAt(body.startAt)
      setNow(body.startAt)
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
  }, [address, config, connection, localWallet, paying, sendTransaction])

  const reset = useCallback(() => {
    gameToken.current = ''
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
  const speed = Math.min(0.55, 0.28 + elapsed / 180_000)
  const offsets = seed ? [120 + seed % 190, 490 + (seed * 7) % 170, 810 + (seed * 13) % 100] : []
  const obstacles = offsets.map(offset => 100 * (900 - ((elapsed * speed + offset) % 940)) / 900)

  return <section className="game-page">
    <div className="game-header"><div><span>SINGLEPLAYER DEVNET</span><h1>Dino Run</h1></div><button onClick={onExit}>Leave game</button></div>
    <div className="game-layout">
      <div className="arena-card">
        <div className="arena-top"><span className={`live-pill ${phase}`}><i /> {phase.toUpperCase()}</span><strong>{Math.floor(elapsed / 1000).toString().padStart(3, '0')}M</strong></div>
        <button className="dino-stage" onClick={jump} aria-label="Jump">
          <div className="sky-line" /><div className="ground-line" />
          {obstacles.map((left, index) => <span className="cactus" key={index} style={{ left: `${left}%` }}><i /><i /><b /></span>)}
          {phase !== 'ready' && <span className="dino" style={{ transform: `translateY(-${y}px)` }}><i className="eye" /><i className="leg one" /><i className="leg two" /></span>}
          {phase === 'finished' && <div className="arena-message result"><strong>Game over</strong><span>You ran {Math.floor(elapsed / 1000)} meters</span><button onClick={event => { event.stopPropagation(); reset() }}>Play again</button></div>}
          {phase === 'ready' && <div className="arena-message payment-message"><strong>Ready to play?</strong><span>Start a singleplayer run for 0.01 devnet SOL.</span>{config?.recipient && <code>Receiver: {short(config.recipient)}</code>}{paymentError && <p>{paymentError}</p>}<button className="join-game-button" disabled={paying || !config?.recipient} onClick={event => { event.stopPropagation(); payEntry() }}>{paying ? 'CONFIRMING TRANSACTION...' : 'START PLAYING · 0.01 SOL'}</button><small>No multiplayer connection is required.</small></div>}
        </button>
        <div className="controls-note"><span>SPACE / UP ARROW / TAP TO JUMP</span><p>{status}</p></div>
      </div>
      <aside className="players-card"><div className="players-title"><div><span>HIGH SCORES</span><h2>Leaderboard</h2></div><i className={config ? 'online' : ''} /></div><div className="leaderboard score-board">{leaderboard.length ? leaderboard.map(row => <div key={row.wallet}><b>#{row.rank}</b><strong>{row.wallet === address ? 'YOU' : short(row.wallet)}</strong><em>{Math.floor(row.score / 1000)}m</em></div>) : <p>No scores yet. Be the first.</p>}</div><div className="server-note"><ShieldCheck /><p><strong>Redis leaderboard</strong><span>Your best score is saved after each run.</span></p></div></aside>
    </div>
  </section>
}
