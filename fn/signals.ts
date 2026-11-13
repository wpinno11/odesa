// The bots: turn each feed into flags (odesa.signals), find overlap, and raise ideas. Run from the scheduled tick.
import { sql, kvGet, kvSet, event } from "./db.ts";
import { MD, UW, QV, ROIC, grokJson, GROK_FAST } from "./feeds.ts";
import { etNow } from "./core.ts";
import { alert } from "./alerts.ts";
import { parse } from "npm:yaml@2.5.1";

export const SRC_NAMES: Record<string, string> = { F: "Flow", C: "Congress", X: "X trend", T: "Transcript", P: "Put sale", S: "Sneaky call", E: "Earnings IV", Q: "Lobbying & contracts" };
const money = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d: string) => { const [y, m, dd] = String(d).slice(0, 10).split("-").map(Number); return `${MON[m - 1]} ${dd}${y !== new Date().getFullYear() ? " " + y : ""}`; };

async function put(src: string, ticker: string, ts: string | Date, title: string, detail: unknown, strength: number, dedupe: string) {
  if (!ticker || !/^[A-Z0-9.\-]{1,12}$/.test(ticker)) return false;
  const r = await sql`insert into odesa.signals(src, ticker, ts, title, detail, strength, dedupe) values (${src}, ${ticker}, ${new Date(ts)}, ${title}, ${sql.json(detail as never)}, ${strength}, ${dedupe})
    on conflict (dedupe) do nothing returning id`;
  return r.length > 0;
}

/** Tickers the bots watch: model holdings + watchlist (+ extra). */
export async function universe(extra: string[] = []) {
  const m = await sql`select holdings from odesa.models`;
  const w = await sql`select ticker from odesa.watchlist order by sort`;
  const s = new Set<string>();
  for (const r of m) for (const h of (r.holdings as any[]) ?? []) if (h?.t && !h.cash) s.add(String(h.t).toUpperCase());
  for (const r of w) s.add(String(r.ticker).toUpperCase());
  for (const t of extra) s.add(t.toUpperCase());
  return [...s];
}

// ---------------------------------------------------------------- F: options flow (+ ideas), S: sneaky calls
export async function ingestFlow() {
  const alerts = await UW.flowAlerts({ min_premium: 250000, limit: 200 });
  const uni = new Set(await universe());
  let added = 0, ideas = 0;
  for (const a of alerts) {
    if (!a.ticker || a.side !== "bought" || !a.premium) continue;
    const bias = a.kind === "call" ? "bullish" : "bearish";
    const title = `${money(a.premium)} ${a.kind}s bought · $${a.strike} ${short(a.expiry)}`;
    if (await put("F", a.ticker, a.ts ?? new Date(), title, { ...a, bias }, a.premium / 1e6, `F:${a.id}`)) added++;
    const dte = (Date.parse(a.expiry) - Date.now()) / 86400000;
    if (uni.has(a.ticker) && a.premium >= 500000 && dte >= 14 && dte <= 400) {
      const key = `flow:${a.chain ?? `${a.ticker}${a.expiry}${a.kind}${a.strike}`}`;
      const r = await sql`insert into odesa.ideas(key, source, symbol, side, action, strike, expiry, thesis, meta)
        values (${key}, 'flow', ${a.ticker}, ${a.kind}, 'buy', ${a.strike}, ${a.expiry}, ${`${money(a.premium)} of ${a.kind}s bought at the ask (${bias}). ${a.sweep ? "Sweep. " : ""}${a.opening ? "Opening trades. " : ""}`.trim()},
        ${sql.json({ premium: a.premium, underlying: a.underlying, iv: a.iv, delta: a.delta, rule: a.rule } as never)}) on conflict (key) do nothing returning id`;
      if (r.length) { ideas++; await event("idea", `${a.ticker}: ${money(a.premium)} ${bias} ${a.kind}s, $${a.strike} ${short(a.expiry)}`, "New options idea from flow", { idea_id: r[0].id }); }
    }
    const u = flowScore(a, uni.has(a.ticker));
    if (u) await alert({ lane: "flow", ticker: a.ticker, score: u.score, bias, key: `flow:${a.id}`, px: a.underlying, url: `#research/${a.ticker}`,
      title: `${a.ticker}: unusual ${a.kind}s`, why: u.why, detail: { premium: a.premium, volume: a.volume, oi: a.oi, strike: a.strike, expiry: a.expiry } });
  }
  return { alerts: alerts.length, added, ideas, sneaky: await sneakyCalls() };
}

/** Very unusual options trade: bought at the ask, $500K+, volume 5x+ open interest, under 60 days, out of the money, not a spread or index hedge. */
function flowScore(a: any, mine: boolean) {
  if (a.side !== "bought" || !a.premium || a.premium < 500000 || a.multileg) return null;
  if ((a.issue_type === "ETF" || a.issue_type === "Index") && !mine) return null;
  const dte = (Date.parse(a.expiry) - Date.now()) / 86400000; if (!(dte >= 0 && dte <= 60)) return null;
  const otm = a.kind === "call" ? a.strike > a.underlying : a.strike < a.underlying; if (!otm || !a.underlying) return null;
  const ratio = a.oi ? a.volume / a.oi : a.volume >= 1000 ? 20 : 0; if (ratio < 5) return null;
  const er = a.next_earnings && Date.parse(a.next_earnings) >= Date.now() - 86400000 && Date.parse(a.next_earnings) <= Date.parse(a.expiry);
  let sc = 55 + Math.min(15, (ratio - 5) * 1.5 + 5) + (a.premium >= 2.5e6 ? 12 : a.premium >= 1e6 ? 8 : 3) + (a.sweep ? 7 : 0) + (a.opening ? 6 : 0) + (er ? 6 : 0) + (mine ? 6 : 0) + (dte <= 21 ? 3 : 0);
  const why = [`${ratio >= 20 && !a.oi ? "Brand-new contract" : `${ratio.toFixed(0)}× open interest`}`, `${money(a.premium)} of ${a.kind}s at the ask`, `$${a.strike} ${short(a.expiry)}`,
    a.sweep ? "swept" : "", a.opening ? "new positions" : "", er ? "before earnings" : "", mine ? "you own/watch it" : ""].filter(Boolean).join(" · ");
  return { score: sc, why };
}

/** Quiet, steady call buying: OTM calls bought at the ask in pieces across 2+ days, 3+ prints, modest size, IV not elevated. */
export async function sneakyCalls() {
  const rows = await sql`select ticker, count(*)::int n, count(distinct date_trunc('day', ts))::int days, sum((detail->>'premium')::numeric)::float8 prem,
      avg((detail->>'iv')::numeric)::float8 iv, max(ts) last, array_agg(distinct (detail->>'strike')) strikes, max(detail->>'expiry') expiry
    from odesa.signals where src = 'F' and ts > now() - interval '7 days' and detail->>'kind' = 'call'
      and (detail->>'strike')::numeric > (detail->>'underlying')::numeric * 1.03 and (detail->>'premium')::numeric < 1500000
    group by ticker having count(*) >= 3 and count(distinct date_trunc('day', ts)) >= 2`;
  let n = 0;
  const wk = etNow().date.slice(0, 8); const uni = new Set(await universe());
  for (const r of rows) {
    if (r.iv && r.iv > 0.9) continue;
    const t = `${r.n} OTM call buys over ${r.days} days · ${money(r.prem)}`;
    if (await put("S", r.ticker, r.last, t, { prints: r.n, days: r.days, premium: r.prem, iv: r.iv, strikes: r.strikes, expiry: r.expiry }, Math.min(5, r.n / 2), `S:${r.ticker}:${wk}${Math.floor(r.n / 3)}`)) {
      n++;
      if (r.n >= 4 && r.days >= 3) await alert({ lane: "overlay", ticker: r.ticker, score: 66 + 5 * Math.min(3, r.days - 2) + Math.min(6, r.n - 4) + (uni.has(r.ticker) ? 6 : 0), bias: "bullish",
        key: `ovl:sneaky:${r.ticker}:${wk}`, url: "#overlay", title: `${r.ticker}: someone is quietly buying calls`, why: `${r.n} out-of-the-money call buys over ${r.days} days · ${money(r.prem)} · options not yet pricey` });
    }
  }
  return n;
}

// ---------------------------------------------------------------- C: congress (UW) + committee match
// Committees (public data, refreshed weekly) mapped to the industries they oversee.
const COMMITTEES: Record<string, { name: string; sectors?: string[]; ind?: RegExp }> = {
  HSAS: { name: "Armed Services", ind: /aerospace|defense/i }, SSAS: { name: "Armed Services", ind: /aerospace|defense/i },
  HLIG: { name: "Intelligence", ind: /aerospace|defense|software|security|semiconductor/i }, SLIN: { name: "Intelligence", ind: /aerospace|defense|software|security|semiconductor/i },
  HSHM: { name: "Homeland Security", ind: /aerospace|defense|software|security/i }, SSGA: { name: "Homeland Security", ind: /aerospace|defense|software|security/i },
  HSFA: { name: "Foreign Affairs", ind: /aerospace|defense/i }, SSFR: { name: "Foreign Relations", ind: /aerospace|defense/i },
  HSAP: { name: "Appropriations", ind: /aerospace|defense/i }, SSAP: { name: "Appropriations", ind: /aerospace|defense/i },
  HSIF: { name: "Energy & Commerce", sectors: ["Energy", "Utilities", "Healthcare", "Communication Services", "Technology"] },
  SSEG: { name: "Energy & Natural Resources", sectors: ["Energy", "Utilities", "Basic Materials"] },
  HSII: { name: "Natural Resources", sectors: ["Energy", "Basic Materials"] }, SSEV: { name: "Environment & Public Works", sectors: ["Utilities", "Energy", "Basic Materials"], ind: /construction|engineering|waste/i },
  SSCM: { name: "Commerce, Science & Transportation", sectors: ["Communication Services", "Technology"], ind: /airline|railroad|trucking|aerospace|auto/i },
  HSPW: { name: "Transportation & Infrastructure", ind: /airline|railroad|trucking|marine|construction|engineering|auto/i },
  HSSY: { name: "Science, Space & Technology", sectors: ["Technology"], ind: /aerospace/i },
  HSBA: { name: "Financial Services", sectors: ["Financial Services", "Real Estate"] }, SSBK: { name: "Banking", sectors: ["Financial Services", "Real Estate"] },
  SSHR: { name: "Health, Education, Labor & Pensions", sectors: ["Healthcare"] }, SSFI: { name: "Finance", sectors: ["Healthcare", "Financial Services"] },
  HSWM: { name: "Ways & Means", sectors: ["Healthcare", "Financial Services"] }, HSVR: { name: "Veterans' Affairs", sectors: ["Healthcare"] }, SSVA: { name: "Veterans' Affairs", sectors: ["Healthcare"] },
  HSAG: { name: "Agriculture", sectors: ["Consumer Defensive"], ind: /farm|agricultur|fertilizer|food|tobacco/i }, SSAF: { name: "Agriculture", sectors: ["Consumer Defensive"], ind: /farm|agricultur|fertilizer|food|tobacco/i },
  HSJU: { name: "Judiciary", sectors: ["Communication Services"], ind: /internet|software|semiconductor/i }, SSJU: { name: "Judiciary", sectors: ["Communication Services"], ind: /internet|software|semiconductor/i },
};
const nameKey = (n: string) => { const w = String(n).toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z\s-]/g, " ").split(/\s+/).filter((x) => x.length > 1);
  return w.length ? `${w[0]}|${w[w.length - 1]}` : ""; };
async function committeeMap(): Promise<Record<string, { code: string; title?: string; chamber: string }[]>> {
  const c = await kvGet<any>("committees", null);
  if (c?.at && Date.now() - Date.parse(c.at) < 7 * 86400000) return c.map;
  const r = await fetch("https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml", { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return c?.map ?? {};
  const y = parse(await r.text()) as Record<string, any[]>; const map: Record<string, any[]> = {};
  for (const [code, members] of Object.entries(y)) {
    const top = code.slice(0, 4); if (!COMMITTEES[top]) continue;
    for (const m of members ?? []) { const k = nameKey(m.name); if (!k) continue;
      const list = map[k] ??= []; if (!list.find((x) => x.code === top)) list.push({ code: top, title: code.length === 4 ? m.title : undefined, chamber: top[0] === "S" ? "senate" : "house" });
      else if (code.length === 4 && m.title) list.find((x) => x.code === top).title = m.title; }
  }
  await kvSet("committees", { at: new Date().toISOString(), map }); return map;
}
const AMT = (s: string) => { const m = String(s ?? "").replace(/,/g, "").match(/\$(\d+)/g); return m ? Number(m[m.length - 1].slice(1)) : 0; };

export async function ingestCongress() {
  const trades = await UW.congress(150); let n = 0; const fresh: any[] = [];
  for (const t of trades) {
    if (!t.ticker) continue;
    const who = `${t.chamber === "senate" ? "Sen." : "Rep."} ${t.member}`;
    const sold = /sell|sale/i.test(String(t.txn ?? ""));
    const title = `${who} ${sold ? "sold" : "bought"} ${t.amount ?? ""}`.trim();
    if (await put("C", t.ticker, t.filed ?? t.traded ?? new Date(), title, t, 2, `C:${t.pid}:${t.ticker}:${t.traded}:${t.txn}:${t.amount}`)) { n++; fresh.push({ ...t, who, sold }); }
  }
  return { added: n, alerts: fresh.length ? await congressAlerts(fresh) : 0 };
}
async function congressAlerts(fresh: any[]) {
  const map = await committeeMap(); const uni = new Set(await universe()); let sent = 0;
  const tick = [...new Set(fresh.map((t) => String(t.ticker).toUpperCase()))];
  let scr: Record<string, any> = {}; try { scr = await UW.screener(tick); } catch { /* no sector, no match */ }
  for (const t of fresh) {
    const T = String(t.ticker).toUpperCase(), sc = scr[T] ?? {};
    const sector = String(sc.sector ?? ""), ind = String(sc.industry_type ?? sc.industry ?? "");
    const mine = (map[nameKey(t.member)] ?? []).filter((c) => c.chamber === t.chamber || !t.chamber);
    const hit = mine.filter((c) => { const d = COMMITTEES[c.code]; return (d.sectors ?? []).includes(sector) || (d.ind?.test(ind) ?? false); });
    if (!hit.length) continue;
    const amt = AMT(t.amount), opt = /option|call|put/i.test(String(t.notes ?? "") + String(t.txn ?? ""));
    const [cl] = await sql`select count(distinct detail->>'pid')::int n from odesa.signals where src = 'C' and ticker = ${T} and ts > now() - interval '30 days'
      and (detail->>'txn') ${t.sold ? sql`~* 'sell|sale'` : sql`!~* 'sell|sale'`}`;
    const [q] = await sql`select count(*)::int n from odesa.signals where src = 'Q' and ticker = ${T} and ts > now() - interval '45 days'`;
    const lead = hit.some((h) => /chair|ranking/i.test(h.title ?? ""));
    const score = 62 + 10 + (lead ? 5 : 0) + (amt > 250000 ? 10 : amt > 50000 ? 6 : amt > 15000 ? 2 : 0) + (opt ? 8 : 0) + (cl.n >= 2 ? 10 : 0) + (q.n ? 6 : 0) + (uni.has(T) ? 5 : 0) + (t.sold ? -4 : 0);
    const why = [`${hit.map((h) => (h.title ? h.title + ", " : "") + COMMITTEES[h.code].name).join(" & ")} oversees ${ind || sector}`, t.amount, opt ? "options" : "",
      cl.n >= 2 ? `${cl.n} members ${t.sold ? "sold" : "bought"} in 30 days` : "", q.n ? "recent contract or lobbying" : "", `traded ${short(t.traded ?? t.filed)}`].filter(Boolean).join(" · ");
    const r = await alert({ lane: "congress", ticker: T, score, bias: t.sold ? "bearish" : "bullish", offHours: true, key: `cong:${t.pid}:${T}:${t.traded}:${t.txn}`,
      title: `${t.who} ${t.sold ? "sold" : "bought"} ${T}`, why, detail: { member: t.member, committees: hit, amount: t.amount } });
    if ((r as any).buzzed) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------- Q: lobbying and government contracts (Quiver)
export async function ingestQuiver() {
  let n = 0;
  const since = Date.now() - 10 * 86400000;
  for (const c of await QV.contracts()) {
    if (!c.ticker || !c.amount || c.amount < 10_000_000 || Date.parse(c.date) < since) continue;
    if (await put("Q", c.ticker, c.date, `${money(c.amount)} contract · ${c.agency}`, { kind: "contract", ...c }, Math.min(5, c.amount / 1e8), `Qc:${c.ticker}:${c.date}:${c.amount}:${String(c.description).slice(0, 40)}`)) n++;
  }
  for (const l of await QV.lobbying()) {
    if (!l.ticker || !l.amount || l.amount < 250_000 || Date.parse(l.date) < since) continue;
    if (await put("Q", l.ticker, l.date, `${money(l.amount)} lobbying · ${l.issue.split(";")[0]}`, { kind: "lobbying", ...l }, Math.min(4, l.amount / 5e5), `Ql:${l.ticker}:${l.date}:${l.amount}:${l.registrant}`)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- X: one broad Grok sweep of X
export async function xSweep() {
  const today = await sql`select ticker, sum(strength)::float8 s from odesa.signals where src = 'F' and ts > now() - interval '1 day' group by ticker order by s desc limit 20`;
  const tickers = [...new Set([...(await universe()), ...today.map((r) => r.ticker as string)])].slice(0, 60);
  if (!tickers.length) return 0;
  const since = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const r = await grokJson(
    `Search X for posts from the last 24 hours about these US stocks: ${tickers.join(", ")}. Also include up to 5 other US tickers that are clearly trending on X right now for a market reason. ` +
    `Only include a ticker if discussion is clearly above its normal level. For each give: ticker, buzz (0-10, 10 = exceptional), tone (bull, bear or mixed), the main phrase people use, why in one plain sentence, and 1-2 post URLs.`,
    '[{"ticker":"","buzz":0,"tone":"","phrase":"","why":"","links":[""]}]', { x: true, fromDate: since, model: GROK_FAST, maxTurns: 3 });
  let n = 0; const block = `${etNow().date}:${Math.floor(etNow().mins / 120)}`;
  for (const x of Array.isArray(r.data) ? r.data : []) {
    const t = String(x?.ticker ?? "").toUpperCase().replace("$", "");
    if (!t || Number(x.buzz) < 6) continue;
    if (await put("X", t, new Date(), `X buzz ${x.buzz}/10 · ${x.tone} · “${String(x.phrase ?? "").slice(0, 60)}”`, { ...x, citations: r.citations.slice(0, 4) }, Number(x.buzz) / 2, `X:${t}:${block}`)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- T: earnings call transcripts (ROIC + Grok reads for key words and flags)
const KEYWORDS = ["pricing pressure", "price increases", "backlog", "capacity", "supply constraint", "power", "data center", "tariff", "demand softness",
  "guidance", "inventory", "layoffs", "share buyback", "AI", "margin", "competition", "China", "delays"];
export async function transcripts(limit = 3) {
  const seen = await kvGet<Record<string, string>>("transcripts_seen", {});
  const tickers = await universe(); let n = 0, checked = 0;
  for (const t of tickers) {
    if (checked >= limit) break;
    const last = seen[t];
    if (last && Date.now() - Date.parse(seen[`${t}:checked`] ?? "1970-01-01") < 3 * 86400000) continue;
    checked++;
    let tr: any; try { tr = await ROIC.latest(t); } catch { continue; }
    seen[`${t}:checked`] = new Date().toISOString();
    if (!tr?.content || !tr?.date || tr.date === last) continue;
    seen[t] = tr.date;
    if (Date.now() - Date.parse(tr.date) > 30 * 86400000) continue;
    const text = String(tr.content).slice(0, 90000);
    const rules = await kvGet<any>("call_rules", null); const words = rules?.phrases?.length ? rules.phrases.map((p: any) => p.phrase) : KEYWORDS;
    const r = await grokJson(`Read this ${t} earnings call (FY${tr.year} Q${tr.quarter}, ${String(tr.date).slice(0, 10)}). Flag what an investor should notice. ` +
      `Count mentions of these key words: ${words.join(", ")}.${rules?.text ? " Follow the manager's own rules below first." : ""} Note tone changes vs. a normal call, anything management avoided, guidance changes and red or green flags. Plain English.${rules?.text ? "\n\nMANAGER'S RULES:\n" + String(rules.text).slice(0, 8000) : ""}\n\n${text}`,
      '{"tone":"better|same|worse","headline":"one line","flags":[{"kind":"green|red","text":"","quote":"<=20 words"}],"keywords":[{"word":"","count":0}],"guidance":"raised|held|cut|none"}',
      { model: GROK_FAST, timeoutMs: 90000 });
    if (!r.data) continue;
    const reds = (r.data.flags ?? []).filter((x: any) => x.kind === "red").length, greens = (r.data.flags ?? []).filter((x: any) => x.kind === "green").length;
    if (await put("T", t, tr.date, `${r.data.headline ?? "Earnings call read"}`.slice(0, 120), { ...r.data, year: tr.year, quarter: tr.quarter, date: tr.date }, 1 + Math.min(3, reds + greens) / 2, `T:${t}:${tr.date}`)) n++;
    // have the full earnings breakdown ready before it's opened (skip if Grok Bot or an earlier run already covered this call)
    try { const have = await kvGet<any>(`call:${t}`, null); const d = String(tr.date).slice(0, 10);
      if (!(have?.status === "done" && have.call_date >= d) && have?.status !== "running") { const C = await import("./calls.ts"); await C.start(t); } } catch (_) { /* best effort */ }
  }
  await kvSet("transcripts_seen", seen);
  return { checked, added: n };
}

// ---------------------------------------------------------------- E: earnings implied move vs usual move
export async function earningsIV(limit = 25) {
  const tickers = await universe(); const out: any[] = []; let n = 0;
  for (const t of tickers.slice(0, limit)) {
    try {
      const hist = await UW.earnings(t);
      const next = hist.filter((e: any) => Date.parse(e.date) >= Date.now() - 86400000).sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date))[0];
      if (!next) continue;
      const days = Math.round((Date.parse(next.date) - Date.now()) / 86400000);
      if (days > 28) continue;
      const past = hist.filter((e: any) => e.move1d !== null && Date.parse(e.date) < Date.now()).sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 8);
      if (past.length < 4) continue;
      const usual = past.reduce((s: number, e: any) => s + Math.abs(e.move1d), 0) / past.length;
      const beat = past.filter((e: any) => e.expected !== null && Math.abs(e.move1d) > e.expected).length;
      let implied = next.expected, straddle: number | null = null, price: number | null = null;
      if (implied === null) {
        const exp = await MD.chain(t, { dte: Math.max(1, days + 2), strikeLimit: 1 });
        const c = exp.find((x: any) => x.side === "call"), p = exp.find((x: any) => x.side === "put");
        if (c && p && c.mid && p.mid && c.underlyingPrice) { straddle = (c.mid as number) + (p.mid as number); price = c.underlyingPrice as number; implied = straddle / price; }
      }
      if (!implied) continue;
      const ratio = implied / usual;
      const row = { ticker: t, date: next.date, time: next.time, days, implied, usual, ratio, beat, of: past.length, straddle, price, tag: ratio < 0.7 ? "cheap" : ratio > 1.3 ? "rich" : "fair" };
      out.push(row);
      if (row.tag !== "fair" && await put("E", t, new Date(), `${row.tag === "cheap" ? "Cheap" : "Rich"} into earnings · ±${(implied * 100).toFixed(1)}% priced vs ±${(usual * 100).toFixed(1)}% usual`, row, row.tag === "cheap" ? 3 : 2, `E:${t}:${next.date}:${row.tag}`)) n++;
    } catch { /* one ticker failing never stops the rest */ }
  }
  out.sort((a, b) => a.ratio - b.ratio);
  await kvSet("earnings_iv", { at: new Date().toISOString(), rows: out });
  return { rows: out.length, added: n };
}

// ---------------------------------------------------------------- P: put sales (IV rank high, strike under support)
export async function putSales(limit = 15) {
  const tickers = await universe(); const out: any[] = []; let n = 0;
  for (const t of tickers.slice(0, limit)) {
    try {
      const iv = await UW.ivRank(t); if (!iv?.rank || iv.rank < 50) continue;
      const ch = (await MD.chain(t, { side: "put", dte: 35, range: "otm", strikeLimit: 10 })).filter((o: any) => o.delta !== null && o.delta >= -0.32 && o.delta <= -0.15 && o.bid > 0);
      if (!ch.length) continue;
      const candles = await MD.candles(t, 60);
      const support = Math.min(...candles.slice(-50).map((c: any) => c.l as number));
      const best = ch.map((o: any) => ({ ...o, yield: (o.mid as number) / (o.strike as number), under: (o.strike as number) <= support * 1.02 }))
        .sort((a: any, b: any) => (Number(b.under) - Number(a.under)) || (b.yield - a.yield))[0];
      const exp = new Date((best.expiration as number) * 1000).toISOString().slice(0, 10);
      const row = { ticker: t, strike: best.strike, expiry: exp, dte: best.dte, mid: best.mid, bid: best.bid, ask: best.ask, delta: best.delta, yield: best.yield,
        annual: best.yield * 365 / Math.max(1, best.dte as number), support, under_support: best.under, iv_rank: iv.rank, price: best.underlyingPrice };
      out.push(row);
      if (best.yield >= 0.01 && await put("P", t, new Date(), `Sell $${best.strike} put ${short(exp)} · ${(best.yield * 100).toFixed(1)}% premium · IV rank ${Math.round(iv.rank)}`, row, 2, `P:${t}:${exp}:${best.strike}`)) {
        n++;
        const models = await sql`select 1 from odesa.models m, jsonb_array_elements(m.holdings) h where upper(h->>'t') = ${t} limit 1`;
        const sc = 58 + (models.length ? 10 : 0) + (best.under ? 6 : 0) + (iv.rank >= 70 ? 6 : iv.rank >= 60 ? 3 : 0) + (best.yield >= 0.02 ? 6 : best.yield >= 0.015 ? 3 : 0);
        await alert({ lane: "overlay", ticker: t, score: sc, bias: "bullish", key: `ovl:put:${t}:${exp}:${best.strike}`, url: "#options",
          title: `${t}: sell the $${best.strike} put`, why: `${(best.yield * 100).toFixed(1)}% for ${best.dte} days · IV rank ${Math.round(iv.rank)}${best.under ? " · strike below 50-day support" : ""}${models.length ? " · in your models" : ""}` });
        await sql`insert into odesa.ideas(key, source, symbol, side, action, strike, expiry, target_pct, stop_pct, thesis, meta)
          values (${`putsale:${t}:${exp}:${best.strike}`}, 'put_sale', ${t}, 'put', 'sell', ${best.strike}, ${exp}, 50, 100,
          ${`Sell the $${best.strike} put: ${(best.yield * 100).toFixed(1)}% premium for ${best.dte} days, IV rank ${Math.round(iv.rank)}${best.under ? ", strike below 50-day support" : ""}.`},
          ${sql.json(row as never)}) on conflict (key) do nothing`;
      }
    } catch { /* skip */ }
  }
  out.sort((a, b) => b.yield - a.yield);
  await kvSet("put_sales", { at: new Date().toISOString(), rows: out });
  return { rows: out.length, added: n };
}

// ---------------------------------------------------------------- overlap scoring
export async function overlap(days = 7, limit = 40) {
  const rows = await sql`select ticker, array_agg(distinct src) srcs, count(*)::int n, sum(strength)::float8 s, max(ts) last,
      jsonb_agg(jsonb_build_object('src', src, 'title', title, 'ts', ts, 'id', id) order by ts desc) items
    from odesa.signals where ts > now() - make_interval(days => ${days}) group by ticker`;
  return rows.map((r: any) => {
    const k = (r.srcs as string[]).length, hours = (Date.now() - new Date(r.last).getTime()) / 3600000;
    const score = Math.round(Math.min(100, k * 22 + Math.min(14, r.s * 2) + (hours < 24 ? 8 : hours < 72 ? 4 : 0)));
    return { ticker: r.ticker, srcs: (r.srcs as string[]).sort(), count: k, flags: r.n, score, last: r.last, items: (r.items as any[]).slice(0, 12) };
  }).sort((a, b) => b.count - a.count || b.score - a.score).slice(0, limit);
}

/** Signals coming together: 3+ independent kinds of source on one name within 48 hours (options flow, X, call reads, congress, contracts/lobbying, Opal). */
const FAMILY: Record<string, string> = { F: "options", S: "options", X: "X chatter", T: "call read", C: "congress", Q: "contracts/lobbying" };
export async function notifyOverlaps() {
  const rows = await sql`select ticker, src, count(*)::int n, sum(case when src = 'F' then (detail->>'premium')::numeric else 0 end)::float8 prem,
      sum(case when src = 'F' and detail->>'kind' = 'call' then (detail->>'premium')::numeric else 0 end)::float8 cprem,
      string_agg(case when src = 'X' then detail->>'tone' end, ',') tones
    from odesa.signals where ts > now() - interval '48 hours' and src in ('F','S','X','T','C','Q') group by ticker, src`;
  const opal = await sql`select result->'tickers' tk from odesa.opal_runs where status = 'done' and created_at > now() - interval '48 hours'`;
  const by: Record<string, { fam: Set<string>; prem: number; cprem: number; tones: string }> = {};
  for (const r of rows) {
    const b = by[r.ticker as string] ??= { fam: new Set(), prem: 0, cprem: 0, tones: "" };
    if (r.src === "F") { b.prem += r.prem; b.cprem += r.cprem; if (r.prem < 1e6) continue; }
    b.fam.add(FAMILY[r.src as string]); if (r.tones) b.tones += "," + r.tones;
  }
  for (const r of opal) for (const t of Object.keys(r.tk ?? {})) (by[t.toUpperCase()] ??= { fam: new Set(), prem: 0, cprem: 0, tones: "" }).fam.add("Opal");
  const uni = new Set(await universe()); const day = etNow().date; let sent = 0;
  for (const [t, b] of Object.entries(by)) {
    if (b.fam.size < 3) continue;
    const flowBias = b.prem ? (b.cprem / b.prem > 0.65 ? "bullish" : b.cprem / b.prem < 0.35 ? "bearish" : null) : null;
    const xBias = /bull/.test(b.tones) && !/bear/.test(b.tones) ? "bullish" : /bear/.test(b.tones) && !/bull/.test(b.tones) ? "bearish" : null;
    const clash = flowBias && xBias && flowBias !== xBias;
    const score = 50 + 10 * b.fam.size + (uni.has(t) ? 5 : 0) + (clash ? -8 : 0);
    const fams = [...b.fam].sort();
    const r = await alert({ lane: "converge", ticker: t, score, bias: (flowBias ?? xBias ?? "neutral") as any, key: `conv:${t}:${day}:${fams.join("+")}`,
      title: `${t}: ${b.fam.size} kinds of signal agree`, why: `${fams.join(" + ")} in the last 48 hours${b.prem ? ` · ${money(b.prem)} of options` : ""}${clash ? " · flow and X disagree on direction" : ""}`, url: `#signal/${t}` });
    if ((r as any).buzzed) sent++;
  }
  return sent;
}

/** Warning signs stacking on names you own or watch: insider selling, big put buying, short interest rising, guidance cut or severe call flag, break below the 200-day. */
export async function warnings(only?: string) {
  const models = await sql`select holdings from odesa.models`; const owned = new Set<string>();
  for (const m of models) for (const h of (m.holdings as any[]) ?? []) if (h?.t && !h.cash) owned.add(String(h.t).toUpperCase());
  const names = only ? [only.toUpperCase()] : await universe();
  const hist = await kvGet<Record<string, { d: string; v: number }[]>>("short_hist", {});
  let scr: Record<string, any> = {}; try { scr = await UW.screener(names); } catch { /* skip that check */ }
  const today = etNow().date; let sent = 0;
  for (const t of names) {
    try {
      const w: { k: string; why: string; severe?: boolean }[] = [];
      const [pb] = await sql`select coalesce(sum((detail->>'premium')::numeric), 0)::float8 p from odesa.signals where src = 'F' and ticker = ${t} and ts > now() - interval '5 days' and detail->>'kind' = 'put' and detail->>'side' = 'bought'`;
      if (pb.p >= 1e6) w.push({ k: "puts", why: `${money(pb.p)} of puts bought in 5 days` });
      const ins = await UW.raw("/api/insider/transactions", { ticker_symbol: t, limit: 40 }).catch(() => []);
      const sells = (Array.isArray(ins) ? ins : []).filter((x: any) => String(x.ticker ?? t).toUpperCase() === t && (x.transaction_code === "S" || x.code === "S")
        && Date.parse(x.transaction_date ?? x.filing_date ?? 0) > Date.now() - 30 * 86400000);
      const sellers = new Set(sells.map((x: any) => x.owner_name ?? x.insider_name ?? x.name)); const sellAmt = sells.reduce((s: number, x: any) => s + Math.abs(Number(x.amount ?? 0) * Number(x.price ?? x.stock_price ?? 0) || 0), 0);
      if (sellers.size >= 2 || sellAmt >= 5e6) w.push({ k: "insiders", why: `${sellers.size} insider${sellers.size === 1 ? "" : "s"} sold${sellAmt ? ` ${money(sellAmt)}` : ""} in 30 days` });
      const si = Number(scr[t]?.short_int ?? scr[t]?.short_interest ?? NaN);
      if (Number.isFinite(si)) { const h = hist[t] ??= []; if (h[h.length - 1]?.d !== today) h.push({ d: today, v: si }); hist[t] = h.slice(-40);
        const old = h.find((x) => Date.parse(today) - Date.parse(x.d) >= 12 * 86400000 && Date.parse(today) - Date.parse(x.d) <= 30 * 86400000);
        const pct = si < 1 ? si * 100 : si; const oldPct = old ? (old.v < 1 ? old.v * 100 : old.v) : null;
        if (oldPct && pct >= 3 && pct >= oldPct * 1.2) w.push({ k: "short", why: `short interest up to ${pct.toFixed(1)}% from ${oldPct.toFixed(1)}%` }); }
      const tr = await sql`select title, detail from odesa.signals where src = 'T' and ticker = ${t} and ts > now() - interval '14 days'`;
      const bad = tr.find((x: any) => x.detail?.guidance === "cut" || Number(x.detail?.severity ?? 0) >= 4);
      const card = await kvGet<any>(`call:${t}`, null);
      const sev = card?.status === "done" && card.call_date && Date.parse(card.call_date) > Date.now() - 14 * 86400000
        ? (card.result?.flags ?? []).filter((f: any) => (f.kind ?? "constraint").startsWith("constraint") && Number(f.severity) >= 4) : [];
      const cut = card?.status === "done" && (card.result?.guidance ?? []).some((g: any) => g.direction === "cut") && Date.parse(card.call_date ?? 0) > Date.now() - 14 * 86400000;
      if (bad || sev.length || cut) w.push({ k: "call", severe: true, why: cut ? "guidance cut on the call" : sev.length ? `Call Surgeon: ${sev[0].tag ?? "severity " + sev[0].severity}` : String(bad.title).slice(0, 60) });
      const c = await MD.candles(t, 215).catch(() => []);
      if (c.length >= 205) { const sma = (end: number) => c.slice(end - 200, end).reduce((s: number, x: any) => s + x.c, 0) / 200;
        const now = c[c.length - 1].c, s0 = sma(c.length), wasAbove = c.slice(-10, -1).some((x: any, i: number) => x.c > sma(c.length - 9 + i));
        if (now < s0 && wasAbove) w.push({ k: "200d", why: `broke below its 200-day (${s0.toFixed(2)})` }); }
      if (w.length < 2) continue;
      const own = owned.has(t), severe = w.some((x) => x.severe);
      const score = 60 + 8 * w.length + (own ? 8 : 0) + (severe ? 6 : 0);
      const kinds = w.map((x) => x.k).sort().join("+");
      const r = await alert({ lane: "warning", ticker: t, score, bias: "bearish", offHours: severe, key: `warn:${t}:${kinds}:${today.slice(0, 7)}`,
        title: `${t}: ${w.length} warning signs${own ? " (you own it)" : ""}`, why: w.map((x) => x.why).join(" · "), detail: { warnings: w } });
      if ((r as any).buzzed) sent++;
    } catch { /* one name never stops the rest */ }
  }
  await kvSet("short_hist", hist);
  return { checked: names.length, sent };
}
