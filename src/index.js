/**
 * Jade Tile Mahjong Club — API Worker
 *
 * Two boards, 'advanced' and 'beginner'. Every read takes ?tier=; the
 * default is the first tier listed in TIERS.
 *
 * Public endpoints (no auth):
 *   GET  /api/tiers                       the boards and how many play on each
 *   GET  /api/standings?tier=             top five only, plus club-wide counts\n *                                         each with how far they moved since the last meet
 *   GET  /api/roster?tier=                player ids + names, no scores
 *   GET  /api/me?id=<playerId>            that player's rank, movement, win rate and the
 *                                         gap to the player above them
 *
 * Exec endpoints (sign-in required — see requireExec below):
 *   POST   /api/admin/login               { password }  → sets a session cookie
 *   POST   /api/admin/logout
 *   GET    /api/admin/whoami
 *   GET    /api/admin/standings?tier=     every player on that board
 *   GET    /api/admin/rounds              recent rounds across both boards
 *   POST   /api/admin/rounds              { tier, played_on?, note?, deltas: [[playerId, points], ...] }
 *   DELETE /api/admin/rounds/:id          undo a round
 *   POST   /api/admin/players             { name, tier }
 *   PATCH  /api/admin/players/:id         { name? , tier? }  — changing tier resets that player's board
 *   DELETE /api/admin/players/:id
 *
 * A "win" is a round in which the player scored highest at their table.
 * Ties count as a win for everyone tied. It is derived from the scores,
 * so there is no win counter to keep in sync.
 */

const TOP_N = 5;

const TIERS = [
  { key: "advanced", label: "Advanced" },
  { key: "beginner", label: "Beginner" },
];

const DEFAULT_TIER = TIERS[0].key;

function tierOf(url) {
  const t = url.searchParams.get("tier");
  return TIERS.some((x) => x.key === t) ? t : DEFAULT_TIER;
}
function validTier(t) {
  return TIERS.some((x) => x.key === t);
}
function labelOf(key) {
  const t = TIERS.find((x) => x.key === key);
  return t ? t.label : key;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const res = url.pathname.startsWith("/api/admin/")
        ? await handleAdmin(request, env, url)
        : await handlePublic(request, env, url);
      res.headers.set("cache-control", "no-store");
      return res;
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      return json({ error: "server_error" }, 500);
    }
  },
};

/* ------------------------------------------------------------------ */
/* public                                                              */
/* ------------------------------------------------------------------ */

async function handlePublic(request, env, url) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const path = url.pathname;

  if (path === "/api/tiers") {
    // Counted the same way the board ranks: a player appears once they have
    // played a round here, so the tab and the board never disagree.
    const { results } = await env.DB.prepare(
      `SELECT p.tier, COUNT(DISTINCT p.id) AS n
         FROM players p
         JOIN scores s ON s.player_id = p.id
         JOIN rounds r ON r.id = s.round_id AND r.tier = p.tier
        WHERE p.active = 1
        GROUP BY p.tier`
    ).all();
    const counts = Object.fromEntries(results.map((r) => [r.tier, r.n]));
    return json({
      tiers: TIERS.map((t) => ({ ...t, players: counts[t.key] || 0 })),
      default: DEFAULT_TIER,
    });
  }

  if (path === "/api/standings") {
    const tier = tierOf(url);
    const ranked = withRanks(await standings(env, tier));
    const moved = await movement(env, tier, ranked);
    return json({
      tier,
      label: labelOf(tier),
      updated: await lastPlayed(env, tier),
      players: ranked.slice(0, TOP_N).map((p) => ({
        ...publicRow(p),
        movement: moved.get(p.id) ?? null,
      })),
      total_players: ranked.length,
      rounds_played: await countRounds(env, tier),
    });
  }

  if (path === "/api/roster") {
    const tier = tierOf(url);
    const { results } = await env.DB.prepare(
      "SELECT id, name FROM players WHERE active = 1 AND tier = ? ORDER BY name COLLATE NOCASE"
    ).bind(tier).all();
    return json({ tier, players: results });
  }

  if (path === "/api/me") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "missing_id" }, 400);

    const row = await env.DB.prepare(
      "SELECT tier, name FROM players WHERE id = ? AND active = 1"
    ).bind(id).first();
    if (!row) return json({ error: "unknown_player" }, 404);

    const tier = row.tier;
    const ranked = withRanks(await standings(env, tier));
    const moved = await movement(env, tier, ranked);
    const i = ranked.findIndex((p) => p.id === id);

    // On the board but no rounds yet: a real answer, not a 404.
    if (i === -1) {
      return json({
        tier,
        label: labelOf(tier),
        unranked: true,
        you: { id, name: row.name, score: 0, games: 0, wins: 0, win_rate: null, rank: null, movement: null },
        in_top: false,
        total_players: ranked.length,
        ahead: null, lead: null, tied_with: [],
      });
    }

    const me = ranked[i];
    let ahead = null;
    for (let j = i - 1; j >= 0; j--) {
      if (ranked[j].score > me.score) { ahead = ranked[j]; break; }
    }
    const tied = ranked.filter((p) => p.id !== me.id && p.rank === me.rank);
    return json({
      tier,
      label: labelOf(tier),
      you: { ...publicRow(me), movement: moved.get(me.id) ?? null },
      // The board lists the first five ROWS, not the first five ranks: six
      // players level on 0 all hold rank 1, and only five of them are shown.
      in_top: i < TOP_N,
      total_players: ranked.length,
      ahead: ahead ? { name: ahead.name, gap: ahead.score - me.score } : null,
      lead: !ahead && ranked[1] ? me.score - ranked[1].score : null,
      tied_with: tied.map((p) => p.name),
    });
  }

  return json({ error: "not_found" }, 404);
}

function publicRow(p) {
  return {
    id: p.id,
    name: p.name,
    score: p.score,
    games: p.games,
    wins: p.wins,
    win_rate: p.games ? Math.round((p.wins / p.games) * 100) : null,
    rank: p.rank,
  };
}

/* ------------------------------------------------------------------ */
/* exec                                                                */
/* ------------------------------------------------------------------ */

async function handleAdmin(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");
  const m = request.method;

  // Signing in and out are the only endpoints reachable without a session.
  if (path === "/api/admin/login" && m === "POST") return handleLogin(request, env);
  if (path === "/api/admin/logout" && m === "POST") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": clearCookie(url),
      },
    });
  }

  const who = await requireExec(request, env);
  if (who.error) return json({ error: who.error, detail: who.detail }, who.status);
  const email = who.email;

  if (path === "/api/admin/whoami" && m === "GET") {
    return json({ email, tiers: TIERS });
  }

  if (path === "/api/admin/standings" && m === "GET") {
    const tier = tierOf(url);
    return json({ tier, players: withRanks(await standings(env, tier)).map(publicRow) });
  }

  if (path === "/api/admin/rounds" && m === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.tier, r.played_on, r.note, r.created_by,
              s.player_id, s.points, p.name
         FROM rounds r
         JOIN scores s ON s.round_id = r.id
         JOIN players p ON p.id = s.player_id
        WHERE r.id IN (SELECT id FROM rounds ORDER BY played_on DESC, created_at DESC LIMIT 12)
        ORDER BY r.played_on DESC, r.created_at DESC, s.points DESC`
    ).all();
    const byRound = new Map();
    for (const row of results) {
      if (!byRound.has(row.id)) {
        byRound.set(row.id, {
          id: row.id, tier: row.tier, label: labelOf(row.tier),
          played_on: row.played_on, note: row.note,
          created_by: row.created_by, entries: [],
        });
      }
      byRound.get(row.id).entries.push({ name: row.name, points: row.points });
    }
    return json({ rounds: [...byRound.values()] });
  }

  if (path === "/api/admin/rounds" && m === "POST") {
    const body = await readJson(request);
    if (!body) return json({ error: "bad_json" }, 400);

    const tier = validTier(body.tier) ? body.tier : null;
    if (!tier) return json({ error: "bad_tier" }, 400);

    const clean = [];
    for (const d of Array.isArray(body.deltas) ? body.deltas : []) {
      if (!Array.isArray(d) || d.length !== 2) continue;
      const pid = String(d[0]);
      const pts = Number(d[1]);
      if (!pid || !Number.isFinite(pts)) continue;
      clean.push([pid, Math.round(pts)]);
    }
    if (!clean.length) return json({ error: "no_entries" }, 400);

    // everyone in the round must actually play on that board
    const { results } = await env.DB.prepare(
      "SELECT id FROM players WHERE active = 1 AND tier = ?"
    ).bind(tier).all();
    const known = new Set(results.map((r) => r.id));
    for (const [pid] of clean) {
      if (!known.has(pid)) return json({ error: "wrong_board", detail: pid }, 400);
    }

    const id = uid();
    const now = new Date().toISOString();
    const playedOn = isDate(body.played_on) ? body.played_on : now.slice(0, 10);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 140) : "";

    const stmts = [
      env.DB.prepare(
        "INSERT INTO rounds (id, tier, played_on, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(id, tier, playedOn, note, now, email),
    ];
    for (const [pid, pts] of clean) {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO scores (round_id, player_id, points) VALUES (?, ?, ?)"
        ).bind(id, pid, pts)
      );
    }
    await env.DB.batch(stmts);
    return json({ ok: true, id, tier }, 201);
  }

  const undo = path.match(/^\/api\/admin\/rounds\/([\w.:@+-]+)$/);
  if (undo && m === "DELETE") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM scores WHERE round_id = ?").bind(undo[1]),
      env.DB.prepare("DELETE FROM rounds WHERE id = ?").bind(undo[1]),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/admin/players" && m === "POST") {
    const body = await readJson(request);
    const name = body && typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    const tier = body && validTier(body.tier) ? body.tier : DEFAULT_TIER;
    if (!name) return json({ error: "missing_name" }, 400);
    const id = uid();
    await env.DB.prepare(
      "INSERT INTO players (id, name, tier, active, created_at) VALUES (?, ?, ?, 1, ?)"
    ).bind(id, name, tier, new Date().toISOString()).run();
    return json({ ok: true, id, name, tier }, 201);
  }

  const one = path.match(/^\/api\/admin\/players\/([\w.:@+-]+)$/);
  if (one && m === "PATCH") {
    const body = (await readJson(request)) || {};
    const id = one[1];
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : null;
    const tier = validTier(body.tier) ? body.tier : null;
    if (!name && !tier) return json({ error: "nothing_to_change" }, 400);

    if (name) {
      await env.DB.prepare("UPDATE players SET name = ? WHERE id = ?").bind(name, id).run();
    }
    if (tier) {
      // Moving boards starts that player fresh: their old rounds stay on the
      // old board's history but no longer count for them anywhere.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM scores WHERE player_id = ?").bind(id),
        env.DB.prepare("UPDATE players SET tier = ? WHERE id = ?").bind(tier, id),
        env.DB.prepare(
          "DELETE FROM rounds WHERE id NOT IN (SELECT DISTINCT round_id FROM scores)"
        ),
      ]);
    }
    return json({ ok: true });
  }

  if (one && m === "DELETE") {
    await env.DB.prepare("UPDATE players SET active = 0 WHERE id = ?").bind(one[1]).run();
    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}

/* ------------------------------------------------------------------ */
/* queries                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every active player on one board, with their total, games and wins.
 *
 * `before` limits it to rounds played strictly before that date, which is how
 * the previous meet's ranks are recovered for the movement arrows.
 *
 * The cutoff lives in the JOIN, not the WHERE, and every aggregate then
 * ignores the rows the join excluded. Filtering them out in WHERE instead
 * would drop the whole player when *all* their rounds are after the cutoff —
 * so someone who debuted at the last meet would vanish from the baseline, and
 * everyone below them would be told they had fallen a place they never held.
 */
async function standings(env, tier, before = null) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name,
            COALESCE(SUM(CASE WHEN r.id IS NOT NULL THEN s.points END), 0) AS score,
            COUNT(r.id) AS games,
            COALESCE(SUM(
              CASE WHEN r.id IS NOT NULL AND s.points = (
                SELECT MAX(s2.points) FROM scores s2 WHERE s2.round_id = s.round_id
              ) THEN 1 ELSE 0 END
            ), 0) AS wins
       FROM players p
       LEFT JOIN scores s ON s.player_id = p.id
       LEFT JOIN rounds r ON r.id = s.round_id AND r.tier = ?1
                         ${before ? "AND r.played_on < ?2" : ""}
      WHERE p.active = 1 AND p.tier = ?1
      GROUP BY p.id, p.name
      ORDER BY score DESC, p.name COLLATE NOCASE ASC`
  ).bind(...(before ? [tier, before] : [tier])).all();
  // Nobody holds a rank until they have played a round here. A player who has
  // only just been added would otherwise sit at 0 points in the middle of the
  // board, above everyone on a negative score — and, worse, occupy a place in
  // the previous meet's baseline that they never actually held, inflating the
  // movement of everyone below them.
  return results.filter((p) => p.games);
}

/**
 * How far each player moved since the meet before the most recent one.
 * Positive is up the board. Null means no comparison is possible: they had
 * not played before the last meet, so they have not moved from anywhere.
 */
async function movement(env, tier, ranked) {
  const last = await lastPlayed(env, tier);
  if (!last) return new Map();
  const was = new Map(
    withRanks(await standings(env, tier, last)).map((p) => [p.id, p.rank])
  );
  return new Map(
    ranked.map((p) => [p.id, p.games && was.has(p.id) ? was.get(p.id) - p.rank : null])
  );
}

function withRanks(rows) {
  let rank = 0, prev = null;
  return rows.map((p, i) => {
    if (p.score !== prev) { rank = i + 1; prev = p.score; }
    return { ...p, rank };
  });
}

async function lastPlayed(env, tier) {
  const row = await env.DB.prepare(
    "SELECT MAX(played_on) AS d FROM rounds WHERE tier = ?"
  ).bind(tier).first();
  return (row && row.d) || null;
}

async function countRounds(env, tier) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM rounds WHERE tier = ?"
  ).bind(tier).first();
  return (row && row.n) || 0;
}

/* ------------------------------------------------------------------ */
/* Cloudflare Access                                                   */
/* ------------------------------------------------------------------ */

/**
 * Two ways to be an exec, checked in this order:
 *
 *  1. A shared password (ADMIN_PASSWORD, stored as a Wrangler secret).
 *     Signing in sets a signed, HttpOnly session cookie that lasts 12
 *     hours. The password itself is never stored in the page, never in
 *     the repo, and never sent back to the browser.
 *
 *  2. Cloudflare Access, if ACCESS_TEAM_DOMAIN and ACCESS_AUD are set.
 *     That needs a custom domain, so it is optional — set those two and
 *     the site uses per-person logins instead, with no code change.
 *
 * With neither configured the write endpoints refuse everything. That is
 * deliberate: a half-finished setup never leaves score entry open.
 */
async function requireExec(request, env) {
  // 1. password session
  if (env.ADMIN_PASSWORD) {
    const token = cookie(request, SESSION_COOKIE);
    if (token) {
      const who = await verifySession(token, env.ADMIN_PASSWORD);
      if (who) return { email: who };
    }
  }

  // 2. Cloudflare Access
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (team && aud) {
    const token =
      request.headers.get("cf-access-jwt-assertion") ||
      cookie(request, "CF_Authorization");
    if (token) {
      try {
        const payload = await verifyAccessJwt(token, team, aud);
        return { email: payload.email || payload.common_name || "unknown" };
      } catch (e) {
        return { error: "bad_token", detail: String(e.message || e), status: 401 };
      }
    }
  }

  if (!env.ADMIN_PASSWORD && !(team && aud)) {
    return {
      error: "auth_not_configured",
      detail: "Set an exec password with: npx wrangler secret put ADMIN_PASSWORD",
      status: 503,
    };
  }
  return { error: "not_signed_in", status: 401 };
}

/* ---------------- password sign-in ---------------- */

const SESSION_COOKIE = "jt_exec";
const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 8;          // per IP
const ATTEMPT_WINDOW_MIN = 15;

async function handleLogin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({
      error: "auth_not_configured",
      detail: "Set an exec password with: npx wrangler secret put ADMIN_PASSWORD",
    }, 503);
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const blocked = await tooManyAttempts(env, ip);
  if (blocked) {
    return json({ error: "too_many_attempts", detail: blocked }, 429);
  }

  const body = await readJson(request);
  const supplied = body && typeof body.password === "string" ? body.password : "";

  // Compare in a way that does not leak the password's length or content
  // through how long the comparison takes.
  const ok = await constantTimeEquals(supplied, env.ADMIN_PASSWORD);
  if (!ok) {
    await recordFailure(env, ip);
    // a small delay blunts rapid guessing without hurting a real sign-in
    await new Promise((r) => setTimeout(r, 400));
    return json({ error: "wrong_password" }, 401);
  }

  await clearFailures(env, ip);
  const url = new URL(request.url);
  const token = await makeSession(env.ADMIN_PASSWORD);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": sessionCookie(token, url),
    },
  });
}

function cookieFlags(url) {
  // Secure is only valid over https; localhost dev is http.
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `Path=/; HttpOnly;${secure} SameSite=Strict`;
}
function sessionCookie(token, url) {
  return `${SESSION_COOKIE}=${token}; ${cookieFlags(url)}; Max-Age=${SESSION_HOURS * 3600}`;
}
function clearCookie(url) {
  return `${SESSION_COOKIE}=; ${cookieFlags(url)}; Max-Age=0`;
}

/** The signing key is derived from the password, so changing the
 *  password immediately invalidates every existing session. */
async function sessionKey(password) {
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("jade-tile-session:" + password)
  );
  return crypto.subtle.importKey(
    "raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

async function makeSession(password) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify({ exp })));
  const key = await sessionKey(password);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return payload + "." + bytesToB64url(new Uint8Array(sig));
}

async function verifySession(token, password) {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const key = await sessionKey(password);
    const ok = await crypto.subtle.verify(
      "HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(payload)
    );
    if (!ok) return null;
    const data = JSON.parse(b64urlToText(payload));
    if (!data.exp || Date.now() > data.exp) return null;
    return "exec";
  } catch {
    return null;
  }
}

async function constantTimeEquals(a, b) {
  // Hash both sides first: equal-length digests mean the comparison
  // below runs in the same time whatever was supplied.
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------------- brute-force throttle (D1-backed) ---------------- */

async function tooManyAttempts(env, ip) {
  try {
    const row = await env.DB.prepare(
      "SELECT count, reset_at FROM login_attempts WHERE ip = ?"
    ).bind(ip).first();
    if (!row) return null;
    if (Date.now() > row.reset_at) return null;
    if (row.count < MAX_ATTEMPTS) return null;
    const mins = Math.ceil((row.reset_at - Date.now()) / 60000);
    return `Too many tries. Wait ${mins} minute${mins === 1 ? "" : "s"}.`;
  } catch {
    return null; // table missing — never lock anyone out over bookkeeping
  }
}

async function recordFailure(env, ip) {
  const now = Date.now();
  const resetAt = now + ATTEMPT_WINDOW_MIN * 60000;
  try {
    await env.DB.prepare(
      `INSERT INTO login_attempts (ip, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(ip) DO UPDATE SET
         count    = CASE WHEN ?3 > login_attempts.reset_at THEN 1 ELSE login_attempts.count + 1 END,
         reset_at = CASE WHEN ?3 > login_attempts.reset_at THEN ?2 ELSE login_attempts.reset_at END`
    ).bind(ip, resetAt, now).run();
  } catch { /* table missing; sign-in still works */ }
}

async function clearFailures(env, ip) {
  try {
    await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
  } catch { /* nothing to clear */ }
}

function bytesToB64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let jwksCache = { at: 0, keys: null };

async function verifyAccessJwt(token, team, aud) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h64, p64, s64] = parts;
  const header = JSON.parse(b64urlToText(h64));
  const payload = JSON.parse(b64urlToText(p64));

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) throw new Error("expired");
  if (payload.nbf && now < payload.nbf - 60) throw new Error("not yet valid");
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error("wrong audience");
  const issuer = `https://${team}`;
  if (payload.iss !== issuer) throw new Error("wrong issuer");

  const jwks = await getJwks(issuer);
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown signing key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s64),
    new TextEncoder().encode(`${h64}.${p64}`)
  );
  if (!ok) throw new Error("bad signature");
  return payload;
}

async function getJwks(issuer) {
  if (jwksCache.keys && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("cannot fetch signing keys");
  const body = await res.json();
  jwksCache = { at: Date.now(), keys: body.keys || [] };
  return jwksCache.keys;
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function cookie(request, name) {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToText(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

function uid() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
