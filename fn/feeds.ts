// Data feeds. Each provider is a small object; all calls go through net.call so usage and errors are tracked.
import { key, monthCost, usage, kvGet } from "./db.ts";
import { call, SourceError, num } from "./net.ts";

async function need(name: string, source: string) {
  const k = await key(name);
  if (!k) throw new SourceError(source, `no ${name}`);
  return k;
}

// ---------------------------------------------------------------- MarketData.app (live quotes, chains, candles)
type Cols = Record<string, unknown[]>;
function rows(r: Cols, cols: string[]) {
  const n = (r[cols[0]] ?? []).length;
  return Array.from({ length: n }, (_, i) => Object.fromEntries(cols.map((c) => [c, (r[c] ?? [])[i] ?? null])));
}
async function md(path: string, params: Record<string, string | number | undefined> = {}) {
  const k = await need("MARKETDATA_API_KEY", "marketdata");
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([a, b]) => [a, String(b)]));
  const r = await call("marketdata", `https://api.marketdata.app/v1${path}${q.size ? "?" + q : ""}`, { headers: { Authorization: `Bearer ${k}` } });
  if (!r || (r.s !== "ok" && r.s !== "no_data")) throw new SourceError("marketdata", r?.errmsg ?? "bad response");
  return r;
}
export const MD = {
  async quotes(symbols: string[]) {
    const syms = [...new Set(symbols.map((s) => s.toUpperCase()).filter(Boolean))];
    const out: Record<string, any> = {};
    for (let i = 0; i < syms.length; i += 50) {
      const r = await md("/stocks/quotes/", { symbols: syms.slice(i, i + 50).join(",") });
      if (r.s === "no_data") continue;
      for (const q of rows(r, ["symbol", "last", "bid", "ask", "mid", "change", "changepct", "volume", "updated"])) {
        out[q.symbol as string] = { ...q, age_s: q.updated ? Math.round(Date.now() / 1000 - (q.updated as number)) : null };
      }
    }
    return out;
  },
  async chain(symbol: string, p: Record<string, string | number | undefined>) {
    const r = await md(`/options/chain/${symbol.toUpperCase()}/`, p);
    if (r.s === "no_data") return [];
    return rows(r, ["optionSymbol", "underlying", "expiration", "side", "strike", "dte", "bid", "ask", "mid", "last", "volume",
      "openInterest", "iv", "delta", "underlyingPrice", "updated"]);
  },
  async option(optionSymbol: string) {
    const r = await md(`/options/quotes/${optionSymbol}/`);
    if (r.s === "no_data") return null;
    return rows(r, ["optionSymbol", "bid", "ask", "mid", "last", "iv", "delta", "underlyingPrice", "updated"])[0] ?? null;
  },
  /** Candles from a start date (YYYY-MM-DD). Daily candles are split-adjusted. */
  async candlesFrom(symbol: string, from: string, res = "D") {
    const r = await md(`/stocks/candles/${res}/${symbol.toUpperCase()}/`, { from, to: new Date().toISOString().slice(0, 10) });
    if (r.s === "no_data") return [];
    return rows(r, ["t", "c"]);
  },
  async candles(symbol: string, countback = 260, res = "D") {
    const r = await md(`/stocks/candles/${res}/${symbol.toUpperCase()}/`, { countback });
    if (r.s === "no_data") return [];
    return rows(r, ["t", "o", "h", "l", "c", "v"]);
  },
};
export function occ(symbol: string, expiry: string, side: string, strike: number) {
  const d = expiry.replaceAll("-", "").slice(2);
  return `${symbol.toUpperCase()}${d}${side[0].toUpperCase()}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

// ---------------------------------------------------------------- Unusual Whales
async function uw(path: string, params: Record<string, string | number | boolean | undefined> = {}, timeoutMs = 20000) {
  const k = await need("UNUSUAL_WHALES_API_KEY", "unusual_whales");
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([a, b]) => [a, String(b)]));
  const r = await call("unusual_whales", `https://api.unusualwhales.com${path}${q.size ? "?" + q : ""}`,
    { headers: { Authorization: `Bearer ${k}`, Accept: "application/json" }, timeoutMs });
  return r && typeof r === "object" && "data" in r ? r.data : r;
}
const f = (o: any, ...ks: string[]) => { for (const k of ks) if (o?.[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return null; };
export function normFlow(a: any) {
  const t = String(f(a, "type") ?? "").toLowerCase();
  const ask = num(f(a, "total_ask_side_prem")) ?? 0, bid = num(f(a, "total_bid_side_prem")) ?? 0;
  return {
    id: f(a, "id"), ticker: f(a, "ticker", "ticker_symbol"), ts: f(a, "created_at"), kind: t.startsWith("c") ? "call" : t.startsWith("p") ? "put" : t,
    premium: num(f(a, "total_premium")), strike: num(f(a, "strike")), expiry: f(a, "expiry"), size: num(f(a, "total_size")),
    oi: num(f(a, "open_interest")), volume: num(f(a, "volume")), ask_prem: ask, bid_prem: bid,
    side: ask > bid * 1.5 ? "bought" : bid > ask * 1.5 ? "sold" : "mixed",
    underlying: num(f(a, "underlying_price")), iv: num(f(a, "iv")), delta: num(f(a, "delta")), rule: f(a, "alert_rule"),
    sweep: !!a?.has_sweep, opening: !!a?.all_opening_trades, chain: f(a, "option_chain"), marketcap: num(f(a, "marketcap")),
    next_earnings: f(a, "next_earnings_date"), issue_type: f(a, "issue_type"), trades: num(f(a, "trade_count")),
  };
}
export const UW = {
  flowAlerts: async (p: Record<string, any> = {}) => ((await uw("/api/option-trades/flow-alerts", { limit: 200, ...p })) ?? []).map(normFlow),
  congress: async (limit = 100) => ((await uw("/api/congress/recent-trades", { limit })) ?? []).map((t: any) => ({
    ticker: f(t, "ticker"), member: f(t, "name", "reporter"), chamber: f(t, "member_type"), txn: f(t, "txn_type"), amount: f(t, "amounts"),
    traded: f(t, "transaction_date"), filed: f(t, "filed_at_date"), notes: f(t, "notes"), pid: f(t, "politician_id"),
  })),
  info: (t: string) => uw(`/api/stock/${t.toUpperCase()}/info`),
  ivRank: async (t: string) => { const r = await uw(`/api/stock/${t.toUpperCase()}/iv-rank`); const last = Array.isArray(r) ? r[r.length - 1] : null;
    return last ? { iv: num(last.volatility), rank: num(last.iv_rank_1y), date: last.date } : null; },
  earnings: async (t: string) => ((await uw(`/api/earnings/${t.toUpperCase()}`)) ?? []).map((e: any) => ({
    date: e.report_date, time: e.report_time, source: e.source, expected: num(e.expected_move_perc), move1d: num(e.post_earnings_move_1d),
    eps: num(e.actual_eps), est: num(e.street_mean_est) })),
  darkpool: (t: string) => uw(`/api/darkpool/${t.toUpperCase()}`, { limit: 50 }),
  headlines: (p: Record<string, any> = {}) => uw("/api/news/headlines", p),
  tide: () => uw("/api/market/market-tide"),
  /** Screener row(s): sector, size, beta, dividend yield, short interest, earnings growth, volatility, 52-week range. */
  screener: async (tickers: string[]) => {
    const out: Record<string, any> = {};
    for (let i = 0; i < tickers.length; i += 25) {
      const r = await uw("/api/screener/stocks", { ticker: tickers.slice(i, i + 25).join(",") }, 30000);
      for (const x of (Array.isArray(r) ? r : [])) if (x?.ticker) out[String(x.ticker).toUpperCase()] = x;
    }
    return out;
  },
  raw: uw,
};

// ---------------------------------------------------------------- Quiver Quant (large lists, cached in memory 6h)
const _qc = new Map<string, { t: number; rows: any[] }>();
async function quiverLive(name: string) {
  const c = _qc.get(name); if (c && Date.now() - c.t < 6 * 3600_000) return c.rows;
  const k = await need("QUIVER_API_KEY", "quiver");
  const rows = (await call("quiver", `https://api.quiverquant.com/beta/live/${name}`, { headers: { Authorization: `Bearer ${k}`, Accept: "application/json" }, timeoutMs: 60000 })) ?? [];
  _qc.set(name, { t: Date.now(), rows }); return rows;
}
export const QV = {
  lobbying: async () => (await quiverLive("lobbying")).map((r: any) => ({ date: r.Date, ticker: r.Ticker, client: r.Client, amount: num(r.Amount),
    issue: String(r.Issue ?? "").replace(/\s*\n\s*/g, "; "), specific: String(r.Specific_Issue ?? "").replace(/\s*\n\s*/g, "; "), registrant: r.Registrant })),
  contracts: async () => (await quiverLive("govcontractsall")).map((r: any) => ({ date: r.Date, ticker: r.Ticker, agency: r.Agency, amount: num(r.Amount), description: r.Description })),
  byTicker: async (kind: "lobbying" | "govcontractsall", t: string) => {
    const k = await need("QUIVER_API_KEY", "quiver");
    return (await call("quiver", `https://api.quiverquant.com/beta/historical/${kind}/${t.toUpperCase()}`, { headers: { Authorization: `Bearer ${k}` }, timeoutMs: 30000 })) ?? [];
  },
};

// ---------------------------------------------------------------- ROIC.AI transcripts
export const ROIC = {
  /** Last four quarters of per-share data (EPS, revenue per share), newest first. */
  async perShare(t: string) {
    const k = await need("ROIC_API_KEY", "roic");
    const r = await call("roic", `https://api.roic.ai/v2/fundamental/per-share/${encodeURIComponent(t.toUpperCase())}?period=quarterly&limit=4&apikey=${encodeURIComponent(k)}`, { timeoutMs: 20000 });
    return Array.isArray(r) ? r : [];
  },
  async latest(t: string) {
    const k = await need("ROIC_API_KEY", "roic");
    const r = await call("roic", `https://api.roic.ai/v2/company/earnings-calls/latest/${t.toUpperCase()}?apikey=${encodeURIComponent(k)}`, { timeoutMs: 30000 });
    return Array.isArray(r) ? r[0] : r?.data && !Array.isArray(r.data) ? r.data : r;
  },
};

// ---------------------------------------------------------------- LegiScan
export async function bills(query: string, state = "ALL") {
  const k = await need("LEGISCAN_API_KEY", "legiscan");
  const r = await call("legiscan", `https://api.legiscan.com/?key=${encodeURIComponent(k)}&op=getSearch&state=${state}&year=2&query=${encodeURIComponent(query)}`);
  if (r?.status !== "OK") throw new SourceError("legiscan", r?.alert?.message ?? "search failed");
  const unesc = (s: string) => String(s ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const total = r.searchresult?.summary?.count ?? null;
  return { total, bills: Object.entries(r.searchresult ?? {}).filter(([k]) => k !== "summary").slice(0, 50).map(([, b]: any) => ({
    state: b.state, bill: b.bill_number, title: unesc(b.title), last_action: unesc(b.last_action), date: b.last_action_date, url: b.url })) };
}

// ---------------------------------------------------------------- SEC EDGAR (no key; the SEC asks for a contact in the request header, kept in odesa.kv)
let _cik: Record<string, string> | null = null;
async function secHeaders() { return { "User-Agent": String(await kvGet("sec_contact", "Odesa personal research app")) }; }
export const SEC = {
  async cik(t: string) {
    if (!_cik) {
      const r = await call("sec", "https://www.sec.gov/files/company_tickers.json", { headers: await secHeaders() });
      _cik = {}; for (const v of Object.values(r ?? {}) as any[]) _cik[String(v.ticker).toUpperCase()] = String(v.cik_str).padStart(10, "0");
    }
    return _cik[t.toUpperCase()] ?? null;
  },
  async filings(t: string, forms = ["8-K", "10-K", "10-Q"], limit = 8) {
    const c = await SEC.cik(t); if (!c) return [];
    const r = await call("sec", `https://data.sec.gov/submissions/CIK${c}.json`, { headers: await secHeaders() });
    const fl = r?.filings?.recent ?? {}; const out: any[] = [];
    for (let i = 0; i < (fl.form ?? []).length && out.length < limit; i++) {
      if (forms.length && !forms.includes(fl.form[i])) continue;
      out.push({ form: fl.form[i], filed: fl.filingDate[i], desc: fl.primaryDocDescription?.[i] ?? "", items: fl.items?.[i] ?? "",
        url: `https://www.sec.gov/Archives/edgar/data/${Number(c)}/${String(fl.accessionNumber[i]).replaceAll("-", "")}/${fl.primaryDocument[i]}` });
    }
    return out;
  },
};

// ---------------------------------------------------------------- Grok (xAI Responses API with X and web search)
export class BudgetExceeded extends Error {}
export const GROK_FAST = "grok-4.3";
export const GROK_DEEP = "grok-4.7";
export async function grok(prompt: string, o: { x?: boolean; web?: boolean; fromDate?: string; model?: string; system?: string; maxTurns?: number; timeoutMs?: number } = {}) {
  const k = await need("XAI_API_KEY", "grok");
  const s = await kvGet<any>("settings", {});
  const cap = Number(s.grok_cap_usd ?? 300), spent = await monthCost("grok");
  if (spent >= cap) throw new BudgetExceeded(`Grok monthly cap reached ($${spent.toFixed(2)} of $${cap})`);
  const tools: any[] = [];
  if (o.x) tools.push(o.fromDate ? { type: "x_search", from_date: o.fromDate } : { type: "x_search" });
  if (o.web) tools.push({ type: "web_search" });
  const input = [...(o.system ? [{ role: "system", content: o.system }] : []), { role: "user", content: prompt }];
  const body: any = { model: o.model ?? GROK_FAST, input };
  if (tools.length) { body.tools = tools; body.max_turns = o.maxTurns ?? 3; }
  const r = await call("grok_raw", "https://api.x.ai/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, body: JSON.stringify(body), timeoutMs: o.timeoutMs ?? 120000 });
  const ticks = Number(r?.usage?.cost_in_usd_ticks ?? 0);
  const cost = ticks ? ticks / 1e10 : 0;
  await usage("grok", true, cost);
  let text = r?.output_text ?? ""; const cites: { url: string; title?: string }[] = [];
  for (const item of r?.output ?? []) if (item.type === "message") for (const p of item.content ?? []) {
    if (!r?.output_text && (p.type === "output_text" || p.type === "text")) text += p.text ?? "";
    for (const a of p.annotations ?? []) if (a.url && !cites.find((c) => c.url === a.url)) cites.push({ url: a.url, title: a.title });
  }
  return { text: text.trim(), citations: cites, cost, model: r?.model ?? body.model };
}
export function parseJson(text: string): any {
  let t = text.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const starts = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
  if (!starts.length) return null;
  const s = Math.min(...starts), e = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (e < s) return null;
  t = t.slice(s, e + 1);
  try { return JSON.parse(t); } catch { /* fall through */ }
  try { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
}
export async function grokJson(prompt: string, shape: string, o: Parameters<typeof grok>[1] = {}) {
  const r = await grok(`${prompt}\n\nReturn ONLY valid JSON matching this shape (no prose, no code fences):\n${shape}`, o);
  return { data: parseJson(r.text), citations: r.citations, cost: r.cost, model: r.model, raw: r.text };
}
