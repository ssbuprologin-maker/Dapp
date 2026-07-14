import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletName, WalletReadyState } from '@solana/wallet-adapter-base'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { io, Socket } from 'socket.io-client'
import nacl from 'tweetnacl'
import {
  AlertTriangle, ArrowRight, Check, ChevronRight, Copy, Download, ExternalLink,
  KeyRound, LoaderCircle, LockKeyhole, LogOut, RefreshCw, ShieldCheck, Sparkles,
  Trash2, Wallet, X,
} from 'lucide-react'
import {
  createEncryptedWallet, exportRecovery, forgetStoredWallet, hasStoredWallet,
  storeWallet, unlockStoredWallet,
} from './cryptoWallet'

const JOIN_FEE_SOL = 0.01
const MIN_SOL = 0.01001
const short = (value: string) => `${value.slice(0, 5)}...${value.slice(-5)}`

type ModalStep = 'choose' | 'create' | 'unlock' | 'backup'

function App() {
  const { connection } = useConnection()
  const external = useWallet()
  const [localWallet, setLocalWallet] = useState<Keypair | null>(null)
  const [modal, setModal] = useState(false)
  const [step, setStep] = useState<ModalStep>('choose')
  const [pendingWallet, setPendingWallet] = useState<WalletName | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [message, setMessage] = useState('')
  const [inGame, setInGame] = useState(false)

  const publicKey = localWallet?.publicKey ?? external.publicKey
  const connected = Boolean(localWallet || external.connected)
  const eligible = balance !== null && balance >= MIN_SOL
  const connectionType = localWallet ? 'Site wallet' : external.wallet?.adapter.name ?? 'External wallet'

  const refreshBalance = useCallback(async () => {
    if (!publicKey) { setBalance(null); return }
    setLoadingBalance(true)
    try {
      const lamports = await connection.getBalance(publicKey, 'confirmed')
      setBalance(lamports / LAMPORTS_PER_SOL)
    } catch {
      setMessage('Could not reach Solana devnet. Try again.')
    } finally { setLoadingBalance(false) }
  }, [connection, publicKey])

  useEffect(() => { refreshBalance() }, [refreshBalance])
  const chooseExternal = (name: WalletName, readyState: WalletReadyState) => {
    if (readyState !== WalletReadyState.Installed && readyState !== WalletReadyState.Loadable) {
      setMessage(`${name} is not installed in this browser.`)
      return
    }
    setLocalWallet(null)
    external.select(name)
    setPendingWallet(name)
  }

  const connectExternal = async () => {
    if (!pendingWallet || external.wallet?.adapter.name !== pendingWallet) {
      setMessage('Select a wallet and try again.')
      return
    }
    try {
      await external.connect()
      setPendingWallet(null)
      setModal(false)
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : `Could not connect ${pendingWallet}. Check that the extension is unlocked and try again.`)
    }
  }

  const activateSiteWallet = async (wallet: Keypair) => {
    if (external.connected) await external.disconnect()
    setLocalWallet(wallet)
  }

  const disconnect = async () => {
    setLocalWallet(null)
    if (external.connected) await external.disconnect()
    setBalance(null)
  }

  const copyAddress = async () => {
    if (!publicKey) return
    await navigator.clipboard.writeText(publicKey.toBase58())
    setMessage('Address copied.')
  }

  return <div className="shell">
    <header>
      <a className="logo" href="/"><span><i /><i /><i /></span>DEVNET GATE</a>
      <div className="network"><i /> SOLANA DEVNET</div>
    </header>

    <main>
      {!connected ? <Landing onConnect={() => { setStep('choose'); setModal(true) }} /> : inGame && publicKey ? (
        <DinoGame address={publicKey.toBase58()} localWallet={localWallet} signMessage={external.signMessage} sendTransaction={external.sendTransaction} connection={connection} onExit={() => setInGame(false)} />
      ) : (
        <WalletView
          address={publicKey!.toBase58()}
          balance={balance}
          eligible={eligible}
          loading={loadingBalance}
          type={connectionType}
          localWallet={localWallet}
          onRefresh={refreshBalance}
          onCopy={copyAddress}
          onDisconnect={disconnect}
          onExport={() => localWallet && exportRecovery(localWallet)}
          onForget={() => {
            if (confirm('Delete this encrypted site wallet from this browser? Export a recovery file first.')) {
              forgetStoredWallet(); setLocalWallet(null); setBalance(null); setMessage('Site wallet removed from this browser.')
            }
          }}
          onEnter={() => setInGame(true)}
        />
      )}
    </main>

    <footer><span>DEVNET ONLY</span><p>Game entry fee: {JOIN_FEE_SOL} SOL</p><a href="https://github.com/anza-xyz/wallet-adapter" target="_blank" rel="noreferrer">Powered by Anza Wallet Adapter <ExternalLink /></a></footer>

    {modal && <WalletModal
      step={step}
      setStep={setStep}
      wallets={external.wallets}
      pendingWallet={pendingWallet}
      connecting={external.connecting}
      selectedReady={Boolean(pendingWallet && external.wallet?.adapter.name === pendingWallet)}
      stored={hasStoredWallet()}
      onExternal={chooseExternal}
      onConnectExternal={connectExternal}
      onClose={() => setModal(false)}
      onCreated={async (wallet) => { await activateSiteWallet(wallet); setStep('backup') }}
      onUnlocked={async wallet => { await activateSiteWallet(wallet); setModal(false) }}
    />}
    {message && <div className="toast">{message}<button onClick={() => setMessage('')}><X /></button></div>}
  </div>
}

function Landing({ onConnect }: { onConnect: () => void }) {
  return <section className="landing">
    <div className="badge"><Sparkles /> SECURE DEVNET ACCESS</div>
    <h1><em>Sign up.</em></h1>
    <p>Connect an existing Solana wallet or create an encrypted site wallet directly in your browser.</p>
    <button className="hero-button" onClick={onConnect}><Wallet /> CONNECT WALLET <ArrowRight /></button>
  </section>
}

function WalletView({ address, balance, eligible, loading, type, localWallet, onRefresh, onCopy, onDisconnect, onExport, onForget, onEnter }: {
  address: string; balance: number | null; eligible: boolean; loading: boolean; type: string; localWallet: Keypair | null;
  onRefresh: () => void; onCopy: () => void; onDisconnect: () => void; onExport: () => void; onForget: () => void; onEnter: () => void;
}) {
  return <section className="wallet-page">
    <div className="wallet-heading"><div><span>CONNECTED WALLET</span><h1>{eligible ? 'Access granted.' : 'Balance required.'}</h1></div><button onClick={onDisconnect}><LogOut /> Disconnect</button></div>
    <div className="account-grid">
      <article className="balance-card">
        <div className="account-line"><span className="wallet-symbol"><Wallet /></span><div><small>{type.toUpperCase()}</small><strong>{short(address)}</strong></div><button onClick={onCopy} aria-label="Copy address"><Copy /></button></div>
        <p>DEVNET BALANCE <button onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /></button></p>
        <h2>{balance === null ? '—' : balance.toFixed(4)} <span>SOL</span></h2>
        <div className={`gate-status ${eligible ? 'passed' : ''}`}><span>{eligible ? <Check /> : <LockKeyhole />}</span><div><strong>{eligible ? 'Enough for entry' : `${JOIN_FEE_SOL} SOL plus network fee required`}</strong><p>{eligible ? 'The entry transfer is requested only when you enter a round.' : `Add at least ${Math.max(0, MIN_SOL - (balance ?? 0)).toFixed(5)} more devnet SOL.`}</p></div></div>
      </article>
      <aside className="action-card">
        {eligible ? <><span className="success-mark"><Check /></span><h2>You are in</h2><p>Your wallet passed the devnet balance requirement.</p><button className="primary" onClick={onEnter}>ENTER DAPP <ArrowRight /></button></> : <><span className="warning-mark"><AlertTriangle /></span><h2>Top up on devnet</h2><p>Use the official Solana faucet, then refresh your balance.</p><a className="primary" href="https://faucet.solana.com/" target="_blank" rel="noreferrer">OPEN DEVNET FAUCET <ExternalLink /></a></>}
      </aside>
    </div>
    {localWallet && <div className="local-tools"><div><ShieldCheck /><p><strong>Browser-local site wallet</strong><span>Encrypted on this device. Keep an offline recovery file.</span></p></div><div><button onClick={onExport}><Download /> Export recovery</button><button className="danger" onClick={onForget}><Trash2 /> Forget wallet</button></div></div>}
    {!eligible && <div className="blocked-note"><LockKeyhole /> The game stays locked until this wallet can cover the 0.01 SOL entry fee and network fee.</div>}
  </section>
}

type RemotePlayer = { wallet: string; alive: boolean; score: number; color: string }
type RemoteGame = { phase: 'lobby' | 'countdown' | 'running' | 'finished'; roundId: string; startAt: number | null; seed: number; players: RemotePlayer[]; winner: string | null; serverTime: number; redis: boolean }
type PlayerSync = { y: number; score: number }
type LeaderboardRow = { rank: number; wallet: string; wins: number }
type PaymentRequest = { roundId: string; recipient: string; lamports: number }

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

function DinoGame({ address, localWallet, signMessage, sendTransaction, connection, onExit }: {
  address: string
  localWallet: Keypair | null
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
  sendTransaction: (transaction: Transaction, connection: Connection) => Promise<string>
  connection: Connection
  onExit: () => void
}) {
  const socketRef = useRef<Socket | null>(null)
  const [game, setGame] = useState<RemoteGame | null>(null)
  const [positions, setPositions] = useState<Record<string, PlayerSync>>({})
  const [status, setStatus] = useState('Connecting to arena...')
  const [spectator, setSpectator] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [payment, setPayment] = useState<PaymentRequest | null>(null)
  const [paying, setPaying] = useState(false)
  const [paymentError, setPaymentError] = useState('')
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])

  useEffect(() => {
    const socket = io(window.location.origin, {
      path: '/api/socket-io/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelayMax: 5_000,
    })
    socketRef.current = socket
    socket.on('auth_challenge', async ({ message }: { message: string }) => {
      try {
        const bytes = new TextEncoder().encode(message)
        const signature = localWallet ? nacl.sign.detached(bytes, localWallet.secretKey) : await signMessage?.(bytes)
        if (!signature) throw new Error('This wallet cannot sign messages.')
        socket.emit('authenticate', { wallet: address, signature: toBase64(signature) })
      } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not sign in.') }
    })
    socket.on('authenticated', () => setStatus('Wallet verified'))
    socket.on('payment_required', (request: PaymentRequest) => { setPayment(request); setPaymentError(''); setStatus('Ready to join') })
    socket.on('payment_error', ({ message }: { message: string }) => { setPaymentError(message); setPaying(false) })
    socket.on('admitted', ({ spectator: watching }: { spectator?: boolean }) => {
      setPayment(null); setPaying(false); setSpectator(Boolean(watching)); setStatus(watching ? 'Round in progress - spectating' : 'Entry confirmed')
    })
    socket.on('auth_error', ({ message }: { message: string }) => setStatus(message))
    socket.on('game_state', (state: RemoteGame) => setGame(state))
    socket.on('leaderboard', (rows: LeaderboardRow[]) => setLeaderboard(rows))
    socket.on('player_sync', ({ wallet, y, score }: { wallet: string; y: number; score: number }) => {
      setPositions(current => ({ ...current, [wallet]: { y, score } }))
    })
    socket.on('disconnect', () => setStatus('Disconnected - reconnecting...'))
    return () => { socket.disconnect(); socketRef.current = null }
  }, [address, localWallet, signMessage])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 33)
    return () => window.clearInterval(timer)
  }, [])

  const jump = useCallback(() => socketRef.current?.emit('jump'), [])

  const payEntry = useCallback(async () => {
    if (!payment || paying) return
    setPaying(true); setPaymentError('')
    try {
      const transaction = new Transaction().add(SystemProgram.transfer({
        fromPubkey: new PublicKey(address),
        toPubkey: new PublicKey(payment.recipient),
        lamports: payment.lamports,
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
      socketRef.current?.emit('submit_payment', { signature })
      setStatus('Verifying entry transaction...')
    } catch (error) {
      setPaying(false)
      setPaymentError(error instanceof Error ? error.message : 'Entry transaction failed.')
    }
  }, [address, connection, localWallet, paying, payment, sendTransaction])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ArrowUp') { event.preventDefault(); jump() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [jump])

  const elapsed = game?.startAt ? Math.max(0, now - game.startAt) : 0
  const speed = Math.min(0.55, 0.28 + elapsed / 180_000)
  const offsets = game ? [120 + game.seed % 190, 490 + (game.seed * 7) % 170, 810 + (game.seed * 13) % 100] : []
  const obstacles = offsets.map(offset => 100 * (900 - ((elapsed * speed + offset) % 940)) / 900)
  const countdown = game?.startAt ? Math.max(0, Math.ceil((game.startAt - now) / 1000)) : null

  return <section className="game-page">
    <div className="game-header"><div><span>WHITELISTED MULTIPLAYER</span><h1>Dino Run</h1></div><button onClick={onExit}>Leave arena</button></div>
    <div className="game-layout">
      <div className="arena-card">
        <div className="arena-top"><span className={`live-pill ${game?.phase ?? ''}`}><i /> {game?.phase?.toUpperCase() ?? status.toUpperCase()}</span><strong>{Math.floor((positions[address]?.score ?? elapsed) / 1000).toString().padStart(3, '0')}M</strong></div>
        <button className="dino-stage" onClick={jump} aria-label="Jump">
          <div className="sky-line" /><div className="ground-line" />
          {obstacles.map((left, index) => <span className="cactus" key={index} style={{ left: `${left}%` }}><i /><i /><b /></span>)}
          {game?.players.filter(player => player.alive).map((player, index) => <span className="dino" key={player.wallet} style={{ '--player-color': player.color, transform: `translate(${index * 3}px, -${positions[player.wallet]?.y ?? 0}px)` } as React.CSSProperties}><i className="eye" /><i className="leg one" /><i className="leg two" /></span>)}
          {(!game || game.phase === 'lobby') && <div className="arena-message"><strong>Waiting for players</strong><span>At least two whitelisted wallets are needed</span></div>}
          {game?.phase === 'countdown' && <div className="countdown">{countdown || 'RUN!'}</div>}
          {game?.phase === 'finished' && <div className="arena-message result"><strong>{game.winner === address ? 'You are the last standing!' : game.winner ? `${short(game.winner)} wins` : 'Nobody survived'}</strong><span>Final round result</span><button onClick={event => { event.stopPropagation(); socketRef.current?.emit('play_again') }}>Play again</button></div>}
          {payment && <div className="arena-message payment-message"><strong>Ready to play?</strong><span>Joining this round costs 0.01 devnet SOL. Your wallet will ask you to confirm.</span><code>Receiver: {short(payment.recipient)}</code>{paymentError && <p>{paymentError}</p>}<button className="join-game-button" disabled={paying} onClick={event => { event.stopPropagation(); payEntry() }}>{paying ? 'CONFIRMING TRANSACTION...' : 'JOIN GAME · 0.01 SOL'}</button><small>Entering the dApp is free. The transaction happens only when you click Join Game.</small></div>}
        </button>
        <div className="controls-note"><span>SPACE / UP ARROW / TAP TO JUMP</span><p>{spectator ? 'You joined late and are spectating this round.' : status}</p></div>
      </div>
      <aside className="players-card"><div className="players-title"><div><span>LIVE PLAYERS</span><h2>{game?.players.filter(player => player.alive).length ?? 0} standing</h2></div><i className={game?.redis ? 'online' : ''} /></div><div className="player-list">{game?.players.map(player => <div key={player.wallet} className={player.alive ? '' : 'eliminated'}><span style={{ background: player.color }} /><div><strong>{player.wallet === address ? 'YOU' : short(player.wallet)}</strong><small>{player.alive ? 'RUNNING' : 'ELIMINATED'}</small></div><b>{Math.floor((positions[player.wallet]?.score ?? player.score) / 1000)}m</b></div>) ?? <p>No players connected.</p>}</div><div className="leaderboard"><span>ALL-TIME WINS</span>{leaderboard.length ? leaderboard.map(row => <div key={row.wallet}><b>#{row.rank}</b><strong>{row.wallet === address ? 'YOU' : short(row.wallet)}</strong><em>{row.wins}</em></div>) : <p>No winners yet.</p>}</div><div className="server-note"><ShieldCheck /><p><strong>Server authoritative</strong><span>Payments, collisions and results are independently verified.</span></p></div></aside>
    </div>
  </section>
}

function WalletModal({ step, setStep, wallets, pendingWallet, connecting, selectedReady, stored, onExternal, onConnectExternal, onClose, onCreated, onUnlocked }: {
  step: ModalStep; setStep: (step: ModalStep) => void; wallets: ReturnType<typeof useWallet>['wallets']; pendingWallet: WalletName | null; connecting: boolean; selectedReady: boolean; stored: boolean;
  onExternal: (name: WalletName, state: WalletReadyState) => void; onConnectExternal: () => void; onClose: () => void; onCreated: (wallet: Keypair) => Promise<void>; onUnlocked: (wallet: Keypair) => Promise<void>;
}) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [createdWallet, setCreatedWallet] = useState<Keypair | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const visibleWallets = useMemo(() => wallets.filter((item, index, all) => all.findIndex(other => other.adapter.name === item.adapter.name) === index), [wallets])

  const create = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (password !== confirmPassword) return setError('Passwords do not match.')
    setBusy(true)
    try { const wallet = await createEncryptedWallet(password); setCreatedWallet(wallet); await onCreated(wallet) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create wallet.') }
    finally { setBusy(false) }
  }
  const unlock = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true)
    try { await onUnlocked(await unlockStoredWallet(password)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not unlock wallet.') }
    finally { setBusy(false) }
  }
  const importFile = async (file: File | undefined) => {
    if (!file || password.length < 10) return setError('Enter a new password of at least 10 characters first.')
    setBusy(true); setError('')
    try {
      const data = JSON.parse(await file.text()) as { secretKey: number[] }
      const wallet = Keypair.fromSecretKey(Uint8Array.from(data.secretKey))
      await storeWallet(wallet, password); await onUnlocked(wallet)
    } catch { setError('That recovery file is not valid.') }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={event => event.stopPropagation()}><button className="close" onClick={onClose}><X /></button>
    {step !== 'choose' && step !== 'backup' && <button className="back" onClick={() => { setError(''); setStep('choose') }}>← Back</button>}
    {step === 'choose' && <><div className="modal-title"><span><Wallet /></span><div><h2>Connect wallet</h2><p>Select an installed wallet, then approve the connection.</p></div></div><div className="wallet-list">{visibleWallets.map(item => <button className={pendingWallet === item.adapter.name ? 'selected' : ''} key={item.adapter.name} onClick={() => onExternal(item.adapter.name, item.readyState)}><img src={item.adapter.icon} alt="" /><div><strong>{item.adapter.name}</strong><small>{item.readyState === WalletReadyState.Installed ? 'Detected' : item.readyState}</small></div>{pendingWallet === item.adapter.name ? <Check /> : <ChevronRight />}</button>)}</div>{pendingWallet && <button className="primary external-connect" disabled={!selectedReady || connecting} onClick={onConnectExternal}>{connecting ? <><LoaderCircle className="spin" /> CONNECTING...</> : <>CONNECT {pendingWallet.toUpperCase()} <ArrowRight /></>}</button>}<div className="divider"><span>OR</span></div>{stored ? <button className="site-option" onClick={() => setStep('unlock')}><span><LockKeyhole /></span><div><strong>Unlock site wallet</strong><small>An encrypted wallet exists on this device</small></div><ChevronRight /></button> : <button className="site-option" onClick={() => setStep('create')}><span><KeyRound /></span><div><strong>Create a site wallet</strong><small>Encrypted and stored only in this browser</small></div><ChevronRight /></button>}</>}
    {step === 'create' && <form onSubmit={create}><div className="form-icon"><KeyRound /></div><h2>Create site wallet</h2><p>A new Solana keypair will be encrypted with your password and stored in this browser.</p><label>PASSWORD<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 10 characters" autoFocus /></label><label>CONFIRM PASSWORD<input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>{error && <div className="form-error"><AlertTriangle />{error}</div>}<button className="primary" disabled={busy}>{busy ? 'CREATING…' : 'CREATE WALLET'} <ArrowRight /></button></form>}
    {step === 'unlock' && <form onSubmit={unlock}><div className="form-icon"><LockKeyhole /></div><h2>Unlock site wallet</h2><p>Your password decrypts the wallet locally. It is never transmitted.</p><label>PASSWORD<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus /></label>{error && <div className="form-error"><AlertTriangle />{error}</div>}<button className="primary" disabled={busy}>{busy ? 'UNLOCKING…' : 'UNLOCK WALLET'} <ArrowRight /></button><label className="import-button">IMPORT RECOVERY FILE<input type="file" accept="application/json" onChange={e => importFile(e.target.files?.[0])} /></label></form>}
    {step === 'backup' && createdWallet && <div className="backup"><span className="warning-mark"><AlertTriangle /></span><h2>Back up your wallet now</h2><p>This is the only recovery copy. If browser storage is cleared and you do not have it, the wallet cannot be recovered.</p><div className="address-box"><small>PUBLIC ADDRESS</small><code>{createdWallet.publicKey.toBase58()}</code></div><button className="primary" onClick={() => exportRecovery(createdWallet)}><Download /> DOWNLOAD RECOVERY FILE</button><button className="text-button" onClick={onClose}>I saved it — continue</button></div>}
  </div></div>
}

export default App
