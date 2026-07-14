# Devnet Dino Run - Local Singleplayer Build V6

A static Solana devnet dinosaur runner with browser-local high scores.

## Architecture

- Gameplay and collision detection run entirely in the browser.
- The ten highest scores for each connected wallet are stored in `localStorage` on that device.
- No Redis, database, Vercel API function, realtime server, multiplayer connection, or cron job is used.
- Each run sends `0.01 devnet SOL` directly to the configured public receiver address.
- Phantom, Solflare, Wallet Standard, and encrypted browser-local wallets are supported.

Because there is no server, payment confirmation is performed by the player's wallet and browser. This is intended only for devnet testing.

## Vercel project settings

```text
Framework Preset: Vite
Root Directory: leave blank
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

## Vercel variable

```text
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
```

The public devnet receiver address is included directly in the static game build. No receiver environment variable is required. Never add a private key or recovery phrase to Vercel.

Redeploy the newest commit. The game header must display `LOCAL SINGLEPLAYER - BUILD V6`.

## Local development

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Verify with:

```powershell
npm run build
```
