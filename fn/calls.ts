// Earnings breakdown ("Call Surgeon"): the latest earnings call read against the report and the Street.
// Results vs estimates, what drove it (segments), price-target changes, challenges and opportunities with quotes checked
// word-for-word against the transcript, and read-throughs for other companies. The Grok call runs inside the database
// (pg_net), like Opal, so it can take a few minutes.
import { sql, kvGet, kvSet, monthCost } from "./db.ts";
import { ROIC, GROK_DEEP, GROK_FAST, parseJson } from "./feeds.ts";
import { rulesText } from "./inbox.ts";

const SHAPE = `{
"quarter": "Q3 2026", "report_date": "YYYY-MM-DD", "confidence": "High|Medium|Low",
"headline": "one sentence: what happened, with the key numbers",
"verdict": "one or two sentences: beat or miss, and what actually matters",
"results": [{"metric": "Revenue|Gross profit|Operating income|Net income|EPS diluted|Gross margin|Operating margin|Adj. EBITDA|Free cash flow",
  "actual": "$14.58B", "est": "$12.72B or null", "est_source": "LSEG (via CNBC)", "est_url": "", "est_date": "YYYY-MM-DD", "est_label": "consensus revenue",
  "others": [{"value": "$12.94B", "source": "Benzinga", "url": ""}], "beat": "beat|miss|inline|none", "surprise": "+$1.86B · +14.6%",
  "yoy": "+161.4% YoY (from $5.58B)", "prior_q": "$7.81B or null", "derived": false, "note": "e.g. Actual from the press release"}],
"guidance": [{"item": "Q1 2027 revenue", "value": "$33-37B", "note": "first quarterly guide; about 2.3-2.5x Q3", "direction": "raised|cut|new|held"}],
"drivers": [{"segment": "", "formerly": "formerly reported as ... (or empty)", "revenue": "$7.56B", "share_pct": 51.9, "yoy_pct": 830, "est": "$6.47B", "est_source": "StreetAccount (via CNBC)", "est_url": "", "est_date": "YYYY-MM-DD",
  "others": [{"value": "$6.03B", "source": "Zacks 9-analyst average (via Yahoo Finance)", "url": ""}], "surprise": "+$1.09B · +16.8% vs estimate", "surprise_pct": 16.8,
  "detail": ["2-4 short facts about the segment this quarter"]}],
"targets": {"window": "YYYY-MM-DD to YYYY-MM-DD", "raised": 0, "cut": 0, "kept": 0,
  "rows": [{"firm": "", "analyst": "", "rating": "", "from": 0, "to": 0, "date": "YYYY-MM-DD", "url": ""}]},
"call": [{"kind": "challenge|opportunity", "title": "short headline", "quote": "exact words copied from the transcript, 15-60 words", "speaker": "Name (Role)",
  "why": "why it matters, with numbers from the report"}],
"down_the_line": [{"ticker": "", "name": "", "relation": "Supplier|Partner|Competitor|Customer", "read": "Good sign|Mixed|Bad sign", "role": "how they're connected, one sentence",
  "what": "what this quarter could mean for them, 1-2 sentences", "fact": "the fact from the report or call it rests on", "url": ""}],
"notes": ["short data caveats"],
"flags": [{"kind": "constraint|opportunity|swag|data-quality", "tag": "CAPEX-GUIDE-BREAK", "severity": 4, "weight": 1.0, "quote": "exact words", "speaker": "Name (Role)", "section": "Prepared|Q&A", "vs_prior": "downgrade: last call said ...", "note": "why, with numbers"}],
"tone_shift": {"prepared": "", "qa": "", "summary": ""},
"prep": {"score": 3, "exchanges": [{"asked": "analyst (firm): what was asked", "answer": "how it was dodged, short quote"}]},
"swag": {"score": 3, "baseline_or_shift": "baseline|shift", "quote": "", "note": ""},
"language_diffs": ["exact phrase changes vs last 1-2 calls"],
"unsaid": ["last call's hot topic missing, numbers asked and not given"],
"seeds": ["PATTERN_TAG"],
"pm_summary": ["6-8 bullets, readable in 90 seconds, no trade recommendation"]
}`;

const SYS = `You are Call Surgeon, the forensic transcript and language quant for Odessa Fund (Odessa Research Stack, Bot 1), working inside the Odesa app.
You do not summarize earnings calls. You extract tradable LANGUAGE signals: constraints, specific opportunities, strains, tone shifts, vague or underprepared answers,
and swagger that is new or mismatched to the numbers. You never pick stocks, build ladders, or give trades, price targets of your own, options structures or sizing.
Answer ONLY with JSON.

HARD RULES (v0.5)
1. Every flag needs an exact quote (copied from the transcript, no edits, no ellipses), speaker, role, section (Prepared / Q&A), and date.
2. Prefer the delta against the SAME speaker's last 1-2 appearances over raw sentiment. Mark each flag vs prior: same / upgrade / downgrade / first mention / shift / math step-down / first quantified.
   Use web search to read the prior quarter's call for the same speakers. If you couldn't re-read it, write "not re-verified" and lower confidence.
3. Split Prepared Remarks and Q&A. Never blend them into one tone score. The tone_shift describes each separately.
4. Generic TAM, "huge opportunity", "we're excited" is never an opportunity. An opportunity must be specific: named product, node, region, customer type, MW, $ amount or timeline.
5. Swag is a flag only when it's a shift from that executive's baseline or doesn't match the numbers or the Q&A detail. A CEO claim the CFO doesn't echo is itself a flag.
6. Never invent suppliers, numbers, price targets or trades. Use null when a source doesn't state a number; never zero, never an estimate.
7. When two figures for the same item conflict inside one source, use neither: add a data-quality TRANSCRIPT-DISCREPANCY flag and a caveat.
8. Third-party transcripts: use speaker-attributed text only; ignore inserted summaries; note transcription artifacts as caveats.
9. Results, segments and guidance come only from the 8-K / press release, the 10-Q if available, and the transcripts. "derived" only when every input is a stated figure.

WHAT YOU SCORE
A. Constraints / strains: lead time, allocation, qualification, yield, capacity, labor, permitting, interconnect, power, transformers, switchgear, substrate, HBM, packaging,
   cooling, water, turbines, "cannot energize", "warm shells", push-outs, destock, double-order, cancellations, pricing giveback; capex guide raised or broken vs last call;
   free-cash-flow pressure; metrics withdrawn ("not planning to share"); timeline slips and goalpost shifts (a later date or slower cadence is "lowered"); candid admissions
   ("to be honest, we're missing", "not perfect"); customer-bandwidth gates; one-time benefits in the base; related-party / cross-book income; governance conflicts;
   guide trims and hedged guides; mix-shift margin headwinds; FX masking a structural cause; customer concentration.
B. Specific opportunities: named demand, share gains with evidence, pricing power, new qualified capacity with a date, guide raises and new hard numeric guides,
   named customer / MW / $ / timeline specifics, supply leaned in ahead of demand.
C. Language downgrades (moving right = weaker): exceptional > strong > solid > in line > consistent with; expect > anticipate > hope to > working toward;
   robust demand > healthy > stable > mixed.
D. Preparation / vagueness: restates the script; ends on "we'll have to see"; answers a number with a strategy paragraph; high hedges and zero numbers; off-topic pivot;
   jokes on a serious constraint question. Quote the 2-4 worst exchanges. Prep score 1-5 (5 = evasive).
E. Swag: superlatives in Q&A not in the script; unprompted TAM; "no one else can"; long answers with low numeric density. Score 1-5 and say baseline or shift.
F. Analyst pressure / unsaid: topics asked by 3+ analysts; topics deferred; last call's hot topic that vanished; numbers asked for and not given; an exec missing vs last call.
Numbers that don't reconcile are high value: operating vs net income, CEO claim vs CFO guide, call vs filing wording, segment vs total confusion, share-count changes.

SEVERITY (constraint flags): 5 = binding/structural; 4 = breaks a prior guide or promise; 3 = material but bounded (earnings quality, governance, concentration);
2 = watch item (FX, mix, fluid tariffs); 1 = minor/context.
SOURCE WEIGHTS: earnings call 1.00; investor day 0.90; bank conference 0.85; named exec interview 0.80; utility/PUC filing 0.75; 8-K/10-Q 0.70; LEAK_PUB 0.65;
official X 0.45; C-suite X 0.40; other officers X 0.20; replies/anonymous 0.00 (never). High confidence needs weight >= 0.80, or >= 0.65 plus a confirming source >= 0.70.

You are given the CURRENT transcript and, when available, the PRIOR quarter's transcript. Use the prior transcript for every vs-prior delta.
Ranking: constraint flags by severity then weight; opportunities by how hard the number is (CFO guide > CEO claim) then size; segments by revenue.
Research for a professional, not advice.`;

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/[–—]/g, "-").replace(/[^a-z0-9$%.\-]+/g, " ").replace(/\s+/g, " ").trim();

async function meta(t: string) {
  const c = await kvGet<any>(`callmeta:${t}`, null);
  if (c && Date.now() - Date.parse(c.at) < 12 * 3600000) return c;
  let tr: any = null; try { tr = await ROIC.latest(t); } catch (_) { /* none */ }
  const m = { at: new Date().toISOString(), date: tr?.date ? String(tr.date).slice(0, 10) : null, year: tr?.year ?? null, quarter: tr?.quarter ?? null, has: !!tr?.content };
  await kvSet(`callmeta:${t}`, m); return { ...m, content: tr?.content ?? null };
}

/** Starts a breakdown of the latest call. */

const LANG_SHAPE = `{
"quarter": "Q3 2026", "confidence": "High|Medium|Low",
"headline": "one sentence: what happened, with the key numbers said on the call",
"verdict": "one or two sentences: what changed vs the last call and what actually matters",
"guidance": [{"item": "", "value": "", "note": "prior value from the last call, or first guide", "direction": "raised|cut|new|held"}],
"call": [{"kind": "challenge|opportunity", "title": "short headline", "quote": "exact words copied from the transcript, 15-60 words", "speaker": "Name (Role)", "why": "why it matters, with numbers"}],
"flags": [{"kind": "constraint|opportunity|swag|data-quality", "tag": "CAPEX-GUIDE-BREAK", "severity": 4, "weight": 1.0, "quote": "exact words", "speaker": "Name (Role)", "section": "Prepared|Q&A", "vs_prior": "", "note": ""}],
"tone_shift": {"prepared": "", "qa": "", "summary": ""},
"prep": {"score": 3, "exchanges": [{"asked": "analyst (firm): what was asked", "answer": "how it was dodged, short quote"}]},
"swag": {"score": 3, "baseline_or_shift": "baseline|shift", "quote": "", "note": ""},
"language_diffs": [""], "unsaid": [""], "seeds": ["PATTERN_TAG"], "pm_summary": ["6-8 bullets, no trade recommendation"], "notes": ["caveats"]
}`;
const STREET_SHAPE = `{
"quarter": "Q3 2026", "report_date": "YYYY-MM-DD",
"results": [{"metric": "Revenue|Gross profit|Operating income|Net income|EPS diluted|Gross margin|Operating margin|Adj. EBITDA|Free cash flow",
  "actual": "$14.58B", "est": "$12.72B or null", "est_source": "LSEG (via CNBC)", "est_url": "", "est_date": "YYYY-MM-DD", "est_label": "consensus revenue",
  "others": [{"value": "", "source": "", "url": ""}], "beat": "beat|miss|inline|none", "surprise": "+$1.86B · +14.6%", "yoy": "+161.4% YoY (from $5.58B)", "prior_q": "$7.81B or null", "derived": false, "note": ""}],
"drivers": [{"segment": "", "formerly": "", "revenue": "$7.56B", "share_pct": 51.9, "yoy_pct": 830, "est": "$6.47B or null", "est_source": "", "est_url": "", "est_date": "", "others": [], "surprise": "+$1.09B · +16.8% vs estimate", "surprise_pct": 16.8, "detail": ["2-4 short facts"]}],
"targets": {"window": "YYYY-MM-DD to YYYY-MM-DD", "raised": 0, "cut": 0, "kept": 0, "rows": [{"firm": "", "analyst": "", "rating": "", "from": 0, "to": 0, "date": "YYYY-MM-DD", "url": ""}]},
"down_the_line": [{"ticker": "", "name": "", "relation": "Supplier|Partner|Competitor|Customer", "read": "Good sign|Mixed|Bad sign", "role": "how they're connected", "what": "what it could mean", "fact": "the fact it rests on", "url": ""}],
"notes": ["data caveats"]
}`;
const STREET_SYS = `You gather the Street view of one company's latest earnings for an experienced wealth manager. Use web search. Answer ONLY with JSON.
Results: reported actuals from the earnings press release / 8-K vs consensus (name each estimate's source and date; null if none; never invent). Mark figures you computed from the 8-K as derived.
Drivers: business segments ranked by dollar surprise vs estimate (or by revenue if no estimates), with share of revenue and YoY.
Targets: every analyst price-target change in the week after the report, top ~20 firms first, with from/to and date; count raised, cut and kept.
Down the line: 3-6 other US-listed companies affected (suppliers, partners, competitors, customers), each tied to a specific fact from the report or call.
Short words, numbers over adjectives. Research, not advice.`;

const XAI = (body: any) => sql`select net.http_post(url := 'https://api.x.ai/v1/responses', body := ${sql.json(body as never)}::jsonb,
  headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'XAI_API_KEY'), 'Content-Type', 'application/json'),
  timeout_milliseconds := 240000) as id`;

// Deferred Grok job: xAI holds the work and we pick it up later, so nothing waits on an open connection (no time limit, no shared queue).
export async function deferredSubmit(body: any): Promise<string> {
  const k = await (await import("./db.ts")).key("XAI_API_KEY");
  const r = await fetch("https://api.x.ai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, deferred: true }), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.request_id) throw new Error(`Grok wouldn't start the breakdown (${r.status})`);
  return j.request_id;
}
export async function deferredPoll(id: string): Promise<{ status_code: number; content: string } | null> {
  const k = await (await import("./db.ts")).key("XAI_API_KEY");
  const r = await fetch(`https://api.x.ai/v1/chat/deferred-completion/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r || r.status === 202) return null;
  return { status_code: r.status, content: await r.text() };
}

async function priorTranscript(t: string, latest: any) {
  try {
    const k = await (await import("./db.ts")).key("ROIC_API_KEY"); if (!k) return null;
    const { call } = await import("./net.ts");
    const list = await call("roic", `https://api.roic.ai/v2/company/earnings-calls/list/${encodeURIComponent(t)}?apikey=${encodeURIComponent(k)}`, { timeoutMs: 15000 });
    const prev = (Array.isArray(list) ? list : []).find((x: any) => !(x.year === latest.year && x.quarter === latest.quarter));
    if (!prev) return null;
    const r = await call("roic", `https://api.roic.ai/v2/company/earnings-calls/transcript/${encodeURIComponent(t)}?year=${prev.year}&quarter=${prev.quarter}&apikey=${encodeURIComponent(k)}`, { timeoutMs: 20000 });
    return r?.content ? { year: prev.year, quarter: prev.quarter, date: String(prev.date ?? "").slice(0, 10), content: String(r.content) } : null;
  } catch { return null; }
}

/** Starts a breakdown of the latest call: two Grok calls side by side (language read + Street view). */
export async function start(t: string) {
  t = t.toUpperCase();
  const cur = await kvGet<any>(`call:${t}`, null);
  if (cur?.status === "running" && Date.now() - Date.parse(cur.started) < 8 * 60000) return { status: "running", started: cur.started, call_date: cur.call_date };
  const cap = Number((await kvGet<any>("settings", {})).grok_cap_usd ?? 300), spent = await monthCost("grok");
  if (spent + 1 > cap) throw new Error(`Grok monthly cap would be passed ($${spent.toFixed(2)} of $${cap} used). Raise it in Settings.`);
  let tr: any = null; try { tr = await ROIC.latest(t); } catch (_) { /* none */ }
  if (!tr?.content) { const v = { status: "none", checked: new Date().toISOString() }; await kvSet(`call:${t}`, v); return v; }
  const date = String(tr.date ?? "").slice(0, 10);
  const prior = await priorTranscript(t, tr);
  const langUser = `Company: ${t}. Earnings call for fiscal ${tr.year ?? ""} Q${tr.quarter ?? ""}, held ${date}.\nReturn JSON matching:\n${LANG_SHAPE}\n\n` +
    `CURRENT TRANSCRIPT:\n${String(tr.content).slice(0, 100000)}\n\n` + (prior ? `PRIOR QUARTER TRANSCRIPT (fiscal ${prior.year} Q${prior.quarter}, ${prior.date}):\n${prior.content.slice(0, 45000)}` : "PRIOR QUARTER TRANSCRIPT: not available. Mark deltas as not re-verified.");
  const streetUser = `Company: ${t}. Latest earnings: fiscal ${tr.year ?? ""} Q${tr.quarter ?? ""}, call held ${date}. Today is ${new Date().toISOString().slice(0, 10)}.\nReturn JSON matching:\n${STREET_SHAPE}`;
  const a = { id: "d:" + await deferredSubmit({ model: GROK_FAST, messages: [{ role: "system", content: SYS + (await rulesText(true)) }, { role: "user", content: langUser }] }) };
  const [b] = await XAI({ model: GROK_FAST, input: [{ role: "system", content: STREET_SYS }, { role: "user", content: streetUser }], tools: [{ type: "web_search" }], max_turns: 5 });
  const v = { status: "running", started: new Date().toISOString(), reqs: { lang: a.id, street: b.id }, parts: {}, cost: 0, call_date: date, year: tr.year, quarter: tr.quarter,
    transcript: String(tr.content).slice(0, 200000), prior_date: prior?.date ?? null };
  await kvSet(`call:${t}`, v);
  return { status: "running", started: v.started, call_date: date };
}

function readResponse(resp: any) {
  let j: any = null; try { j = JSON.parse(resp.content); } catch { /* cut off */ }
  const cost = Number(j?.usage?.cost_in_usd_ticks ?? 0) / 1e10;
  let text = ""; const cites: any[] = [];
  for (const ch of j?.choices ?? []) text += ch?.message?.content ?? "";
  for (const it of j?.output ?? []) if (it.type === "message") for (const p of it.content ?? []) { text += p.text ?? ""; for (const a of p.annotations ?? []) if (a.url) cites.push({ url: a.url, title: a.title }); }
  const r = resp.status_code === 200 ? parseJson(text) : null;
  return { r: r && typeof r === "object" && !Array.isArray(r) ? r : null, cost, cites, err: resp.timed_out ? "timed out" : resp.status_code !== 200 ? `Grok error ${resp.status_code ?? ""}` : null };
}
function merge(cur: any) {
  const L = cur.parts.lang?.r ?? {}, S = cur.parts.street?.r ?? {};
  const T = norm(cur.transcript ?? "");
  for (const c of L.call ?? []) { const q = norm(c.quote); c.verified = q.length > 12 && T.includes(q); if (!c.verified) c.quote_unverified = c.quote, c.quote = null; }
  for (const f of L.flags ?? []) { const q = norm(f.quote); f.verified = q.length > 8 && T.includes(q); if (!f.verified) f.quote_unverified = f.quote, f.quote = null; }
  const notes = [...(S.notes ?? []), ...(L.notes ?? [])];
  for (const [k, p] of Object.entries(cur.parts as Record<string, any>)) if (p?.err) notes.push(k === "lang" ? `Call Surgeon's language read didn't finish (${p.err}).` : `The Street view didn't finish (${p.err}).`);
  if (!cur.prior_date) notes.push("Last quarter's transcript wasn't available, so changes vs the prior call weren't re-verified.");
  return { ...S, ...L, quarter: L.quarter ?? S.quarter, results: S.results ?? [], drivers: S.drivers ?? [], targets: S.targets ?? null, down_the_line: S.down_the_line ?? [], guidance: L.guidance ?? [], notes,
    citations: [...(cur.parts.street?.cites ?? []), ...(cur.parts.lang?.cites ?? [])].filter((c: any, i: number, a: any[]) => a.findIndex((x) => x.url === c.url) === i).slice(0, 25) };
}

/** The breakdown for a ticker: finished result, a partial one while the other half finishes, or what's available to start. */
export async function get(t: string, models: { id: number; name: string; holdings: any[] }[] = []) {
  t = t.toUpperCase();
  let cur = await kvGet<any>(`call:${t}`, null);
  if (cur?.status === "running" && cur.reqs) {
    for (const part of ["lang", "street"]) {
      if (cur.parts?.[part]) continue;
      const rid = String(cur.reqs[part]);
      const [resp] = rid.startsWith("d:") ? [await deferredPoll(rid.slice(2))] : await sql`select status_code, content, error_msg, timed_out from net._http_response where id = ${cur.reqs[part]}`;
      if (!resp) continue;
      // claim this half so two polls never process (or bill) it twice
      const claimed = await sql`update odesa.kv set v = jsonb_set(v, ${sql.array(["parts", part])}, '{"claimed":true}'::jsonb) where k = ${"call:" + t} and not (v->'parts' ? ${part}) returning k`;
      if (!claimed.length) continue;
      const rr = readResponse(resp);
      if (rr.cost) await sql`insert into odesa.feed_usage(day, source, calls, cost, last_ok) values (current_date, 'grok', 1, ${rr.cost}, now())
        on conflict (day, source) do update set calls = odesa.feed_usage.calls + 1, cost = odesa.feed_usage.cost + ${rr.cost}, last_ok = now()`;
      cur.parts[part] = { r: rr.r, cites: rr.cites.slice(0, 20), err: rr.r ? null : (rr.err ?? "unreadable reply") }; cur.cost = (cur.cost ?? 0) + rr.cost;
      await sql`update odesa.kv set v = jsonb_set(jsonb_set(v, ${sql.array(["parts", part])}, ${sql.json(cur.parts[part])}), '{cost}', ${sql.json(cur.cost)}) where k = ${"call:" + t}`;
    }
    cur = await kvGet<any>(`call:${t}`, cur);
    const done = ["lang", "street"].filter((p) => cur.parts?.[p] && !cur.parts[p].claimed);
    const expired = Date.now() - Date.parse(cur.started) > 8 * 60000;
    if (done.length === 2 || expired) {
      for (const p of ["lang", "street"]) if (!cur.parts?.[p] || cur.parts[p].claimed) cur.parts[p] = { r: null, err: "took too long" };
      const any = cur.parts.lang.r || cur.parts.street.r;
      cur = any ? { status: "done", at: new Date().toISOString(), call_date: cur.call_date, year: cur.year, quarter: cur.quarter, cost: cur.cost, result: merge(cur) }
        : { status: "error", error: "The breakdown didn't finish. Try again." };
      await kvSet(`call:${t}`, cur);
    } else {
      const partial = done.length ? merge({ ...cur, parts: { lang: done.includes("lang") ? cur.parts.lang : null, street: done.includes("street") ? cur.parts.street : null } }) : null;
      if (partial) partial.notes = partial.notes.filter((n: string) => !/didn't finish/.test(n));
      return { status: "running", started: cur.started, call_date: cur.call_date, partial, waiting: ["lang", "street"].filter((p) => !done.includes(p)) };
    }
  }
  if (cur?.status === "running" && !cur.reqs) { // an older single-call run
    if (Date.now() - Date.parse(cur.started) > 8 * 60000) { cur = { status: "error", error: "The breakdown took too long. Try again." }; await kvSet(`call:${t}`, cur); }
    else return { status: "running", started: cur.started, call_date: cur.call_date };
  }
  if (cur?.status === "done") {
    const r = cur.result;
    for (const x of r.down_the_line ?? []) { const tk = String(x.ticker ?? "").toUpperCase();
      x.models = models.map((m) => { const h = (m.holdings ?? []).find((h: any) => String(h.t).toUpperCase() === tk); return h ? { name: m.name, w: h.w } : null; }).filter(Boolean); }
    const m = await meta(t); const newer = m.date && cur.call_date && m.date > cur.call_date ? m.date : null;
    return { status: "done", at: cur.at, call_date: cur.call_date, result: r, newer, source: cur.source ?? "Call Surgeon" };
  }
  const m = await meta(t);
  return { status: cur?.status === "error" ? "error" : m.has ? "ready" : "none", error: cur?.error, call_date: m.date, year: m.year, quarter: m.quarter };
}
