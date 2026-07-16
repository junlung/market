# Members: auth, profiles, cosmetics, achievements

## Auth

NextAuth v4 credentials provider with JWT sessions — no database session table
(`src/lib/auth.ts`). Sign-in at `/sign-in`; passwords are bcrypt-hashed
(`src/lib/password.ts`).

- Account status gates sign-in, and the check runs **after** password verification, so
  a probe cannot distinguish a pending account from a wrong password. Error codes:
  `ACCOUNT_PENDING`, `ACCOUNT_NOT_ACTIVE`.
- The JWT carries `role` and `username`. Tokens minted before a user had a username
  are backfilled from the DB on refresh; profile edits push updates through
  `useSession().update`.
- `src/middleware.ts` (`withAuth`) protects every app route in its matcher; `/admin/*`
  additionally requires `role === ADMIN` (non-admins redirect to `/dashboard`). It
  must live in `src/` — Next.js silently ignores a root-level middleware.ts when the
  app directory is under `src/`. Server code re-checks with `requireSession` /
  `requireAdminSession` (`src/lib/session.ts`) — middleware is the outer gate, not
  the only one.
- Signed-out visits to a gated route survive the login round-trip: the middleware
  bounce appends `callbackUrl`, the sign-in form returns there after login
  (sanitized same-origin-only via `safeCallbackUrl`, `src/lib/routes.ts`), and
  `requireSession` accepts an optional callback path for the same effect where a
  page wants it explicitly (e.g. `/join/[code]`).

## Signup and approval

Signup is open but worthless until approved: accounts start `PENDING`, and **all value
is granted at approval, not at signup** — the starting balance, Global League
membership, and the 1000-gem starting grant all land when an admin approves the account
from `/admin/members` (`src/lib/server/member-service.ts`). Pending and rejected
accounts hold nothing, so junk signups cost nothing.

- Approval is double-grant-proof: a status-guarded `updateMany` plus an
  `INITIAL_GRANT`-existence check inside one transaction; the gem grant has its own
  partial unique. Rejected accounts can be approved later, and rejected emails may
  re-register.
- Signup is globally rate-limited; members vouch for friends in the queue from
  `/invite`.
- Roles are a global `ADMIN | MEMBER` enum on `User`. Per-league authority comes from
  `LeagueMembership.role` (`docs/leagues.md`).

## Navigation

- Primary destinations live in the desktop top nav — Markets (`/dashboard`),
  Portfolio, Leaderboard, Leagues, Activity, Store — and the mobile tab bar mirrors
  them with Account in place of Store (on mobile, Store is reached via the balance
  menu's Gems row or the account page). Both lists are defined together in
  `src/components/layout/nav-config.ts`, which states the mirror contract.
- The avatar menu holds identity and utilities only: Your profile, Account,
  Admin (admins), Send feedback, Sign out. Content and actions live on their pages —
  proposing a market is a button on `/dashboard`, inviting/vouching is reached from
  an Account-page card, and bet history is the second tab of `/portfolio`
  (`?tab=history`; the old `/history` route redirects there).
- Admin sub-pages (`/admin`, `/admin/markets`, `/admin/members`, `/admin/items`,
  `/admin/feedback`) share a tab-strip nav rendered by `src/app/(app)/admin/layout.tsx`.

## Usernames and profiles

- `username` is the stable public handle: unique, lowercase, 3–20 chars of
  `[a-z0-9-]`, no leading/trailing hyphen, reserved words blocked
  (`src/lib/username.ts`). Display names are separate — mutable, non-unique apart from
  a case-insensitive collision check. Both are editable on `/account`, plus a bio
  (≤ 280 chars).
- Profiles live at `/u/[username]` inside the authed app — **members-only**, like
  everything else. Members bet on real-life friend events, so betting history is
  never exposed publicly.
- Profile content (`src/lib/server/profile-service.ts`): career stats computed from
  the ledger on request (net profit, markets won/played, win rate, biggest payout),
  recent resolved positions, the trophy case, and showcased achievements. Career
  stats are **Global-League-scoped** — fresh-stack league P&L would distort them;
  league performance lives on league pages and in trophy provenance. Profiles of
  non-ACTIVE users 404.

## Items and cosmetics

`Item` defines a cosmetic or trophy; `UserItem` is an owned copy with provenance
(`source`: `SEASON_TROPHY | ACHIEVEMENT | PURCHASE | ADMIN_GRANT`, plus a JSON detail
like league/season/placement).

- **Kinds:** `TROPHY` (display-only, lives in the profile trophy case) and four
  equippables mapping 1:1 to `EquipSlot`: `BADGE`, `TITLE`, `FRAME`, `BACKGROUND`
  (the profile-header banner).
- **Styles are data, not assets.** `Item.style` is a JSON blob validated per kind by
  the zod schemas in `src/lib/cosmetics.ts` — CSS/emoji parameters with hex-locked
  colors, plus a `renderer` discriminant (`css` / `emoji` / `model3d`).
  `parseItemStyle` never throws: unparseable style renders as nothing, and a
  `model3d` trophy renders a placeholder tile. There is no image upload pipeline.
- **Equipping** is one item per slot, enforced by a partial unique and performed in a
  serializable transaction (`src/lib/server/item-service.ts`). Setting an item
  `active = false` un-renders it everywhere without touching anyone's equip state.
- **Rendering convention:** pages fetch cosmetics for all visible users in **one**
  `getEquippedCosmetics(userIds[])` batch call, parsed server-side — never per row.
  Renderers live in `cosmetic-renderers.tsx` (`AvatarFrame`, `BadgeGlyph`,
  `TitleLine`, `ProfileBanner`); `MemberAvatar` wraps the generated-initials avatar
  behind a swappable `avatarNode` prop. Frames and badges render at every avatar/name
  surface; titles on the profile header and leaderboard podium; the banner on the
  profile only.
- **Grants** are idempotent via `grantKey` (e.g. trophies
  `season:{seasonId}:user:{userId}`, badges `achievement:{key}:user:{userId}`);
  admin grants carry no key and may duplicate deliberately.
- A 10-item starter catalog self-heals through upsert-by-slug on store reads
  (`ensureStarterCatalog`).

## The store

`/store` sells active items with a `storeCost` for gems. `storeCost = null` means
earned-only — some desirable items (e.g. the "The Oracle" title) stay achievement-only
so the store doesn't simply mirror the leaderboard. Purchases are one-per-user-per-item
(partial unique backstop) and run ownership check → gem balance check → grant + debit
in one serializable transaction (`src/lib/server/store-service.ts`).

Admins author items at `/admin/items`: structured per-kind style editors with live
preview and a raw-JSON escape hatch, both re-validated server-side with
`parseItemStyle` so unrenderable style can never persist. Slug and kind are immutable
after creation (a kind change would orphan equipped slots). The item detail page
includes a manual grant tool.

## Achievements

Eight achievement keys are defined in `src/lib/achievements.ts` — the definitions, gem
amounts, and badge attachments in one place:

`first-win`, `streak-3/5/10` (consecutive wins by resolution order), `longshot-win`
(a win whose pre-bet implied probability was under 10%, reconstructed from bet
snapshots), `volume-10/50/100` (settled Global markets participated in).

- **Global League only**, and only RESOLVED markets count — canceled markets advance
  nothing.
- The evaluator is pure (`evaluateAchievements`); `achievement-service.ts` builds each
  user's history in one query, diffs against already-granted keys, and grants
  idempotently (unique `[userId, achievementKey]`). `streak-5`, `streak-10`,
  `longshot-win`, and `volume-100` also grant their badge items.
- Evaluation triggers post-settlement for every staker of the resolved market (losers
  too — volume still advances) and is swept daily by the cron for the last 48 hours
  of resolutions, so a missed post-commit pass self-repairs (`docs/markets.md`).
- Members pick up to 3 achievements to showcase on their profile
  (`/u/[username]/achievements` lists all: earned lit with date and gems, unearned
  dimmed). Validation caps the showcase and requires the achievements be earned
  (`setShowcasedAchievements`).

## Feedback

Any signed-in member can send feedback from the avatar menu ("Send feedback"): a
dialog with a message (max 1000 characters) that also captures the path of the page
they were on. Submissions create append-only `Feedback` rows
(`src/lib/server/feedback-service.ts`) — there is no editing and no member-facing
history — and the submit path is rate-limited per user like comments. The captured
path is user-supplied metadata: the service drops anything that doesn't start with
`/`, and the admin view renders it as plain text, never as a link.

Admins triage at `/admin/feedback` (unresolved newest-first on top, resolved
collapsed below) and can resolve or reopen each entry — `resolvedAt` is a mutable
triage flag, not part of the append-only record. The admin dashboard's
needs-attention list shows the unresolved count with a link into the queue.
