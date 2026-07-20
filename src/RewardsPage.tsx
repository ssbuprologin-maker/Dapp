import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Gift, RotateCcw, Sparkles, Trophy, X } from 'lucide-react'

type Network = 'solana' | 'megaeth'
type RewardAction = 'daily-case' | 'cashback'
type CaseVerification = { commitment: string; seed: string; day: string; resultHash: string; roll: number }
type RewardData = { dinoTokens: number; cashbackMicrosol: number; caseAvailable: boolean; caseCommitment: string; caseDay: string; tokensPerDollar: number; leaderboard: { rank: number; wallet: string; network: Network; tokens: number; name: string }[] }
const formatTokens = (value: number) => {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}
const formatSol = (microsol: number) => (microsol / 1_000_000).toFixed(4)

export default function RewardsPage({ wallet, network, onClaim, onOpenLeaderboard }: { wallet: string; network: Network; onClaim: (action: RewardAction, caseCommitment?: string) => Promise<{ prize?: { label: string; chance: string }; message?: string; verification?: CaseVerification }>; onOpenLeaderboard: () => void }) {
  const [data, setData] = useState<RewardData | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [cashbackOpen, setCashbackOpen] = useState(false)
  const [caseOpen, setCaseOpen] = useState(false)
  const [claiming, setClaiming] = useState<RewardAction | null>(null)
  const [result, setResult] = useState<{ label: string; chance: string } | null>(null)
  const [verification, setVerification] = useState<CaseVerification | null>(null)
  const [casePhase, setCasePhase] = useState<'idle' | 'mining' | 'revealed'>('idle')
  const [error, setError] = useState('')
  const closeTimer = useRef<number | null>(null)
  const refresh = () => fetch(`/api/rewards?network=${network}&wallet=${encodeURIComponent(wallet)}`).then(response => response.ok ? response.json() as Promise<RewardData> : Promise.reject()).then(setData).catch(() => setError('Rewards are temporarily unavailable.'))
  useEffect(() => { void refresh() }, [network, wallet])
  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current) }, [])
  const keepMenuOpen = () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); setMenuOpen(true) }
  const scheduleMenuClose = () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => { setMenuOpen(false); setCashbackOpen(false) }, 85) }
  const claim = async (action: RewardAction) => {
    setClaiming(action); setError('')
    if (action === 'daily-case') setCasePhase('mining')
    try {
      const response = await onClaim(action, action === 'daily-case' ? data?.caseCommitment : undefined)
      if (response.prize) window.setTimeout(() => { setResult(response.prize!); setVerification(response.verification ?? null); setCasePhase('revealed') }, 1900)
      await refresh()
    }
    catch (claimError) { setError(claimError instanceof Error ? claimError.message : 'Reward claim failed.'); if (action === 'daily-case') setCasePhase('idle') }
    finally { setClaiming(null) }
  }
  const activeLabel = network === 'solana' ? 'SOL' : 'EVM'
  return <>
    <div className="rewards-header-controls">
      <button type="button" className="header-dt-balance" onClick={onOpenLeaderboard} aria-label="Open Dino Tokens leaderboard"><span className="dt-icon">DT</span><strong>{data ? formatTokens(data.dinoTokens) : '0.00'}</strong></button>
      <div className="header-daily-case-wrap" onMouseEnter={keepMenuOpen} onMouseLeave={scheduleMenuClose}>
        <button type="button" className="header-daily-case" onClick={keepMenuOpen}><Gift /> Rewards</button>
        {menuOpen && <div className="rewards-dropdown" onMouseEnter={keepMenuOpen} onMouseLeave={scheduleMenuClose}>
          <div className="rewards-dropdown-banner"><div><small>Claim your</small><strong>Rewards</strong></div><Gift /></div>
          <button type="button" className="reward-row" onClick={() => { setResult(null); setVerification(null); setCasePhase('idle'); setCaseOpen(true) }}><span className="reward-row-icon case"><Gift /></span><span><strong>Daily Case</strong><small className={data?.caseAvailable ? 'ready' : ''}>{data?.caseAvailable ? 'Ready to open' : 'Opened today'}</small></span><b>Open</b></button>
          <div className="cashback-menu-wrap" onMouseEnter={() => setCashbackOpen(true)} onMouseLeave={() => setCashbackOpen(false)}>
            <button type="button" className="reward-row cashback-row"><span className="reward-row-icon cash"><RotateCcw /></span><span><strong>Cashback</strong><small>{data ? `${formatSol(data.cashbackMicrosol)} SOL` : 'Loading...'}</small></span><b>{activeLabel}</b></button>
            {cashbackOpen && <div className="cashback-network-menu"><strong>Claim cashback</strong><button type="button" className={network === 'solana' ? 'active' : ''} disabled={network !== 'solana' || !data || data.cashbackMicrosol <= 0 || claiming !== null} onClick={() => void claim('cashback')}>SOL <span>{network === 'solana' ? `${formatSol(data?.cashbackMicrosol ?? 0)} SOL` : 'Connect Solana'}</span></button><button type="button" className={network === 'megaeth' ? 'active' : ''} disabled={network !== 'megaeth' || !data || data.cashbackMicrosol <= 0 || claiming !== null} onClick={() => void claim('cashback')}>EVM <span>{network === 'megaeth' ? `${formatSol(data?.cashbackMicrosol ?? 0)} SOL-EQ` : 'Connect EVM'}</span></button></div>}
          </div>
        </div>}
      </div>
    </div>
    {caseOpen && createPortal(<div className="reward-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCaseOpen(false) }}><section className="daily-case-modal"><button type="button" onClick={() => setCaseOpen(false)} aria-label="Close Daily Case"><X /></button><header><Gift /><strong>DAILY CASE</strong></header><div className="daily-case-main"><span className={`case-chest ${casePhase === 'mining' ? 'mining' : ''}`}><Gift /></span><h2>{casePhase === 'mining' ? 'Mining case block…' : result ? 'Case opened!' : 'Dino Case'}</h2><p>{casePhase === 'mining' ? 'Your committed case result is being revealed.' : result ? `${result.label} - ${result.chance}` : 'One committed case can be opened every day.'}</p><div className={`case-reel ${casePhase === 'mining' ? 'is-spinning' : ''}`}><div><span>15 DT</span><span>0.001 SOL</span><strong>{result?.label ?? 'DAILY CASE'}</strong><span>0.1 SOL</span><span>15 DT</span></div></div><button type="button" className="open-case" disabled={!data?.caseAvailable || claiming !== null || casePhase === 'revealed'} onClick={() => void claim('daily-case')}><Sparkles /> {casePhase === 'mining' ? 'MINING…' : result ? 'OPENED TODAY' : 'OPEN CASE'}</button>{verification && <details className="case-verification"><summary>Verified result · case block mined</summary><code>Commit: {verification.commitment}</code><code>Seed: {verification.seed}</code><code>Hash: {verification.resultHash} · Roll: {verification.roll}</code></details>}</div><div className="case-items"><span>Items</span><div><b>10 SOL credit <small>0.001%</small></b><b>2.5 SOL credit <small>0.004%</small></b><b>1 SOL credit <small>0.009%</small></b><b>0.1 SOL credit <small>0.076%</small></b><b>0.001 SOL credit <small>10.335%</small></b><b>15 DT <small>89.575%</small></b></div></div>{error && <p className="reward-error">{error}</p>}</section></div>, document.body)}
    {/*
    {caseOpen && <div className="reward-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCaseOpen(false) }}><section className="daily-case-modal"><button type="button" onClick={() => setCaseOpen(false)} aria-label="Close Daily Case"><X /></button><header><Gift /><strong>DAILY CASE</strong></header><div className="daily-case-main"><span className="case-chest"><Gift /></span><h2>{result ? 'Case opened!' : 'Dino Case'}</h2><p>{result ? `${result.label} · ${result.chance}` : 'Open one case every day. Rewards are added to your testnet rewards ledger.'}</p><button type="button" className="open-case" disabled={!data?.caseAvailable || claiming !== null} onClick={() => void claim('daily-case')}><Sparkles /> {claiming === 'daily-case' ? 'OPENING...' : result ? 'OPENED TODAY' : 'OPEN CASE'}</button></div><div className="case-items"><span>Items</span><div><b>10 SOL credit <small>0.001%</small></b><b>2.5 SOL credit <small>0.004%</small></b><b>1 SOL credit <small>0.009%</small></b><b>0.1 SOL credit <small>0.076%</small></b><b>0.001 SOL credit <small>10.335%</small></b><b>15 DT <small>89.575%</small></b></div></div>{error && <p className="reward-error">{error}</p>}</section></div>}
    */}
  </>
}
