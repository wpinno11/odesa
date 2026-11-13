// Today screen and the one-stock research page.
import { sql, kvGet, kvSet } from "./db.ts";
import { MD, UW, SEC, grokJson, GROK_FAST, normFlow } from "./feeds.ts";
import { overlap } from "./signals.ts";
import { marketOpen } from "./core.ts";

const safe = async <T>(p: Promise<T>, d: T): Promise<T> => { try { return await p; } catch { return d; } };

export async function today() {
  const s = await kvGet<any>("settings", {});
  const pulse: string[] = s.pulse ?? ["SPY", "QQQ", "DIA", "IWM", "TLT", "GLD"];
  const [quotes, ov, events, ideas, open, eiv, models] = await Promise.all([
    safe(MD.quotes(pulse), {} as Record<string, any>), safe(overlap(5, 8), []),
    sql`select * from odesa.events order by ts desc limit 15`, sql`select count(*)::int n from odesa.ideas where status = 'new'`,
    sql`select count(*)::int n from odesa.positions where status = 'open'`, kvGet<any>("earnings_iv", { rows: [] }), sql`select id, name, holdings from odesa.models order by sort, id`,
  ]);
  return { market_open: marketOpen(), pulse: pulse.map((t) => ({ t, ...(quotes[t] ?? {}) })), overlaps: ov.filter((o: any) => o.count >= 2).slice(0, 5),
    events, new_ideas: ideas[0].n, open_trades: open[0].n, earnings: (eiv.rows ?? []).filter((r: any) => r.tag !== "fair").slice(0, 4),
    models: models.map((m: any) => ({ id: m.id, name: m.name, holdings: (m.holdings ?? []).length })) };
}

export async function stock(t: string) {
  t = t.toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  if (!t) throw new Error("Enter a ticker.");
  const [q, candles, info, iv, earn, sig, models, filings] = await Promise.all([
    safe(MD.quotes([t]), {} as Record<string, any>), safe(MD.candles(t, 260), [] as any[]), safe(UW.info(t), null), safe(UW.ivRank(t), null),
    safe(UW.earnings(t), [] as any[]), sql`select * from odesa.signals where ticker = ${t} and ts > now() - interval '30 days' order by ts desc limit 40`,
    sql`select id, name, holdings from odesa.models`, safe(SEC.filings(t, ["8-K", "10-K", "10-Q", "4"], 6), [] as any[]),
  ]);
  const past = earn.filter((e: any) => e.move1d !== null && Date.parse(e.date) < Date.now()).slice(0, 8);
  const next = earn.filter((e: any) => Date.parse(e.date) >= Date.now() - 86400000).sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date))[0] ?? null;
  const usual = past.length ? past.reduce((s: number, e: any) => s + Math.abs(e.move1d), 0) / past.length : null;
  const inModels = models.map((m: any) => { const h = (m.holdings ?? []).find((x: any) => String(x.t).toUpperCase() === t); return h ? { model: m.name, id: m.id, target_bps: h.w } : null; }).filter(Boolean);
  const ov = (await overlap(14, 300)).find((o) => o.ticker === t) ?? null;
  const summary = await kvGet<any>(`sum:${t}`, null);
  return { ticker: t, quote: q[t] ?? null, candles: candles.map((c: any) => [c.t, c.c]), info, iv, next_earnings: next, usual_move: usual, past_earnings: past,
    signals: sig, overlap: ov, models: inModels, filings, summary: summary && Date.now() - Date.parse(summary.at) < 6 * 3600000 ? summary : null };
}

export async function summary(t: string, force = false) {
  t = t.toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  const c = await kvGet<any>(`sum:${t}`, null);
  if (c && !force && Date.now() - Date.parse(c.at) < 6 * 3600000) return c;
  const r = await grokJson(`What is being said right now about ${t}? Search X and the web (last 7 days). Give three short items: what's trending on X, the latest news, and anything from the last earnings call. Plain English, numbers where real.`,
    '{"x":"<=30 words","news":"<=30 words","call":"<=30 words","tone":"bull|bear|mixed"}',
    { x: true, web: true, fromDate: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), model: GROK_FAST, maxTurns: 3 });
  const out = { at: new Date().toISOString(), ...(r.data ?? {}), citations: r.citations.slice(0, 6), cost: r.cost };
  await kvSet(`sum:${t}`, out);
  return out;
}

// ---------------------------------------------------------------- Research profile: one uniform page for any stock or fund
import { ROIC, SEC as SEC2 } from "./feeds.ts";
import { fundamentals } from "./perf.ts";
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const bgRun = (p: Promise<unknown>) => { const q = p.catch(() => {}); try { EdgeRuntime?.waitUntil(q); } catch (_) { /* local */ } };
const nn = (v: any) => { const x = Number(v); return v === null || v === undefined || v === "" || !Number.isFinite(x) ? null : x; };
const dOf = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
const yearsAgo = (y: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };
const pick = (o: any, ...ks: string[]) => { for (const k of ks) if (o?.[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return null; };

const _px = new Map<string, { at: number; v: [string, number][] }>();
async function closes(t: string): Promise<[string, number][]> {
  const c = _px.get(t); if (c && Date.now() - c.at < 30 * 60000) return c.v;
  const rows = await MD.candlesFrom(t, yearsAgo(10) );
  let v = rows.map((k: any) => [dOf(Number(k.t)), Number(k.c)] as [string, number]).filter((x) => x[1] > 0);
  // a ticker can be reused by a new company: start after the last long gap in trading (more than 3 weeks)
  for (let i = v.length - 1; i > 0; i--) if (Date.parse(v[i][0]) - Date.parse(v[i - 1][0]) > 21 * 86400000) { v = v.slice(i); break; }
  _px.set(t, { at: Date.now(), v }); return v;
}
function retOver(px: [string, number][], years: number) {
  if (px.length < 2) return null; const cut = yearsAgo(years); if (px[0][0] > cut) return null;
  let i = 0; for (let k = 0; k < px.length; k++) if (px[k][0] <= cut) i = k;
  const tot = px[px.length - 1][1] / px[i][1] - 1; return years > 1 ? Math.pow(1 + tot, 1 / years) - 1 : tot;
}
function thin(px: [string, number][]) { // daily for the last ~13 months, weekly before that
  const cut = yearsAgo(1.1); return px.filter((p, i) => p[0] >= cut || i % 5 === 0 || i === px.length - 1);
}

/** Quarterly results from ROIC per-share data (cached a day). */
async function financials(t: string) {
  const c = await kvGet<any>(`fin:${t}`, null); if (c && Date.now() - Date.parse(c.at) < 20 * 3600000) return c;
  const k = await (await import("./db.ts")).key("ROIC_API_KEY"); if (!k) return null;
  const { call } = await import("./net.ts");
  const r = await call("roic", `https://api.roic.ai/v2/fundamental/per-share/${encodeURIComponent(t)}?period=quarterly&limit=8&apikey=${encodeURIComponent(k)}`, { timeoutMs: 20000 });
  const q = (Array.isArray(r) ? r : []).map((x: any) => { const sh = nn(x.is_avg_num_sh_for_eps) ?? nn(x.bs_sh_out); const rps = nn(x.revenue_per_sh);
    return { date: x.date, label: `${x.period_label ?? ""} ${x.fiscal_year ?? ""}`.trim(), rev: rps !== null && sh ? rps * sh : null, eps: nn(x.diluted_eps) ?? nn(x.eps),
      opm: rps ? (nn(x.oper_inc_per_sh) ?? 0) / rps : null, fcf: nn(x.free_cash_flow_per_sh) !== null && sh ? nn(x.free_cash_flow_per_sh)! * sh : null,
      cash: nn(x.cash_st_investments_per_sh) !== null && nn(x.bs_sh_out) ? nn(x.cash_st_investments_per_sh)! * nn(x.bs_sh_out)! : null,
      bvps: nn(x.book_val_per_sh) }; }).sort((a: any, b: any) => a.date < b.date ? -1 : 1);
  const sum = (a: any[], k: string) => a.length === 4 && a.every((x) => x[k] !== null) ? a.reduce((s, x) => s + x[k], 0) : null;
  const last4 = q.slice(-4), prev4 = q.slice(-8, -4);
  const ttm = { rev: sum(last4, "rev"), rev_prev: sum(prev4, "rev"), eps: sum(last4, "eps"), fcf: sum(last4, "fcf") };
  const out = { at: new Date().toISOString(), quarters: q, ttm: { ...ttm, rev_g: ttm.rev && ttm.rev_prev ? ttm.rev / ttm.rev_prev - 1 : null,
    opm: last4.length ? last4.reduce((s: number, x: any) => s + (x.opm ?? 0) * (x.rev ?? 0), 0) / (sum(last4, "rev") || 1) : null }, cash: q.at(-1)?.cash ?? null };
  if (q.length) await kvSet(`fin:${t}`, out); return q.length ? out : null;
}

/** Analyst view, debt/margins and fund facts, gathered weekly from public sources by Grok (runs in the background). */
async function streetRefresh(t: string) {
  const run = await kvGet<number>(`street_run:${t}`, 0); if (Date.now() - run < 4 * 60000) return; await kvSet(`street_run:${t}`, Date.now());
  try {
    const r = await grokJson(`Research the US-listed security ${t} using today's public sources (Morningstar, Yahoo Finance, MarketBeat, TipRanks, CNBC, the company's or fund family's own site and prospectus). ` +
      `If it's a company: analyst consensus, number of analysts, average/high/low 12-month price target, and up to 8 of the most recent analyst rating or target changes (newest first), plus total debt (USD) and gross margin (trailing 12 months, as a decimal). ` +
      `If it's an ETF or mutual fund: fund family, Morningstar category, Morningstar star rating and medalist rating, category rank, risk rating; latest NAV and its date; ` +
      `expense ratio (net, percent), max front-end load, back-end/deferred load, 12b-1 fee, minimum initial investment, assets under management (USD), number of holdings, trailing yield, turnover, index tracked (if any), inception date; ` +
      `annualized total returns (percent) for 1, 3, 5 and 10 years for the fund and its category average; each current portfolio manager with the year they started on this fund, ` +
      `other funds they manage, and their typical investing style or what they tend to favor; top 10 holdings with weights; sector weights; and 3 to 5 similar funds an advisor would compare it with (ticker, name, one short reason). ` +
      `Percent values as plain numbers (0.59 means 0.59%). Use null for anything you can't verify. Don't guess.`,
      `{"name":"","kind":"stock|etf|mutual_fund|closed_end_fund","about":"one plain sentence on what it is or does","consensus":"Strong buy|Buy|Hold|Sell|Strong sell","analysts":0,"target_avg":0,"target_high":0,"target_low":0,
"recent":[{"firm":"","rating":"","action":"raised|lowered|maintained|upgraded|downgraded|initiated","from":0,"to":0,"date":"YYYY-MM-DD"}],"total_debt":0,"gross_margin":0,
"fund":{"family":"","category":"","stars":0,"medal":"Gold|Silver|Bronze|Neutral|Negative","category_rank":"","risk":"Low|Below average|Average|Above average|High","nav":0,"nav_date":"YYYY-MM-DD",
"expense_ratio":0,"front_load":0,"back_load":0,"b12_1":0,"min_investment":0,"aum":0,"holdings":0,"yield":0,"turnover":0,"index":"","asset_class":"","inception":"YYYY-MM-DD",
"returns":{"1Y":0,"3Y":0,"5Y":0,"10Y":0},"category_returns":{"1Y":0,"3Y":0,"5Y":0,"10Y":0},
"managers":[{"name":"","since":2010,"other_funds":["",""],"style":"short phrase"}],"style_note":"one or two sentences on the team's approach and what they tend to favor",
"top":[{"t":"","n":"","w":0}],"sectors":[{"name":"","w":0}],"peers":[{"t":"","n":"","why":""}]}}`,
      { web: true, model: GROK_FAST, maxTurns: 6, timeoutMs: 140000 });
    if (r.data && typeof r.data === "object") await kvSet(`street:${t}`, { at: new Date().toISOString(), ...r.data, citations: r.citations.slice(0, 6) });
  } finally { await kvSet(`street_run:${t}`, 0); }
}
export async function street(t: string) {
  t = t.toUpperCase(); const s = await kvGet<any>(`street:${t}`, null);
  const stale = !s || Date.now() - Date.parse(s.at) > 7 * 86400000;
  if (stale) bgRun(streetRefresh(t));
  return { street: s, pending: stale };
}

export async function profile(t: string) {
  t = t.toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12); if (!t) throw new Error("Enter a ticker.");
  const [q, px, spy, scr, info, fund, fin, st, sig, models, watch, flowA, cong, ins, filings, earn] = await Promise.all([
    safe(MD.quotes([t]), {} as any), safe(closes(t), [] as [string, number][]), safe(closes("SPY"), [] as [string, number][]),
    safe(UW.screener([t]), {} as any), safe(UW.info(t), null as any), safe(fundamentals([t]), { rows: {} } as any), safe(financials(t), null as any), street(t),
    sql`select src, ticker, ts, title, detail from odesa.signals where ticker = ${t} and ts > now() - interval '365 days' order by ts desc limit 60`,
    sql`select id, name, holdings from odesa.models order by sort, id`, sql`select 1 from odesa.watchlist where ticker = ${t}`,
    safe(UW.raw("/api/option-trades/flow-alerts", { ticker_symbol: t, limit: 30 }), [] as any), safe(UW.raw("/api/congress/recent-trades", { ticker: t, limit: 50 }), [] as any),
    safe(UW.raw("/api/insider/transactions", { ticker_symbol: t, limit: 30 }), [] as any), safe(SEC2.filings(t, ["8-K", "10-K", "10-Q", "4", "S-1", "424B4"], 6), [] as any[]),
    safe(UW.earnings(t), [] as any[]),
  ]);
  const qq = q[t] ?? null, sc = scr[t] ?? {}, F = (fund as any).rows?.[t] ?? {}, u = F.uw ?? {}, ro = F.roic ?? {}, fw = F.fwd ?? {};
  const last = nn(qq?.last) ?? px.at(-1)?.[1] ?? nn(st.street?.fund?.nav) ?? null;
  const isFund = !!(u.etf || /etf|fund|trust/i.test(String(info?.issue_type ?? sc.issue_type ?? "")) || /fund|etf/i.test(String(st.street?.kind ?? "")) || (!qq && /^[A-Z]{4}X$/.test(t)));
  const yr = px.filter((p) => p[0] >= yearsAgo(1)); const avg = (n: number) => px.length >= n ? px.slice(-n).reduce((s, p) => s + p[1], 0) / n : null;
  const range = { lo: yr.length ? Math.min(...yr.map((p) => p[1])) : nn(u.lo), hi: yr.length ? Math.max(...yr.map((p) => p[1])) : nn(u.hi), sma50: avg(50), sma200: avg(200), last };
  const R = (p: [string, number][]) => ({ "1Y": retOver(p, 1), "3Y": retOver(p, 3), "5Y": retOver(p, 5), "10Y": retOver(p, 10) });
  const alerts = (Array.isArray(flowA) ? flowA : []).map(normFlowSafe).filter((a: any) => String(a.ticker ?? "").toUpperCase() === t).slice(0, 8);
  const congress = (Array.isArray(cong) ? cong : []).filter((x: any) => String(pick(x, "ticker") ?? "").toUpperCase() === t).slice(0, 12).map((x: any) => ({
    who: pick(x, "name", "reporter"), chamber: pick(x, "member_type"), txn: pick(x, "txn_type"), amount: pick(x, "amounts"), traded: pick(x, "transaction_date"), filed: pick(x, "filed_at_date") }));
  const insiders = (Array.isArray(ins) ? ins : []).filter((x: any) => String(pick(x, "ticker", "ticker_symbol") ?? t).toUpperCase() === t).slice(0, 12).map((x: any) => {
    const code = String(pick(x, "transaction_code", "code") ?? ""); const amt = nn(pick(x, "amount", "shares", "transaction_shares"));
    return { who: pick(x, "owner_name", "insider_name", "name"), role: pick(x, "officer_title", "title", "relationship"), buy: code ? code === "P" : (amt ?? 0) > 0, code,
      shares: amt !== null ? Math.abs(amt) : null, price: nn(pick(x, "price", "transaction_price")), traded: pick(x, "transaction_date", "date"), filed: pick(x, "filing_date", "filed_at") }; });
  const gov = sig.filter((s: any) => s.src === "Q").slice(0, 8).map((s: any) => ({ ts: s.ts, title: s.title }));
  const calls = sig.filter((s: any) => s.src === "T").slice(0, 2).map((s: any) => ({ ts: s.ts, title: s.title, detail: s.detail }));
  const inModels = models.map((m: any) => { const h = (m.holdings ?? []).find((x: any) => String(x.t).toUpperCase() === t); return h ? { id: m.id, model: m.name, w: h.w } : null; }).filter(Boolean);
  const nextEr = earn.filter((e: any) => Date.parse(e.date) >= Date.now() - 86400000).sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date))[0]?.date ?? u.next_er ?? info?.next_earnings_date ?? null;
  const S = st.street ?? {};
  return {
    ticker: t, kind: isFund ? "fund" : "stock", name: S.name || info?.full_name || u.name || t, about: S.about ?? null, logo: info?.logo ?? null,
    sector: isFund ? (S.fund?.asset_class ?? "Fund") : (u.sector ?? info?.sector ?? null), industry: u.industry ?? null, mcap: nn(u.mcap) ?? nn(info?.marketcap),
    quote: qq, last, beta: nn(u.beta) ?? nn(info?.beta), pe: !isFund && ro.eps && last ? last / ro.eps : nn(fw.pe), fpe: nn(fw.fpe), dy: info?.has_dividend === false ? 0 : (px[0] && px[0][0] > yearsAgo(1) ? null : (nn(u.dy) ?? nn(sc.dividend_yield))),
    short: nn(u.short), next_er: nextEr, range,
    prices: thin(px), spy: thin(spy), returns: { t: R(px), spy: R(spy) }, history_from: px[0]?.[0] ?? null,
    fin: isFund ? null : fin, street: S.at ? S : null, street_pending: st.pending,
    flow: { pcr: nn(sc.put_call_ratio), callp: nn(sc.call_premium), putp: nn(sc.put_premium), bull: nn(sc.bullish_premium), bear: nn(sc.bearish_premium),
      ivr: nn(sc.iv_rank), iv: nn(sc.iv30d), move30: nn(sc.implied_move_perc_30), alerts },
    people: { congress, insiders, gov }, calls, filings, models: inModels, watch: watch.length > 0,
    as_of: new Date().toISOString(),
  };
}
function normFlowSafe(a: any) { try { return normFlow(a); } catch { return {}; } }

/** Search by ticker or company name. */
export async function search(q: string) {
  q = q.trim(); if (!q) return [];
  const out: any[] = []; const up = q.toUpperCase();
  if (/^[A-Za-z.\-]{1,6}$/.test(q)) { const qq = await safe(MD.quotes([up]), {} as any); if (qq[up]) out.push({ t: up, n: "", ...qq[up] }); }
  const byName = await safe(SEC2.search(q, 8), [] as any[]);
  for (const x of byName) if (!out.find((o) => o.t === x.t)) out.push({ t: x.t, n: x.n });
  if (/^[A-Za-z]{2,6}$/.test(q) && !out.length) out.unshift({ t: up, n: /^[A-Z]{4}X$/.test(up) ? "Mutual fund" : "Open this symbol" });
  return out.slice(0, 10);
}
