import { FormEvent, useEffect, useRef, useState } from 'react'
import Ably from 'ably'
import { MessageCircle, Send } from 'lucide-react'
import { chatLevelTier } from './leveling'

type Network = 'solana' | 'megaeth'
type ChatMessage = { id: string; name: string; message: string; network: Network; wallet?: string; sentAt: number }
const CHANNEL = 'testnet-games-global-chat'

export default function ChatRail({ wallet, network, displayName, onViewProfile }: { wallet: string | null; network: Network; displayName: string; onViewProfile: (wallet: string, network: Network) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [ownAvatar, setOwnAvatar] = useState('')
  const [avatars, setAvatars] = useState<Record<string, string>>({})
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [gamesPlayed, setGamesPlayed] = useState(0)
  const [onlineCount, setOnlineCount] = useState(0)
  const feed = useRef<HTMLDivElement>(null)
  const channelRef = useRef<Ably.RealtimeChannel | null>(null)
  const lastSentAt = useRef(0)
  const requestedAvatars = useRef(new Set<string>())
  const canChat = Boolean(wallet && gamesPlayed >= 3)

  useEffect(() => {
    if (!wallet) { setGamesPlayed(0); return }
    let active = true
    const refresh = () => void fetch(`/api/profile?network=${network}&wallet=${encodeURIComponent(wallet)}`)
      .then(response => response.ok ? response.json() as Promise<{ stats?: { gamesPlayed?: number } }> : Promise.reject())
      .then(profile => { if (active) setGamesPlayed(Number(profile.stats?.gamesPlayed ?? 0)) })
      .catch(() => undefined)
    refresh()
    const timer = window.setInterval(refresh, 15_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [network, wallet])

  useEffect(() => {
    let active = true
    const query = wallet ? `?network=${network}&wallet=${encodeURIComponent(wallet)}` : ''
    const client = new Ably.Realtime({ authUrl: `/api/chat-token${query}` })
    const channel = client.channels.get(CHANNEL)
    channelRef.current = channel
    const receive = (ablyMessage: Ably.Message) => {
      if (!active || !ablyMessage.data || typeof ablyMessage.data !== 'object') return
      const item = ablyMessage.data as ChatMessage
      setMessages(current => current.some(existing => existing.id === item.id) ? current : [...current.slice(-99), item])
    }
    const updateOnlineCount = async () => {
      try {
        const members = await channel.presence.get()
        if (active) setOnlineCount(new Set(members.map(member => member.clientId)).size)
      } catch { /* Presence refreshes again on the next event. */ }
    }
    void channel.subscribe('chat-message', receive).then(async () => {
      await channel.presence.subscribe(updateOnlineCount)
      await channel.presence.enter({ network })
      await updateOnlineCount()
      const history = await channel.history({ limit: 100, direction: 'forwards' })
      if (active) setMessages(history.items.map(item => item.data as ChatMessage).filter(item => item?.id))
      setError('')
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Live chat unavailable.'))
    client.connection.on('failed', state => setError(state.reason?.message ?? 'Live chat connection failed.'))
    return () => { active = false; channelRef.current = null; void channel.presence.leave(); client.close() }
  }, [canChat, network, wallet])

  useEffect(() => {
    if (!wallet) { setOwnAvatar(''); return }
    const key = `testnet-games:avatar:${network}:${wallet}`
    setOwnAvatar(localStorage.getItem(key) ?? '')
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ wallet: string; network: Network; avatar: string }>).detail
      if (detail?.wallet === wallet && detail.network === network) setOwnAvatar(detail.avatar)
    }
    window.addEventListener('profile-avatar-updated', update)
    return () => window.removeEventListener('profile-avatar-updated', update)
  }, [network, wallet])

  useEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight }) }, [messages])

  useEffect(() => {
    for (const item of messages) {
      if (!item.wallet) continue
      const key = `${item.network}:${item.wallet}`
      if (requestedAvatars.current.has(key)) continue
      requestedAvatars.current.add(key)
      void fetch(`/api/profile?network=${item.network}&wallet=${encodeURIComponent(item.wallet)}`)
        .then(response => response.ok ? response.json() as Promise<{ avatarUrl?: string; level?: number }> : Promise.reject())
        .then(profile => {
          if (profile.avatarUrl) setAvatars(current => ({ ...current, [key]: profile.avatarUrl! }))
          setLevels(current => ({ ...current, [key]: Number(profile.level ?? 1) }))
        })
        .catch(() => undefined)
    }
  }, [messages])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const message = draft.trim()
    if (!wallet || !canChat || !channelRef.current || !message || sending) return
    if (Date.now() - lastSentAt.current < 3_000) { setError('Slow down—wait a few seconds before chatting again.'); return }
    setSending(true); setError('')
    try {
      const normalizedWallet = network === 'megaeth' ? wallet.toLowerCase() : wallet
      const record: ChatMessage = { id: `${Date.now()}-${crypto.randomUUID()}`, name: displayName || `${wallet.slice(0, 5)}...${wallet.slice(-4)}`, message: message.slice(0, 240), network, wallet: normalizedWallet, sentAt: Date.now() }
      await channelRef.current.publish('chat-message', record)
      lastSentAt.current = Date.now(); setDraft('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send message.') }
    finally { setSending(false) }
  }

  return <aside className="chat-rail">
    <div className="chat-title"><MessageCircle /><strong>GAME CHAT</strong><span className="online-count"><i />{onlineCount}</span></div>
    <div className="chat-feed" ref={feed}>{messages.length ? messages.map(item => { const isOwn = Boolean(wallet && item.wallet === (network === 'megaeth' ? wallet.toLowerCase() : wallet) && item.network === network); const profileKey = item.wallet ? `${item.network}:${item.wallet}` : ''; const avatar = isOwn && ownAvatar ? ownAvatar : profileKey ? avatars[profileKey] : ''; const level = levels[profileKey] ?? 1; return <article key={item.id}><button className="chat-avatar" onClick={() => item.wallet && onViewProfile(item.wallet, item.network)} disabled={!item.wallet} title={item.wallet ? `View ${item.name}'s statistics` : undefined}>{avatar ? <img src={avatar} alt="" /> : <span>{item.name.slice(0, 1).toUpperCase()}</span>}</button><div className="chat-message"><header><span><strong>{item.name}</strong><b className={`chat-level chat-level-${chatLevelTier(level)}`} title={`Level ${level}`}>{level}</b></span><time>{new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header><p>{item.message}</p></div><small>{item.network === 'solana' ? 'SOL' : 'MEGA'}</small></article> }) : <div className="chat-empty">No messages yet.<br />Start the global chat.</div>}</div>
    {error && <div className="chat-error">{error}</div>}
    <form className="chat-compose" onSubmit={send}><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} maxLength={240} placeholder={!wallet ? 'Connect wallet to chat' : canChat ? 'Type a message...' : `Play ${3 - gamesPlayed} more verified game${3 - gamesPlayed === 1 ? '' : 's'} to chat`} disabled={!canChat || sending} rows={2} /><div><span>{canChat ? `${draft.length}/240` : `${gamesPlayed}/3 games`}</span><button disabled={!canChat || !draft.trim() || sending} aria-label="Send message"><Send /></button></div></form>
  </aside>
}
