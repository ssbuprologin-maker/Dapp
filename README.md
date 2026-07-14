# Devnet Dino Run

A Solana devnet wallet gate and singleplayer dinosaur runner with a persistent online leaderboard.

## Included

- Custom Anza wallet-adapter interface for Phantom, Solflare, and Wallet Standard wallets.
- Password-encrypted browser-local site wallets with recovery export/import.
- A direct, non-custodial `0.01 SOL` devnet entry fee for each run.
- Server-side confirmation and transaction replay protection.
- Browser-based Dino Run gameplay with keyboard, mouse, and touch controls.
- A Redis-backed leaderboard that keeps each wallet's best distance.
- Optional wallet whitelist.

This is a devnet game. The entry payment is a direct, non-refundable participation fee sent to the configured devnet receiver. It is not a wager or prize pool.

## Deploy to Vercel

Import this Git repository into Vercel with:

```text
Framework Preset: Vite
Root Directory: leave blank
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

No WebSocket or Fluid Compute setup is needed. The game runs locally in each player's browser and uses normal Vercel API requests for payment verification and leaderboard updates.

## Add the free database

In the Vercel project, open **Storage** or **Marketplace**, add a Redis-compatible integration, and connect it to the project. A free Redis plan is enough for initial testing. Ensure it provides:

```text
REDIS_URL=rediss://...
```

The leaderboard is stored in the sorted set `dinorun:leaderboard:scores:v1`. You do not host a database server yourself.

## Environment variables

In **Project Settings -> Environment Variables**, add these for Production and Preview:

```text
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_RPC_URL=https://api.devnet.solana.com
JOIN_FEE_RECEIVER=YOUR_DEVNET_FEE_WALLET
PLAYER_WHITELIST=FIRST_WALLET_ADDRESS,SECOND_WALLET_ADDRESS
ALLOW_ALL_PLAYERS=false
REDIS_URL=provided-by-your-redis-integration
```

`JOIN_FEE_RECEIVER` is only a public devnet wallet address. Never put a private key or recovery phrase in Vercel.

For a public game, set `ALLOW_ALL_PLAYERS=true`. To restrict access, keep it `false` and list allowed public addresses in `PLAYER_WHITELIST`, separated by commas.

After adding or changing variables, redeploy the project.

## Local development

Vite alone does not run the `/api/game` Vercel function. For the complete local app, use:

```powershell
npm install
Copy-Item .env.example .env
npx vercel dev
```

## Verification

```powershell
npm run build
npm run check:server
```

## Important note

Payment validity and score timing are checked by the API, but the collision engine runs in the browser. This is suitable for a simple devnet game; a real-money competitive leaderboard would need server-authoritative gameplay and stronger anti-cheat controls.
