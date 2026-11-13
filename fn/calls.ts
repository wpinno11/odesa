// Earnings breakdown ("Call Surgeon"): the latest earnings call read against the report and the Street.
// Results vs estimates, what drove it (segments), price-target changes, challenges and opportunities with quotes checked
// word-for-word against the transcript, and read-throughs for other companies. The Grok call runs inside the database
// (pg_net), like Opal, so it can take a few minutes.
import { sql, kvGet, kvSet, monthCost } from "./db.ts";
import { ROIC, GROK_DEEP, parseJson } from "./feeds.ts";
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

STREET LAYER (Odesa adds this, kept separate from your language read): use web search for consensus estimates (name the source and date for each), segment estimates,
and every analyst price-target change in the week after the report. Never let Street data change a language flag.
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
export async function start(t: string) {
  t = t.toUpperCase();
  const cur = await kvGet<any>(`call:${t}`, null);
  if (cur?.status === "running" && Date.now() - Date.parse(cur.started) < 8 * 60000) return cur;
  const cap = Number((await kvGet<any>("settings", {})).grok_cap_usd ?? 300), spent = await monthCost("grok");
  if (spent + 1.5 > cap) throw new Error(`Grok monthly cap would be passed ($${spent.toFixed(2)} of $${cap} used). Raise it in Settings.`);
  let tr: any = null; try { tr = await ROIC.latest(t); } catch (_) { /* none */ }
  if (!tr?.content) { const v = { status: "none", checked: new Date().toISOString() }; await kvSet(`call:${t}`, v); return v; }
  const date = String(tr.date ?? "").slice(0, 10);
  const user = `Company: ${t}. Earnings call for fiscal ${tr.year ?? ""} Q${tr.quarter ?? ""}, held ${date}. Today is ${new Date().toISOString().slice(0, 10)}.\n` +
    `Return JSON matching:\n${SHAPE}\n\nTRANSCRIPT:\n${String(tr.content).slice(0, 110000)}`;
  const body = { model: GROK_DEEP, input: [{ role: "system", content: SYS + (await rulesText(true)) }, { role: "user", content: user }], tools: [{ type: "web_search" }], max_turns: 6 };
  const [req] = await sql`select net.http_post(url := 'https://api.x.ai/v1/responses', body := ${sql.json(body as never)}::jsonb,
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'XAI_API_KEY'), 'Content-Type', 'application/json'),
      timeout_milliseconds := 300000) as id`;
  const v = { status: "running", started: new Date().toISOString(), req_id: req.id, call_date: date, year: tr.year, quarter: tr.quarter, transcript: String(tr.content).slice(0, 200000) };
  await kvSet(`call:${t}`, v);
  return { status: "running", started: v.started, call_date: date };
}

/** The breakdown for a ticker: finished result, progress, or what's available to start. */
export async function get(t: string, models: { id: number; name: string; holdings: any[] }[] = []) {
  t = t.toUpperCase();
  let cur = await kvGet<any>(`call:${t}`, null);
  if (cur?.status === "running") {
    const [resp] = await sql`select status_code, content, error_msg, timed_out from net._http_response where id = ${cur.req_id}`;
    if (!resp) {
      if (Date.now() - Date.parse(cur.started) > 7 * 60000) { cur = { status: "error", error: "The breakdown took too long. Try again." }; await kvSet(`call:${t}`, cur); }
      else return { status: "running", started: cur.started, call_date: cur.call_date };
    } else {
      // claim it so two polls never process (or bill) it twice
      const claimed = await sql`update odesa.kv set v = jsonb_set(v, '{status}', '"parsing"') where k = ${"call:" + t} and v->>'status' = 'running' returning k`;
      if (!claimed.length) return { status: "running", started: cur.started, call_date: cur.call_date };
      let j: any = null; try { j = JSON.parse(resp.content); } catch { /* cut off */ }
      const cost = Number(j?.usage?.cost_in_usd_ticks ?? 0) / 1e10;
      await sql`insert into odesa.feed_usage(day, source, calls, cost, last_ok) values (current_date, 'grok', 1, ${cost}, now())
        on conflict (day, source) do update set calls = odesa.feed_usage.calls + 1, cost = odesa.feed_usage.cost + ${cost}, last_ok = now()`;
      let text = ""; const cites: any[] = [];
      for (const it of j?.output ?? []) if (it.type === "message") for (const p of it.content ?? []) { text += p.text ?? ""; for (const a of p.annotations ?? []) if (a.url) cites.push({ url: a.url, title: a.title }); }
      const r = resp.status_code === 200 ? parseJson(text) : null;
      if (!r || typeof r !== "object" || Array.isArray(r)) {
        cur = { status: "error", error: resp.status_code === 200 ? "The breakdown came back unreadable. Try again." : `Grok error ${resp.status_code ?? ""}`.trim() };
      } else {
        // quotes must appear word-for-word in the transcript
        const T = norm(cur.transcript ?? "");
        for (const c of r.call ?? []) { const q = norm(c.quote); c.verified = q.length > 12 && T.includes(q); if (!c.verified) c.quote_unverified = c.quote, c.quote = null; }
        for (const f of r.flags ?? []) { const q = norm(f.quote); f.verified = q.length > 8 && T.includes(q); if (!f.verified) f.quote_unverified = f.quote, f.quote = null; }
        r.citations = cites.filter((c, i) => cites.findIndex((x) => x.url === c.url) === i).slice(0, 25);
        cur = { status: "done", at: new Date().toISOString(), call_date: cur.call_date, year: cur.year, quarter: cur.quarter, cost, result: r };
      }
      await kvSet(`call:${t}`, cur);
    }
  }
  if (cur?.status === "done") {
    // tag read-through names that are in the manager's models
    const r = cur.result;
    for (const x of r.down_the_line ?? []) { const tk = String(x.ticker ?? "").toUpperCase();
      x.models = models.map((m) => { const h = (m.holdings ?? []).find((h: any) => String(h.t).toUpperCase() === tk); return h ? { name: m.name, w: h.w } : null; }).filter(Boolean); }
    // a newer call is out?
    const m = await meta(t); const newer = m.date && cur.call_date && m.date > cur.call_date ? m.date : null;
    return { status: "done", at: cur.at, call_date: cur.call_date, result: r, newer, source: cur.source ?? "Call Surgeon" };
  }
  const m = await meta(t);
  return { status: cur?.status === "error" ? "error" : m.has ? "ready" : "none", error: cur?.error, call_date: m.date, year: m.year, quarter: m.quarter };
}
