// Grow: idea -> plain advice -> compliance-checked explanations by audience and channel.
export const AUDIENCES: Record<string, [string, string]> = {
  young_pros: ["Young professionals", "prospects in their 20s-30s building careers, first serious savings, student loans, 401(k) choices"],
  families: ["Families", "prospects raising kids: college savings, protection, juggling goals"],
  business: ["Business owners", "prospects who own a business: cash flow, retirement plans for owners, succession"],
  pre_retirees: ["Pre-retirees", "prospects 5-15 years from retirement: catch-up, income planning, sequence risk"],
  retirees: ["Retirees", "prospects already retired: income, withdrawals, staying invested, peace of mind"],
  clients: ["Existing clients", "current clients: reassurance, context, what it means for their plan, invite a conversation"],
};
export const CHANNELS = ["LinkedIn", "X", "Facebook", "Instagram", "Email", "Newsletter"];
export const LIMITS: Record<string, number> = { LinkedIn: 3000, X: 280, Facebook: 63206, Instagram: 2200, Email: 4000, Newsletter: 6000 };
export const SHAPES: Record<string, string> = {
  LinkedIn: "3-5 short paragraphs, 120-200 words, strong plain first line, end with 2-3 hashtags",
  X: "one or two sentences under 200 characters before hashtags, end with 2 hashtags",
  Facebook: "warm and plain-spoken, 50-100 words, end with 2-3 hashtags",
  Instagram: "a caption: a hook line, 3-5 short lines, a soft call to talk, then 2-3 hashtags",
  Email: "first line 'Subject: ...', then 120-180 words beginning 'Hi {first name},' ending with an invitation to talk, signed '[Advisor name]'",
  Newsletter: "a newsletter section: a title line, then 3 short paragraphs (150-220 words)",
};
export const BREAK_SYS = "You help Will, a financial advisor, turn a raw idea into clear advice he can explain. Reply ONLY with JSON: " +
  '{"title": a short name for the idea, "summary": 2 plain sentences saying what the idea really is, ' +
  '"advice": 3-5 items of {"heading": 2-5 words, "point": 1-2 sentences of practical, general advice}, covering what it means, why it matters, what someone could consider doing and how to think about timing, ' +
  '"risks": 2-4 short plain lines on risks, trade-offs or who it is NOT right for, ' +
  '"best_for": the 2-3 best-fit audience ids from [young_pros, families, business, pre_retirees, retirees, clients], ' +
  '"questions": 2-3 questions a prospect or client might ask, ' +
  '"avoid": 2-3 short lines on what NOT to say about it (promises, predictions, naming securities as recommendations)}. ' +
  "Rules: general education only; no predictions, guarantees or performance claims; no specific securities as recommendations; never invent statistics, dates or figures (use none); plain English, short sentences.";
export const explainSys = (aud: string) => `Write marketing explanations of one idea for a financial advisor's ${AUDIENCES[aud][0]} audience (${AUDIENCES[aud][1]}), for compliance review. ` +
  "Follow FINRA Rule 2210 and the SEC Marketing Rule: fair and balanced, mention a relevant risk or limit, no promissory, exaggerated or predictive claims, no guarantees, no testimonials, " +
  "no performance figures, no specific securities as recommendations, and NO numbers, statistics, dates or percentages at all. Do not add a disclosure (it is appended automatically). " +
  "Voice: warm, plain, confident without hype, written to that audience. Reply ONLY with JSON with exactly these keys, each value the finished text: " + JSON.stringify(SHAPES);

const V = "(?:beat|outperform|double|triple|soar|skyrocket|rise|climb|grow|gain|rally|recover|rebound|bounce|deliver|earn|pay(?:s)? off|make (?:you|money)|fall|drop|crash|decline|plunge|tank|surge|jump|spike|increase|appreciate|return|yield|go (?:up|down)|keep (?:rising|falling|going)|outpace|win|lose)";
const PROMISE = new RegExp(
  "\\b(?:will|won['’]t|going to|gonna|sure to|certain to|bound to|guaranteed to|poised to|set to|on track to|expected to|about to)\\s+(?:\\w+\\s+){0,3}?" + V + "\\b" +
  "|['’]ll\\s+(?:\\w+\\s+){0,3}?" + V + "\\b" +
  "|\\bbeat(?:s|ing)? the market\\b|\\boutperform|\\bguarantee|\\bpromise|\\brisk[- ]free\\b|\\bno[- ]risk\\b|\\bno downside\\b|\\bcan['’]?t (?:lose|miss|go wrong)\\b|\\bcannot lose\\b" +
  "|\\bsafe (?:bet|investment|haven)\\b|\\block(?:ed)? (?:in|at)\\b|\\beasy money\\b|\\bsure thing\\b|\\btop[- ]performing\\b|\\bnumber one\\b|#1\\b|\\bexpect\\b[^.!?]{0,40}\\b(?:a year|annually|returns?|gains?|income)\\b" +
  "|\\bdouble your\\b|\\btriple your\\b", "gi");
const TESTI = /\bour clients (?:have|will|are|love|say|saw|made|earned|beat|got|enjoy)\b|\bclients? (?:love|rave)\b|\btestimonial/i;
const NUM = /(?<![\w#{])(?!401\(k\)|403\(b\)|457\(b\)|529\b)\$?\d[\d,]*(?:\.\d+)?%?|\b(?:percent|per cent|percentage points?|basis points|double[- ]digits?|triple[- ]digits?|tenfold|twofold|threefold)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\s+(?:percent|times|fold|x\b|grand|thousand|million|billion)/i;
const NEG = /\b(?:not|no|never|isn['’]t|aren['’]t|won['’]t|doesn['’]t|don['’]t|cannot|can['’]t|without|nor)\s*$/i;
const SAFE_WONT = /^won['’]t\s+(?:guarantee|promise|protect)/i;

export function promises(core: string) {
  PROMISE.lastIndex = 0; let m: RegExpExecArray | null;
  while ((m = PROMISE.exec(core))) {
    const txt = m[0];
    if (SAFE_WONT.test(txt)) continue;
    if (/^won['’]t\b/i.test(txt)) return true;
    const pre = core.slice(Math.max(0, m.index - 24), m.index);
    if (/\bnot only\s*$/i.test(pre)) return true;
    if (/^(?:guarantee|promise|risk[- ]free|no[- ]risk)/i.test(txt) && NEG.test(pre)) continue;
    return true;
  }
  return false;
}
export function strict(text: string) {
  const issues: string[] = []; const paras: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const lines: string[] = [];
    for (const line of para.split("\n")) {
      const keep: string[] = [];
      for (const sent of line.split(/(?<=[.!?])\s+/)) {
        const core = sent.replace(/#\w+/g, "");
        const why = promises(core) ? "reads as a promise or prediction" : TESTI.test(core) ? "describes client results (testimonial rules)" : NUM.test(core) ? "uses a number or figure that isn't sourced" : null;
        if (why) { const s = sent.trim(); issues.push(`“${s.slice(0, 90)}${s.length > 90 ? "…" : ""}” ${why}; removed.`); }
        else keep.push(sent);
      }
      if (keep.length || !line.trim()) lines.push(keep.join(" "));
    }
    paras.push(lines.join("\n").trim());
  }
  return { text: paras.filter(Boolean).join("\n\n").trim(), issues };
}
export function disclosure(channel: string, firm: string) {
  if (channel === "X") return `Not investment advice. Investing involves risk. ${firm}.`;
  return `${firm} · For informational purposes only; not investment advice or a recommendation of any security · Investing involves risk, including possible loss of principal · Past performance does not guarantee future results${channel === "Email" ? " · Unsubscribe" : ""}`;
}
export function comply(text: string, channel: string, firm: string) {
  const disc = disclosure(channel, firm), limit = LIMITS[channel] ?? 3000;
  const s = strict(text); const issues = [...s.issues]; let out = s.text; const remaining: string[] = [];
  const room = limit - disc.length - 2;
  if (out.length > room) { issues.push(`Over the ${limit}-character limit for ${channel} with the disclosure; shortened.`); out = out.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "") + "…"; }
  if (out.replace(/#\w+/g, "").trim().length < 25) remaining.push("Too little is left after the fixes. Regenerate or rewrite it.");
  return { text: out, original: issues.length ? text : null, status: !issues.length ? "passed" : remaining.length ? "needs_edits" : "fixed",
    issues, remaining, disclosure: disc, chars: out.length + disc.length + 2, limit };
}
