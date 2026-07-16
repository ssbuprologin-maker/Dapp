import { FormEvent, useState } from 'react'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { AlertTriangle, BadgeCheck, Banknote, ExternalLink, X } from 'lucide-react'
import { confirmDevnetSignature, getDevnetBlockhash, sendDevnetRawTransaction } from './solanaRpc'
import { MEGAETH_EXPLORER_URL, sendMegaEthTransfer } from './megaEth'
import { levelTier } from './leveling'
import solCoin from './assets/sol-coin-3d-v1.png'
import ethCoin from './assets/eth-coin-3d-v1.png'

export type TipTarget = {
  wallet: string
  network: 'solana' | 'megaeth'
  name: string
  avatar?: string
  level: number
  verified: boolean
}

function parseUnits(value: string, decimals: number) {
  const match = value.trim().match(new RegExp(`^(\\d+)(?:\\.(\\d{0,${decimals}}))?$`))
  if (!match) throw new Error(`Enter a valid amount with up to ${decimals} decimal places.`)
  const units = BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] ?? '').padEnd(decimals, '0') || '0')
  if (units <= 0n) throw new Error('Tip amount must be greater than zero.')
  return units
}

export default function TipModal({ sender, senderNetwork, target, localWallet, sendTransaction, signTransaction, connection, onClose, onSuccess }: {
  sender: string
  senderNetwork: 'solana' | 'megaeth'
  target: TipTarget
  localWallet: Keypair | null
  sendTransaction: (transaction: Transaction, connection: Connection) => Promise<string>
  signTransaction?: (transaction: Transaction) => Promise<Transaction>
  connection: Connection
  onClose: () => void
  onSuccess: (message: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [transaction, setTransaction] = useState('')
  const sameNetwork = senderNetwork === target.network
  const isSelf = senderNetwork === target.network && sender.toLowerCase() === target.wallet.toLowerCase()
  const currency = target.network === 'solana' ? 'SOL' : 'ETH'
  const explorer = transaction ? target.network === 'solana' ? `https://explorer.solana.com/tx/${transaction}?cluster=devnet` : `${MEGAETH_EXPLORER_URL}/tx/${transaction}` : ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!sameNetwork || isSelf || sending) return
    setSending(true); setError('')
    try {
      const units = parseUnits(amount, target.network === 'solana' ? 9 : 18)
      let signature: string
      if (target.network === 'megaeth') {
        signature = await sendMegaEthTransfer(sender, target.wallet, units)
      } else {
        if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Tip amount is too large.')
        const senderKey = new PublicKey(sender)
        const recipientKey = new PublicKey(target.wallet)
        const transfer = new Transaction().add(SystemProgram.transfer({ fromPubkey: senderKey, toPubkey: recipientKey, lamports: Number(units) }))
        if (localWallet) {
          const latest = await getDevnetBlockhash()
          transfer.feePayer = localWallet.publicKey
          transfer.recentBlockhash = latest.blockhash
          transfer.sign(localWallet)
          signature = await sendDevnetRawTransaction(transfer.serialize())
          await confirmDevnetSignature(signature)
        } else if (signTransaction) {
          const latest = await getDevnetBlockhash()
          transfer.feePayer = senderKey
          transfer.recentBlockhash = latest.blockhash
          const signed = await signTransaction(transfer)
          signature = await sendDevnetRawTransaction(signed.serialize())
          await confirmDevnetSignature(signature)
        } else {
          signature = await sendTransaction(transfer, connection)
          await confirmDevnetSignature(signature)
        }
      }
      setTransaction(signature)
      onSuccess(`${amount} ${currency} tip sent to ${target.name}.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tip transaction failed.')
    } finally { setSending(false) }
  }

  return <div className="tip-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section className="tip-modal" role="dialog" aria-modal="true" aria-label={`Tip ${target.name}`}>
      <button type="button" className="tip-close" onClick={onClose} disabled={sending} aria-label="Close tipping"><X /></button>
      <div className="tip-player-avatar">{target.avatar ? <img src={target.avatar} alt="" /> : <span>{target.name.slice(0, 1).toUpperCase()}</span>}</div>
      <div className="tip-heading"><span>Tipping</span><b className={`level-badge level-tier-${levelTier(target.level)}`}>{target.level}</b><strong>{target.name}</strong>{target.verified && <BadgeCheck className="verified-badge" aria-label="Verified player" />}</div>
      <code className="tip-wallet">{target.wallet.slice(0, 7)}...{target.wallet.slice(-6)} · {target.network === 'solana' ? 'SOLANA DEVNET' : 'MEGAETH TESTNET'}</code>
      {transaction ? <div className="tip-success"><Banknote /><strong>Tip sent successfully</strong><a href={explorer} target="_blank" rel="noreferrer">View transaction <ExternalLink /></a></div> : <form onSubmit={submit}>
        <div className="tip-amount"><img src={target.network === 'solana' ? solCoin : ethCoin} alt="" /><input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.0000" aria-label={`Tip amount in ${currency}`} /><span>{currency}</span><button disabled={!amount.trim() || !sameNetwork || isSelf || sending}>{sending ? 'Confirming…' : <><Banknote /> Tip</>}</button></div>
        {!sameNetwork && <p className="tip-error">Connect a {target.network === 'solana' ? 'Solana' : 'MegaETH'} wallet to tip this player.</p>}
        {isSelf && <p className="tip-error">You cannot tip your own connected wallet.</p>}
        {error && <p className="tip-error">{error}</p>}
      </form>}
      <div className="tip-warning"><AlertTriangle /><p>Confirm the recipient and amount carefully.<strong>All tips are irreversible.</strong></p></div>
    </section>
  </div>
}
