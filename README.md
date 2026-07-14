# TESTNET GAMES - Dino Run Build V17

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
- Personal high scores, Yes/No win results, and entry transaction explorer links stay in browser `localStorage`.

This is testnet-only. The browser reports who won, so a user can fake a winning result. Duplicate protection is also best-effort without a database. Never point this prototype at mainnet or a wallet containing real assets.

## MegaETH testnet

The MetaMask integration uses MegaETH testnet chain ID `6343` (`0x18c7`), native token `ETH`, RPC `https://carrot.megaeth.com/rpc`, and the official Blockscout explorer. MetaMask adds the network automatically when needed. No Vercel environment variable is required for the EVM connection or entry transfer.

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

You do not need to set `VITE_SOLANA_RPC_URL` or `SOLANA_RPC_URL`. Build V17 uses a free no-key transaction endpoint and automatically falls back to the official devnet endpoint. If free providers block balance reads, the balance displays `RPC BUSY` but play remains available; the signed entry transaction still rejects wallets that cannot cover 0.01 SOL plus the network fee.

If you later obtain a private endpoint, both RPC variables remain optional overrides and are tried before the built-in endpoints.

The receiver needs more than `0.02 devnet SOL` available to cover a winning payout and the network fee. Because each player entry adds 0.01, pre-fund the receiver with enough extra devnet SOL to cover the matching 0.01 for expected wins.

After adding or changing variables, redeploy the newest Production commit. Confirm the game header displays `DUAL TESTNET BOT RACE - BUILD V17`.

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
