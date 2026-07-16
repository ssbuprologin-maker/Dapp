import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletName, WalletReadyState } from '@solana/wallet-adapter-base'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha2'
import {
  AlertTriangle, ArrowRight, BarChart3, Check, ChevronRight, Copy, Download, ExternalLink,
  KeyRound, LoaderCircle, LockKeyhole, LogOut, RefreshCw, ShieldCheck, Sparkles,
  Settings, Share2, Trash2, Wallet, X,
} from 'lucide-react'
import {
  createEncryptedWallet, exportRecovery, forgetStoredWallet, hasStoredWallet,
  storeWallet, unlockStoredWallet,
} from './cryptoWallet'
import SingleplayerDinoGame from './SingleplayerDinoGame'
import { getDevnetBalance } from './solanaRpc'
import {
  connectMetaMask, getMegaEthBalance, getMetaMaskProvider, MEGAETH_FAUCET_URL,
} from './megaEth'
import { trackAnalytics } from './analytics'
import ChatRail from './ChatRail'
import ProfilePage from './ProfilePage'
import AffiliatesPage from './AffiliatesPage'
import HeaderBalance from './HeaderBalance'
import dinoSkullUpper from './assets/dino-skull-upper.png'
import dinoSkullJaw from './assets/dino-skull-jaw-v2.png'

const JOIN_FEE_SOL = 0.01
const MIN_SOL = 0.01001
const MIN_MEGAETH = 0.010001
const NAME_BALANCE = 0.1
const MIN_WALLET_USD = 8
const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const short = (value: string) => `${value.slice(0, 5)}...${value.slice(-5)}`

type ModalStep = 'choose' | 'create' | 'unlock' | 'backup'
type ProfileSection = 'statistics' | 'transactions' | 'settings'

function App() {
  const { connection } = useConnection()
  const external = useWallet()
  const [localWallet, setLocalWallet] = useState<Keypair | null>(null)
  const [evmAddress, setEvmAddress] = useState<string | null>(null)
  const [connectingMetaMask, setConnectingMetaMask] = useState(false)
  const [modal, setModal] = useState(false)
  const [step, setStep] = useState<ModalStep>('choose')
  const [pendingWallet, setPendingWallet] = useState<WalletName | null>(null)

  const [balance, setBalance] = useState<number | null>(null)
  const [balanceUnavailable, setBalanceUnavailable] = useState(false)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [message, setMessage] = useState('')
  const [inGame, setInGame] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [marketPrices, setMarketPrices] = useState<{ solUsd: number | null; ethUsd: number | null; usdcUsd: number } | null>(null)
  const [usdcBalance, setUsdcBalance] = useState(0)
  const [nextNameChangeAt, setNextNameChangeAt] = useState(0)
  const [savingName, setSavingName] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showAffiliates, setShowAffiliates] = useState(false)
  const [profileSection, setProfileSection] = useState<ProfileSection>('statistics')
  const [profileMenu, setProfileMenu] = useState(false)
  const [headerAvatar, setHeaderAvatar] = useState('')
  const [viewedProfile, setViewedProfile] = useState<{ wallet: string; network: 'solana' | 'megaeth' } | null>(null)

  const publicKey = localWallet?.publicKey ?? external.publicKey
  const walletAddress = evmAddress ?? publicKey?.toBase58() ?? null
  const isMegaEth = Boolean(evmAddress)
  const connected = Boolean(evmAddress || localWallet || external.connected)
  const walletUsdValue = balance === null || !marketPrices ? null : isMegaEth
    ? balance * (marketPrices.ethUsd ?? 0)
    : balance * (marketPrices.solUsd ?? 0) + usdcBalance * marketPrices.usdcUsd
  const eligible = !balanceUnavailable && balance !== null
    && balance >= (isMegaEth ? MIN_MEGAETH : MIN_SOL)
    && walletUsdValue !== null && walletUsdValue > MIN_WALLET_USD
  const connectionType = isMegaEth ? 'MetaMask' : localWallet ? 'Site wallet' : external.wallet?.adapter.name ?? 'External wallet'

  useEffect(() => {
    if (localStorage.getItem('testnet-games:last-wallet') !== 'metamask') return
    const provider = getMetaMaskProvider()
    if (!provider) return
    void provider.request<string[]>({ method: 'eth_accounts' }).then(accounts => {
      if (accounts[0]) setEvmAddress(accounts[0])
    }).catch(() => { /* MetaMask is locked or no longer authorized. */ })
  }, [])

  useEffect(() => {
    let active = true
    const refresh = () => void fetch('/api/prices')
      .then(response => response.ok ? response.json() as Promise<{ solUsd: number | null; ethUsd: number | null; usdcUsd: number }> : Promise.reject())
      .then(prices => { if (active) setMarketPrices(prices) })
      .catch(() => undefined)
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (!walletAddress) { setHeaderAvatar(''); return }
    const network = isMegaEth ? 'megaeth' : 'solana'
    setHeaderAvatar(localStorage.getItem(`testnet-games:avatar:${network}:${walletAddress}`) ?? '')
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ wallet: string; network: string; avatar: string }>).detail
      if (detail?.wallet === walletAddress && detail.network === network) setHeaderAvatar(detail.avatar)
    }
    window.addEventListener('profile-avatar-updated', update)
    return () => window.removeEventListener('profile-avatar-updated', update)
  }, [isMegaEth, walletAddress])

  const openProfile = (section: ProfileSection) => { if (walletAddress) setViewedProfile({ wallet: walletAddress, network: isMegaEth ? 'megaeth' : 'solana' }); setProfileSection(section); setShowProfile(true); setShowAffiliates(false); setProfileMenu(false); setInGame(false) }
  const openProfileButton = () => setProfileMenu(true)
  const openAffiliates = () => { setShowAffiliates(true); setShowProfile(false); setInGame(false); setProfileMenu(false) }
  const viewChatProfile = (wallet: string, network: 'solana' | 'megaeth') => { setViewedProfile({ wallet, network }); setProfileSection('statistics'); setShowProfile(true); setShowAffiliates(false); setProfileMenu(false); setInGame(false) }

  const refreshBalance = useCallback(async () => {
    if (!walletAddress) { setBalance(null); setUsdcBalance(0); return }
    setLoadingBalance(true)
    setBalanceUnavailable(false)
    try {
      if (evmAddress) { setBalance(await getMegaEthBalance(evmAddress)); setUsdcBalance(0) }
      else if (publicKey) {
        const lamports = await getDevnetBalance(publicKey)
        setBalance(lamports / LAMPORTS_PER_SOL)
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: DEVNET_USDC_MINT }).catch(() => null)
        setUsdcBalance(tokenAccounts?.value.reduce((total, account) => total + Number((account.account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } }).parsed?.info?.tokenAmount?.uiAmount ?? 0), 0) ?? 0)
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setMessage(/429|too many requests|rate.?limit/i.test(detail)
        ? 'Balance display is temporarily unavailable. The entry transaction will check your balance when you play.'
        : `Balance display is unavailable. Your wallet will still reject entry if it lacks 0.01 ${evmAddress ? 'testnet ETH' : 'SOL'} plus the fee.`)
      setBalanceUnavailable(true)
    } finally { setLoadingBalance(false) }
  }, [connection, evmAddress, publicKey, walletAddress])

  useEffect(() => { refreshBalance() }, [refreshBalance])
  useEffect(() => {
    if (!walletAddress) { setProfileLoaded(false); return }
    let active = true
    const network = isMegaEth ? 'megaeth' : 'solana'
    setDisplayName('')
    setNextNameChangeAt(0)
    setProfileLoaded(false)
    fetch(`/api/profile?network=${network}&wallet=${encodeURIComponent(walletAddress)}`)
      .then(async response => response.ok ? response.json() as Promise<{ displayName?: string; nextChangeAt?: number; avatarUrl?: string }> : Promise.reject())
      .then(profile => {
        if (!active) return
        setDisplayName(profile.displayName ?? ''); setNextNameChangeAt(profile.nextChangeAt ?? 0)
        setProfileLoaded(true)
        if (profile.avatarUrl) {
          setHeaderAvatar(profile.avatarUrl)
          localStorage.setItem(`testnet-games:avatar:${isMegaEth ? 'megaeth' : 'solana'}:${walletAddress}`, profile.avatarUrl)
          window.dispatchEvent(new CustomEvent('profile-avatar-updated', { detail: { wallet: walletAddress, network: isMegaEth ? 'megaeth' : 'solana', avatar: profile.avatarUrl } }))
        }
      })
      .catch(() => { if (active) { setDisplayName(''); setNextNameChangeAt(0); setProfileLoaded(true) } })
    return () => { active = false }
  }, [isMegaEth, walletAddress])

  const changeDisplayName = async (name: string) => {
    if (!walletAddress) return
    setSavingName(true)
    try {
      const network = isMegaEth ? 'megaeth' : 'solana'
      const cleanName = name.trim().replace(/\s+/g, ' ')
      const timestamp = Date.now()
      const normalizedWallet = isMegaEth ? walletAddress.toLowerCase() : walletAddress
      const messageToSign = `Testnet Games name change\nNetwork: ${network}\nWallet: ${normalizedWallet}\nName: ${cleanName}\nTimestamp: ${timestamp}`
      let signature: string
      if (isMegaEth) {
        const provider = getMetaMaskProvider()
        if (!provider) throw new Error('MetaMask is unavailable.')
        signature = await provider.request<string>({ method: 'personal_sign', params: [messageToSign, walletAddress] })
      } else if (localWallet) {
        signature = bs58.encode(ed25519.sign(new TextEncoder().encode(messageToSign), localWallet.secretKey.slice(0, 32)))
      } else {
        if (!external.signMessage) throw new Error('This wallet does not support message signing.')
        signature = bs58.encode(await external.signMessage(new TextEncoder().encode(messageToSign)))
      }
      const response = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ network, wallet: walletAddress, displayName: cleanName, timestamp, signature }) })
      const body = await response.json() as { displayName?: string; nextChangeAt?: number; message?: string }
      if (!response.ok) throw new Error(body.message ?? 'Could not change name.')
      setDisplayName(body.displayName ?? cleanName)
      setNextNameChangeAt(body.nextChangeAt ?? Date.now() + 10 * 60_000)
      setMessage('Worldwide name updated.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not change name.') }
    finally { setSavingName(false) }
  }
  const changeAvatar = async (avatarUrl: string) => {
    if (!walletAddress) return
    try {
      const network = isMegaEth ? 'megaeth' : 'solana'
      const normalizedWallet = isMegaEth ? walletAddress.toLowerCase() : walletAddress
      const timestamp = Date.now()
      const hash = Array.from(sha256(new TextEncoder().encode(avatarUrl)), byte => byte.toString(16).padStart(2, '0')).join('')
      const messageToSign = `Testnet Games avatar change\nNetwork: ${network}\nWallet: ${normalizedWallet}\nAvatar SHA-256: ${hash}\nTimestamp: ${timestamp}`
      let signature: string
      if (isMegaEth) {
        const provider = getMetaMaskProvider()
        if (!provider) throw new Error('MetaMask is unavailable.')
        signature = await provider.request<string>({ method: 'personal_sign', params: [messageToSign, walletAddress] })
      } else if (localWallet) signature = bs58.encode(ed25519.sign(new TextEncoder().encode(messageToSign), localWallet.secretKey.slice(0, 32)))
      else {
        if (!external.signMessage) throw new Error('This wallet does not support message signing.')
        signature = bs58.encode(await external.signMessage(new TextEncoder().encode(messageToSign)))
      }
      const response = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'avatar', network, wallet: walletAddress, avatarUrl, timestamp, signature }) })
      const body = await response.json() as { message?: string }
      if (!response.ok) throw new Error(body.message ?? 'Could not save profile picture.')
      setHeaderAvatar(avatarUrl); setMessage(avatarUrl ? 'Profile picture saved worldwide.' : 'Profile picture removed.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save profile picture.') }
  }
  const chooseExternal = (name: WalletName, readyState: WalletReadyState) => {
    if (readyState !== WalletReadyState.Installed && readyState !== WalletReadyState.Loadable) {
      setMessage(`${name} is not installed in this browser.`)
      return
    }
    setEvmAddress(null)
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
      localStorage.setItem('testnet-games:last-wallet', 'solana-extension')
      setEvmAddress(null)
      trackAnalytics('wallet_connected', { wallet_type: String(pendingWallet), network: 'solana_devnet' })
      setPendingWallet(null)
      setModal(false)
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : `Could not connect ${pendingWallet}. Check that the extension is unlocked and try again.`)
    }
  }

  const activateSiteWallet = async (wallet: Keypair) => {
    if (external.connected) await external.disconnect()
    setEvmAddress(null)
    setLocalWallet(wallet)
    localStorage.setItem('testnet-games:last-wallet', 'site-wallet')
    trackAnalytics('wallet_connected', { wallet_type: 'site_wallet', network: 'solana_devnet' })
  }

  const activateMetaMask = async () => {
    setConnectingMetaMask(true)
    try {
      const account = await connectMetaMask()
      if (external.connected) await external.disconnect()
      setLocalWallet(null)
      setEvmAddress(account)
      localStorage.setItem('testnet-games:last-wallet', 'metamask')
      trackAnalytics('wallet_connected', { wallet_type: 'metamask', network: 'megaeth_testnet' })
      setPendingWallet(null)
      setModal(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not connect MetaMask.')
    } finally { setConnectingMetaMask(false) }
  }

  useEffect(() => {
    const provider = getMetaMaskProvider()
    if (!provider?.on) return
    const accountsChanged = (...args: unknown[]) => {
      if (!evmAddress) return
      const accounts = Array.isArray(args[0]) ? args[0] as string[] : []
      setEvmAddress(accounts[0] ?? null)
      setBalance(null)
      setDisplayName('')
      setProfileLoaded(false)
      setUsdcBalance(0)
      setHeaderAvatar('')
      setShowProfile(false)
      setShowAffiliates(false)
      setInGame(false)
    }
    const chainChanged = () => { if (evmAddress) void refreshBalance() }
    provider.on('accountsChanged', accountsChanged)
    provider.on('chainChanged', chainChanged)
    return () => {
      provider.removeListener?.('accountsChanged', accountsChanged)
      provider.removeListener?.('chainChanged', chainChanged)
    }
  }, [evmAddress, refreshBalance])

  const disconnect = async () => {
    const metaMaskProvider = evmAddress ? getMetaMaskProvider() : null
    localStorage.removeItem('testnet-games:last-wallet')
    setShowProfile(false)
    setShowAffiliates(false)
    setInGame(false)
    setProfileMenu(false)
    setViewedProfile(null)
    setDisplayName('')
    setProfileLoaded(false)
    setNextNameChangeAt(0)
    setHeaderAvatar('')
    setMessage('')
    setEvmAddress(null)
    setLocalWallet(null)
    setPendingWallet(null)
    setBalance(null)
    setUsdcBalance(0)
    setBalanceUnavailable(false)
    try {
      if (external.connected) await external.disconnect()
      external.select(null)
      if (metaMaskProvider) {
        await metaMaskProvider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }).catch(() => undefined)
      }
    } finally {
      setStep('choose')
      setModal(true)
    }
  }

  const copyAddress = async () => {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setMessage('Address copied.')
  }

  const accessScreen = Boolean(connected && walletAddress && !showProfile && !showAffiliates && !inGame)
  useEffect(() => {
    if (accessScreen) window.scrollTo({ top: 0, left: 0 })
  }, [accessScreen, walletAddress])

  return <div className={`shell ${accessScreen ? 'access-shell' : ''}`}>
    <header>
      <button type="button" className="logo" onClick={() => { setShowProfile(false); setShowAffiliates(false); setInGame(false); setProfileMenu(false) }}><span className="dino-skull-logo"><img className="dino-skull-upper" src={dinoSkullUpper} alt="" /><img className="dino-skull-jaw" src={dinoSkullJaw} alt="" /></span><strong className="logo-title">DINOGAME</strong></button>
      {connected && walletAddress ? <div className="header-actions"><HeaderBalance balance={balance} network={isMegaEth ? 'megaeth' : 'solana'} solanaWallet={isMegaEth ? null : publicKey} connection={connection} /><div className="header-profile" onMouseEnter={() => setProfileMenu(true)} onMouseLeave={() => setProfileMenu(false)} onFocus={() => setProfileMenu(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setProfileMenu(false) }}><button className="header-avatar" onClick={openProfileButton} aria-label="Open profile menu">{headerAvatar ? <img src={headerAvatar} alt="Profile" /> : <span>{(displayName || walletAddress).slice(0, 1).toUpperCase()}</span>}</button>{profileMenu && <div className="profile-menu"><button onClick={() => openProfile('statistics')}><BarChart3 /> Statistics</button><button onClick={openAffiliates}><Share2 /> Affiliates</button><button onClick={() => openProfile('settings')}><Settings /> Settings</button><button onClick={() => openProfile('transactions')}><Wallet /> Transactions</button><button onClick={() => void disconnect()}><LogOut /> Disconnect</button></div>}</div></div> : <button className="header-connect" onClick={() => { setStep('choose'); setModal(true) }}>Connect wallet</button>}
    </header>
    <ChatRail wallet={walletAddress} network={isMegaEth ? 'megaeth' : 'solana'} displayName={displayName} onViewProfile={viewChatProfile} />

    <main>
      {!connected ? <Landing onConnect={() => { setStep('choose'); setModal(true) }} /> : showAffiliates && walletAddress ? (
        <AffiliatesPage wallet={walletAddress} onBack={() => setShowAffiliates(false)} />
      ) : showProfile && walletAddress && viewedProfile ? (
        <ProfilePage isOwn={viewedProfile.wallet === walletAddress && viewedProfile.network === (isMegaEth ? 'megaeth' : 'solana')} initialSection={profileSection} wallet={viewedProfile.wallet} network={viewedProfile.network} displayName={displayName} canChangeName={!balanceUnavailable && balance !== null && balance > NAME_BALANCE} savingName={savingName} nextNameChangeAt={nextNameChangeAt} onChangeName={changeDisplayName} onChangeAvatar={changeAvatar} onBack={() => setShowProfile(false)} />
      ) : inGame && walletAddress ? (
        <SingleplayerDinoGame address={walletAddress} paymentNetwork={isMegaEth ? 'megaeth' : 'solana'} localWallet={localWallet} sendTransaction={external.sendTransaction} signTransaction={external.signTransaction as ((transaction: Transaction) => Promise<Transaction>) | undefined} connection={connection} onViewProfile={viewChatProfile} onExit={() => setInGame(false)} />
      ) : (
        <WalletView
          address={walletAddress!}
          balance={balance}
          eligible={eligible}
          walletUsdValue={walletUsdValue}
          profileLoaded={profileLoaded}
          balanceUnavailable={balanceUnavailable}
          currency={isMegaEth ? 'ETH' : 'SOL'}
          joinFee={0.01}
          faucetUrl={isMegaEth ? MEGAETH_FAUCET_URL : 'https://faucet.solana.com/'}
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
          onEnter={() => { if (eligible && profileLoaded && displayName) setInGame(true) }}
          displayName={displayName}
          canChangeName={!displayName ? eligible : !balanceUnavailable && balance !== null && balance > NAME_BALANCE}
          nextNameChangeAt={nextNameChangeAt}
          savingName={savingName}
          onChangeName={changeDisplayName}
          onProfile={() => openProfile('statistics')}
        />
      )}
    </main>

    <footer><span>TESTNET ONLY</span><p>Game entry fee: 0.01 {isMegaEth ? 'MegaETH testnet ETH' : 'SOL'}</p><a href={isMegaEth ? 'https://docs.megaeth.com/testnet' : 'https://github.com/anza-xyz/wallet-adapter'} target="_blank" rel="noreferrer">{isMegaEth ? 'MegaETH Testnet Docs' : 'Powered by Anza Wallet Adapter'} <ExternalLink /></a></footer>

    {modal && <WalletModal
      step={step}
      setStep={setStep}
      wallets={external.wallets}
      pendingWallet={pendingWallet}
      connecting={external.connecting}
      selectedReady={Boolean(pendingWallet && external.wallet?.adapter.name === pendingWallet)}
      stored={hasStoredWallet()}
      connectingMetaMask={connectingMetaMask}
      onMetaMask={activateMetaMask}
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
    <div className="badge"><Sparkles /> SOLANA + MEGAETH TESTNET</div>
    <h1 className="join-title">JOIN NOW</h1>
    <p>Connect Phantom or Solflare for Solana devnet, use MetaMask for MegaETH testnet, or create an encrypted Solana site wallet.</p>
    <button className="hero-button" onClick={onConnect}><Wallet /> CONNECT WALLET <ArrowRight /></button>
  </section>
}

function WalletView({ address, balance, eligible, walletUsdValue, profileLoaded, balanceUnavailable, loading, type, currency, joinFee, faucetUrl, localWallet, displayName, canChangeName, nextNameChangeAt, savingName, onRefresh, onCopy, onDisconnect, onExport, onForget, onEnter, onChangeName, onProfile }: {
  address: string; balance: number | null; eligible: boolean; walletUsdValue: number | null; profileLoaded: boolean; balanceUnavailable: boolean; loading: boolean; type: string; currency: string; joinFee: number; faucetUrl: string; localWallet: Keypair | null;
  displayName: string; canChangeName: boolean; nextNameChangeAt: number; savingName: boolean;
  onRefresh: () => void; onCopy: () => void; onDisconnect: () => void; onExport: () => void; onForget: () => void; onEnter: () => void; onChangeName: (name: string) => Promise<void>; onProfile: () => void;
}) {
  const [firstUsername, setFirstUsername] = useState('')
  const validFirstUsername = /^[A-Za-z0-9][A-Za-z0-9 _-]{1,18}[A-Za-z0-9]$/.test(firstUsername.trim())
  const needsUsername = profileLoaded && !displayName
  const canEnter = eligible && profileLoaded && !needsUsername
  return <section className="wallet-page">
    <div className="wallet-heading"><div><span>CONNECTED WALLET</span><h1>{eligible ? 'Access granted.' : 'Value required.'}</h1></div><div className="wallet-actions"><button onClick={onProfile}>View profile</button><button onClick={onDisconnect}><LogOut /> Disconnect</button></div></div>
    <div className="account-grid">
      <article className="balance-card">
        <div className="account-line"><span className="wallet-symbol"><Wallet /></span><div><small>{type.toUpperCase()}</small><strong>{short(address)}</strong></div><button onClick={onCopy} aria-label="Copy address"><Copy /></button></div>
        <p>TESTNET BALANCE <button onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /></button></p>
        <h2>{balanceUnavailable ? 'RPC BUSY' : balance === null ? '—' : balance.toFixed(4)} {!balanceUnavailable && <span>{currency}</span>}</h2>
        <small className="wallet-usd-value">{walletUsdValue === null ? 'CHECKING LIVE USD VALUE' : `SUPPORTED WALLET VALUE · $${walletUsdValue.toFixed(2)}`}</small>
        <div className={`gate-status ${eligible ? 'passed' : ''}`}><span>{eligible ? <Check /> : <LockKeyhole />}</span><div><strong>{eligible ? 'More than $8 verified' : 'More than $8 in supported assets required'}</strong><p>{eligible ? `This wallet also has enough ${currency} for the game entry.` : balanceUnavailable ? 'Wallet value could not be verified. Refresh and try again.' : `Hold over $8 total in ${currency}${currency === 'SOL' ? ' and Solana USDC' : ''}, plus enough native currency for the entry fee.`}</p></div></div>
      </article>
      <aside className="action-card">
        {eligible ? <><span className="success-mark"><Check /></span><h2>{needsUsername ? 'Username required' : profileLoaded ? 'You are in' : 'Checking profile'}</h2><p>{needsUsername ? 'Choose your permanent first username below before entering.' : profileLoaded ? 'Your wallet passed the $8 supported-value requirement.' : 'Checking whether this wallet already has a profile.'}</p><button className="primary" disabled={!profileLoaded} onClick={needsUsername ? () => document.getElementById('first-wallet-username')?.focus() : onEnter}>{needsUsername ? 'CHOOSE USERNAME' : 'ENTER DAPP'} <ArrowRight /></button></> : <><span className="warning-mark"><AlertTriangle /></span><h2>Over $8 required</h2><p>Add supported testnet assets, then refresh the wallet value.</p><a className="primary" href={faucetUrl} target="_blank" rel="noreferrer">OPEN TESTNET FAUCET <ExternalLink /></a></>}
      </aside>
    </div>
    {needsUsername && <form className="first-name-card" onSubmit={event => { event.preventDefault(); if (canChangeName && validFirstUsername) void onChangeName(firstUsername) }}><div><span>REQUIRED FIRST-TIME SETUP</span><strong>Choose your worldwide username</strong><small>This appears once for each wallet. Later changes move to Profile Settings.</small></div><input id="first-wallet-username" value={firstUsername} onChange={event => setFirstUsername(event.target.value)} maxLength={20} placeholder="3–20 characters" /><button disabled={!canChangeName || !validFirstUsername || savingName}>{savingName ? 'Saving…' : canChangeName ? 'Save username' : '$8+ value required'}</button></form>}
    {localWallet && <div className="local-tools"><div><ShieldCheck /><p><strong>Browser-local site wallet</strong><span>Encrypted on this device. Keep an offline recovery file.</span></p></div><div><button onClick={onExport}><Download /> Export recovery</button><button className="danger" onClick={onForget}><Trash2 /> Forget wallet</button></div></div>}
    {!canEnter && <div className="blocked-note"><LockKeyhole /> The game stays locked until this wallet has a username, more than $8 in supported value, and enough {currency} for the entry fee.</div>}
  </section>
}

function WalletModal({ step, setStep, wallets, pendingWallet, connecting, connectingMetaMask, selectedReady, stored, onExternal, onConnectExternal, onMetaMask, onClose, onCreated, onUnlocked }: {
  step: ModalStep; setStep: (step: ModalStep) => void; wallets: ReturnType<typeof useWallet>['wallets']; pendingWallet: WalletName | null; connecting: boolean; connectingMetaMask: boolean; selectedReady: boolean; stored: boolean;
  onExternal: (name: WalletName, state: WalletReadyState) => void; onConnectExternal: () => void; onMetaMask: () => void; onClose: () => void; onCreated: (wallet: Keypair) => Promise<void>; onUnlocked: (wallet: Keypair) => Promise<void>;
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
    {step === 'choose' && <><div className="modal-title"><span><Wallet /></span><div><h2>Connect wallet</h2><p>Choose Solana devnet or MetaMask on MegaETH testnet.</p></div></div><div className="wallet-list"><button onClick={onMetaMask} disabled={connectingMetaMask}><span className="metamask-mark">M</span><div><strong>MetaMask</strong><small>MegaETH testnet</small></div>{connectingMetaMask ? <LoaderCircle className="spin" /> : <ChevronRight />}</button>{visibleWallets.map(item => <button className={pendingWallet === item.adapter.name ? 'selected' : ''} key={item.adapter.name} onClick={() => onExternal(item.adapter.name, item.readyState)}><img src={item.adapter.icon} alt="" /><div><strong>{item.adapter.name}</strong><small>{item.readyState === WalletReadyState.Installed ? 'Detected' : item.readyState}</small></div>{pendingWallet === item.adapter.name ? <Check /> : <ChevronRight />}</button>)}</div>{pendingWallet && <button className="primary external-connect" disabled={!selectedReady || connecting} onClick={onConnectExternal}>{connecting ? <><LoaderCircle className="spin" /> CONNECTING...</> : <>CONNECT {pendingWallet.toUpperCase()} <ArrowRight /></>}</button>}<div className="divider"><span>OR</span></div>{stored ? <button className="site-option" onClick={() => setStep('unlock')}><span><LockKeyhole /></span><div><strong>Unlock Solana site wallet</strong><small>An encrypted wallet exists on this device</small></div><ChevronRight /></button> : <button className="site-option" onClick={() => setStep('create')}><span><KeyRound /></span><div><strong>Create Solana site wallet</strong><small>Encrypted and stored only in this browser</small></div><ChevronRight /></button>}</>}
    {step === 'create' && <form onSubmit={create}><div className="form-icon"><KeyRound /></div><h2>Create site wallet</h2><p>A new Solana keypair will be encrypted with your password and stored in this browser.</p><label>PASSWORD<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 10 characters" autoFocus /></label><label>CONFIRM PASSWORD<input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>{error && <div className="form-error"><AlertTriangle />{error}</div>}<button className="primary" disabled={busy}>{busy ? 'CREATING…' : 'CREATE WALLET'} <ArrowRight /></button></form>}
    {step === 'unlock' && <form onSubmit={unlock}><div className="form-icon"><LockKeyhole /></div><h2>Unlock site wallet</h2><p>Your password decrypts the wallet locally. It is never transmitted.</p><label>PASSWORD<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoFocus /></label>{error && <div className="form-error"><AlertTriangle />{error}</div>}<button className="primary" disabled={busy}>{busy ? 'UNLOCKING…' : 'UNLOCK WALLET'} <ArrowRight /></button><label className="import-button">IMPORT RECOVERY FILE<input type="file" accept="application/json" onChange={e => importFile(e.target.files?.[0])} /></label></form>}
    {step === 'backup' && createdWallet && <div className="backup"><span className="warning-mark"><AlertTriangle /></span><h2>Back up your wallet now</h2><p>This is the only recovery copy. If browser storage is cleared and you do not have it, the wallet cannot be recovered.</p><div className="address-box"><small>PUBLIC ADDRESS</small><code>{createdWallet.publicKey.toBase58()}</code></div><button className="primary" onClick={() => exportRecovery(createdWallet)}><Download /> DOWNLOAD RECOVERY FILE</button><button className="text-button" onClick={onClose}>I saved it — continue</button></div>}
  </div></div>
}

export default App
