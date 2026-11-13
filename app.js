"use strict";
// Odesa: personal markets app. All data comes from the odesa-api function in Supabase; keys never reach this page.
const API = "https://uqvtnvrzflcrpyqlwdgv.supabase.co/functions/v1/odesa-api";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = () => $("#app");
const safeUrl = (u) => /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; // never render javascript: or other schemes from outside data
let TOKEN = null; try { TOKEN = localStorage.getItem("odesa_token"); } catch (_) {}
const MEM = {}; // small in-memory cache per session

async function api(path, opts = {}) {
  const o = { method: opts.method || (opts.body ? "POST" : "GET"), headers: { "Content-Type": "application/json" } };
  if (TOKEN) o.headers.Authorization = "Bearer " + TOKEN;
  if (opts.body) o.body = JSON.stringify(opts.body);
  let r;
  try { r = await fetch(API + path, o); } catch (_) { throw new Error("Can't reach Odesa. Check your connection."); }
  let d = null; try { d = await r.json(); } catch (_) {}
  if (r.status === 401 && !path.startsWith("/auth")) { logout(true); throw new Error("Please log in."); }
  if (!r.ok) throw new Error((d && d.error) || "Something went wrong.");
  return d;
}
function logout(silent) { TOKEN = null; try { localStorage.removeItem("odesa_token"); } catch (_) {} if (!silent) api("/auth/logout", { body: {} }).catch(() => {}); showLogin(); }

// ---------------------------------------------------------------- formatting
const F = {
  money(n, d = 0) { if (n === null || n === undefined || isNaN(n)) return "–"; const a = Math.abs(n); const s = n < 0 ? "−" : "";
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`; if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`; if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`; if (a >= 1e4 && d === 0) return `${s}$${Math.round(a / 1e3)}K`;
    return `${s}$${a.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`; },
  usd(n) { return n === null || n === undefined || isNaN(n) ? "–" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  px(n) { return n === null || n === undefined ? "–" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  pct(n, d = 2, sign = true) { if (n === null || n === undefined || isNaN(n)) return "–"; return (sign && n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d) + "%"; },
  chg(q) { return q && q.changepct !== null && q.changepct !== undefined ? F.pct(q.changepct * 100) : "–"; },
  cls(n) { return n > 0 ? "up" : n < 0 ? "down" : "muted"; },
  date(s) { if (!s) return ""; const d = new Date(String(s).length === 10 ? s + "T12:00:00" : s); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); },
  ago(s) { if (!s) return ""; const m = (Date.now() - new Date(s).getTime()) / 60000; if (m < 1) return "now"; if (m < 60) return Math.round(m) + "m"; if (m < 1440) return Math.round(m / 60) + "h"; return Math.round(m / 1440) + "d"; },
  bps(b) { return (b / 100).toFixed(b % 100 ? 1 : 0) + "%"; },
};
const SRC = { F: ["Flow", "Unusual Whales"], C: ["Congress", "Unusual Whales"], X: ["X trend", "Grok"], T: ["Transcript", "ROIC + Grok"], P: ["Put sale", "Overlay bot"],
  S: ["Sneaky call", "Overlay bot"], E: ["Earnings IV", "IV check"], Q: ["Lobbying & contracts", "Quiver"] };
const ORDER = "FCXTPSEQ".split("");
const dot = (k, size = 22, on = true) => on ? `<span class="dot" title="${SRC[k] ? SRC[k][0] : k}" style="background:var(--${k});width:${size}px;height:${size}px;border-radius:${size / 2}px;font-size:${Math.max(10, size / 2)}px">${k}</span>`
  : `<span class="dot off" style="width:${size}px;height:${size}px"></span>`;
const logo = (t, size = 34) => `<img class="logo" style="width:${size}px;height:${size}px" src="https://storage.googleapis.com/uwassets/logos-v2/${esc(t)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
const tk = (t, extra = "") => `<a class="tk" href="#stock/${esc(t)}"><img src="https://storage.googleapis.com/uwassets/logos-v2/${esc(t)}.png" alt="" onerror="this.remove()">${esc(t)}${extra}</a>`;
const spinner = (msg = "") => `<div class="empty"><span class="spin"></span>${msg ? `<div style="margin-top:10px">${esc(msg)}</div>` : ""}</div>`;
function toast(msg, ms = 2600) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
const ICON = {
  today: '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4"/></svg>',
  portfolio: '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/></svg>',
  options: '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/></svg>',
  grow: '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V11"/><path d="M12 11c0-4 3-7 8-7 0 5-3 7-8 7z"/><path d="M12 14c0-3-2.5-5-7-5 0 4 2.5 5 7 5z"/></svg>',
  opal: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="7" ry="9"/><path d="M9 7.5c1.6-1.2 3.9-1.1 5.3.4M8.6 14.5l2.4-2.4 2 2 2.4-2.6"/></svg>',
  research: '<svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/><path d="M7.5 12l2-2.2 1.6 1.4 2.4-2.8"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};
function tabbar(active) {
  const t = (id, label, href) => `<a href="${href}" class="${active === id ? "on" : ""}" aria-label="${label}">${ICON[id]}${label}</a>`;
  return `<nav class="tabs" aria-label="Sections">${t("today", "Today", "#today")}${t("research", "Research", "#research")}${t("portfolio", "Portfolio", "#portfolio")}
    <a href="#opal" class="opal" aria-label="Opal"><span>${ICON.opal}</span>Opal</a>${t("options", "Options", "#options")}${t("grow", "Grow", "#grow")}</nav>`;
}
let CUR_TAB = "today";
function page(html, tab = CUR_TAB) { CUR_TAB = tab; document.querySelectorAll(".sheet-bg").forEach((x) => x.remove()); app().innerHTML = `<div class="wrap">${html}</div>${tabbar(tab)}`; window.scrollTo(0, 0); }
function fill(sel, html) { const el = $(sel); if (el) el.innerHTML = html; }
function err(e) { return `<div class="empty">${esc(e.message || e)}</div>`; }
function sheet(html) {
  const bg = document.createElement("div"); bg.className = "sheet-bg"; bg.innerHTML = `<div class="sheet">${html}</div>`;
  bg.addEventListener("click", (e) => { if (e.target === bg) bg.remove(); }); document.body.appendChild(bg); return bg;
}
function hdr(title, { back, sub, right = "", light = false, top = "" } = {}) {
  return `<div class="hdr ${light ? "light" : ""}">${back ? `<div class="row between"><button class="back" onclick="${back === "hist" ? "history.back()" : `location.hash='${back}'`}">‹ Back</button>${right}</div>` : top}
    <h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>`;
}
function spark(vals, w = 64, h = 26, up) {
  if (!vals || vals.length < 2) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals), n = vals.length; up = up ?? vals[n - 1] >= vals[0];
  const d = vals.map((v, i) => `${i ? "L" : "M"}${(i * (w - 2) / (n - 1) + 1).toFixed(1)},${(h - 2 - (v - lo) / (hi - lo || 1) * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

// ---------------------------------------------------------------- login (setup code once, then a passcode on each device)
function showLogin() {
  api("/auth/status").then((s) => loginView(s.has_passcode)).catch(() => loginView(true));
}
function loginView(hasPass) {
  let pin = "";
  const draw = (msg = "") => {
    app().innerHTML = `<div class="login">
      <div style="width:64px;height:64px;border-radius:32px;border:3px solid var(--brass);display:flex;align-items:center;justify-content:center">${ICON.opal}</div>
      <h1 style="margin:16px 0 0;font-size:30px;letter-spacing:-.02em">Odesa</h1>
      ${hasPass ? `<p style="margin:6px 0 0;color:rgba(255,255,255,.72)">Enter your passcode</p>` :
        `<p style="margin:6px 0 0;color:rgba(255,255,255,.72);text-align:center;max-width:300px">First time: enter the setup code, then choose a passcode (6 digits or more).</p>
         <div class="field" style="margin-top:16px;width:260px"><input id="setup" placeholder="Setup code" autocapitalize="characters" autocomplete="one-time-code"></div>`}
      <div class="pins">${Array.from({ length: Math.max(6, pin.length) }, (_, i) => `<i class="${i < pin.length ? "f" : ""}"></i>`).join("")}</div>
      <p style="min-height:22px;margin:14px 0 0;color:#FFD3CE;font-size:15px;text-align:center">${esc(msg)}</p>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((k) => k === "" ? "<span></span>" : `<button data-k="${k}">${k}</button>`).join("")}</div>
      <button class="btn" id="go" style="margin-top:22px;width:260px;background:#fff;color:var(--navy)">${hasPass ? "Unlock" : "Set passcode"}</button></div>`;
    const setup = $("#setup"); if (setup && draw.setup) setup.value = draw.setup;
    $$(".keypad button").forEach((b) => b.onclick = () => { if (setup) draw.setup = setup.value; const k = b.dataset.k; pin = k === "⌫" ? pin.slice(0, -1) : (pin + k).slice(0, 12); draw(); });
    $("#go").onclick = async () => {
      if (setup) draw.setup = setup.value;
      if (pin.length < 6) return draw("Use at least 6 digits.");
      $("#go").disabled = true;
      try {
        const device = /iPad/.test(navigator.userAgent) ? "iPad" : /iPhone/.test(navigator.userAgent) ? "iPhone" : "Computer";
        const r = hasPass ? await api("/auth/login", { body: { passcode: pin, device } }) : await api("/auth/setup", { body: { passcode: pin, setup_code: draw.setup || "", device } });
        TOKEN = r.token; try { localStorage.setItem("odesa_token", TOKEN); } catch (_) {}
        location.hash = location.hash || "#today"; route();
      } catch (e) { pin = ""; draw(e.message); }
    };
  };
  draw();
}

// ---------------------------------------------------------------- Today
async function vToday() {
  const now = new Date();
  page(`<div class="hdr light" style="padding-top:calc(22px + var(--safe-t))"><div class="row between">
      <div><div class="eyebrow">${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div><h1 style="margin-top:4px">Today</h1></div>
      <div class="row"><a href="#search" aria-label="Search" style="width:44px;height:44px;border-radius:22px;background:#fff;display:flex;align-items:center;justify-content:center;color:var(--ink)">${ICON.search}</a>
      <a href="#settings" aria-label="Settings" style="width:44px;height:44px;border-radius:22px;background:#fff;display:flex;align-items:center;justify-content:center;color:var(--ink)">${ICON.gear}</a></div></div></div>
    <a href="#opal" class="card navy" style="display:flex;gap:12px;align-items:center;text-decoration:none"><span style="width:40px;height:40px;border-radius:20px;border:2px solid var(--brass);display:flex;align-items:center;justify-content:center;flex:none">${ICON.opal}</span>
      <div><div style="font-size:17px;font-weight:600">What's moving?</div><div class="small" style="color:rgba(255,255,255,.7)">Type a headline. Opal traces it three levels deep.</div></div></a>
    <div id="t-body">${spinner()}</div>`, "today");
  try {
    const d = await api("/today"); MEM.today = d;
    fill("#t-body", `
      <div class="chips" style="padding-top:12px">${d.pulse.map((q) => `<a class="chip" href="#stock/${esc(q.t)}" style="height:auto;padding:8px 12px;flex-direction:column;align-items:flex-start;gap:2px;text-decoration:none">
        <span class="tiny muted" style="font-weight:600">${esc(q.t)}</span><span class="n" style="font-size:16px">${F.px(q.last)}</span><span class="n tiny ${F.cls(q.changepct)}">${F.chg(q)}</span></a>`).join("")}</div>
      <div class="cols">
      <div>
      <div class="sec"><h2 class="h2">Signals lit up</h2><a href="#signals" class="small" style="font-weight:600;text-decoration:none">All</a></div>
      ${d.overlaps.length ? `<div class="card pad0">${d.overlaps.map((o) => `<a class="li" href="#stock/${esc(o.ticker)}">${logo(o.ticker)}<div class="grow1"><div style="font-size:17px;font-weight:700">${esc(o.ticker)}</div>
          <div class="row" style="gap:3px;margin-top:3px">${o.srcs.map((s) => dot(s, 17)).join("")}</div></div><div class="n" style="font-size:22px;font-weight:700">${o.score}</div></a>`).join("")}</div>`
        : `<div class="card"><div class="empty" style="padding:8px">No names are flagged by two or more feeds yet. The bots check every five minutes while the market is open.</div></div>`}
      <div class="grid2" style="margin:12px 16px 0">
        <a href="#options" class="card" style="margin:0;text-decoration:none;color:inherit"><div class="eyebrow">New ideas</div><div class="big n" style="margin-top:6px">${d.new_ideas}</div></a>
        <a href="#options/tracking" class="card" style="margin:0;text-decoration:none;color:inherit"><div class="eyebrow">Tracking</div><div class="big n" style="margin-top:6px">${d.open_trades}</div></a></div>
      ${d.earnings.length ? `<a href="#earnings" class="card amber" style="display:block;text-decoration:none;color:inherit"><div class="eyebrow" style="color:var(--amber)">Earnings options</div>
        ${d.earnings.map((e) => `<div class="row between" style="margin-top:8px"><span style="font-weight:700">${esc(e.ticker)} <span class="muted small" style="font-weight:400">${F.date(e.date)}</span></span><span class="pill" style="background:${e.tag === "cheap" ? "#FDEBD3" : "#FDE7E4"};color:${e.tag === "cheap" ? "var(--amber)" : "var(--down)"}">${e.tag} · ${Math.round(e.ratio * 100)}%</span></div>`).join("")}</a>` : ""}
      </div><div>
      <div class="sec"><h2 class="h2">Alerts</h2><span class="small muted">${d.market_open ? "Market open" : "Market closed"}</span></div>
      <div class="card pad0">${d.events.length ? d.events.map((e) => `<div class="li"><div class="grow1"><div style="font-size:15px;font-weight:600">${esc(e.title)}</div>${e.body ? `<div class="small muted">${esc(e.body)}</div>` : ""}</div><span class="tiny muted">${F.ago(e.ts)}</span></div>`).join("")
        : `<div class="empty">Ideas, overlaps and trade alerts will show here.</div>`}</div>
      <div class="sec"><h2 class="h2">Models</h2><a href="#portfolio" class="small" style="font-weight:600;text-decoration:none">Portfolio</a></div>
      <div class="card pad0">${d.models.map((m) => `<a class="li" href="#portfolio/${m.id}"><div class="grow1" style="font-weight:600">${esc(m.name)}</div><span class="small muted">${m.holdings ? m.holdings + " holdings" : "add holdings"}</span><span class="muted">›</span></a>`).join("")}</div>
      </div></div>`);
  } catch (e) { fill("#t-body", err(e)); }
}

// ---------------------------------------------------------------- Portfolio
async function getModels(force) { if (!MEM.models || force) MEM.models = await api("/models"); return MEM.models; }
async function vPortfolio(id) {
  page(`${hdr("Portfolio", { light: true, top: `<div style="height:calc(10px + var(--safe-t))"></div>` })}<div id="p-body">${spinner()}</div>`, "portfolio");
  try {
    const ms = await getModels(true);
    const m = ms.find((x) => String(x.id) === String(id)) || ms[0];
    if (!m) return fill("#p-body", `<div class="card"><div class="empty">No models yet.</div><a class="btn primary" href="#manager">Create a model</a></div>`);
    const h = m.holdings || [];
    let q = {}; try { q = h.length ? await api("/quotes?s=" + h.filter((x) => !x.cash).map((x) => x.t).join(",")) : {}; } catch (_) {}
    const tot = h.reduce((s, x) => s + x.w, 0);
    fill("#p-body", `<div class="chips" style="padding-top:4px">${ms.map((x) => `<a class="chip ${x.id === m.id ? "on" : ""}" href="#portfolio/${x.id}">${esc(x.name)}</a>`).join("")}<a class="chip" href="#manager">+ Model</a></div>
      <div class="grid3" style="margin:12px 16px 0">
        <a class="card" href="#calc/${m.id}" style="margin:0;text-decoration:none;color:inherit;text-align:center;padding:14px 6px"><div style="font-size:22px">🧮</div><div class="small" style="font-weight:600;margin-top:4px">Share calculator</div></a>
        <a class="card" href="#rebalance/${m.id}" style="margin:0;text-decoration:none;color:inherit;text-align:center;padding:14px 6px"><div style="font-size:22px">⚖️</div><div class="small" style="font-weight:600;margin-top:4px">Rebalance</div></a>
        <a class="card" href="#manager/${m.id}" style="margin:0;text-decoration:none;color:inherit;text-align:center;padding:14px 6px"><div style="font-size:22px">✏️</div><div class="small" style="font-weight:600;margin-top:4px">Edit model</div></a></div>
      <div id="p-perf">${h.length ? `<div class="card" style="margin-top:12px;height:120px"></div>` : ""}</div>
      <div class="card pad0" style="margin-top:12px">
        <div class="row between" style="padding:12px 0 6px"><h2 class="h2">${esc(m.name)}</h2><span class="small ${tot === 10000 ? "up" : "down"}">${h.length} holdings · ${F.bps(tot)}</span></div>
        ${h.length ? h.map((x) => { const qq = q[x.t] || {}; return `<a class="li" href="${x.cash ? "#" : "#stock/" + esc(x.t)}">${x.cash ? `<span class="logo" style="display:flex;align-items:center;justify-content:center">💵</span>` : logo(x.t)}
          <div class="grow1"><div style="font-weight:700">${esc(x.t)}</div><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.n || "")}</div></div>
          <div style="text-align:right"><div class="n" style="font-weight:600">${x.cash ? "Cash" : F.px(qq.last)}</div><div class="n tiny ${F.cls(qq.changepct)}">${x.cash ? "" : F.chg(qq)}</div></div>
          <div class="n" style="width:56px;text-align:right;font-weight:700">${F.bps(x.w)}</div></a>`; }).join("")
        : `<div class="empty">This model has no holdings yet.<br><a href="#manager/${m.id}" class="btn primary" style="margin-top:12px">Add holdings</a></div>`}</div>
      <div class="sec"><h2 class="h2">Watchlist</h2><a href="#watchlist" class="small" style="font-weight:600;text-decoration:none">Edit</a></div><div id="p-watch" class="card pad0">${spinner()}</div>`);
    if (h.length) perfCard(m);
    api("/watchlist").then((w) => fill("#p-watch", w.map((x) => `<a class="li" href="#stock/${esc(x.t)}">${logo(x.t, 30)}<div class="grow1" style="font-weight:700">${esc(x.t)}</div>
      <div class="n" style="font-weight:600">${F.px(x.last)}</div><div class="n small ${F.cls(x.changepct)}" style="width:64px;text-align:right">${F.chg(x)}</div></a>`).join("") || `<div class="empty">Empty.</div>`)).catch((e) => fill("#p-watch", err(e)));
  } catch (e) { fill("#p-body", err(e)); }
}

// ---------------------------------------------------------------- Track record ($1M hypothetical), compare, stats
const PERIODS = [["1D", 0], ["1W", 7], ["1M", 30], ["3M", 91], ["YTD", -1], ["1Y", 365], ["All", null]];
const isoAdd = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
/** Daily points incl. today's live value. */
function perfSeries(p) { return [...p.points, ...(p.live ? [{ d: p.live.d, nav: p.live.nav, live: true }] : [])]; }
function periodCut(key) {
  const t = todayET(); const P = PERIODS.find((x) => x[0] === key);
  if (!P || P[1] === null || P[1] === 0) return null; if (P[1] === -1) return isoAdd(t.slice(0, 4) + "-01-01", -1); return isoAdd(t, -P[1]);
}
function periodsAvailable(p) { const start = p.points[0].d; return PERIODS.filter(([k, n]) => n === null || n === 0 || (periodCut(k) && start <= periodCut(k))).map((x) => x[0]); }
function slicePeriod(series, key) { const c = periodCut(key); if (!c) return series; let i = 0; for (let k = 0; k < series.length; k++) if (series[k].d <= c) i = k; return series.slice(i); }
const PLABEL = { "1D": "Today", "1W": "Past week", "1M": "Past month", "3M": "Past 3 months", YTD: "This year", "1Y": "Past year", All: "Since start" };

/** Clean line chart with touch scrubbing. series: [{ pts:[{x, y, label}], color, dash, fill }] */
function lineChart(el, series, { h = 210, onScrub, baseline } = {}) {
  const W = Math.max(280, el.clientWidth || 340), H = h, pad = { l: 2, r: 2, t: 14, b: 22 };
  const all = series.flatMap((s) => s.pts.map((p) => p.y)).concat(baseline !== undefined ? [baseline] : []);
  let lo = Math.min(...all), hi = Math.max(...all); if (hi - lo < 1e-9) { hi += 1; lo -= 1; } const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
  const n = Math.max(...series.map((s) => s.pts.length));
  const X = (i) => pad.l + (n <= 1 ? (W - pad.l - pad.r) / 2 : i * (W - pad.l - pad.r) / (n - 1)), Y = (v) => pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b);
  const path = (s) => s.pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const gid = "g" + Math.random().toString(36).slice(2, 7);
  const main = series[0];
  const xl = main.pts.length > 1 ? [0, Math.floor((main.pts.length - 1) / 2), main.pts.length - 1].map((i) => `<text x="${Math.min(W - 34, Math.max(34, X(i)))}" y="${H - 5}" text-anchor="middle" font-size="11" fill="var(--gray2)">${esc(main.pts[i].label || "")}</text>`).join("") : "";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="display:block;touch-action:pan-y" role="img" aria-label="Value chart">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${main.color}" stop-opacity=".18"/><stop offset="1" stop-color="${main.color}" stop-opacity="0"/></linearGradient></defs>
    ${baseline !== undefined ? `<line x1="0" x2="${W}" y1="${Y(baseline)}" y2="${Y(baseline)}" stroke="#D5D7DB" stroke-dasharray="3 4"/>` : ""}
    ${main.pts.length > 1 ? `<path d="${path(main)} L${X(main.pts.length - 1)},${H - pad.b} L${X(0)},${H - pad.b} Z" fill="url(#${gid})"/>` : ""}
    ${series.slice().reverse().map((s) => s.pts.length > 1 ? `<path d="${path(s)}" fill="none" stroke="${s.color}" stroke-width="${s.dash ? 1.8 : 2.4}" ${s.dash ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round" stroke-linecap="round"/>` : `<circle cx="${X(0)}" cy="${Y(s.pts[0].y)}" r="4" fill="${s.color}"/>`).join("")}
    ${(main.marks || []).map((i) => `<circle cx="${X(i)}" cy="${Y(main.pts[i].y)}" r="4" fill="#fff" stroke="var(--brass)" stroke-width="2"/>`).join("")}
    ${xl}<g class="scrub" style="display:none"><line y1="${pad.t - 6}" y2="${H - pad.b}" stroke="var(--gray2)" stroke-width="1"/>${series.map((s) => `<circle r="5" fill="${s.color}" stroke="#fff" stroke-width="2"/>`).join("")}</g></svg>`;
  const svg = el.querySelector("svg"), g = svg.querySelector(".scrub");
  const at = (ev) => { const r = svg.getBoundingClientRect(); const x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W; return Math.max(0, Math.min(n - 1, Math.round((x - pad.l) / ((W - pad.l - pad.r) / Math.max(1, n - 1))))); };
  const show = (i) => { g.style.display = ""; g.querySelector("line").setAttribute("x1", X(i)); g.querySelector("line").setAttribute("x2", X(i));
    g.querySelectorAll("circle").forEach((c, k) => { const p = series[k].pts[Math.min(i, series[k].pts.length - 1)]; if (!p) return; c.setAttribute("cx", X(Math.min(i, series[k].pts.length - 1))); c.setAttribute("cy", Y(p.y)); });
    onScrub && onScrub(i); };
  const hide = () => { g.style.display = "none"; onScrub && onScrub(null); };
  if (n > 1) { svg.addEventListener("pointermove", (e) => show(at(e))); svg.addEventListener("pointerdown", (e) => show(at(e))); svg.addEventListener("pointerleave", hide); svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") hide(); }); }
}

/** Small card on the Portfolio screen. */
async function perfCard(m) {
  try {
    const p = await api("/perf/" + m.id); const s = perfSeries(p); const last = s[s.length - 1];
    const prevNav = p.points[p.points.length - 1].nav; const dayRet = p.live ? p.live.ret : (p.points.length > 1 ? p.points[p.points.length - 1].ret : 0);
    const total = last.nav / 1e6 - 1; const vals = s.map((x) => x.nav);
    fill("#p-perf", `<a class="card" href="#perf/${m.id}" style="display:block;text-decoration:none;color:inherit;margin-top:12px">
      <div class="row between"><div class="eyebrow">Track record · $1M hypothetical</div><span class="muted">›</span></div>
      <div class="row between" style="margin-top:8px;align-items:flex-end"><div><div class="big n">${F.usd(last.nav).replace(/\.\d\d$/, "")}</div>
        <div class="n small ${F.cls(dayRet)}" style="font-weight:600;margin-top:4px">${F.pct(dayRet * 100)} ${p.live ? "today" : p.points.length > 1 ? "last session" : ""}</div></div>
        <div style="text-align:right">${vals.length > 1 ? spark(vals, 110, 40, total >= 0) : `<div class="tiny muted" style="max-width:150px">${p.trading_day && p.now_mins < 570 ? "Starts at today's 9:30 open" : "Starts at the next open"}</div>`}
        <div class="tiny muted n" style="margin-top:4px">${F.pct(total * 100)} since ${F.date(p.inception.slice(0, 10))}</div></div></div></a>`);
  } catch (e) { fill("#p-perf", ""); }
}

async function vPerf(id) {
  page(`${hdr("Track record", { back: "#portfolio/" + id })}<div id="pf-body">${spinner()}</div>`, "portfolio");
  const st = { period: null, vs: "", window: "since", cmp: null, statsTab: "val", stats: null, intra: null };
  let p, ms;
  try { [p, ms] = await Promise.all([api("/perf/" + id), getModels()]); } catch (e) { return fill("#pf-body", err(e)); }
  const avail = periodsAvailable(p);
  st.period = p.live || (p.trading_day && p.now_mins >= 570) ? "1D" : "All";
  const draw = async () => {
    const backtest = st.cmp && st.cmp.backtest;
    const vsLabel = st.cmp && st.cmp.b ? st.cmp.b.label : "";
    fill("#pf-body", `
      <div style="padding:14px 20px 0"><div class="small muted">${esc(p.name)} · $1,000,000 hypothetical, started ${new Date(p.inception).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
        <div class="big n" id="pf-val" style="font-size:40px;margin-top:6px">–</div>
        <div class="n" id="pf-chg" style="font-size:16px;font-weight:600;margin-top:6px">&nbsp;</div>
        <div class="small muted" id="pf-when" style="margin-top:2px">&nbsp;</div></div>
      <div class="card" style="padding:10px 6px 4px"><div id="pf-chart"></div></div>
      ${backtest ? "" : `<div class="seg light" style="margin:12px 16px 0">${avail.map((k) => `<button class="${st.period === k ? "on" : ""}" data-p="${k}">${k}</button>`).join("")}</div>`}
      <div class="row" style="margin:12px 16px 0;gap:8px;flex-wrap:wrap">
        <button class="chip ${st.cmp && st.cmp.b ? "on" : ""}" id="pf-cmp">${st.cmp && st.cmp.b ? "Compared with " + esc(vsLabel) : "＋ Compare"}</button>
        ${st.window !== "since" ? `<span class="chip on">What-if · ${esc(st.window)}</span>` : ""}
        ${st.cmp ? `<button class="chip" id="pf-clear">Clear</button>` : ""}</div>
      ${backtest ? `<p class="tiny muted" style="margin:8px 20px 0;line-height:1.4">What-if: today's weights held for the whole ${esc(st.window)}, rebalanced to target every day. This is a backtest, not the model's real record.</p>` : ""}
      <div id="pf-legend"></div>
      <div class="sec"><h2 class="h2">Model stats</h2><span class="small muted">${st.cmp && st.cmp.b ? "vs " + esc(vsLabel) : ""}</span></div>
      <div class="seg light" style="margin:0 16px"><button data-t="val" class="${st.statsTab === "val" ? "on" : ""}">Valuation</button><button data-t="mix" class="${st.statsTab === "mix" ? "on" : ""}">Mix</button><button data-t="risk" class="${st.statsTab === "risk" ? "on" : ""}">Risk</button></div>
      <div id="pf-stats">${spinner()}</div>
      <p class="tiny muted" style="margin:14px 20px 0;line-height:1.45">How it's counted: each trading day the model earns the weighted return of its holdings, rebalanced to its targets. Finished days are locked after 5 pm and never change. Edits start counting the next trading day (or today, if made before the 9:30 open). Cash earns ${F.pct((p.cash_yield ?? 0.04) * 100, 1, false)} a year. Price returns only; dividends aren't added.</p>`);
    $$("[data-p]").forEach((b) => b.onclick = () => { st.period = b.dataset.p; draw(); });
    $$("[data-t]").forEach((b) => b.onclick = () => { st.statsTab = b.dataset.t; draw(); });
    $("#pf-cmp").onclick = () => compareSheet();
    const cl = $("#pf-clear"); if (cl) cl.onclick = () => { st.vs = ""; st.window = "since"; st.cmp = null; st.stats = null; draw(); };
    await drawChart(); drawStats();
  };
  const drawChart = async () => {
    const el = $("#pf-chart"); if (!el) return;
    const val = $("#pf-val"), chg = $("#pf-chg"), when = $("#pf-when");
    const setHero = (nav, from, label, color) => { val.textContent = F.usd(nav).replace(/\.\d\d$/, ""); const d = nav - from, r = from ? nav / from - 1 : 0;
      chg.innerHTML = `<span class="${F.cls(d)}">${d >= 0 ? "+" : "−"}${F.usd(Math.abs(d)).replace(/\.\d\d$/, "")} (${F.pct(r * 100)})</span>`; when.textContent = label; };
    // 1D: today's 5-minute line
    if (st.period === "1D" && !(st.cmp && st.cmp.backtest)) {
      const prev = p.points[p.points.length - 1].nav;
      if (!st.intra) { el.innerHTML = spinner(); try { st.intra = await api(`/perf/${id}/intraday`); } catch (e) { st.intra = { points: [] }; } }
      const pts = st.intra.points.map((x) => ({ y: prev * (1 + x.r), label: new Date(x.ts * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) }));
      if (!pts.length) { const nav = p.live ? p.live.nav : prev; setHero(nav, prev, p.live ? "Today" : "Market closed"); el.innerHTML = `<div class="empty" style="padding:44px 16px">${p.trading_day && p.now_mins < 570 ? "Today's line starts at the 9:30 open." : "No trading yet today. Pick another range."}</div>`; return; }
      const color = pts[pts.length - 1].y >= prev ? "var(--up)" : "var(--down)";
      const now = p.live ? p.live.nav : pts[pts.length - 1].y;
      setHero(now, prev, "Today · live");
      lineChart(el, [{ pts, color }], { baseline: prev, onScrub: (i) => i === null ? setHero(now, prev, "Today · live") : setHero(pts[i].y, prev, pts[i].label) });
      $("#pf-legend").innerHTML = ""; return;
    }
    let A = st.cmp ? st.cmp.a.points : perfSeries(p), B = st.cmp && st.cmp.b ? st.cmp.b.points : null;
    if (!(st.cmp && st.cmp.backtest)) { A = slicePeriod(A, st.period); if (B) { const d0 = A[0].d; const j = B.findIndex((x) => x.d >= d0); B = j >= 0 ? B.slice(j) : B; } }
    const a0 = A[0].nav, b0 = B && B.length ? B[0].nav : 1;
    const lab = (d) => F.date(d);
    const ptsA = A.map((x) => ({ y: x.nav, label: x.start ? "Start" : lab(x.d) + (x.live ? " · live" : ""), d: x.d }));
    const ptsB = B ? B.map((x) => ({ y: x.nav / b0 * a0, label: lab(x.d) })) : null;
    const last = ptsA[ptsA.length - 1]; const up = last.y >= a0; const color = up ? "var(--up)" : "var(--down)";
    const baseLabel = st.cmp && st.cmp.backtest ? `What-if, past ${st.window}` : PLABEL[st.period] || "";
    setHero(last.y, a0, baseLabel);
    const marks = (p.changes || []).map((c) => { const d = new Date(c.at); const ds = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d); return ptsA.findIndex((x) => x.d >= ds); }).filter((i) => i > 0);
    lineChart(el, [{ pts: ptsA, color, marks: st.cmp && st.cmp.backtest ? [] : marks }, ...(ptsB ? [{ pts: ptsB, color: "var(--brass)", dash: true }] : [])], {
      baseline: a0, onScrub: (i) => { if (i === null) return setHero(last.y, a0, baseLabel); setHero(ptsA[i].y, a0, ptsA[i].label); legend(i); } });
    const legend = (i) => { if (!ptsB) { $("#pf-legend").innerHTML = marks.length ? `<p class="tiny muted" style="margin:8px 20px 0">○ marks a day the model's weights changed.</p>` : ""; return; }
      const ia = i ?? ptsA.length - 1, ib = Math.min(i ?? ptsB.length - 1, ptsB.length - 1);
      const ra = ptsA[ia].y / a0 - 1, rb = ptsB[ib].y / a0 - 1;
      $("#pf-legend").innerHTML = `<div class="card" style="padding:12px 16px"><div class="row between"><span class="row small" style="gap:8px"><i style="width:16px;height:3px;border-radius:2px;background:${color};display:inline-block"></i>${esc(st.cmp.a.label)}</span><b class="n ${F.cls(ra)}">${F.pct(ra * 100)}</b></div>
        <div class="row between" style="margin-top:8px"><span class="row small" style="gap:8px"><i style="width:16px;height:0;border-top:2px dashed var(--brass);display:inline-block"></i>${esc(st.cmp.b.label)}</span><b class="n ${F.cls(rb)}">${F.pct(rb * 100)}</b></div>
        <div class="row between small" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)"><span class="muted">Difference</span><b class="n ${F.cls(ra - rb)}">${F.pct((ra - rb) * 100)}</b></div>
        ${st.cmp.notes && st.cmp.notes.length ? `<p class="tiny muted" style="margin:8px 0 0">${st.cmp.notes.map(esc).join(" ")}</p>` : ""}</div>`; };
    legend(null);
  };
  const compareSheet = () => {
    const others = ms.filter((x) => String(x.id) !== String(id));
    const opts = [...(p.changes && p.changes.length ? [["current", "This model's current mix", "What today's weights would have done"]] : []),
      ...others.map((x) => ["model:" + x.id, x.name, "Another of your models"]), ["SPY", "S&P 500", "SPY"], ["QQQ", "Nasdaq 100", "QQQ"], ["IWM", "Russell 2000", "Small caps (IWM)"]];
    let vs = st.vs || (others.length ? "model:" + others[0].id : "SPY"), win = st.window;
    const s = sheet(`<div style="padding:0 18px"><h2 class="h2">Compare</h2>
      <div class="eyebrow" style="margin-top:14px">With</div><div id="cv" style="margin-top:6px"></div>
      <div class="eyebrow" style="margin-top:16px">Over</div>
      <div class="chips" style="padding:8px 0 0;flex-wrap:wrap" id="cw"></div>
      <p class="tiny muted" id="cwn" style="line-height:1.4;margin:8px 0 0"></p>
      <button class="btn primary" id="cgo" style="margin-top:14px">Show</button></div>`);
    const paint = () => {
      $("#cv", s).innerHTML = opts.map(([k, a, b]) => `<button class="li" data-v="${esc(k)}" style="width:100%;background:none;border:0;text-align:left;cursor:pointer;padding:10px 0"><div class="grow1"><div style="font-weight:600">${esc(a)}</div><div class="tiny muted">${esc(b)}</div></div><span style="font-size:20px;color:${vs === k ? "var(--navy)" : "#D5D7DB"}">${vs === k ? "●" : "○"}</span></button>`).join("");
      $("#cw", s).innerHTML = [["since", "Since start"], ["1M", "1M"], ["3M", "3M"], ["6M", "6M"], ["1Y", "1Y"], ["3Y", "3Y"], ["5Y", "5Y"]].map(([k, l]) => `<button class="chip ${win === k ? "on" : ""}" data-w="${k}">${l}</button>`).join("");
      $("#cwn", s).textContent = win === "since" ? "The model's real record next to what the other choice would have done over the same days." : "What-if: both mixes held at today's weights for the whole period, as if you'd owned them back then.";
      s.querySelectorAll("[data-v]").forEach((b) => b.onclick = () => { vs = b.dataset.v; paint(); });
      s.querySelectorAll("[data-w]").forEach((b) => b.onclick = () => { win = b.dataset.w; paint(); });
    };
    paint();
    $("#cgo", s).onclick = async () => { $("#cgo", s).disabled = true; $("#cgo", s).innerHTML = '<span class="spin"></span>';
      try { st.cmp = await api(`/perf/${id}/compare?vs=${encodeURIComponent(vs)}&window=${win}`); st.vs = vs; st.window = win; st.stats = null; if (win === "since" && st.period === "1D") st.period = "All"; s.remove(); draw(); }
      catch (e) { toast(e.message, 4000); $("#cgo", s).disabled = false; $("#cgo", s).textContent = "Show"; } };
  };
  const drawStats = async () => {
    const el = $("#pf-stats"); if (!el) return;
    if (!st.stats) { el.innerHTML = spinner("Gathering stats"); try { st.stats = await api(`/perf/${id}/stats${st.vs ? "?vs=" + encodeURIComponent(st.vs) : ""}`); } catch (e) { el.innerHTML = err(e); return; }
      if ((st.stats.a.fwd_pending || (st.stats.b && st.stats.b.fwd_pending)) && !st.retried) { st.retried = true; setTimeout(() => { if ($("#pf-stats")) { st.stats = null; drawStats(); } }, 45000); } }
    if (!$("#pf-stats")) return;
    el.innerHTML = statsHtml(st.stats, st.statsTab);
  };
  draw();
}
function statsHtml(S, tab) {
  const a = S.a, b = S.b;
  const x = (n) => n === null || n === undefined || isNaN(n) ? "–" : n.toFixed(1) + "×";
  const pc = (n, d = 1) => n === null || n === undefined || isNaN(n) ? "–" : F.pct(n * 100, d, false);
  const sp = (n, d = 1) => n === null || n === undefined || isNaN(n) ? "–" : F.pct(n * 100, d);
  const num2 = (n) => n === null || n === undefined || isNaN(n) ? "–" : n.toFixed(2);
  const row = (label, sub, fa, fb, cls) => `<div class="row between" style="padding:11px 0;border-top:1px solid var(--line)"><div class="grow1" style="padding-right:10px"><div style="font-weight:600;font-size:15px">${label}</div>${sub ? `<div class="tiny muted" style="margin-top:2px">${sub}</div>` : ""}</div>
    <div class="n" style="font-weight:700;font-size:16px;min-width:72px;text-align:right" ${cls ? `class="${cls(fa)}"` : ""}>${fa}</div>${b ? `<div class="n" style="font-weight:600;font-size:15px;min-width:72px;text-align:right;color:var(--brass-t)">${fb}</div>` : ""}</div>`;
  const head = b ? `<div class="row between tiny" style="padding:0 0 8px"><span></span><span class="row" style="gap:0"><b style="min-width:72px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px">${esc(a.label)}</b><b style="min-width:72px;text-align:right;color:var(--brass-t);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px">${esc(b.label)}</b></span></div>` : "";
  const cover = (o) => o && o.cover < 0.95 ? `covers ${Math.round(o.cover * 100)}% of the model` : "";
  if (tab === "val") {
    const V = a.valuation, U = b ? b.valuation : {};
    const pend = a.fwd_pending || (b && b.fwd_pending);
    return `<div class="card">${head}
      ${row("P/E", ["Trailing 12 months", cover(V.pe), V.pe.neg > 0 ? `${Math.round(V.pe.neg * 100)}% in money-losing companies` : ""].filter(Boolean).join(" · "), x(V.pe.v), x(U.pe && U.pe.v))}
      ${row("Forward P/E", pend ? "Being gathered from analyst estimates. Check back in a minute." : ["Next 12 months, analyst consensus", cover(V.fpe)].filter(Boolean).join(" · "), x(V.fpe.v), x(U.fpe && U.fpe.v))}
      ${row("Price / sales", cover(V.ps), x(V.ps.v), x(U.ps && U.ps.v))}
      ${row("Dividend yield", "Cash counted at its yield", pc(V.dy.v, 2), pc(U.dy && U.dy.v, 2))}
      ${row("Earnings growth", "Median holding, past year", sp(V.epsg.v, 0), sp(U.epsg && U.epsg.v, 0))}
      ${row("Below 52-week high", "Weighted average", sp(V.off_hi.v), sp(U.off_hi && U.off_hi.v))}
      <p class="tiny muted" style="margin:10px 0 0;line-height:1.4">P/E figures are averaged the standard way (as earnings yields), so one very expensive stock can't swamp the total. Trailing earnings from ROIC; forward estimates gathered weekly from public analyst consensus.</p></div>`;
  }
  if (tab === "mix") {
    const M = a.mix, N = b ? b.mix : {};
    const bars = (rows, rowsB) => rows.map((r) => { const rb = rowsB ? (rowsB.find((y) => y.name === r.name) || { w: 0 }).w : null;
      return `<div style="margin-top:10px"><div class="row between small"><span style="font-weight:600">${esc(r.name)}</span><span class="n"><b>${F.bps(r.w)}</b>${rowsB ? ` <span style="color:var(--brass-t)">· ${F.bps(rb)}</span>` : ""}</span></div>
        <div style="height:8px;border-radius:4px;background:var(--soft);margin-top:5px;position:relative;overflow:hidden"><i style="position:absolute;left:0;top:0;bottom:0;width:${r.w / 100}%;background:var(--navy);border-radius:4px"></i></div>
        ${rowsB ? `<div style="height:4px;border-radius:2px;background:var(--soft);margin-top:3px;position:relative;overflow:hidden"><i style="position:absolute;left:0;top:0;bottom:0;width:${rb / 100}%;background:var(--brass);border-radius:2px"></i></div>` : ""}</div>`; }).join("");
    const extraB = (rows, rowsB) => rowsB ? rowsB.filter((y) => !rows.find((r) => r.name === y.name)).map((y) => ({ name: y.name, w: 0, _b: y.w })) : [];
    const secs = [...M.sectors, ...extraB(M.sectors, N.sectors)], sizes = [...M.sizes, ...extraB(M.sizes, N.sizes)];
    return `<div class="card">${head}
      ${row("Holdings", "", String(M.n), b ? String(N.n) : "")}
      ${row("Acts like", "Equal-sized positions, given the weights", M.eff_n.toFixed(1), b ? N.eff_n.toFixed(1) : "")}
      ${row("Top 5 weight", "", pc(M.top5, 0), b ? pc(N.top5, 0) : "")}
      ${row("Cash", "", pc(M.cash, 0), b ? pc(N.cash, 0) : "")}
      ${row("Average company size", "Weighted market value", F.money(M.mcap.v), b ? F.money(N.mcap && N.mcap.v) : "")}</div>
      <div class="card"><div class="eyebrow">Sectors</div>${bars(secs, b ? N.sectors : null)}</div>
      <div class="card"><div class="eyebrow">Company size</div>${bars(sizes, b ? N.sizes : null)}
        <p class="tiny muted" style="margin:10px 0 0">Mega $200B+ · Large $10–200B · Mid $2–10B · Small $300M–2B</p></div>
      ${a.earnings.length ? `<div class="card"><div class="eyebrow">Earnings in the next 2 weeks</div>${a.earnings.map((e) => `<div class="row between" style="margin-top:8px"><span>${tk(e.t)}</span><span class="small"><b>${F.date(e.d)}</b> <span class="muted">· ${F.bps(e.w)} of model</span></span></div>`).join("")}</div>` : ""}`;
  }
  const R = a.risk, Q = b ? b.risk : {};
  return `<div class="card">${head}
    <p class="tiny muted" style="margin:0 0 6px;line-height:1.4">Today's weights, held over the past year.</p>
    ${row("1-year return", "", sp(R.ret), sp(Q.ret))}
    ${row("Volatility", "How much it swings, per year", pc(R.vol), pc(Q.vol))}
    ${row("Worst drop", "Peak to bottom", sp(R.mdd), sp(Q.mdd))}
    ${row("Sharpe ratio", `Return per unit of risk, after ${F.pct(R.rf * 100, 1, false)} cash`, num2(R.sharpe), num2(Q.sharpe))}
    ${row("Sortino ratio", "Same, counting only down days", num2(R.sortino), num2(Q.sortino))}
    ${row("Beta", "Moves vs the S&P 500 (1.0 = same)", num2(R.beta ?? R.beta_w), num2(Q.beta ?? Q.beta_w))}
    ${row("Correlation to S&P 500", "1.0 = moves in lockstep", num2(R.corr), num2(Q.corr))}
    ${row("Up / down capture", "Share of the S&P's up and down days it catches", R.up_capture ? `${Math.round(R.up_capture * 100)} / ${Math.round(R.down_capture * 100)}` : "–", Q.up_capture ? `${Math.round(Q.up_capture * 100)} / ${Math.round(Q.down_capture * 100)}` : "–")}
    ${row("Best / worst day", "", R.best !== undefined ? `${sp(R.best)} / ${sp(R.worst)}` : "–", Q.best !== undefined ? `${sp(Q.best)} / ${sp(Q.worst)}` : "–")}
    ${row("Implied volatility", "What options expect, next 30 days", pc(R.iv), pc(Q.iv))}
    ${row("Short interest", "Weighted, share of float", pc(R.short), pc(Q.short))}
    ${R.notes && R.notes.length ? `<p class="tiny muted" style="margin:10px 0 0">${R.notes.map(esc).join(" ")}</p>` : ""}</div>`;
}

async function vCalc(id) {
  page(`${hdr("Share calculator", { back: "#portfolio/" + id, sub: "Type an amount. See whole shares of each holding at live prices." })}<div id="c-body">${spinner()}</div>`, "portfolio");
  const ms = await getModels(); const m = ms.find((x) => String(x.id) === String(id)) || ms[0];
  fill("#c-body", `<div class="chips">${ms.map((x) => `<a class="chip ${x.id === m.id ? "on" : ""}" href="#calc/${x.id}">${esc(x.name)}</a>`).join("")}</div>
    <div class="card"><div class="eyebrow">Amount to invest</div><div class="row" style="margin-top:8px"><span style="font-size:34px;font-weight:700">$</span>
      <input id="amt" inputmode="decimal" placeholder="250,000" style="flex:1;border:0;font-size:34px;font-weight:700;outline:none;min-width:0;background:transparent" class="n"></div>
      <div class="chips" style="padding:10px 0 0">${[10000, 50000, 100000, 250000, 1000000].map((v) => `<button class="chip" data-v="${v}">${F.money(v)}</button>`).join("")}</div>
      <button class="btn primary" id="calc" style="margin-top:12px">Calculate</button></div><div id="c-out"></div>`);
  const run = async () => {
    const v = Number(String($("#amt").value).replace(/[$,\s]/g, "")); if (!v) return toast("Enter an amount.");
    fill("#c-out", spinner("Getting live prices"));
    try {
      const r = await api("/allocate", { body: { model_id: m.id, amount: v } });
      fill("#c-out", `<div class="card navy"><div class="grid3" style="text-align:center">
          <div><div class="n" style="font-size:22px;font-weight:700">${F.money(r.invested, 0)}</div><div class="tiny" style="color:rgba(255,255,255,.7)">invested</div></div>
          <div><div class="n" style="font-size:22px;font-weight:700;color:var(--brass-l)">${F.usd(r.leftover)}</div><div class="tiny" style="color:rgba(255,255,255,.7)">cash left</div></div>
          <div><div class="n" style="font-size:22px;font-weight:700">${F.bps(r.max_drift_bps)}</div><div class="tiny" style="color:rgba(255,255,255,.7)">max drift</div></div></div></div>
        <div class="card pad0">${r.rows.map((x) => `<div class="li"><div class="grow1"><div style="font-weight:700">${esc(x.t)}</div><div class="small muted">${x.status === "ok" ? F.px(x.price) + " · target " + F.bps(x.w_bps) : esc(x.status)}</div></div>
          <div style="text-align:right"><div class="n" style="font-size:20px;font-weight:700">${x.cash ? "—" : x.shares.toLocaleString()}</div><div class="n tiny muted">${F.usd(x.value)}</div></div></div>`).join("")}</div>
        ${r.unpriced.length ? `<div class="card small" style="color:var(--down)">No live price for ${esc(r.unpriced.join(", "))}. Kept in cash.</div>` : ""}
        <p class="tiny muted" style="text-align:center;margin:12px 20px">${r.market_open ? "Live prices" : "Last prices (market closed)"} · whole shares · nothing is traded.</p>`);
    } catch (e) { fill("#c-out", `<div class="card">${err(e)}</div>`); }
  };
  $$("[data-v]").forEach((b) => b.onclick = () => { $("#amt").value = Number(b.dataset.v).toLocaleString(); run(); });
  $("#calc").onclick = run; $("#amt").onkeydown = (e) => { if (e.key === "Enter") run(); };
}

/** Forgiving list reader: "AAPL 9%", "MSFT, 8.5", "8% NVDA", "1. GOOGL – 5%", spreadsheet rows, "AAPL MSFT NVDA",
 *  and pastes where iPhone joins the lines with hidden separators instead of normal line breaks. */
function parseList(text) {
  const STOP = new Set(["THE", "AND", "INC", "CORP", "CO", "LTD", "ETF", "FUND", "TOTAL", "CASH", "USD", "PCT", "NAME", "TICKER", "SYMBOL", "WEIGHT", "TARGET", "SHARES", "PRICE", "VALUE", "CLASS", "MY", "IS", "OF"]);
  const TK = /^\$?([A-Z][A-Z0-9]{0,5}(?:[.\-][A-Z])?)$/;
  const out = [], seen = new Set();
  const lines = String(text).replace(/[^\S \t]+/g, "\n").split(/\n|;/).map((l) => l.replace(/^\s*\d+[.)]\s+/, "").trim()).filter(Boolean);
  const CASHRE = /\b(cash|money\s*market|mmf|sweep|spaxx|swvxx|vmfxx|fdrxx|sweep)\b/i;
  for (const line of lines) {
    if (CASHRE.test(line) && !seen.has("CASH")) {
      const n = (line.match(/\d+(?:\.\d+)?%?/g) || []).find((x) => x.endsWith("%")) ?? (line.match(/\d+(?:\.\d+)?/g) || [])[0];
      seen.add("CASH"); out.push({ t: "CASH", n: "Cash", w: n !== undefined && Number(n.replace("%", "")) <= 100 ? Number(n.replace("%", "")) : null, cash: true }); continue;
    }
    const toks = line.replace(/[()\[\]|•·–—]/g, " ").split(/[\s,\t:]+/).filter(Boolean);
    const tick = toks.map((x, k) => ({ k, m: x.match(TK) })).filter((x) => x.m && !STOP.has(x.m[1]));
    const isNum = (x) => /^\d+(?:\.\d+)?%?$/.test(x || "");
    const val = (x) => Number(String(x).replace("%", ""));
    if (tick.length === 1) {               // one holding on the line: take a % number if there is one, else any number
      const t = tick[0].m[1]; if (seen.has(t)) continue;
      const nums = toks.filter((x, k) => k !== tick[0].k && isNum(x));
      const pick = nums.find((x) => x.endsWith("%")) ?? nums[0];
      seen.add(t); out.push({ t, n: "", w: pick !== undefined && val(pick) <= 100 ? val(pick) : null });
    } else {                               // several on one line: pair each ticker with the number right after it
      for (const { k, m } of tick) { const t = m[1]; if (seen.has(t)) continue;
        const nx = toks[k + 1]; seen.add(t); out.push({ t, n: "", w: isNum(nx) && val(nx) <= 100 ? val(nx) : null }); }
    }
  }
  return out;
}
async function vManager(id) {
  page(`${hdr("Models", { back: "#portfolio", sub: "Edit holdings and targets. Each save keeps the last version so you can undo." })}<div id="m-body">${spinner()}</div>`, "portfolio");
  const ms = await getModels(true); let m = ms.find((x) => String(x.id) === String(id)) || ms[0];
  let H = JSON.parse(JSON.stringify(m ? m.holdings : []));
  try { const p = JSON.parse(sessionStorage.getItem("odesa_add") || "null"); sessionStorage.removeItem("odesa_add");
    if (p && m && String(p.id) === String(m.id)) { const w = Math.round(Number(p.w) * 100); const e = H.find((x) => x.t === p.t);
      if (e) e.w = w; else H.push({ t: p.t, n: String(p.n || "").slice(0, 80), w }); setTimeout(() => toast(`${p.t} added at ${p.w}%. Trim the others to 100%, then Save model.`, 4500), 300); } } catch (_) {}
  const draw = () => {
    const tot = H.reduce((s, x) => s + (Number(x.w) || 0), 0);
    fill("#m-body", `<div class="chips">${ms.map((x) => `<a class="chip ${m && x.id === m.id ? "on" : ""}" href="#manager/${x.id}">${esc(x.name)}</a>`).join("")}<button class="chip" id="newm">+ New model</button></div>
      ${m ? `<div class="card"><div class="eyebrow">Name</div><input id="mname" class="inp" style="margin-top:6px;font-weight:700;font-size:18px" value="${esc(m.name)}"></div>
      <div class="card"><div class="row between"><h2 class="h2">Holdings</h2><button class="btn small soft" id="paste">Paste a list</button></div>
        <div class="field" style="margin-top:12px;height:44px"><input id="addt" placeholder="Add ticker (e.g. NVDA)" autocapitalize="characters"><button class="btn small primary" id="addb">Add</button></div>
        ${H.map((x, i) => `<div class="li" style="cursor:default"><div class="grow1"><div style="font-weight:700">${x.cash ? "💵 Cash" : esc(x.t)}</div><input class="inp" data-n="${i}" value="${esc(x.n || "")}" placeholder="Name (optional)" style="height:30px;font-size:13px;margin-top:4px;border:0;padding:0;background:transparent"></div>
          <div class="row" style="gap:6px"><input class="inp n" data-w="${i}" inputmode="decimal" value="${(x.w / 100).toString()}" style="width:76px;text-align:right"><span class="muted">%</span>
          <button class="btn small soft" data-del="${i}" aria-label="Remove ${esc(x.t)}" style="width:38px;padding:0">✕</button></div></div>`).join("")}
        <div class="row between" style="padding:12px 0 2px;border-top:1px solid var(--line)"><span style="font-weight:600">Total</span><span class="n ${tot === 10000 ? "up" : "down"}" style="font-size:20px;font-weight:700">${F.bps(tot)} ${tot === 10000 ? "✓" : ""}</span></div>
        <div class="grid2" style="margin-top:10px"><button class="btn soft small" id="even">Split evenly</button><button class="btn soft small" id="rcash" ${tot >= 10000 ? "disabled" : ""}>Rest in cash${tot < 10000 ? " (" + F.bps(10000 - tot) + ")" : ""}</button></div></div>
      <div class="grid2" style="margin:14px 16px 0"><button class="btn primary" id="save">Save model</button><button class="btn ghost" id="undo">Undo last save</button></div>
      <button class="btn small soft" id="delm" style="margin:16px auto 0;color:var(--down)">Delete this model</button>` : ""}`);
    $("#newm").onclick = async () => { const n = prompt("Name for the new model?"); if (!n) return; const r = await api("/models", { body: { name: n, holdings: [] } }); MEM.models = null; location.hash = "#manager/" + r.id; };
    if (!m) return;
    $$("[data-w]").forEach((el) => el.oninput = () => { H[el.dataset.w].w = Math.round(Number(el.value) * 100) || 0; const t = H.reduce((s, x) => s + (Number(x.w) || 0), 0); });
    $$("[data-w]").forEach((el) => el.onchange = draw);
    $$("[data-n]").forEach((el) => el.oninput = () => { H[el.dataset.n].n = el.value; });
    $$("[data-del]").forEach((el) => el.onclick = () => { H.splice(Number(el.dataset.del), 1); draw(); });
    const add = () => { const t = $("#addt").value.trim().toUpperCase(); if (!t) return; if (H.find((x) => x.t === t)) return toast(t + " is already in the model."); const isCash = /^(CASH|\$|USD|MONEY MARKET|MMF)$/.test(t);
      if (isCash && H.find((x) => x.cash)) return toast("Cash is already in the model.");
      H.push(isCash ? { t: "CASH", w: Math.max(0, 10000 - H.reduce((a, x) => a + (Number(x.w) || 0), 0)), n: "Cash", cash: true } : { t, w: 0, n: "" }); draw(); };
    $("#addb").onclick = add; $("#addt").onkeydown = (e) => { if (e.key === "Enter") add(); };
    $("#rcash").onclick = () => { const left = 10000 - H.reduce((a, x) => a + (Number(x.w) || 0), 0); if (left <= 0) return; const c = H.find((x) => x.cash); if (c) c.w += left; else H.push({ t: "CASH", n: "Cash", w: left, cash: true }); draw(); toast("Added " + F.bps(left) + " cash. Tap Save model."); };
    $("#even").onclick = () => { if (!H.length) return; const each = Math.floor(10000 / H.length); H.forEach((x, i) => x.w = each + (i < 10000 - each * H.length ? 1 : 0)); draw(); };
    $("#paste").onclick = () => {
      const s = sheet(`<div style="padding:0 18px"><h2 class="h2">Add a list</h2>
        <p class="small muted" style="line-height:1.45">Paste anything: rows copied from a spreadsheet, an email, a statement, or just tickers. Percentages are optional; without them the list is split evenly.</p>
        <textarea class="box" id="pl" rows="9" placeholder="AAPL 9%&#10;MSFT 8.5&#10;NVDA, 8&#10;…or AAPL MSFT NVDA GOOGL"></textarea>
        <div class="row" style="margin-top:10px"><label class="row small"><input type="checkbox" id="plrep" checked> Replace current holdings</label></div>
        <button class="btn primary" id="plok" style="margin-top:12px">Read my list</button><div id="plout"></div></div>`);
      $("#plok", s).onclick = async () => {
        const text = $("#pl", s).value; if (!text.trim()) return toast("Paste your list first.");
        let rows = parseList(text);
        const tickerish = (text.match(/\b[A-Z][A-Z0-9]{0,5}\b/g) || []).filter((w) => w !== "CASH").length;
        const messy = /[a-z]{4,}/.test(text.replace(/\b(cash|money\s*market)\b/gi, "")) || tickerish > rows.length + 2;
        if (!rows.length || messy) {
          $("#plok", s).disabled = true; fill("#plout", spinner("Reading your list"));
          try { const r = await api("/models/parse", { body: { text } }); if (r.length) rows = r.map((x) => ({ t: x.t, n: x.n, w: x.w, cash: x.cash, found: x.found })); }
          catch (e) { if (!rows.length) { fill("#plout", `<p class="small" style="color:var(--down)">${esc(e.message)}</p>`); $("#plok", s).disabled = false; return; } }
          $("#plok", s).disabled = false;
        }
        if (!rows.length) return fill("#plout", `<p class="small" style="color:var(--down)">I couldn't find any tickers in that.</p>`);
        const haveW = rows.some((x) => x.w !== null && x.w !== undefined && !isNaN(x.w));
        let out = rows.map((x) => ({ t: x.t, n: x.n || "", w: haveW ? Math.round((Number(x.w) || 0) * 100) : 0, cash: !!x.cash, found: x.found }));
        if (!haveW) { const each = Math.floor(10000 / out.length); out.forEach((x, k) => x.w = each + (k < 10000 - each * out.length ? 1 : 0)); }
        const show = () => {
        const tot = out.reduce((a, x) => a + x.w, 0); const missing = out.filter((x) => x.found === false).map((x) => x.t);
        fill("#plout", `<div class="card" style="margin:12px 0 0">${out.map((x) => `<div class="row between small" style="padding:4px 0"><b>${esc(x.t)}</b><span class="muted grow1" style="margin-left:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(x.n)}</span><span class="n">${F.bps(x.w)}</span></div>`).join("")}
          <div class="row between" style="margin-top:8px;font-weight:700"><span>${out.length} holdings</span><span class="n ${tot === 10000 ? "up" : "down"}">${F.bps(tot)}</span></div>
          ${missing.length ? `<p class="tiny" style="color:var(--down)">No live price found for ${esc(missing.join(", "))}. Check those tickers.</p>` : ""}
          ${tot < 10000 && tot > 0 ? `<div class="grid2" style="margin-top:8px"><button class="btn small soft" id="plcash">Rest in cash (${F.bps(10000 - tot)})</button><button class="btn small soft" id="plscale">Scale to 100%</button></div>`
            : tot !== 10000 && tot > 0 ? `<button class="btn small soft" id="plscale" style="margin-top:8px;width:100%">Scale to 100%</button>` : ""}
          <button class="btn primary" id="pluse" style="margin-top:10px">Use these ${out.length}</button></div>`);
        const pc = $("#plcash", s); if (pc) pc.onclick = () => { const left = 10000 - tot; const c = out.find((x) => x.cash); if (c) c.w += left; else out.push({ t: "CASH", n: "Cash", w: left, cash: true, found: true }); show(); };
        const sc = $("#plscale", s); if (sc) sc.onclick = () => { const k = 10000 / tot; out.forEach((x) => x.w = Math.round(x.w * k)); const d = 10000 - out.reduce((a, x) => a + x.w, 0); out[0].w += d; show(); };
        $("#pluse", s).onclick = () => { const clean = out.map(({ t, n, w, cash }) => ({ t, n, w, cash }));
          if ($("#plrep", s).checked) H = clean; else for (const x of clean) { const e = H.find((h) => h.t === x.t); if (e) e.w = x.w; else H.push(x); }
          s.remove(); draw(); toast(`Added ${clean.length}. Check the total, then Save model.`); };
        };
        show();
      };
    };
    $("#save").onclick = async () => { try { m.name = $("#mname").value; const r = await api("/models/" + m.id, { body: { name: m.name, holdings: H } }); MEM.models = null; toast("Saved"); m = r; } catch (e) { toast(e.message, 4000); } };
    $("#undo").onclick = async () => { try { await api(`/models/${m.id}/undo`, { body: {} }); MEM.models = null; toast("Restored the previous version"); vManager(m.id); } catch (e) { toast(e.message); } };
    $("#delm").onclick = async () => { if (!confirm(`Delete ${m.name}? This can't be undone.`)) return; await api("/models/" + m.id, { method: "DELETE" }); MEM.models = null; location.hash = "#portfolio"; };
  };
  draw();
}

async function vRebalance(id) {
  page(`${hdr("Rebalance", { back: "#portfolio/" + id, sub: "Enter what you hold. See the whole-share trades that bring it back to target." })}<div id="r-body">${spinner()}</div>`, "portfolio");
  const ms = await getModels(true); const m = ms.find((x) => String(x.id) === String(id)) || ms[0];
  const acct = (m.accounts || [])[0] || { shares: {}, cash: 0 };
  const sh = { ...(acct.shares || {}) }; let cash = Number(acct.cash || 0), thr = 100;
  const draw = () => {
    fill("#r-body", `<div class="chips">${ms.map((x) => `<a class="chip ${x.id === m.id ? "on" : ""}" href="#rebalance/${x.id}">${esc(x.name)}</a>`).join("")}</div>
      <div class="card"><div class="row between"><h2 class="h2">What you hold</h2><span class="small muted">shares</span></div>
        ${(m.holdings || []).filter((x) => !x.cash).map((x) => `<div class="li" style="cursor:default"><div class="grow1" style="font-weight:700">${esc(x.t)} <span class="small muted" style="font-weight:400">target ${F.bps(x.w)}</span></div>
          <input class="inp n" data-s="${esc(x.t)}" inputmode="numeric" value="${sh[x.t] ?? ""}" placeholder="0" style="width:110px;text-align:right"></div>`).join("") || `<div class="empty">Add holdings to this model first.</div>`}
        <div class="li" style="cursor:default"><div class="grow1" style="font-weight:700">Cash</div><input class="inp n" id="cash" inputmode="decimal" value="${cash || ""}" placeholder="0" style="width:110px;text-align:right"></div>
        <div class="row between" style="margin-top:10px"><span class="small">Rebalance when off by</span><div class="row"><button class="btn small soft" id="tm" style="width:38px;padding:0">−</button><span class="n" style="font-weight:700;width:50px;text-align:center">${F.bps(thr)}</span><button class="btn small soft" id="tp" style="width:38px;padding:0">+</button></div></div>
        <button class="btn primary" id="run" style="margin-top:12px">Show trades</button></div><div id="r-out"></div>`);
    $$("[data-s]").forEach((el) => el.oninput = () => { sh[el.dataset.s] = Math.max(0, Math.round(Number(el.value) || 0)); });
    $("#cash").oninput = () => { cash = Number($("#cash").value) || 0; };
    $("#tm").onclick = () => { thr = Math.max(25, thr - 25); draw(); }; $("#tp").onclick = () => { thr = Math.min(1000, thr + 25); draw(); };
    $("#run").onclick = async () => {
      fill("#r-out", spinner("Getting live prices"));
      try {
        await api(`/models/${m.id}/account`, { body: { shares: sh, cash } });
        const r = await api("/rebalance", { body: { model_id: m.id, shares: sh, cash, threshold_bps: thr } });
        const mx = Math.max(300, ...r.rows.map((x) => Math.abs(x.drift_bps)));
        fill("#r-out", `<div class="card navy"><div class="n" style="font-size:38px;font-weight:700;line-height:1">${r.trades.length} trade${r.trades.length === 1 ? "" : "s"}</div>
            <div style="color:rgba(255,255,255,.75);margin-top:4px">bring every holding within ${F.bps(r.max_drift_after_bps)} of target</div>
            <div class="grid2" style="margin-top:12px"><div class="tile" style="background:rgba(255,255,255,.1)"><div class="n" style="font-size:20px;font-weight:700">${F.usd(r.sold)}</div><div class="tiny" style="color:rgba(255,255,255,.7)">sold</div></div>
            <div class="tile" style="background:rgba(255,255,255,.1)"><div class="n" style="font-size:20px;font-weight:700">${F.usd(r.bought)}</div><div class="tiny" style="color:rgba(255,255,255,.7)">bought</div></div></div></div>
          <div class="card"><div class="row between"><h2 class="h2">How far off</h2><span class="tiny muted">under · target · over</span></div>
            ${r.rows.filter((x) => x.price).map((x) => { const w = Math.min(50, Math.abs(x.drift_bps) / mx * 50), flag = Math.abs(x.drift_bps) >= thr, col = x.drift_bps > 0 ? "var(--amber)" : "var(--navy2)";
              return `<div style="display:grid;grid-template-columns:56px 1fr 60px;gap:10px;align-items:center;padding:7px 0"><b>${esc(x.t)}</b><div style="position:relative;height:14px"><div style="position:absolute;left:50%;top:-3px;bottom:-3px;width:1px;background:#C9CDD3"></div>
                <div style="position:absolute;top:2px;height:10px;border-radius:5px;background:${flag ? col : "#D3D6DB"};${x.drift_bps > 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%`}"></div></div>
                <span class="n" style="text-align:right;font-weight:${flag ? 700 : 500};color:${flag ? col : "var(--gray)"}">${F.pct(x.drift_bps / 100, 1)}</span></div>`; }).join("")}</div>
          <div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Trades</h2></div>${r.trades.length ? r.trades.map((t) => `<div class="li"><span class="pill" style="width:52px;justify-content:center;background:${t.action === "sell" ? "#FDECEA" : "#E7F4EA"};color:${t.action === "sell" ? "var(--down)" : "var(--up)"}">${t.action === "sell" ? "Sell" : "Buy"}</span>
              <div class="grow1"><div style="font-size:17px;font-weight:700"><span class="n">${t.shares}</span> ${esc(t.t)}</div><div class="n small muted">at ${F.px(t.price)} · ${F.bps(t.from_bps)} → ${F.bps(t.to_bps)}</div></div><span class="n" style="font-weight:600">${t.action === "sell" ? "−" : "+"}${F.usd(t.amount)}</span></div>`).join("")
              : `<div class="empty">Nothing to do. Everything is within ${F.bps(thr)}.</div>`}
            <div class="row between small muted" style="padding:12px 0;border-top:1px solid var(--line)"><span>Cash after</span><b class="n" style="color:var(--ink)">${F.usd(r.cash_after)}</b></div></div>
          <div class="grid2" style="margin:14px 16px 0"><button class="btn primary" id="copy">Copy trades</button><button class="btn ghost" id="done">Mark as done</button></div>
          <p class="tiny muted" style="text-align:center;margin:10px 20px">Live quotes · whole shares · no orders are sent.</p>`);
        $("#copy").onclick = () => { navigator.clipboard.writeText(r.trades.map((t) => `${t.action.toUpperCase()} ${t.shares} ${t.t}`).join("\n")).then(() => toast("Copied")); };
        $("#done").onclick = async () => { for (const t of r.trades) sh[t.t] = (sh[t.t] || 0) + (t.action === "buy" ? t.shares : -t.shares); cash = r.cash_after;
          await api(`/models/${m.id}/account`, { body: { shares: sh, cash } }); toast("Holdings updated"); draw(); };
      } catch (e) { fill("#r-out", `<div class="card">${err(e)}</div>`); }
    };
  };
  draw();
}

async function vWatchlist() {
  page(`${hdr("Watchlist", { back: "#portfolio", sub: "The bots watch these plus every holding in your models." })}
    <div class="card"><div class="field" style="height:44px"><input id="wt" placeholder="Add ticker" autocapitalize="characters"><button class="btn small primary" id="wa">Add</button></div></div><div id="w-list" class="card pad0">${spinner()}</div>`, "portfolio");
  const load = async (body) => { try { const w = await api("/watchlist", body ? { body } : {}); fill("#w-list", w.map((x) => `<div class="li" style="cursor:default">${logo(x.t, 30)}<div class="grow1" style="font-weight:700">${esc(x.t)}</div>
      <span class="n">${F.px(x.last)}</span><button class="btn small soft" data-rm="${esc(x.t)}" style="width:38px;padding:0">✕</button></div>`).join("") || `<div class="empty">Empty.</div>`);
      $$("[data-rm]").forEach((b) => b.onclick = () => load({ ticker: b.dataset.rm, remove: true })); } catch (e) { toast(e.message); } };
  $("#wa").onclick = () => { const t = $("#wt").value.trim(); if (t) { $("#wt").value = ""; load({ ticker: t }); } };
  load();
}
// ---------------------------------------------------------------- Opal: Ask | Signals | Theses
function opalTop(active) {
  return `<div class="hdr" style="padding-top:calc(18px + var(--safe-t))"><div class="seg" role="tablist" style="max-width:340px">
    ${[["ask", "Ask", "#opal"], ["signals", "Signals", "#signals"], ["theses", "Theses", "#theses"]].map(([k, l, h]) => `<button class="${active === k ? "on" : ""}" onclick="location.hash='${h}'">${l}</button>`).join("")}</div>`;
}
const EXAMPLES = ["Data-center deals are getting voted down in several counties", "Market dropping on AI cyber fears", "Trump threatens to halt defense support for Europe",
  "Rumor of data-center loans freezing up", "Fed signals cuts are off the table"];
async function vOpal() {
  page(`${opalTop("ask")}<h1>What's moving?</h1><p class="sub">Type one sentence. Opal checks it, finds the pattern, goes three levels deep and lays out the trades.</p></div>
    <div class="card"><textarea class="box" id="oq" rows="3" placeholder="e.g. Data-center deals are getting voted down…"></textarea>
      <button class="btn primary" id="ogo" style="margin-top:10px">Trace it</button></div>
    <div class="chips">${EXAMPLES.map((e) => `<button class="chip" data-ex="${esc(e)}">${esc(e)}</button>`).join("")}</div>
    <div class="sec"><h2 class="h2">Recent</h2></div><div id="o-recent" class="card pad0">${spinner()}</div>`, "opal");
  $$("[data-ex]").forEach((b) => b.onclick = () => { $("#oq").value = b.dataset.ex; $("#oq").focus(); });
  $("#ogo").onclick = async () => { const q = $("#oq").value.trim(); if (q.length < 6) return toast("Type a sentence first.");
    $("#ogo").disabled = true; try { const r = await api("/opal", { body: { q } }); location.hash = "#opal/run/" + r.id; } catch (e) { toast(e.message, 4000); $("#ogo").disabled = false; } };
  try { const L = await api("/opal"); fill("#o-recent", L.length ? L.map((r) => `<a class="li" href="#opal/run/${r.id}"><div class="grow1"><div style="font-weight:600">${esc(r.title || r.question)}</div><div class="small muted">${F.date(r.created_at)} · ${r.status === "running" ? "working…" : r.status === "error" ? "didn't finish" : "done"}${r.saved ? " · saved" : ""}</div></div><span class="muted">›</span></a>`).join("") : `<div class="empty">Your traces will show here.</div>`); }
  catch (e) { fill("#o-recent", err(e)); }
}

const OTABS = [["check", "Check"], ["pattern", "Pattern"], ["levels", "3 levels"], ["branches", "Branches"], ["next", "What's next"], ["then", "Then what?"], ["board", "Thrive / Danger"], ["trades", "Trades"], ["sources", "Sources"]];
const RUNGS = { headliners: "Headliners", suppliers: "Suppliers", side_effects: "Side effects", under_radar: "Under the radar", derivatives: "Sneaky derivatives", long_shots: "Long shots", down_the_road: "Down the road" };
async function vOpalRun(id, tab = "check") {
  page(`${opalTop("ask")}<div id="or-h"><h1>Working…</h1></div></div><div id="or-body">${spinner("Opal is checking X and the web, then thinking it through. This takes one to three minutes.")}</div>`, "opal");
  let r;
  for (let i = 0; i < 80; i++) {
    try { r = await api("/opal/" + id); } catch (e) { return fill("#or-body", err(e)); }
    if (r.status !== "running" || !location.hash.startsWith("#opal/run/" + id)) break;
    fill("#or-h", `<h1 style="font-size:24px">${esc(r.question)}</h1><p class="sub">Working… ${Math.round((Date.now() - new Date(r.created_at).getTime()) / 1000)}s</p>`);
    await new Promise((res) => setTimeout(res, 5000));
  }
  if (!location.hash.startsWith("#opal/run/" + id)) return;
  if (r.status === "error") return fill("#or-body", `<div class="card"><div class="empty">${esc(r.error)}</div><button class="btn primary" onclick="api('/opal',{body:{q:${esc(JSON.stringify(r.question))}}}).then(x=>location.hash='#opal/run/'+x.id)">Try again</button></div>`);
  const R = r.result || {}; const T = R.tickers || {};
  const chip = (t) => { const x = T[String(t).toUpperCase()] || {}; return `${tk(String(t).toUpperCase(), x.price ? ` <span class="n" style="font-weight:500">${F.px(x.price)}</span>` : "")}${x.signals ? `<span style="margin-left:-2px">${x.signals.srcs.map((s) => dot(s, 14)).join("")}</span>` : ""}`; };
  const big = (b) => b && b.value ? `<div class="n" style="font-size:40px;font-weight:700;letter-spacing:-.03em;line-height:1">${esc(b.value)}</div><div class="small muted" style="margin-top:4px">${esc(b.label)}</div>` : "";
  fill("#or-h", `<div class="eyebrow" style="color:var(--brass-l);margin-top:14px">Opal</div><h1 style="font-size:26px">${esc(R.title || r.question)}</h1>
    ${R.headline && R.headline.value ? `<div class="row" style="margin-top:12px;background:rgba(255,255,255,.1);border-radius:16px;padding:12px 14px"><span class="n" style="font-size:30px;font-weight:700;color:var(--brass-l)">${esc(R.headline.value)}</span><span class="small" style="color:rgba(255,255,255,.85)">${esc(R.headline.label)}</span></div>` : ""}
    <div class="row" style="margin-top:12px;gap:8px"><button class="btn small" id="osave" style="background:#fff;color:var(--navy)">${r.saved ? "Saved ✓" : "Save as thesis"}</button><span class="tiny" style="color:rgba(255,255,255,.6)">${F.date(r.created_at)} · cost ${F.usd(r.cost)}</span></div>`);
  $("#osave").onclick = async () => { await api(`/opal/${id}/save`, { body: { saved: !r.saved } }); r.saved = !r.saved; $("#osave").textContent = r.saved ? "Saved ✓" : "Save as thesis"; toast(r.saved ? "Saved to Theses" : "Removed from Theses"); };
  const body = {
    check: () => { const c = R.check || {}; const col = { confirmed: "var(--up)", partly: "var(--amber)", rumor: "var(--down)", unclear: "var(--gray)" }[c.verdict] || "var(--gray)";
      return `<div class="card"><div class="row between"><span class="pill" style="background:${col};color:#fff;font-size:14px;padding:6px 12px">${esc((c.verdict || "unclear").toUpperCase())}</span><span class="n" style="font-size:22px;font-weight:700">${c.confidence ?? "–"}<span class="small muted">/100</span></span></div>
        <p style="font-size:17px;line-height:1.4">${esc(c.summary)}</p>${big(c.count)}</div>
        <div class="card pad0">${(c.facts || []).map((f) => `<div class="li" style="cursor:default"><div class="grow1"><div style="font-size:15px">${esc(f.text)}</div><div class="tiny muted">${safeUrl(f.url) ? `<a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">${esc(f.source || "source")}</a>` : esc(f.source)} ${f.date ? "· " + esc(f.date) : ""}</div></div></div>`).join("")}</div>`; },
    pattern: () => { const p = R.pattern || {}; return `<div class="card">${big(p.big)}<p style="font-size:16px;line-height:1.45">${esc(p.summary)}</p></div>
        <div class="card"><h2 class="h2">What they share</h2>${(p.traits || []).map((t) => `<div style="margin-top:12px"><div class="row between"><b>${esc(t.trait)}</b><span class="n small">${t.strength}%</span></div>
          <div class="bar" style="margin-top:6px"><i style="width:${Math.max(3, Math.min(100, t.strength))}%;background:${t.strength >= 70 ? "var(--brass)" : "var(--navy)"}"></i></div><div class="small muted" style="margin-top:4px">${esc(t.evidence)}</div></div>`).join("")}</div>
        <div class="card pad0">${(p.places || []).map((x) => `<div class="li" style="cursor:default"><div class="grow1"><b>${esc(x.name)}</b><div class="small muted">${esc(x.detail)}</div></div><span class="n" style="font-weight:700">${esc(x.value)}</span></div>`).join("")}</div>`; },
    levels: () => (R.levels || []).map((l) => `<div class="card"><div class="eyebrow" style="color:var(--brass-t)">Level ${l.level}</div><h2 class="h2" style="margin-top:2px">${esc(l.title)}</h2><div style="margin-top:10px">${big(l.big)}</div>
        ${(l.items || []).map((i) => `<div class="li" style="cursor:default"><div class="grow1"><div class="row wrapx" style="gap:6px">${chip(i.ticker)}<span class="small muted">${esc(i.name)} · ${esc(i.cap)}</span></div><div class="small" style="margin-top:4px">${esc(i.why)}</div></div>
          <div style="text-align:right"><div class="n" style="font-weight:700">${esc(i.number)}</div><div class="${i.impact === "up" ? "up" : "down"}" style="font-weight:700">${i.impact === "up" ? "▲" : "▼"}</div></div></div>`).join("")}</div>`).join(""),
    branches: () => (R.branches || []).map((b) => `<div class="card"><h2 class="h2">${esc(b.name)}</h2><div style="margin-top:8px">${(b.chain || []).map((s, i) => `<div class="lvl"><span class="tiny muted">Step ${i + 1}</span><div>${esc(s)}</div></div>`).join("")}</div>
        <div class="row wrapx" style="margin-top:10px;gap:6px">${(b.tickers || []).map(chip).join("")}</div></div>`).join(""),
    next: () => (R.next || []).map((n, i) => `<div class="card ${i === 0 ? "brass" : ""}"><div class="row between"><span class="eyebrow">Direction ${i + 1}</span><span class="pill" style="background:${{ high: "var(--up)", medium: "var(--amber)", low: "var(--gray)" }[n.likelihood] || "var(--gray)"};color:#fff">${esc(n.likelihood)} odds</span></div>
        <div style="font-size:19px;font-weight:700;margin-top:6px;line-height:1.3">${esc(n.move)}</div><p class="small" style="line-height:1.45">${esc(n.why)}</p>
        ${n.precedent ? `<div class="tile small"><b>This happened before:</b> ${esc(n.precedent)}</div>` : ""}
        <div class="eyebrow" style="margin-top:12px">Early warning signs</div>${(n.signs || []).map((s) => `<div class="small" style="margin-top:4px">• ${esc(s)}</div>`).join("")}
        ${n.fails_if ? `<div class="small muted" style="margin-top:8px">Fails if: ${esc(n.fails_if)}</div>` : ""}
        <div class="row wrapx" style="margin-top:10px;gap:6px">${(n.beneficiaries || []).map(chip).join("")}</div></div>`).join(""),
    then: () => (R.next || []).map((n, i) => `<div class="card"><div class="eyebrow">If direction ${i + 1} happens</div><div style="font-weight:700;margin-top:4px">${esc(n.move)}</div>
        ${(n.then_what || []).map((w) => `<div class="lvl"><div class="row between"><span>${esc(w.change)}</span><span class="n tiny muted">${w.confidence ?? ""}${w.confidence !== undefined ? "%" : ""}</span></div><div class="row wrapx" style="margin-top:6px;gap:6px">${(w.tickers || []).map(chip).join("")}</div></div>`).join("")}</div>`).join(""),
    board: () => ["thrive", "danger"].map((k) => `<div class="card"><h2 class="h2" style="color:${k === "thrive" ? "var(--up)" : "var(--down)"}">${k === "thrive" ? "Thrive" : "Danger"}</h2>
        ${((R.board || {})[k] || []).map((i) => `<div class="li" style="cursor:default"><div class="grow1"><div class="row wrapx" style="gap:6px">${chip(i.ticker)}<span class="small muted">${esc(i.cap)}</span></div><div class="small" style="margin-top:4px">${esc(i.why)}</div></div><div class="n" style="font-size:20px;font-weight:700">${i.score ?? ""}</div></div>`).join("")}</div>`).join(""),
    trades: () => (R.ladder || []).map((g) => `<div class="card"><div class="rung" style="margin-top:0">${esc(RUNGS[g.rung] || g.rung)}</div>
        ${(g.ideas || []).map((i) => `<div class="li" style="cursor:default;align-items:flex-start"><div class="grow1"><div class="row wrapx" style="gap:6px">${chip(i.ticker)}<span class="pill" style="background:${i.direction === "long" ? "#E7F4EA" : i.direction === "short" ? "#FDECEA" : "var(--soft)"};color:${i.direction === "long" ? "var(--up)" : i.direction === "short" ? "var(--down)" : "var(--gray)"}">${esc(i.direction)}</span><span class="small muted">${esc(i.how)} · ${esc(i.timing)} · ${esc(i.cap)}</span></div>
          <div style="margin-top:6px;font-size:15px">${esc(i.why)}</div>${i.priced_in ? `<div class="small muted" style="margin-top:4px">Priced in: ${esc(i.priced_in)}</div>` : ""}${i.kills_it ? `<div class="small muted">Kills it: ${esc(i.kills_it)}</div>` : ""}
          ${i.rides ? `<div class="tiny muted" style="margin-top:2px">Rides: ${esc(i.rides)}</div>` : ""}</div><div class="n" style="font-weight:700">${i.confidence ?? ""}</div></div>`).join("")}</div>`).join("") +
        `<p class="tiny muted" style="text-align:center;margin:10px 20px">Research ideas to evaluate, not recommendations. Tap a ticker to research it.</p>`,
    sources: () => `<div class="card pad0">${[...(R.sources || []), ...(R.citations || [])].filter((s, i, a) => safeUrl(s.url) && a.findIndex((x) => x.url === s.url) === i).map((s) => `<a class="li" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener"><div class="grow1"><div style="font-size:15px">${esc(s.title || s.url)}</div><div class="tiny muted">${esc((s.url.match(/\/\/([^/]+)/) || [])[1] || "")} ${s.date ? "· " + esc(s.date) : ""}</div></div><span class="muted">↗</span></a>`).join("") || `<div class="empty">No sources returned.</div>`}</div>`,
  };
  const draw = (t) => { tab = t; fill("#or-body", `<div class="otabs">${OTABS.map(([k, l]) => `<button class="chip ${k === t ? "on" : ""}" data-t="${k}">${l}</button>`).join("")}</div>${body[t]()}`);
    $$("[data-t]").forEach((b) => b.onclick = () => draw(b.dataset.t)); };
  draw(tab);
}

async function vTheses() {
  page(`${opalTop("theses")}<h1>Theses</h1><p class="sub">Opal answers you saved. Open one and tap Re-run to see what changed.</p></div><div id="th" class="card pad0">${spinner()}</div>`, "opal");
  try { const L = await api("/opal?saved=1"); fill("#th", L.length ? L.map((r) => `<a class="li" href="#opal/run/${r.id}"><div class="grow1"><div style="font-weight:600">${esc(r.title || r.question)}</div><div class="small muted">${F.date(r.created_at)}</div></div><span class="muted">›</span></a>`).join("")
    : `<div class="empty">Nothing saved yet. Run Opal, then tap "Save as thesis".</div>`); } catch (e) { fill("#th", err(e)); }
}

// ---------------------------------------------------------------- Signals
async function vSignals(filter) {
  page(`${opalTop("signals")}<h1>Where feeds agree</h1><div id="s-stats" style="height:62px"></div></div><div id="s-body">${spinner()}</div>`, "opal");
  try {
    const d = await api("/signals" + (filter ? "?src=" + filter : "")); MEM.signals = d;
    const cnt = Object.fromEntries((d.counts || []).map((c) => [c.src, c.n])); const total = Object.values(cnt).reduce((a, b) => a + b, 0);
    const ov = d.overlaps.filter((o) => o.count >= 2);
    fill("#s-stats", `<div class="row" style="gap:22px;margin-top:14px"><div><div class="n" style="font-size:30px;font-weight:700">${total}</div><div class="small" style="color:rgba(255,255,255,.7)">flags today</div></div>
      <div><div class="n" style="font-size:30px;font-weight:700;color:var(--brass-l)">${ov.length}</div><div class="small" style="color:rgba(255,255,255,.7)">overlaps</div></div>
      <a href="#feeds" style="margin-left:auto;color:var(--brass-l);font-weight:600;text-decoration:none;align-self:center">Feeds ›</a></div>`);
    const top = ov[0];
    fill("#s-body", `<div class="cols"><div>
      ${top ? `<a href="#stock/${esc(top.ticker)}" class="card brass" style="display:block;text-decoration:none;color:inherit"><div class="row between"><div><div class="eyebrow" style="color:var(--brass-t)">Strongest overlap · ${top.count} feeds</div>
          <div class="row" style="margin-top:6px">${logo(top.ticker, 40)}<span style="font-size:38px;font-weight:700;letter-spacing:-.03em">${esc(top.ticker)}</span></div></div><div class="score n">${top.score}</div></div>
        <div style="display:grid;grid-template-columns:24px 1fr;gap:9px 10px;margin-top:14px;align-items:center;font-size:15px">${top.items.slice(0, 5).map((i) => `${dot(i.src, 24)}<span>${esc(i.title)} <span class="tiny muted">${F.ago(i.ts)}</span></span>`).join("")}</div></a>` :
        `<div class="card"><div class="empty">No overlaps yet. When two or more feeds flag the same name within a week, it shows here.</div></div>`}
      <div class="chips">${[["", "All"], ...ORDER.map((k) => [k, SRC[k][0]])].map(([k, l]) => `<a class="chip ${filter === k || (!filter && !k) ? "on" : ""}" href="#signals${k ? "/" + k : ""}">${k ? dot(k, 16) + "&nbsp;" : ""}${l}</a>`).join("")}</div>
      ${ov.length ? `<div class="card" style="padding:14px 12px"><div class="row between"><h2 class="h2">Overlap board</h2><span class="small muted">7 days</span></div>
        <div style="display:grid;grid-template-columns:64px repeat(8,1fr) 34px;gap:9px 0;margin-top:12px;align-items:center;justify-items:center">
          <span></span>${ORDER.map((k) => `<span style="font-size:11px;font-weight:700;color:var(--${k})">${k}</span>`).join("")}<span class="tiny muted">#</span>
          ${ov.slice(0, 14).map((o) => `<a href="#stock/${esc(o.ticker)}" style="justify-self:start;font-weight:700;text-decoration:none;color:inherit">${esc(o.ticker)}</a>${ORDER.map((k) => dot(k, 19, o.srcs.includes(k))).join("")}<span class="n" style="font-weight:700">${o.count}</span>`).join("")}</div></div>` : ""}
      <div class="grid2" style="margin:12px 16px 0"><a href="#earnings" class="card amber" style="margin:0;text-decoration:none;color:inherit"><div class="eyebrow" style="color:var(--amber)">Earnings IV</div><div style="font-weight:600;margin-top:4px">Cheap or rich into earnings</div></a>
        <a href="#overlay" class="card" style="margin:0;text-decoration:none;color:inherit"><div class="eyebrow">Overlay bot</div><div style="font-weight:600;margin-top:4px">Put sales & sneaky calls</div></a></div>
      </div><div>
      <div class="sec"><h2 class="h2">Live feed</h2></div>
      <div class="card pad0">${d.feed.length ? d.feed.map((s) => `<a class="li" href="#stock/${esc(s.ticker)}">${dot(s.src, 26)}<div class="grow1"><div><b>${esc(s.ticker)}</b> <span class="small">${esc(s.title)}</span></div></div><span class="tiny muted">${F.ago(s.ts)}</span></a>`).join("")
        : `<div class="empty">No flags yet. The first run happens within five minutes during market hours; tap Feeds to run one now.</div>`}</div></div></div>`);
  } catch (e) { fill("#s-body", err(e)); }
}

async function vEarnings() {
  page(`${hdr("Cheap into earnings", { back: "#signals", sub: "Options pricing a smaller (or bigger) move than the stock usually makes after it reports." })}<div id="e-body">${spinner()}</div>`, "opal");
  try {
    const d = await api("/signals/earnings"); const rows = d.rows || [];
    const scale = Math.max(0.05, ...rows.map((r) => Math.max(r.implied, r.usual))) * 1.1;
    fill("#e-body", rows.length ? `${rows.filter((r) => r.tag === "cheap").slice(0, 1).map((r) => `<div class="card" style="border:2px solid var(--amber)"><div class="eyebrow" style="color:var(--amber)">Biggest gap</div>
        <div class="row between" style="margin-top:6px"><div class="row">${logo(r.ticker, 40)}<span style="font-size:36px;font-weight:700">${esc(r.ticker)}</span></div><span class="small muted">${F.date(r.date)} · ${r.days} days</span></div>
        <div class="grid3" style="margin-top:12px;text-align:center"><div class="tile" style="background:var(--amber-l)"><div class="n" style="font-size:22px;font-weight:700;color:var(--amber)">±${(r.implied * 100).toFixed(1)}%</div><div class="tiny muted">priced in</div></div>
          <div class="tile"><div class="n" style="font-size:22px;font-weight:700">±${(r.usual * 100).toFixed(1)}%</div><div class="tiny muted">usual move</div></div>
          <div class="tile"><div class="n" style="font-size:22px;font-weight:700">${r.beat} of ${r.of}</div><div class="tiny muted">beat priced</div></div></div></div>`).join("")}
      <div class="card pad0" style="padding-bottom:10px">${rows.map((r) => { const col = r.tag === "cheap" ? "var(--amber)" : r.tag === "rich" ? "var(--down)" : "var(--gray)";
        return `<a class="li" href="#stock/${esc(r.ticker)}" style="display:block"><div class="row between"><span><b style="font-size:17px">${esc(r.ticker)}</b> <span class="small muted">${F.date(r.date)} · ${r.days}d</span></span><span class="pill" style="background:${col}1A;color:${col}">${r.tag} · ${Math.round(r.ratio * 100)}%</span></div>
          <div style="position:relative;height:28px;margin-top:8px"><div style="position:absolute;left:0;top:2px;height:10px;border-radius:5px;background:${col};width:${r.implied / scale * 100}%"></div><div style="position:absolute;left:0;top:16px;height:10px;border-radius:5px;background:#D3D6DB;width:${r.usual / scale * 100}%"></div></div>
          <div class="n small muted"><b style="color:${col}">±${(r.implied * 100).toFixed(1)}%</b> priced · <b style="color:var(--ink)">±${(r.usual * 100).toFixed(1)}%</b> avg last ${r.of}</div></a>`; }).join("")}</div>
      <div class="card small muted" style="line-height:1.45"><b style="color:var(--ink)">How it works.</b> Priced-in move comes from the at-the-money straddle for the first expiry after the report. Usual move is the average one-day move over the last 8 reports. Under 70% of usual is flagged cheap; over 130% is rich (a put-sale candidate). Updated each morning.</div>`
      : `<div class="card"><div class="empty">Nothing yet. This runs each trading morning for names in your models and watchlist reporting in the next four weeks.</div></div>`);
  } catch (e) { fill("#e-body", err(e)); }
}

async function vOverlay() {
  page(`${hdr("Options overlay", { back: "#signals", sub: "Put sales to get paid, and calls someone is quietly buying." })}<div id="ov-body">${spinner()}</div>`, "opal");
  try {
    const [ps, sn] = await Promise.all([api("/signals/putsales"), api("/signals/sneaky")]);
    fill("#ov-body", `<div class="sec"><h2 class="h2">Put sales</h2><span class="small muted">IV rank 50+, ~35 days</span></div>
      ${(ps.rows || []).length ? ps.rows.map((r) => `<div class="card"><div class="row between"><div><div class="row">${logo(r.ticker, 30)}<b style="font-size:22px">${esc(r.ticker)}</b></div><div class="small muted" style="margin-top:4px">Sell $${r.strike} put · ${F.date(r.expiry)} · ${r.dte} days</div></div>
          <div style="text-align:right"><div class="n up" style="font-size:24px;font-weight:700">${(r.yield * 100).toFixed(1)}%</div><div class="tiny muted">${(r.annual * 100).toFixed(0)}%/yr</div></div></div>
        <div class="row" style="gap:14px;margin-top:10px;font-size:13px" class="n"><span>IV rank <b>${Math.round(r.iv_rank)}</b></span><span>${((r.price - r.strike) / r.price * 100).toFixed(1)}% cushion</span><span>${r.under_support ? "Under 50-day support ✓" : "Above support"}</span></div></div>`).join("")
        : `<div class="card"><div class="empty">No put sales right now. This runs each trading morning on your models and watchlist when option prices are high (IV rank 50+).</div></div>`}
      <div class="sec"><h2 class="h2">Sneaky calls</h2><span class="small muted">quiet, steady buying</span></div>
      <div class="card pad0">${sn.length ? sn.map((s) => `<a class="li" href="#stock/${esc(s.ticker)}">${dot("S", 26)}<div class="grow1"><b>${esc(s.ticker)}</b> <span class="small">${esc(s.title)}</span></div><span class="tiny muted">${F.ago(s.ts)}</span></a>`).join("")
        : `<div class="empty">None this week. A name shows here when out-of-the-money calls are bought at the ask in small pieces across two or more days.</div>`}</div>
      <p class="tiny muted" style="text-align:center;margin:12px 20px">Approve an idea in Options to track it at the live price. No orders are sent.</p>`);
  } catch (e) { fill("#ov-body", err(e)); }
}

async function vFeeds() {
  page(`${hdr("Feeds and bots", { back: "#signals", sub: "What each one watches, how busy it is, and what it costs this month." })}<div id="f-body">${spinner()}</div>`, "opal");
  const FEEDS = [["unusual_whales", "Unusual Whales", "Options flow, congress", "UNUSUAL_WHALES_API_KEY", "flow"], ["marketdata", "MarketData.app", "Live prices, option chains", "MARKETDATA_API_KEY", ""],
    ["grok", "Grok", "X trends, calls, Opal, Grow", "XAI_API_KEY", "x"], ["quiver", "Quiver Quant", "Lobbying, contracts", "QUIVER_API_KEY", "quiver"], ["roic", "ROIC.AI", "Earnings call transcripts", "ROIC_API_KEY", "transcripts"],
    ["legiscan", "LegiScan", "State bills", "LEGISCAN_API_KEY", ""], ["sec", "SEC EDGAR", "Filings", null, ""]];
  try {
    const d = await api("/feeds"); const u = Object.fromEntries(d.usage.map((x) => [x.source, x]));
    fill("#f-body", `<div class="card pad0">${FEEDS.map(([id, name, role, key, job]) => { const x = u[id] || {}; const has = !key || d.keys.includes(key);
        const st = !has ? ["no key", "var(--gray)"] : x.last_err && (!x.last_ok || x.last_err > x.last_ok) ? ["error", "var(--down)"] : x.last_ok ? ["live", "var(--up)"] : ["ready", "var(--navy)"];
        return `<div class="li" style="cursor:default"><div class="grow1"><div style="font-weight:600">${name}</div><div class="small muted">${role}</div>${st[0] === "error" ? `<div class="tiny" style="color:var(--down)">${esc(x.last_err_msg)}</div>` : ""}</div>
          <div style="text-align:right"><div class="tiny" style="color:${st[1]};font-weight:700">● ${st[0]}</div><div class="n tiny muted">${x.today || 0} today${id === "grok" ? ` · ${F.usd(x.cost || 0)} / $${d.grok_cap}` : ""}</div>
          ${job ? `<button class="btn small soft" data-job="${job}" style="margin-top:4px;height:28px;font-size:12px">Run now</button>` : ""}</div></div>`; }).join("")}</div>
      <div class="card"><div class="eyebrow">Bots</div><p class="small" style="line-height:1.45">Every 5 minutes in market hours: options flow, sneaky calls, tracked trades. Every 30 minutes: one X sweep. Each trading morning: congress, lobbying and contracts, earnings IV, put sales, earnings calls.</p>
        <div class="small muted">Last run: ${d.last_tick ? (F.ago(d.last_tick.at) === "now" ? "just now" : F.ago(d.last_tick.at) + " ago") : "not yet"}</div>
        <div class="grid2" style="margin-top:10px">${[["congress", "Congress"], ["earnings", "Earnings IV"], ["putsales", "Put sales"], ["mark", "Mark trades"]].map(([j, l]) => `<button class="btn small soft" data-job="${j}" style="width:100%">${l}</button>`).join("")}</div></div>`);
    $$("[data-job]").forEach((b) => b.onclick = async () => { b.disabled = true; const t = b.textContent; b.textContent = "Running…";
      try { const r = await api("/feeds/run", { body: { job: b.dataset.job } }); toast("Done: " + JSON.stringify(r).slice(0, 80), 3500); } catch (e) { toast(e.message, 4000); } b.disabled = false; b.textContent = t; });
  } catch (e) { fill("#f-body", err(e)); }
}
// ---------------------------------------------------------------- Options
function optTop(active) {
  return `<div class="hdr" style="padding-top:calc(18px + var(--safe-t))"><div class="seg" style="max-width:360px">${[["ideas", "Ideas", "#options"], ["tracking", "Tracking", "#options/tracking"], ["results", "Results", "#options/results"]]
    .map(([k, l, h]) => `<button class="${active === k ? "on" : ""}" onclick="location.hash='${h}'">${l}</button>`).join("")}</div>`;
}
async function vOptions() {
  page(`${optTop("ideas")}<h1>Ideas</h1><p class="sub">Approve locks in the live price at that moment and tracks the trade. No orders are sent.</p></div>
    <div style="margin:12px 16px 0"><a class="btn ghost" href="#options/new">+ Add an idea</a></div><div id="i-body">${spinner()}</div>`, "options");
  try {
    const L = await api("/options/ideas");
    fill("#i-body", L.length ? L.map((i) => `<div class="card"><div class="row between"><div class="row">${logo(i.symbol, 32)}<div><div style="font-size:18px;font-weight:700">${esc(i.label)}</div>
        <div class="small muted">${i.action === "sell" ? "Sell" : "Buy"} · ${esc(i.source)} · ${F.ago(i.created_at)}</div></div></div></div>
      <p style="font-size:15px;line-height:1.4;margin:10px 0 0">${esc(i.thesis)}</p>
      <div class="grid2" style="margin-top:12px"><button class="btn primary" data-ap="${i.id}">Approve</button><button class="btn soft" data-dm="${i.id}">Dismiss</button></div></div>`).join("")
      : `<div class="card"><div class="empty">No new ideas. They arrive from big options flow on your names, put sales, and Opal trades.</div></div>`);
    $$("[data-dm]").forEach((b) => b.onclick = async () => { await api("/options/dismiss/" + b.dataset.dm, { body: {} }); vOptions(); });
    $$("[data-ap]").forEach((b) => b.onclick = () => approveSheet(L.find((x) => String(x.id) === b.dataset.ap)));
  } catch (e) { fill("#i-body", err(e)); }
}
async function approveSheet(i) {
  const s = await api("/settings").catch(() => ({}));
  const tgt = i.target_pct ?? (i.action === "sell" ? s.sell_target_pct : s.target_pct), stp = i.stop_pct ?? (i.action === "sell" ? s.sell_stop_pct : s.stop_pct);
  const sh = sheet(`<div style="padding:0 18px"><div class="eyebrow">Approve and track</div><h2 class="h2" style="margin-top:4px">${esc(i.label)}</h2>
    <p class="small muted">${i.action === "sell" ? "Sell" : "Buy"} · entry is the live mid when you tap Approve.</p>
    <div class="grid3" style="margin-top:12px"><label class="small">Contracts<input class="inp n" id="ac" inputmode="numeric" value="${i.contracts || s.contracts || 1}"></label>
      <label class="small">Target %<input class="inp n" id="at" inputmode="decimal" value="${tgt ?? ""}"></label><label class="small">Stop %<input class="inp n" id="as" inputmode="decimal" value="${stp ?? ""}"></label></div>
    <button class="btn primary" id="ago" style="margin-top:16px">Approve at live price</button><p class="tiny muted" style="text-align:center">Only works while the market is open.</p></div>`);
  $("#ago", sh).onclick = async () => { $("#ago", sh).disabled = true;
    try { const p = await api("/options/approve/" + i.id, { body: { contracts: Number($("#ac", sh).value), target_pct: $("#at", sh).value === "" ? null : Number($("#at", sh).value), stop_pct: $("#as", sh).value === "" ? null : Number($("#as", sh).value) } });
      sh.remove(); toast(`Tracking at ${F.px(p.entry_px)}`); location.hash = "#options/tracking"; } catch (e) { toast(e.message, 4500); $("#ago", sh).disabled = false; } };
}
async function vNewIdea() {
  page(`${hdr("Add an idea", { back: "#options" })}<div class="card">
    <div class="grid2"><label class="small">Ticker<input class="inp" id="ns" autocapitalize="characters" placeholder="AAPL"></label><label class="small">Expiration<input class="inp" id="ne" type="date"></label></div>
    <div class="grid3" style="margin-top:10px"><label class="small">Side<select class="inp" id="nd"><option value="call">Call</option><option value="put">Put</option></select></label>
      <label class="small">Action<select class="inp" id="na"><option value="buy">Buy</option><option value="sell">Sell</option></select></label><label class="small">Strike<input class="inp n" id="nk" inputmode="decimal"></label></div>
    <label class="small" style="display:block;margin-top:10px">Why<textarea class="box" id="nt" rows="3"></textarea></label>
    <button class="btn primary" id="nsave" style="margin-top:12px">Add to ideas</button></div>`, "options");
  $("#nsave").onclick = async () => { try { await api("/options/ideas", { body: { symbol: $("#ns").value, expiry: $("#ne").value, side: $("#nd").value, action: $("#na").value, strike: $("#nk").value, thesis: $("#nt").value } });
    toast("Added"); location.hash = "#options"; } catch (e) { toast(e.message, 4000); } };
}
async function vTracking() {
  page(`${optTop("tracking")}<h1>Tracking</h1><p class="sub">Marked to the live mid every five minutes while the market is open.</p></div><div id="tr-body">${spinner()}</div>`, "options");
  try {
    const L = await api("/options/positions");
    const tot = L.reduce((s, p) => s + (p.pnl || 0), 0);
    fill("#tr-body", L.length ? `<div class="card navy"><div class="eyebrow" style="color:var(--brass-l)">Open P/L</div><div class="n" style="font-size:36px;font-weight:700;margin-top:4px">${F.usd(tot)}</div><div class="small" style="color:rgba(255,255,255,.7)">${L.length} open trade${L.length === 1 ? "" : "s"}</div></div>` +
      L.map((p) => `<div class="card"><div class="row between"><div><div style="font-size:17px;font-weight:700">${esc(p.label)}</div><div class="small muted">${p.action === "sell" ? "Sold" : "Bought"} ${p.contracts} at ${F.px(p.entry_px)} · ${F.date(p.entry_at)}</div></div>
          <div style="text-align:right"><div class="n ${F.cls(p.pnl_pct)}" style="font-size:22px;font-weight:700">${F.pct(p.pnl_pct, 1)}</div><div class="n small ${F.cls(p.pnl)}">${F.usd(p.pnl)}</div></div></div>
        <div class="row between small muted" style="margin-top:10px"><span>Now ${F.px(p.last_px)} · ${F.ago(p.last_at)}</span><span>Target ${p.target_pct ?? "–"}% · Stop ${p.stop_pct ?? "–"}%</span></div>
        ${p.target_hit_at ? `<div class="pill" style="background:#E7F4EA;color:var(--up);margin-top:8px">Target hit</div>` : p.stop_hit_at ? `<div class="pill" style="background:#FDECEA;color:var(--down);margin-top:8px">Stop hit</div>` : ""}
        <button class="btn soft small" data-cl="${p.id}" style="margin-top:10px;width:100%">Close at live price</button></div>`).join("")
      : `<div class="card"><div class="empty">Nothing open. Approve an idea to start tracking it.</div></div>`);
    $$("[data-cl]").forEach((b) => b.onclick = async () => { if (!confirm("Close this trade at the live mid?")) return; try { await api("/options/close/" + b.dataset.cl, { body: {} }); toast("Closed"); vTracking(); } catch (e) { toast(e.message, 4000); } });
  } catch (e) { fill("#tr-body", err(e)); }
}
async function vResults() {
  page(`${optTop("results")}<h1>Results</h1><p class="sub">Closed trades only.</p></div><div id="rs-body">${spinner()}</div>`, "options");
  try {
    const r = await api("/options/results");
    fill("#rs-body", r.closed ? `<div class="grid2" style="margin:12px 16px 0">
        <div class="card" style="margin:0"><div class="eyebrow">Win rate</div><div class="big n" style="margin-top:6px">${r.win_rate ?? "–"}${r.win_rate !== null ? "%" : ""}</div><div class="small muted">${r.wins} won · ${r.losses} lost</div></div>
        <div class="card" style="margin:0"><div class="eyebrow">Total P/L</div><div class="big n ${F.cls(r.total_pnl)}" style="margin-top:6px;font-size:28px">${F.usd(r.total_pnl)}</div><div class="small muted">avg ${F.pct(r.avg_return_pct, 1)}</div></div></div>
      <div class="grid2" style="margin:10px 16px 0"><div class="card" style="margin:0"><div class="eyebrow">Hit target</div><div class="big n" style="margin-top:6px;font-size:28px">${r.target_hit_rate ?? "–"}${r.target_hit_rate !== null ? "%" : ""}</div></div>
        <div class="card" style="margin:0"><div class="eyebrow">Best</div><div style="font-weight:700;margin-top:6px">${esc(r.best?.label ?? "–")}</div><div class="n up">${F.pct(r.best?.pct, 1)}</div></div></div>
      <div class="card pad0" style="margin-top:12px">${r.recent.map((p) => `<div class="li" style="cursor:default"><div class="grow1"><div style="font-weight:600">${esc(p.label)}</div><div class="small muted">${esc(p.exit_reason)} · ${F.date(p.exit_at)}</div></div><div class="n ${F.cls(p.pnl_pct)}" style="font-weight:700">${F.pct(p.pnl_pct, 1)}</div></div>`).join("")}</div>`
      : `<div class="card"><div class="empty">No closed trades yet.</div></div>`);
  } catch (e) { fill("#rs-body", err(e)); }
}

// ---------------------------------------------------------------- Grow
async function vGrow() {
  page(`<div class="hdr" style="padding-top:calc(18px + var(--safe-t))"><div class="eyebrow" style="color:var(--brass-l)">Grow</div><h1>Turn an idea into posts</h1><p class="sub">Type the idea. Get plain advice, then compliance-checked versions for each audience and channel.</p></div>
    <div class="card"><textarea class="box" id="gi" rows="4" placeholder="e.g. People holding too much cash after the rate cuts should think about laddering."></textarea><button class="btn primary" id="gg" style="margin-top:10px">Break it down</button></div>
    <div class="sec"><h2 class="h2">Library</h2></div><div id="g-lib" class="card pad0">${spinner()}</div>`, "grow");
  $("#gg").onclick = async () => { const idea = $("#gi").value.trim(); if (idea.length < 8) return toast("Type a sentence or two."); $("#gg").disabled = true; $("#gg").textContent = "Thinking…";
    try { const g = await api("/grow/breakdown", { body: { idea } }); location.hash = "#grow/" + g.id; } catch (e) { toast(e.message, 4000); $("#gg").disabled = false; $("#gg").textContent = "Break it down"; } };
  try { const d = await api("/grow"); MEM.grow = d; fill("#g-lib", d.ideas.length ? d.ideas.map((g) => `<a class="li" href="#grow/${g.id}"><div class="grow1"><div style="font-weight:600">${esc(g.title || g.idea)}</div><div class="small muted">${F.date(g.updated_at)}</div></div><span class="muted">›</span></a>`).join("") : `<div class="empty">Your ideas will be saved here.</div>`); }
  catch (e) { fill("#g-lib", err(e)); }
}
async function vGrowIdea(id, aud, ch) {
  page(`${hdr("Grow", { back: "#grow" })}<div id="gi-body">${spinner()}</div>`, "grow");
  try {
    const meta = MEM.grow || await api("/grow"); MEM.grow = meta; const g = await api("/grow/" + id); const b = g.breakdown || {};
    aud = aud || (b.best_for || [])[0] || "clients"; ch = ch || "LinkedIn";
    const audName = Object.fromEntries(meta.audiences.map((a) => [a.id, a.name]));
    fill("#gi-body", `<div class="card"><div class="eyebrow">The idea</div><h2 class="h2" style="margin-top:4px">${esc(b.title)}</h2><p style="line-height:1.45">${esc(b.summary)}</p></div>
      <div class="card">${(b.advice || []).map((a) => `<div class="lvl"><b>${esc(a.heading)}</b><div class="small" style="line-height:1.45">${esc(a.point)}</div></div>`).join("")}</div>
      <div class="cols"><div class="card"><div class="eyebrow">Risks</div>${(b.risks || []).map((x) => `<div class="small" style="margin-top:6px">• ${esc(x)}</div>`).join("")}</div>
        <div class="card"><div class="eyebrow">Don't say</div>${(b.avoid || []).map((x) => `<div class="small" style="margin-top:6px">• ${esc(x)}</div>`).join("")}</div></div>
      <div class="sec"><h2 class="h2">Posts</h2><span class="small muted">by audience</span></div>
      <div class="chips">${meta.audiences.map((a) => `<a class="chip ${a.id === aud ? "on" : ""}" href="#grow/${id}/${a.id}">${esc(a.name)}${(b.best_for || []).includes(a.id) ? " ★" : ""}</a>`).join("")}</div>
      <div class="chips" style="padding-top:8px">${meta.channels.map((c) => `<a class="chip ${c === ch ? "on" : ""}" href="#grow/${id}/${aud}/${c}">${esc(c)}</a>`).join("")}</div>
      <div id="gp">${spinner("Writing for " + (audName[aud] || aud))}</div>`);
    const show = (ex, regen) => { const p = ex[ch]; if (!p) return fill("#gp", `<div class="card"><div class="empty">Not written.</div></div>`);
      const col = { passed: "var(--up)", fixed: "var(--amber)", needs_edits: "var(--down)" }[p.status];
      fill("#gp", `<div class="card"><div class="row between"><span class="pill" style="background:${col};color:#fff">${p.status === "passed" ? "Passed compliance" : p.status === "fixed" ? "Fixed for compliance" : "Needs edits"}</span><span class="n tiny muted">${p.chars}${p.limit ? " / " + p.limit : ""}</span></div>
        <textarea class="box" id="gtx" rows="9" style="margin-top:10px">${esc(p.text)}</textarea><div class="tiny muted" style="margin-top:6px">${esc(p.disclosure)}</div>
        ${(p.issues || []).length ? `<div class="small" style="margin-top:10px"><b>What changed</b>${p.issues.map((x) => `<div class="muted" style="margin-top:4px">• ${esc(x)}</div>`).join("")}</div>` : ""}
        ${(p.remaining || []).length ? `<div class="small" style="margin-top:8px;color:var(--down)">${p.remaining.map(esc).join("<br>")}</div>` : ""}
        <div class="grid3" style="margin-top:12px"><button class="btn small primary" id="gcopy" style="width:100%">Copy</button><button class="btn small soft" id="gchk" style="width:100%">Re-check</button><button class="btn small soft" id="gre" style="width:100%">Regenerate</button></div></div>`);
      $("#gcopy").onclick = () => navigator.clipboard.writeText($("#gtx").value + "\n\n" + p.disclosure).then(() => toast("Copied with disclosure"));
      $("#gchk").onclick = async () => { try { const r = await api(`/grow/${id}/edit`, { body: { audience: aud, channel: ch, text: $("#gtx").value } }); ex[ch] = r; show(ex); toast(r.status === "passed" ? "Passed" : "Checked"); } catch (e) { toast(e.message); } };
      $("#gre").onclick = () => load(true); };
    const load = async (regenerate) => { fill("#gp", spinner("Writing for " + (audName[aud] || aud))); try { const ex = await api(`/grow/${id}/explain`, { body: { audience: aud, regenerate: !!regenerate } }); show(ex); } catch (e) { fill("#gp", `<div class="card">${err(e)}</div>`); } };
    if (g.explain && g.explain[aud]) show(g.explain[aud]); else load(false);
  } catch (e) { fill("#gi-body", err(e)); }
}

// ---------------------------------------------------------------- Research
function chart(c, w = 358, h = 150) {
  if (!c || c.length < 2) return "";
  const v = c.map((x) => x[1]); const lo = Math.min(...v), hi = Math.max(...v); const up = v[v.length - 1] >= v[0];
  const P = v.map((y, i) => [i * w / (v.length - 1), h - 4 - (y - lo) / (hi - lo || 1) * (h - 8)]);
  const line = P.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const col = up ? "#7FD49A" : "#FF9C93";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block;margin-top:14px" role="img" aria-label="Price chart"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${w},${h} L0,${h} Z" fill="url(#g)"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
async function vStock(t) {
  t = String(t).toUpperCase();
  page(`<div class="hdr" style="padding-top:calc(18px + var(--safe-t))"><button class="back" onclick="history.back()">‹ Back</button><div id="st-h"><h1>${esc(t)}</h1></div></div><div id="st-body">${spinner()}</div>`);
  try {
    const d = await api("/stock/" + encodeURIComponent(t)); const q = d.quote || {}; const info = d.info || {};
    let range = 260;
    const head = () => fill("#st-h", `<div class="row between" style="margin-top:12px;align-items:flex-end"><div><div class="small" style="color:rgba(255,255,255,.65)">${esc(t)} · ${esc(info.sector || "")}</div>
        <div style="font-size:28px;font-weight:700;letter-spacing:-.03em;line-height:1.1">${esc(info.full_name || info.short_name || t)}</div></div>
        <div style="text-align:right"><div class="n" style="font-size:28px;font-weight:700">${F.px(q.last)}</div><div class="n" style="font-weight:600;color:${(q.changepct || 0) >= 0 ? "#7FD49A" : "#FF9C93"}">${q.change !== undefined && q.change !== null ? (q.change >= 0 ? "+" : "−") + "$" + Math.abs(q.change).toFixed(2) + " · " : ""}${F.chg(q)}</div></div></div>
      ${chart(d.candles.slice(-range))}
      <div class="seg" style="margin-top:12px">${[[21, "1M"], [126, "6M"], [260, "1Y"]].map(([n, l]) => `<button class="${n === range ? "on" : ""}" data-r="${n}">${l}</button>`).join("")}</div>`);
    head(); const hook = () => $$("[data-r]").forEach((b) => b.onclick = () => { range = Number(b.dataset.r); head(); hook(); }); hook();
    const ov = d.overlap; const ne = d.next_earnings;
    const implied = ne && ne.expected ? ne.expected : null;
    fill("#st-body", `<div class="cols"><div>
      <div class="card"><div class="row between"><h2 class="h2">In your models</h2><a href="#portfolio" class="small" style="font-weight:600;text-decoration:none">Portfolio</a></div>
        ${d.models.length ? d.models.map((m) => `<div class="row between" style="margin-top:10px"><b>${esc(m.model)}</b><span class="n">target ${F.bps(m.target_bps)}</span></div>`).join("") : `<div class="small muted" style="margin-top:8px">Not in any model.</div>`}
        <button class="btn small soft" id="addw" style="margin-top:12px;width:100%">+ Watchlist</button></div>
      <div class="grid2" style="margin:12px 16px 0">
        <div class="card" style="margin:0"><div class="eyebrow">Signals</div><div class="row" style="gap:4px;margin-top:8px;min-height:22px">${ov ? ov.srcs.map((s) => dot(s, 22)).join("") : `<span class="small muted">none</span>`}</div>
          <div class="n" style="font-size:24px;font-weight:700;margin-top:8px">${ov ? ov.score : "–"}</div><div class="small muted">${ov ? ov.count + " feed" + (ov.count > 1 ? "s" : "") : "no flags"}</div></div>
        <div class="card" style="margin:0"><div class="eyebrow" style="color:var(--amber)">Earnings ${ne ? F.date(ne.date) : ""}</div>
          <div class="n" style="font-size:24px;font-weight:700;margin-top:8px">${implied ? "±" + (implied * 100).toFixed(1) + "%" : "–"}</div><div class="small muted">${implied ? "priced in" : ne ? "not priced yet" : "no date"}</div>
          <div class="n" style="font-weight:600;margin-top:6px">${d.usual_move ? "±" + (d.usual_move * 100).toFixed(1) + "%" : "–"}</div><div class="small muted">usual move</div></div></div>
      <div class="card" id="st-sum"><div class="row between"><h2 class="h2">What's being said</h2><span class="tiny muted" id="st-sum-at"></span></div><div id="st-sum-b">${spinner()}</div></div>
      </div><div>
      <div class="card"><h2 class="h2">Key numbers</h2><div class="grid3" style="margin-top:12px;gap:14px 8px">
        ${[["Market cap", info.marketcap ? F.money(Number(info.marketcap)) : "–"], ["Beta", info.beta ? Number(info.beta).toFixed(2) : "–"], ["IV rank", d.iv && d.iv.rank !== null ? Math.round(d.iv.rank) : "–"],
           ["IV", d.iv && d.iv.iv ? (d.iv.iv * 100).toFixed(0) + "%" : "–"], ["Avg volume", info.avg30_volume ? (Number(info.avg30_volume) / 1e6).toFixed(1) + "M" : "–"], ["Dividend", info.has_dividend ? "Yes" : "No"]]
          .map(([a, b]) => `<div><div class="tiny muted">${a}</div><div class="n" style="font-size:17px;font-weight:700;margin-top:2px">${b}</div></div>`).join("")}</div></div>
      <div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Flags (30 days)</h2></div>${d.signals.length ? d.signals.slice(0, 12).map((s) => `<div class="li" style="cursor:default">${dot(s.src, 24)}<div class="grow1 small">${esc(s.title)}</div><span class="tiny muted">${F.ago(s.ts)}</span></div>`).join("") : `<div class="empty">No flags.</div>`}</div>
      <div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Filings</h2></div>${d.filings.length ? d.filings.map((f) => `<a class="li" href="${esc(safeUrl(f.url) || "#")}" target="_blank" rel="noopener"><span class="pill" style="background:var(--soft)">${esc(f.form)}</span><div class="grow1 small">${esc(f.desc || f.items || "")}</div><span class="tiny muted">${F.date(f.filed)}</span></a>`).join("") : `<div class="empty">None found.</div>`}</div>
      </div></div>
      <div class="grid2" style="margin:14px 16px 0"><a class="btn primary" href="#options/new">Options idea</a><button class="btn ghost" id="askopal">Ask Opal</button></div>`);
    $("#addw").onclick = async () => { await api("/watchlist", { body: { ticker: t } }); toast("Added to watchlist"); };
    $("#askopal").onclick = async () => { const r = await api("/opal", { body: { q: `What is driving ${t} right now, and what comes next for it and its suppliers and competitors?` } }); location.hash = "#opal/run/" + r.id; };
    const sum = (s) => { fill("#st-sum-at", s.at ? (F.ago(s.at) === "now" ? "just now" : F.ago(s.at) + " ago") : ""); fill("#st-sum-b", [["X", "On X", s.x], ["T", "Latest news", s.news], ["E", "Last call", s.call]].filter((x) => x[2]).map(([k, h, v]) => `<div style="display:grid;grid-template-columns:26px 1fr;gap:10px;padding-top:12px">${dot(k === "E" ? "T" : k, 26)}<div><div class="small muted" style="font-weight:700">${h}</div><div style="font-size:15px;line-height:1.35">${esc(v)}</div></div></div>`).join("")
      + `<button class="btn small soft" id="st-re" style="margin-top:12px">Refresh</button>`); $("#st-re").onclick = () => { fill("#st-sum-b", spinner()); api(`/stock/${t}/summary?force=1`).then(sum).catch((e) => fill("#st-sum-b", err(e))); }; };
    if (d.summary) sum(d.summary); else api(`/stock/${t}/summary`).then(sum).catch((e) => fill("#st-sum-b", err(e)));
  } catch (e) { fill("#st-body", err(e)); }
}
// ---------------------------------------------------------------- Research: one uniform page for any stock or fund
const RECENT_KEY = "odesa_recent";
const recentGet = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch (_) { return []; } };
const recentAdd = (t) => { try { const r = [t, ...recentGet().filter((x) => x !== t)].slice(0, 12); localStorage.setItem(RECENT_KEY, JSON.stringify(r)); } catch (_) {} };
const MEMR = {};
async function getProfile(t, force) { const c = MEMR[t]; if (c && !force && Date.now() - c.at < 120000) return c.v; const v = await api("/research/" + encodeURIComponent(t)); MEMR[t] = { at: Date.now(), v }; return v; }
const pctS = (n, d = 1) => n === null || n === undefined || isNaN(n) ? "–" : F.pct(n * 100, d);
const pctU = (n, d = 1) => n === null || n === undefined || isNaN(n) ? "–" : F.pct(n * 100, d, false);
const xx = (n) => n === null || n === undefined || isNaN(n) ? "–" : n < 0 ? "n/m" : n >= 1000 ? Math.round(n).toLocaleString() + "×" : n.toFixed(1) + "×";
const isFundD = (d) => d.kind === "fund" || !!(d.street && /fund|etf/i.test(d.street.kind || ""));
const pctN = (v, d = 2) => v === null || v === undefined || isNaN(v) ? "–" : Number(v).toFixed(d) + "%";   // already in percent
const stars = (n) => n ? `<span style="color:var(--brass);letter-spacing:2px">${"★".repeat(Math.round(n))}<span style="color:#DDD">${"★".repeat(5 - Math.round(n))}</span></span>` : "–";
function fundRet(d) { const f = (d.street && d.street.fund) || {}; const r = d.returns || { t: {}, spy: {} }; const hasPx = ["1Y", "3Y", "5Y", "10Y"].some((k) => r.t[k] !== null && r.t[k] !== undefined);
  const fr = f.returns || {}; return { t: hasPx ? r.t : Object.fromEntries(["1Y", "3Y", "5Y", "10Y"].map((k) => [k, fr[k] !== null && fr[k] !== undefined ? fr[k] / 100 : null])), spy: r.spy || {},
    cat: Object.fromEntries(["1Y", "3Y", "5Y", "10Y"].map((k) => [k, f.category_returns && f.category_returns[k] !== null && f.category_returns[k] !== undefined ? f.category_returns[k] / 100 : null])), total: !hasPx }; }
function fundTop(d) {
  const f = (d.street && d.street.fund) || {}; const has = (v) => v !== null && v !== undefined && v !== "" && !(typeof v === "number" && isNaN(v));
  const er = has(f.expense_ratio) ? Number(f.expense_ratio) : null, fl = has(f.front_load) ? Number(f.front_load) : null, b1 = has(f.b12_1) ? Number(f.b12_1) : null;
  const yrs = (y) => y ? Math.max(0, new Date().getFullYear() - Number(y)) : null;
  const rating = `<div class="card navy" style="display:grid;grid-template-columns:1fr 1fr;gap:14px 10px">
      <div><div class="tiny" style="color:rgba(255,255,255,.65);font-weight:700;letter-spacing:.06em">MORNINGSTAR</div><div style="font-size:22px;margin-top:4px">${f.stars ? `<span style="color:var(--brass-l);letter-spacing:2px">${"★".repeat(Math.round(f.stars))}</span><span style="color:rgba(255,255,255,.25);letter-spacing:2px">${"★".repeat(5 - Math.round(f.stars))}</span>` : "–"}</div></div>
      <div><div class="tiny" style="color:rgba(255,255,255,.65);font-weight:700;letter-spacing:.06em">MEDALIST</div><div style="font-size:19px;font-weight:700;margin-top:4px;color:${/gold/i.test(f.medal || "") ? "#E8C873" : /silver/i.test(f.medal || "") ? "#D8DDE3" : /bronze/i.test(f.medal || "") ? "#D9A57A" : "#fff"}">${esc(f.medal || "–")}</div></div>
      <div><div class="tiny" style="color:rgba(255,255,255,.65);font-weight:700;letter-spacing:.06em">CATEGORY RANK</div><div style="font-size:17px;font-weight:700;margin-top:4px">${esc(f.category_rank || "–")}</div></div>
      <div><div class="tiny" style="color:rgba(255,255,255,.65);font-weight:700;letter-spacing:.06em">RISK</div><div style="font-size:17px;font-weight:700;margin-top:4px">${esc(f.risk || "–")}</div></div></div>`;
  const cost10k = er !== null ? er / 100 * 10000 : null, load10k = fl ? fl / 100 * 10000 : null;
  const fees = `<div class="card" style="background:var(--amber-l)"><div class="eyebrow" style="color:var(--amber)">Fees & costs</div>
      <div class="row" style="align-items:baseline;gap:8px;margin-top:6px"><span class="big n">${er !== null ? er.toFixed(2) + "%" : "–"}</span><span class="small muted">expense ratio</span></div>
      ${cost10k !== null ? `<div class="small" style="margin-top:4px">≈ <b>$${Math.round(cost10k)}/yr</b> on $10,000${load10k ? ` · plus <b>$${Math.round(load10k)}</b> up-front sales charge` : ""}</div>` : ""}
      <div class="grid3" style="margin-top:14px;gap:12px 8px">${[["Front-end load", fl ? fl.toFixed(2) + "%" : fl === 0 ? "None" : "–", fl ? "down" : ""], ["Back-end load", has(f.back_load) ? (Number(f.back_load) ? Number(f.back_load).toFixed(2) + "%" : "None") : "–", ""],
        ["12b-1 fee", b1 ? b1.toFixed(2) + "%" : b1 === 0 ? "None" : "–", b1 ? "down" : ""], ["Minimum", has(f.min_investment) ? (Number(f.min_investment) ? "$" + Number(f.min_investment).toLocaleString() : "None") : "–", ""],
        ["Yield", has(f.yield) ? pctN(f.yield) : "–", ""], ["Turnover", has(f.turnover) ? pctN(f.turnover, 0) : "–", ""]]
        .map(([a, b, c]) => `<div><div class="tiny muted" style="font-weight:600">${a}</div><div class="n ${c}" style="font-size:17px;font-weight:700;margin-top:2px">${b}</div></div>`).join("")}</div>
      ${fl || b1 ? `<p class="small" style="margin:12px 0 0;color:var(--amber)">⚠︎ ${fl ? "Front-end load" : ""}${fl && b1 ? " and " : ""}${b1 ? "12b-1 fee" : ""}: compare share classes before recommending.</p>` : ""}</div>`;
  const mgr = (f.managers || []).length || f.style_note ? `<div class="card"><div class="eyebrow">Who manages it</div>
      ${(f.managers || []).map((m) => `<div style="padding:12px 0;border-bottom:1px solid var(--line)"><div class="row between"><b style="font-size:16px">${esc(m.name || "")}</b>${m.since ? `<span class="pill" style="background:var(--soft)">${yrs(m.since)} yrs · since ${esc(m.since)}</span>` : ""}</div>
        ${m.style ? `<div class="small" style="margin-top:4px;color:var(--brass-t);font-weight:600">${esc(m.style)}</div>` : ""}
        ${(m.other_funds || []).filter(Boolean).length ? `<div class="tiny muted" style="margin-top:4px;line-height:1.4">Also manages: ${m.other_funds.filter(Boolean).slice(0, 5).map(esc).join(" · ")}</div>` : ""}</div>`).join("")}
      ${f.style_note ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.45">${esc(f.style_note)}</p>` : ""}</div>` : "";
  return { rating: f.stars || f.medal || f.category_rank ? rating : "", fees, mgr };
}
const sizeName = (mc) => !mc ? "" : mc >= 200e9 ? "Mega cap" : mc >= 10e9 ? "Large cap" : mc >= 2e9 ? "Mid cap" : mc >= 300e6 ? "Small cap" : "Micro cap";

async function vResearch() {
  page(`${hdr("Research", { light: true, top: `<div style="height:calc(10px + var(--safe-t))"></div>` })}
    <div style="margin:4px 16px 0"><div class="field grey">${ICON.search}<input id="rq" placeholder="Ticker or company name" autocapitalize="characters" autocomplete="off" autofocus></div></div>
    <div id="rr"></div><div id="rhome"></div>`, "research");
  const home = async () => {
    const rec = recentGet(); let ms = []; try { ms = await getModels(); } catch (_) {}
    const held = [...new Set(ms.flatMap((m) => (m.holdings || []).filter((h) => !h.cash).map((h) => h.t)))];
    const chips = (arr) => `<div class="chips" style="flex-wrap:wrap;padding-top:8px">${arr.map((t) => `<a class="chip" href="#research/${esc(t)}">${esc(t)}</a>`).join("")}</div>`;
    fill("#rhome", `${rec.length ? `<div class="sec"><h2 class="h2">Recent</h2></div><div style="padding:0 16px">${chips(rec)}</div>` : ""}
      ${held.length ? `<div class="sec"><h2 class="h2">In your models</h2></div><div style="padding:0 16px">${chips(held)}</div>` : ""}
      <div class="sec"><h2 class="h2">Watchlist</h2></div><div id="rwatch" style="padding:0 16px">${spinner()}</div>
      <p class="tiny muted" style="margin:18px 20px 0;line-height:1.45">Every stock and fund gets the same page: price and returns vs the S&P 500, valuation, the business, the Street's view, options flow, and insider and government trades.</p>`);
    api("/watchlist").then((w) => fill("#rwatch", chips(w.map((x) => x.t)))).catch(() => fill("#rwatch", ""));
  };
  home();
  let tm; const run = async () => { const v = $("#rq").value.trim(); if (!v) { fill("#rr", ""); return; }
    try { const r = await api("/search?q=" + encodeURIComponent(v));
      fill("#rr", r.length ? `<div class="card pad0" style="margin-top:10px">${r.map((x) => `<a class="li" href="#research/${esc(x.t)}">${logo(x.t, 30)}<div class="grow1"><div style="font-weight:700">${esc(x.t)}</div><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.n || "")}</div></div>${x.last ? `<div style="text-align:right"><div class="n" style="font-weight:600">${F.px(x.last)}</div><div class="n tiny ${F.cls(x.changepct)}">${F.chg(x)}</div></div>` : ""}<span class="muted">›</span></a>`).join("")}</div>`
        : `<p class="small muted" style="margin:10px 20px">No match. Try the ticker.</p>`); } catch (e) { fill("#rr", err(e)); } };
  $("#rq").oninput = () => { clearTimeout(tm); tm = setTimeout(run, 300); };
  $("#rq").onkeydown = (e) => { if (e.key === "Enter") { const v = $("#rq").value.trim().replace("$", ""); if (/^[A-Za-z.\-]{1,6}$/.test(v)) location.hash = "#research/" + v.toUpperCase(); else run(); } };
}

function plusSheet(d) {
  const s = sheet(`<div style="padding:0 18px"><h2 class="h2">${esc(d.ticker)}</h2><p class="small muted" style="margin:4px 0 0">${esc(d.name)}</p>
    <button class="li" id="pm" style="width:100%;background:none;border:0;cursor:pointer;text-align:left;margin-top:8px"><span style="font-size:22px;width:34px">📊</span><div class="grow1"><div style="font-weight:600">Add to a model</div><div class="tiny muted">Pick the model and a target weight</div></div><span class="muted">›</span></button>
    <button class="li" id="pw" style="width:100%;background:none;border:0;cursor:pointer;text-align:left"><span style="font-size:22px;width:34px">${d.watch ? "✓" : "👁"}</span><div class="grow1"><div style="font-weight:600">${d.watch ? "Remove from watchlist" : "Add to watchlist"}</div><div class="tiny muted">The bots watch everything on it</div></div></button>
    <button class="li" id="pc" style="width:100%;background:none;border:0;cursor:pointer;text-align:left"><span style="font-size:22px;width:34px">⚖️</span><div class="grow1"><div style="font-weight:600">${isFundD(d) ? "Compare with another fund" : "Compare with another stock or fund"}</div><div class="tiny muted">${isFundD(d) ? "Similar funds, or any symbol" : "Side by side: returns, valuation, risk"}</div></div><span class="muted">›</span></button>
    <div id="pbody"></div></div>`);
  $("#pw", s).onclick = async () => { try { await api("/watchlist", { body: { ticker: d.ticker, remove: d.watch } }); d.watch = !d.watch; MEMR[d.ticker] = null; toast(d.watch ? "Added to watchlist" : "Removed from watchlist"); s.remove(); } catch (e) { toast(e.message); } };
  $("#pm", s).onclick = async () => { const ms = await getModels();
    fill("#pbody", `<div class="eyebrow" style="margin-top:14px">Which model</div>${ms.map((m, i) => `<label class="li" style="cursor:pointer"><input type="radio" name="pmm" value="${m.id}" ${i === 0 ? "checked" : ""} style="width:20px;height:20px"><div class="grow1" style="font-weight:600">${esc(m.name)}</div>${(m.holdings || []).find((h) => h.t === d.ticker) ? `<span class="tiny muted">already ${F.bps(m.holdings.find((h) => h.t === d.ticker).w)}</span>` : ""}</label>`).join("")}
      <div class="row" style="gap:10px;margin-top:12px"><div class="field" style="flex:1;height:48px"><input id="pmw" inputmode="decimal" placeholder="Target weight" value="5"><span class="muted">%</span></div>
      <button class="btn primary" id="pmgo" style="flex:1">Add</button></div>
      <p class="tiny muted" style="margin:8px 0 0">Opens the model with ${esc(d.ticker)} added so you can trim the others to 100% and save.</p>`);
    $("#pmgo", s).onclick = () => { const id = (s.querySelector('input[name="pmm"]:checked') || {}).value; const w = Number($("#pmw", s).value); if (!id || !(w > 0 && w <= 100)) return toast("Pick a model and a weight.");
      try { sessionStorage.setItem("odesa_add", JSON.stringify({ id, t: d.ticker, n: d.name, w })); } catch (_) {} s.remove(); location.hash = "#manager/" + id; }; };
  $("#pc", s).onclick = () => { const peers = ((d.street && d.street.fund && d.street.fund.peers) || []).filter((p2) => p2 && p2.t);
    fill("#pbody", `${peers.length ? `<div class="eyebrow" style="margin-top:14px">Similar funds</div>${peers.map((p2) => `<button class="li" data-c="${esc(p2.t)}" style="width:100%;background:none;border:0;cursor:pointer;text-align:left">${logo(p2.t, 28)}<div class="grow1"><div style="font-weight:700">${esc(p2.t)} <span class="small muted" style="font-weight:500">${esc(p2.n || "")}</span></div>${p2.why ? `<div class="tiny muted">${esc(p2.why)}</div>` : ""}</div><span class="muted">›</span></button>`).join("")}` : ""}
      <div class="eyebrow" style="margin-top:14px">${peers.length ? "Or type a symbol" : "Compare with"}</div>
      <div class="field grey" style="margin-top:8px">${ICON.search}<input id="pcq" placeholder="${isFundD(d) ? "Fund symbol (e.g. VFIAX)" : "Ticker (e.g. SPY)"}" autocapitalize="characters"></div>
      <div class="chips" style="flex-wrap:wrap;padding:8px 0 0">${["SPY", "QQQ", ...recentGet().filter((x) => x !== d.ticker && !peers.find((p2) => p2.t === x)).slice(0, 5)].map((t) => `<button class="chip" data-c="${esc(t)}">${esc(t)}</button>`).join("")}</div>`);
    const go = (u) => { u = String(u || "").trim().toUpperCase().replace("$", ""); if (!/^[A-Z.\-]{1,6}$/.test(u)) return toast("Enter a ticker."); s.remove(); location.hash = `#compare/${d.ticker}/${u}`; };
    if (!peers.length) $("#pcq", s).focus(); $("#pcq", s).onkeydown = (e) => { if (e.key === "Enter") go($("#pcq", s).value); }; s.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => go(b.dataset.c)); };
}

const RANGES = [["1M", 1 / 12], ["6M", 0.5], ["1Y", 1], ["5Y", 5], ["10Y", 10]];
function sliceYears(px, y) { const d = new Date(); d.setTime(d.getTime() - y * 365.25 * 86400000); const cut = d.toISOString().slice(0, 10); let i = 0; for (let k = 0; k < px.length; k++) if (px[k][0] <= cut) i = k; return px.slice(i); }
function align(a, b) { const m = new Map(b); let last = null; return a.map(([d]) => { if (m.has(d)) last = m.get(d); return last; }); }

async function vProfile(t) {
  t = String(t).toUpperCase(); recentAdd(t);
  page(`${hdr("", { back: "hist", right: `<button class="plus" id="rplus" aria-label="Add or compare" style="width:40px;height:40px;border-radius:20px;border:0;background:var(--brass);color:#fff;font-size:24px;font-weight:600;cursor:pointer;line-height:1">＋</button>` })}<div id="rp">${spinner("Pulling it together")}</div>`, "research");
  let d; try { d = await getProfile(t); } catch (e) { return fill("#rp", err(e)); }
  const st = { range: "1Y", vsSpy: false, tab: d.kind === "fund" ? "fund" : "biz" };
  $("#rplus").onclick = () => plusSheet(d);
  const q = d.quote || {};
  const draw = () => {
    const R = d.returns || { t: {}, spy: {} };
    const isF = isFundD(d); const FD = (d.street && d.street.fund) || {};
    const hasFlow = d.flow && (d.flow.pcr !== null || (d.flow.alerts || []).length);
    const tabs = isF ? [["fund", "Holdings"], ["sectors", "Sectors"], ...(hasFlow ? [["flow", "Flow"]] : [])] : [["biz", "Business"], ["street", "Street"], ["flow", "Flow"], ["people", "Insiders"]];
    if (isF && !tabs.find((x) => x[0] === st.tab)) st.tab = "fund";
    if (!isF && !tabs.find((x) => x[0] === st.tab)) st.tab = "biz";
    const FT = isF ? fundTop(d) : null; const FR = isF ? fundRet(d) : null;
    const rng = d.range || {};
    const pos = (v) => rng.hi && rng.lo && v !== null && v !== undefined ? Math.max(0, Math.min(100, (v - rng.lo) / (rng.hi - rng.lo) * 100)) : null;
    fill("#rp", `
      <div style="padding:10px 20px 0" class="row"><div style="width:52px;height:52px;border-radius:14px;overflow:hidden;background:#fff;flex:none;display:flex;align-items:center;justify-content:center">${logo(t, 52)}</div>
        <div style="margin-left:12px;min-width:0"><div class="small muted" style="font-weight:700">${esc(t)}${isF ? [FD.category || d.sector, FD.family, FD.aum ? F.money(FD.aum) + " in assets" : ""].filter(Boolean).map((x) => " · " + esc(x)).join("") : (d.sector ? " · " + esc(d.sector) : "") + (d.mcap ? " · " + sizeName(d.mcap) : "")}</div>
          <div style="font-size:21px;font-weight:700;letter-spacing:-.02em;line-height:1.2">${esc(d.name)}</div></div></div>
      <div style="padding:12px 20px 0"><span class="big n">${F.px(d.last)}</span>${isF && !d.quote && FD.nav ? `<span class="tiny muted"> NAV${FD.nav_date ? " · " + F.date(FD.nav_date) : ""}</span>` : ""} ${d.quote ? `<span class="n ${F.cls(q.changepct)}" style="font-weight:600;margin-left:6px">${q.change !== undefined && q.change !== null ? (q.change >= 0 ? "+" : "−") + "$" + Math.abs(q.change).toFixed(2) + " · " : ""}${F.chg(q)} today</span>` : ""}</div>
      ${d.about ? `<p style="margin:8px 20px 0;font-size:15px;line-height:1.4;color:var(--gray)">${esc(d.about)}</p>` : ""}
      ${d.models.length || d.watch ? `<div class="chips" style="padding-top:10px">${d.models.map((m) => `<a class="chip" href="#portfolio/${m.id}" style="background:#F5EEE2;border-color:#E8DCC4;color:var(--brass-t)">In ${esc(m.model)} · ${F.bps(m.w)}</a>`).join("")}${d.watch ? `<span class="chip">On watchlist ✓</span>` : ""}</div>` : ""}
      ${isF && d.street_pending && !d.street ? `<div class="card"><div class="empty" style="padding:12px 8px"><span class="spin"></span><div style="margin-top:8px">Gathering ratings, fees and managers. About a minute the first time.</div></div></div>` : ""}
      ${isF ? FT.rating : ""}
      <div class="cols"><div>
      <div style="${(d.prices || []).length < 2 ? "display:none" : ""}"><div class="card" style="padding:10px 6px 4px"><div id="rchart"></div></div>
      <div class="row" style="margin:10px 16px 0;gap:8px"><div class="seg light" style="flex:1">${RANGES.map(([k]) => `<button class="${st.range === k ? "on" : ""}" data-rg="${k}">${k}</button>`).join("")}</div>
        <button class="chip ${st.vsSpy ? "on" : ""}" id="rvs" style="height:38px">vs S&P</button></div></div>
      <div class="card"><div class="row between"><div class="eyebrow">Returns vs S&P 500</div><span class="tiny muted">per year · ${FR && FR.total ? "total return" : "price only"}</span></div>
        <div style="display:grid;grid-template-columns:minmax(64px,1fr) repeat(4,minmax(0,1fr));gap:8px 4px;margin-top:10px;align-items:center;font-size:15px">
          <span></span>${["1Y", "3Y", "5Y", "10Y"].map((k) => `<span class="tiny muted" style="text-align:right;font-weight:700">${k}</span>`).join("")}
          <b>${esc(t)}</b>${["1Y", "3Y", "5Y", "10Y"].map((k) => { const v = (FR || R).t[k]; return `<span class="n ${F.cls(v)}" style="text-align:right;font-weight:700">${pctS(v)}</span>`; }).join("")}
          ${FR && Object.values(FR.cat).some((v) => v !== null) ? `<span class="muted">Category</span>${["1Y", "3Y", "5Y", "10Y"].map((k) => `<span class="n muted" style="text-align:right">${pctS(FR.cat[k])}</span>`).join("")}` : ""}
          <span class="muted">S&P</span>${["1Y", "3Y", "5Y", "10Y"].map((k) => `<span class="n muted" style="text-align:right">${pctS(R.spy[k])}</span>`).join("")}</div>
        ${FR && FR.total ? `<p class="tiny muted" style="margin:8px 0 0">Fund figures are total returns from the fund's published data; loads not deducted.</p>` : ""}
        ${d.history_from && d.history_from > new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10) ? `<p class="tiny muted" style="margin:8px 0 0">Trading since ${F.date(d.history_from)}; longer periods fill in as it ages.</p>` : ""}</div>
      </div><div>
      ${isF ? FT.fees + FT.mgr : ""}
      <div class="card" style="${isF ? "display:none" : ""}"><div class="grid2" style="gap:16px 10px">
        ${[["Market cap", F.money(d.mcap)], [isF ? "P/E (holdings)" : "P/E · trailing / fwd", `${xx(d.pe)} <span class="muted" style="font-weight:500">/</span> ${xx(d.fpe)}`],
           [isF ? "Yield" : "Dividend yield", pctU(isF && d.street && d.street.fund && d.street.fund.yield !== null ? (d.street.fund.yield > 1 ? d.street.fund.yield / 100 : d.street.fund.yield) : d.dy, 2)], ["Beta", d.beta !== null && d.beta !== undefined ? d.beta.toFixed(2) : "–"],
           ["Short interest", pctU(d.short)], [isF ? "Expense ratio" : "Next earnings", isF ? (d.street && d.street.fund && d.street.fund.expense_ratio !== null && d.street.fund.expense_ratio !== undefined ? (d.street.fund.expense_ratio > 0.05 ? d.street.fund.expense_ratio.toFixed(2) + "%" : (d.street.fund.expense_ratio * 100).toFixed(2) + "%") : "–") : d.next_er ? F.date(d.next_er) : "–"]]
          .map(([a, b]) => `<div><div class="tiny muted" style="font-weight:600">${a}</div><div class="n" style="font-size:19px;font-weight:700;margin-top:3px">${b}</div></div>`).join("")}</div></div>
      ${rng.hi ? `<div class="card"><div class="eyebrow">52-week range</div>
        <div style="position:relative;height:30px;margin-top:14px"><div style="position:absolute;left:0;right:0;top:12px;height:6px;border-radius:3px;background:linear-gradient(90deg,#F3D9D5,#E8EDE9,#D5EBDB)"></div>
          ${[["50-day", rng.sma50, "var(--gray2)"], ["200-day", rng.sma200, "var(--brass)"]].filter((x) => pos(x[1]) !== null).map(([l, v, c]) => `<i title="${l}" style="position:absolute;left:${pos(v)}%;top:6px;width:2px;height:18px;background:${c};border-radius:1px"></i>`).join("")}
          ${pos(rng.last) !== null ? `<i style="position:absolute;left:calc(${pos(rng.last)}% - 8px);top:7px;width:16px;height:16px;border-radius:8px;background:var(--navy);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25)"></i>` : ""}</div>
        <div class="row between small n" style="margin-top:4px"><span>${F.px(rng.lo)}</span><span class="muted">now ${F.px(rng.last)}</span><span>${F.px(rng.hi)}</span></div>
        <div class="tiny muted" style="margin-top:6px"><span style="color:var(--gray2)">▍</span> 50-day ${F.px(rng.sma50)} &nbsp; <span style="color:var(--brass)">▍</span> 200-day ${F.px(rng.sma200)}${rng.hi && rng.last ? ` &nbsp;·&nbsp; ${pctS(rng.last / rng.hi - 1)} from high` : ""}</div></div>` : ""}
      </div></div>
      ${isF ? "" : `<div id="rearn"></div>`}
      <div class="seg light" style="margin:16px 16px 0">${tabs.map(([k, l]) => `<button class="${st.tab === k ? "on" : ""}" data-tb="${k}">${l}</button>`).join("")}</div>
      <div id="rtab">${tabHtml(d, st.tab)}</div>
      <div class="card" id="rsum"><div class="row between"><h2 class="h2">What's being said</h2><span class="tiny muted" id="rsum-at"></span></div><div id="rsum-b">${spinner()}</div></div>
      ${d.filings && d.filings.length ? `<div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Filings</h2></div>${d.filings.map((f) => `<a class="li" href="${esc(safeUrl(f.url) || "#")}" target="_blank" rel="noopener"><span class="pill" style="background:var(--soft)">${esc(f.form)}</span><div class="grow1 small">${esc(f.desc || f.items || "")}</div><span class="tiny muted">${F.date(f.filed)}</span></a>`).join("")}</div>` : ""}
      <div class="grid2" style="margin:14px 16px 0"><button class="btn primary" id="rplus2">＋ Add or compare</button><button class="btn ghost" id="ropal">Ask Opal</button></div>
      <p class="tiny muted" style="margin:12px 20px 0;line-height:1.4">Prices: MarketData · Flow & screens: Unusual Whales · Financials: ROIC · Street & fund facts: public sources via Grok, refreshed weekly${d.street ? " (" + F.date(d.street.at.slice(0, 10)) + ")" : ""}. Research, not advice.</p>`);
    drawChart();
    $$("[data-rg]").forEach((b) => b.onclick = () => { st.range = b.dataset.rg; $$("[data-rg]").forEach((x) => x.classList.toggle("on", x === b)); drawChart(); });
    $("#rvs").onclick = () => { st.vsSpy = !st.vsSpy; $("#rvs").classList.toggle("on", st.vsSpy); drawChart(); };
    $$("[data-tb]").forEach((b) => b.onclick = () => { st.tab = b.dataset.tb; $$("[data-tb]").forEach((x) => x.classList.toggle("on", x === b)); fill("#rtab", tabHtml(d, st.tab)); });
    $("#rplus2").onclick = () => plusSheet(d);
    $("#ropal").onclick = async () => { const r = await api("/opal", { body: { q: `What is driving ${t} right now, and what comes next for it and its suppliers and competitors?` } }); location.hash = "#opal/run/" + r.id; };
    const sum = (s) => { fill("#rsum-at", s.at ? (F.ago(s.at) === "now" ? "just now" : F.ago(s.at) + " ago") : ""); fill("#rsum-b", [["X", "On X", s.x], ["T", "Latest news", s.news], ["E", "Last call", s.call]].filter((x) => x[2]).map(([k, h, v]) => `<div style="display:grid;grid-template-columns:26px 1fr;gap:10px;padding-top:12px">${dot(k === "E" ? "T" : k, 26)}<div><div class="small muted" style="font-weight:700">${h}</div><div style="font-size:15px;line-height:1.35">${esc(v)}</div></div></div>`).join("")
      + `<button class="btn small soft" id="rs-re" style="margin-top:12px">Refresh</button>`); $("#rs-re").onclick = () => { fill("#rsum-b", spinner()); api(`/stock/${t}/summary?force=1`).then(sum).catch((e) => fill("#rsum-b", err(e))); }; };
    api(`/stock/${t}/summary`).then(sum).catch((e) => fill("#rsum-b", err(e)));
    if (!isF) loadEarnings(d, st);
  };
  const drawChart = () => {
    const el = $("#rchart"); if (!el) return; const y = RANGES.find((r) => r[0] === st.range)[1];
    const px = sliceYears(d.prices || [], y); if (px.length < 2) { el.innerHTML = `<div class="empty" style="padding:40px 10px">${isFundD(d) ? "Daily prices aren't available for this fund from our price feed; returns below come from the fund's published figures." : "No price history yet."}</div>`; return; }
    const a0 = px[0][1], up = px[px.length - 1][1] >= a0, color = up ? "var(--up)" : "var(--down)";
    const pts = px.map(([dd, c]) => ({ y: c, label: F.date(dd) + (y > 1 ? " '" + dd.slice(2, 4) : "") }));
    const series = [{ pts, color }];
    if (st.vsSpy && d.spy && d.spy.length) { const sp = align(px, d.spy); const s0 = sp.find((v) => v) || 1; series.push({ pts: sp.map((v, i) => ({ y: (v || s0) / s0 * a0, label: pts[i].label })), color: "var(--brass)", dash: true }); }
    lineChart(el, series, { h: 200, baseline: a0 });
  };
  draw();
  if (d.street_pending && !d.street) { let n = 0; const poll = setInterval(async () => { n++; if (!$("#rtab") || n > 9) return clearInterval(poll);
    try { const r = await api(`/research/${t}/street`); if (r.street) { clearInterval(poll); d.street = r.street; d.street_pending = false; if (!d.about) d.about = r.street.about; MEMR[t] = null; draw(); } } catch (_) {} }, 20000); }
}

function tabHtml(d, tab) {
  const S = d.street || {}; const pend = d.street_pending && !d.street;
  const wait = `<div class="card"><div class="empty" style="padding:16px 8px"><span class="spin"></span><div style="margin-top:10px">Gathering this from public sources. It takes about a minute the first time, then it's saved for the week.</div></div></div>`;
  const kv = (rows) => `<div class="card"><div class="grid2" style="gap:16px 10px">${rows.map(([a, b, c]) => `<div><div class="tiny muted" style="font-weight:600">${a}</div><div class="n" style="font-size:19px;font-weight:700;margin-top:3px">${b}</div>${c ? `<div class="tiny muted" style="margin-top:2px">${c}</div>` : ""}</div>`).join("")}</div></div>`;
  if (tab === "biz") {
    const f = d.fin; if (!f) return `<div class="card"><div class="empty">No financial statements found for ${esc(d.ticker)}.</div></div>`;
    const qs = f.quarters.slice(-8); const maxR = Math.max(...qs.map((x) => Math.abs(x.rev || 0)), 1);
    const debt = S.total_debt ?? null, cash = f.cash;
    return `${kv([["Revenue · last 12 mo", F.money(f.ttm.rev), f.ttm.rev_g !== null ? `<span class="${F.cls(f.ttm.rev_g)}">${pctS(f.ttm.rev_g)} vs prior year</span>` : ""],
        ["EPS · last 12 mo", f.ttm.eps !== null ? "$" + f.ttm.eps.toFixed(2) : "–", "diluted"], ["Operating margin", pctU(f.ttm.opm), "last 12 months"],
        ["Gross margin", pctU(S.gross_margin !== null && S.gross_margin !== undefined ? (S.gross_margin > 1 ? S.gross_margin / 100 : S.gross_margin) : null), S.gross_margin !== undefined ? "" : pend ? "gathering…" : ""],
        ["Free cash flow · 12 mo", F.money(f.ttm.fcf), ""], ["Cash & investments", F.money(cash), qs.length ? "as of " + F.date(qs[qs.length - 1].date) : ""]])}
      ${cash !== null && debt !== null ? `<div class="card"><div class="row between"><div class="eyebrow">Cash vs debt</div><b class="n ${cash - debt >= 0 ? "up" : "down"}">${cash - debt >= 0 ? "Net cash " : "Net debt "}${F.money(Math.abs(cash - debt))}</b></div>
        <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-top:12px;gap:2px"><i style="flex:${cash};background:var(--up)"></i><i style="flex:${debt};background:#D8B4AE"></i></div>
        <div class="row between small" style="margin-top:6px"><span>Cash ${F.money(cash)}</span><span class="muted">Debt ${F.money(debt)}</span></div></div>` : ""}
      <div class="card"><div class="row between"><div class="eyebrow">Quarterly revenue</div><span class="tiny muted">EPS below</span></div>
        <div style="display:grid;grid-template-columns:repeat(${qs.length},1fr);gap:6px;align-items:end;height:120px;margin-top:12px">${qs.map((x) => `<div style="display:flex;flex-direction:column;justify-content:flex-end;height:100%"><div class="tiny n" style="text-align:center;font-weight:600;margin-bottom:3px">${F.money(x.rev).replace("$", "")}</div><i style="display:block;height:${Math.max(3, Math.abs(x.rev || 0) / maxR * 82)}px;background:var(--navy);border-radius:5px 5px 2px 2px;opacity:${x === qs[qs.length - 1] ? 1 : .55}"></i></div>`).join("")}</div>
        <div style="display:grid;grid-template-columns:repeat(${qs.length},1fr);gap:6px;margin-top:6px">${qs.map((x) => `<div style="text-align:center"><div class="tiny n ${F.cls(x.eps)}" style="font-weight:700">${x.eps !== null ? (x.eps < 0 ? "−" : "") + "$" + Math.abs(x.eps).toFixed(2) : "–"}</div><div class="tiny muted" style="font-size:10px">${esc(x.label || F.date(x.date))}</div></div>`).join("")}</div></div>
`;
  }
  if (tab === "street") {
    if (pend) return wait; if (!d.street) return `<div class="card"><div class="empty">No analyst coverage found.</div></div>`;
    const up = S.target_avg && d.last ? S.target_avg / d.last - 1 : null;
    const pos = (v) => S.target_high && S.target_low && S.target_high > S.target_low ? Math.max(0, Math.min(100, (v - S.target_low) / (S.target_high - S.target_low) * 100)) : null;
    const act = (a) => /raise|upgrad|initiat/.test(a || "") ? "up" : /lower|downgrad|cut/.test(a || "") ? "down" : "muted";
    return `${kv([["Consensus", esc(S.consensus || "–"), S.analysts ? S.analysts + " analysts" : ""], ["Average target", S.target_avg ? F.px(S.target_avg) : "–", up !== null ? `<span class="${F.cls(up)}">${pctS(up)} from here</span>` : ""],
        ["Short interest", pctU(d.short), "of float"], ["Range of targets", S.target_low && S.target_high ? `${F.px(S.target_low).replace(".00", "")}–${F.px(S.target_high).replace(".00", "")}` : "–", ""]])}
      ${pos(d.last) !== null ? `<div class="card"><div class="eyebrow">Where the price sits in the targets</div><div style="position:relative;height:26px;margin-top:12px"><div style="position:absolute;left:0;right:0;top:10px;height:6px;border-radius:3px;background:var(--soft)"></div>
        <i style="position:absolute;left:calc(${pos(S.target_avg)}% - 1px);top:4px;width:2px;height:18px;background:var(--brass)"></i><i style="position:absolute;left:calc(${pos(d.last)}% - 8px);top:5px;width:16px;height:16px;border-radius:8px;background:var(--navy);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.25)"></i></div>
        <div class="row between tiny muted"><span>Low ${F.px(S.target_low)}</span><span style="color:var(--brass-t)">avg ${F.px(S.target_avg)}</span><span>High ${F.px(S.target_high)}</span></div></div>` : ""}
      ${(S.recent || []).length ? `<div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Recent rating changes</h2></div>${S.recent.map((r) => `<div class="li" style="cursor:default"><div class="grow1"><div style="font-weight:700">${esc(r.firm || "")}</div><div class="tiny muted">${esc(r.rating || "")}${r.action ? " · " + esc(r.action) : ""}</div></div>
        <div style="text-align:right"><div class="n" style="font-weight:700">${r.from && r.to && r.from !== r.to ? `<span class="muted" style="text-decoration:line-through;font-weight:500">${F.px(r.from).replace(".00", "")}</span> → ` : ""}<span class="${act(r.action)}">${r.to ? F.px(r.to).replace(".00", "") : ""}</span></div><div class="tiny muted">${r.date ? F.date(r.date) : ""}</div></div></div>`).join("")}</div>` : ""}`;
  }
  if (tab === "sectors") { if (pend) return wait; const f = (S.fund || {}); const wv = (w) => w === null || w === undefined ? 0 : w > 1 ? w : w * 100;
    return (f.sectors || []).length ? `<div class="card">${f.sectors.slice(0, 12).map((x) => `<div style="margin-top:10px"><div class="row between small"><span style="font-weight:600">${esc(x.name)}</span><b class="n">${wv(x.w).toFixed(1)}%</b></div><div style="height:7px;border-radius:4px;background:var(--soft);margin-top:4px;overflow:hidden"><i style="display:block;height:100%;width:${Math.min(100, wv(x.w))}%;background:var(--navy);border-radius:4px"></i></div></div>`).join("")}</div>` : `<div class="card"><div class="empty">No sector breakdown found.</div></div>`; }
  if (tab === "fund") {
    if (pend) return wait; const f = (S.fund || {});
    const er = f.expense_ratio !== null && f.expense_ratio !== undefined ? (f.expense_ratio > 0.05 ? f.expense_ratio.toFixed(2) + "%" : (f.expense_ratio * 100).toFixed(2) + "%") : "–";
    const wv = (w) => w === null || w === undefined ? 0 : w > 1 ? w : w * 100;
    const top5 = (f.top || []).slice(0, 5).reduce((s2, h) => s2 + wv(h.w), 0);
    return `${kv([["Holdings", f.holdings ? Number(f.holdings).toLocaleString() : "–", top5 ? `top 5 = ${top5.toFixed(1)}% of assets` : ""], ["Tracks", esc(f.index || "Actively managed"), ""],
        ["Since", f.inception ? new Date(f.inception + "T12:00:00").getFullYear() : "–", esc(f.asset_class || "")], ["Assets", F.money(f.aum), ""]])}
      ${(f.top || []).length ? `<div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Top holdings</h2></div>${f.top.map((h) => `<a class="li" href="#research/${esc(h.t || "")}">${logo(h.t || "", 28)}<div class="grow1"><div style="font-weight:700">${esc(h.t || "")}</div><div class="tiny muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(h.n || "")}</div></div><b class="n">${wv(h.w).toFixed(1)}%</b></a>`).join("")}</div>` : ""}
`;
  }
  if (tab === "flow") {
    const fl = d.flow || {};
    return `${kv([["Put / call ratio", fl.pcr !== null && fl.pcr !== undefined ? fl.pcr.toFixed(2) : "–", fl.pcr !== null && fl.pcr !== undefined ? (fl.pcr < 0.7 ? "leaning calls" : fl.pcr > 1.2 ? "leaning puts" : "balanced") : ""],
        ["IV rank", fl.ivr !== null && fl.ivr !== undefined ? Math.round(fl.ivr) : "–", fl.iv ? "IV " + (fl.iv * 100).toFixed(0) + "%" : ""],
        ["Call premium today", `<span class="up">${F.money(fl.callp)}</span>`, ""], ["Put premium today", `<span class="down">${F.money(fl.putp)}</span>`, ""],
        ["Expected move · 30 days", fl.move30 ? "±" + (fl.move30 * 100).toFixed(1) + "%" : "–", "from options prices"], ["Bullish vs bearish $", fl.bull || fl.bear ? `${F.money(fl.bull)} / ${F.money(fl.bear)}` : "–", ""]])}
      <div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Big option trades</h2></div>${(fl.alerts || []).length ? fl.alerts.map((a) => `<div class="li" style="cursor:default"><span class="pill" style="background:${a.kind === "call" ? "#E6F2E9" : "#FBE9E6"};color:${a.kind === "call" ? "var(--up)" : "var(--down)"}">${a.kind === "call" ? "Call" : "Put"}</span>
        <div class="grow1"><div style="font-weight:600">${a.strike ? "$" + a.strike : ""} ${a.expiry ? F.date(a.expiry) : ""}${a.sweep ? " · sweep" : ""}</div><div class="tiny muted">${esc(a.side || "")}${a.ts ? " · " + F.ago(a.ts) + " ago" : ""}</div></div><b class="n">${F.money(a.premium)}</b></div>`).join("") : `<div class="empty">No large trades flagged lately.</div>`}</div>
      <p class="tiny muted" style="margin:8px 20px 0">Big trades can be hedges. Read them as interest, not direction.</p>`;
  }
  const P = d.people || { congress: [], insiders: [], gov: [] };
  const row = (who, sub, what, cls, when) => `<div class="li" style="cursor:default"><div class="grow1"><div style="font-weight:700">${esc(who || "")}</div><div class="tiny muted">${esc(sub || "")}</div></div><div style="text-align:right"><div class="small ${cls}" style="font-weight:600">${what}</div><div class="tiny muted">${when}</div></div></div>`;
  const lag = (a, b) => a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : null;
  return `<div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Insiders</h2></div>${P.insiders.length ? P.insiders.map((x) => row(x.who, x.role, `${x.buy ? "Bought" : "Sold"} ${x.shares ? Math.round(x.shares).toLocaleString() + " sh" : ""}${x.price ? " @ $" + x.price : ""}`, x.buy ? "up" : "down", `${x.traded ? F.date(x.traded) : ""}${lag(x.traded, x.filed) !== null ? " · filed " + lag(x.traded, x.filed) + "d later" : ""}`)).join("") : `<div class="empty">No insider filings found.</div>`}</div>
    <div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Congress</h2></div>${P.congress.length ? P.congress.map((x) => row(x.who, x.chamber, `${esc(x.txn || "")} ${esc(x.amount || "")}`, /buy|purchase/i.test(x.txn || "") ? "up" : "down", `${x.traded ? F.date(x.traded) : ""}${lag(x.traded, x.filed) !== null ? " · " + lag(x.traded, x.filed) + "d lag" : ""}`)).join("") : `<div class="empty">No trades by members of Congress.</div>`}</div>
    ${P.gov.length ? `<div class="card pad0"><div style="padding:12px 0 4px"><h2 class="h2">Lobbying & contracts</h2></div>${P.gov.map((g) => `<div class="li" style="cursor:default"><div class="grow1 small">${esc(g.title)}</div><span class="tiny muted">${F.date(String(g.ts).slice(0, 10))}</span></div>`).join("")}</div>` : ""}
    <p class="tiny muted" style="margin:8px 20px 0;line-height:1.4">Insiders file within 2 business days; members of Congress can take up to 45 days. These are old news by the time they show up.</p>`;
}

// ---------------------------------------------------------------- Earnings breakdown (Call Surgeon)
const ETABS = [["res", "Results"], ["drv", "What drove it"], ["tgt", "Price targets"], ["call", "From the call"], ["tone", "Flags & tone"], ["down", "Down the line"]];
const hasTone = (r) => !!((r.flags || []).length || r.tone_shift || r.prep || r.swag || (r.language_diffs || []).length || (r.unsaid || []).length || (r.pm_summary || []).length);
function toneTab(r) {
  const T = r.tone_shift; const sev = (n) => n ? `<span title="severity ${n} of 5" style="letter-spacing:1px;color:${n >= 4 ? "var(--down)" : n >= 3 ? "var(--amber)" : "var(--gray2)"}">${"●".repeat(n)}<span style="color:#E3E4E7">${"●".repeat(Math.max(0, 5 - n))}</span></span>` : "";
  // flags may come as {kind, tag, severity} or Call Surgeon's native {type: "constraint:TAG", note: "... Severity 4."}
  const F = (r.flags || []).map((f) => { const ty = String(f.type || ""); const kind = f.kind || (ty.split(":")[0] || "constraint"); const tag = f.tag || ty.split(":")[1] || "";
    const sv = Number(f.severity) || Number((String(f.note || "").match(/severity\s*(\d)/i) || [])[1]) || null; return { ...f, kind, tag, sev: sv }; });
  const group = (k, label, col) => { const xs = F.filter((f) => f.kind === k).sort((a, b) => (b.sev || 0) - (a.sev || 0) || (b.weight || 0) - (a.weight || 0)); if (!xs.length) return "";
    return `<div class="eyebrow" style="margin-top:16px;color:${col}">${label} (${xs.length})</div>${xs.map((f) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
      <div class="row" style="gap:8px;flex-wrap:wrap">${f.tag ? `<span class="pill" style="background:var(--soft);font-family:ui-monospace,Menlo,monospace;font-size:11px">${esc(f.tag)}</span>` : ""}${sev(f.sev)}${f.weight !== undefined && f.weight !== null ? `<span class="tiny muted">w=${Number(f.weight).toFixed(2)}</span>` : ""}</div>
      ${f.quote ? `<div style="font-size:14px;line-height:1.45;margin-top:6px">“${esc(f.quote)}”</div>` : f.quote_unverified ? `<div class="tiny muted" style="font-style:italic;margin-top:6px">Quote left out: couldn't be matched word-for-word to the transcript.</div>` : ""}
      <div class="tiny muted" style="margin-top:4px;line-height:1.4">${[f.speaker, f.section].filter(Boolean).map(esc).join(" · ")}${f.vs_prior ? ` · <b style="color:var(--ink)">vs prior:</b> ${esc(f.vs_prior)}` : ""}</div>
      ${f.note ? `<div class="small" style="margin-top:4px;line-height:1.45;color:var(--gray)">${esc(f.note)}</div>` : ""}</div>`).join("")}`; };
  const list = (title, xs) => (xs || []).length ? `<div class="eyebrow" style="margin-top:16px">${title}</div><ul class="small" style="margin:6px 0 0;padding-left:18px;line-height:1.5">${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  const P = r.prep || {}, S = r.swag || {};
  return `<div class="eyebrow" style="margin-top:14px">Call Surgeon's read <span style="text-transform:none;letter-spacing:0;font-weight:500;font-style:italic">Language signals, scored against the same speakers' last call</span></div>
    ${P.score || S.score ? `<div class="grid2" style="margin-top:10px">${P.score ? `<div style="background:var(--soft);border-radius:12px;padding:10px 12px"><div class="tiny muted" style="font-weight:700">PREP / VAGUENESS</div><div class="n" style="font-size:22px;font-weight:700">${P.score}<span class="small muted">/5</span></div><div class="tiny muted">5 = evasive</div></div>` : ""}
      ${S.score ? `<div style="background:var(--soft);border-radius:12px;padding:10px 12px"><div class="tiny muted" style="font-weight:700">SWAG VS SUBSTANCE</div><div class="n" style="font-size:22px;font-weight:700">${S.score}<span class="small muted">/5</span></div><div class="tiny muted">${esc(S.baseline_or_shift || "")}</div></div>` : ""}</div>` : ""}
    ${T ? `<div style="margin-top:12px;border-left:3px solid var(--brass);padding:2px 0 2px 12px">${typeof T === "string" ? `<div class="small" style="line-height:1.5">${esc(T)}</div>`
      : `${T.prepared ? `<div class="small" style="line-height:1.5"><b>Prepared:</b> ${esc(T.prepared)}</div>` : ""}${T.qa ? `<div class="small" style="line-height:1.5;margin-top:4px"><b>Q&A:</b> ${esc(T.qa)}</div>` : ""}${T.summary ? `<div class="small muted" style="line-height:1.5;margin-top:4px">${esc(T.summary)}</div>` : ""}`}</div>` : ""}
    ${group("constraint", "Constraint flags", "var(--down)")}${group("opportunity", "Opportunity flags", "var(--up)")}${group("swag", "Swag", "var(--amber)")}${group("data-quality", "Data quality", "var(--gray)")}
    ${(P.exchanges || []).length ? `<div class="eyebrow" style="margin-top:16px">Worst exchanges</div>${P.exchanges.map((x) => `<div class="small" style="padding:8px 0;border-bottom:1px solid var(--line);line-height:1.45"><b>${esc(x.asked || "")}</b><br><span class="muted">${esc(x.answer || "")}</span></div>`).join("")}` : ""}
    ${S.quote ? `<div class="small" style="margin-top:12px;line-height:1.45"><b>Swag:</b> “${esc(S.quote)}”${S.note ? ` <span class="muted">${esc(S.note)}</span>` : ""}</div>` : ""}
    ${list("Language changes vs last call", r.language_diffs)}${list("Unsaid", r.unsaid)}
    ${(r.seeds || []).length ? `<div class="eyebrow" style="margin-top:16px">Pattern seeds</div><div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px">${r.seeds.map((x) => `<span class="pill" style="background:var(--soft);font-family:ui-monospace,Menlo,monospace;font-size:11px">${esc(x)}</span>`).join("")}</div>` : ""}
    ${(r.pm_summary || []).length ? `<div style="margin-top:16px;background:#F3F5F8;border-radius:12px;padding:12px 14px"><div class="eyebrow">PM summary · 90 seconds</div><ul class="small" style="margin:6px 0 0;padding-left:18px;line-height:1.5">${r.pm_summary.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}`;
}
const cardGrid = (html) => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:10px;margin-top:10px">${html}</div>`;
const srcLink = (label, url) => url && safeUrl(url) ? `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener" style="color:inherit">${esc(label)}</a>` : esc(label || "");
function earnSection(d, E, tab) {
  const r = E.result || {}; const inM = d.models || [];
  const beatCol = (b) => b === "beat" ? "var(--up)" : b === "miss" ? "var(--down)" : "#D5D7DB";
  let body = "";
  if (tab === "res") {
    body = `<div class="eyebrow" style="margin-top:14px">Results vs Street <span style="text-transform:none;letter-spacing:0;font-weight:500;font-style:italic">Actuals from the 8-K; Street figures are estimates</span></div>
      ${cardGrid((r.results || []).map((x) => `<div style="background:#fff;border:1px solid var(--line);border-left:4px solid ${beatCol(x.beat)};border-radius:14px;padding:12px 14px">
        <div class="small" style="font-weight:600">${esc(x.metric || "")}</div><div class="n" style="font-size:24px;font-weight:700;margin-top:2px">${esc(x.actual || "–")}</div>
        ${x.est ? `<div class="small" style="font-weight:700;color:${x.beat === "miss" ? "var(--down)" : x.beat === "beat" ? "var(--up)" : "var(--gray)"};margin-top:2px">${x.beat === "beat" ? "Beat by " : x.beat === "miss" ? "Missed by " : "In line · "}${esc(x.surprise || "")}</div>
          <div class="tiny muted" style="margin-top:4px;line-height:1.4">Street est. ${esc(x.est)} · ${srcLink(x.est_source, x.est_url)}${x.est_date ? " · as of " + F.date(x.est_date) : ""}${x.est_label ? `<br>${esc(x.est_label)}` : ""}</div>
          ${(x.others || []).length ? `<div class="tiny muted" style="line-height:1.4">Other estimates: ${x.others.map((o) => `${esc(o.value)} (${srcLink(o.source, o.url)})`).join(", ")}</div>` : ""}`
          : `<div class="tiny muted" style="font-style:italic;margin-top:4px">Street estimate not available</div>`}
        ${x.yoy ? `<div class="tiny" style="margin-top:4px">${esc(x.yoy)}</div>` : ""}<div class="tiny muted">${x.prior_q ? "Prior quarter " + esc(x.prior_q) : "Prior quarter not stated"}</div>
        ${x.derived ? `<span class="pill" style="background:var(--soft);margin-top:6px;font-weight:600">Derived from 8-K</span>` : ""}${x.note ? `<div class="tiny" style="margin-top:6px;background:#F5EEE2;border-radius:8px;padding:5px 8px;color:var(--brass-t)">${esc(x.note)}</div>` : ""}</div>`).join(""))}
      ${(r.guidance || []).length ? `<div class="eyebrow" style="margin-top:18px">Guidance · what they expect next</div>${r.guidance.map((g) => `<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line);gap:10px"><div class="grow1"><div style="font-weight:600">${esc(g.item || "")}</div>${g.note ? `<div class="tiny muted">${esc(g.note)}</div>` : ""}</div>
        <div style="text-align:right"><div class="n" style="font-weight:700">${esc(g.value || "")}</div>${g.direction ? `<span class="pill" style="background:${/raise|new/.test(g.direction) ? "#E6F2E9" : /cut/.test(g.direction) ? "#FBE9E6" : "var(--soft)"};color:${/raise|new/.test(g.direction) ? "var(--up)" : /cut/.test(g.direction) ? "var(--down)" : "var(--gray)"}">${esc(g.direction)}</span>` : ""}</div></div>`).join("")}` : ""}`;
  } else if (tab === "drv") {
    body = `<div class="eyebrow" style="margin-top:14px">What drove it <span style="text-transform:none;letter-spacing:0;font-weight:500;font-style:italic">Segments ranked by $ surprise vs estimate</span></div>
      ${(r.drivers || []).map((x, i) => { const up = (x.surprise_pct ?? 0) >= 0; return `<div style="border:1px solid var(--line);border-left:4px solid var(--navy);border-radius:14px;padding:12px 14px;margin-top:10px;background:#fff">
        <div class="row between" style="align-items:flex-start;gap:10px"><div class="grow1"><div><span class="muted" style="font-weight:700;margin-right:8px">${i + 1}</span><b style="font-size:16px">${esc(x.segment || "")}</b>${x.formerly ? ` <span class="tiny muted">(${esc(x.formerly)})</span>` : ""}</div>
          <div style="height:6px;border-radius:3px;background:var(--soft);margin:8px 0 6px;overflow:hidden"><i style="display:block;height:100%;width:${Math.min(100, x.share_pct || 0)}%;background:var(--navy);border-radius:3px"></i></div>
          <div class="tiny muted">${x.share_pct !== null && x.share_pct !== undefined ? Number(x.share_pct).toFixed(1) + "% of revenue" : ""}${x.yoy_pct !== null && x.yoy_pct !== undefined ? ` · ${x.yoy_pct >= 0 ? "+" : ""}${Number(x.yoy_pct).toFixed(1)}% YoY` : ""}</div></div>
          <div class="n" style="font-size:20px;font-weight:700">${esc(x.revenue || "")}</div></div>
        ${x.surprise ? `<div class="small" style="font-weight:700;color:${up ? "var(--up)" : "var(--down)"};margin-top:6px">Surprise ${up ? "up" : "down"} ${esc(x.surprise)}</div>` : ""}
        ${x.est ? `<div class="tiny muted" style="margin-top:3px">Segment est. ${esc(x.est)} · ${srcLink(x.est_source, x.est_url)}${x.est_date ? " · as of " + F.date(x.est_date) : ""}</div>` : ""}
        ${(x.others || []).length ? `<div class="tiny muted">Other estimates: ${x.others.map((o) => `${esc(o.value)} (${srcLink(o.source, o.url)})`).join(", ")}</div>` : ""}
        ${(Array.isArray(x.detail) ? x.detail : x.detail ? [x.detail] : []).length ? `<details style="margin-top:6px"><summary class="small" style="cursor:pointer;font-weight:600">Segment detail</summary><ul class="small" style="margin:6px 0 0;padding-left:18px;line-height:1.45">${(Array.isArray(x.detail) ? x.detail : [x.detail]).map((y) => `<li>${esc(y)}</li>`).join("")}</ul></details>` : ""}</div>`; }).join("") || `<div class="empty">No segment breakdown reported.</div>`}`;
  } else if (tab === "tgt") {
    const T = r.targets || {}; const rows = T.rows || [];
    body = `<div class="eyebrow" style="margin-top:14px">Analyst price targets <span style="text-transform:none;letter-spacing:0;font-weight:500;font-style:italic">Top ~20 firms first; each row links its source</span></div>
      <div class="row" style="gap:14px;margin-top:8px;flex-wrap:wrap;align-items:baseline"><span><b class="n" style="font-size:20px">${rows.length || T.raised + T.cut + T.kept || 0}</b> <span class="small">firms acted${T.window ? ` <span class="muted">(${esc(T.window)})</span>` : ""}</span></span>
        <span><b class="n up" style="font-size:20px">${T.raised ?? 0}</b> <span class="small">raised</span></span><span><b class="n down" style="font-size:20px">${T.cut ?? 0}</b> <span class="small">cut</span></span><span><b class="n" style="font-size:20px">${T.kept ?? 0}</b> <span class="small">kept or rating only</span></span></div>
      <div style="margin-top:6px">${rows.map((x) => { const ch = x.from && x.to && x.from !== x.to ? x.to / x.from - 1 : null; return `<div class="row between" style="padding:11px 0;border-top:1px solid var(--line);gap:8px">
        <div class="grow1" style="min-width:0"><div><b>${esc(x.firm || "")}</b> <span class="small muted">${esc(x.analyst || "")}</span></div><div class="tiny muted">${esc(x.rating || "")}</div></div>
        <div style="text-align:right"><div class="n" style="font-weight:700">${ch !== null ? `<span class="muted" style="text-decoration:line-through;font-weight:500">$${x.from}</span> → ` : ""}$${x.to ?? "–"}</div>
          <div class="tiny"><span class="n ${ch === null ? "muted" : F.cls(ch)}" style="font-weight:700">${ch !== null ? F.pct(ch * 100, 1) : "kept"}</span> <span class="muted">${x.date ? F.date(x.date) : ""}</span>${x.url && safeUrl(x.url) ? ` · <a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener" class="muted">source</a>` : ""}</div></div></div>`; }).join("") || `<div class="empty">No target changes found.</div>`}</div>`;
  } else if (tab === "call") {
    body = `<div class="eyebrow" style="margin-top:14px">Challenges & opportunities <span style="text-transform:none;letter-spacing:0;font-weight:500;font-style:italic">Quotes checked word-for-word against the transcript</span></div>
      ${cardGrid((r.call || []).map((x) => { const ch = x.kind === "challenge"; return `<div style="background:#fff;border:1px solid var(--line);border-left:4px solid ${ch ? "var(--down)" : "var(--up)"};border-radius:14px;padding:12px 14px">
        <div class="tiny" style="font-weight:800;letter-spacing:.08em;color:${ch ? "var(--down)" : "var(--up)"}">${ch ? "CHALLENGE" : "OPPORTUNITY"}</div><div style="font-weight:700;font-size:16px;margin-top:3px;line-height:1.3">${esc(x.title || "")}</div>
        ${x.quote ? `<div style="font-size:14px;line-height:1.45;margin-top:8px">“${esc(x.quote)}”</div>` : `<div class="tiny muted" style="margin-top:6px;font-style:italic">Quote left out: it couldn't be matched word-for-word to the transcript.</div>`}
        ${x.speaker ? `<div class="tiny muted" style="margin-top:4px">${esc(x.speaker)}</div>` : ""}
        ${x.why ? `<div class="small" style="margin-top:8px;line-height:1.45"><b>Why it matters:</b> ${esc(x.why)}</div>` : ""}</div>`; }).join("") || `<div class="empty">Nothing flagged.</div>`)}`;
  } else if (tab === "tone") {
    body = hasTone(r) ? toneTab(r) : `<div class="empty">Call Surgeon's flags and tone read aren't on this breakdown yet. They come with new breakdowns.</div>`;
  } else {
    const readCol = (x) => /good/i.test(x) ? ["#E6F2E9", "var(--up)"] : /bad/i.test(x) ? ["#FBE9E6", "var(--down)"] : ["#FDF1DE", "var(--amber)"];
    body = `<div class="eyebrow" style="margin-top:14px">What this could mean down the line <span style="text-transform:none;letter-spacing:0;font-weight:500;font-style:italic">Possible read-throughs, not predictions or advice</span></div>
      ${cardGrid((r.down_the_line || []).map((x) => { const [bg, fg] = readCol(x.read || ""); return `<a href="#research/${esc(String(x.ticker || "").toUpperCase())}" style="display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid var(--line);border-left:4px solid var(--navy);border-radius:14px;padding:12px 14px">
        <div class="row" style="gap:6px;flex-wrap:wrap"><b>${esc(x.ticker || "")}</b><span class="small muted">${esc(x.name || "")}</span><span class="pill" style="background:${bg};color:${fg}">${esc(x.read || "")}</span>
          ${(x.models || []).map((m) => `<span class="pill" style="background:#F5EEE2;color:var(--brass-t)">In ${esc(m.name)} ${F.bps(m.w)}</span>`).join("")}</div>
        ${x.role ? `<div class="small" style="margin-top:8px;line-height:1.4"><b>${esc(x.relation || "")}:</b> ${esc(x.role)}</div>` : ""}
        ${x.what ? `<div class="small" style="margin-top:6px;line-height:1.45;color:var(--gray)">${esc(x.what)}</div>` : ""}
        ${x.fact ? `<div class="tiny muted" style="margin-top:8px;line-height:1.4">Fact from the report: ${esc(x.fact)}${x.url && safeUrl(x.url) ? ` · <span style="text-decoration:underline">source</span>` : ""}</div>` : ""}</a>`; }).join("") || `<div class="empty">No read-throughs.</div>`)}`;
  }
  const notes = r.notes || [];
  return `<div class="card">
    <div class="row between" style="align-items:flex-start;gap:10px"><div><h2 class="h2">Earnings</h2><div class="tiny muted">Call Surgeon's read of the call, not advice</div></div>${E.newer ? `<button class="chip" id="er-new">Newer call ${F.date(E.newer)} · update</button>` : ""}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">${inM.map((m) => `<span class="pill" style="background:#F5EEE2;color:var(--brass-t)">In ${esc(m.model)} · ${F.bps(m.w)}</span>`).join("")}
      <span class="small muted">${esc(d.name)} · ${esc(r.quarter || "")} earnings${E.call_date ? " · " + F.date(E.call_date) : ""}${r.confidence ? ` · Confidence <b style="color:var(--ink)">${esc(r.confidence)}</b>` : ""}</span></div>
    ${r.headline ? `<div style="font-size:17px;font-weight:700;line-height:1.35;margin-top:10px">${esc(r.headline)}</div>` : ""}
    ${r.verdict ? `<div style="font-size:15px;line-height:1.45;margin-top:6px"><b>Verdict:</b> ${esc(r.verdict)}</div>` : ""}
    <div class="chips" style="padding:12px 0 0;margin:0 -16px;padding-left:16px">${ETABS.filter(([k]) => k !== "tone" || hasTone(r)).map(([k, l]) => `<button class="chip ${tab === k ? "on" : ""}" data-et="${k}">${l}</button>`).join("")}</div>
    ${body}
    ${notes.length ? `<details style="margin-top:14px;background:var(--amber-l);border-radius:12px;padding:10px 12px"><summary class="small" style="cursor:pointer;font-weight:600">Notes on the data (${notes.length})</summary><ul class="tiny" style="margin:8px 0 0;padding-left:18px;line-height:1.5">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>` : ""}
    <p class="tiny muted" style="margin:12px 0 0;line-height:1.4">From <b>${esc(E.source || "Call Surgeon")}</b> · ${E.at ? new Date(E.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""} · The bot's read plus public Street data, not advice. Check the sources before acting.</p></div>`;
}
async function loadEarnings(d, st) {
  const el = $("#rearn"); if (!el || isFundD(d)) { if (el) el.innerHTML = ""; return; }
  let E; try { E = await api(`/research/${d.ticker}/earnings`); } catch (e) { el.innerHTML = ""; return; }
  if (!$("#rearn")) return;
  const start = async () => { el.innerHTML = `<div class="card"><div class="empty" style="padding:14px 8px"><span class="spin"></span><div style="margin-top:8px">Starting…</div></div></div>`;
    try { await api(`/research/${d.ticker}/earnings`, { body: {} }); } catch (e) { el.innerHTML = `<div class="card">${err(e)}</div>`; return; } loadEarnings(d, st); };
  if (E.status === "done") { const paint = () => { el.innerHTML = earnSection(d, E, st.etab || "res");
      el.querySelectorAll("[data-et]").forEach((b) => b.onclick = () => { st.etab = b.dataset.et; paint(); }); const nb = $("#er-new"); if (nb) nb.onclick = start; }; paint(); return; }
  if (E.status === "running") { const secs = Math.round((Date.now() - Date.parse(E.started)) / 1000);
    el.innerHTML = `<div class="card"><h2 class="h2">Earnings</h2><div class="empty" style="padding:14px 8px"><span class="spin"></span><div style="margin-top:8px">Call Surgeon is reading the ${E.call_date ? F.date(E.call_date) + " " : ""}call and checking it against the report and the Street.<br><span class="tiny">Usually 2–4 minutes · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} so far</span></div></div></div>`;
    clearTimeout(st.etimer); st.etimer = setTimeout(() => loadEarnings(d, st), 15000); return; }
  if (E.status === "none") { el.innerHTML = `<div class="card"><h2 class="h2">Earnings</h2><div class="small muted" style="margin-top:6px">No earnings call transcript found for ${esc(d.ticker)} yet.</div></div>`; return; }
  const auto = (d.models || []).length || d.watch;
  el.innerHTML = `<div class="card"><h2 class="h2">Earnings</h2><div class="small muted" style="margin-top:4px">${E.status === "error" ? esc(E.error || "The last try didn't finish.") : `Latest call: ${E.quarter ? "Q" + esc(E.quarter) + " " : ""}${E.year ? esc(E.year) + " · " : ""}${E.call_date ? F.date(E.call_date) : ""}`}</div>
    <button class="btn primary" id="er-go" style="margin-top:12px">Break down the call</button><div class="tiny muted" style="margin-top:6px">Results vs Street, what drove it, price targets, key quotes and read-throughs. About 2–4 minutes; saved after that.</div></div>`;
  $("#er-go").onclick = start;
  if (auto && E.status === "ready" && !st.autoStarted) { st.autoStarted = true; start(); }
}
async function vCompare(a, b) {
  a = String(a).toUpperCase(); b = String(b).toUpperCase();
  page(`${hdr(`${esc(a)} vs ${esc(b)}`, { back: "hist" })}<div id="cp">${spinner("Lining them up")}</div>`, "research");
  let A, B; try { [A, B] = await Promise.all([getProfile(a), getProfile(b)]); } catch (e) { return fill("#cp", err(e)); }
  let range = "1Y";
  const val = (d, k) => { const S = d.street || {}, f = d.fin || { ttm: {} }, fu = S.fund || {};
    switch (k) { case "mcap": return F.money(d.mcap); case "pe": return xx(d.pe); case "fpe": return xx(d.fpe); case "dy": return pctU(d.dy, 2); case "beta": return d.beta !== null && d.beta !== undefined ? d.beta.toFixed(2) : "–";
      case "short": return pctU(d.short); case "hi": return d.range && d.range.hi ? pctS(d.range.last / d.range.hi - 1) : "–"; case "revg": return pctS(f.ttm && f.ttm.rev_g); case "opm": return pctU(f.ttm && f.ttm.opm);
      case "fcf": return F.money(f.ttm && f.ttm.fcf); case "tgt": return S.target_avg && d.last ? pctS(S.target_avg / d.last - 1) : "–"; case "cons": return esc(S.consensus || "–");
      case "stars": return fu.stars ? "★".repeat(Math.round(fu.stars)) : "–"; case "medal": return esc(fu.medal || "–"); case "fl": return fu.front_load ? Number(fu.front_load).toFixed(2) + "%" : fu.front_load === 0 ? "None" : "–";
      case "b12": return fu.b12_1 ? Number(fu.b12_1).toFixed(2) + "%" : fu.b12_1 === 0 ? "None" : "–"; case "aum": return F.money(fu.aum); case "yld": return fu.yield !== null && fu.yield !== undefined ? Number(fu.yield).toFixed(2) + "%" : "–";
      case "mgr": { const y = (fu.managers || []).map((m) => m.since).filter(Boolean); return y.length ? Math.max(0, new Date().getFullYear() - Math.min(...y)) + " yrs" : "–"; }
      case "cat": return esc(fu.category || "–");
      case "er": return fu.expense_ratio !== null && fu.expense_ratio !== undefined ? Number(fu.expense_ratio).toFixed(2) + "%" : "–";
      case "er_old": return fu.expense_ratio !== null && fu.expense_ratio !== undefined ? (fu.expense_ratio > 0.05 ? fu.expense_ratio.toFixed(2) + "%" : (fu.expense_ratio * 100).toFixed(2) + "%") : "–"; }
    return "–"; };
  const bothF = isFundD(A) && isFundD(B), anyS = !isFundD(A) || !isFundD(B);
  const rows = bothF ? [["Category", "cat"], ["Morningstar", "stars"], ["Medalist", "medal"], ["Expense ratio", "er"], ["Front-end load", "fl"], ["12b-1 fee", "b12"], ["Yield", "yld"], ["Assets", "aum"], ["Manager tenure", "mgr"], ["From 52-week high", "hi"]]
    : [["Market cap", "mcap"], ["P/E trailing", "pe"], ["P/E forward", "fpe"], ["Dividend yield", "dy"], ["Beta", "beta"], ["Short interest", "short"], ["From 52-week high", "hi"],
    ...(anyS ? [["Revenue growth", "revg"], ["Operating margin", "opm"], ["Free cash flow · 12 mo", "fcf"], ["Analyst consensus", "cons"], ["Upside to avg target", "tgt"]] : []),
    ...(isFundD(A) || isFundD(B) ? [["Expense ratio", "er"]] : [])];
  const RT = (d) => isFundD(d) ? fundRet(d).t : (d.returns || { t: {} }).t;
  const draw = () => {
    fill("#cp", `<div class="grid2" style="margin:12px 16px 0">${[A, B].map((d, i) => `<a class="card" href="#research/${esc(d.ticker)}" style="margin:0;min-width:0;text-decoration:none;color:inherit;border-top:4px solid ${i ? "var(--brass)" : "var(--navy)"}">
        <div class="row" style="gap:8px">${logo(d.ticker, 28)}<b>${esc(d.ticker)}</b></div><div class="tiny muted" style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</div>
        <div class="n" style="font-size:22px;font-weight:700;margin-top:6px">${F.px(d.last)}</div>${d.quote ? `<div class="n small ${F.cls(d.quote.changepct)}">${F.chg(d.quote)}</div>` : `<div class="tiny muted">NAV</div>`}</a>`).join("")}</div>
      <div style="${(A.prices || []).length < 2 ? "display:none" : ""}"><div class="card" style="padding:10px 6px 4px"><div id="cpc"></div></div>
      <div class="seg light" style="margin:10px 16px 0">${RANGES.map(([k]) => `<button class="${range === k ? "on" : ""}" data-rg="${k}">${k}</button>`).join("")}</div></div>
      <div id="cpl"></div>
      <div class="card"><div style="display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:0 8px;align-items:center">
        <span></span><b class="small" style="text-align:right">${esc(a)}</b><b class="small" style="text-align:right;color:var(--brass-t)">${esc(b)}</b>
        ${[["1-year return", "1Y"], ["3 years / yr", "3Y"], ["5 years / yr", "5Y"], ["10 years / yr", "10Y"]].map(([l, k]) => `<span class="small" style="padding:10px 0;border-top:1px solid var(--line)">${l}</span><span class="n ${F.cls(RT(A)[k])}" style="text-align:right;font-weight:700;padding:10px 0;border-top:1px solid var(--line)">${pctS(RT(A)[k])}</span><span class="n" style="text-align:right;font-weight:600;color:var(--brass-t);padding:10px 0;border-top:1px solid var(--line)">${pctS(RT(B)[k])}</span>`).join("")}
        ${rows.map(([l, k]) => `<span class="small" style="padding:10px 0;border-top:1px solid var(--line)">${l}</span><span class="n" style="text-align:right;font-weight:700;padding:10px 0;border-top:1px solid var(--line)">${val(A, k)}</span><span class="n" style="text-align:right;font-weight:600;color:var(--brass-t);padding:10px 0;border-top:1px solid var(--line)">${val(B, k)}</span>`).join("")}</div></div>
      <div class="grid2" style="margin:14px 16px 0"><button class="btn primary" id="cpa">＋ ${esc(a)}</button><button class="btn ghost" id="cpb">＋ ${esc(b)}</button></div>`);
    const y = RANGES.find((r) => r[0] === range)[1]; const pa = sliceYears(A.prices || [], y);
    if (pa.length > 1) { const pb = align(pa, B.prices || []); const b0 = pb.find((v) => v); const a0 = pa[0][1];
      const ptsA = pa.map(([dd, c]) => ({ y: c / a0 * 100, label: F.date(dd) })), ptsB = b0 ? pb.map((v, i) => ({ y: (v || b0) / b0 * 100, label: ptsA[i].label })) : [];
      const leg = (i) => { const ia = i ?? ptsA.length - 1; fill("#cpl", `<div class="row between small" style="margin:8px 22px 0"><span><b style="color:var(--navy)">${esc(a)}</b> <span class="n ${F.cls(ptsA[ia].y - 100)}">${pctS(ptsA[ia].y / 100 - 1)}</span></span><span class="muted">${esc(ptsA[ia].label)}</span><span><b style="color:var(--brass-t)">${esc(b)}</b> <span class="n">${ptsB.length ? pctS(ptsB[Math.min(ia, ptsB.length - 1)].y / 100 - 1) : "–"}</span></span></div>`); };
      lineChart($("#cpc"), [{ pts: ptsA, color: "var(--navy)" }, ...(ptsB.length ? [{ pts: ptsB, color: "var(--brass)", dash: true }] : [])], { h: 200, baseline: 100, onScrub: leg }); leg(null); }
    $$("[data-rg]").forEach((x) => x.onclick = () => { range = x.dataset.rg; draw(); });
    $("#cpa").onclick = () => plusSheet(A); $("#cpb").onclick = () => plusSheet(B);
  };
  draw();
  if ((A.street_pending && !A.street) || (B.street_pending && !B.street)) { let n = 0; const poll = setInterval(async () => { n++; if (!$("#cp") || n > 9) return clearInterval(poll);
    try { const [ra, rb] = await Promise.all([api(`/research/${a}/street`), api(`/research/${b}/street`)]); let ch = false;
      if (ra.street && !A.street) { A.street = ra.street; ch = true; } if (rb.street && !B.street) { B.street = rb.street; ch = true; }
      if (ch) { MEMR[a] = null; MEMR[b] = null; draw(); } if (A.street && B.street) clearInterval(poll); } catch (_) {} }, 20000); }
}
async function vSearch() {
  page(`${hdr("Research", { light: true, top: `<div class="row between" style="padding-top:var(--safe-t)"><span></span><a href="#today" style="font-weight:600;text-decoration:none">Done</a></div>` })}
    <div style="margin:12px 16px 0"><div class="field grey">${ICON.search}<input id="sq" placeholder="Ticker, or a question for Opal" autocapitalize="characters" autofocus></div></div>
    <p class="small muted" style="margin:8px 20px">A ticker opens its page. A sentence goes to Opal.</p><div id="sr"></div>`, "today");
  const go = async () => { const v = $("#sq").value.trim(); if (!v) return;
    if (/^\$?[A-Za-z.\-]{1,6}$/.test(v)) { location.hash = "#stock/" + v.replace("$", "").toUpperCase(); return; }
    const r = await api("/opal", { body: { q: v } }); location.hash = "#opal/run/" + r.id; };
  $("#sq").onkeydown = (e) => { if (e.key === "Enter") go(); };
}

// ---------------------------------------------------------------- Settings
async function vSettings() {
  page(`${hdr("Settings", { back: "#today" })}<div id="se">${spinner()}</div>`, "today");
  const s = await api("/settings");
  const pushOk = "serviceWorker" in navigator && "PushManager" in window;
  fill("#se", `<div class="card"><h2 class="h2">Notifications</h2><p class="small muted">${pushOk ? "Get a tap on your phone for new ideas, overlaps and trade alerts." : "On iPhone: add Odesa to your Home Screen first (Share → Add to Home Screen), then open it from there."}</p>
      ${pushOk ? `<button class="btn primary" id="pon">Turn on notifications</button><button class="btn soft small" id="ptest" style="margin-top:8px;width:100%">Send a test</button>` : ""}</div>
    <div class="card"><h2 class="h2">Options defaults</h2><div class="grid2" style="margin-top:10px">
      <label class="small">Buy target %<input class="inp n" data-k="target_pct" value="${s.target_pct ?? ""}"></label><label class="small">Buy stop %<input class="inp n" data-k="stop_pct" value="${s.stop_pct ?? ""}"></label>
      <label class="small">Sell target %<input class="inp n" data-k="sell_target_pct" value="${s.sell_target_pct ?? ""}"></label><label class="small">Sell stop %<input class="inp n" data-k="sell_stop_pct" value="${s.sell_stop_pct ?? ""}"></label>
      <label class="small">Contracts<input class="inp n" data-k="contracts" value="${s.contracts ?? 1}"></label><label class="small">Grok monthly cap $<input class="inp n" data-k="grok_cap_usd" value="${s.grok_cap_usd ?? 300}"></label></div>
      <label class="row small" style="margin-top:12px"><input type="checkbox" id="auto" ${s.auto_close ? "checked" : ""}> Auto-close tracked trades at target or stop</label>
      <label class="small" style="display:block;margin-top:10px">Firm name (for Grow disclosures)<input class="inp" data-k="firm" value="${esc(s.firm ?? "")}"></label>
      <label class="small" style="display:block;margin-top:10px">Today's market strip<input class="inp" data-k="pulse" value="${esc((s.pulse || []).join(", "))}"></label>
      <button class="btn primary" id="ssave" style="margin-top:12px">Save</button></div>
    <div class="card"><button class="btn soft" id="lo" style="color:var(--down)">Log out of this device</button></div>`);
  $("#ssave").onclick = async () => { const b = { auto_close: $("#auto").checked }; $$("[data-k]").forEach((el) => { const k = el.dataset.k; b[k] = k === "firm" ? el.value : k === "pulse" ? el.value.split(/[,\s]+/).filter(Boolean).map((x) => x.toUpperCase()) : el.value === "" ? null : Number(el.value); });
    try { await api("/settings", { body: b }); toast("Saved"); } catch (e) { toast(e.message); } };
  $("#lo").onclick = () => logout();
  if (pushOk) { $("#pon").onclick = enablePush; $("#ptest").onclick = () => api("/push/test", { body: {} }).then((r) => toast(r.sent ? "Sent" : "No devices are subscribed yet.")); }
}
async function enablePush() {
  try {
    const perm = await Notification.requestPermission(); if (perm !== "granted") return toast("Notifications weren't allowed.");
    const reg = await navigator.serviceWorker.ready; const { key } = await api("/push/key");
    const pad = "=".repeat((4 - key.length % 4) % 4); const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
    await api("/push/subscribe", { body: { sub: sub.toJSON() } }); toast("Notifications on");
  } catch (e) { toast("Couldn't turn on notifications: " + e.message, 4000); }
}

// ---------------------------------------------------------------- router
const ROUTES = [
  [/^#?$|^#today$/, vToday], [/^#portfolio(?:\/(\d+))?$/, vPortfolio], [/^#calc\/(\d+)$/, vCalc], [/^#manager(?:\/(\d+))?$/, vManager], [/^#rebalance\/(\d+)$/, vRebalance], [/^#perf\/(\d+)$/, vPerf], [/^#watchlist$/, vWatchlist],
  [/^#opal$/, vOpal], [/^#opal\/run\/(\d+)$/, vOpalRun], [/^#theses$/, vTheses], [/^#signals(?:\/([A-Z]))?$/, vSignals], [/^#signal\/([A-Z0-9.\-]+)$/, vProfile], [/^#earnings$/, vEarnings], [/^#overlay$/, vOverlay], [/^#feeds$/, vFeeds],
  [/^#options$/, vOptions], [/^#options\/new$/, vNewIdea], [/^#options\/tracking$/, vTracking], [/^#options\/results$/, vResults],
  [/^#grow$/, vGrow], [/^#grow\/(\d+)(?:\/([a-z_]+))?(?:\/([A-Za-z]+))?$/, vGrowIdea], [/^#stock\/([A-Za-z0-9.\-]+)$/, vProfile], [/^#search$/, vResearch], [/^#research$/, vResearch], [/^#research\/([A-Za-z0-9.\-]+)$/, vProfile], [/^#compare\/([A-Za-z0-9.\-]+)\/([A-Za-z0-9.\-]+)$/, vCompare], [/^#settings$/, vSettings],
];
function route() {
  if (!TOKEN) return showLogin();
  const h = decodeURIComponent(location.hash || "#today");
  for (const [re, fn] of ROUTES) { const m = h.match(re); if (m) { fn(...m.slice(1)); return; } }
  vToday();
}
window.addEventListener("hashchange", route);
const APP_VERSION = 11;
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
// If a newer version is published, reload once so the phone never keeps an old copy.
fetch("version.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json()).then((v) => {
  if (v && v.v > APP_VERSION && sessionStorage.getItem("odesa_reloaded") !== String(v.v)) { sessionStorage.setItem("odesa_reloaded", String(v.v)); location.reload(); }
}).catch(() => {});
route();
