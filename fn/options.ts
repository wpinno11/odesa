// Options ideas -> Approve (records the live mid at that moment) -> tracked to target/stop/expiry -> Results. Records only; no orders.
import { sql, event } from "./db.ts";
import { MD, occ } from "./feeds.ts";
import { normContract, label, liveMid, pnl, checkExit, intrinsic, results, marketOpen } from "./core.ts";
import { notify } from "./push.ts";

const MAX_AGE_S = 600;
async function liveQuote(c: { symbol: string; expiry: string; side: string; strike: number }) {
  const q = await MD.option(occ(c.symbol, c.expiry, c.side, c.strike));
  if (q && q.updated && Date.now() / 1000 - (q.updated as number) > MAX_AGE_S && marketOpen()) return { q, ...liveMid(null), why: "The quote is stale right now. Try again in a minute." };
  return { q, ...liveMid(q) };
}
const row = (p: any) => {
  const out: any = { ...p, label: label(p) };
  const mark = p.status === "open" ? p.last_px : p.exit_px; const r = pnl(p, mark === null ? null : Number(mark));
  out.pnl = r.usd; out.pnl_pct = r.pct; return out;
};

export async function listIdeas() {
  const r = await sql`select * from odesa.ideas where status = 'new' order by created_at desc limit 100`;
  return r.map((i: any) => ({ ...i, label: label(i) }));
}
export async function addIdea(b: any) {
  const c = normContract(b);
  const r = await sql`insert into odesa.ideas(key, source, symbol, side, action, strike, expiry, contracts, target_pct, stop_pct, thesis, meta)
    values (${`manual:${Date.now()}`}, ${String(b.source ?? "manual").slice(0, 30)}, ${c.symbol}, ${c.side}, ${c.action}, ${c.strike}, ${c.expiry}, ${c.contracts},
    ${c.target_pct}, ${c.stop_pct}, ${String(b.thesis ?? "").slice(0, 600)}, ${sql.json((b.meta ?? {}) as never)}) returning *`;
  return { ...r[0], label: label(r[0] as any) };
}
export async function approve(id: number, b: any) {
  const [i] = await sql`select * from odesa.ideas where id = ${id}`;
  if (!i) throw new Error("Idea not found.");
  if (i.status !== "new") throw new Error("This idea was already handled.");
  if (!marketOpen()) throw new Error("The market is closed, so there's no live price to lock in. Approve it during market hours (9:30–4:00 ET).");
  const s: any = (await sql`select v from odesa.kv where k = 'settings'`)[0]?.v ?? {};
  const c = normContract({ ...i, expiry: String(i.expiry instanceof Date ? i.expiry.toISOString() : i.expiry).slice(0, 10),
    contracts: b.contracts ?? i.contracts ?? s.contracts ?? 1,
    target_pct: b.target_pct !== undefined ? b.target_pct : i.target_pct ?? (i.action === "sell" ? s.sell_target_pct : s.target_pct),
    stop_pct: b.stop_pct !== undefined ? b.stop_pct : i.stop_pct ?? (i.action === "sell" ? s.sell_stop_pct : s.stop_pct) });
  const lq = await liveQuote(c);
  if (lq.px === null) throw new Error(lq.why ?? "No live price right now.");
  const upd = await sql`update odesa.ideas set status = 'approved', decided_at = now() where id = ${id} and status = 'new' returning id`;
  if (!upd.length) throw new Error("This idea was already handled.");
  const [p] = await sql`insert into odesa.positions(idea_id, symbol, side, action, strike, expiry, contracts, target_pct, stop_pct, thesis, entry_px, entry_at, entry_quote, entry_underlying, last_px, last_at, last_basis, hi_pct, lo_pct)
    values (${id}, ${c.symbol}, ${c.side}, ${c.action}, ${c.strike}, ${c.expiry}, ${c.contracts}, ${c.target_pct}, ${c.stop_pct}, ${i.thesis}, ${lq.px}, now(),
    ${sql.json(lq.q as never)}, ${lq.q?.underlyingPrice ?? null}, ${lq.px}, now(), 'mid', 0, 0) returning *`;
  await event("approved", `Tracking ${label(p as any)}`, `Entry $${lq.px} (live mid)`, { position_id: p.id });
  return row(p);
}
export async function dismiss(id: number) { await sql`update odesa.ideas set status = 'dismissed', decided_at = now() where id = ${id} and status = 'new'`; return { ok: true }; }

export async function positions(status = "open") {
  const r = status === "all" ? await sql`select * from odesa.positions order by entry_at desc limit 300`
    : await sql`select * from odesa.positions where status = ${status} order by entry_at desc limit 300`;
  return r.map(row);
}

async function closePos(p: any, px: number, reason: string, quote: unknown) {
  const u = await sql`update odesa.positions set status = 'closed', exit_px = ${px}, exit_at = now(), exit_reason = ${reason}, exit_quote = ${sql.json((quote ?? {}) as never)}
    where id = ${p.id} and status = 'open' returning *`;
  if (!u.length) return null;
  const r = row(u[0]);
  await event("closed", `${r.label} closed (${reason})`, `${r.pnl_pct !== null ? (r.pnl_pct > 0 ? "+" : "") + r.pnl_pct + "%" : ""}`, { position_id: p.id });
  await notify(`${r.label}: ${reason}`, `${r.pnl_pct !== null ? (r.pnl_pct > 0 ? "+" : "") + r.pnl_pct + "%" : "closed"}`, "#options/tracking");
  return r;
}
/** Close at the live mid (never a price sent from the phone). */
export async function close(id: number) {
  const [p] = await sql`select * from odesa.positions where id = ${id}`;
  if (!p || p.status !== "open") throw new Error("That trade isn't open.");
  const c = { symbol: p.symbol, expiry: String(p.expiry instanceof Date ? p.expiry.toISOString() : p.expiry).slice(0, 10), side: p.side, strike: Number(p.strike) };
  const lq = await liveQuote(c); if (lq.px === null) throw new Error(lq.why ?? "No live price right now.");
  return closePos(p, lq.px, "manual", lq.q);
}

/** Every few minutes in market hours: mark each open trade, record highs/lows, close on target/stop if auto-close is on, alert either way. */
export async function markAll() {
  const open = await sql`select * from odesa.positions where status = 'open'`;
  const s: any = (await sql`select v from odesa.kv where k = 'settings'`)[0]?.v ?? {};
  let marked = 0;
  for (const p of open) {
    try {
      const c = { symbol: p.symbol, expiry: String(p.expiry instanceof Date ? p.expiry.toISOString() : p.expiry).slice(0, 10), side: p.side, strike: Number(p.strike) };
      const lq = await liveQuote(c); if (lq.px === null) continue;
      const { pct } = pnl(p, lq.px);
      await sql`update odesa.positions set last_px = ${lq.px}, last_at = now(), last_basis = 'mid', hi_pct = greatest(coalesce(hi_pct, 0), ${pct}), lo_pct = least(coalesce(lo_pct, 0), ${pct}) where id = ${p.id}`;
      marked++;
      const hit = checkExit(p, lq.px);
      if (hit === "target" && !p.target_hit_at) {
        await sql`update odesa.positions set target_hit_at = now() where id = ${p.id}`;
        if (s.auto_close) await closePos(p, lq.px, "target", lq.q);
        else { await event("target", `${label(p as any)} hit its target`, `${pct}%`, { position_id: p.id }); await notify(`${p.symbol} hit target`, `${label(p as any)}: ${pct}%`, "#options/tracking"); }
      } else if (hit === "stop" && !p.stop_hit_at) {
        await sql`update odesa.positions set stop_hit_at = now() where id = ${p.id}`;
        if (s.auto_close) await closePos(p, lq.px, "stop", lq.q);
        else { await event("stop", `${label(p as any)} hit its stop`, `${pct}%`, { position_id: p.id }); await notify(`${p.symbol} hit stop`, `${label(p as any)}: ${pct}%`, "#options/tracking"); }
      }
    } catch { /* keep going */ }
  }
  return marked;
}
/** After expiry: settle at intrinsic value using the expiry-day close. */
export async function settleExpired() {
  const due = await sql`select * from odesa.positions where status = 'open' and expiry < (now() at time zone 'America/New_York')::date`;
  let n = 0;
  for (const p of due) {
    try {
      const exp = String(p.expiry instanceof Date ? p.expiry.toISOString() : p.expiry).slice(0, 10);
      const cs = await MD.candles(p.symbol, 15);
      const day = cs.filter((c: any) => new Date((c.t as number) * 1000).toISOString().slice(0, 10) <= exp).pop();
      if (!day) continue;
      const px = intrinsic(p.side, Number(p.strike), day.c as number)!;
      await closePos(p, Math.round(px * 10000) / 10000, "expired", { close: day.c, date: exp }); n++;
    } catch { /* retry next tick */ }
  }
  return n;
}
export async function stats() {
  const closed = (await positions("closed"));
  return { ...results(closed), recent: closed.slice(0, 30) };
}
