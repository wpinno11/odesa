// Pure calculations: share calculator, rebalancing, option P/L, exits, results. No network. Nothing here places orders.
export const MULT = 100;

export type Holding = { t: string; n?: string; w: number; cash?: boolean }; // w in basis points, sum 10000

export function allocate(amount: number, holdings: Holding[], prices: Record<string, number | null>) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a dollar amount above $0.");
  if (amount > 1e12) throw new Error("That amount is too large.");
  if (!holdings.length) throw new Error("This model has no holdings yet.");
  const total = holdings.reduce((s, h) => s + Math.round(h.w), 0);
  if (total !== 10000) throw new Error(`Model weights add up to ${(total / 100).toFixed(2)}%. They need to total 100%.`);
  const rows = holdings.map((h) => {
    const t = h.t.toUpperCase(), target = amount * h.w / 10000, p = prices[t];
    const r: any = { t, n: h.n || t, w_bps: h.w, target, price: null, shares: 0, value: 0, cash: !!h.cash, status: "ok" };
    if (r.cash) { r.status = "cash sleeve"; r.value = target; }
    else if (!p || !Number.isFinite(p) || p <= 0) r.status = "no price";
    else { r.price = p; r.shares = Math.floor(target / p + 1e-9); r.value = r.shares * p; }
    return r;
  });
  const spent = rows.filter((r) => !r.cash).reduce((s, r) => s + r.value, 0), sleeves = rows.filter((r) => r.cash).reduce((s, r) => s + r.value, 0);
  let left = amount - spent - sleeves;
  const buyable = rows.filter((r) => r.status === "ok");
  for (let g = 0; g < 100000 && buyable.length; g++) {
    const c = buyable.filter((r) => r.price <= left + 1e-9 && r.target - r.value >= r.price / 2);
    if (!c.length) break;
    c.sort((a, b) => ((b.target - b.value) / b.target - (a.target - a.value) / a.target) || ((b.target - b.value) - (a.target - a.value)));
    c[0].shares += 1; c[0].value += c[0].price; left -= c[0].price;
  }
  left = Math.abs(left) < 0.005 ? 0 : Math.round(left * 100) / 100;
  for (const r of rows) {
    r.value = Math.round(r.value * 100) / 100; r.target = Math.round(r.target * 100) / 100;
    r.actual_bps = Math.round(r.value / amount * 10000); r.drift_bps = r.actual_bps - r.w_bps;
  }
  return { amount, rows, invested: Math.round(rows.filter((r) => !r.cash).reduce((s, r) => s + r.value, 0) * 100) / 100,
    leftover: left, unpriced: rows.filter((r) => r.status === "no price").map((r) => r.t),
    max_drift_bps: Math.max(0, ...rows.filter((r) => !r.cash).map((r) => Math.abs(r.drift_bps))) };
}

/** Trades that bring current shares back to model targets. Whole shares; sells first fund buys; threshold in basis points of drift. */
export function rebalance(holdings: Holding[], shares: Record<string, number>, cash: number, prices: Record<string, number | null>, thresholdBps = 100) {
  const tickers = [...new Set([...holdings.map((h) => h.t.toUpperCase()), ...Object.keys(shares).map((t) => t.toUpperCase())])];
  const value = (t: string) => (shares[t] ?? 0) * (prices[t] ?? 0);
  const missing = tickers.filter((t) => (shares[t] ?? 0) > 0 && !prices[t]);
  const total = tickers.reduce((s, t) => s + value(t), 0) + cash;
  if (total <= 0) throw new Error("Enter the shares you hold (or the account value) first.");
  const w = Object.fromEntries(holdings.map((h) => [h.t.toUpperCase(), h.w]));
  const rows = tickers.map((t) => {
    const cur = value(t), curBps = cur / total * 10000, tgtBps = w[t] ?? 0, p = prices[t] ?? null;
    const want = p ? Math.round(total * tgtBps / 10000 / p) : (shares[t] ?? 0);
    return { t, price: p, shares: shares[t] ?? 0, value: Math.round(cur * 100) / 100, current_bps: Math.round(curBps), target_bps: tgtBps,
      drift_bps: Math.round(curBps - tgtBps), delta: want - (shares[t] ?? 0) };
  });
  const trades = rows.filter((r) => r.price && r.delta !== 0 && (Math.abs(r.drift_bps) >= thresholdBps || r.target_bps === 0))
    .map((r) => ({ t: r.t, action: r.delta < 0 ? "sell" : "buy", shares: Math.abs(r.delta), price: r.price!, amount: Math.round(Math.abs(r.delta) * r.price! * 100) / 100,
      from_bps: r.current_bps, to_bps: r.target_bps }));
  const sold = trades.filter((t) => t.action === "sell").reduce((s, t) => s + t.amount, 0);
  let bought = trades.filter((t) => t.action === "buy").reduce((s, t) => s + t.amount, 0);
  // never spend more than cash + sales: trim buys one share at a time from the largest
  while (bought > cash + sold + 0.005) {
    const b = trades.filter((t) => t.action === "buy" && t.shares > 0).sort((a, b) => b.amount - a.amount)[0];
    if (!b) break; b.shares -= 1; b.amount = Math.round(b.shares * b.price * 100) / 100; bought -= b.price;
  }
  const after: Record<string, number> = { ...shares };
  for (const t of trades) after[t.t] = (after[t.t] ?? 0) + (t.action === "buy" ? t.shares : -t.shares);
  const afterDrift = Math.max(0, ...tickers.filter((t) => prices[t]).map((t) => Math.abs((after[t] ?? 0) * prices[t]! / total * 10000 - (w[t] ?? 0))));
  return { total: Math.round(total * 100) / 100, rows, trades: trades.filter((t) => t.shares > 0), sold: Math.round(sold * 100) / 100,
    bought: Math.round(bought * 100) / 100, cash_after: Math.round((cash + sold - bought) * 100) / 100, max_drift_after_bps: Math.round(afterDrift), missing_prices: missing };
}

// ---------------------------------------------------------------- options
export function normContract(c: any) {
  const symbol = String(c.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9.^-]{1,12}$/.test(symbol)) throw new Error("Enter a valid ticker.");
  const side = String(c.side ?? "").toLowerCase(); if (!["call", "put"].includes(side)) throw new Error("Choose call or put.");
  const action = String(c.action ?? "buy").toLowerCase(); if (!["buy", "sell"].includes(action)) throw new Error("Choose buy or sell.");
  const strike = Number(c.strike); if (!Number.isFinite(strike) || strike <= 0) throw new Error("Enter a strike price above $0.");
  const expiry = String(c.expiry ?? "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || isNaN(Date.parse(expiry))) throw new Error("Enter the expiration as YYYY-MM-DD.");
  const contracts = Math.round(Number(c.contracts ?? 1)); if (!(contracts >= 1 && contracts <= 10000)) throw new Error("Contracts must be between 1 and 10,000.");
  const pct = (v: any, name: string) => { if (v === null || v === undefined || v === "") return null; const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 10000) throw new Error(`${name} must be above 0%.`); return n; };
  const target_pct = pct(c.target_pct, "Target"), stop_pct = pct(c.stop_pct, "Stop");
  if (action === "sell" && target_pct !== null && target_pct >= 100) throw new Error("A sold option can gain at most 100%, so set its target under 100%.");
  return { symbol, side, action, strike: Math.round(strike * 10000) / 10000, expiry, contracts, target_pct, stop_pct };
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function label(c: { symbol: string; expiry: string; strike: number; side: string }) {
  const [y, m, d] = String(c.expiry).slice(0, 10).split("-").map(Number);
  return `${c.symbol} ${MON[m - 1]} ${d} ${y} $${Number(c.strike)} ${c.side}`;
}
export function liveMid(q: any): { px: number | null; why?: string } {
  const ok = (v: any) => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!q) return { px: null, why: "That contract isn't listed right now." };
  if (ok(q.bid) && ok(q.ask) && q.ask >= q.bid) return { px: Math.round((q.bid + q.ask) / 2 * 10000) / 10000 };
  if (ok(q.ask)) return { px: null, why: "Only an ask is showing (no bid), so there's no fair live price right now." };
  return { px: null, why: "No live two-sided quote right now (the market may be closed or the contract isn't trading)." };
}
export const intrinsic = (side: string, strike: number, u: number | null) => u === null ? null : side === "call" ? Math.max(0, u - strike) : Math.max(0, strike - u);
export function pnl(p: any, px: number | null) {
  const e = Number(p.entry_px); if (px === null || !e) return { usd: null as number | null, pct: null as number | null };
  const sign = p.action === "buy" ? 1 : -1;
  return { usd: Math.round((px - e) * sign * MULT * Number(p.contracts) * 100) / 100, pct: Math.round((px - e) / e * 100 * sign * 100) / 100 };
}
export function checkExit(p: any, px: number) {
  const { pct } = pnl(p, px); if (pct === null) return null;
  if (p.target_pct && pct >= Number(p.target_pct) - 1e-9) return "target";
  if (p.stop_pct && pct <= -Number(p.stop_pct) + 1e-9) return "stop";
  return null;
}
export function results(closed: any[]) {
  const out: any = { closed: closed.length, wins: 0, losses: 0, flat: 0, win_rate: null, total_pnl: 0, avg_return_pct: null, best: null, worst: null,
    with_target: 0, target_hits: 0, target_hit_rate: null, by_reason: {} };
  const rets: [number, any][] = [];
  for (const p of closed) {
    if (p.pnl === null || p.pnl === undefined) continue;
    out.total_pnl += p.pnl; rets.push([p.pnl_pct, p]);
    if (p.pnl > 0.004) out.wins++; else if (p.pnl < -0.004) out.losses++; else out.flat++;
    const r = p.exit_reason || "manual"; out.by_reason[r] = (out.by_reason[r] ?? 0) + 1;
    if (p.target_pct) { out.with_target++; if (r === "target") out.target_hits++; }
  }
  const dec = out.wins + out.losses; out.win_rate = dec ? Math.round(out.wins / dec * 1000) / 10 : null;
  out.total_pnl = Math.round(out.total_pnl * 100) / 100;
  if (rets.length) {
    out.avg_return_pct = Math.round(rets.reduce((s, r) => s + r[0], 0) / rets.length * 100) / 100;
    const b = rets.reduce((a, c) => (c[0] > a[0] ? c : a)), w = rets.reduce((a, c) => (c[0] < a[0] ? c : a));
    out.best = { label: b[1].label, pct: b[0] }; out.worst = { label: w[1].label, pct: w[0] };
  }
  out.target_hit_rate = out.with_target ? Math.round(out.target_hits / out.with_target * 1000) / 10 : null;
  return out;
}

// ---------------------------------------------------------------- market hours (US equities, ET)
const HOLIDAYS = new Set(["2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
  "2027-09-06", "2027-11-25", "2027-12-24"]);
const EARLY = new Set(["2026-11-27", "2026-12-24", "2027-11-26"]);
export function etNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, mins: (Number(p.hour) % 24) * 60 + Number(p.minute), weekday: p.weekday as string };
}
export function marketOpen(d = new Date()) {
  const n = etNow(d);
  if (["Sat", "Sun"].includes(n.weekday) || HOLIDAYS.has(n.date)) return false;
  return n.mins >= 570 && n.mins < (EARLY.has(n.date) ? 780 : 960);
}
export function tradingDay(d = new Date()) { const n = etNow(d); return !["Sat", "Sun"].includes(n.weekday) && !HOLIDAYS.has(n.date); }
