import { Connection, PublicKey } from '@solana/web3.js'

export const FREE_DEVNET_RPC = 'https://solana-devnet.gateway.tatum.io'
const OFFICIAL_DEVNET_RPC = 'https://api.devnet.solana.com'

const configured = import.meta.env.VITE_SOLANA_RPC_URL?.trim()
const endpoints = [...new Set([configured, FREE_DEVNET_RPC, OFFICIAL_DEVNET_RPC].filter(Boolean) as string[])]

export const rpcConnections = endpoints.map(endpoint => new Connection(endpoint, 'confirmed'))

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))
const canTryAnotherRpc = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /429|too many requests|rate.?limit|fetch|network|failed to connect|timeout|503|502|504|403|401|paid plans|upgrade/i.test(message)
}

export async function withRpcFallback<T>(operation: (connection: Connection) => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let round = 0; round < 2; round += 1) {
    for (const connection of rpcConnections) {
      try {
        return await operation(connection)
      } catch (error) {
        lastError = error
        if (!canTryAnotherRpc(error)) throw error
      }
    }
    if (round === 0) await wait(700)
  }
  throw lastError instanceof Error ? lastError : new Error('Every free Solana devnet RPC is currently unavailable.')
}

export const getDevnetBalance = (publicKey: PublicKey) =>
  withRpcFallback(connection => connection.getBalance(publicKey, 'confirmed'))

export const getDevnetBlockhash = () =>
  withRpcFallback(connection => connection.getLatestBlockhash('confirmed'))

export const sendDevnetRawTransaction = (serialized: Uint8Array) =>
  withRpcFallback(connection => connection.sendRawTransaction(serialized, { maxRetries: 3 }))

export async function confirmDevnetSignature(signature: string) {
  const deadline = Date.now() + 45_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await withRpcFallback(connection => connection.getSignatureStatus(signature, { searchTransactionHistory: true }))
      const status = response.value
      if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`)
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
    } catch (error) {
      lastError = error
      if (!canTryAnotherRpc(error)) throw error
    }
    await wait(1_200)
  }
  throw lastError instanceof Error ? lastError : new Error('Transaction confirmation timed out. Check the signature in Solana Explorer before retrying.')
}
