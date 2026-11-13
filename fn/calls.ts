// Earnings breakdown ("Call Surgeon"): the latest earnings call read against the report and the Street.
// Results vs estimates, what drove it (segments), price-target changes, challenges and opportunities with quotes checked
// word-for-word against the transcript, and read-throughs for other companies. The Grok call runs inside the database
// (pg_net), like Opal, so it can take a few minutes.
import { sql, kvGet, kvSet, monthCost } from "./db.ts";
import { ROIC, GROK_DEEP, parseJson } from "./feeds.ts";

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
"notes": ["short data caveats"]
}`;

const SYS = `You are Call Surgeon, an earnings analyst for an experienced wealth manager. Read the earnings call transcript you are given, then use web search for the
company's earnings press release / 8-K, consensus estimates (name the source and date for each estimate), segment estimates, and every analyst price-target change in the
week after the report. Answer ONLY with JSON.
Rules:
1. Results: the reported actuals vs consensus. If no estimate exists say null; never invent one. Mark figures you calculated from the 8-K as derived=true.
2. What drove it: business segments ranked by dollar surprise vs estimate (or by size if no estimates).
3. Price targets: the top ~20 firms first; from→to and date; count raised, cut and kept.
4. From the call: 4-6 items, a mix of challenges and opportunities. The quote MUST be copied exactly from the transcript (no edits, no ellipses). Say who said it.
   Look hard for things management glossed over, guidance that quietly changed vs prior calls, one-time items, and numbers that don't add up.
5. Down the line: 3-6 other US-listed companies affected (suppliers, partners, competitors, customers), each tied to a specific fact.
6. Short words, numbers over adjectives. This is research for a professional, not advice.`;

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
  const body = { model: GROK_DEEP, input: [{ role: "system", content: SYS }, { role: "user", content: user }], tools: [{ type: "web_search" }], max_turns: 6 };
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
    return { status: "done", at: cur.at, call_date: cur.call_date, result: r, newer };
  }
  const m = await meta(t);
  return { status: cur?.status === "error" ? "error" : m.has ? "ready" : "none", error: cur?.error, call_date: m.date, year: m.year, quarter: m.quarter };
}
