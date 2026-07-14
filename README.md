# TESTNET GAMES - Dino Run Build V20

A Solana devnet and MegaETH testnet player-versus-bot runner with Phantom, Solflare, browser-local Solana wallets, and MetaMask.

## How it works

- Solana players pay `0.01 devnet SOL` to the configured Solana receiver.
- MetaMask players are prompted to add or switch to MegaETH testnet, then pay `0.01 testnet ETH` to `0x4caf2B570ACF0600810fec32373880fC8b94AA18`.
- The local bot runs ahead, survives at least the opening 30 seconds, and then has only a small deterministic mistake chance.
- Cactus waves are closer together, triple groups appear more often, and the race accelerates to a higher top speed while retaining a safe minimum jump gap.
- Both dinosaurs use alternating animated legs while running; the animation pauses when the race finishes.
- If the player crashes first, there is no payout.
- If the bot crashes first in a Solana game, the browser submits the entry signature to `/api/payout`.
- The Solana payout function verifies the entry transfer and sends `0.02 devnet SOL` to the player.
- MegaETH wins are recorded locally and do not currently trigger an automatic payout.
- A Solana memo is added to payout transactions to reduce reuse of an entry signature.
- The worldwide leaderboard is stored in Upstash Redis, with browser-local scores as an automatic fallback.
- Worldwide rankings refresh every 15 seconds so scores from other players appear without a page reload.
- Upstash Redis stores aggregate visits, time-on-site, wallet connections, SOL/ETH entries, games, wins, and losses.
- PostHog is an optional visual analytics dashboard for the same anonymous browser events.

This is testnet-only. The browser reports who won, so a user can fake a winning result. Duplicate protection is also best-effort without a database. Never point this prototype at mainnet or a wallet containing real assets.

## MegaETH testnet

The MetaMask integration uses MegaETH testnet chain ID `6343` (`0x18c7`), native token `ETH`, RPC `https://carrot.megaeth.com/rpc`, and the official Blockscout explorer. MetaMask adds the network automatically when needed. No Vercel environment variable is required for the EVM connection or entry transfer.

## Optional PostHog analytics dashboard

1. Create a free PostHog Cloud project.
2. Copy the project API key and API host from the PostHog setup page.
3. In Vercel, open **Project > Settings > Environment Variables** and add:

```text
VITE_POSTHOG_KEY=phc_your_public_project_key
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

Use the host displayed by your project; EU projects commonly use a different host. Enable the variables for Production and Preview, then redeploy.

PostHog automatically captures `$pageview` and `$pageleave` for visits and time-on-site. This project also captures:

- `wallet_connected`: wallet type and Solana/MegaETH network
- `game_transaction_confirmed`: network, SOL/ETH currency, and 0.01 amount
- `game_finished`: network, win/loss, and duration in seconds

No wallet address, transaction hash, private key, password, or recovery material is sent to PostHog.

## Required Upstash analytics and worldwide leaderboard setup

1. Open `https://console.upstash.com/redis` and create a Redis database near most of your users.
2. Open the database's **Connect** section and copy its REST URL and REST token.
3. Add these exact server-only variables in Vercel for Production and Preview:

```text
UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_rest_token
```

Do not prefix either variable with `VITE_`; that would expose the Redis token in the browser. If Vercel asks for a custom integration prefix, leave it blank or manually create the two exact variable names above. Redeploy after saving them. No schema or migration command is required.

Those are the only Redis-related Vercel variables. The requested measurements are created automatically as data inside Redis:

```text
testnet-games:analytics:totals
testnet-games:analytics:daily:YYYY-MM-DD
testnet-games:analytics:unique-visitors
testnet-games:leaderboard:v1
```

Open the Upstash database **Data Browser** to inspect these keys. The totals and daily hashes contain fields including:

```text
site_visits
sessions_measured
session_seconds_total
wallet_connections
wallet_metamask
wallet_phantom
wallet_solflare
wallet_site_wallet
wallet_network_solana_devnet
wallet_network_megaeth_testnet
game_transactions
game_transactions_solana_devnet
game_transactions_megaeth_testnet
games_finished
player_wins
player_losses
```

Average time on site is `session_seconds_total / sessions_measured`. The `unique-visitors` HyperLogLog stores only anonymous browser IDs; wallet addresses and transaction hashes are not stored in analytics. They are used separately by the payment-verified leaderboard.

The API stores the top 500 scores in the `testnet-games:leaderboard:v1` sorted set and returns the top 50. Before accepting a score, it verifies that its entry transaction paid the correct 0.01 testnet amount to the configured receiver. Each transaction can create only one worldwide row. Gameplay still runs in the browser, so this is payment-verified rather than cheat-proof.

## Vercel project settings

```text
Framework Preset: Vite
Root Directory: leave blank
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

## Vercel environment variables

```text
PAYOUT_WALLET_PRIVATE_KEY=YOUR_BASE58_DEVNET_PRIVATE_KEY
```

`PAYOUT_WALLET_PRIVATE_KEY` must belong to the public receiver shown in the game. Add it only as a protected Vercel server variable. Do not use a `VITE_` prefix. The server rejects the key if it does not match the receiver and rejects any RPC that is not actually Solana devnet.

You do not need to set `VITE_SOLANA_RPC_URL` or `SOLANA_RPC_URL`. Build V20 uses a free no-key transaction endpoint and automatically falls back to the official devnet endpoint. If free providers block balance reads, the balance displays `RPC BUSY` but play remains available; the signed entry transaction still rejects wallets that cannot cover 0.01 SOL plus the network fee.

If you later obtain a private endpoint, both RPC variables remain optional overrides and are tried before the built-in endpoints.

The receiver needs more than `0.02 devnet SOL` available to cover a winning payout and the network fee. Because each player entry adds 0.01, pre-fund the receiver with enough extra devnet SOL to cover the matching 0.01 for expected wins.

After adding or changing variables, redeploy the newest Production commit. Confirm the game header displays `DUAL TESTNET BOT RACE - BUILD V20`.

## Local development

```powershell
npm install
Copy-Item .env.example .env
npx vercel dev
```

`npm run dev` runs only the static frontend and cannot execute `/api/payout`. Use `npx vercel dev` to test payouts locally.

## Verification

```powershell
npm run build
npm run check:server
```
