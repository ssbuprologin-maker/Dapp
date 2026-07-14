import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletName, WalletReadyState } from '@solana/wallet-adapter-base'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
  AlertTriangle, ArrowRight, Check, ChevronRight, Copy, Download, ExternalLink,
  KeyRound, LoaderCircle, LockKeyhole, LogOut, RefreshCw, ShieldCheck, Sparkles,
  Trash2, Wallet, X,
} from 'lucide-react'
import {
  createEncryptedWallet, exportRecovery, forgetStoredWallet, hasStoredWallet,
  storeWallet, unlockStoredWallet,
} from './cryptoWallet'
import SingleplayerDinoGame from './SingleplayerDinoGame'
import { getDevnetBalance } from './solanaRpc'

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
  const [balanceUnavailable, setBalanceUnavailable] = useState(false)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [message, setMessage] = useState('')
  const [inGame, setInGame] = useState(false)

  const publicKey = localWallet?.publicKey ?? external.publicKey
  const connected = Boolean(localWallet || external.connected)
  // If public balance reads are throttled, the entry transaction is the final
  // balance check. A wallet without enough SOL still cannot send the payment.
  const eligible = balanceUnavailable || (balance !== null && balance >= MIN_SOL)
  const connectionType = localWallet ? 'Site wallet' : external.wallet?.adapter.name ?? 'External wallet'

  const refreshBalance = useCallback(async () => {
    if (!publicKey) { setBalance(null); return }
    setLoadingBalance(true)
    setBalanceUnavailable(false)
    try {
      const lamports = await getDevnetBalance(publicKey)
      setBalance(lamports / LAMPORTS_PER_SOL)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setMessage(/429|too many requests|rate.?limit/i.test(detail)
        ? 'Balance display is temporarily unavailable. The entry transaction will check your balance when you play.'
        : 'Balance display is unavailable. Your wallet will still reject entry if it lacks 0.01 SOL plus the fee.')
      setBalanceUnavailable(true)
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
        <SingleplayerDinoGame address={publicKey.toBase58()} localWallet={localWallet} sendTransaction={external.sendTransaction} signTransaction={external.signTransaction as ((transaction: Transaction) => Promise<Transaction>) | undefined} connection={connection} onExit={() => setInGame(false)} />
      ) : (
        <WalletView
          address={publicKey!.toBase58()}
          balance={balance}
          eligible={eligible}
          balanceUnavailable={balanceUnavailable}
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

function WalletView({ address, balance, eligible, balanceUnavailable, loading, type, localWallet, onRefresh, onCopy, onDisconnect, onExport, onForget, onEnter }: {
  address: string; balance: number | null; eligible: boolean; balanceUnavailable: boolean; loading: boolean; type: string; localWallet: Keypair | null;
  onRefresh: () => void; onCopy: () => void; onDisconnect: () => void; onExport: () => void; onForget: () => void; onEnter: () => void;
}) {
  return <section className="wallet-page">
    <div className="wallet-heading"><div><span>CONNECTED WALLET</span><h1>{eligible ? 'Access granted.' : 'Balance required.'}</h1></div><button onClick={onDisconnect}><LogOut /> Disconnect</button></div>
    <div className="account-grid">
      <article className="balance-card">
        <div className="account-line"><span className="wallet-symbol"><Wallet /></span><div><small>{type.toUpperCase()}</small><strong>{short(address)}</strong></div><button onClick={onCopy} aria-label="Copy address"><Copy /></button></div>
        <p>DEVNET BALANCE <button onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /></button></p>
        <h2>{balanceUnavailable ? 'RPC BUSY' : balance === null ? '—' : balance.toFixed(4)} {!balanceUnavailable && <span>SOL</span>}</h2>
        <div className={`gate-status ${eligible ? 'passed' : ''}`}><span>{eligible ? <Check /> : <LockKeyhole />}</span><div><strong>{balanceUnavailable ? 'Entry check available' : eligible ? 'Enough for entry' : `${JOIN_FEE_SOL} SOL plus network fee required`}</strong><p>{balanceUnavailable ? 'Play is unlocked; the entry transaction safely fails if your balance is too low.' : eligible ? 'The entry transfer is requested only when you enter a round.' : `Add at least ${Math.max(0, MIN_SOL - (balance ?? 0)).toFixed(5)} more devnet SOL.`}</p></div></div>
      </article>
      <aside className="action-card">
        {eligible ? <><span className="success-mark"><Check /></span><h2>You are in</h2><p>{balanceUnavailable ? 'The payment transaction will verify your available devnet SOL.' : 'Your wallet passed the devnet balance requirement.'}</p><button className="primary" onClick={onEnter}>ENTER DAPP <ArrowRight /></button></> : <><span className="warning-mark"><AlertTriangle /></span><h2>Top up on devnet</h2><p>Use the official Solana faucet, then refresh your balance.</p><a className="primary" href="https://faucet.solana.com/" target="_blank" rel="noreferrer">OPEN DEVNET FAUCET <ExternalLink /></a></>}
      </aside>
    </div>
    {localWallet && <div className="local-tools"><div><ShieldCheck /><p><strong>Browser-local site wallet</strong><span>Encrypted on this device. Keep an offline recovery file.</span></p></div><div><button onClick={onExport}><Download /> Export recovery</button><button className="danger" onClick={onForget}><Trash2 /> Forget wallet</button></div></div>}
    {!eligible && <div className="blocked-note"><LockKeyhole /> The game stays locked until this wallet can cover the 0.01 SOL entry fee and network fee.</div>}
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
