import { FormEvent, useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, Gamepad2, Image, MessageCircle, Trophy, UserRound, Wallet } from 'lucide-react'
import { MEGAETH_EXPLORER_URL } from './megaEth'

type Network = 'solana' | 'megaeth'
type ProfileData = { displayName: string; avatarUrl: string; discordConnected: boolean; nextChangeAt: number; stats: { gamesPlayed: number; solWagered: number; ethWagered: number }; transactions: { hash: string; network: Network; playedAt: number; score: number; won: boolean }[] }

export default function ProfilePage({ wallet, network, displayName, canChangeName, savingName, nextNameChangeAt, onChangeName, onBack }: { wallet: string; network: Network; displayName: string; canChangeName: boolean; savingName: boolean; nextNameChangeAt: number; onChangeName: (name: string) => Promise<void>; onBack: () => void }) {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [name, setName] = useState(displayName)
  const [avatar, setAvatar] = useState(() => localStorage.getItem(`testnet-games:avatar:${network}:${wallet}`) ?? '')
  useEffect(() => { fetch(`/api/profile?network=${network}&wallet=${encodeURIComponent(wallet)}`).then(response => response.json()).then(setProfile).catch(() => undefined) }, [network, wallet, displayName])
  useEffect(() => setName(displayName), [displayName])
  const cooldown = Math.max(0, Math.ceil((nextNameChangeAt - Date.now()) / 60_000))
  const saveName = (event: FormEvent) => { event.preventDefault(); void onChangeName(name) }
  const saveAvatar = () => { localStorage.setItem(`testnet-games:avatar:${network}:${wallet}`, avatar) }
  return <section className="profile-page">
    <div className="profile-heading"><button onClick={onBack}><ArrowLeft /> Back</button><div><span>PLAYER PROFILE</span><h1>{displayName || `${wallet.slice(0, 5)}...${wallet.slice(-4)}`}</h1></div></div>
    <div className="profile-hero"><div className="profile-avatar">{avatar ? <img src={avatar} alt="Profile" /> : <UserRound />}</div><div><small>{network.toUpperCase()} WALLET</small><code>{wallet}</code><p>Worldwide player data and settings</p></div></div>
    <div className="profile-stats"><article><Gamepad2 /><span><small>GAMES PLAYED</small><strong>{profile?.stats.gamesPlayed ?? 0}</strong></span></article><article><Wallet /><span><small>SOL WAGERED</small><strong>{(profile?.stats.solWagered ?? 0).toFixed(2)}</strong></span></article><article><Wallet /><span><small>ETH WAGERED</small><strong>{(profile?.stats.ethWagered ?? 0).toFixed(2)}</strong></span></article><article><Trophy /><span><small>NETWORK</small><strong>{network === 'solana' ? 'SOL' : 'MEGA'}</strong></span></article></div>
    <div className="profile-columns"><section className="profile-panel"><div className="panel-heading"><span>TRANSACTION HISTORY</span><h2>Recent games</h2></div><div className="tx-list">{profile?.transactions?.length ? profile.transactions.map(tx => <a key={tx.hash} href={tx.network === 'solana' ? `https://explorer.solana.com/tx/${tx.hash}?cluster=devnet` : `${MEGAETH_EXPLORER_URL}/tx/${tx.hash}`} target="_blank" rel="noreferrer"><span><strong>{tx.won ? 'Won game' : 'Played game'}</strong><small>{new Date(tx.playedAt).toLocaleString()} · {Math.floor(tx.score / 1000)}m</small></span><code>{tx.hash.slice(0, 7)}...{tx.hash.slice(-5)}</code><ExternalLink /></a>) : <p>No worldwide transactions recorded yet.</p>}</div></section>
      <section className="profile-panel settings-panel"><div className="panel-heading"><span>SETTINGS</span><h2>Customize profile</h2></div><form onSubmit={saveName}><label>USERNAME<input value={name} onChange={event => setName(event.target.value)} maxLength={20} /></label><button disabled={!canChangeName || cooldown > 0 || savingName}>{cooldown ? `${cooldown}m cooldown` : 'Save username'}</button></form><div className="setting-row"><Image /><div><strong>Profile picture URL</strong><input value={avatar} onChange={event => setAvatar(event.target.value)} placeholder="https://..." /><small>Stored locally until database storage is connected.</small></div><button onClick={saveAvatar}>Save</button></div><div className="setting-row"><MessageCircle /><div><strong>Discord</strong><small>{profile?.discordConnected ? 'Connected' : 'OAuth fields are ready for a Discord provider.'}</small></div><button disabled>{profile?.discordConnected ? 'Connected' : 'Connect soon'}</button></div></section>
    </div>
  </section>
}
