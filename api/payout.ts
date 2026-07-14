import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js'
import bs58 from 'bs58'

const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const RECEIVER_ADDRESS = '3aLAsDDF7JBhGGWdENyoFGP36PftRKpufHCN64myPLtN'
const ENTRY_LAMPORTS = 10_000_000
const PAYOUT_LAMPORTS = 20_000_000
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const solana = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed')

function loadTreasury() {
  const raw = process.env.PAYOUT_WALLET_PRIVATE_KEY?.trim()
  if (!raw) throw new Error('PAYOUT_WALLET_PRIVATE_KEY is not configured in Vercel.')
  try {
    const bytes = raw.startsWith('[')
      ? Uint8Array.from(JSON.parse(raw) as number[])
      : bs58.decode(raw)
    if (bytes.length !== 64) throw new Error('Expected 64 secret-key bytes.')
    return Keypair.fromSecretKey(bytes)
  } catch {
    throw new Error('PAYOUT_WALLET_PRIVATE_KEY is not a valid Solana private key.')
  }
}

async function verifyEntry(wallet: string, entrySignature: string) {
  let transaction = await solana.getParsedTransaction(entrySignature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  for (let attempt = 0; !transaction && attempt < 5; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 600))
    transaction = await solana.getParsedTransaction(entrySignature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
  }
  if (!transaction || transaction.meta?.err) throw new Error('The entry payment is not confirmed.')
  if (!transaction.blockTime || transaction.blockTime * 1000 < Date.now() - 30 * 60_000) throw new Error('The entry payment is too old.')
  const valid = transaction.transaction.message.instructions.some(instruction => {
    if (!('parsed' in instruction)) return false
    const parsed = instruction.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } }
    return parsed.type === 'transfer'
      && parsed.info?.source === wallet
      && parsed.info?.destination === RECEIVER_ADDRESS
      && Number(parsed.info?.lamports) >= ENTRY_LAMPORTS
  })
  if (!valid) throw new Error('The transaction is not a valid 0.01 SOL game entry.')
}

async function wasPaid(entrySignature: string, treasury: PublicKey) {
  const marker = `DINO_PAYOUT:${entrySignature}`
  const signatures = await solana.getSignaturesForAddress(treasury, { limit: 30 }, 'confirmed')
  if (!signatures.length) return false
  const transactions = await solana.getParsedTransactions(signatures.map(item => item.signature), {
    commitment: 'confirmed', maxSupportedTransactionVersion: 0,
  })
  return transactions.some(transaction => transaction && JSON.stringify(transaction).includes(marker))
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })
  try {
    if (await solana.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('Payouts are locked to Solana devnet.')
    const wallet = typeof request.body?.wallet === 'string' ? request.body.wallet : ''
    const entrySignature = typeof request.body?.entrySignature === 'string' ? request.body.entrySignature : ''
    const player = new PublicKey(wallet)
    if (!entrySignature) throw new Error('The entry transaction signature is required.')
    const treasury = loadTreasury()
    const receiver = new PublicKey(RECEIVER_ADDRESS)
    if (!treasury.publicKey.equals(receiver)) throw new Error('The payout private key does not match the configured receiver.')

    await verifyEntry(player.toBase58(), entrySignature)
    if (await wasPaid(entrySignature, treasury.publicKey)) throw new Error('This game entry was already paid.')
    const balance = await solana.getBalance(treasury.publicKey, 'confirmed')
    if (balance < PAYOUT_LAMPORTS + 5_000) throw new Error('The payout wallet does not have enough devnet SOL.')

    const latest = await solana.getLatestBlockhash('confirmed')
    const transaction = new Transaction({ feePayer: treasury.publicKey, recentBlockhash: latest.blockhash })
      .add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: player, lamports: PAYOUT_LAMPORTS }))
      .add(new TransactionInstruction({
        programId: MEMO_PROGRAM,
        keys: [],
        data: Buffer.from(`DINO_PAYOUT:${entrySignature}`),
      }))
    transaction.sign(treasury)
    const payoutSignature = await solana.sendRawTransaction(transaction.serialize(), { maxRetries: 3 })
    await solana.confirmTransaction({ signature: payoutSignature, ...latest }, 'confirmed')
    return response.status(200).json({ payoutSignature, amount: 0.02 })
  } catch (error) {
    console.error('Devnet payout failed', error)
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Payout failed.' })
  }
}
