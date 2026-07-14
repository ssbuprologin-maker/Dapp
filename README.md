# Dino Run - 2X Devnet Bot Race Build V12

A Solana devnet player-versus-bot runner with browser-local scores and an intentionally insecure devnet payout prototype.

## How it works

- A player pays `0.01 devnet SOL` to the configured receiver.
- The local bot runs ahead, survives at least the opening 30 seconds, and then has only a small deterministic mistake chance.
- If the player crashes first, there is no payout.
- If the bot crashes first, the browser submits the entry signature to `/api/payout`.
- The payout function verifies the entry transfer and sends `0.02 devnet SOL` to the player.
- A Solana memo is added to payout transactions to reduce reuse of an entry signature.
- Personal high scores stay in browser `localStorage`.

This is devnet-only. The browser reports who won, so a user can fake a winning result. Duplicate protection is also best-effort without a database. Never point this prototype at mainnet or a wallet containing real assets.

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

You do not need to set `VITE_SOLANA_RPC_URL` or `SOLANA_RPC_URL`. Build V12 uses a free no-key transaction endpoint and automatically falls back to the official devnet endpoint. If free providers block balance reads, the balance displays `RPC BUSY` but play remains available; the signed entry transaction still rejects wallets that cannot cover 0.01 SOL plus the network fee.

If you later obtain a private endpoint, both RPC variables remain optional overrides and are tried before the built-in endpoints.

The receiver needs more than `0.02 devnet SOL` available to cover a winning payout and the network fee. Because each player entry adds 0.01, pre-fund the receiver with enough extra devnet SOL to cover the matching 0.01 for expected wins.

After adding or changing variables, redeploy the newest Production commit. Confirm the game header displays `2X DEVNET BOT RACE - BUILD V12`.

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
