import { FormEvent, useEffect, useState } from 'react'
import { Gift, RotateCcw, Sparkles, Trophy, X } from 'lucide-react'

type Network = 'solana' | 'megaeth'
type RewardAction = 'daily-case' | 'cashback'
type RewardData = {
  dinoTokens: number
  cashbackMicrosol: number
  caseAvailable: boolean
  tokensPerSol: number
  leaderboard: { rank: number; wallet: string; network: Network; tokens: number; name: string }[]
}
const formatTokens = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 4 })
const formatSol = (microsol: number) => (microsol / 1_000_000).toFixed(4)

export default function RewardsPage({ wallet, network, onClaim, onCloseMenu }: { wallet: string; network: Network; onClaim: (action: RewardAction) => Promise<{ prize?: { label: string; chance: string }; message?: string }>; onCloseMenu: () => void }) {
  const [data, setData] = useState<RewardData | null>(null)
  const [caseOpen, setCaseOpen] = useState(false)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const [claiming, setClaiming] = useState<RewardAction | null>(null)
  const [result, setResult] = useState<{ label: string; chance: string } | null>(null)
  const [error, setError] = useState('')
  const refresh = () => fetch(`/api/rewards?network=${network}&wallet=${encodeURIComponent(wallet)}`).then(response => response.ok ? response.json() as Promise<RewardData> : Promise.reject()).then(setData).catch(() => setError('Rewards are temporarily unavailable.'))
  useEffect(() => { void refresh() }, [network, wallet])
  const claim = async (action: RewardAction) => {
    setClaiming(action); setError('')
    try {
      const response = await onClaim(action)
      if (response.prize) setResult(response.prize)
      await refresh()
    } catch (claimError) { setError(claimError instanceof Error ? claimError.message : 'Reward claim failed.') }
    finally { setClaiming(null) }
  }
  return <>
    <div className="rewards-dropdown" onMouseLeave={onCloseMenu}>
      <div className="rewards-dropdown-banner"><div><small>Claim your</small><strong>Rewards</strong></div><Gift /></div>
      <button type="button" className="reward-row" onClick={() => { setCaseOpen(true); onCloseMenu() }}><span className="reward-row-icon case"><Gift /></span><span><strong>Daily Case</strong><small className={data?.caseAvailable ? 'ready' : ''}>{data?.caseAvailable ? 'Ready to open' : 'Opened today'}</small></span><b>Claim</b></button>
      <button type="button" className="reward-row" onClick={() => void claim('cashback')} disabled={!data || data.cashbackMicrosol <= 0 || claiming !== null}><span className="reward-row-icon cash"><RotateCcw /></span><span><strong>Cashback</strong><small>{data ? `${formatSol(data.cashbackMicrosol)} SOL` : 'Loading...'}</small></span><b>{claiming === 'cashback' ? '...' : 'Claim'}</b></button>
      <button type="button" className="reward-token-row" onClick={() => { setLeaderboardOpen(true); onCloseMenu() }}><span className="dt-icon">DT</span><span><small>Dino Tokens</small><strong>{data ? formatTokens(data.dinoTokens) : '0.00'}</strong></span><Trophy /></button>
    </div>
    {caseOpen && <div className="reward-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCaseOpen(false) }}><section className="daily-case-modal"><button type="button" onClick={() => setCaseOpen(false)} aria-label="Close Daily Case"><X /></button><header><Gift /><strong>DAILY CASE</strong></header><div className="daily-case-main"><span className="case-chest"><Gift /></span><h2>{result ? 'Case opened!' : 'Dino Case'}</h2><p>{result ? `${result.label} · ${result.chance}` : 'Open one case every day. Rewards are added to your testnet rewards ledger.'}</p><button type="button" className="open-case" disabled={!data?.caseAvailable || claiming !== null} onClick={() => void claim('daily-case')}><Sparkles /> {claiming === 'daily-case' ? 'OPENING...' : result ? 'OPENED TODAY' : 'OPEN CASE'}</button></div><div className="case-items"><span>Items</span><div><b>10 SOL credit <small>0.001%</small></b><b>2.5 SOL credit <small>0.004%</small></b><b>1 SOL credit <small>0.009%</small></b><b>0.1 SOL credit <small>0.076%</small></b><b>0.001 SOL credit <small>10.335%</small></b><b>15 DT <small>89.575%</small></b></div></div>{error && <p className="reward-error">{error}</p>}</section></div>}
    {leaderboardOpen && <div className="reward-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setLeaderboardOpen(false) }}><section className="dt-leaderboard-modal"><button type="button" onClick={() => setLeaderboardOpen(false)} aria-label="Close Dino Tokens leaderboard"><X /></button><header><span className="dt-icon">DT</span><div><small>DINO TOKENS</small><h2>Leaderboard</h2></div></header><p>Earn <strong>{data?.tokensPerSol ?? 64} DT</strong> for every SOL-equivalent wager, plus Daily Case rewards.</p><div className="dt-your-stats"><span>Your DT</span><strong>{data ? formatTokens(data.dinoTokens) : '0.00'} <i>DT</i></strong></div><div className="dt-table"><div><span>#</span><span>Player</span><span>Tokens</span></div>{data?.leaderboard.length ? data.leaderboard.map(row => <div key={`${row.network}:${row.wallet}`}><span>{row.rank}</span><strong>{row.name}</strong><b>{formatTokens(row.tokens)} <i>DT</i></b></div>) : <p>No Dino Tokens have been earned yet.</p>}</div></section></div>}
  </>
}
