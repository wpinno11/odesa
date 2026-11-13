// One gate for every phone alert. Every candidate is scored 0-100 and logged; only the strongest buzz the phone.
// Rules: score >= the lane's bar (80 by default), one buzz per name per day, a daily cap, and quiet outside market hours
// (except congress trades and severe Call Surgeon warnings). Each alert carries a one-line "why".
import { sql, kvGet, event } from "./db.ts";
import { MD } from "./feeds.ts";
import { marketOpen, etNow } from "./core.ts";
import { notify } from "./push.ts";

export type Lane = "flow" | "congress" | "converge" | "warning" | "overlay";
export const LANE_NAMES: Record<Lane, string> = { flow: "Unusual options", congress: "Congress + committee", converge: "Signals agree", warning: "Warning signs", overlay: "Overlay idea" };

/** The bar a lane must clear. Lanes whose alerts haven't paid off (10+ scored, under 45% right after 20 days) need 5 more points. */
async function bar(lane: Lane) {
  const s = await kvGet<any>("settings", {});
  const base = Number(s.alert_min ?? 80);
  const [r] = await sql`select count(*)::int n, avg(case when (bias = 'bearish' and px20 < px0) or (bias <> 'bearish' and px20 > px0) then 1.0 else 0.0 end)::float8 hit
    from odesa.alerts where lane = ${lane} and buzzed and px20 is not null and px0 is not null`;
  return base + (r.n >= 10 && r.hit < 0.45 ? 5 : 0);
}

export async function alert(a: { lane: Lane; ticker: string; score: number; title: string; why: string; url?: string; key: string; bias?: "bullish" | "bearish" | "neutral";
  offHours?: boolean; px?: number | null; detail?: unknown }) {
  const score = Math.max(0, Math.min(100, Math.round(a.score)));
  const s = await kvGet<any>("settings", {});
  const cap = Number(s.alert_cap ?? 5);
  const today = etNow().date;
  let held: string | null = null;
  if (score < await bar(a.lane)) held = "below the bar";
  else if (!marketOpen() && !a.offHours) held = "market closed";
  else {
    const [d] = await sql`select count(*)::int n, count(*) filter (where ticker = ${a.ticker})::int same from odesa.alerts where day = ${today} and buzzed`;
    if (d.same > 0) held = "already alerted on this name today";
    else if (d.n >= cap) held = "daily limit reached";
  }
  let px = a.px ?? null;
  if (px === null) { try { const q = await MD.quotes([a.ticker]); px = q[a.ticker]?.last ?? null; } catch { /* filled later if missing */ } }
  const r = await sql`insert into odesa.alerts(day, lane, ticker, score, bias, title, why, url, key, buzzed, held_back, detail, px0)
    values (${today}, ${a.lane}, ${a.ticker}, ${score}, ${a.bias ?? "neutral"}, ${a.title.slice(0, 120)}, ${a.why.slice(0, 240)}, ${a.url ?? `#research/${a.ticker}`}, ${a.key},
    ${held === null}, ${held}, ${sql.json((a.detail ?? {}) as never)}, ${px}) on conflict (key) do nothing returning id`;
  if (!r.length) return { dup: true };
  if (held === null) {
    await event("alert", `${a.title} · ${score}`, a.why, { ticker: a.ticker, alert_id: r[0].id, lane: a.lane });
    await notify(a.title.slice(0, 80), a.why.slice(0, 170), a.url ?? `#research/${a.ticker}`).catch(() => 0);
  }
  return { id: r[0].id, buzzed: held === null, held };
}

/** Daily: fill the price 5 and 20 trading days after each alert, for the scorecard. */
export async function scorecardFill() {
  const due = await sql`select id, ticker, at, px0, px5, px20 from odesa.alerts
    where (px5 is null and at < now() - interval '7 days') or (px20 is null and at < now() - interval '28 days') or px0 is null order by at limit 40`;
  let n = 0; const cache: Record<string, any[]> = {};
  for (const a of due) {
    try {
      const c = cache[a.ticker as string] ??= await MD.candles(a.ticker as string, 80);
      const day0 = new Date(a.at as string).toISOString().slice(0, 10);
      const after = c.filter((x: any) => new Date(x.t * 1000).toISOString().slice(0, 10) >= day0);
      const px0 = a.px0 ?? after[0]?.c ?? null, px5 = a.px5 ?? after[5]?.c ?? null, px20 = a.px20 ?? after[20]?.c ?? null;
      await sql`update odesa.alerts set px0 = ${px0}, px5 = ${px5}, px20 = ${px20} where id = ${a.id}`; n++;
    } catch { /* next day */ }
  }
  return n;
}

/** Alerts list + scorecard for the app. */
export async function list(days = 14) {
  const rows = await sql`select id, at, lane, ticker, score, bias, title, why, url, buzzed, held_back, px0, px5, px20 from odesa.alerts
    where at > now() - make_interval(days => ${days}) order by at desc limit 200`;
  const card = await sql`select lane, count(*)::int n,
      count(px5)::int n5, avg(case when bias = 'bearish' then (px0 - px5) / px0 else (px5 - px0) / px0 end)::float8 avg5,
      avg(case when px5 is null then null when (bias = 'bearish' and px5 < px0) or (bias <> 'bearish' and px5 > px0) then 1.0 else 0.0 end)::float8 hit5,
      count(px20)::int n20, avg(case when bias = 'bearish' then (px0 - px20) / px0 else (px20 - px0) / px0 end)::float8 avg20,
      avg(case when px20 is null then null when (bias = 'bearish' and px20 < px0) or (bias <> 'bearish' and px20 > px0) then 1.0 else 0.0 end)::float8 hit20
    from odesa.alerts where buzzed and px0 is not null group by lane`;
  const s = await kvGet<any>("settings", {});
  const bars: Record<string, number> = {}; for (const l of Object.keys(LANE_NAMES) as Lane[]) bars[l] = await bar(l);
  return { rows, scorecard: card, names: LANE_NAMES, min: Number(s.alert_min ?? 80), cap: Number(s.alert_cap ?? 5), bars };
}
