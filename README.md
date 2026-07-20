# TESTNET GAMES - Dino Run Build V52

A Solana devnet and MegaETH testnet player-versus-bot runner with Phantom, Solflare, browser-local Solana wallets, and MetaMask.

> AI maintainer handoff: read this section before editing. This is a testnet prototype, not a secure production casino. Do not add a private key, recovery phrase, Redis token, Ably key, or a real wallet address to tracked files, browser code, screenshots, logs, or this README.

## AI maintainer handoff

### Current product state

- The app is a single-player Dino Run race against a deterministic bot. It supports Solana devnet and MegaETH testnet entry payments.
- The design language is the dark neon `DINOGAME` interface. Preserve the compact header, fixed left chat rail, teal/purple accents, wallet balance selector, and 3D coin assets unless the user explicitly requests a redesign.
- A wallet must have more than `$8` of supported current testnet value and a saved worldwide username before it can enter the game. Returning named wallets must go straight to the game rather than the Access Granted screen.
- The user has requested iterative visual changes frequently. Preserve existing unrelated changes in this dirty worktree; do not reset or replace whole files unnecessarily.
- Build marker at handoff: `DUAL TESTNET BOT RACE - BUILD V52`.

### Non-negotiable chat behavior

- Ably provides live WebSocket delivery. Do not remove it unless the user explicitly asks.
- Redis key `testnet-games:chat-history:v1` is the durable global history. `api/chat-history.ts` pushes each new message then trims to indices `0..29`. That means it removes a message only when a 31st is stored; never clear a chat containing fewer than 30 messages.
- Browser cache key `testnet-games:chat-cache:v1` is a recovery layer. `ChatRail.tsx` hydrates it on mount and wallet/network changes. It must never overwrite an existing non-empty cache with an empty transient state during logout or reconnect.
- The UI merges Redis history, Ably history, browser cache, and live messages by message ID, sorts by timestamp, and displays at most 30 messages.
- Messages are limited at three layers: textarea `maxLength={140}`, UI state truncation, and server/history normalization. The chat footer displays remaining characters (`140` down to `0`), not characters used. Keep ordinary spaces working in chat messages.
- The game listens for Space/ArrowUp to jump, but its global keyboard handler must ignore focused inputs, textareas, selects, and content-editable elements. Otherwise it blocks spaces while chat is focused.
- Clicking the message text opens Check profile, Mute locally, and Reply in a foreground action menu. Clicking a name or avatar goes directly to that profile. Tipping and moderator actions live on player profiles. Reply data is a short sanitized quote.
- Reply notifications are cached in the browser. Moderation warnings, timeouts, and the first-profile welcome notification are durable Redis records under `testnet-games:notifications:<network>:<wallet>`. The client polls moderation notifications every 5 seconds, merges them by ID, and shows new warnings/timeouts both in the bell menu and as right-side warning alerts.
- Moderator tags are backed by Redis role membership. The compact chat marker is a shield/info indicator; the profile heading carries the larger MOD badge. Moderators sign warnings and 1-minute to 7-day chat timeouts from player profiles. Mods cannot timeout other mods. A timeout removes Ably publish permission at the next short-lived token renewal; it does not prevent reading chat.
- Tag policy is enforced by `/api/profile`: a player may have one role tag, or Verified plus one role tag. Verified is the only tag that can be paired with another tag; profile/chat consumers use the server-approved tag list.
- Rewards live in the header hover menu rather than a separate rewards page. The Dino Token leaderboard is a full page. DT are a non-transferable ledger for now: verified wagers earn 1 DT per USD wagered, Daily Cases add recorded rewards, and a future token-claim system can build on this balance. Cashback is calculated at 0.2% of verified wagers and its claim is recorded in the rewards ledger; it does not send a wallet transaction yet.
- Chat rules controls intentionally open an empty placeholder modal. Do not invent rules/content until asked.

### Critical source map

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Application state, wallet connection, balance refresh, routing between onboarding/game/profile, header and tips. |
| `src/SingleplayerDinoGame.tsx` | Game loop, entry payment, bot, scores, payout request, leaderboard display. |
| `src/ChatRail.tsx` | Ably realtime client, Redis/browser history loading, chat UI, reply/action menu, 140-character enforcement. |
| `api/chat-token.ts` | Creates restricted Ably tokens. Publish access is granted only after three verified games and is withheld while a chat timeout is active. |
| `api/chat-history.ts` | Redis-backed newest-30 global chat history. Keep this as TypeScript only. |
| `api/moderation.ts` | Fetches durable notifications; verifies signed warnings/timeouts; writes Redis notification, audit, warning-count, and timeout records. |
| `src/ProfilePage.tsx` / `api/profile.ts` | Worldwide profiles, unique usernames, avatars, levels, verified badge, settings. |
| `src/TipModal.tsx` | Same-network non-custodial SOL/ETH tips. |
| `src/HeaderBalance.tsx` | Compact selectable SOL/ETH/USDC header balance and conversion display. |
| `api/leaderboard.ts` | Verifies paid entries and stores worldwide leaderboard/history/progression. |
| `api/payout.ts` | Server-side Solana devnet win payout only. |
| `src/megaEth.ts`, `src/solanaRpc.ts` | Network and RPC helpers. |
| `src/leveling.ts` | Level 1–100 presentation tiers. |
| `src/styles.css` | Layered global styling; newer rules are deliberately appended near the end. |

### Wallet and balance flow

1. Solana uses the Anza wallet adapter (Phantom/Solflare/etc.) or a browser-local encrypted site wallet. MegaETH uses MetaMask.
2. `App.tsx` reads native balance and devnet USDC, calculates the `$8` requirement from `/api/prices`, and blocks entry until the requirement and username are satisfied.
3. After a confirmed game entry or tip, `recordConfirmedSpend` reduces the visible native balance immediately, then refreshes after 750 ms and 3 seconds.
4. Balances also refresh every 5 seconds and when the tab regains focus. Solana subscribes to account changes when its RPC WebSocket is available. Do not make the header balance stale after a transaction.
5. MegaETH testnet is chain ID `6343` (`0x18c7`), RPC `https://carrot.megaeth.com/rpc`, native token `ETH`.

### Profile and settings rules

- Usernames are 3–20 characters and unique case-insensitively across both networks. This is enforced atomically in Redis by `api/profile.ts`.
- Avatar changes are signed by the connected wallet, cropped in the browser, and stored in the worldwide profile. Keep the zoom and vertical positioning crop controls.
- The Level/XP card must always be above Statistics, Transactions, and Settings tabs.
- Settings uses an avatar tile plus Nickname, Referral Code, and disabled Account Email (`Coming soon`) fields. Referral codes currently save only to localStorage under `testnet-games:affiliate-code:<lowercase wallet>`; they are intentionally not worldwide yet.
- Verified users are managed through Redis set `testnet-games:verified-wallets:v1` (instructions below).

### API and Redis contract

| API route | Method | Purpose |
| --- | --- | --- |
| `/api/profile` | GET/POST | Profile, signed name/avatar updates, stats and transactions. |
| `/api/leaderboard` | GET/POST | Worldwide scores and verified paid-entry recording. |
| `/api/chat-token` | GET | Ably token for realtime chat. |
| `/api/chat-history` | GET/POST | Durable newest 30 chat records. Requires Upstash. |
| `/api/moderation` | GET/POST | Fetch durable player notifications; create a signed moderator warning or chat-timeout action. |
| `/api/rewards` | GET/POST | Dino Token balance/leaderboard plus signed Daily Case and cashback-ledger claims. |
| `/api/payout` | POST | Solana devnet payout after a verified winning entry. |
| `/api/prices` | GET | SOL/ETH/USDC price data. |
| `/api/analytics` | POST | Anonymous application analytics. |

Important Redis keys include `testnet-games:profile:<network>:<wallet>`, `testnet-games:username-owner:v1:*`, `testnet-games:verified-wallets:v1`, `testnet-games:moderators:v1`, `testnet-games:leaderboard:v1`, `testnet-games:game-history:v1`, `testnet-games:player-stats:<network>:<wallet>` (including DT/cashback rewards fields), `testnet-games:daily-case:<network>:<wallet>`, `testnet-games:chat-history:v1`, `testnet-games:moderation-history:<network>:<wallet>`, `testnet-games:moderation-warnings:<network>:<wallet>`, `testnet-games:chat-timeout:<network>:<wallet>`, and `testnet-games:notifications:<network>:<wallet>`.

### Deployment and verification

Use Vercel with the Vite preset, blank root directory, `npm run build`, and output directory `dist`. Add server secrets only in Vercel environment variables. The required list is documented below.

Run these after changes:

```powershell
npm run build
npm run check:server
```

Use `npx vercel dev` for API testing. `npm run dev` is frontend only.

Do not create emitted JavaScript files in `api/`. Vercel treats `api/chat-history.ts` and `api/chat-history.js` as conflicting routes. `api/*.js` is intentionally ignored; the TypeScript file is the source of truth.

### Known limitations and planned placeholders

- Testnet only. Browser-reported gameplay is not cheat-proof. Never move this implementation to mainnet without a proper on-chain program, independent game verification, audits, rate limiting, and fraud controls.
- MegaETH wins have no automatic payout. Solana uses the configured server-side payout wallet.
- Account Email, Discord connection, Rewards, and Chat Rules content are placeholders and must remain labelled Coming soon/empty until configured.
- Affiliate referral codes are local only; affiliate earnings/statistics are display placeholders.
- Ably persistence is optional because Redis is the chat source of truth, but Ably WebSocket remains required for live delivery.

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
- Verified worldwide games award persistent wager progression and levels from 1 to 100. Level badges change color at levels 10, 25, 50, 75, and 100.
- Worldwide rankings refresh every 15 seconds so scores from other players appear without a page reload.
- Upstash Redis stores aggregate visits, time-on-site, wallet connections, SOL/ETH entries, games, wins, and losses.
- PostHog is an optional visual analytics dashboard for the same anonymous browser events.

Levels are based only on cumulative verified wagers measured in SOL-equivalent (`SOL-EQ`). SOL entries add their SOL amount directly. ETH entries use the remembered mainnet ETH-USD/SOL-USD ratio, so both currencies advance the same value-based curve. Redis keeps a high-water USD price for each asset, so credited progress never decreases. Approximate cumulative milestones are level 2 at 0.1 SOL-EQ, level 5 at 1.8 SOL-EQ, level 20 at 90 SOL-EQ, and level 30 at 450 SOL-EQ; levels above 30 require 6% more cumulative value per level until the level-100 cap.

Global chat can be read by everyone, but the server grants Ably publish permission only after a wallet has completed three verified games. Messages are limited to 140 characters. The app stores every sent message in a Redis list and trims only after message 31, so exactly the newest 30 messages are retained and a chat with fewer messages is never cleared. New visitors load Redis history, Ably history, and the browser cache, then merge them by message ID. The browser cache is rehydrated on wallet changes and protected against empty transient states during logout or reconnect. Both chat-footer controls open the same placeholder Chat Rules dialog, ready for rules to be added later.

Clicking anywhere on an authenticated chat message opens Reply, View profile, and Tip player actions. Clicking the avatar goes directly to the wallet's profile. Replies carry a short sanitized quote of the selected message. Tips are non-custodial, same-network native transfers: devnet SOL to Solana players or MegaETH testnet ETH to MegaETH players. The sender confirms the exact recipient and amount in Phantom, Solflare, MetaMask, or the browser-local site wallet. Tips are irreversible, have no house fee, and are not stored by the server. The recipient address comes from Ably's signed-in `clientId`, not client-supplied message data, to prevent a message from substituting another tipping address.

Profile Settings includes a large clickable avatar tile with an edit-image badge, nickname and referral-code save fields, plus a disabled Account Email field marked Coming soon. Referral codes are currently saved locally on the player’s device, matching the existing affiliate page. Tall pictures have zoom and vertical-position controls before the cropped avatar is saved. The level and XP progress card stays visible above every profile tab. Clicking the DINOGAME logo takes a connected player directly to the game screen. Chat messages use larger avatars, names, text, and message cards on desktop.

Worldwide usernames are unique across Solana and MegaETH profiles. Name ownership is case-insensitive and claimed atomically in Redis, so `Player`, `player`, and `PLAYER` cannot belong to different wallets. Existing profiles are checked while the username-owner registry is populated lazily; changing a name releases the previous reservation after the profile is saved.

The connected header includes a clickable and scrollable SOL, MegaETH ETH, and Solana-devnet USDC balance selector. Its compact purple dropdown uses project-local 3D coin renders, shows every supported balance and conversion, keeps zero values numeric, and places the connected wallet's real logo beside the selected balance. Solana wallets use their Anza adapter icon, while MetaMask uses the official locally stored fox asset. SOL/ETH hover values use live USD spot prices, while USDC hover shows its SOL equivalent. A compact Rewards tab currently opens a placeholder page for the future rewards configuration.

Connected balances refresh every five seconds and whenever the browser tab regains focus. Confirmed game entries and tips deduct from the displayed native balance immediately, followed by RPC reconciliation after 750 milliseconds and three seconds. Solana native balances also use an account-change subscription when the RPC WebSocket is available; polling remains the fallback for Solana, USDC, and MegaETH.

Access requires more than $8 of currently supported wallet value. Solana counts devnet SOL plus Circle devnet USDC; MegaETH counts testnet ETH. A signed worldwide username is required once per wallet before the dapp can be entered.

The Access Granted/onboarding screen exists only for connected wallets that do not yet have a worldwide username. Returning named wallets show a short loading state while their profile is fetched and then open the game directly. Closing Profile, Rewards, or Affiliates also returns a named wallet to the game, so the onboarding screen cannot reappear after setup.

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

### Assigning a verified badge

Verified badges are attached to wallets, not editable usernames. In the Upstash database, open **CLI** and add the normalized wallet to this Redis set:

```text
SADD testnet-games:verified-wallets:v1 "megaeth:0xlowercase_wallet_address"
SADD testnet-games:verified-wallets:v1 "solana:Base58WalletAddress"
```

For MegaETH, the address after `megaeth:` must be lowercase. Solana addresses keep their original Base58 capitalization. Reload the site after running the command; the blue verified badge appears beside that wallet's current chat name and profile name. To remove it:

```text
SREM testnet-games:verified-wallets:v1 "megaeth:0xlowercase_wallet_address"
```

### Assigning a moderator role

Moderator roles attach to wallets, just like verification. Add a wallet in the Upstash CLI:

```text
SADD testnet-games:moderators:v1 "megaeth:0xlowercase_wallet_address"
SADD testnet-games:moderators:v1 "solana:Base58WalletAddress"
```

Reload after adding the role. The player receives a purple `MOD` tag in chat and on the profile heading. Clicking any other user's chat message then exposes **Warn user** and **Timeout** actions. Every action requires the moderator wallet to sign an exact request; the server rejects users that are not in this Redis set.

Warnings require a reason and are kept in `testnet-games:moderation-history:<network>:<wallet>` (newest 50). Timeouts require a reason and duration of 1 minute through 7 days, write the same audit record, and set an expiring key at `testnet-games:chat-timeout:<network>:<wallet>`. Do not manually delete an active timeout key unless you intend to end it early.

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
ABLY_API_KEY=YOUR_ABLY_ROOT_OR_SERVER_API_KEY
```

`PAYOUT_WALLET_PRIVATE_KEY` must belong to the public receiver shown in the game. Add it only as a protected Vercel server variable. Do not use a `VITE_` prefix. The server rejects the key if it does not match the receiver and rejects any RPC that is not actually Solana devnet.

Chat history uses the same Upstash Redis variables already required for worldwide profiles and leaderboards. Ably persistence is optional now: it can provide an additional history source, but Redis retains the newest 30 messages even when Ably history is unavailable.

You do not need to set `VITE_SOLANA_RPC_URL` or `SOLANA_RPC_URL`. Build V20 uses a free no-key transaction endpoint and automatically falls back to the official devnet endpoint. If free providers block balance reads, the balance displays `RPC BUSY` but play remains available; the signed entry transaction still rejects wallets that cannot cover 0.01 SOL plus the network fee.

If you later obtain a private endpoint, both RPC variables remain optional overrides and are tried before the built-in endpoints.

The receiver needs more than `0.02 devnet SOL` available to cover a winning payout and the network fee. Because each player entry adds 0.01, pre-fund the receiver with enough extra devnet SOL to cover the matching 0.01 for expected wins.

After adding or changing variables, redeploy the newest Production commit. Confirm the game header displays `DUAL TESTNET BOT RACE - BUILD V52`.

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
