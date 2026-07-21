import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Connection, PublicKey } from '@solana/web3.js'

type Network = 'solana' | 'megaeth'

const solanaConnections = [...new Set([
  process.env.SOLANA_RPC_URL?.trim(),
  'https://solana-devnet.gateway.tatum.io',
  'https://api.devnet.solana.com',
].filter(Boolean) as string[])].map(endpoint => new Connection(endpoint, 'confirmed'))
const MEGAETH_RPC_URL = 'https://carrot.megaeth.com/rpc'
const MEGAETH_EXPLORER_URL = 'https://megaeth-testnet-v2.blockscout.com'

async function solanaHasTransaction(wallet: string) {
  const address = new PublicKey(wallet)
  let lastError: unknown
  for (const connection of solanaConnections) {
    try { return (await connection.getSignaturesForAddress(address, { limit: 1 }, 'confirmed')).length > 0 }
    catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not check Solana wallet history.')
}

async function megaEthHasTransaction(wallet: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid MegaETH wallet address.')
  try {
    const result = await fetch(`${MEGAETH_EXPLORER_URL}/api/v2/addresses/${wallet}/transactions`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000),
    })
    const body = await result.json() as { items?: unknown[] }
    if (result.ok && Array.isArray(body.items)) return body.items.length > 0
  } catch { /* The RPC nonce below remains a useful outgoing-activity fallback. */ }
  const result = await fetch(MEGAETH_RPC_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [wallet, 'latest'] }),
    signal: AbortSignal.timeout(5_000),
  })
  const body = await result.json() as { result?: string; error?: { message?: string } }
  if (!result.ok || body.error || !body.result) throw new Error(body.error?.message ?? 'Could not check MegaETH wallet history.')
  return BigInt(body.result) > 0n
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET') return response.status(405).json({ message: 'Method not allowed.' })
  response.setHeader('Cache-Control', 'private, max-age=10, s-maxage=10')
  try {
    const network = request.query.network as Network
    const wallet = typeof request.query.wallet === 'string' ? request.query.wallet.trim() : ''
    if ((network !== 'solana' && network !== 'megaeth') || !wallet) throw new Error('Wallet and network are required.')
    const eligible = network === 'solana' ? await solanaHasTransaction(wallet) : await megaEthHasTransaction(wallet)
    return response.status(200).json({ eligible, minimumTransactions: 1 })
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Wallet history check failed.' })
  }
}
