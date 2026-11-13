// Odesa API: one Edge Function for the whole app. Own login (passcode + device session), owner only.
import { sql, kvGet, kvSet } from "./db.ts";
import { MD, UW, BudgetExceeded, grokJson, GROK_FAST, bills } from "./feeds.ts";
import { SourceError } from "./net.ts";
import { allocate, rebalance, marketOpen, tradingDay, etNow } from "./core.ts";
import * as O from "./options.ts";
import * as S from "./signals.ts";
import * as OPAL from "./opal.ts";
import * as R from "./research.ts";
import * as G from "./grow.ts";
import * as P from "./perf.ts";
import { vapid, subscribe, unsubscribe, notify } from "./push.ts";

const ORIGINS = [/^https:\/\/wpinno11\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function pbkdf2(pass: string, salt: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 210000 }, k, 256));
}
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const bad = (m: string, s = 400) => { throw new HttpError(s, m); };

async function newSession(device: string) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await sql`insert into odesa.sessions(token_hash, device, expires_at) values (${await sha(token)}, ${device.slice(0, 80)}, now() + interval '180 days')`;
  return token;
}
/** Count every attempt atomically (per device address and overall) before checking it, so parallel guesses can't slip past the limit. */
async function allowAttempt(ip: string) {
  const bump = async (key: string, limit: number) => {
    const [r] = await sql`insert into odesa.auth_attempts(key, n, window_start) values (${key}, 1, now())
      on conflict (key) do update set n = case when odesa.auth_attempts.window_start < now() - interval '15 minutes' then 1 else odesa.auth_attempts.n + 1 end,
        window_start = case when odesa.auth_attempts.window_start < now() - interval '15 minutes' then now() else odesa.auth_attempts.window_start end
      returning n, window_start`;
    return { ok: r.n <= limit, mins: Math.max(1, Math.ceil((new Date(r.window_start).getTime() + 15 * 60000 - Date.now()) / 60000)) };
  };
  const a = await bump(`ip:${ip}`, 5); if (!a.ok) bad(`Too many tries. Wait ${a.mins} minutes.`, 429);
  const g = await bump("all", 30); if (!g.ok) bad(`Too many tries. Wait ${g.mins} minutes.`, 429);
}
async function attemptOk(ip: string) { await sql`delete from odesa.auth_attempts where key = ${`ip:${ip}`}`; }

async function auth(req: Request) {
  const h = req.headers.get("authorization") ?? ""; const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!/^[0-9a-f]{64}$/.test(tok)) bad("Please log in.", 401);
  const r = await sql`update odesa.sessions set last_seen = now() where token_hash = ${await sha(tok)} and expires_at > now() returning device`;
  if (!r.length) bad("Please log in again.", 401);
}

type Ctx = { req: Request; body: any; q: URLSearchParams; parts: string[] };
const num = (v: any, name: string) => { const n = Number(v); if (!Number.isFinite(n)) bad(`${name} must be a number.`); return n; };

async function models() {
  const ms = await sql`select m.*, coalesce((select jsonb_agg(a order by a.name) from odesa.accounts a where a.model_id = m.id), '[]') accounts from odesa.models m order by sort, id`;
  return ms;
}
function cleanHoldings(h: any[]) {
  if (!Array.isArray(h)) bad("Holdings must be a list.");
  const out = h.map((x) => ({ t: String(x.t ?? "").toUpperCase().trim(), n: String(x.n ?? "").replace(/[<>&"`]/g, "").slice(0, 80), w: Math.round(Number(x.w)), cash: !!x.cash }))
    .filter((x) => x.t);
  for (const x of out) { if (!/^[A-Z0-9.^\-_]{1,40}$/.test(x.t) || !(x.w >= 0 && x.w <= 10000)) bad(`Check ${x.t}.`); }
  const tot = out.reduce((s, x) => s + x.w, 0); if (out.length && tot !== 10000) bad(`Targets add up to ${(tot / 100).toFixed(2)}%. They need to total 100%.`);
  return out;
}

async function route(c: Ctx): Promise<unknown> {
  const [a, b, d] = c.parts; const m = c.req.method;
  // ---------------- login (no session needed)
  if (a === "auth") {
    if (b === "status") return { has_passcode: !!(await kvGet<any>("passcode", null)) };
    const ip = (c.req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64) || "unknown";
    if (b === "setup" || b === "login") await allowAttempt(ip);
    const pass = String(c.body.passcode ?? ""); const device = String(c.body.device ?? "device");
    if (b === "setup" && m === "POST") {
      if (await kvGet<any>("passcode", null)) bad("A passcode is already set. Log in instead.");
      const st = await kvGet<any>("setup", null);
      const ok = st && Date.now() < st.expires && same(await sha(String(c.body.setup_code ?? "").trim().toUpperCase()), st.hash);
      if (!ok) bad("That setup code isn't right.", 401);
      await attemptOk(ip);
      if (!/^\d{6,12}$/.test(pass)) bad("Pick a passcode of 6 to 12 digits.");
      const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
      await kvSet("passcode", { salt, hash: await pbkdf2(pass, salt) }); await kvSet("setup", { used: true });
      return { token: await newSession(device) };
    }
    if (b === "login" && m === "POST") {
      const p = await kvGet<any>("passcode", null); if (!p) bad("No passcode yet. Use your setup code first.");
      const ok = same(await pbkdf2(pass, p.salt), p.hash);
      if (!ok) bad("Wrong passcode.", 401);
      await attemptOk(ip);
      return { token: await newSession(device) };
    }
    if (b === "logout" && m === "POST") { const t = (c.req.headers.get("authorization") ?? "").slice(7); await sql`delete from odesa.sessions where token_hash = ${await sha(t)}`; return { ok: true }; }
    bad("Not found.", 404);
  }
  // ---------------- scheduled bots (cron token)
  if (a === "bots" && b === "tick") {
    const tok = c.req.headers.get("x-odesa-cron") ?? ""; const want = await kvGet<string>("cron_token", "");
    if (!want || !same(await sha(tok), await sha(want))) bad("Not allowed.", 403);
    return await tick();
  }

  await auth(c.req);

  // ---------------- Today
  if (a === "today") return await R.today();
  if (a === "quotes") return await MD.quotes((c.q.get("s") ?? "").split(",").slice(0, 100));

  // ---------------- models, calculator, rebalance
  if (a === "models" && !b && m === "GET") return await models();
  if (a === "models" && !b && m === "POST") {
    const h = cleanHoldings(c.body.holdings ?? []);
    const [r] = await sql`insert into odesa.models(name, benchmark, holdings, sort) values (${String(c.body.name ?? "New model").slice(0, 60)}, ${c.body.benchmark ?? "SPY"}, ${sql.json(h)}, 99) returning *`;
    await sql`insert into odesa.model_weights(model_id, holdings) values (${r.id}, ${sql.json(h)})`;
    return r;
  }
  if (a === "models" && b && m === "POST" && !d) {
    const id = num(b, "id"); const [cur] = await sql`select * from odesa.models where id = ${id}`; if (!cur) bad("Model not found.", 404);
    const h = c.body.holdings !== undefined ? cleanHoldings(c.body.holdings) : cur.holdings;
    await sql`insert into odesa.model_versions(model_id, name, holdings) values (${id}, ${cur.name}, ${sql.json(cur.holdings)})`;
    const [r] = await sql`update odesa.models set name = ${String(c.body.name ?? cur.name).slice(0, 60)}, benchmark = ${c.body.benchmark ?? cur.benchmark}, holdings = ${sql.json(h)}, updated_at = now() where id = ${id} returning *`;
    if (JSON.stringify(h) !== JSON.stringify(cur.holdings)) await sql`insert into odesa.model_weights(model_id, holdings) values (${id}, ${sql.json(h)})`;
    return r;
  }
  if (a === "models" && b && d === "undo" && m === "POST") {
    const id = num(b, "id"); const [v] = await sql`select * from odesa.model_versions where model_id = ${id} order by saved_at desc limit 1`;
    if (!v) bad("Nothing to undo."); await sql`update odesa.models set holdings = ${sql.json(v.holdings)}, updated_at = now() where id = ${id}`;
    await sql`insert into odesa.model_weights(model_id, holdings) values (${id}, ${sql.json(v.holdings)})`;
    await sql`delete from odesa.model_versions where id = ${v.id}`; return { ok: true };
  }
  if (a === "models" && b && m === "DELETE") { await sql`delete from odesa.models where id = ${num(b, "id")}`; return { ok: true }; }
  if (a === "models" && b && d === "account" && m === "POST") {
    const id = num(b, "id"); const shares: Record<string, number> = {};
    for (const [t, n] of Object.entries(c.body.shares ?? {})) { const k = String(t).toUpperCase(); const v = Math.round(Number(n)); if (/^[A-Z0-9.\-]{1,12}$/.test(k) && v >= 0) shares[k] = v; }
    const cash = Math.max(0, Number(c.body.cash ?? 0) || 0);
    await sql`insert into odesa.accounts(model_id, name, cash, shares) values (${id}, ${String(c.body.name ?? "Main").slice(0, 40)}, ${cash}, ${sql.json(shares)})
      on conflict (model_id, name) do update set cash = excluded.cash, shares = excluded.shares, updated_at = now()`;
    return { ok: true };
  }
  if (a === "models" && b === "parse" && m === "POST") {
    // Read holdings out of any pasted text (spreadsheet rows, an email, a broker statement) with Grok, then check each ticker has a live price.
    const text = String(c.body.text ?? "").slice(0, 20000); if (text.trim().length < 2) bad("Paste your list first.");
    const r = await grokJson("Pull the stock/ETF/fund holdings out of this text. For each: ticker (US symbol; convert company names to tickers only when you are sure), " +
      "name, and target weight in percent if the text gives one (else null). Treat cash/money market as {\"ticker\":\"CASH\",\"cash\":true}. Ignore totals, headers and anything that is not a holding.\n\nTEXT:\n" + text,
      '[{"ticker":"","name":"","weight":null,"cash":false}]', { model: GROK_FAST, timeoutMs: 60000 });
    const rows = (Array.isArray(r.data) ? r.data : []).map((x: any) => ({ t: String(x.ticker ?? "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12), n: String(x.name ?? "").slice(0, 80),
      w: x.weight === null || x.weight === undefined || x.weight === "" ? null : Number(x.weight), cash: !!x.cash })).filter((x: any) => x.t);
    const q = await MD.quotes(rows.filter((x: any) => !x.cash).map((x: any) => x.t)).catch(() => ({} as any));
    return rows.map((x: any) => ({ ...x, price: x.cash ? null : q[x.t]?.last ?? null, found: x.cash || !!q[x.t] }));
  }
  if (a === "allocate") {
    const [mm] = await sql`select * from odesa.models where id = ${num(c.body.model_id, "model")}`; if (!mm) bad("Model not found.", 404);
    const h = (mm.holdings as any[]); const tk = h.filter((x) => !x.cash).map((x) => x.t);
    const q = await MD.quotes(tk); const prices = Object.fromEntries(tk.map((t: string) => [t, q[t]?.last ?? q[t]?.mid ?? null]));
    return { ...allocate(num(c.body.amount, "Amount"), h, prices), as_of: new Date().toISOString(), market_open: marketOpen() };
  }
  if (a === "rebalance") {
    const [mm] = await sql`select * from odesa.models where id = ${num(c.body.model_id, "model")}`; if (!mm) bad("Model not found.", 404);
    const [acct] = await sql`select * from odesa.accounts where model_id = ${mm.id} order by name limit 1`;
    const shares = c.body.shares ?? acct?.shares ?? {}; const cash = Number(c.body.cash ?? acct?.cash ?? 0);
    const tk = [...new Set([...(mm.holdings as any[]).filter((x) => !x.cash).map((x) => x.t), ...Object.keys(shares)])];
    const q = await MD.quotes(tk); const prices = Object.fromEntries(tk.map((t: string) => [t, q[t]?.last ?? q[t]?.mid ?? null]));
    return { ...rebalance(mm.holdings as any, shares, cash, prices, Math.round(Number(c.body.threshold_bps ?? 100))), as_of: new Date().toISOString() };
  }
  if (a === "watchlist") {
    if (m === "POST") { const t = String(c.body.ticker ?? "").toUpperCase().trim(); if (!/^[A-Z0-9.\-]{1,12}$/.test(t)) bad("Enter a ticker.");
      if (c.body.remove) await sql`delete from odesa.watchlist where ticker = ${t}`; else await sql`insert into odesa.watchlist(ticker, sort) values (${t}, 99) on conflict do nothing`; }
    const w = await sql`select ticker from odesa.watchlist order by sort, added_at`; const q = await MD.quotes(w.map((r: any) => r.ticker)).catch(() => ({} as any));
    return w.map((r: any) => ({ t: r.ticker, ...(q[r.ticker] ?? {}) }));
  }

  // ---------------- options
  if (a === "options") {
    if (b === "ideas" && m === "GET") return await O.listIdeas();
    if (b === "ideas" && m === "POST") return await O.addIdea(c.body);
    if (b === "approve") return await O.approve(num(d, "id"), c.body);
    if (b === "dismiss") return await O.dismiss(num(d, "id"));
    if (b === "positions") return await O.positions(c.q.get("status") ?? "open");
    if (b === "close") return await O.close(num(d, "id"));
    if (b === "results") return await O.stats();
    if (b === "chain") return await MD.chain(String(c.q.get("s") ?? ""), { dte: c.q.get("dte") ?? 30, side: c.q.get("side") ?? undefined, strikeLimit: 12 });
  }

  // ---------------- signals
  if (a === "signals") {
    if (!b) return { overlaps: await S.overlap(Number(c.q.get("days") ?? 7), 60),
      feed: await sql`select * from odesa.signals ${c.q.get("src") ? sql`where src = ${c.q.get("src")!}` : sql``} order by ts desc limit 120`,
      counts: await sql`select src, count(*)::int n from odesa.signals where ts > now() - interval '1 day' group by src` };
    if (b === "ticker") return { ticker: String(d).toUpperCase(), overlap: (await S.overlap(14, 400)).find((o) => o.ticker === String(d).toUpperCase()) ?? null,
      items: await sql`select * from odesa.signals where ticker = ${String(d).toUpperCase()} and ts > now() - interval '30 days' order by ts desc limit 60` };
    if (b === "earnings") return await kvGet("earnings_iv", { rows: [] });
    if (b === "putsales") return await kvGet("put_sales", { rows: [] });
    if (b === "sneaky") return await sql`select * from odesa.signals where src = 'S' and ts > now() - interval '7 days' order by ts desc limit 40`;
  }
  if (a === "feeds") {
    if (b === "run" && m === "POST") return await runJob(String(c.body.job ?? ""));
    const u = await sql`select source, sum(calls)::int calls, sum(errors)::int errors, sum(cost)::float8 cost, max(last_ok) last_ok, max(last_err) last_err,
        (array_agg(last_err_msg order by last_err desc nulls last))[1] last_err_msg, sum(calls) filter (where day = current_date)::int today
      from odesa.feed_usage where day >= date_trunc('month', current_date) group by source`;
    const keys = await sql`select name from vault.secrets where name in ('UNUSUAL_WHALES_API_KEY','MARKETDATA_API_KEY','XAI_API_KEY','QUIVER_API_KEY','ROIC_API_KEY','LEGISCAN_API_KEY','EIA_API_KEY','FRED_API_KEY')`;
    const s = await kvGet<any>("settings", {});
    return { usage: u, keys: keys.map((k: any) => k.name), grok_cap: s.grok_cap_usd ?? 300, last_tick: await kvGet("last_tick", null), daily: await kvGet("daily_done", null) };
  }
  if (a === "bills") return await bills(String(c.q.get("q") ?? "data center"), String(c.q.get("state") ?? "ALL"));

  // ---------------- research
  if (a === "stock") return d === "summary" ? await R.summary(String(b), c.q.get("force") === "1") : await R.stock(String(b));
  if (a === "search") {
    const q = String(c.q.get("q") ?? "").trim(); if (!q) return [];
    if (/^[A-Za-z.\-]{1,6}$/.test(q)) { const qq = await MD.quotes([q]).catch(() => ({} as any)); if (qq[q.toUpperCase()]) return [{ t: q.toUpperCase(), ...qq[q.toUpperCase()] }]; }
    return [];
  }

  // ---------------- Opal
  if (a === "opal") {
    if (!b && m === "POST") return await OPAL.start(String(c.body.q ?? ""));
    if (!b) return await OPAL.list(c.q.get("saved") === "1");
    if (d === "save") return await OPAL.save(num(b, "id"), c.body.saved !== false);
    return await OPAL.get(num(b, "id"));
  }

  // ---------------- Grow
  if (a === "grow") {
    const firm = String((await kvGet<any>("settings", {})).firm ?? "[Firm name]");
    if (!b && m === "GET") return { audiences: Object.entries(G.AUDIENCES).map(([id, v]) => ({ id, name: v[0], desc: v[1] })), channels: G.CHANNELS,
      ideas: await sql`select id, idea, breakdown->>'title' title, updated_at from odesa.grow order by updated_at desc limit 50` };
    if (b === "breakdown") {
      const idea = String(c.body.idea ?? "").replace(/\s+/g, " ").trim().slice(0, 1500); if (idea.length < 8) bad("Type your idea first (a sentence or two is plenty).");
      const r = await grokJson(`${G.BREAK_SYS}\n\nIdea: ${idea}`, "(see above)", { model: GROK_FAST, timeoutMs: 60000 });
      if (!r.data || typeof r.data !== "object") bad("Grok returned something unexpected. Try again.", 502);
      const [g] = await sql`insert into odesa.grow(idea, breakdown, explain) values (${idea}, ${sql.json(r.data)}, '{}') returning *`; return g;
    }
    const id = num(b, "id"); const [g] = await sql`select * from odesa.grow where id = ${id}`; if (!g) bad("Idea not found.", 404);
    if (!d && m === "GET") return g;
    if (!d && m === "DELETE") { await sql`delete from odesa.grow where id = ${id}`; return { ok: true }; }
    if (d === "explain") {
      const aud = String(c.body.audience ?? ""); if (!G.AUDIENCES[aud]) bad("Pick an audience.");
      const ex = g.explain ?? {}; if (ex[aud] && !c.body.regenerate) return ex[aud];
      const r = await grokJson(`${G.explainSys(aud)}\n\n${JSON.stringify({ idea: g.idea, summary: g.breakdown?.summary, advice: g.breakdown?.advice, risks: g.breakdown?.risks, avoid: g.breakdown?.avoid })}`,
        "(see above)", { model: GROK_FAST, timeoutMs: 90000 });
      if (!r.data || typeof r.data !== "object") bad("Grok returned something unexpected. Try Regenerate.", 502);
      const out: any = {};
      for (const ch of G.CHANNELS) {
        let v: any = r.data[ch]; if (v && typeof v === "object") v = (v.subject ? `Subject: ${v.subject}\n\n` : "") + String(v.body ?? v.text ?? "");
        const t = typeof v === "string" ? v.trim().replace(/^"|"$/g, "") : "";
        out[ch] = t ? G.comply(t, ch, firm) : { text: "", status: "needs_edits", issues: ["Grok didn't return this one. Tap Regenerate."], remaining: [], disclosure: "", chars: 0, limit: G.LIMITS[ch] };
      }
      ex[aud] = out; await sql`update odesa.grow set explain = ${sql.json(ex)}, updated_at = now() where id = ${id}`; return out;
    }
    if (d === "edit") {
      const aud = String(c.body.audience ?? ""), ch = String(c.body.channel ?? ""); if (!G.AUDIENCES[aud] || !G.CHANNELS.includes(ch)) bad("Unknown audience or channel.");
      const ex = g.explain ?? {}; ex[aud] = ex[aud] ?? {}; ex[aud][ch] = { ...G.comply(String(c.body.text ?? "").slice(0, 12000), ch, firm), edited: true };
      await sql`update odesa.grow set explain = ${sql.json(ex)}, updated_at = now() where id = ${id}`; return ex[aud][ch];
    }
  }

  // ---------------- alerts, settings, push
  if (a === "events") { if (m === "POST") await sql`update odesa.events set read = true where not read`; return await sql`select * from odesa.events order by ts desc limit 60`; }
  // ---------------- track record, comparisons, stats
  if (a === "perf" && b) {
    const id = num(b, "id");
    if (!d) return await P.track(id);
    if (d === "intraday") return await P.intraday(id);
    if (d === "compare") return await P.compare(id, String(c.q.get("vs") ?? ""), String(c.q.get("window") ?? "since"));
    if (d === "stats") return await P.stats(id, String(c.q.get("vs") ?? ""));
  }
  if (a === "settings") {
    const s = await kvGet<any>("settings", {});
    if (m === "POST") { const allow = ["target_pct", "stop_pct", "sell_target_pct", "sell_stop_pct", "contracts", "auto_close", "grok_cap_usd", "firm", "pulse", "push", "cash_yield_pct"];
      for (const k of allow) if (c.body[k] !== undefined) s[k] = c.body[k]; await kvSet("settings", s); }
    return s;
  }
  if (a === "push") {
    if (b === "key") return { key: await vapid() };
    if (b === "subscribe") { await subscribe(c.body.sub); return { ok: true }; }
    if (b === "unsubscribe") { await unsubscribe(String(c.body.endpoint ?? "")); return { ok: true }; }
    if (b === "test") return { sent: await notify("Odesa", "Notifications are on.", "#today") };
  }
  bad("Not found.", 404);
}

// ---------------------------------------------------------------- the scheduler's tick (every 5 minutes)
const DAILY = ["congress", "quiver", "earnings", "putsales", "transcripts"] as const;
async function runJob(job: string) {
  switch (job) {
    case "flow": return await S.ingestFlow();
    case "congress": return await S.ingestCongress();
    case "quiver": return await S.ingestQuiver();
    case "x": return await S.xSweep();
    case "transcripts": return await S.transcripts();
    case "earnings": return await S.earningsIV();
    case "putsales": return await S.putSales();
    case "mark": return await O.markAll();
    case "settle": return await O.settleExpired();
    case "perf": return await P.lockAll();
    default: bad("Unknown job.");
  }
}
async function tick() {
  // one tick at a time: claim a 140-second lock atomically, skip if another tick holds it
  const got = await sql`update odesa.kv set v = to_jsonb(extract(epoch from now())), updated_at = now() where k = 'tick_lock' and (v #>> '{}')::float8 < extract(epoch from now()) - 140 returning k`;
  if (!got.length) return { skipped: "another run is in progress" };
  try { return await tickInner(); } finally { await sql`update odesa.kv set v = '0'::jsonb where k = 'tick_lock'`; }
}
async function tickInner() {
  const n = etNow(), out: Record<string, unknown> = {}; const t0 = Date.now();
  const step = async (name: string, f: () => Promise<unknown>) => { try { out[name] = await f(); } catch (e) { out[name] = { error: (e as Error).message.slice(0, 160) }; } };
  if (marketOpen()) {
    await step("flow", S.ingestFlow); await step("mark", O.markAll); await step("overlap", S.notifyOverlaps);
    const lastX = await kvGet<number>("last_x", 0);
    if (Date.now() - lastX > 30 * 60000) { await kvSet("last_x", Date.now()); await step("x", S.xSweep); }
  }
  // one daily job per tick, from 7:00 ET on trading days (congress and Quiver also on weekends)
  const dd = await kvGet<any>("daily_done", { date: "", done: [] });
  if (dd.date !== n.date) { dd.date = n.date; dd.done = []; }
  if (n.mins >= 420 && !out.x && Date.now() - t0 < 30000) {
    const nextJob = DAILY.find((j) => !dd.done.includes(j) && (tradingDay() || j === "congress" || j === "quiver"));
    if (nextJob) {
      await step(nextJob, () => runJob(nextJob));
      const r: any = out[nextJob];
      // transcripts reads a few calls per tick; it is done for the day once a pass finds nothing left to check
      if (nextJob !== "transcripts" || r?.error || !r?.checked) dd.done.push(nextJob);
      await kvSet("daily_done", dd);
    }
  }
  if (n.mins >= 975 && !dd.done.includes("settle")) { dd.done.push("settle"); await kvSet("daily_done", dd); await step("settle", O.settleExpired); }
  if (n.mins >= 1025 && tradingDay() && !dd.done.includes("perf")) { dd.done.push("perf"); await kvSet("daily_done", dd); await step("perf", P.lockAll); }
  await kvSet("last_tick", { at: new Date().toISOString(), ms: Date.now() - t0, out });
  return out;
}

// ---------------------------------------------------------------- HTTP
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const cors: Record<string, string> = ORIGINS.some((r) => r.test(origin))
    ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Max-Age": "86400" } : {};
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (origin && !cors["Access-Control-Allow-Origin"]) return new Response(JSON.stringify({ error: "Not allowed." }), { status: 403 });
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { body = {}; } }
  try {
    const parts = url.pathname.replace(/^\/(functions\/v1\/)?odesa-api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const data = await route({ req, body, q: url.searchParams, parts });
    return new Response(JSON.stringify(data ?? null), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof BudgetExceeded ? 402 : e instanceof SourceError ? 502 : 400;
    const msg = (e as Error).message || "Something went wrong.";
    if (!(e instanceof HttpError)) console.error(url.pathname, msg);
    return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
