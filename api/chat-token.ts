import type { VercelRequest, VercelResponse } from '@vercel/node'
import Ably from 'ably'
import { PublicKey } from '@solana/web3.js'

const CHANNEL = 'testnet-games-global-chat'

function validIdentity(network: unknown, wallet: unknown) {
  if (network === 'solana' && typeof wallet === 'string') {
    try { return new PublicKey(wallet).toBase58() } catch { return '' }
  }
  if (network === 'megaeth' && typeof wallet === 'string' && /^0x[a-fA-F0-9]{40}$/.test(wallet)) return wallet.toLowerCase()
  return ''
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    if (request.method !== 'GET') return response.status(405).json({ message: 'Method not allowed.' })
    const key = process.env.ABLY_API_KEY?.trim()
    if (!key) return response.status(503).json({ message: 'Live chat is not configured. Add ABLY_API_KEY in Vercel.' })
    const wallet = validIdentity(request.query.network, request.query.wallet)
    const clientId = wallet ? `${request.query.network}:${wallet}` : `visitor-${crypto.randomUUID()}`
    const operations = wallet ? ['subscribe', 'history', 'publish'] : ['subscribe', 'history']
    const ably = new Ably.Rest(key)
    const tokenRequest = await ably.auth.createTokenRequest({ clientId, capability: JSON.stringify({ [CHANNEL]: operations }) })
    return response.status(200).json(tokenRequest)
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Could not authorize live chat.' })
  }
}
