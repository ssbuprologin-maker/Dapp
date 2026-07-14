# Devnet Dino Run - Singleplayer Build V4

A Solana devnet singleplayer dinosaur runner with a personal Upstash Redis score board.

## Current architecture

- Gameplay and collision detection run locally in the browser.
- Phantom, Solflare, Wallet Standard, and encrypted browser-local wallets are supported.
- Each run costs `0.01 devnet SOL` and is signed by the player.
- `/api/game` verifies payments and rejects reused transactions.
- Upstash Redis stores each wallet's ten best runs.
- The interface only loads and displays scores for the currently connected wallet.
- There are no realtime servers, multiplayer connections, cron jobs, or automatic payouts.

The game header must say `SINGLEPLAYER DEVNET - BUILD V4`. If the deployed site displays an older build, redeploy the newest Git commit.

## Vercel project settings

```text
Framework Preset: Vite
Root Directory: leave blank
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

## Upstash Redis

Install **Upstash for Redis** from the Vercel Marketplace and connect it to the project for Production and Preview. Leave the custom prefix blank. Confirm Vercel creates:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

## Required environment variables

```text
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_RPC_URL=https://api.devnet.solana.com
JOIN_FEE_RECEIVER=YOUR_PUBLIC_DEVNET_WALLET_ADDRESS
UPSTASH_REDIS_REST_URL=provided-by-upstash
UPSTASH_REDIS_REST_TOKEN=provided-by-upstash
ALLOW_ALL_PLAYERS=true
PLAYER_WHITELIST=
```

`JOIN_FEE_RECEIVER` is only a public devnet wallet address. Never add a private key or recovery phrase to Vercel. After changing environment variables, redeploy the latest commit to Production.

## Local development

```powershell
npm install
Copy-Item .env.example .env
npx vercel dev
```

Verify the project with:

```powershell
npm run build
npm run check:server
```
