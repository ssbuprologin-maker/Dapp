# Devnet Dino Run

A Solana devnet wallet gate and server-authoritative multiplayer dinosaur runner.

## What is included

- Custom Anza wallet-adapter interface for Phantom, Solflare and Wallet Standard wallets.
- Password-encrypted browser-local site wallets with recovery export/import.
- Direct `0.01 SOL` devnet entry fee for every round.
- Non-custodial payment signed directly by the player's wallet.
- Server-side payment confirmation and signature replay protection.
- Server-side wallet whitelist.
- One-time signed wallet challenge to prove wallet ownership.
- Socket.IO live player movement, jumps, eliminations and results.
- Server-side physics and collision detection.
- Redis-backed Socket.IO broadcasting and shared round state.
- Persistent Redis sorted-set leaderboard ranked by wins.
- Countdown, spectators, reconnect handling and last-player-standing winner selection.

This is a devnet game. The 0.01 SOL payment is a direct, non-refundable participation fee sent to the configured devnet receiver. It is not a wager or prize pool.

## Local frontend

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

`npm run dev` serves only the Vite frontend. Use Vercel's local runtime when testing Socket.IO:

```powershell
npx vercel dev
```

In `.env`, set `ALLOW_ALL_PLAYERS=true` for temporary local testing, or add wallet addresses to `PLAYER_WHITELIST`.

## Deploy to Vercel

### 1. Import the repository

In Vercel, create a project from this Git repository and choose:

```text
Framework Preset: Vite
Root Directory: leave blank (repository root)
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

The included `vercel.json` configures the Socket.IO function with a five-minute maximum duration.

### 2. Add Redis

Open the Vercel Marketplace from the project, install a Redis integration, and connect it to this project. Ensure the integration exposes a standard Redis connection string as:

```text
REDIS_URL=rediss://...
```

Redis is required for reliable rooms across multiple Vercel Function instances. Do not expose this value with a `VITE_` prefix.

### 3. Add environment variables

In **Project Settings -> Environment Variables**, add these to Production and Preview:

```text
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_RPC_URL=https://api.devnet.solana.com
JOIN_FEE_RECEIVER=YOUR_DEVNET_FEE_WALLET
PLAYER_WHITELIST=FIRST_WALLET_ADDRESS,SECOND_WALLET_ADDRESS
ALLOW_ALL_PLAYERS=false
REDIS_URL=provided-by-your-redis-integration
```

Use public wallet addresses only in `PLAYER_WHITELIST`, separated by commas and with no quotes. Add every player who should be able to enter. The server rejects non-whitelisted wallets even if they have enough SOL.

`SOLANA_RPC_URL` is used privately by the Socket.IO server to verify every entry transaction. `VITE_SOLANA_RPC_URL` is the public browser RPC endpoint.

`JOIN_FEE_RECEIVER` must be a public address for a devnet wallet you control. Never add its private key or recovery phrase. The server verifies that every submitted transaction is confirmed, recent, unused, sent by the authenticated player, sent to this exact receiver, and transfers at least 0.01 SOL.

### 4. Leaderboard database

No additional database is required. The same managed Redis integration stores leaderboard wins in a sorted set named:

```text
dinorun:leaderboard:wins:v1
```

Each completed round atomically adds one win to the last surviving wallet. Redis stores and ranks the records without you hosting a database process. Persistence guarantees depend on the Redis plan; choose a persistence-enabled plan for a production leaderboard.

### 5. Enable and deploy

WebSockets require Fluid Compute. It is enabled by default for new Vercel projects; verify it under the project's Functions settings. Deploy the project again after adding or changing environment variables.

The client connects using:

```text
/api/socket-io/socket.io
```

Socket.IO is forced to the WebSocket transport, as required by Vercel's WebSocket function setup.

## Verification

```powershell
npm run build
npm run check:server
```

To test a match, whitelist two wallet addresses, fund both with slightly more than 0.01 devnet SOL, and open the deployment in two separate browser profiles. Each player connects, enters Dino Run, and confirms the 0.01 SOL transfer. The round begins eight seconds after the second payment is verified.

## Production notes

- Keep `ALLOW_ALL_PLAYERS=false` on Vercel.
- Use only a devnet receiver while this app points to devnet.
- Never put the receiver wallet's private key in source code or Vercel.
- Keep Redis private and protected with TLS and credentials.
- Site wallets are intended for devnet convenience and have not been independently audited.
- Vercel WebSockets are currently beta and connections end at the Function maximum duration; Socket.IO reconnects automatically and reloads shared Redis state.
