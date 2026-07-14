import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import App from './App'
import './styles.css'
import { FREE_DEVNET_RPC } from './solanaRpc'
import { initializeAnalytics } from './analytics'

// This connection is used by wallet-adapter. Game RPC calls also have automatic
// HTTP fallback in solanaRpc.ts, so no Vercel variable is required.
const endpoint = FREE_DEVNET_RPC
initializeAnalytics()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[new PhantomWalletAdapter(), new SolflareWalletAdapter()]} autoConnect={false}>
        <App />
      </WalletProvider>
    </ConnectionProvider>
  </React.StrictMode>,
)
