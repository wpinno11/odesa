// Model track record: every model starts with a hypothetical $1,000,000 on the day it is created and earns the
// weighted daily return of its holdings (rebalanced to target each day). Each finished trading day is written once
// and never recalculated, so editing a model only changes the future. Also: comparisons, backtests and model stats.
import { sql, kvGet } from "./db.ts";
import { MD, UW, ROIC, grokJson, GROK_FAST } from "./feeds.ts";
import { etNow, marketOpen, tradingDay } from "./core.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const bg = (p: Promise<unknown>) => { const q = p.catch(() => {}); try { EdgeRuntime?.waitUntil(q); } catch (_) { /* local */ } };

export const START = 1_000_000;
const LOCK_MINS = 17 * 60;            // a day's closing prices are treated as final after 5:00 pm ET
type H = { t: string; w: number; cash?: boolean; n?: string };

// ---------------------------------------------------------------- dates (Eastern time)
const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const noonET = (d: string) => new Date(d + "T17:00:00Z");
function etInstant(date: string, mins: number) {
  const [y, mo, d] = date.split("-").map(Number);
  for (const off of [4, 5]) { const t = new Date(Date.UTC(y, mo - 1, d) + (mins + off * 60) * 60000); const n = etNow(t); if (n.date === date && n.mins === mins) return t; }
  return new Date(Date.UTC(y, mo - 1, d) + (mins + 300) * 60000);
}
const isTD = (d: string) => tradingDay(noonET(d));
function prevTD(d: string) { let x = addDays(d, -1); for (let i = 0; i < 10 && !isTD(x); i++) x = addDays(x, -1); return x; }
/** Last trading day whose close is final. */
function lastFinal() { const n = etNow(); return tradingDay() && n.mins >= LOCK_MINS ? n.date : prevTD(n.date); }
/** The close a model's record starts from: before 9:30 on a trading day, the prior close; otherwise the latest close. */
function baseFor(created: Date) {
  const n = etNow(created);
  if (isTD(n.date) && n.mins >= 570) return n.date;
  return isTD(n.date) ? prevTD(n.date) : prevTD(addDays(n.date, 1));
}
async function cashDaily() { const s = await kvGet<any>("settings", {}); const y = Number(s.cash_yield_pct ?? 4) / 100; return { y, d: Math.pow(1 + y, 1 / 252) - 1 }; }

// ---------------------------------------------------------------- daily returns per ticker
async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>) {
  const q = [...items]; await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await f(q.shift()!); }));
}
/** Makes sure daily returns exist for each ticker from `need` through the last final close. */
export async function ensureRets(tickers: string[], need: string) {
  const tks = [...new Set(tickers.map((t) => t.toUpperCase()))].filter(Boolean); if (!tks.length) return { failed: [] as string[] };
  const last = lastFinal(), today = etNow().date;
  const meta = Object.fromEntries((await sql`select * from odesa.px_meta where t = any(${sql.array(tks)})`).map((r: any) => [r.t, r]));
  const iso = (v: any) => v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null;
  const todo = tks.filter((t) => { const m = meta[t]; if (!m) return true;
    const fr = iso(m.from_req), ld = iso(m.last_d), up = m.updated_at ? new Date(m.updated_at).getTime() : 0;
    const stale = (!ld || ld < last) && Date.now() - up > 15 * 60000;   // re-ask at most every 15 minutes
    return (!fr || fr > need) || stale; });
  const failed: string[] = [];
  await pool(todo, 5, async (t) => {
    const m = meta[t]; const fr = iso(m?.from_req), ld = iso(m?.last_d);
    const from = addDays(!fr || fr > need ? need : (ld ?? need), -7);
    try {
      const c = await MD.candlesFrom(t, from);
      const byD = new Map<string, number>();
      for (const k of c) { const d = etNow(new Date(Number(k.t) * 1000)).date; const px = Number(k.c);
        if (!(px > 0) || d > today || (d === today && d > last)) continue; byD.set(d, px); }
      const ds = [...byD.keys()].sort(); const rows: any[] = [];
      for (let i = 1; i < ds.length; i++) rows.push({ t, d: ds[i], r: byD.get(ds[i])! / byD.get(ds[i - 1])! - 1 });
      for (let i = 0; i < rows.length; i += 500) { const ch = rows.slice(i, i + 500); await sql`insert into odesa.rets ${sql(ch, "t", "d", "r")} on conflict do nothing`; }
      const first = rows[0]?.d ?? null, lastD = rows.at(-1)?.d ?? null;
      await sql`insert into odesa.px_meta(t, first_d, last_d, from_req, updated_at) values (${t}, ${first}, ${lastD}, ${need}, now())
        on conflict (t) do update set first_d = least(odesa.px_meta.first_d, excluded.first_d), last_d = greatest(odesa.px_meta.last_d, excluded.last_d),
        from_req = least(odesa.px_meta.from_req, excluded.from_req), updated_at = now()`;
    } catch (_) { failed.push(t); await sql`insert into odesa.px_meta(t, updated_at) values (${t}, now()) on conflict (t) do update set updated_at = now()`; }
  });
  return { failed };
}
async function retMap(tickers: string[], from: string) {
  const rs = await sql`select t, d::text d, r from odesa.rets where t = any(${sql.array(tickers)}) and d > ${from}`;
  const m = new Map<string, number>(); for (const r of rs) m.set(r.t + "|" + r.d, Number(r.r)); return m;
}
async function lastDates(tickers: string[]) {
  return Object.fromEntries((await sql`select t, last_d::text l, first_d::text f from odesa.px_meta where t = any(${sql.array(tickers)})`).map((r: any) => [r.t, r]));
}
const nonCash = (h: H[]) => h.filter((x) => !x.cash).map((x) => x.t.toUpperCase());

// ---------------------------------------------------------------- the locked track record
async function weightLog(modelId: number): Promise<{ eff: Date; h: H[] }[]> {
  let W = await sql`select eff, holdings from odesa.model_weights where model_id = ${modelId} order by eff, id`;
  if (!W.length) {
    const [m] = await sql`select holdings, created_at from odesa.models where id = ${modelId}`; if (!m) return [];
    await sql`insert into odesa.model_weights(model_id, eff, holdings) values (${modelId}, ${m.created_at}, ${sql.json(m.holdings)})`;
    W = await sql`select eff, holdings from odesa.model_weights where model_id = ${modelId} order by eff, id`;
  }
  return W.map((w: any) => ({ eff: new Date(w.eff), h: w.holdings as H[] }));
}
/** Weights in force for a trading day: the latest saved before that day's 9:30 open. */
function weightsFor(W: { eff: Date; h: H[] }[], d: string) {
  const open = etInstant(d, 570).getTime(); let cur: H[] | null = null;
  for (const w of W) if (w.eff.getTime() <= open) cur = w.h; return cur;
}
function dayReturn(h: H[], d: string, R: Map<string, number>, cashD: number) {
  let r = 0; const missing: string[] = [];
  for (const x of h) { const w = x.w / 10000; if (x.cash) { r += w * cashD; continue; }
    const v = R.get(x.t.toUpperCase() + "|" + d); if (v === undefined) missing.push(x.t); else r += w * v; }
  return { r, missing };
}

/** Brings the locked record up to date and returns it. */
export async function track(modelId: number) {
  const [m] = await sql`select id, name, created_at, holdings, benchmark from odesa.models where id = ${modelId}`; if (!m) throw new Error("Model not found.");
  const W = await weightLog(modelId); const base = baseFor(W[0].eff);
  const allT: string[] = [...new Set<string>(W.flatMap((w: any) => nonCash(w.h)))];
  const last = lastFinal();
  const stored = await sql`select d::text d, nav, ret, missing from odesa.model_nav where model_id = ${modelId} order by d`;
  let prev: { d: string; nav: number } = stored.length ? { d: stored.at(-1).d, nav: Number(stored.at(-1).nav) } : { d: base, nav: START };
  if (prev.d < last) {
    await ensureRets(["SPY", ...allT], addDays(prev.d, -3));
    const days = (await sql`select d::text d from odesa.rets where t = 'SPY' and d > ${prev.d} and d <= ${last} order by d`).map((r: any) => r.d);
    const R = await retMap(allT, prev.d); const L = await lastDates(allT); const { d: cashD } = await cashDaily();
    for (const d of days) {
      const h = weightsFor(W, d); if (!h) { prev = { d, nav: prev.nav }; continue; }
      // wait for any holding whose prices haven't come in for this day yet (don't lock a guess)
      const waiting = nonCash(h).some((t) => !R.has(t + "|" + d) && !!L[t]?.l && L[t].l < d && d >= addDays(last, -6));
      if (waiting) break;
      const { r, missing } = dayReturn(h, d, R, cashD);
      const nav = prev.nav * (1 + r);
      await sql`insert into odesa.model_nav(model_id, d, nav, ret, missing) values (${modelId}, ${d}, ${nav}, ${r}, ${sql.array(missing)}) on conflict do nothing`;
      prev = { d, nav };
    }
  }
  const rows = await sql`select d::text d, nav, ret, missing from odesa.model_nav where model_id = ${modelId} order by d`;
  const points = [{ d: base, nav: START, ret: 0, start: true }, ...rows.map((r: any) => ({ d: r.d, nav: Number(r.nav), ret: Number(r.ret), missing: r.missing?.length ? r.missing : undefined }))];
  // live: today's move while it isn't locked yet
  const n = etNow(); let live: any = null;
  const lastLocked = points.at(-1)!;
  if (tradingDay() && n.mins >= 570 && lastLocked.d < n.date) {
    const h = weightsFor(W, n.date);
    if (h) {
      const q = await MD.quotes(nonCash(h)).catch(() => ({} as any)); const { d: cashD } = await cashDaily();
      let r = 0; const missing: string[] = [];
      for (const x of h) { const w = x.w / 10000; if (x.cash) { r += w * cashD; continue; } const c = q[x.t.toUpperCase()]?.changepct; if (c === null || c === undefined) missing.push(x.t); else r += w * Number(c); }
      // if yesterday isn't locked yet either, today's move is measured from yesterday's estimated close
      live = { d: n.date, nav: lastLocked.nav * (1 + r), ret: r, at: new Date().toISOString(), missing: missing.length ? missing : undefined, open: marketOpen() };
    }
  }
  const changes = W.slice(1).map((w: any) => ({ at: w.eff.toISOString(), n: w.h.length }));
  return { id: m.id, name: m.name, benchmark: m.benchmark || "SPY", inception: W[0].eff.toISOString(), base, points, live, changes,
    market_open: marketOpen(), trading_day: tradingDay(), now_mins: n.mins };
}

// ---------------------------------------------------------------- today's line (5-minute steps)
const _intra = new Map<number, { at: number; v: any }>();
export async function intraday(modelId: number) {
  const c = _intra.get(modelId); if (c && Date.now() - c.at < 120000) return c.v;
  const W = await weightLog(modelId); const n = etNow();
  const day = tradingDay() && n.mins >= 570 ? n.date : null;
  if (!day) { const v = { points: [], day: null }; _intra.set(modelId, { at: Date.now(), v }); return v; }
  const h = weightsFor(W, day) ?? []; const tks = nonCash(h);
  const q = await MD.quotes(tks).catch(() => ({} as any)); const { d: cashD } = await cashDaily();
  const series: Record<string, [number, number][]> = {};
  await pool(tks, 6, async (t) => { try { series[t] = (await MD.candlesFrom(t, day, "5")).map((k: any) => [Number(k.t), Number(k.c)] as [number, number]).filter((x) => x[1] > 0)
    .filter((x) => etNow(new Date(x[0] * 1000)).date === day); } catch (_) { series[t] = []; } });
  const times = [...new Set(Object.values(series).flatMap((s) => s.map((x) => x[0])))].sort((a, b) => a - b);
  const idx: Record<string, number> = {}; const lastPx: Record<string, number> = {};
  const points = times.map((ts) => {
    let r = 0;
    for (const x of h) { const w = x.w / 10000; if (x.cash) { r += w * cashD; continue; }
      const t = x.t.toUpperCase(), s = series[t] ?? []; let i = idx[t] ?? 0;
      while (i < s.length && s[i][0] <= ts) { lastPx[t] = s[i][1]; i++; } idx[t] = i;
      const qq = q[t]; const prev = qq && qq.last !== null && qq.change !== null ? Number(qq.last) - Number(qq.change) : null;
      if (prev && lastPx[t]) r += w * (lastPx[t] / prev - 1);
    }
    return { ts, r };
  });
  const v = { day, points }; _intra.set(modelId, { at: Date.now(), v }); return v;
}

// ---------------------------------------------------------------- comparisons and backtests
const BENCH: Record<string, string> = { SPY: "S&P 500", QQQ: "Nasdaq 100", DIA: "Dow 30", IWM: "Russell 2000" };
async function holdingsFor(vs: string, self: any): Promise<{ label: string; h: H[] } | null> {
  if (!vs) return null;
  if (vs === "current") return { label: `${self.name} (today's mix)`, h: self.holdings };
  if (vs.startsWith("model:")) { const [m] = await sql`select name, holdings from odesa.models where id = ${Number(vs.slice(6)) || 0}`; return m ? { label: m.name, h: m.holdings } : null; }
  const t = vs.toUpperCase(); if (!/^[A-Z.\-]{1,8}$/.test(t)) return null;
  return { label: BENCH[t] ?? t, h: [{ t, w: 10000 }] };
}
/** What a fixed mix would have done from a starting close, rebalanced to target daily. */
async function hypo(h: H[], base: string, liveToday: boolean) {
  const tks = nonCash(h); await ensureRets(["SPY", ...tks], addDays(base, -3));
  const last = lastFinal(); const days = (await sql`select d::text d from odesa.rets where t = 'SPY' and d > ${base} and d <= ${last} order by d`).map((r: any) => r.d);
  const R = await retMap(tks, base); const { d: cashD } = await cashDaily(); const L = await lastDates(tks);
  let nav = START; const pts: any[] = [{ d: base, nav, start: true }]; const late: Record<string, string> = {};
  for (const d of days) { const { r, missing } = dayReturn(h, d, R, cashD); for (const t of missing) if (L[t]?.f && L[t].f > d) late[t] = L[t].f; nav *= 1 + r; pts.push({ d, nav, ret: r }); }
  const n = etNow();
  if (liveToday && tradingDay() && n.mins >= 570 && pts.at(-1).d < n.date) {
    const q = await MD.quotes(tks).catch(() => ({} as any)); let r = 0;
    for (const x of h) { const w = x.w / 10000; if (x.cash) { r += w * cashD; continue; } const c = q[x.t.toUpperCase()]?.changepct; if (c !== null && c !== undefined) r += w * Number(c); }
    pts.push({ d: n.date, nav: nav * (1 + r), ret: r, live: true });
  }
  return { points: pts, notes: Object.entries(late).map(([t, f]) => `${t} has prices only from ${f}; it counts as flat before that.`) };
}
const WINDOWS: Record<string, number> = { "1M": 30, "3M": 91, "6M": 182, "1Y": 365, "3Y": 1096, "5Y": 1826 };
export async function compare(modelId: number, vs: string, win: string) {
  const [self] = await sql`select id, name, holdings from odesa.models where id = ${modelId}`; if (!self) throw new Error("Model not found.");
  const other = await holdingsFor(vs, self);
  if (!WINDOWS[win]) {                                           // since inception: the real record vs what the other mix would have done
    const t = await track(modelId);
    const pts = [...t.points, ...(t.live ? [{ ...t.live, live: true }] : [])];
    const b = other ? await hypo(other.h, t.base, true) : null;
    return { window: "since", base: t.base, a: { label: `${t.name} (actual)`, points: pts }, b: b && { label: other!.label, points: b.points }, notes: b?.notes ?? [] };
  }
  const base = prevTD(addDays(etNow().date, -WINDOWS[win] + 1));
  const a = await hypo(self.holdings, base, true); const b = other && vs !== "current" ? await hypo(other.h, base, true) : null;
  return { window: win, base, backtest: true, a: { label: `${self.name} (today's mix)`, points: a.points }, b: b && { label: other!.label, points: b.points }, notes: [...a.notes, ...(b?.notes ?? [])] };
}

// ---------------------------------------------------------------- stats
const n0 = (v: any) => { const x = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(x) ? null : x; };
function sizeOf(mc: number | null) { if (!mc) return "Unknown"; if (mc >= 200e9) return "Mega cap"; if (mc >= 10e9) return "Large cap"; if (mc >= 2e9) return "Mid cap"; if (mc >= 300e6) return "Small cap"; return "Micro cap"; }
let _fwdRunning = 0;
async function refreshForward(tks: string[]) {
  if (!tks.length || Date.now() - _fwdRunning < 5 * 60000) return; _fwdRunning = Date.now();
  try {
    const r = await grokJson(`Look up the CURRENT forward P/E (price divided by next-twelve-months or next-fiscal-year consensus EPS, as shown today on Yahoo Finance, WSJ, Zacks or similar) and the trailing P/E for each of these US tickers: ${tks.join(", ")}. ` +
      `For ETFs give the fund's forward and trailing P/E. Use null when a company has no positive forward estimate or you can't find it. Don't guess.`,
      `{"TICKER": {"fpe": 0, "pe": 0, "source": "site"}}`, { web: true, model: GROK_FAST, timeoutMs: 120000, maxTurns: 4 });
    const d = r.data && typeof r.data === "object" ? r.data : {};
    for (const t of tks) { const x = d[t] ?? d[t.toLowerCase()]; const fpe = n0(x?.fpe), pe = n0(x?.pe);
      const v = { fpe: fpe !== null && fpe > -2000 && fpe < 5000 ? fpe : null, pe: pe !== null && pe > -5000 && pe < 10000 ? pe : null, source: String(x?.source ?? "").slice(0, 40) };
      await sql`insert into odesa.fundamentals(t, fwd, fwd_at) values (${t}, ${sql.json(v)}, now()) on conflict (t) do update set fwd = excluded.fwd, fwd_at = now()`; }
  } finally { _fwdRunning = 0; }
}
/** Cached fundamentals per ticker: Unusual Whales daily, ROIC weekly, forward P/E weekly (in the background). */
export async function fundamentals(tickers: string[], wait = false) {
  const tks = [...new Set(tickers.map((t) => t.toUpperCase()))]; if (!tks.length) return {};
  const cur = Object.fromEntries((await sql`select * from odesa.fundamentals where t = any(${sql.array(tks)})`).map((r: any) => [r.t, r]));
  const old = (at: any, h: number) => !at || Date.now() - new Date(at).getTime() > h * 3600_000;
  const needUW = tks.filter((t) => old(cur[t]?.uw_at, 20));
  if (needUW.length) { try { const s = await UW.screener(needUW);
    for (const t of needUW) { const x = s[t]; if (!x) continue;
      const v = { sector: x.sector ?? null, industry: x.industry_type ?? null, mcap: n0(x.marketcap), beta: n0(x.beta), dy: n0(x.dividend_yield), short: n0(x.short_int),
        epsg: n0(x.eps_growth_4q), iv: n0(x.iv30d), rv: n0(x.realized_volatility), hi: n0(x.week_52_high), lo: n0(x.week_52_low), close: n0(x.close), y1: n0(x.one_year_perc),
        ytd: n0(x.ytd_perc), next_er: x.next_earnings_date ?? null, etf: x.issue_type ? !/common/i.test(String(x.issue_type)) : false, name: x.full_name ?? null };
      await sql`insert into odesa.fundamentals(t, uw, uw_at) values (${t}, ${sql.json(v)}, now()) on conflict (t) do update set uw = excluded.uw, uw_at = now()`; cur[t] = { ...(cur[t] ?? {}), t, uw: v }; } } catch (_) { /* keep cached */ } }
  const needRO = tks.filter((t) => old(cur[t]?.roic_at, 24 * 7) && !cur[t]?.uw?.etf).slice(0, wait ? 50 : 3);
  await pool(needRO, 1, async (t) => { try { const q = await ROIC.perShare(t);
    const v = q.length >= 4 ? { eps: q.slice(0, 4).reduce((s: number, x: any) => s + (n0(x.diluted_eps) ?? n0(x.eps) ?? 0), 0), rev: q.slice(0, 4).reduce((s: number, x: any) => s + (n0(x.revenue_per_sh) ?? 0), 0), asof: q[0].date }
      : { eps: null, rev: null, asof: null };
    await sql`insert into odesa.fundamentals(t, roic, roic_at) values (${t}, ${sql.json(v)}, now()) on conflict (t) do update set roic = excluded.roic, roic_at = now()`; cur[t] = { ...(cur[t] ?? {}), t, roic: v };
  } catch (e) { // a 404 means ROIC doesn't cover it (check again in a week); anything else is retried on the next pass
    if ((e as any)?.status === 404) await sql`insert into odesa.fundamentals(t, roic, roic_at) values (${t}, ${sql.json({ eps: null })}, now()) on conflict (t) do update set roic_at = now()`; } });
  const needFwd = tks.filter((t) => old(cur[t]?.fwd_at, 24 * 7));
  let fwd_pending = false;
  if (needFwd.length) { if (wait) await refreshForward(needFwd); else { fwd_pending = true; bg(refreshForward(needFwd)); } }
  if (wait && needFwd.length) Object.assign(cur, Object.fromEntries((await sql`select * from odesa.fundamentals where t = any(${sql.array(needFwd)})`).map((r: any) => [r.t, r])));
  return { rows: cur, fwd_pending };
}

function riskFrom(rets: number[], spy: number[], rf: number) {
  if (rets.length < 20) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  const vol = sd * Math.sqrt(252); const total = rets.reduce((a, r) => a * (1 + r), 1) - 1;
  const ann = Math.pow(1 + total, 252 / rets.length) - 1;
  let peak = 1, nav = 1, mdd = 0; for (const r of rets) { nav *= 1 + r; peak = Math.max(peak, nav); mdd = Math.min(mdd, nav / peak - 1); }
  const down = rets.filter((r) => r < 0); const dsd = Math.sqrt(down.reduce((a, b) => a + b * b, 0) / Math.max(1, rets.length)) * Math.sqrt(252);
  let beta = null, corr = null, up = null, dn = null;
  if (spy.length === rets.length) {
    const ms = spy.reduce((a, b) => a + b, 0) / spy.length; let cov = 0, vs = 0, vp = 0;
    for (let i = 0; i < rets.length; i++) { cov += (rets[i] - mean) * (spy[i] - ms); vs += (spy[i] - ms) ** 2; vp += (rets[i] - mean) ** 2; }
    beta = vs ? cov / vs : null; corr = vs && vp ? cov / Math.sqrt(vs * vp) : null;
    const u = spy.map((s, i) => [s, rets[i]]).filter(([s]) => s > 0), d = spy.map((s, i) => [s, rets[i]]).filter(([s]) => s < 0);
    const avg = (a: number[][], k: number) => a.reduce((x, y) => x + y[k], 0) / (a.length || 1);
    up = u.length ? avg(u, 1) / avg(u, 0) : null; dn = d.length ? avg(d, 1) / avg(d, 0) : null;
  }
  return { days: rets.length, ret: total, ann, vol, sharpe: vol ? (ann - rf) / vol : null, sortino: dsd ? (ann - rf) / dsd : null, mdd, beta, corr,
    up_capture: up, down_capture: dn, best: Math.max(...rets), worst: Math.min(...rets) };
}

export async function statsFor(h: H[], label: string, wait = false) {
  const tks = nonCash(h); const f = await fundamentals(tks, wait); const F: any = (f as any).rows ?? {};
  const q = await MD.quotes(tks).catch(() => ({} as any));
  const { y: rf } = await cashDaily();
  const per = h.map((x) => { const t = x.t.toUpperCase(), r = F[t] ?? {}, u = r.uw ?? {}, ro = r.roic ?? {}, fw = r.fwd ?? {};
    const px = n0(q[t]?.last) ?? u.close ?? null;
    const pe = x.cash ? null : ro.eps && px ? px / ro.eps : (fw.pe ?? null);
    const ps = !x.cash && ro.rev && px ? px / ro.rev : null;
    return { t, w: x.w, cash: !!x.cash, px, sector: x.cash ? "Cash" : u.etf ? "Funds & ETFs" : (u.sector || "Unknown"), size: x.cash ? "Cash" : u.etf ? "Fund" : sizeOf(u.mcap), mcap: u.mcap ?? null,
      pe, fpe: x.cash ? null : fw.fpe ?? null, ps, beta: x.cash ? 0 : u.beta ?? null, dy: x.cash ? rf : u.dy ?? null, short: u.short ?? null, epsg: u.epsg ?? null, iv: u.iv ?? null,
      next_er: u.next_er ?? null, y1: u.y1 ?? null, hi: u.hi ?? null, off_hi: px && u.hi ? px / u.hi - 1 : null };
  });
  const tot = h.reduce((s, x) => s + x.w, 0) || 1;
  const wavg = (k: string, inclCash = false) => { let s = 0, w = 0; for (const p of per) { const v = (p as any)[k]; if ((p.cash && !inclCash) || v === null || v === undefined) continue; s += p.w * v; w += p.w; } return w ? { v: s / w, cover: w / tot } : { v: null, cover: 0 }; };
  // P/E style ratios are averaged as earnings yields (the standard way), so one huge P/E can't swamp the result
  const wmed = (k: string) => { const xs = per.filter((p) => !p.cash && (p as any)[k] !== null && (p as any)[k] !== undefined).map((p) => [(p as any)[k], p.w] as [number, number]).sort((a, b) => a[0] - b[0]);
    const W = xs.reduce((s, x) => s + x[1], 0); let c = 0; for (const [v, w] of xs) { c += w; if (c >= W / 2) return { v, cover: W / tot }; } return { v: null, cover: 0 }; };
  const hmean = (k: string) => { let s = 0, w = 0, neg = 0; for (const p of per) { const v = (p as any)[k]; if (p.cash || v === null || v === 0) continue; s += p.w / v; w += p.w; if (v < 0) neg += p.w; }
    const ey = w ? s / w : null; return { v: ey && ey > 0 ? 1 / ey : null, cover: w / tot, neg: neg / tot }; };
  const group = (k: "sector" | "size") => { const m: Record<string, number> = {}; for (const p of per) m[p[k]] = (m[p[k]] ?? 0) + p.w; return Object.entries(m).map(([name, w]) => ({ name, w })).sort((a, b) => b.w - a.w); };
  const sorted = [...per].filter((p) => !p.cash).sort((a, b) => b.w - a.w);
  const soon = etNow().date, in14 = addDays(soon, 14);
  // risk: today's mix held over the past year
  const base = prevTD(addDays(soon, -364)); const hy = await hypo(h, base, false); const spyH = await hypo([{ t: "SPY", w: 10000 }], base, false);
  const rets = hy.points.slice(1).map((p: any) => p.ret), spy = spyH.points.slice(1).map((p: any) => p.ret);
  const risk = riskFrom(rets, spy.length === rets.length ? spy : [], rf);
  return {
    label, as_of: new Date().toISOString(), fwd_pending: (f as any).fwd_pending ?? false,
    valuation: { pe: hmean("pe"), fpe: hmean("fpe"), ps: hmean("ps"), dy: wavg("dy", true), epsg: wmed("epsg"), off_hi: wavg("off_hi") },
    mix: { sectors: group("sector"), sizes: group("size"), cash: per.filter((p) => p.cash).reduce((s, p) => s + p.w, 0) / tot, n: per.length,
      top5: sorted.slice(0, 5).reduce((s, p) => s + p.w, 0) / tot, eff_n: 1 / per.reduce((s, p) => s + (p.w / tot) ** 2, 0), mcap: wavg("mcap") },
    risk: { ...(risk ?? {}), beta_w: wavg("beta", true).v, iv: wavg("iv").v, short: wavg("short").v, rf, notes: hy.notes },
    earnings: per.filter((p) => p.next_er && p.next_er >= soon && p.next_er <= in14).map((p) => ({ t: p.t, d: p.next_er, w: p.w })).sort((a, b) => a.d < b.d ? -1 : 1),
    per,
  };
}
export async function stats(modelId: number, vs: string) {
  const [self] = await sql`select id, name, holdings from odesa.models where id = ${modelId}`; if (!self) throw new Error("Model not found.");
  const other = vs && vs !== "current" ? await holdingsFor(vs, self) : null;
  const [a, b] = await Promise.all([statsFor(self.holdings, self.name), other ? statsFor(other.h, other.label) : Promise.resolve(null)]);
  return { a, b };
}

/** Runs on every scheduler tick: fills in missing fundamentals a few at a time (ROIC limits how fast we can ask). */
export async function fillFundamentals() {
  const tks = [...new Set((await sql`select holdings from odesa.models`).flatMap((m: any) => nonCash(m.holdings ?? [])))];
  const fresh = new Set((await sql`select t from odesa.fundamentals where roic_at > now() - interval '7 days' and uw_at > now() - interval '20 hours' and fwd_at > now() - interval '7 days'`).map((r: any) => r.t));
  const todo = tks.filter((t) => !fresh.has(t)); if (!todo.length) return { ok: "all fresh" };
  await fundamentals(todo, false); return { checked: todo.length };
}
/** Called by the daily schedule after 5 pm: lock today's value for every model. */
export async function lockAll() {
  const ms = await sql`select id from odesa.models`; const out: Record<string, unknown> = {};
  for (const m of ms) { try { const t = await track(m.id); out[m.id] = t.points.at(-1)?.d; } catch (e) { out[m.id] = (e as Error).message; } }
  return out;
}
