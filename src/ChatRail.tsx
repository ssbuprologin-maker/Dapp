import { FormEvent, useEffect, useRef, useState } from 'react'
import { MessageCircle, Send } from 'lucide-react'

type Network = 'solana' | 'megaeth'
type ChatMessage = { id: string; name: string; message: string; network: Network; wallet?: string; sentAt: number }

export default function ChatRail({ wallet, network }: { wallet: string | null; network: Network }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [ownAvatar, setOwnAvatar] = useState('')
  const feed = useRef<HTMLDivElement>(null)

  const refresh = () => fetch('/api/chat', { cache: 'no-store' })
    .then(async response => {
      const body = await response.json() as { messages?: ChatMessage[]; message?: string }
      if (!response.ok) throw new Error(body.message ?? 'Chat unavailable.')
      setMessages(Array.isArray(body.messages) ? body.messages : [])
      setError('')
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Chat unavailable.'))

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 4_000)
    return () => window.clearInterval(timer)
  }, [])

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

  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (!wallet || !draft.trim() || sending) return
    setSending(true); setError('')
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wallet, network, message: draft }) })
      const body = await response.json() as { messages?: ChatMessage[]; message?: string }
      if (!response.ok) throw new Error(body.message ?? 'Could not send message.')
      setDraft(''); setMessages(body.messages ?? [])
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not send message.') }
    finally { setSending(false) }
  }

  return <aside className="chat-rail">
    <div className="chat-title"><div><MessageCircle /><span><strong>LIVE CHAT</strong><small>GLOBAL ROOM</small></span></div><i /></div>
    <div className="chat-feed" ref={feed}>{messages.length ? messages.map(item => { const isOwn = Boolean(wallet && item.wallet === (network === 'megaeth' ? wallet.toLowerCase() : wallet) && item.network === network); return <article key={item.id}><div className="chat-avatar">{isOwn && ownAvatar ? <img src={ownAvatar} alt="" /> : <span>{item.name.slice(0, 1).toUpperCase()}</span>}</div><div className="chat-message"><header><strong>{item.name}</strong><time>{new Date(item.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header><p>{item.message}</p></div><small>{item.network === 'solana' ? 'SOL' : 'MEGA'}</small></article> }) : <div className="chat-empty">No messages yet.<br />Start the global chat.</div>}</div>
    {error && <div className="chat-error">{error}</div>}
    <form className="chat-compose" onSubmit={send}><textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={240} placeholder={wallet ? 'Type a message...' : 'Connect wallet to chat'} disabled={!wallet || sending} rows={2} /><div><span>{draft.length}/240</span><button disabled={!wallet || !draft.trim() || sending} aria-label="Send message"><Send /></button></div></form>
  </aside>
}
