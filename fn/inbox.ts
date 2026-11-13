// Inbox for Grok Bot: it sends earnings breakdowns, flags and its own rules here; Odesa files each in the right place.
// Auth: header x-odesa-inbox with the inbox key (only its hash is stored, in odesa.kv 'inbox_key').
import { sql, kvGet, kvSet, event } from "./db.ts";
import { notify } from "./push.ts";

const T = (v: any) => String(v ?? "").toUpperCase().replace(/^\$/, "").trim();
const okT = (t: string) => /^[A-Z0-9.\-]{1,12}$/.test(t);
const str = (v: any, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export async function receive(body: any) {
  const kind = String(body?.kind ?? "").toLowerCase();
  if (kind === "earnings") {
    const t = T(body.ticker); if (!okT(t)) throw new Error("ticker is required");
    const r = body.card ?? body.result ?? body.data; if (!r || typeof r !== "object") throw new Error("card is required");
    const date = str(body.call_date ?? r.report_date ?? "", 10);
    for (const c of r.call ?? []) c.verified = c.verified ?? !!c.quote;   // Grok Bot checks its own quotes against the transcript
    await kvSet(`call:${t}`, { status: "done", at: new Date().toISOString(), call_date: date || null, source: "Grok Bot", result: r });
    await event("call", `${t}: earnings breakdown from Grok Bot`, str(r.headline, 200));
    if (body.alert !== false) await notify(`${t} earnings read`, str(r.headline ?? "New breakdown from Grok Bot", 160), `#research/${t}`).catch(() => {});
    return { ok: true, filed: `Research › ${t} › Earnings` };
  }
  if (kind === "signal" || kind === "flag") {
    const items = Array.isArray(body.items) ? body.items : [body]; let n = 0;
    for (const x of items.slice(0, 50)) {
      const t = T(x.ticker); if (!okT(t)) continue;
      const title = str(x.title ?? x.phrase ?? x.note, 160); if (!title) continue;
      const ts = x.ts ? new Date(x.ts) : new Date(); const strength = Math.max(0.5, Math.min(3, Number(x.strength ?? (x.weight === "high" ? 3 : x.weight === "low" ? 1 : 2)) || 2));
      const r = await sql`insert into odesa.signals(src, ticker, ts, title, detail, strength, dedupe)
        values ('T', ${t}, ${ts}, ${title}, ${sql.json({ ...x, from: "Grok Bot" } as never)}, ${strength}, ${"GB:" + t + ":" + str(x.id ?? title, 120)})
        on conflict (dedupe) do nothing returning id`;
      if (r.length) { n++; if (x.alert) await notify(`${t}: ${title}`.slice(0, 80), str(x.why ?? x.quote ?? "", 160), `#research/${t}`).catch(() => {}); }
    }
    return { ok: true, added: n, filed: "Signals (T)" };
  }
  if (kind === "rules") {
    const text = str(body.text ?? body.rules, 20000); if (!text) throw new Error("text is required");
    const phrases = Array.isArray(body.phrases) ? body.phrases.slice(0, 80).map((p: any) => typeof p === "string" ? { phrase: str(p, 80) } : { phrase: str(p.phrase, 80), sign: str(p.sign, 20), why: str(p.why, 200) }).filter((p: any) => p.phrase) : [];
    await kvSet("call_rules", { at: new Date().toISOString(), text, phrases });
    return { ok: true, saved: "rules", phrases: phrases.length };
  }
  throw new Error('kind must be "earnings", "signal" or "rules"');
}

/** The rules Grok Bot sent, as text to add to Odesa's own call readers (empty if none yet). */
export async function rulesText() {
  const r = await kvGet<any>("call_rules", null); if (!r?.text) return "";
  const ph = (r.phrases ?? []).map((p: any) => `- "${p.phrase}"${p.sign ? ` (${p.sign})` : ""}${p.why ? `: ${p.why}` : ""}`).join("\n");
  return `\n\nTHE MANAGER'S OWN RULES (from his Grok Bot; follow these first):\n${r.text}${ph ? `\nKey phrases:\n${ph}` : ""}`;
}
