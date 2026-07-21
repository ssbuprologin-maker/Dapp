import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'

type Network = 'solana' | 'megaeth'
const encoder = new TextEncoder()
const codeKey = (network: Network, wallet: string) => `testnet-games:affiliate-code:v1:${network}:${normalizeWallet(network, wallet)}`
const ownerKey = (code: string) => `testnet-games:affiliate-code-owner:v1:${code}`

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Affiliates are not configured.')
  return new Redis({ url, token })
}

function normalizeWallet(network: Network, wallet: string) {
  if (network === 'solana') return new PublicKey(wallet).toBase58()
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid MegaETH wallet address.')
  return wallet.toLowerCase()
}

function affiliateMessage(network: Network, wallet: string, code: string, timestamp: number) {
  return `Testnet Games affiliate code\nNetwork: ${network}\nWallet: ${normalizeWallet(network, wallet)}\nCode: ${code}\nTimestamp: ${timestamp}`
}

function verifySignature(network: Network, wallet: string, message: string, signature: string) {
  if (network === 'solana') {
    if (!ed25519.verify(bs58.decode(signature), encoder.encode(message), new PublicKey(wallet).toBytes())) throw new Error('Wallet signature is invalid.')
    return
  }
  const bytes = signature.startsWith('0x') ? signature.slice(2) : signature
  if (!/^[a-fA-F0-9]{130}$/.test(bytes)) throw new Error('Wallet signature is invalid.')
  const raw = Uint8Array.from(bytes.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16)))
  const messageBytes = encoder.encode(message)
  const prefix = encoder.encode(`\x19Ethereum Signed Message:\n${messageBytes.length}`)
  const payload = new Uint8Array(prefix.length + messageBytes.length)
  payload.set(prefix); payload.set(messageBytes, prefix.length)
  const hash = keccak_256(payload)
  const recovery = raw[64] >= 27 ? raw[64] - 27 : raw[64]
  const publicKey = secp256k1.Signature.fromCompact(raw.slice(0, 64)).addRecoveryBit(recovery).recoverPublicKey(hash).toRawBytes(false)
  const recovered = `0x${Array.from(keccak_256(publicKey.slice(1)).slice(-20), byte => byte.toString(16).padStart(2, '0')).join('')}`
  if (recovered !== wallet.toLowerCase()) throw new Error('Wallet signature is invalid.')
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const network = request.method === 'GET' ? request.query.network : request.body?.network
    const wallet = request.method === 'GET' ? request.query.wallet : request.body?.wallet
    if ((network !== 'solana' && network !== 'megaeth') || typeof wallet !== 'string') throw new Error('Wallet and network are required.')
    const normalized = normalizeWallet(network, wallet)
    const owner = `${network}:${normalized}`
    const redis = redisClient()
    if (request.method === 'GET') return response.status(200).json({ code: await redis.get<string>(codeKey(network, normalized)) ?? '' })
    if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })
    const code = typeof request.body?.code === 'string' ? request.body.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : ''
    const timestamp = Number(request.body?.timestamp)
    const signature = typeof request.body?.signature === 'string' ? request.body.signature : ''
    if (code.length < 3) throw new Error('Affiliate code must contain at least three letters or numbers.')
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new Error('Affiliate request expired. Try again.')
    verifySignature(network, normalized, affiliateMessage(network, normalized, code, timestamp), signature)
    const claimedBy = await redis.get<string>(ownerKey(code))
    if (claimedBy && claimedBy !== owner) throw new Error('That affiliate code is already owned by another user.')
    if (!claimedBy) {
      const claimed = await redis.set(ownerKey(code), owner, { nx: true })
      if (claimed !== 'OK' && await redis.get<string>(ownerKey(code)) !== owner) throw new Error('That affiliate code is already owned by another user.')
    }
    const previous = await redis.get<string>(codeKey(network, normalized))
    await redis.set(codeKey(network, normalized), code)
    if (previous && previous !== code && await redis.get<string>(ownerKey(previous)) === owner) await redis.del(ownerKey(previous))
    return response.status(200).json({ code })
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Affiliate request failed.' })
  }
}
