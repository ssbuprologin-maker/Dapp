import { useEffect, useMemo, useRef, useState, WheelEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import solCoin from './assets/sol-coin-3d-v1.png'
import ethCoin from './assets/eth-coin-3d-v1.png'
import usdcCoin from './assets/usdc-coin-3d-v1.png'
import metaMaskFox from './assets/metamask-fox-official.svg'

type Coin = 'SOL' | 'ETH' | 'USDC'
type Prices = { solUsd: number | null; ethUsd: number | null; usdcUsd: number; updatedAt: number }
const coins: Coin[] = ['SOL', 'ETH', 'USDC']

function CoinIcon({ coin }: { coin: Coin | 'USD' }) {
  if (coin === 'USD') return <i className="header-coin-icon coin-usd"><b>$</b></i>
  const source = coin === 'SOL' ? solCoin : coin === 'ETH' ? ethCoin : usdcCoin
  return <i className={`header-coin-icon coin-${coin.toLowerCase()}`}><img src={source} alt="" /></i>
}

function WalletMark({ icon, kind, name }: { icon?: string; kind: 'metamask' | 'site' | 'external'; name: string }) {
  const source = kind === 'metamask' ? metaMaskFox : icon
  return <span className={`header-wallet-mark wallet-${kind}`} title={name}>
    {source ? <img src={source} alt={`${name} logo`} /> : <b>{kind === 'site' ? 'S' : 'W'}</b>}
  </span>
}

export default function HeaderBalance({ balance, usdcBalance, network, walletIcon, walletKind, walletName }: {
  balance: number | null
  usdcBalance: number
  network: 'solana' | 'megaeth'
  walletIcon?: string
  walletKind: 'metamask' | 'site' | 'external'
  walletName: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Coin>(network === 'solana' ? 'SOL' : 'ETH')
  const [hovered, setHovered] = useState(false)
  const [open, setOpen] = useState(false)
  const [prices, setPrices] = useState<Prices | null>(null)

  useEffect(() => setSelected(network === 'solana' ? 'SOL' : 'ETH'), [network])
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  useEffect(() => {
    let active = true
    const refresh = () => void fetch('/api/prices').then(response => response.ok ? response.json() as Promise<Prices> : Promise.reject()).then(value => { if (active) setPrices(value) }).catch(() => undefined)
    refresh(); const timer = window.setInterval(refresh, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const balanceFor = (coin: Coin) => coin === 'USDC' ? usdcBalance : coin === 'SOL' ? (network === 'solana' ? balance ?? 0 : 0) : (network === 'megaeth' ? balance ?? 0 : 0)
  const conversionFor = (coin: Coin) => {
    const value = balanceFor(coin)
    if (value === 0) return 0
    if (!prices) return null
    if (coin === 'USDC') return prices.solUsd ? value * prices.usdcUsd / prices.solUsd : null
    const price = coin === 'SOL' ? prices.solUsd : prices.ethUsd
    return price === null ? null : value * price
  }
  const formatAmount = (coin: Coin) => {
    const value = balanceFor(coin)
    const digits = value === 0 || coin !== 'USDC' ? 4 : 2
    return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  }
  const formatConversion = (coin: Coin) => {
    const value = conversionFor(coin)
    if (value === null) return 'PRICE BUSY'
    return coin === 'USDC'
      ? `${value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} SOL`
      : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const conversion = useMemo(() => formatConversion(selected), [balance, network, prices, selected, usdcBalance])
  const rotate = (direction: number) => setSelected(current => coins[(coins.indexOf(current) + direction + coins.length) % coins.length])
  const wheel = (event: WheelEvent) => { event.preventDefault(); rotate(event.deltaY >= 0 ? 1 : -1) }

  return <div ref={rootRef} className={`header-balance ${open ? 'menu-open' : ''}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onWheel={wheel} title="Click to select SOL, ETH or Solana USDC">
    <button type="button" className={`header-balance-main ${hovered && !open ? 'show-conversion' : ''}`} onClick={() => setOpen(value => !value)} aria-haspopup="menu" aria-expanded={open}>
      {hovered && !open
        ? <><CoinIcon coin={selected === 'USDC' ? 'SOL' : 'USD'} /><strong>{conversion}</strong></>
        : <><CoinIcon coin={selected} /><strong>{formatAmount(selected)}</strong></>}
      <ChevronDown />
      <WalletMark icon={walletIcon} kind={walletKind} name={walletName} />
    </button>
    {open && <div className="header-balance-menu" role="menu">
      <strong>Select wallet:</strong>
      {coins.map(coin => <button type="button" key={coin} className={coin === selected ? 'active' : ''} onClick={() => { setSelected(coin); setOpen(false) }} role="menuitem">
        <CoinIcon coin={coin} />
        <span><b>{coin === 'USDC' ? 'USDC · SOL' : coin}</b><em>{formatAmount(coin)}</em></span>
        <small>~{formatConversion(coin)}</small>
      </button>)}
    </div>}
  </div>
}
