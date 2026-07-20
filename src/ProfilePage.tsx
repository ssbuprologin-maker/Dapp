import { FormEvent, useEffect, useRef, useState } from 'react'
import { ArrowLeft, BadgeCheck, ExternalLink, Gamepad2, Image, MessageCircle, Trophy, UserRound, Wallet } from 'lucide-react'
import { MEGAETH_EXPLORER_URL } from './megaEth'
import { levelTier } from './leveling'

type Network = 'solana' | 'megaeth'
type ProfileSection = 'statistics' | 'transactions' | 'settings'
type ProfileData = { displayName: string; avatarUrl: string; verified: boolean; moderator: boolean; discordConnected: boolean; nextChangeAt: number; level: number; wagerEquivalentSol: number; wagerIntoLevelSol: number; wagerForNextLevelSol: number; stats: { gamesPlayed: number; wins: number; losses: number; bestScore: number; solWagered: number; ethWagered: number }; transactions: { hash: string; network: Network; playedAt: number; score: number; won: boolean }[] }

export default function ProfilePage({ isOwn, initialSection, wallet, network, displayName, canChangeName, savingName, nextNameChangeAt, onChangeName, onChangeAvatar, onBack }: { isOwn: boolean; initialSection: ProfileSection; wallet: string; network: Network; displayName: string; canChangeName: boolean; savingName: boolean; nextNameChangeAt: number; onChangeName: (name: string) => Promise<void>; onChangeAvatar: (avatar: string) => Promise<void>; onBack: () => void }) {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [name, setName] = useState(displayName)
  const [avatar, setAvatar] = useState(() => localStorage.getItem(`testnet-games:avatar:${network}:${wallet}`) ?? '')
  const [avatarStatus, setAvatarStatus] = useState('')
  const referralStorageKey = `testnet-games:affiliate-code:${wallet.toLowerCase()}`
  const suggestedReferralCode = wallet.replace(/^0x/, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'DINOPLAY'
  const [referralCode, setReferralCode] = useState(() => localStorage.getItem(referralStorageKey) || suggestedReferralCode)
  const [referralStatus, setReferralStatus] = useState('')
  const [cropSource, setCropSource] = useState('')
  const [cropZoom, setCropZoom] = useState(1)
  const [cropPositionY, setCropPositionY] = useState(0)
  const [section, setSection] = useState<ProfileSection>(initialSection)
  const avatarInput = useRef<HTMLInputElement>(null)
  useEffect(() => { fetch(`/api/profile?network=${network}&wallet=${encodeURIComponent(wallet)}`).then(response => response.json()).then((data: ProfileData) => { setProfile(data); if (data.avatarUrl) { setAvatar(data.avatarUrl); if (isOwn) localStorage.setItem(`testnet-games:avatar:${network}:${wallet}`, data.avatarUrl) } }).catch(() => undefined) }, [isOwn, network, wallet, displayName])
  useEffect(() => setName(displayName), [displayName])
  useEffect(() => setSection(initialSection), [initialSection])
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
  const uploadAvatar = (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { setAvatarStatus('Choose a PNG, JPG, GIF or WebP image.'); return }
    if (file.size > 1024 * 1024) { setAvatarStatus('Image is too large. Maximum size is 1 MB.'); return }
    const reader = new FileReader()
    reader.onload = () => { setCropSource(String(reader.result)); setCropZoom(1); setCropPositionY(0) }
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
      const sourceX = (image.naturalWidth - sourceSize) / 2
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
  return <><section className="profile-page">
    <div className="profile-heading"><button onClick={onBack}><ArrowLeft /> Back</button><div><span>PLAYER PROFILE</span><h1>{profile?.displayName || (isOwn ? displayName : '') || `${wallet.slice(0, 5)}...${wallet.slice(-4)}`}{profile?.verified && <BadgeCheck className="verified-badge" aria-label="Verified player" />}{profile?.moderator && <b className="moderator-badge" title="Moderator">MOD</b>}</h1></div></div>
    <div className="profile-hero"><button className="profile-avatar" onClick={() => isOwn && avatarInput.current?.click()} title={isOwn ? 'Change profile picture' : 'Profile picture'}>{avatar ? <img src={avatar} alt="Profile" /> : <UserRound />}{isOwn && <span className="profile-avatar-edit"><Image /></span>}</button><input ref={avatarInput} className="avatar-file-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={event => { uploadAvatar(event.target.files?.[0]); event.target.value = '' }} /><div><small>{network.toUpperCase()} WALLET · LEVEL {level}</small><code>{wallet}</code><p>Worldwide player profile</p></div></div>
    <section className={`level-card level-tier-${levelTier(level)}`}><div><span>LEVEL {level}</span><small>{level >= 100 ? 'Maximum level reached.' : `${formatSol(profile?.wagerIntoLevelSol ?? 0)} / ${formatSol(profile?.wagerForNextLevelSol ?? 0.1)} SOL-EQ to the next level`}</small></div><strong>{formatSol(profile?.wagerEquivalentSol ?? 0)} SOL-EQ</strong><div className="level-track"><i style={{ width: `${wagerProgress}%` }} /></div></section>
    <nav className="profile-nav"><button className={section === 'statistics' ? 'active' : ''} onClick={() => setSection('statistics')}>Statistics</button>{isOwn && <button className={section === 'transactions' ? 'active' : ''} onClick={() => setSection('transactions')}>Transactions</button>}{isOwn && <button className={section === 'settings' ? 'active' : ''} onClick={() => setSection('settings')}>Settings</button>}</nav>
    <div className={`profile-stats ${section !== 'statistics' ? 'profile-hidden' : ''}`}><article><Gamepad2 /><span><small>GAMES PLAYED</small><strong>{profile?.stats.gamesPlayed ?? 0}</strong></span></article><article><Wallet /><span><small>SOL WAGERED</small><strong>{(profile?.stats.solWagered ?? 0).toFixed(2)}</strong></span></article><article><Wallet /><span><small>ETH WAGERED</small><strong>{(profile?.stats.ethWagered ?? 0).toFixed(2)}</strong></span></article><article><Trophy /><span><small>NETWORK</small><strong>{network === 'solana' ? 'SOL' : 'MEGA'}</strong></span></article></div>
    <div className="profile-columns"><section className={`profile-panel ${section !== 'transactions' ? 'profile-hidden' : ''}`}><div className="panel-heading"><span>TRANSACTION HISTORY</span><h2>Recent games</h2></div><div className="tx-list">{profile?.transactions?.length ? profile.transactions.map(tx => <a key={tx.hash} href={tx.network === 'solana' ? `https://explorer.solana.com/tx/${tx.hash}?cluster=devnet` : `${MEGAETH_EXPLORER_URL}/tx/${tx.hash}`} target="_blank" rel="noreferrer"><span><strong>{tx.won ? 'Won game' : 'Played game'}</strong><small>{new Date(tx.playedAt).toLocaleString()} · {Math.floor(tx.score / 1000)}m</small></span><code>{tx.hash.slice(0, 7)}...{tx.hash.slice(-5)}</code><ExternalLink /></a>) : <p>No worldwide transactions recorded yet.</p>}</div></section>
      <section className={`profile-panel settings-panel ${section !== 'settings' ? 'profile-hidden' : ''}`}><div className="panel-heading"><span>SETTINGS</span><h2>Customize profile</h2></div><div className="settings-account-grid"><div className="settings-avatar-column"><button type="button" className="avatar-editor-card" onClick={() => avatarInput.current?.click()} aria-label="Upload a profile picture">{avatar ? <img src={avatar} alt="Current profile" /> : <UserRound />}<span><Image /></span></button><small>Click the image to upload and crop.</small>{avatarStatus && <small>{avatarStatus}</small>}{avatar && <button type="button" className="avatar-remove" onClick={removeAvatar}>Remove picture</button>}</div><div className="settings-fields"><form className="settings-field-form" onSubmit={saveName}><label>NICKNAME<div><input value={name} onChange={event => setName(event.target.value)} maxLength={20} /><button disabled={!canChangeName || cooldown > 0 || savingName}>{cooldown ? `${cooldown}m` : 'Save'}</button></div></label></form><form className="settings-field-form" onSubmit={saveReferralCode}><label>REFERRAL CODE<div><input value={referralCode} onChange={event => setReferralCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 14))} maxLength={14} /><button>Save</button></div>{referralStatus && <small>{referralStatus}</small>}</label></form><div className="settings-field-form settings-email-soon"><label>ACCOUNT EMAIL<div><input value="" placeholder="Accepting email — coming soon" disabled readOnly /><button type="button" disabled>Coming soon</button></div></label></div></div></div><div className="setting-row"><MessageCircle /><div><strong>Discord</strong><small>{profile?.discordConnected ? 'Connected' : 'Coming soon.'}</small></div><button disabled>{profile?.discordConnected ? 'Connected' : 'Coming soon'}</button></div></section>
    </div>
  </section>{cropSource && <div className="crop-backdrop"><div className="crop-dialog"><span>PROFILE PICTURE</span><h2>Crop your image</h2><div className="crop-preview"><img src={cropSource} alt="Crop preview" style={{ objectPosition: `50% ${50 + cropPositionY / 2}%`, transform: `scale(${cropZoom})` }} /></div><label>ZOOM<input type="range" min="1" max="3" step="0.05" value={cropZoom} onChange={event => setCropZoom(Number(event.target.value))} /></label><label>VERTICAL POSITION<input type="range" min="-100" max="100" step="1" value={cropPositionY} onChange={event => setCropPositionY(Number(event.target.value))} /></label><div><button className="crop-cancel" onClick={() => setCropSource('')}>Cancel</button><button onClick={saveCrop}>Save crop</button></div></div></div>}</>
}
