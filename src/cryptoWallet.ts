import { Keypair } from '@solana/web3.js'

const STORAGE_KEY = 'testnet-games.encrypted-wallet.v1'
const LEGACY_STORAGE_KEY = 'devnet-gate.encrypted-wallet.v1'
const encoder = new TextEncoder()

type EncryptedWallet = { version: 1; salt: string; iv: string; cipher: string; publicKey: string }

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

const base64ToBytes = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))

async function passwordKey(password: string, salt: Uint8Array, usage: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 250_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  )
}

export const hasStoredWallet = () => Boolean(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY))

export async function createEncryptedWallet(password: string) {
  if (password.length < 10) throw new Error('Use at least 10 characters.')
  const wallet = Keypair.generate()
  await storeWallet(wallet, password)
  return wallet
}

export async function storeWallet(wallet: Keypair, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await passwordKey(password, salt, ['encrypt'])
  const secret = encoder.encode(JSON.stringify(Array.from(wallet.secretKey)))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secret)
  const record: EncryptedWallet = {
    version: 1,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipher)),
    publicKey: wallet.publicKey.toBase58(),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export async function unlockStoredWallet(password: string) {
  const current = localStorage.getItem(STORAGE_KEY)
  const raw = current ?? localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) throw new Error('No site wallet exists in this browser.')
  try {
    const record = JSON.parse(raw) as EncryptedWallet
    const salt = base64ToBytes(record.salt)
    const iv = base64ToBytes(record.iv)
    const key = await passwordKey(password, salt, ['decrypt'])
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(record.cipher))
    const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(new TextDecoder().decode(plain)) as number[]))
    if (!current) await storeWallet(wallet, password)
    return wallet
  } catch {
    throw new Error('Incorrect password or damaged wallet data.')
  }
}

export function exportRecovery(wallet: Keypair) {
  const contents = JSON.stringify({
    warning: 'Anyone with this file controls this wallet. Store it offline and never share it.',
    publicKey: wallet.publicKey.toBase58(),
    secretKey: Array.from(wallet.secretKey),
  }, null, 2)
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `testnet-games-solana-wallet-${wallet.publicKey.toBase58().slice(0, 8)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function forgetStoredWallet() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}
