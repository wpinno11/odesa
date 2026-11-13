// The bots: turn each feed into flags (odesa.signals), find overlap, and raise ideas. Run from the scheduled tick.
import { sql, kvGet, kvSet, event } from "./db.ts";
import { MD, UW, QV, ROIC, grokJson, GROK_FAST } from "./feeds.ts";
import { etNow } from "./core.ts";
import { notify } from "./push.ts";

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
      if (r.length) { ideas++; await event("idea", `${a.ticker}: ${money(a.premium)} ${bias} ${a.kind}s, $${a.strike} ${short(a.expiry)}`, "New options idea from flow", { idea_id: r[0].id });
        await notify(`${a.ticker} idea`, `${money(a.premium)} ${bias} ${a.kind}s, $${a.strike} ${short(a.expiry)}`, "#options"); }
    }
  }
  return { alerts: alerts.length, added, ideas, sneaky: await sneakyCalls() };
}

/** Quiet, steady call buying: OTM calls bought at the ask in pieces across 2+ days, 3+ prints, modest size, IV not elevated. */
export async function sneakyCalls() {
  const rows = await sql`select ticker, count(*)::int n, count(distinct date_trunc('day', ts))::int days, sum((detail->>'premium')::numeric)::float8 prem,
      avg((detail->>'iv')::numeric)::float8 iv, max(ts) last, array_agg(distinct (detail->>'strike')) strikes, max(detail->>'expiry') expiry
    from odesa.signals where src = 'F' and ts > now() - interval '7 days' and detail->>'kind' = 'call'
      and (detail->>'strike')::numeric > (detail->>'underlying')::numeric * 1.03 and (detail->>'premium')::numeric < 1500000
    group by ticker having count(*) >= 3 and count(distinct date_trunc('day', ts)) >= 2`;
  let n = 0;
  const wk = etNow().date.slice(0, 8);
  for (const r of rows) {
    if (r.iv && r.iv > 0.9) continue;
    const t = `${r.n} OTM call buys over ${r.days} days · ${money(r.prem)}`;
    if (await put("S", r.ticker, r.last, t, { prints: r.n, days: r.days, premium: r.prem, iv: r.iv, strikes: r.strikes, expiry: r.expiry }, Math.min(5, r.n / 2), `S:${r.ticker}:${wk}${Math.floor(r.n / 3)}`)) n++;
  }
  return n;
}

// ---------------------------------------------------------------- C: congress (UW)
export async function ingestCongress() {
  const trades = await UW.congress(150); let n = 0;
  for (const t of trades) {
    if (!t.ticker) continue;
    const who = `${t.chamber === "senate" ? "Sen." : "Rep."} ${t.member}`;
    const title = `${who} ${String(t.txn ?? "").toLowerCase().includes("sell") || String(t.txn ?? "").toLowerCase().includes("sale") ? "sold" : "bought"} ${t.amount ?? ""}`.trim();
    if (await put("C", t.ticker, t.filed ?? t.traded ?? new Date(), title, t, 2, `C:${t.pid}:${t.ticker}:${t.traded}:${t.txn}:${t.amount}`)) n++;
  }
  return n;
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
    const r = await grokJson(`Read this ${t} earnings call (FY${tr.year} Q${tr.quarter}, ${String(tr.date).slice(0, 10)}). Flag what an investor should notice. ` +
      `Count mentions of these key words: ${KEYWORDS.join(", ")}. Note tone changes vs. a normal call, anything management avoided, guidance changes and red or green flags. Plain English.\n\n${text}`,
      '{"tone":"better|same|worse","headline":"one line","flags":[{"kind":"green|red","text":"","quote":"<=20 words"}],"keywords":[{"word":"","count":0}],"guidance":"raised|held|cut|none"}',
      { model: GROK_FAST, timeoutMs: 90000 });
    if (!r.data) continue;
    const reds = (r.data.flags ?? []).filter((x: any) => x.kind === "red").length, greens = (r.data.flags ?? []).filter((x: any) => x.kind === "green").length;
    if (await put("T", t, tr.date, `${r.data.headline ?? "Earnings call read"}`.slice(0, 120), { ...r.data, year: tr.year, quarter: tr.quarter, date: tr.date }, 1 + Math.min(3, reds + greens) / 2, `T:${t}:${tr.date}`)) n++;
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

export async function notifyOverlaps() {
  const sent = await kvGet<Record<string, number>>("overlap_sent", {});
  for (const o of (await overlap(5)).filter((x) => x.count >= 3)) {
    const key = `${o.ticker}:${o.srcs.join("")}`;
    if (sent[key]) continue;
    sent[key] = Date.now();
    await event("overlap", `${o.ticker}: ${o.count} feeds agree (${o.srcs.map((s) => SRC_NAMES[s]).join(", ")})`, `Score ${o.score}`, { ticker: o.ticker });
    await notify(`${o.ticker}: ${o.count} feeds agree`, o.srcs.map((s) => SRC_NAMES[s]).join(" · "), `#signal/${o.ticker}`);
  }
  for (const [k, t] of Object.entries(sent)) if (Date.now() - t > 14 * 86400000) delete sent[k];
  await kvSet("overlap_sent", sent);
}
