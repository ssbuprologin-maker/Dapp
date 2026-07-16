import { FormEvent, useMemo, useState } from 'react'
import { ArrowLeft, Copy, Download, Gift, LineChart, UsersRound, WalletCards } from 'lucide-react'

function cleanCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

export default function AffiliatesPage({ wallet, onBack }: { wallet: string; onBack: () => void }) {
  const storageKey = `testnet-games:affiliate-code:${wallet.toLowerCase()}`
  const suggestedCode = cleanCode(wallet.replace(/^0x/, '').slice(0, 8)) || 'DINOPLAY'
  const [savedCode, setSavedCode] = useState(() => localStorage.getItem(storageKey) || suggestedCode)
  const [code, setCode] = useState(savedCode)
  const [period, setPeriod] = useState<'7D' | '1M' | '3M' | 'ALL'>('7D')
  const [bannerSize, setBannerSize] = useState<'wide' | 'square'>('square')
  const [notice, setNotice] = useState('')
  const referralUrl = useMemo(() => `${window.location.origin}/?ref=${savedCode}`, [savedCode])

  const save = (event: FormEvent) => {
    event.preventDefault()
    const next = cleanCode(code)
    if (next.length < 3) { setNotice('Use at least three letters or numbers.'); return }
    localStorage.setItem(storageKey, next)
    setCode(next); setSavedCode(next); setNotice('Affiliate code saved on this device.')
  }
  const copy = async () => { await navigator.clipboard.writeText(referralUrl); setNotice('Referral link copied.') }
  const downloadBanner = () => {
    const dimensions = bannerSize === 'wide' ? [1280, 294] : [1000, 1100]
    const [width, height] = dimensions
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#17112b"/><stop offset="1" stop-color="#06161b"/></linearGradient><linearGradient id="neon"><stop stop-color="#a76cff"/><stop offset="1" stop-color="#00f5d4"/></linearGradient></defs><rect width="100%" height="100%" rx="28" fill="url(#bg)"/><path d="M0 ${height * .76} L${width} ${height * .55} V${height} H0Z" fill="#00f5d418"/><text x="50%" y="34%" text-anchor="middle" fill="#fff" font-family="Arial" font-size="${Math.round(height * .1)}" font-weight="900">TESTNET GAMES</text><text x="50%" y="52%" text-anchor="middle" fill="url(#neon)" font-family="Arial" font-size="${Math.round(height * .13)}" font-weight="900">RACE. WIN. REPEAT.</text><rect x="25%" y="64%" width="50%" height="${height * .11}" rx="12" fill="#100d1d" stroke="#a76cff"/><text x="50%" y="72%" text-anchor="middle" fill="#fff" font-family="monospace" font-size="${Math.round(height * .055)}" font-weight="700">${savedCode}</text></svg>`
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    link.download = `testnet-games-${savedCode}-${width}x${height}.svg`
    link.click(); URL.revokeObjectURL(link.href)
  }

  return <section className="affiliates-page">
    <button className="affiliate-back" onClick={onBack}><ArrowLeft /> Back</button>
    <section className="affiliate-hero">
      <span>JOIN OUR</span><h1>AFFILIATES</h1><p>Earn rewards from eligible games placed through your affiliate code.</p>
      <div className="affiliate-code-row"><form onSubmit={save}><input value={code} onChange={event => setCode(cleanCode(event.target.value))} aria-label="Affiliate code" /><button>Save</button></form><div><span>{window.location.host}/?ref=</span><strong>{savedCode}</strong><button onClick={copy}><Copy /> Copy</button></div></div>
      {notice && <small>{notice}</small>}
    </section>

    <div className="affiliate-content">
      <section className="affiliate-section"><h2>STATISTICS</h2><div className="affiliate-stats"><article><UsersRound /><div><strong>0</strong><span>Affiliated users</span></div></article><article><WalletCards /><div><strong>0.00</strong><span>Total SOL-EQ wagered</span></div></article><article><Gift /><div><strong>0.00</strong><span>Claimable rewards</span></div><button disabled>Claim</button></article></div></section>

      <section className="affiliate-banner-section"><div className={`affiliate-banner ${bannerSize}`}><small>TESTNET GAMES</small><strong>DAILY<br />RACE REWARDS</strong><code>{savedCode}</code><span>PLAY WITH MY CODE</span></div><div className="banner-controls"><button className={bannerSize === 'wide' ? 'active' : ''} onClick={() => setBannerSize('wide')}>1280 × 294</button><button className={bannerSize === 'square' ? 'active' : ''} onClick={() => setBannerSize('square')}>1000 × 1100</button></div><button className="download-banner" onClick={downloadBanner}><Download /> Download banner</button></section>

      <section className="affiliate-section affiliate-overview"><h2>OVERVIEW</h2><div className="affiliate-chart"><div className="chart-periods">{(['7D', '1M', '3M', 'ALL'] as const).map(value => <button key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)}>{value}</button>)}</div><LineChart /><div className="chart-line" /><div className="chart-axis"><span>0.00</span><span>0.00</span><span>0.00</span><span>0.00</span></div><small>No affiliate activity for {period}.</small></div></section>

      <section className="affiliate-section affiliate-depositors"><h2>TOP PLAYERS</h2><div className="depositor-head"><span>Name</span><span>Wagered</span><span>Reward</span><span>First seen</span><span>Last seen</span></div>{[0, 1, 2].map(row => <div className="depositor-empty" key={row} />)}</section>
    </div>
  </section>
}
