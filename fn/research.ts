// Today screen and the one-stock research page.
import { sql, kvGet, kvSet } from "./db.ts";
import { MD, UW, SEC, grokJson, GROK_FAST } from "./feeds.ts";
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
