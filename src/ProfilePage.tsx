import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BadgeCheck, ExternalLink, Gamepad2, Image, MessageCircle, ShieldAlert, Trophy, UserRound, Wallet, X } from 'lucide-react'
import { MEGAETH_EXPLORER_URL } from './megaEth'
import { levelTier } from './leveling'
import type { TipTarget } from './TipModal'

type Network = 'solana' | 'megaeth'
type ProfileSection = 'statistics' | 'transactions' | 'settings'
type ProfileData = { displayName: string; avatarUrl: string; createdAt: number; verified: boolean; moderator: boolean; streamer: boolean; kickSlug: string; kickUrl: string; warningCount: number; discordConnected: boolean; nextChangeAt: number; level: number; wagerEquivalentSol: number; wagerIntoLevelSol: number; wagerForNextLevelSol: number; stats: { gamesPlayed: number; wins: number; losses: number; bestScore: number; solWagered: number; ethWagered: number }; transactions: { hash: string; network: Network; playedAt: number; score: number; won: boolean }[] }

export default function ProfilePage({ isOwn, initialSection, wallet, network, displayName, canChangeName, savingName, nextNameChangeAt, onChangeName, onChangeAvatar, onChangeKickChannel, onTipPlayer, canModerate, onModerate, onBack }: { isOwn: boolean; initialSection: ProfileSection; wallet: string; network: Network; displayName: string; canChangeName: boolean; savingName: boolean; nextNameChangeAt: number; onChangeName: (name: string) => Promise<void>; onChangeAvatar: (avatar: string) => Promise<void>; onChangeKickChannel: (url: string) => Promise<string>; onTipPlayer: (target: TipTarget) => void; canModerate: boolean; onModerate: (target: { wallet: string; network: Network; name: string; action: 'warn' | 'timeout' }, note: string, durationMinutes: number) => Promise<void>; onBack: () => void }) {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [name, setName] = useState(displayName)
  const [avatar, setAvatar] = useState(() => localStorage.getItem(`testnet-games:avatar:${network}:${wallet}`) ?? '')
  const [avatarStatus, setAvatarStatus] = useState('')
  const referralStorageKey = `testnet-games:affiliate-code:${wallet.toLowerCase()}`
  const suggestedReferralCode = wallet.replace(/^0x/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'DINOPLAY'
  const [referralCode, setReferralCode] = useState(() => localStorage.getItem(referralStorageKey) || suggestedReferralCode)
  const [referralStatus, setReferralStatus] = useState('')
  const [kickLink, setKickLink] = useState('')
  const [kickStatus, setKickStatus] = useState('')
  const [savingKick, setSavingKick] = useState(false)
  const [cropSource, setCropSource] = useState('')
  const [cropZoom, setCropZoom] = useState(1)
  const [cropPositionX, setCropPositionX] = useState(0)
  const [cropPositionY, setCropPositionY] = useState(0)
  const [cropImageSize, setCropImageSize] = useState({ width: 1, height: 1 })
  const [section, setSection] = useState<ProfileSection>(initialSection)
  const [moderationAction, setModerationAction] = useState<'warn' | 'timeout' | null>(null)
  const [moderationNote, setModerationNote] = useState('')
  const [timeoutMinutes, setTimeoutMinutes] = useState(10)
  const [moderating, setModerating] = useState(false)
  const [moderationError, setModerationError] = useState('')
  const mutedStorageKey = `testnet-games:muted-chat:v1:${network}:${wallet}`
  const [mutedUsers, setMutedUsers] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(mutedStorageKey) ?? '[]') as string[] } catch { return [] } })
  const avatarInput = useRef<HTMLInputElement>(null)
  const cropDrag = useRef<{ pointerId: number; x: number; y: number; positionX: number; positionY: number } | null>(null)
  useEffect(() => { fetch(`/api/profile?network=${network}&wallet=${encodeURIComponent(wallet)}`).then(response => response.json()).then((data: ProfileData) => { setProfile(data); setKickLink(data.kickUrl || ''); if (data.avatarUrl) { setAvatar(data.avatarUrl); if (isOwn) localStorage.setItem(`testnet-games:avatar:${network}:${wallet}`, data.avatarUrl) } }).catch(() => undefined) }, [isOwn, network, wallet, displayName])
  useEffect(() => setName(displayName), [displayName])
  useEffect(() => setSection(initialSection), [initialSection])
  useEffect(() => { try { setMutedUsers(JSON.parse(localStorage.getItem(mutedStorageKey) ?? '[]') as string[]) } catch { setMutedUsers([]) } }, [mutedStorageKey])
  const unmuteUser = (identity: string) => setMutedUsers(current => {
    const next = current.filter(item => item !== identity)
    try { localStorage.setItem(mutedStorageKey, JSON.stringify(next)) } catch { /* Local mute state is optional. */ }
    return next
  })
  const cooldown = Math.max(0, Math.ceil((nextNameChangeAt - Date.now()) / 60_000))
  const level = profile?.level ?? 1
  const wagerProgress = level >= 100 ? 100 : Math.min(100, 100 * (profile?.wagerIntoLevelSol ?? 0) / Math.max(0.000001, profile?.wagerForNextLevelSol ?? 0.1))
  const formatSol = (value: number) => value < 10 ? value.toFixed(2) : Math.round(value).toLocaleString()
  const saveName = (event: FormEvent) => { event.preventDefault(); void onChangeName(name) }
  const saveReferralCode = (event: FormEvent) => {
    event.preventDefault()
    const clean = referralCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14)
    if (clean.length < 3) { setReferralStatus('Use at least three letters or numbers.'); return }
    localStorage.setItem(referralStorageKey, clean)
    setReferralCode(clean); setReferralStatus('Referral code saved on this device.')
  }
  const saveKickChannel = async (event: FormEvent) => {
    event.preventDefault(); setKickStatus(''); setSavingKick(true)
    try {
      const saved = await onChangeKickChannel(kickLink)
      setKickLink(saved)
      setProfile(current => current ? { ...current, kickUrl: saved, kickSlug: saved.split('/').filter(Boolean).pop() ?? '' } : current)
      setKickStatus(saved ? 'Kick channel saved.' : 'Kick channel removed.')
    } catch (error) { setKickStatus(error instanceof Error ? error.message : 'Could not save Kick channel.') }
    finally { setSavingKick(false) }
  }
  const uploadAvatar = (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { setAvatarStatus('Choose a PNG, JPG, GIF or WebP image.'); return }
    if (file.size > 1024 * 1024) { setAvatarStatus('Image is too large. Maximum size is 1 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => { setCropSource(String(reader.result)); setCropZoom(1); setCropPositionX(0); setCropPositionY(0); setCropImageSize({ width: 1, height: 1 }) }
    reader.onerror = () => setAvatarStatus('Could not read that image.')
    reader.readAsDataURL(file)
  }
  const saveCrop = () => {
    const image = new window.Image()
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256
      const context = canvas.getContext('2d')
      if (!context) return
      const sourceSize = Math.min(image.naturalWidth, image.naturalHeight) / cropZoom
      const sourceX = Math.max(0, image.naturalWidth - sourceSize) * ((cropPositionX + 100) / 200)
      const sourceY = Math.max(0, image.naturalHeight - sourceSize) * ((cropPositionY + 100) / 200)
      context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 256, 256)
      try {
        const result = canvas.toDataURL('image/jpeg', .88)
        localStorage.setItem(`testnet-games:avatar:${network}:${wallet}`, result)
        setAvatar(result); setCropSource(''); setAvatarStatus('Profile picture cropped and saved on this device.')
        window.dispatchEvent(new CustomEvent('profile-avatar-updated', { detail: { wallet, network, avatar: result } }))
        void onChangeAvatar(result)
      } catch { setAvatarStatus('Browser storage is full. Try another image.') }
    }
    image.src = cropSource
  }
  const removeAvatar = () => { localStorage.removeItem(`testnet-games:avatar:${network}:${wallet}`); setAvatar(''); setAvatarStatus('Profile picture removed.'); window.dispatchEvent(new CustomEvent('profile-avatar-updated', { detail: { wallet, network, avatar: '' } })); void onChangeAvatar('') }
  const playerName = profile?.displayName || displayName || `${wallet.slice(0, 5)}...${wallet.slice(-4)}`
  const cropRatio = cropImageSize.width / cropImageSize.height
  const cropBaseWidth = cropRatio >= 1 ? cropRatio * 100 : 100
  const cropBaseHeight = cropRatio >= 1 ? 100 : 100 / cropRatio
  const cropRenderWidth = cropBaseWidth * cropZoom
  const cropRenderHeight = cropBaseHeight * cropZoom
  const cropImageStyle = {
    width: `${cropRenderWidth}%`, height: `${cropRenderHeight}%`,
    left: `${-Math.max(0, cropRenderWidth - 100) * ((cropPositionX + 100) / 200)}%`,
    top: `${-Math.max(0, cropRenderHeight - 100) * ((cropPositionY + 100) / 200)}%`,
  }
  const startCropDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    cropDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, positionX: cropPositionX, positionY: cropPositionY }
  }
  const moveCropDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = cropDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const bounds = event.currentTarget.getBoundingClientRect()
    setCropPositionX(Math.max(-100, Math.min(100, drag.positionX - (event.clientX - drag.x) * 200 / Math.max(1, bounds.width))))
    setCropPositionY(Math.max(-100, Math.min(100, drag.positionY - (event.clientY - drag.y) * 200 / Math.max(1, bounds.height))))
  }
  const endCropDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (cropDrag.current?.pointerId !== event.pointerId) return
    cropDrag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const changeCropZoom = (nextZoom: number) => {
    const width = cropImageSize.width
    const height = cropImageSize.height
    const minimumSide = Math.min(width, height)
    const oldSourceSize = minimumSide / cropZoom
    const newSourceSize = minimumSide / nextZoom
    const preserveAxisCenter = (dimension: number, position: number) => {
      const oldAvailable = Math.max(0, dimension - oldSourceSize)
      const currentCenter = oldAvailable * ((position + 100) / 200) + oldSourceSize / 2
      const newAvailable = Math.max(0, dimension - newSourceSize)
      if (newAvailable === 0) return 0
      return Math.max(-100, Math.min(100, ((currentCenter - newSourceSize / 2) / newAvailable) * 200 - 100))
    }
    setCropPositionX(preserveAxisCenter(width, cropPositionX))
    setCropPositionY(preserveAxisCenter(height, cropPositionY))
    setCropZoom(nextZoom)
  }
  const runModeration = async () => {
    if (!moderationAction) return
    setModerating(true); setModerationError('')
    try { await onModerate({ wallet, network, name: playerName, action: moderationAction }, moderationNote.trim(), moderationAction === 'timeout' ? timeoutMinutes : 0); if (moderationAction === 'warn') setProfile(current => current ? { ...current, warningCount: current.warningCount + 1 } : current); setModerationAction(null); setModerationNote('') }
    catch (error) { setModerationError(error instanceof Error ? error.message : 'Moderation action failed.') }
    finally { setModerating(false) }
  }
  const chartGames = [...(profile?.transactions ?? [])].sort((a, b) => a.playedAt - b.playedAt).slice(-30)
  let runningNet = 0
  const chartValues = [0, ...chartGames.map(game => {
    runningNet += game.won ? 0.01 : -0.01
    return runningNet
  })]
  const chartMinimum = Math.min(...chartValues)
  const chartMaximum = Math.max(...chartValues)
  const chartPadding = Math.max(0.005, (chartMaximum - chartMinimum) * .18)
  const chartLow = chartMinimum - chartPadding
  const chartHigh = chartMaximum + chartPadding
  const chartWidth = 760
  const chartHeight = 220
  const chartX = (index: number) => 44 + index * (chartWidth - 60) / Math.max(1, chartValues.length - 1)
  const chartY = (value: number) => 14 + (chartHigh - value) * (chartHeight - 42) / Math.max(.000001, chartHigh - chartLow)
  const chartLine = chartValues.map((value, index) => `${index ? 'L' : 'M'}${chartX(index).toFixed(1)},${chartY(value).toFixed(1)}`).join(' ')
  const chartArea = `${chartLine} L${chartX(chartValues.length - 1).toFixed(1)},${chartHeight - 28} L${chartX(0).toFixed(1)},${chartHeight - 28} Z`
  const chartGridValues = Array.from({ length: 5 }, (_, index) => chartHigh - index * (chartHigh - chartLow) / 4)
  const chartGradientId = `profile-chart-${wallet.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`
  const profileName = profile?.displayName || (isOwn ? displayName : '') || `${wallet.slice(0, 5)}...${wallet.slice(-4)}`
  const joinedLabel = profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'New player'
  return <><section className={`profile-page${isOwn ? '' : ' profile-page-inspected'}`}>
    {isOwn ? <><div className="profile-heading"><button onClick={onBack}><ArrowLeft /> Back</button><div><span>PLAYER PROFILE</span><h1>{profileName}{profile?.verified && <BadgeCheck className="verified-badge" aria-label="Verified player" />}{profile?.moderator && <b className="moderator-badge" title="Moderator">MOD</b>}{profile?.streamer && <b className="streamer-badge" title="Streamer"><img src="/streamer-logo.svg" alt="" /> STREAMER</b>}</h1></div></div>
    <div className="profile-hero"><button className="profile-avatar" onClick={() => avatarInput.current?.click()} title="Change profile picture">{avatar ? <img src={avatar} alt="Profile" /> : <UserRound />}<span className="profile-avatar-edit"><Image /></span></button><input ref={avatarInput} className="avatar-file-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { uploadAvatar(event.target.files?.[0]); event.target.value = '' }} /><div><small>{network.toUpperCase()} WALLET · LEVEL {level}</small><code>{wallet}</code><p>Worldwide player profile</p>{profile?.kickUrl && <a className="profile-kick-link" href={profile.kickUrl} target="_blank" rel="noreferrer"><img src="/streamer-logo.svg" alt="" /> kick.com/{profile.kickSlug}<ExternalLink /></a>}</div></div></> : <header className="inspected-profile-header"><button type="button" onClick={onBack} aria-label="Close player profile"><X /></button><span className="inspected-profile-avatar">{avatar ? <img src={avatar} alt="" /> : <UserRound />}</span><div><h1>{profileName}{profile?.verified && <BadgeCheck className="verified-badge" aria-label="Verified player" />}{profile?.moderator && <b className="moderator-badge" title="Moderator">MOD</b>}{profile?.streamer && <b className="streamer-badge" title="Streamer"><img src="/streamer-logo.svg" alt="" /> STREAMER</b>}</h1>{profile?.kickUrl && <a className="profile-kick-link" href={profile.kickUrl} target="_blank" rel="noreferrer"><img src="/streamer-logo.svg" alt="" /> kick.com/{profile.kickSlug}<ExternalLink /></a>}</div><time>Joined {joinedLabel}</time></header>}
    {!isOwn && <div className="profile-player-actions"><button type="button" onClick={() => onTipPlayer({ wallet, network, name: playerName, avatar, level, verified: Boolean(profile?.verified) })}>Tip player</button>{canModerate && <><span>{profile?.warningCount ?? 0} warnings</span><button type="button" className="warn" onClick={() => { setModerationAction('warn'); setModerationError('') }}>Warn</button>{!profile?.moderator && <button type="button" className="timeout" onClick={() => { setModerationAction('timeout'); setModerationError('') }}>Timeout</button>}</>}</div>}
    {moderationAction && <div className="moderation-backdrop"><section className="moderation-modal profile-moderation-modal"><button type="button" onClick={() => !moderating && setModerationAction(null)} aria-label="Close moderation"><X /></button><ShieldAlert /><span>MODERATION</span><h2>{moderationAction === 'timeout' ? 'Timeout player' : 'Warn player'}</h2><p>{playerName}</p>{moderationAction === 'timeout' && <label>TIMEOUT MINUTES<input type="number" min="1" max="10080" value={timeoutMinutes} onChange={event => setTimeoutMinutes(Math.max(1, Math.min(10080, Number(event.target.value) || 1)))} /></label>}<label>MODERATOR NOTE<textarea value={moderationNote} onChange={event => setModerationNote(event.target.value.slice(0, 240))} maxLength={240} placeholder="Reason for this action" autoFocus /></label>{moderationError && <small>{moderationError}</small>}<button type="button" disabled={!moderationNote.trim() || moderating} onClick={() => void runModeration()}>{moderating ? 'Confirming...' : moderationAction === 'timeout' ? 'Apply timeout' : 'Send warning'}</button></section></div>}
    {isOwn && <section className={`level-card level-tier-${levelTier(level)}`}><div><span>LEVEL {level}</span><small>{level >= 100 ? 'Maximum level reached.' : `${formatSol(profile?.wagerIntoLevelSol ?? 0)} / ${formatSol(profile?.wagerForNextLevelSol ?? 0.1)} SOL-EQ to the next level`}</small></div><strong>{formatSol(profile?.wagerEquivalentSol ?? 0)} SOL-EQ</strong><div className="level-track"><i style={{ width: `${wagerProgress}%` }} /></div></section>}
    {isOwn ? <nav className="profile-nav"><button className={section === 'statistics' ? 'active' : ''} onClick={() => setSection('statistics')}>Statistics</button><button className={section === 'transactions' ? 'active' : ''} onClick={() => setSection('transactions')}>Transactions</button><button className={section === 'settings' ? 'active' : ''} onClick={() => setSection('settings')}>Settings</button></nav> : <h2 className="inspected-statistics-title">Statistics</h2>}
    <section className={`profile-performance-chart ${section !== 'statistics' ? 'profile-hidden' : ''}`}>
      <header><div><small>NET RESULT</small><strong className={runningNet < 0 ? 'negative' : ''}>{runningNet >= 0 ? '+' : ''}{runningNet.toFixed(4)} {network === 'solana' ? 'SOL' : 'ETH'}</strong></div><span>Last {chartGames.length || 0} games</span></header>
      <div className="profile-chart-canvas">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label={`Cumulative net result over ${chartGames.length} games`}>
          <defs><linearGradient id={chartGradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a85cff" stopOpacity=".34" /><stop offset="1" stopColor="#a85cff" stopOpacity=".015" /></linearGradient></defs>
          {chartGridValues.map(value => <g key={value}><line x1="44" x2={chartWidth - 16} y1={chartY(value)} y2={chartY(value)} className="profile-chart-grid" /><text x="4" y={chartY(value) + 4}>{value.toFixed(2)}</text></g>)}
          <line x1="44" x2={chartWidth - 16} y1={chartY(0)} y2={chartY(0)} className="profile-chart-zero" />
          <path d={chartArea} fill={`url(#${chartGradientId})`} />
          <path d={chartLine} className="profile-chart-line" />
          {chartValues.map((value, index) => index === chartValues.length - 1 ? <circle key={index} cx={chartX(index)} cy={chartY(value)} r="4" /> : null)}
        </svg>
        {!chartGames.length && <p>Play a verified game to begin your chart.</p>}
      </div>
      <footer><span>GAMES PLAYED</span><strong>{chartGames.length ? `Last ${chartGames.length}` : 'No data yet'}</strong></footer>
    </section>
    {isOwn ? <div className={`profile-stats ${section !== 'statistics' ? 'profile-hidden' : ''}`}><article><Gamepad2 /><span><small>GAMES PLAYED</small><strong>{profile?.stats.gamesPlayed ?? 0}</strong></span></article><article><Wallet /><span><small>SOL WAGERED</small><strong>{(profile?.stats.solWagered ?? 0).toFixed(2)}</strong></span></article><article><Wallet /><span><small>ETH WAGERED</small><strong>{(profile?.stats.ethWagered ?? 0).toFixed(2)}</strong></span></article><article><Trophy /><span><small>NETWORK</small><strong>{network === 'solana' ? 'SOL' : 'MEGA'}</strong></span></article></div> : <div className="profile-stats inspected-profile-stats"><article><Gamepad2 /><span><small>GAMES PLAYED</small><strong>{profile?.stats.gamesPlayed ?? 0}</strong></span></article><article><Trophy /><span><small>BEST SCORE</small><strong>{Math.floor((profile?.stats.bestScore ?? 0) / 1000)}m</strong></span></article><article><Wallet /><span><small>TOTAL WAGERED</small><strong>{network === 'solana' ? `${(profile?.stats.solWagered ?? 0).toFixed(2)} SOL` : `${(profile?.stats.ethWagered ?? 0).toFixed(2)} ETH`}</strong></span></article></div>}
    <div className="profile-columns"><section className={`profile-panel ${section !== 'transactions' ? 'profile-hidden' : ''}`}><div className="panel-heading"><span>TRANSACTION HISTORY</span><h2>Recent games</h2></div><div className="tx-list">{profile?.transactions?.length ? profile.transactions.map(tx => <a key={tx.hash} href={tx.network === 'solana' ? `https://explorer.solana.com/tx/${tx.hash}?cluster=devnet` : `${MEGAETH_EXPLORER_URL}/tx/${tx.hash}`} target="_blank" rel="noreferrer"><span><strong>{tx.won ? 'Won game' : 'Played game'}</strong><small>{new Date(tx.playedAt).toLocaleString()} · {Math.floor(tx.score / 1000)}m</small></span><code>{tx.hash.slice(0, 7)}...{tx.hash.slice(-5)}</code><ExternalLink /></a>) : <p>No worldwide transactions recorded yet.</p>}</div></section>
      <section className={`profile-panel settings-panel ${section !== 'settings' ? 'profile-hidden' : ''}`}><div className="panel-heading"><span>SETTINGS</span><h2>Customize profile</h2></div><div className="settings-account-grid"><div className="settings-avatar-column"><button type="button" className="avatar-editor-card" onClick={() => avatarInput.current?.click()} aria-label="Upload a profile picture">{avatar ? <img src={avatar} alt="Current profile" /> : <UserRound />}<span><Image /></span></button><small>Click the image to upload and crop.</small>{avatarStatus && <small>{avatarStatus}</small>}{avatar && <button type="button" className="avatar-remove" onClick={removeAvatar}>Remove picture</button>}</div><div className="settings-fields"><form className="settings-field-form" onSubmit={saveName}><label>NICKNAME<div><input value={name} onChange={event => setName(event.target.value)} maxLength={20} /><button disabled={!canChangeName || cooldown > 0 || savingName}>{cooldown ? `${cooldown}m` : 'Save'}</button></div></label></form><form className="settings-field-form" onSubmit={saveReferralCode}><label>REFERRAL CODE<div><input value={referralCode} onChange={event => setReferralCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14))} maxLength={14} /><button>Save</button></div>{referralStatus && <small>{referralStatus}</small>}</label></form>{profile?.streamer && <form className="settings-field-form kick-channel-field" onSubmit={saveKickChannel}><label>KICK STREAMING LINK <small>TEMPORARY</small><div><input value={kickLink} onChange={event => setKickLink(event.target.value.slice(0, 100))} maxLength={100} placeholder="https://kick.com/username" /><button disabled={savingKick}>{savingKick ? 'Saving...' : 'Save'}</button></div>{kickStatus && <small>{kickStatus}</small>}</label></form>}<div className="settings-field-form settings-email-soon"><label>ACCOUNT EMAIL<div><input value="" placeholder="Accepting email — coming soon" disabled readOnly /><button type="button" disabled>Coming soon</button></div></label></div></div></div><div className="setting-row"><MessageCircle /><div><strong>Discord</strong><small>{profile?.discordConnected ? 'Connected' : 'Coming soon.'}</small></div><button disabled>{profile?.discordConnected ? 'Connected' : 'Coming soon'}</button></div></section>
    </div>
    <section className={`profile-panel muted-users ${section !== 'settings' ? 'profile-hidden' : ''}`}><div className="panel-heading"><span>CHAT SETTINGS</span><h2>Muted users</h2></div><p>Muted players are hidden only on this device and this wallet.</p>{mutedUsers.length ? <ul>{mutedUsers.map(identity => { const [, mutedWallet] = identity.split(/:(.+)/); return <li key={identity}><code>{mutedWallet || identity}</code><button type="button" onClick={() => unmuteUser(identity)}>Unmute</button></li> })}</ul> : <div className="muted-users-empty">You have not muted any players.</div>}</section>
  </section>{cropSource && <div className="crop-backdrop"><div className="crop-dialog"><span>PROFILE PICTURE</span><h2>Crop your image</h2><div className="crop-preview" onPointerDown={startCropDrag} onPointerMove={moveCropDrag} onPointerUp={endCropDrag} onPointerCancel={endCropDrag}><img src={cropSource} alt="Crop preview" draggable={false} style={cropImageStyle} onLoad={event => setCropImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /></div><small className="crop-drag-hint">Drag the image to choose what appears in your profile picture.</small><label>ZOOM<input type="range" min="1" max="3" step="0.05" value={cropZoom} onChange={event => changeCropZoom(Number(event.target.value))} /></label><div><button className="crop-cancel" onClick={() => setCropSource('')}>Cancel</button><button onClick={saveCrop}>Save crop</button></div></div></div>}</>
}
