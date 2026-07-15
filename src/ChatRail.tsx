import { FormEvent, useEffect, useRef, useState } from 'react'
import Ably from 'ably'
import { MessageCircle, Send } from 'lucide-react'

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
  const [onlineCount, setOnlineCount] = useState(0)
  const feed = useRef<HTMLDivElement>(null)
  const channelRef = useRef<Ably.RealtimeChannel | null>(null)
  const lastSentAt = useRef(0)
  const requestedAvatars = useRef(new Set<string>())

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
  }, [network, wallet])

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
        .then(response => response.ok ? response.json() as Promise<{ avatarUrl?: string }> : Promise.reject())
        .then(profile => { if (profile.avatarUrl) setAvatars(current => ({ ...current, [key]: profile.avatarUrl! })) })
        .catch(() => undefined)
    }
  }, [messages])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const message = draft.trim()
    if (!wallet || !channelRef.current || !message || sending) return
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
    <div className="chat-feed" ref={feed}>{messages.length ? messages.map(item => { const isOwn = Boolean(wallet && item.wallet === (network === 'megaeth' ? wallet.toLowerCase() : wallet) && item.network === network); const avatar = isOwn && ownAvatar ? ownAvatar : item.wallet ? avatars[`${item.network}:${item.wallet}`] : ''; return <article key={item.id}><button className="chat-avatar" onClick={() => item.wallet && onViewProfile(item.wallet, item.network)} disabled={!item.wallet} title={item.wallet ? `View ${item.name}'s statistics` : undefined}>{avatar ? <img src={avatar} alt="" /> : <span>{item.name.slice(0, 1).toUpperCase()}</span>}</button><div className="chat-message"><header><span><strong>{item.name}</strong><b title="Level 1">1</b></span><time>{new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header><p>{item.message}</p></div><small>{item.network === 'solana' ? 'SOL' : 'MEGA'}</small></article> }) : <div className="chat-empty">No messages yet.<br />Start the global chat.</div>}</div>
    {error && <div className="chat-error">{error}</div>}
    <form className="chat-compose" onSubmit={send}><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} maxLength={240} placeholder={wallet ? 'Type a message...' : 'Connect wallet to chat'} disabled={!wallet || sending} rows={2} /><div><span>{draft.length}/240</span><button disabled={!wallet || !draft.trim() || sending} aria-label="Send message"><Send /></button></div></form>
  </aside>
}
