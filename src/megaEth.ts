export const MEGAETH_CHAIN_ID = 6343
export const MEGAETH_CHAIN_HEX = '0x18c7'
export const MEGAETH_RPC_URL = 'https://carrot.megaeth.com/rpc'
export const MEGAETH_EXPLORER_URL = 'https://megaeth-testnet-v2.blockscout.com'
export const MEGAETH_FAUCET_URL = 'https://testnet.megaeth.com'
export const MEGAETH_ENTRY_WEI = 10_000_000_000_000_000n
export const MEGAETH_RECEIVER = '0x4caf2B570ACF0600810fec32373880fC8b94AA18'

type ProviderRequest = { method: string; params?: unknown[] | Record<string, unknown> }

export type EthereumProvider = {
  isMetaMask?: boolean
  providers?: EthereumProvider[]
  request: <T = unknown>(request: ProviderRequest) => Promise<T>
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

declare global {
  interface Window { ethereum?: EthereumProvider }
}

export function getMetaMaskProvider() {
  const injected = window.ethereum
  if (!injected) return null
  return injected.providers?.find(provider => provider.isMetaMask) ?? (injected.isMetaMask ? injected : null)
}

const providerErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error ? Number((error as { code: unknown }).code) : 0

export async function ensureMegaEthTestnet(provider = getMetaMaskProvider()) {
  if (!provider) throw new Error('MetaMask is not installed in this browser.')
  const current = await provider.request<string>({ method: 'eth_chainId' })
  if (current.toLowerCase() === MEGAETH_CHAIN_HEX) return provider
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MEGAETH_CHAIN_HEX }] })
  } catch (error) {
    if (providerErrorCode(error) !== 4902) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: MEGAETH_CHAIN_HEX,
        chainName: 'MegaETH Testnet',
        nativeCurrency: { name: 'MegaETH Testnet Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: [MEGAETH_RPC_URL],
        blockExplorerUrls: [MEGAETH_EXPLORER_URL],
      }],
    })
  }
  return provider
}

export async function connectMetaMask() {
  const provider = getMetaMaskProvider()
  if (!provider) throw new Error('MetaMask is not installed. Install or enable the MetaMask browser extension first.')
  const accounts = await provider.request<string[]>({ method: 'eth_requestAccounts' })
  if (!accounts[0]) throw new Error('MetaMask did not return an account.')
  await ensureMegaEthTestnet(provider)
  return accounts[0]
}

export async function getMegaEthBalance(address: string) {
  const provider = await ensureMegaEthTestnet()
  const value = await provider.request<string>({ method: 'eth_getBalance', params: [address, 'latest'] })
  return Number(BigInt(value)) / 1e18
}

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))

export async function sendMegaEthEntry(from: string) {
  const provider = await ensureMegaEthTestnet()
  const transactionHash = await provider.request<string>({
    method: 'eth_sendTransaction',
    params: [{ from, to: MEGAETH_RECEIVER, value: `0x${MEGAETH_ENTRY_WEI.toString(16)}` }],
  })
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const receipt = await provider.request<{ status?: string } | null>({
      method: 'eth_getTransactionReceipt', params: [transactionHash],
    })
    if (receipt) {
      if (receipt.status === '0x0') throw new Error('The MegaETH entry transaction failed.')
      return transactionHash
    }
    await wait(700)
  }
  throw new Error('MegaETH confirmation timed out. Check MetaMask before trying again.')
}

