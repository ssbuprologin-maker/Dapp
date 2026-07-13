# Devnet Gate

A focused Solana devnet wallet portal built with [Anza Wallet Adapter](https://github.com/anza-xyz/wallet-adapter).

## Features

- Custom wallet-selection interface; no stock wallet modal.
- Phantom, Solflare, and automatically discovered Wallet Standard wallets.
- Browser-local site wallet creation and unlocking.
- AES-GCM encryption with PBKDF2 password derivation (250,000 iterations).
- Recovery-file export and import.
- Confirmed devnet balance lookup.
- Application access remains locked below `0.1 SOL`.

The site wallet is non-custodial: encryption and decryption occur in the browser. It is still a convenience wallet and has not been independently audited. Use it only on devnet.

## Local setup

Install Node.js LTS, then:

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

## Vercel

Import the repository in Vercel. The included `vercel.json` supplies the Vite build configuration. Add this environment variable in Project Settings:

```text
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
```

Then deploy. No private keys or server-side secrets are required.
