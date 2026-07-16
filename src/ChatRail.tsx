import { FormEvent, useEffect, useRef, useState } from 'react'
import Ably from 'ably'
import { BadgeCheck, Info, MessageCircle, Reply, Send, X } from 'lucide-react'
import { chatLevelTier } from './leveling'
import type { TipTarget } from './TipModal'

type Network = 'solana' | 'megaeth'
type ReplyPreview = { id: string; name: string; message: string }
type ChatMessage = { id: string; name: string; message: string; network: Network; wallet?: string; sentAt: number; replyTo?: ReplyPreview }
const CHANNEL = 'testnet-games-global-chat'
const CHAT_CACHE_KEY = 'testnet-games:chat-cache:v1'

function normalizeChatMessage(data: Partial<ChatMessage>, network: Network, wallet: string): ChatMessage | null {
  if (typeof data.id !== 'string' || typeof data.message !== 'string' || typeof data.sentAt !== 'number') return null
  const reply = data.replyTo
  const replyTo = reply && typeof reply.id === 'string' && typeof reply.name === 'string' && typeof reply.message === 'string'
    ? { id: reply.id.slice(0, 100), name: reply.name.slice(0, 40), message: reply.message.slice(0, 100) }
    : undefined
  return { id: data.id, name: typeof data.name === 'string' ? data.name.slice(0, 40) : `${wallet.slice(0, 5)}...${wallet.slice(-4)}`, message: data.message.slice(0, 140), network, wallet, sentAt: data.sentAt, replyTo }
}

function keepNewest30(items: ChatMessage[]) {
  const newestById = new Map(items.map(item => [item.id, item]))
  return [...newestById.values()].sort((a, b) => a.sentAt - b.sentAt).slice(-30)
}

function cachedMessages() {
  try {
    const stored = JSON.parse(localStorage.getItem(CHAT_CACHE_KEY) ?? '[]') as unknown[]
    return keepNewest30(stored.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const record = item as Partial<ChatMessage>
      if ((record.network !== 'solana' && record.network !== 'megaeth') || typeof record.wallet !== 'string') return []
      const message = normalizeChatMessage(record, record.network, record.wallet)
      return message ? [message] : []
    }))
  } catch { return [] }
}

function authenticatedChatMessage(message: Ably.Message): ChatMessage | null {
  if (!message.data || typeof message.data !== 'object' || typeof message.clientId !== 'string') return null
  const separator = message.clientId.indexOf(':')
  const network = message.clientId.slice(0, separator)
  const wallet = message.clientId.slice(separator + 1)
  if ((network !== 'solana' && network !== 'megaeth') || !wallet) return null
  return normalizeChatMessage(message.data as Partial<ChatMessage>, network, wallet)
}

export default function ChatRail({ wallet, network, displayName, onViewProfile, onTipPlayer }: { wallet: string | null; network: Network; displayName: string; onViewProfile: (wallet: string, network: Network) => void; onTipPlayer: (target: TipTarget) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>(cachedMessages)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [ownAvatar, setOwnAvatar] = useState('')
  const [avatars, setAvatars] = useState<Record<string, string>>({})
  const [levels, setLevels] = useState<Record<string, number>>({})
  const [verifiedProfiles, setVerifiedProfiles] = useState<Record<string, boolean>>({})
  const [profileNames, setProfileNames] = useState<Record<string, string>>({})
  const [selectedPlayer, setSelectedPlayer] = useState('')
  const [replyingTo, setReplyingTo] = useState<ReplyPreview | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [gamesPlayed, setGamesPlayed] = useState(0)
  const [onlineCount, setOnlineCount] = useState(0)
  const feed = useRef<HTMLDivElement>(null)
  const channelRef = useRef<Ably.RealtimeChannel | null>(null)
  const clientRef = useRef<Ably.Realtime | null>(null)
  const lastSentAt = useRef(0)
  const requestedAvatars = useRef(new Set<string>())
  const cacheHydrated = useRef(false)
  const canChat = Boolean(wallet && gamesPlayed >= 3)
  const remainingCharacters = Math.max(0, 140 - draft.length)

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
    const saved = cachedMessages()
    if (saved.length) setMessages(current => keepNewest30([...current, ...saved]))
    cacheHydrated.current = true
  }, [network, wallet])

  useEffect(() => {
    let active = true
    const query = wallet ? `?network=${network}&wallet=${encodeURIComponent(wallet)}` : ''
    const client = new Ably.Realtime({ authUrl: `/api/chat-token${query}` })
    clientRef.current = client
    const channel = client.channels.get(CHANNEL)
    channelRef.current = channel
    const receive = (ablyMessage: Ably.Message) => {
      if (!active || !ablyMessage.data || typeof ablyMessage.data !== 'object') return
      const item = authenticatedChatMessage(ablyMessage)
      if (!item) return
      setMessages(current => keepNewest30([...current, item]))
    }
    const updateOnlineCount = async () => {
      try {
        const members = await channel.presence.get()
        if (active) setOnlineCount(new Set(members.map(member => member.clientId)).size)
      } catch { /* Presence refreshes again on the next event. */ }
    }
    const loadStoredHistory = async () => {
      try {
        const response = await fetch('/api/chat-history')
        const body = response.ok ? await response.json() as { messages?: unknown[] } : null
        if (!active || !body?.messages) return
        const stored = body.messages.flatMap(item => {
          if (!item || typeof item !== 'object') return []
          const record = item as Partial<ChatMessage>
          if ((record.network !== 'solana' && record.network !== 'megaeth') || typeof record.wallet !== 'string') return []
          const normalized = normalizeChatMessage(record, record.network, record.wallet)
          return normalized ? [normalized] : []
        })
        setMessages(current => keepNewest30([...current, ...stored]))
      } catch { /* Ably history and the local cache remain available if Redis is not configured. */ }
    }
    void loadStoredHistory()
    void channel.subscribe('chat-message', receive).then(async () => {
      await channel.presence.subscribe(updateOnlineCount)
      await channel.presence.enter({ network })
      await updateOnlineCount()
      const history = await channel.history({ limit: 30, direction: 'backwards', untilAttach: true })
      const historical = history.items.map(authenticatedChatMessage).filter((item): item is ChatMessage => Boolean(item)).reverse()
      if (active) setMessages(current => keepNewest30([...current, ...historical]))
      setError('')
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Live chat unavailable.'))
    client.connection.on('failed', state => setError(state.reason?.message ?? 'Live chat connection failed.'))
    return () => { active = false; channelRef.current = null; if (clientRef.current === client) clientRef.current = null; void channel.presence.leave(); client.close() }
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
    if (!cacheHydrated.current) return
    // Never overwrite a populated cache with an empty transient state during logout/reconnect.
    if (!messages.length && cachedMessages().length) return
    try { localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(keepNewest30(messages))) } catch { /* Cache is optional. */ }
  }, [messages])

  useEffect(() => {
    for (const item of messages) {
      if (!item.wallet) continue
      const key = `${item.network}:${item.wallet}`
      if (requestedAvatars.current.has(key)) continue
      requestedAvatars.current.add(key)
      void fetch(`/api/profile?network=${item.network}&wallet=${encodeURIComponent(item.wallet)}`)
        .then(response => response.ok ? response.json() as Promise<{ displayName?: string; avatarUrl?: string; level?: number; verified?: boolean }> : Promise.reject())
        .then(profile => {
          if (profile.avatarUrl) setAvatars(current => ({ ...current, [key]: profile.avatarUrl! }))
          if (profile.displayName) setProfileNames(current => ({ ...current, [key]: profile.displayName! }))
          setLevels(current => ({ ...current, [key]: Number(profile.level ?? 1) }))
          setVerifiedProfiles(current => ({ ...current, [key]: Boolean(profile.verified) }))
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
      const record: ChatMessage = { id: `${Date.now()}-${crypto.randomUUID()}`, name: displayName || `${wallet.slice(0, 5)}...${wallet.slice(-4)}`, message: message.slice(0, 140), network, wallet: normalizedWallet, sentAt: Date.now(), replyTo: replyingTo ?? undefined }
      try {
        await channelRef.current.publish('chat-message', record)
      } catch (publishError) {
        if (!/publish.*capability|capability.*publish/i.test(publishError instanceof Error ? publishError.message : String(publishError)) || !clientRef.current) throw publishError
        await clientRef.current.auth.authorize()
        if (!channelRef.current) throw publishError
        await channelRef.current.publish('chat-message', record)
      }
      void fetch('/api/chat-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) }).catch(() => undefined)
      lastSentAt.current = Date.now(); setDraft(''); setReplyingTo(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send message.') }
    finally { setSending(false) }
  }

  return <aside className="chat-rail">
    <div className="chat-title"><MessageCircle /><strong>GAME CHAT</strong><span className="online-count"><i />{onlineCount}</span></div>
    <div className="chat-feed" ref={feed}>{messages.length ? messages.map(item => {
      const isOwn = Boolean(wallet && item.wallet === (network === 'megaeth' ? wallet.toLowerCase() : wallet) && item.network === network)
      const profileKey = item.wallet ? `${item.network}:${item.wallet}` : ''
      const avatar = isOwn && ownAvatar ? ownAvatar : profileKey ? avatars[profileKey] : ''
      const level = levels[profileKey] ?? 1
      const verified = Boolean(verifiedProfiles[profileKey])
      const name = isOwn && displayName ? displayName : profileNames[profileKey] || (item.wallet ? `${item.wallet.slice(0, 5)}...${item.wallet.slice(-4)}` : item.name)
      return <article key={item.id} onClick={() => setSelectedPlayer(current => current === item.id ? '' : item.id)}>
        <button className="chat-avatar" onClick={event => { event.stopPropagation(); if (item.wallet) onViewProfile(item.wallet, item.network) }} disabled={!item.wallet} title={item.wallet ? `View ${name}'s profile` : undefined}>{avatar ? <img src={avatar} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}</button>
        <div className="chat-message"><header><span><button type="button" className="chat-name-button" onClick={event => { event.stopPropagation(); setSelectedPlayer(current => current === item.id ? '' : item.id) }}>{name}</button>{verified && <BadgeCheck className="verified-badge" aria-label="Verified player" />}<b className={`chat-level chat-level-${chatLevelTier(level)}`} title={`Level ${level}`}>{level}</b></span><time>{new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>{item.replyTo && <div className="chat-reply-preview"><strong>{item.replyTo.name}</strong><span>{item.replyTo.message}</span></div>}<p>{item.message}</p></div>
        <small>{item.network === 'solana' ? 'SOL' : 'MEGA'}</small>
        {selectedPlayer === item.id && item.wallet && <div className="chat-user-menu" onClick={event => event.stopPropagation()}><button type="button" onClick={() => { setReplyingTo({ id: item.id, name, message: item.message }); setSelectedPlayer('') }}><Reply /> Reply</button><button type="button" onClick={() => { setSelectedPlayer(''); onViewProfile(item.wallet!, item.network) }}>View profile</button><button type="button" disabled={isOwn} onClick={() => { setSelectedPlayer(''); onTipPlayer({ wallet: item.wallet!, network: item.network, name, avatar, level, verified }) }}>{isOwn ? 'Your wallet' : 'Tip player'}</button></div>}
      </article>
    }) : <div className="chat-empty">No messages yet.<br />Start the global chat.</div>}</div>
    {error && <div className="chat-error">{error}</div>}
    <form className="chat-compose" onSubmit={send}>{replyingTo && <div className="chat-reply-compose"><span>Replying to <strong>{replyingTo.name}</strong><small>{replyingTo.message}</small></span><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X /></button></div>}<textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, 140))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} maxLength={140} placeholder={!wallet ? 'Connect wallet to chat' : canChat ? 'Type a message...' : `Play ${3 - gamesPlayed} more verified game${3 - gamesPlayed === 1 ? '' : 's'} to chat`} disabled={!canChat || sending} rows={2} /><div><span>{canChat ? '' : `${gamesPlayed}/3 games`}</span><button disabled={!canChat || !draft.trim() || sending} aria-label="Send message"><Send /></button></div><div className="chat-compose-tools"><button type="button" onClick={() => setShowRules(true)}><Info /> Chat Rules</button><button type="button" onClick={() => setShowRules(true)} aria-label="Open chat rules and remaining characters"><MessageCircle /> <output aria-live="polite">{remainingCharacters}</output></button></div></form>
    {showRules && <div className="chat-rules-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowRules(false) }}><section className="chat-rules-modal" role="dialog" aria-modal="true" aria-labelledby="chat-rules-title"><button type="button" onClick={() => setShowRules(false)} aria-label="Close chat rules"><X /></button><Info /><h2 id="chat-rules-title">Chat Rules</h2><div className="chat-rules-placeholder" /></section></div>}
  </aside>
}
