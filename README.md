# Jade Tile Mahjong Club

Live leaderboards for a university mahjong club. Two boards — **Advanced**
and **Beginner** run side by side as tabs, each with its own standings,
top 5, and win rates. Executives enter scores behind a password login; everyone
else sees a read-only board.

The leaderboard is written as a self-contained section, so it can drop into
a larger club site later without a rewrite.

**Stack:** Cloudflare Workers + D1 (SQLite). No framework, no build step.
Runs entirely on free tiers.

---

## How it works

**Totals are never stored.** A player's score is the sum of their round
entries, so undoing a round is a single delete and the board stays correct.
A "win" is a round where the player scored highest at their table — also
derived, so there is no counter to drift out of sync.

**The two boards are separate seasons.** A player belongs to one board and
earns points only from rounds played there. Moving someone from beginner to
advanced starts them at zero, which is the point: beginner points would not
mean much at the harder table.

**The public API only ever returns the top 5.** The cut happens in the SQL,
not in the browser, so scores below fifth place never leave the database.
A viewer can see their own rank by picking their name, which is stored in
their browser only.

## Layout

```
public/
  index.html            the club page
  admin/index.html      exec score entry (password protected)
  assets/
    leaderboard.css     ─┐ the leaderboard section — these two files plus
    leaderboard.js      ─┘ one <div> are all it needs to live anywhere
    site.css            page chrome (not needed by the section)
    admin.css/.js       exec page
src/index.js            the API and auth
schema.sql              database tables (fresh install)
migrate-auth.sql        adds the login throttle table to an existing database
seed.sql                sample players, for local testing only
```

---

## Setup

Needs Node 18+ and a Cloudflare account. Everything below is free.

### 1. Install

```bash
npm install
npx wrangler login
```

### 2. Create the database

```bash
npx wrangler d1 create jade-tile
```

Paste the printed `database_id` into `wrangler.toml`, then:

```bash
npm run db:init
```

### 3. Set the exec password

```bash
npx wrangler secret put ADMIN_PASSWORD
```

It prompts you to type it; nothing echoes. **Use a passphrase — four
random words, not a PIN.** The value is stored encrypted by Cloudflare,
never in this repo.

### 4. Deploy

```bash
npm run deploy
```

You get a `*.workers.dev` URL. The site is live at that point.

### Run it locally instead

```bash
npm run db:init:local
npm run db:seed:local      # sample players so the board isn't empty
echo "ADMIN_PASSWORD=dev-password-here" > .dev.vars
npm run dev
```

Open http://localhost:8787. `.dev.vars` is gitignored.

---

## Exec sign-in

`/admin` asks for the password, then sets a signed, HttpOnly session cookie
that lasts 12 hours. The password is never stored in the page or sent back
to the browser.

- Without a valid session, every write endpoint returns 401.
- The session cookie is HMAC-signed, so it cannot be forged or edited.
- 8 wrong guesses from one IP locks that IP out for 15 minutes.
- Changing the password invalidates every existing session, because the
  signing key is derived from it.

It is one shared password, so there is no record of which exec entered
what. Rotate it when someone graduates:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

If you lock yourself out:

```bash
npx wrangler d1 execute jade-tile --remote --command "DELETE FROM login_attempts"
```

### Per-person logins instead (needs a domain)

Cloudflare Access gives each exec their own email login and is free for up
to 50 users, but it requires a custom domain — it cannot protect a
`workers.dev` URL. If you get a domain, create a self-hosted Access
application covering `/admin` and `/api/admin`, then set:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "yourteam.cloudflareaccess.com"
ACCESS_AUD = "the application audience tag"
```

Redeploy and it switches over. That code path is already in `src/index.js`;
nothing else changes.

---

## Running the season

Go to `/admin`, pick a board, add players, record rounds. Points can be
negative. Leave a player blank if they sat out. Undo puts the points
straight back.

To rename the boards or add a third, edit `TIERS` at the top of
`src/index.js` — the tabs, the API, and the exec page all read from it.

To count something other than highest-score-at-the-table as a "win", change
the one SQL expression in `standings()`.

---

## Dropping the leaderboard into another site

Three things:

```html
<link rel="stylesheet" href="/assets/leaderboard.css">
<div id="jade-leaderboard"></div>
<script src="/assets/leaderboard.js" defer></script>
```

It mounts itself, fetches its own data, and touches nothing outside that
div — every class is prefixed `jtl__`. If the host page is on a different
domain from the API:

```html
<div id="jade-leaderboard" data-api="https://your-api-host"></div>
```

Reskin by overriding the tokens:

```css
#jade-leaderboard { --jtl-felt: #1a1a1a; --jtl-bamboo: #c00; }
```

---

## API

| Endpoint | Who | What |
|---|---|---|
| `GET /api/tiers` | anyone | the boards and how many play on each |
| `GET /api/standings?tier=` | anyone | that board's top 5, with points and win rate |
| `GET /api/roster?tier=` | anyone | player ids and names, no scores |
| `GET /api/me?id=` | anyone | that player's board, rank, win rate, and the gap to the player above |
| `POST /api/admin/login` | anyone | `{ password }` → session cookie |
| `/api/admin/*` | execs | full standings, add/rename/move/remove players, record and undo rounds |

---

## Notes

- `wrangler.toml` holds no credentials. `account_id` and `database_id` are
  identifiers, not secrets — they are useless without an API token. Strip
  them if you would rather not publish them.
- Secrets go through `npx wrangler secret put NAME`, never into a file.
- Free tier headroom: D1 allows 5 million row reads and 100,000 row writes
  per day. A club season is a few hundred rows.
- Removing a player hides them from the board but keeps their past rounds,
  so everyone else's history stays correct. Moving a player between boards
  clears their scores, because those points belonged to the board they left.
