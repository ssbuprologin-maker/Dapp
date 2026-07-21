# DINOGAME / TESTNET GAMES — Agent Handoff

Read this file completely before modifying the repository. It describes the current implementation, product intent, architectural contracts, deployment requirements, and the regressions the user has repeatedly asked agents to avoid.

## Project identity and current product

- Product name in the UI: **DINOGAME** / **TESTNET GAMES**.
- Current build label in the game: `DUAL TESTNET BOT RACE - BUILD V52`.
- Stack: React 19, TypeScript, Vite, Vercel Functions, Upstash Redis, Ably, Solana wallet adapter/web3.js, MetaMask/MegaETH, PostHog (optional), Lucide icons.
- It is a **testnet-only prototype**. Never represent it as audited, production-safe, cheat-proof, or suitable for mainnet funds.
- Core game: a single-player Chrome-Dino-style race against a deterministic bot. Players pay a testnet entry, race the bot, and verified results are written to the worldwide leaderboard.
- Supported networks:
  - Solana devnet, entry `0.01 SOL`, receiver `3aLAsDDF7JBhGGWdENyoFGP36PftRKpufHCN64myPLtN`.
  - MegaETH testnet, chain ID `6343` / `0x18c7`, entry `0.01 ETH`, receiver `0x4caf2B570ACF0600810fec32373880fC8b94AA18`.
- Solana wins can request a `0.02 SOL` devnet server payout. MegaETH wins currently have no automatic payout.
- The browser determines the game outcome, so it can be falsified. Do not extend this to real-value/mainnet use without an on-chain design, independent result verification, abuse prevention, audits, and legal review.

## Highest-priority maintainer rules

1. Preserve unrelated user changes. This worktree is commonly dirty. Inspect diffs and patch narrowly; do not reset or replace whole files.
2. Never commit, echo, log, or expose private keys, seed phrases, Upstash tokens, Ably keys, or other secrets. A `VITE_` variable is public browser code and must never contain a secret.
3. Keep the project ESM. Do not introduce CommonJS server imports that recreate the prior `rpc-websockets`/`uuid` ESM failure.
4. Never generate `api/*.js`. Vercel considers `api/foo.ts` and `api/foo.js` conflicting routes.
5. Keep Ably WebSockets for live chat and Redis for persistence. Do not replace either with Socket.IO or a self-hosted server.
6. The app no longer has a minimum balance gate or one-transaction gate for joining. `api/wallet-eligibility.ts` is an unused leftover; do not call it or restore that requirement unless explicitly requested.
7. A connected wallet without a profile gets the sign-up overlay. It requires a unique username, optional referral code, and terms checkbox. A returning named wallet goes directly to the game.
8. The compact dark neon visual language is intentional: black/navy surfaces, teal game accents, purple rewards/wallet controls, small dense controls, fixed left chat, and responsive header/footer.
9. Header hover dropdowns must remain open while the pointer crosses the small bridge/gap into the panel. They should close shortly after leaving both trigger and panel.
10. Run both frontend and server checks after meaningful changes.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Root state, wallet connections, profile onboarding, header, notifications, transient alerts, routing, balance refresh, moderation signatures, rewards claims, inspected-profile modal. |
| `src/SingleplayerDinoGame.tsx` | Dino game loop, bot, obstacle generation, SOL/ETH entry transactions, score submission, local/worldwide leaderboard. |
| `src/ChatRail.tsx` | Fixed/collapsible chat, Ably lifecycle, history merge, local mute, replies, message action menu, moderation deletion, compact emoji/meme composer. |
| `src/ProfilePage.tsx` | Own full-page profile and other-player modal profile, stats chart, XP, transactions, avatar crop, settings, mute list, Kick field, moderator controls. |
| `src/HeaderBalance.tsx` | SOL/ETH/USDC balance selector, wallet logo, USD/SOL conversions. |
| `src/RewardsPage.tsx` | Compact header Rewards hover panel, daily-case modal, cashback selector/claim. Despite the name, this is not a normal full page. |
| `src/DinoTokensPage.tsx` | Full-page Dino Token leaderboard. |
| `src/AffiliatesPage.tsx` | Affiliate-code creation, referral link, placeholder statistics/banner tools. |
| `src/TipModal.tsx` | Same-network non-custodial SOL/ETH tips between players. |
| `src/cryptoWallet.ts` | Browser-local encrypted Solana site wallet and recovery-file flow. |
| `src/megaEth.ts` | MetaMask provider selection, MegaETH add/switch, balances, entries, tips. |
| `src/solanaRpc.ts` | Free Solana devnet RPC fallback sequence and confirmations. |
| `src/leveling.ts` | Visual level tiers only; numeric progression is duplicated in `api/profile.ts` and `api/leaderboard.ts`. |
| `src/analytics.ts` | Anonymous analytics and optional PostHog setup. |
| `src/styles.css` | Global layered CSS. Recent corrective rules are appended at the end and often intentionally override older styles. |
| `api/*.ts` | Vercel serverless functions described below. |
| `public/streamer-logo.svg` | Current streamer icon. |
| `src/assets/meme-thinking-frog-exact.png` | Exact user-selected chat meme. Do not replace it with an AI-generated variant. |

## Application flow

### Disconnected

- The main Dino Run page is visible immediately, even while disconnected.
- The header shows **Connect wallet**.
- Clicking a play/connect affordance opens the wallet modal.

### Wallet modal

- Wallet choices are direct-connect buttons; do not require selecting a row and then clicking a second “Connect Phantom” button.
- Solana extension wallets come from Anza wallet-adapter. Phantom and Solflare are configured, and detected/loadable adapters should display their real adapter icons.
- MetaMask connects directly to MegaETH and uses the local official fox SVG.
- A browser-local encrypted Solana wallet can be created/unlocked/imported. Passwords must be at least ten characters. Its encrypted record is local-only at `testnet-games.encrypted-wallet.v1`.
- Modal content can scroll, but its native scrollbar is intentionally hidden.

### First profile creation

- `accessScreen`/`SignupOverlay` is shown only when a connected wallet has no worldwide `displayName` after `/api/profile` loads.
- Form fields: username and optional referral code; there is deliberately no email field.
- The checkbox wording says the player read and agrees with the terms and conditions. It is not an age confirmation.
- Referral links use `?ref=CODE`; the overlay pre-fills and remembers the pending code.
- Username rules: 3–20 characters, must start/end alphanumeric, middle may contain letters, numbers, spaces, `_`, or `-`.
- There is no transaction-history or wallet-value prerequisite for creating a profile or entering the main UI.

### Returning player

- While `/api/profile` loads, show the short `LOADING PLAYER` state.
- Once the saved name is loaded, render the game directly. Do not show “Access Granted,” “Join Now,” or the signup overlay again.
- Clicking the DINOGAME logo or closing an auxiliary view returns to the game, not onboarding.

## Wallet and balance behavior

- Solana browser RPC order: `VITE_SOLANA_RPC_URL`, free Tatum devnet gateway, official Solana devnet.
- Server RPC order begins with `SOLANA_RPC_URL` and falls back where implemented.
- MegaETH constants live in `src/megaEth.ts`.
- Header supports SOL, MegaETH ETH, and Solana-devnet USDC. Keep zero values explicit (`0.0000`) and conversions explicit (`~$0.00` / `~0.0000 SOL`).
- SOL/ETH hover conversion uses `/api/prices`; USDC shows SOL equivalent.
- Balances poll every five seconds, refresh on tab focus, and reconcile shortly after transactions. Confirmed game entries/tips optimistically reduce the shown native balance immediately, then refresh after roughly 750 ms and 3 seconds.
- Solana may additionally subscribe to account changes. Polling remains the fallback.
- Name changes currently require more than `0.1` native testnet asset, enforced server-side in `api/profile.ts`, and have a 10-minute cooldown. This is separate from joining; joining has no balance gate.

## Game and transaction contract

- Entry constants must match across frontend and server:
  - Solana `10_000_000` lamports.
  - MegaETH `10_000_000_000_000_000` wei.
- `api/leaderboard.ts` verifies the transaction, sender/receiver/amount, and prevents reuse before accepting a worldwide result.
- Total bets are the cardinality of `testnet-games:verified-bets:v1`, not a browser counter.
- `api/leaderboard.ts` publishes `total-bets` on the global Ably channel after a new verified entry so all clients update immediately.
- Local score storage is a fallback/session presentation; Redis is authoritative for worldwide data.
- Transaction links must point to Solana Explorer with `cluster=devnet` or MegaETH Blockscout.
- Payout route is Solana-only. It verifies the entry again and requires `PAYOUT_WALLET_PRIVATE_KEY` to match the configured public receiver. Never put this variable in browser code.

## Level and Dino Token progression

- Progress is cumulative verified wager in SOL-equivalent (`SOL-EQ`) and capped at level 100.
- Numeric formulas are duplicated in `api/profile.ts` and `api/leaderboard.ts`; always update both together.
- Current cumulative curve:
  - Levels 2–30: `0.12 * n^2 * exp(0.0342*x + 0.000917*x^2)`, where `n = level - 1`, `x = n - 1`.
  - Level 30 anchor: `540 SOL-EQ`.
  - Levels 31–80 grow geometrically to level 80 at `5,000 SOL-EQ`.
  - Levels 81–100 require 15% more cumulative wager per level.
- `levelFromWager` iterates to 100, so it cannot exceed 100.
- EVM entries use a persisted high-water ETH/SOL price ratio. Price decreases never reduce already credited progression.
- Header/profile level colors:
  - General tier breakpoints: 10, 25, 50, 75, 100.
  - Chat: 1–5 gray, 6–20 blue, 21–50 purple, 51–80 orange, 81–99 red, 100 animated rainbow.
- Dino Tokens are currently an internal non-transferable ledger. New verified bets earn **1 DT per USD wagered** using high-water USD prices. Daily cases can add DT. `testnet-games:dino-tokens:v1` powers the global DT leaderboard.

## Chat contract — do not regress

### Realtime and persistence

- Channel: `testnet-games-global-chat`.
- Ably provides live delivery; Redis provides durable history.
- Redis history key: `testnet-games:chat-history:v1`.
- The server pushes the newest message and trims to exactly 30. A history with fewer than 30 must never be cleared simply because a user logs out, reconnects, or temporarily receives an empty response.
- Browser recovery cache: `testnet-games:chat-cache:v1`.
- Client merges browser cache, Redis history, Ably history, and live events by message ID, sorts by timestamp, and displays at most the newest 30.
- Chat remains readable to everyone. Publishing requires at least three verified games and no active timeout. `api/chat-token.ts` issues a short 60-second token with publish capability only when allowed.

### Composer

- Max length is 140 at UI, state, and server normalization layers. Counter displays remaining characters from 140 down to 0.
- Normal spaces must work. The game keyboard handler must ignore `input`, `textarea`, `select`, and content-editable targets.
- Composer is compact and one-row: text field, site emoji/meme button, purple send button.
- Emoji and meme picker has separate **EMOJIS** and **MEMES** sections.
- The only custom meme currently is `src/assets/meme-thinking-frog-exact.png`, the exact PNG selected by the user. Meme messages are stored as a short token such as `[[meme:thinking-frog]]` and rendered as an image.
- Enter sends; Shift+Enter may insert a line break if the compact textarea permits it.
- Three-second send cooldown failures must use the global side error alert.

### Message interactions

- Clicking a name or avatar opens that player profile directly.
- Clicking the message/card body reliably opens a fixed foreground action menu near the click, clamped to the viewport. It contains Check profile, local mute, Reply, and Delete message for moderators.
- The action menu must not clip inside the chat rail. Be careful with transformed ancestors because a transform changes fixed-position containment.
- Replies render as a compact line above the replied-to message, not a large box inside it.
- Local mute is per viewer wallet/device under `testnet-games:muted-chat:v1:<network>:<viewer-wallet>`. Profile Settings lists muted users and allows unmuting.
- The chat rail collapses with a side tab and must retain smooth animation and independent feed scrolling. Footer layout expands when chat is closed and compresses when open.
- “Chat Rules” controls intentionally open an empty placeholder modal. Do not invent rule text until requested.

## Profiles

- Profiles are keyed by network + normalized wallet. MegaETH addresses are lowercase; Solana Base58 capitalization is preserved.
- Username ownership is global and case-insensitive across both networks. `Player`, `player`, and `PLAYER` cannot belong to different wallets. Redis ownership claim is atomic and legacy profiles are scanned while the registry fills.
- Own profile is a normal full-page view in main content. Other users open in a centered internally scrollable modal over a moderately dimmed, lightly blurred game.
- Inspected modal must close on backdrop/Escape and should not unmount the game beneath it.
- Native scrollbars are hidden in profiles and chat, but wheel/touch/keyboard scrolling must continue to work.
- Own profile combines identity and XP into one compact summary card. XP remains above Statistics/Transactions/Settings.
- Inspected profile header shows avatar, level, username, verified badge, red `MOD` badge where applicable, streamer badge where applicable, join date, and moderator-only warning count.
- Mods can warn/timeout from inspected profiles but cannot timeout another moderator. Timeout counts toward warnings, and warnings over the threshold can trigger an automatic 10-minute timeout per `api/moderation.ts`.
- Profile statistics use a dependency-free SVG chart built from recorded game history. Current net-result model treats wins as `+0.01` and losses as `-0.01` native asset.
- Wallet address is visible on profiles with a copy button.

### Avatar editing

- Upload accepts PNG/JPEG/GIF/WebP.
- Crop UI supports dragging in both axes and zoom. Do not restore the old “Vertical position” slider.
- Zoom must remain centered on the currently visible crop, not reset to the original image center after the user drags.
- Save uses a wallet signature and stores a data URL in the Redis profile. Browser local avatar cache is `testnet-games:avatar:<network>:<wallet>`.

## Roles and tag policy

- There is **no admin role**. It was intentionally removed. Do not recreate browser admin controls or admin Redis keys.
- Role membership is controlled server-side by Redis sets and verified again on every privileged request.
- A profile can display no more than two tags. Verified is the only tag allowed alongside one other role. Moderator has priority over Streamer if a wallet is accidentally in both role sets.
- Redis commands:

```text
SADD testnet-games:verified-wallets:v1 "megaeth:0xlowercase_address"
SADD testnet-games:verified-wallets:v1 "solana:Base58Address"
SREM testnet-games:verified-wallets:v1 "network:wallet"

SADD testnet-games:moderators:v1 "network:wallet"
SREM testnet-games:moderators:v1 "network:wallet"

SADD testnet-games:streamers:v1 "network:wallet"
SREM testnet-games:streamers:v1 "network:wallet"
```

- Privileged moderation and deletion requests require a fresh connected-wallet signature over an exact server-reconstructed message. Never trust a frontend boolean such as `isModerator` for authorization.
- Moderators can warn, timeout 1 minute–7 days, and delete messages. They cannot moderate themselves; they cannot timeout other moderators.
- Chat shows moderators with a compact information/shield-style icon and tooltip `Mod`; profiles show the larger red `MOD` badge.
- Streamers may save a signed `kick.com/<slug>` in profile settings. The slug is stored in hash `testnet-games:kick-channels:v1`. `/api/kick-status` polls public live state and chat adds a live ring to the avatar.

## Notifications and alerts

- Header bell dropdown is compact. Clicking outside closes it. Hovering another header hover control also closes it.
- Bell displays unread count. Clicking a notification opens its full message in-place.
- Header action says **Clear**, not “Mark as read.” Clear empties the local inbox and stores a per-wallet cleared timestamp so old Redis notices do not reappear.
- Browser notification cache: `testnet-games:notifications:v1`.
- Cleared marker: `testnet-games:notifications-cleared:v1:<network>:<wallet>`.
- Durable moderation/welcome notifications: `testnet-games:notifications:<network>:<wallet>`.
- Reply notifications are browser-cached. Moderation notifications are polled about every five seconds.
- A new-notification hint appears below the bell for about one minute for newly received notifications, including notices received while previously offline. Clicking the bell dismisses that hint.
- Timeout-ended notifications are created lazily by `api/moderation.ts` when the player next polls after expiry, guarded by pending/completed timeout-end keys.
- Global right-side alert stack handles errors/warnings/success. Do not use `window.alert`, `prompt`, or browser confirm dialogs.
- Alerts remain visible briefly, enter a closing state, and animate out smoothly before removal.
- Suppress the harmless `Connection closed` error generated while Ably clients intentionally rotate during initial connection/account changes.

## Moderation data

- Warning count: `testnet-games:moderation-warnings:<network>:<wallet>`.
- Audit list: `testnet-games:moderation-history:<network>:<wallet>`; keep newest records bounded.
- Active timeout: `testnet-games:chat-timeout:<network>:<wallet>` with TTL.
- Timeout countdown appears in the chat composer. Timed-out send errors should simply say the user is timed out, not expose Ably capability internals.
- Notification and side warning should both be created for moderation actions.

## Rewards

- The header has separate compact DT balance and purple Rewards controls.
- Rewards is a hover menu, not a route/page. Keep the panel open while hovering its trigger or panel; it should close shortly after leaving both.
- Daily Case opens only after the user clicks its action. The modal is a centered `createPortal(..., document.body)` overlay so it cannot attach to or distort the header.
- Daily Case is once per UTC day and uses a commit/reveal-like stored seed/commitment. UI includes mining/reel animation plus verification details.
- Current visible reward table: 10 SOL credit, 2.5 SOL, 1 SOL, 0.1 SOL, 0.001 SOL, or 15 DT with the configured displayed chances. These are internal testnet reward ledger credits; do not imply an immediate real wallet transfer.
- For testing, reset a player’s case by deleting their case and relevant day seed/commit keys only when explicitly requested.
- Cashback is 0.2% of cumulative verified wager and records a ledger claim. It does not currently transfer funds. Its side selector distinguishes SOL/EVM.
- DT large-number display abbreviates with K/M.

## Affiliates and referrals

These are two distinct codes:

1. **Joined-with referral code** lives in the profile and identifies who referred the player. It can be supplied during signup. If absent, the player may set it once in Settings. After it is set, it is permanently locked and cannot be changed.
2. **Owned affiliate code** is created on the Affiliates page and generates the player’s share link. It is globally unique and stored by `api/affiliate.ts`.

- Owned-code keys: `testnet-games:affiliate-code:v1:<network>:<wallet>` and `testnet-games:affiliate-code-owner:v1:<CODE>`.
- Joined referrals set membership under `testnet-games:affiliate-referrals:v1:<CODE>`.
- A player cannot join under their own owned code.
- Affiliate statistics/earnings are still mostly presentation placeholders. Do not promise payout functionality.

## API routes

| Route | Methods | Contract |
| --- | --- | --- |
| `/api/profile` | GET, POST | Profiles, global unique name, avatar, joined referral, Kick link, tags/stats/history, signed changes. |
| `/api/affiliate` | GET, POST | Read/create unique owned affiliate code with signature. |
| `/api/leaderboard` | GET, POST | Verify entries, record games/progression/DT, worldwide rankings, total bets. |
| `/api/chat-token` | GET | Short-lived restricted Ably token. |
| `/api/chat-history` | GET, POST, DELETE | Newest-30 Redis history and signed moderator deletion. |
| `/api/moderation` | GET, POST | Poll notices/timeout state; signed warning/timeout actions. |
| `/api/rewards` | GET, POST | DT/cashback/case state and signed reward claims. |
| `/api/payout` | POST | Solana devnet win payout. |
| `/api/prices` | GET | SOL/ETH/USDC conversion data. |
| `/api/analytics` | POST | Anonymous counters. |
| `/api/kick-status` | GET | Batched public Kick live-state lookup. |
| `/api/wallet-eligibility` | GET | Legacy/unused one-transaction checker. Do not wire it back into access. |

## Important Redis keys

```text
testnet-games:profile:<network>:<wallet>
testnet-games:profile-label:<network>:<short-label>
testnet-games:username-owner:v1:<normalized-name>
testnet-games:player-stats:<network>:<wallet>
testnet-games:leaderboard:v1
testnet-games:game-history:v1
testnet-games:verified-bets:v1
testnet-games:leaderboard-entry:<network>:<transaction>
testnet-games:xp-usd-high-water:v1
testnet-games:dino-tokens:v1
testnet-games:daily-case:<network>:<wallet>
testnet-games:daily-case-seed:<network>:<wallet>:<day>
testnet-games:daily-case-commit:<network>:<wallet>:<day>
testnet-games:verified-wallets:v1
testnet-games:moderators:v1
testnet-games:streamers:v1
testnet-games:kick-channels:v1
testnet-games:chat-history:v1
testnet-games:chat-deleted:v1
testnet-games:chat-timeout:<network>:<wallet>
testnet-games:moderation-warnings:<network>:<wallet>
testnet-games:moderation-history:<network>:<wallet>
testnet-games:notifications:<network>:<wallet>
testnet-games:affiliate-code:v1:<network>:<wallet>
testnet-games:affiliate-code-owner:v1:<CODE>
testnet-games:affiliate-referrals:v1:<CODE>
testnet-games:analytics:totals
testnet-games:analytics:daily:YYYY-MM-DD
testnet-games:analytics:unique-visitors
```

## Analytics

- Optional PostHog browser events include page/session activity, wallet connection, game transaction confirmation, and game finish.
- Do not send wallet addresses, transaction signatures, secrets, or recovery data to PostHog.
- Upstash analytics counters are updated through `/api/analytics` and can be inspected in the Redis Data Browser.

## Environment variables

Copy `.env.example` for local development. Vercel server secrets must be configured in Project Settings and redeployed.

```text
VITE_SOLANA_RPC_URL=              # optional public browser RPC
SOLANA_RPC_URL=                   # optional server RPC
PAYOUT_WALLET_PRIVATE_KEY=        # optional server-only devnet payout secret
UPSTASH_REDIS_REST_URL=           # required for global data
UPSTASH_REDIS_REST_TOKEN=         # required server secret
ABLY_API_KEY=                     # required for realtime chat
VITE_POSTHOG_KEY=                 # optional public project key
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

- Never prefix Redis, Ably, payout, or other server credentials with `VITE_`.
- If payout is not configured, preserve graceful testnet behavior and a clear error; never add a private key to source.

## Vercel and local commands

- Vercel preset/framework: **Vite**.
- Root directory: repository root / blank in the Vercel form.
- Build command: `npm run build`.
- Output: `dist`.
- API routes are automatically taken from root `api/`.

```powershell
npm install
npm run dev          # frontend only; /api is not locally served
npm run vercel:dev   # frontend + Vercel functions
npm run build
npm run check:server
```

Before handing off a change:

1. Inspect `git status` and preserve unrelated modifications.
2. Run `npm run build`.
3. Run `npm run check:server` when any API or shared server contract changed.
4. Check the compact desktop header, chat-open/chat-closed layout, and mobile breakpoints.
5. Confirm no secret or generated `api/*.js` file was added.

## Known limitations and intentionally unfinished areas

- No secure authoritative multiplayer; the game is a local bot race.
- Browser-reported win state is exploitable.
- MegaETH has no payout implementation.
- Cashback and case SOL rewards are ledger-only.
- DT is not a blockchain token and cannot be claimed yet.
- Affiliates do not yet have production earnings/claim infrastructure.
- Account email, Discord, support, fair-play, terms destination, and Chat Rules content are placeholders.
- Footer links are presentation text until routes are implemented.
- `api/wallet-eligibility.ts` is unused legacy code after the access requirement was removed.
- The main bundle is large; Vite may warn about chunks above 500 kB. This warning is known and is not a build failure.

## User-specific design history to preserve

- The user prefers compact controls modeled after modern dark crypto-game interfaces, but the implementation must remain DINOGAME-branded and not copy another site’s protected artwork/layout verbatim.
- Real wallet logos are preferred over letter placeholders.
- Verified badge should resemble a centered blue social verification mark. Profile `MOD` badge is red and visible; chat moderator indication is compact.
- Notifications/rewards/profile menus should be compact, viewport-bound, and close on outside click or other header-menu interaction.
- Error/warning feedback belongs in right-side on-site cards, not browser dialogs.
- Profiles viewed from chat are modal popouts; the owner’s own profile is full-page.
- Keep visible message history across logout/reconnect, retain only the newest 30 globally, and never erase a smaller history.
- The exact user-provided frog PNG is the first site meme. Do not regenerate or stylistically reinterpret user-supplied assets when they ask to use the original.

