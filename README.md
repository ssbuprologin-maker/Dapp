# Devnet Dino Run - Singleplayer Build V2

A Solana devnet singleplayer dinosaur runner with an hourly Redis leaderboard and automated devnet prize payout.

## Current architecture

- Gameplay and collision detection run locally in the browser.
- Phantom, Solflare, Wallet Standard, and encrypted browser-local wallets are supported.
- Each run costs `0.01 devnet SOL` and is signed by the player.
- `/api/game` verifies payments, rejects reused transactions, and stores scores.
- Redis tracks the current UTC hour's leaderboard and exact entry pool.
- Vercel Cron calls `/api/hourly-payout` at five minutes after every hour.
- The top wallet from the previous UTC hour receives that hour's tracked entry pool.

The game header must say `SINGLEPLAYER DEVNET - BUILD V2`. If the deployed site shows an old realtime error, Vercel is serving an earlier commit or deployment.

## Vercel project settings

```text
Framework Preset: Vite
Root Directory: leave blank
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

Push the current files to GitHub, open the Vercel project's **Deployments** tab, and redeploy the newest commit. Do not redeploy an older deployment from the list.

## Redis database

Add the **Upstash Redis** integration from the Vercel Marketplace and connect it to the project. It creates the connectionless HTTP credentials used by Vercel Functions. The app uses separate Redis keys for each UTC hour and keeps the all-time best scores separately.

## Required environment variables

Add these to the Vercel Production environment:

```text
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_RPC_URL=https://api.devnet.solana.com
UPSTASH_REDIS_REST_URL=provided-by-upstash
UPSTASH_REDIS_REST_TOKEN=provided-by-upstash
JOIN_FEE_RECEIVER=PUBLIC_ADDRESS_OF_DEDICATED_DEVNET_WALLET
PAYOUT_WALLET_SECRET_KEY=[64,SECRET,KEY,BYTES,...]
CRON_SECRET=LONG_RANDOM_SECRET
ALLOW_ALL_PLAYERS=true
PLAYER_WHITELIST=
```

`PAYOUT_WALLET_SECRET_KEY` must be the JSON number array for the same wallet named by `JOIN_FEE_RECEIVER`. Use a new devnet-only wallet. Never use a wallet that has held mainnet assets, and never commit its recovery data to Git.

The payout function verifies all of the following before signing:

- The RPC is actually Solana devnet.
- The secret key matches `JOIN_FEE_RECEIVER`.
- The request contains Vercel's `Authorization: Bearer $CRON_SECRET` header.
- Redis has not already confirmed a payout for that hour.
- The payout never exceeds the entry amount tracked for that hour.

Keep a small amount of extra devnet SOL in the receiver wallet for transaction fees. The tracked entry pool itself is transferred to the winner.

After adding the variables, trigger a new Production deployment. Vercel registers the included hourly schedule from `vercel.json`; scheduled invocations run against Production deployments.

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

## Limitations

This implementation is locked to devnet. Scores are timing-checked by the API, but gameplay runs in the browser and is not strong anti-cheat protection. Do not switch this design to real-value funds without an audited on-chain escrow program, stronger game verification, and a legal review of paid-entry prize rules in the places where the game is offered.
