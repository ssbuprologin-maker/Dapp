import { useEffect, useState } from 'react'
import { ArrowLeft, Trophy } from 'lucide-react'

type Network = 'solana' | 'megaeth'
type RewardData = { dinoTokens: number; tokensPerDollar: number; leaderboard: { rank: number; wallet: string; network: Network; tokens: number; name: string }[] }
const formatTokens = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 4 })

export default function DinoTokensPage({ wallet, network, onBack }: { wallet: string; network: Network; onBack: () => void }) {
  const [data, setData] = useState<RewardData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { fetch(`/api/rewards?network=${network}&wallet=${encodeURIComponent(wallet)}`).then(response => response.ok ? response.json() as Promise<RewardData> : Promise.reject()).then(setData).catch(() => setError('Dino Token data is temporarily unavailable.')) }, [network, wallet])
  return <section className="dino-tokens-page"><button type="button" className="dt-back" onClick={onBack}><ArrowLeft /> Back to game</button><header><span className="dt-icon">DT</span><div><small>DINO TOKENS</small><h1>Leaderboard</h1></div></header><p className="dt-page-intro">Earn <strong>{data?.tokensPerDollar ?? 1} DT per $1 wagered</strong>, plus Daily Case rewards.</p><section className="dt-page-stats"><span>Your Dino Tokens</span><strong>{data ? formatTokens(data.dinoTokens) : '0.00'} <i>DT</i></strong><Trophy /></section><section className="dt-page-table"><div className="dt-page-table-head"><span>Rank</span><span>Player</span><span>Total DT</span></div>{data?.leaderboard.length ? data.leaderboard.map(row => <div className="dt-page-row" key={`${row.network}:${row.wallet}`}><span>#{row.rank}</span><strong>{row.name}</strong><b>{formatTokens(row.tokens)} <i>DT</i></b></div>) : <p>{error || 'No Dino Tokens have been earned yet.'}</p>}</section></section>
}
