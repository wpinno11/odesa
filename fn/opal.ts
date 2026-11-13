// Opal: one sentence of news -> checked, patterned, three levels deep, three directions, then-what, thrive/danger and a seven-rung trade ladder.
// The Grok call runs inside the database (pg_net) so it can take a few minutes without hitting the function's time limit.
import { sql, kvGet, monthCost } from "./db.ts";
import { MD, GROK_DEEP, parseJson } from "./feeds.ts";
import { overlap } from "./signals.ts";

const SHAPE = `{
"title": "short title for this news",
"headline": {"value": "one big number", "label": "what the number is"},
"check": {"verdict": "confirmed|partly|rumor|unclear", "confidence": 0-100, "summary": "one line", "count": {"value": "", "label": ""},
          "facts": [{"text": "", "source": "", "url": "", "date": "YYYY-MM-DD"}]},
"pattern": {"summary": "what the places/companies involved have in common", "big": {"value": "", "label": ""},
            "places": [{"name": "", "detail": "", "value": ""}], "traits": [{"trait": "", "strength": 0-100, "evidence": ""}]},
"levels": [{"level": 1, "title": "who is hit directly", "big": {"value": "", "label": ""},
            "items": [{"ticker": "", "name": "", "cap": "small|mid|large", "impact": "up|down", "why": "<=20 words", "number": "the key figure"}]},
           {"level": 2, "title": "what that causes", "big": {}, "items": []},
           {"level": 3, "title": "who relied on it / who wins", "big": {}, "items": []}],
"branches": [{"name": "branch name", "chain": ["step", "step", "step"], "tickers": [""]}],
"next": [{"move": "a natural reaction that has NOT happened yet", "why": "incentive, precedent, hints, money", "likelihood": "low|medium|high",
          "fails_if": "", "signs": ["early warning sign to watch"], "beneficiaries": [""], "precedent": "a real past case, or empty",
          "then_what": [{"change": "what else shifts if this happens", "tickers": [""], "confidence": 0-100}]}],
"board": {"thrive": [{"ticker": "", "name": "", "cap": "", "why": "", "score": 0-100}], "danger": [{"ticker": "", "name": "", "cap": "", "why": "", "score": 0-100}]},
"ladder": [{"rung": "headliners|suppliers|side_effects|under_radar|derivatives|long_shots|down_the_road",
            "ideas": [{"ticker": "", "name": "", "cap": "small|mid|large", "direction": "long|short|avoid", "how": "shares|call|put|put sale|pair|spread",
                       "timing": "now|weeks|months", "rides": "which next[] move or level it depends on", "why": "<=25 words", "priced_in": "", "kills_it": "", "confidence": 0-100}]}],
"sources": [{"title": "", "url": "", "date": "YYYY-MM-DD"}]
}`;

const SYS = `You are Opal, a research engine for an experienced wealth manager. Given one sentence of market news, think several levels deep and answer ONLY with JSON.
Rules:
1. Check it first with live X and web search: is it real, where, how many, when. Be honest when it is a rumor or thin.
2. Look for what the affected places or companies have in common (politics, power prices, water, zoning, lenders, suppliers, customers) and say how strong each link is.
3. Go three levels deep: direct hits, what that causes, who relied on it and who wins. Use real US-listed tickers (or ADRs) and say small, mid or large cap. Prefer numbers to adjectives.
4. Follow several branches at once (for example: where it moves, what gets scarce, who owns the scarce thing, off-grid or substitute solutions).
5. Give exactly three "next" moves: natural reactions that have not happened yet but plausibly will, with early warning signs, and for each, "then_what" second-order changes.
6. Fill all seven ladder rungs, obvious to hidden: headliners, suppliers, side effects (places and other parties that gain from the shift), under-the-radar small caps,
   sneaky derivatives (supplier of the supplier, ETFs with hidden weight, pairs, option structures), long shots, and down-the-road ideas tied to a warning sign.
   Include at least one at-risk name (short, put or avoid) where it exists.
7. Every figure must come from a source you found; put the date. If you estimate, say "est." in the value. Never invent tickers. Short words, no long paragraphs.
These are research ideas for a professional to evaluate, not personal advice.`;

export async function start(question: string) {
  const q = question.replace(/\s+/g, " ").trim().slice(0, 500);
  if (q.length < 6) throw new Error("Type a sentence about the news first.");
  const cap = Number((await kvGet<any>("settings", {})).grok_cap_usd ?? 300), spent = await monthCost("grok");
  const pending = await sql`select count(*)::int n from odesa.opal_runs where status in ('running', 'parsing')`;
  if (spent + 1.5 * pending[0].n + 1.5 > cap) throw new Error(`Grok monthly cap would be passed ($${spent.toFixed(2)} of $${cap} used). Raise it in Settings.`);
  const holdings = (await sql`select name, holdings from odesa.models`).map((m: any) => `${m.name}: ${(m.holdings ?? []).map((h: any) => h.t).join(", ")}`).join("; ");
  const hot = (await overlap(7, 12)).filter((o) => o.count >= 2).map((o) => `${o.ticker} (${o.srcs.join("")})`).join(", ");
  const today = new Date().toISOString().slice(0, 10);
  const user = `Today is ${today}. News: "${q}"\nThe manager's models: ${holdings || "none yet"}. Names already lit up in his Signals feeds (F flow, C congress, X trend, T transcript, P put sale, S sneaky calls, E earnings, Q lobbying/contracts): ${hot || "none"}.\nReturn JSON matching:\n${SHAPE}`;
  const body = { model: GROK_DEEP, input: [{ role: "system", content: SYS }, { role: "user", content: user }],
    tools: [{ type: "x_search", from_date: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) }, { type: "web_search" }], max_turns: 6 };
  const [run] = await sql`insert into odesa.opal_runs(question, status) values (${q}, 'running') returning id`;
  const [req] = await sql`select net.http_post(url := 'https://api.x.ai/v1/responses', body := ${sql.json(body as never)}::jsonb,
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'XAI_API_KEY'), 'Content-Type', 'application/json'),
      timeout_milliseconds := 300000) as id`;
  await sql`update odesa.opal_runs set result = ${sql.json({ req_id: req.id } as never)} where id = ${run.id}`;
  return { id: run.id, status: "running" };
}

function tickersIn(r: any): string[] {
  const s = new Set<string>(); const add = (t: any) => { const x = String(t ?? "").toUpperCase().replace(/^\$/, "").trim(); if (/^[A-Z][A-Z0-9.\-]{0,9}$/.test(x)) s.add(x); };
  for (const l of r.levels ?? []) for (const i of l.items ?? []) add(i.ticker);
  for (const b of r.branches ?? []) for (const t of b.tickers ?? []) add(t);
  for (const n of r.next ?? []) { for (const t of n.beneficiaries ?? []) add(t); for (const w of n.then_what ?? []) for (const t of w.tickers ?? []) add(t); }
  for (const k of ["thrive", "danger"]) for (const i of r.board?.[k] ?? []) add(i.ticker);
  for (const g of r.ladder ?? []) for (const i of g.ideas ?? []) add(i.ticker);
  return [...s];
}

export async function get(id: number) {
  const [run] = await sql`select * from odesa.opal_runs where id = ${id}`;
  if (!run) throw new Error("Not found.");
  const age = Date.now() - new Date(run.created_at).getTime();
  if (run.status === "parsing") {
    if (age > 10 * 60000) { await sql`update odesa.opal_runs set status = 'error', error = 'Opal could not finish. Try again.', finished_at = now() where id = ${id} and status = 'parsing'`;
      return { ...run, status: "error", error: "Opal could not finish. Try again." }; }
    return { id, status: "running", question: run.question, created_at: run.created_at };
  }
  if (run.status !== "running") return run;
  const reqId = run.result?.req_id;
  const [resp] = reqId ? await sql`select status_code, content, error_msg, timed_out from net._http_response where id = ${reqId}` : [];
  if (!resp) {
    if (age > 7 * 60000) {
      await sql`update odesa.opal_runs set status = 'error', error = 'Opal took too long. Try again.', finished_at = now() where id = ${id} and status = 'running'`;
      return { ...run, status: "error", error: "Opal took too long. Try again." };
    }
    return { id, status: "running", question: run.question, created_at: run.created_at };
  }
  // claim the run so two polls never process (or bill) it twice
  const claimed = await sql`update odesa.opal_runs set status = 'parsing' where id = ${id} and status = 'running' returning id`;
  if (!claimed.length) return { id, status: "running", question: run.question, created_at: run.created_at };
  const fail = async (err: string, cost = 0) => {
    await sql`update odesa.opal_runs set status = 'error', error = ${err}, cost = ${cost}, finished_at = now() where id = ${id}`;
    return { ...run, status: "error", error: err };
  };
  if (resp.status_code !== 200) return fail(resp.timed_out ? "Opal timed out. Try again." : `Grok error ${resp.status_code ?? ""} ${String(resp.error_msg ?? "").slice(0, 80)}`.trim());
  let j: any; try { j = JSON.parse(resp.content); } catch { return fail("Grok's reply was cut off. Try again."); }
  const cost = Number(j?.usage?.cost_in_usd_ticks ?? 0) / 1e10;
  await sql`insert into odesa.feed_usage(day, source, calls, cost, last_ok) values (current_date, 'grok', 1, ${cost}, now())
    on conflict (day, source) do update set calls = odesa.feed_usage.calls + 1, cost = odesa.feed_usage.cost + ${cost}, last_ok = now()`;
  let text = ""; const cites: any[] = [];
  for (const it of j.output ?? []) if (it.type === "message") for (const p of it.content ?? []) { text += p.text ?? ""; for (const a of p.annotations ?? []) if (a.url) cites.push({ url: a.url, title: a.title }); }
  const r = parseJson(text);
  if (!r || typeof r !== "object" || Array.isArray(r)) return fail("Opal returned something unreadable. Try again.", cost);
  try {
    // enrich: live price for every ticker named, and whether Signals already flags it
    const tks = tickersIn(r).slice(0, 80);
    let quotes: Record<string, any> = {};
    try { quotes = await MD.quotes(tks); } catch { /* prices are a bonus */ }
    const ov = Object.fromEntries((await overlap(14, 200)).map((o) => [o.ticker, { srcs: o.srcs, score: o.score }]));
    r.tickers = Object.fromEntries(tks.map((t) => [t, { price: quotes[t]?.last ?? null, changepct: quotes[t]?.changepct ?? null, verified: !!quotes[t],
      logo: `https://storage.googleapis.com/uwassets/logos-v2/${t}.png`, signals: ov[t] ?? null }]));
    r.citations = cites.filter((c, i) => cites.findIndex((x) => x.url === c.url) === i).slice(0, 30);
  } catch { r.tickers = r.tickers ?? {}; }
  const [done] = await sql`update odesa.opal_runs set status = 'done', result = ${sql.json(r)}, cost = ${cost}, title = ${String(r.title ?? run.question).slice(0, 120)}, finished_at = now()
    where id = ${id} returning *`;
  return done;
}

export async function list(saved?: boolean) {
  return saved ? await sql`select id, created_at, question, title, status, saved from odesa.opal_runs where saved order by created_at desc limit 100`
    : await sql`select id, created_at, question, title, status, saved from odesa.opal_runs order by created_at desc limit 50`;
}
export async function save(id: number, saved: boolean) { await sql`update odesa.opal_runs set saved = ${saved} where id = ${id}`; return { ok: true }; }
