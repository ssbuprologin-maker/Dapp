import { useEffect, useMemo, useState, WheelEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { Connection, PublicKey } from '@solana/web3.js'

const DEVNET_USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
type Coin = 'SOL' | 'ETH' | 'USDC'
type Prices = { solUsd: number | null; ethUsd: number | null; usdcUsd: number; updatedAt: number }
const coins: Coin[] = ['SOL', 'ETH', 'USDC']

function CoinIcon({ coin }: { coin: Coin | 'USD' }) {
  if (coin === 'SOL') return <i className="header-coin-icon coin-sol"><span /><span /><span /></i>
  if (coin === 'ETH') return <i className="header-coin-icon coin-eth"><span /></i>
  return <i className={`header-coin-icon ${coin === 'USDC' ? 'coin-usdc' : 'coin-usd'}`}><b>$</b></i>
}

export default function HeaderBalance({ balance, network, solanaWallet, connection }: { balance: number | null; network: 'solana' | 'megaeth'; solanaWallet: PublicKey | null; connection: Connection }) {
  const [selected, setSelected] = useState<Coin>(network === 'solana' ? 'SOL' : 'ETH')
  const [hovered, setHovered] = useState(false)
  const [prices, setPrices] = useState<Prices | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null)

  useEffect(() => setSelected(network === 'solana' ? 'SOL' : 'ETH'), [network])
  useEffect(() => {
    let active = true
    const refresh = () => void fetch('/api/prices').then(response => response.ok ? response.json() as Promise<Prices> : Promise.reject()).then(value => { if (active) setPrices(value) }).catch(() => undefined)
    refresh(); const timer = window.setInterval(refresh, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  useEffect(() => {
    if (!solanaWallet) { setUsdcBalance(null); return }
    let active = true
    const refresh = () => void connection.getParsedTokenAccountsByOwner(solanaWallet, { mint: DEVNET_USDC_MINT })
      .then(accounts => accounts.value.reduce((total, account) => total + Number((account.account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } }).parsed?.info?.tokenAmount?.uiAmount ?? 0), 0))
      .then(value => { if (active) setUsdcBalance(value) })
      .catch(() => { if (active) setUsdcBalance(null) })
    refresh(); const timer = window.setInterval(refresh, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [connection, solanaWallet])

  const coinBalance = selected === 'USDC' ? usdcBalance : selected === 'SOL' ? (network === 'solana' ? balance : null) : (network === 'megaeth' ? balance : null)
  const conversion = useMemo(() => {
    if (coinBalance === null || !prices) return null
    if (selected === 'USDC') return prices.solUsd ? coinBalance * prices.usdcUsd / prices.solUsd : null
    return coinBalance * (selected === 'SOL' ? prices.solUsd ?? 0 : prices.ethUsd ?? 0)
  }, [coinBalance, prices, selected])
  const rotate = (direction: number) => setSelected(current => coins[(coins.indexOf(current) + direction + coins.length) % coins.length])
  const wheel = (event: WheelEvent) => { event.preventDefault(); rotate(event.deltaY >= 0 ? 1 : -1) }
  const amount = coinBalance === null ? '—' : coinBalance.toLocaleString(undefined, { minimumFractionDigits: selected === 'USDC' ? 2 : 4, maximumFractionDigits: selected === 'USDC' ? 2 : 4 })
  const converted = conversion === null ? 'PRICE BUSY' : selected === 'USDC'
    ? `${conversion.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`
    : `$${conversion.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return <div className="header-balance" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onWheel={wheel} title="Scroll to switch SOL, ETH and Solana USDC">
    <button className={`header-balance-main ${hovered ? 'show-conversion' : ''}`} onClick={() => rotate(1)}>
      {hovered ? <><CoinIcon coin={selected === 'USDC' ? 'SOL' : 'USD'} /><strong>{converted}</strong></> : <><CoinIcon coin={selected} /><strong>{amount}</strong><small>{selected === 'USDC' ? 'USDC · SOL' : selected}</small></>}
      <ChevronDown />
    </button>
    <div className="header-coin-dots">{coins.map(coin => <button key={coin} className={coin === selected ? 'active' : ''} onClick={() => setSelected(coin)} aria-label={`Show ${coin} balance`} />)}</div>
  </div>
}
