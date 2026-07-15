import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Redis } from '@upstash/redis'
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'

type Network = 'solana' | 'megaeth'
type Profile = { displayName: string; changedAt: number }

const COOLDOWN_MS = 10 * 60_000
const MIN_SOL_LAMPORTS = Math.floor(0.1 * LAMPORTS_PER_SOL)
const MIN_MEGAETH_WEI = 100_000_000_000_000_000n
const MEGAETH_RPC_URL = 'https://carrot.megaeth.com/rpc'
const encoder = new TextEncoder()

function redisClient() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) throw new Error('Worldwide profiles are not configured.')
  return new Redis({ url, token })
}

function normalizedWallet(network: Network, wallet: string) {
  if (network === 'solana') return new PublicKey(wallet).toBase58()
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid MegaETH wallet address.')
  return wallet.toLowerCase()
}

export function profileKey(network: Network, wallet: string) {
  return `testnet-games:profile:${network}:${normalizedWallet(network, wallet)}`
}

export function nameChangeMessage(network: Network, wallet: string, displayName: string, timestamp: number) {
  return `Testnet Games name change\nNetwork: ${network}\nWallet: ${normalizedWallet(network, wallet)}\nName: ${displayName}\nTimestamp: ${timestamp}`
}

function verifySignature(network: Network, wallet: string, message: string, signature: string) {
  if (network === 'solana') {
    if (!ed25519.verify(bs58.decode(signature), encoder.encode(message), new PublicKey(wallet).toBytes())) {
      throw new Error('Wallet signature is invalid.')
    }
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

async function verifyBalance(network: Network, wallet: string) {
  if (network === 'solana') {
    const endpoints = [...new Set([process.env.SOLANA_RPC_URL?.trim(), 'https://api.devnet.solana.com'].filter(Boolean) as string[])]
    let balance: number | null = null
    for (const endpoint of endpoints) {
      try { balance = await new Connection(endpoint, 'confirmed').getBalance(new PublicKey(wallet)); break } catch { /* Try fallback. */ }
    }
    if (balance === null) throw new Error('Could not verify the Solana balance.')
    if (balance <= MIN_SOL_LAMPORTS) throw new Error('More than 0.1 devnet SOL is required to change your name.')
    return
  }
  const rpc = await fetch(MEGAETH_RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet, 'latest'] }) })
  const body = await rpc.json() as { result?: string }
  if (!body.result) throw new Error('Could not verify the MegaETH balance.')
  if (BigInt(body.result) <= MIN_MEGAETH_WEI) throw new Error('More than 0.1 MegaETH testnet ETH is required to change your name.')
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store')
  try {
    const network = request.method === 'GET' ? request.query.network : request.body?.network
    const wallet = request.method === 'GET' ? request.query.wallet : request.body?.wallet
    if ((network !== 'solana' && network !== 'megaeth') || typeof wallet !== 'string') throw new Error('Wallet and network are required.')
    const redis = redisClient()
    const key = profileKey(network, wallet)
    if (request.method === 'GET') {
      const profile = await redis.get<Profile>(key)
      return response.status(200).json({ displayName: profile?.displayName ?? '', nextChangeAt: (profile?.changedAt ?? 0) + COOLDOWN_MS })
    }
    if (request.method !== 'POST') return response.status(405).json({ message: 'Method not allowed.' })
    const displayName = typeof request.body?.displayName === 'string' ? request.body.displayName.trim().replace(/\s+/g, ' ') : ''
    const timestamp = Number(request.body?.timestamp)
    const signature = typeof request.body?.signature === 'string' ? request.body.signature : ''
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{1,18}[A-Za-z0-9]$/.test(displayName)) throw new Error('Name must be 3–20 characters using letters, numbers, spaces, _ or -.')
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new Error('Name-change request expired. Try again.')
    verifySignature(network, wallet, nameChangeMessage(network, wallet, displayName, timestamp), signature)
    await verifyBalance(network, wallet)
    const current = await redis.get<Profile>(key)
    const nextChangeAt = (current?.changedAt ?? 0) + COOLDOWN_MS
    if (nextChangeAt > Date.now()) throw new Error(`Name can be changed again in ${Math.ceil((nextChangeAt - Date.now()) / 60_000)} minute(s).`)
    const cooldownKey = `${key}:name-change-cooldown`
    const claimed = await redis.set(cooldownKey, '1', { nx: true, px: COOLDOWN_MS })
    if (claimed !== 'OK') throw new Error('Name can only be changed once every 10 minutes.')
    const profile: Profile = { displayName, changedAt: Date.now() }
    await redis.set(key, profile)
    return response.status(200).json({ displayName, nextChangeAt: profile.changedAt + COOLDOWN_MS })
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : 'Profile request failed.' })
  }
}
