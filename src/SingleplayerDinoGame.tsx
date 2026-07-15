import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { ShieldCheck } from 'lucide-react'
import { confirmDevnetSignature, getDevnetBlockhash, sendDevnetRawTransaction } from './solanaRpc'
import { MEGAETH_EXPLORER_URL, MEGAETH_RECEIVER, sendMegaEthEntry } from './megaEth'
import { trackAnalytics } from './analytics'

type PaymentNetwork = 'solana' | 'megaeth'
type ScoreRow = { rank: number; score: number; playedAt: number; won: boolean; transaction?: string; network?: PaymentNetwork; wallet?: string; profileWallet?: string }
type StoredScore = { score: number; playedAt: number; won?: boolean; transaction?: string; network?: PaymentNetwork }
type Phase = 'ready' | 'running' | 'finished'
type Winner = 'player' | 'bot' | null

const ENTRY_LAMPORTS = 10_000_000
const receiverAddress = '3aLAsDDF7JBhGGWdENyoFGP36PftRKpufHCN64myPLtN'
const receiverPublicKey = new PublicKey(receiverAddress)
const short = (value: string) => `${value.slice(0, 5)}...${value.slice(-5)}`
const storageKey = (wallet: string) => `dinorun:local-scores:${wallet}`
const SAFE_START_MS = 5_000
const raceSpeed = (activeElapsed: number) => Math.min(0.72, 0.34 + activeElapsed / 105_000)

function createObstacleCourse(seed: number) {
  let state = seed || 1
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
  const course: number[] = []
  let position = 900
  for (let wave = 0; wave < 500; wave += 1) {
    const triple = random() < 0.3
    course.push(position)
    if (triple) course.push(position + 32, position + 64)
    // A minimum 720-unit gap still leaves enough time to land and jump again,
    // even after the race reaches its maximum speed.
    position += 720 + random() * 400
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
      .map((row, index) => ({
        ...row,
        won: row.won === true,
        transaction: typeof row.transaction === 'string' ? row.transaction : undefined,
        network: row.network === 'solana' || row.network === 'megaeth' ? row.network : undefined,
        rank: index + 1,
      }))
  } catch {
    return []
  }
}

async function worldwideLeaderboard(payload?: {
  wallet: string
  score: number
  won: boolean
  transaction: string
  network: PaymentNetwork
}) {
  const response = await fetch('/api/leaderboard', payload ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  } : undefined)
  const text = await response.text()
  let body: { scores?: ScoreRow[]; message?: string }
  try { body = JSON.parse(text) as typeof body }
  catch { throw new Error(`Leaderboard service unavailable (${response.status}).`) }
  if (!response.ok) throw new Error(body.message ?? 'Worldwide leaderboard unavailable.')
  return Array.isArray(body.scores) ? body.scores : []
}

const isRateLimit = (error: unknown) => /429|too many requests|rate.?limit/i.test(error instanceof Error ? error.message : String(error))

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

export default function SingleplayerDinoGame({ address, paymentNetwork, localWallet, sendTransaction, signTransaction, connection, onViewProfile, onExit }: {
  address: string
  paymentNetwork: PaymentNetwork
  localWallet: Keypair | null
  sendTransaction: (transaction: Transaction, connection: Connection) => Promise<string>
  signTransaction?: (transaction: Transaction) => Promise<Transaction>
  connection: Connection
  onViewProfile: (wallet: string, network: PaymentNetwork) => void
  onExit: () => void
}) {
  const [phase, setPhase] = useState<Phase>('ready')
  const [status, setStatus] = useState('Ready to play')
  const [now, setNow] = useState(Date.now())
  const [paying, setPaying] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [worldwideScores, setWorldwideScores] = useState<ScoreRow[]>([])
  const [localScores, setLocalScores] = useState<ScoreRow[]>([])
  const [leaderboardMode, setLeaderboardMode] = useState<'worldwide' | 'local'>('worldwide')
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

  useEffect(() => {
    let active = true
    setLocalScores(loadScores(address))
    setLeaderboardMode('worldwide')
    const refreshWorldwide = () => {
      void worldwideLeaderboard()
        .then(scores => {
          if (!active) return
          setWorldwideScores(scores)
        })
        .catch(() => { /* Local scores remain available until Redis is configured. */ })
    }
    refreshWorldwide()
    const timer = window.setInterval(refreshWorldwide, 15_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [address])

  const jump = useCallback(() => {
    if (phase === 'running' && yRef.current <= 1) velocityRef.current = 680
  }, [phase])

  const finishGame = useCallback((score: number, raceWinner: Exclude<Winner, null>) => {
    if (finishedRef.current) return
    finishedRef.current = true
    const next = [...loadScores(address), {
      rank: 0,
      score: Math.floor(score),
      playedAt: Date.now(),
      won: raceWinner === 'player',
      transaction: entrySignatureRef.current,
      network: paymentNetwork,
    }]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((row, index) => ({ ...row, rank: index + 1 }))
    localStorage.setItem(storageKey(address), JSON.stringify(next.map(({ score: savedScore, playedAt, won, transaction, network }) => ({ score: savedScore, playedAt, won, transaction, network }))))
    setLocalScores(next)
    if (entrySignatureRef.current) {
      void worldwideLeaderboard({
        wallet: address,
        score: Math.floor(score),
        won: raceWinner === 'player',
        transaction: entrySignatureRef.current,
        network: paymentNetwork,
      }).then(scores => {
        setWorldwideScores(scores)
      }).catch(() => { /* The run is still retained in the local fallback. */ })
    }
    setWinner(raceWinner)
    setPhase('finished')
    trackAnalytics('game_finished', {
      network: paymentNetwork === 'solana' ? 'solana_devnet' : 'megaeth_testnet',
      won: raceWinner === 'player',
      duration_seconds: Math.floor(score / 1000),
    })
    if (raceWinner === 'player' && entrySignatureRef.current && paymentNetwork === 'solana') {
      const paidEntry = entrySignatureRef.current
      setStatus('You beat the bot! Requesting 0.02 SOL devnet payout...')
      void claimDevnetPayout(address, paidEntry)
        .then(result => setStatus(`2x payout sent: ${short(result.payoutSignature ?? '')}`))
        .catch(error => setStatus(error instanceof Error ? `Payout error: ${error.message}` : 'Payout failed.'))
    } else if (raceWinner === 'player') {
      setStatus('You beat the bot! Win recorded locally.')
    } else {
      setStatus('The bot beat you')
    }
  }, [address, paymentNetwork])

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
      const speed = raceSpeed(activeElapsed)
      const travel = activeElapsed * speed
      const nextObstacleIndex = elapsed >= SAFE_START_MS ? obstacleCourse.findIndex(position => {
        const x = position - travel
        return x > 225 && x < 320
      }) : -1
      if (nextObstacleIndex >= 0 && botYRef.current <= 1) {
        // The bot is flawless for the opening 30 seconds, then makes roughly
        // one deterministic mistake per 31 obstacles. It is tough but beatable.
        const botMistake = activeElapsed >= 30_000
          && (nextObstacleIndex * 97 + seed * 13) % 31 === 0
        if (!botMistake) botVelocityRef.current = 735
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
      let entrySignature: string
      if (paymentNetwork === 'megaeth') {
        entrySignature = await sendMegaEthEntry(address)
      } else {
        let playerPublicKey: PublicKey
        try { playerPublicKey = new PublicKey(address) }
        catch { throw new Error('The connected wallet returned an invalid public address. Disconnect it, refresh, and reconnect.') }
        const transaction = new Transaction().add(SystemProgram.transfer({
          fromPubkey: playerPublicKey,
          toPubkey: receiverPublicKey,
          lamports: ENTRY_LAMPORTS,
        }))
        if (localWallet) {
          const latest = await getDevnetBlockhash()
          transaction.feePayer = localWallet.publicKey
          transaction.recentBlockhash = latest.blockhash
          transaction.sign(localWallet)
          const serialized = transaction.serialize()
          entrySignature = await sendDevnetRawTransaction(serialized)
          await confirmDevnetSignature(entrySignature)
        } else {
          if (signTransaction) {
            const latest = await getDevnetBlockhash()
            transaction.feePayer = playerPublicKey
            transaction.recentBlockhash = latest.blockhash
            const signed = await signTransaction(transaction)
            const serialized = signed.serialize()
            entrySignature = await sendDevnetRawTransaction(serialized)
            await confirmDevnetSignature(entrySignature)
          } else {
            entrySignature = await sendTransaction(transaction, connection)
            await confirmDevnetSignature(entrySignature)
          }
        }
      }

      const started = Date.now()
      entrySignatureRef.current = entrySignature
      trackAnalytics('game_transaction_confirmed', {
        network: paymentNetwork === 'solana' ? 'solana_devnet' : 'megaeth_testnet',
        currency: paymentNetwork === 'solana' ? 'SOL' : 'ETH',
        amount: 0.01,
      })
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
          ? `The free ${paymentNetwork === 'megaeth' ? 'MegaETH testnet' : 'Solana devnet'} endpoint is temporarily rate-limited. Wait a moment and retry.`
          : detail)
      setStatus('Ready to play')
    } finally {
      setPaying(false)
    }
  }, [address, connection, localWallet, paying, paymentNetwork, sendTransaction, signTransaction])

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
  const speed = raceSpeed(activeElapsed)
  const travel = activeElapsed * speed
  const obstacles = elapsed < SAFE_START_MS ? [] : obstacleCourse
    .map(position => ({ position, left: 100 * (position - travel) / 900 }))
    .filter(obstacle => obstacle.left > -8 && obstacle.left < 108)
  const leaderboard = leaderboardMode === 'worldwide' ? worldwideScores : localScores

  return <section className="game-page">
    <div className="game-header"><div><span>DUAL TESTNET BOT RACE - BUILD V20</span><h1>Dino Run</h1></div><button onClick={onExit}>Leave game</button></div>
    <div className="game-layout">
      <div className="arena-card">
        <div className="arena-top"><span className={`live-pill ${phase}`}><i /> {phase.toUpperCase()}</span><strong>{Math.floor(elapsed / 1000).toString().padStart(3, '0')}M</strong></div>
        <button className="dino-stage" onClick={jump} aria-label="Jump">
          <div className="sky-line" /><div className="ground-line" />
          {obstacles.map(obstacle => <span className="cactus" key={obstacle.position} style={{ left: `${obstacle.left}%` }}><i /><i /><b /></span>)}
          {phase !== 'ready' && <span className={`dino ${phase === 'running' ? 'is-running' : ''}`} style={{ transform: `translateY(-${y}px)` }}><i className="eye" /><i className="leg one" /><i className="leg two" /></span>}
          {phase !== 'ready' && <><span className={`dino bot-dino ${phase === 'running' ? 'is-running' : ''}`} style={{ transform: `translateY(-${botY}px)` }}><i className="eye" /><i className="leg one" /><i className="leg two" /></span><span className="bot-label" style={{ transform: `translateY(-${botY}px)` }}>BOT</span></>}
          {phase === 'finished' && <div className="arena-message result"><strong>{winner === 'player' ? 'You beat the bot!' : 'Bot wins'}</strong><span>You ran {Math.floor(elapsed / 1000)} meters</span><button onClick={event => { event.stopPropagation(); reset() }}>Play again</button></div>}
          {phase === 'ready' && <div className="arena-message payment-message"><strong>{paymentNetwork === 'solana' ? 'Race the bot for 2x' : 'Race the bot on MegaETH'}</strong><span>{paymentNetwork === 'solana' ? 'Pay 0.01 devnet SOL. Beat the bot to receive 0.02.' : 'Pay 0.01 MegaETH testnet ETH. Wins are recorded locally.'}</span><code>Receiver: {short(paymentNetwork === 'solana' ? receiverAddress : MEGAETH_RECEIVER)}</code>{paymentError && <p>{paymentError}</p>}<button className="join-game-button" disabled={paying} onClick={event => { event.stopPropagation(); payEntry() }}>{paying ? 'CONFIRMING TRANSACTION...' : `START RACE · 0.01 ${paymentNetwork === 'solana' ? 'SOL' : 'ETH'}`}</button><small>{paymentNetwork === 'solana' ? 'Devnet prototype. The browser reports the winner to the payout function.' : 'MegaETH testnet entry. MetaMask confirms the payment and network.'}</small></div>}
        </button>
        <div className="controls-note"><span>SPACE / UP ARROW / TAP TO JUMP</span><p>{status}</p></div>
      </div>
      <aside className="players-card"><div className="players-title"><div><span>{leaderboardMode === 'worldwide' ? 'UPSTASH REDIS' : 'THIS BROWSER'}</span><h2>{leaderboardMode === 'worldwide' ? 'Worldwide leaderboard' : 'Local high scores'}</h2></div><i className={leaderboardMode === 'worldwide' ? 'online' : ''} /></div><div className="leaderboard-tabs"><button className={leaderboardMode === 'worldwide' ? 'active' : ''} onClick={() => setLeaderboardMode('worldwide')}>Worldwide</button><button className={leaderboardMode === 'local' ? 'active' : ''} onClick={() => setLeaderboardMode('local')}>Local</button></div><div className="leaderboard score-board">{leaderboard.length ? <><div className="score-header"><b>#</b><strong>PLAYER</strong><em>SCORE</em><span>WIN</span><i>TX</i></div>{leaderboard.map(row => <div key={`${row.transaction ?? row.playedAt}-${row.rank}`}><b>#{row.rank}</b>{row.profileWallet && row.network ? <button className="leaderboard-name" onClick={() => onViewProfile(row.profileWallet!, row.network!)}>{row.wallet ?? 'Player'}</button> : <strong>{row.wallet ?? 'You'}</strong>}<em>{Math.floor(row.score / 1000)}m</em><span className={row.won ? 'win-yes' : 'win-no'}>{row.won ? 'Yes' : 'No'}</span>{row.transaction && row.network ? <a href={row.network === 'solana' ? `https://explorer.solana.com/tx/${row.transaction}?cluster=devnet` : `${MEGAETH_EXPLORER_URL}/tx/${row.transaction}`} target="_blank" rel="noreferrer" title={`Open ${row.network === 'solana' ? 'Solana Explorer' : 'MegaETH Blockscout'}`}>View</a> : <i>—</i>}</div>)}</> : <p>{leaderboardMode === 'worldwide' ? 'No worldwide scores yet.' : 'Finish a run to record the first local score.'}</p>}</div><div className="server-note"><ShieldCheck /><p><strong>{leaderboardMode === 'worldwide' ? 'Worldwide scores' : 'Local scores'}</strong><span>{leaderboardMode === 'worldwide' ? 'Paid entries are verified before Redis accepts a score.' : 'These scores are saved only in this browser.'}</span></p></div></aside>
    </div>
  </section>
}
