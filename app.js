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
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};
function tabbar(active) {
  const t = (id, label, href) => `<a href="${href}" class="${active === id ? "on" : ""}" aria-label="${label}">${ICON[id]}${label}</a>`;
  return `<nav class="tabs" aria-label="Sections">${t("today", "Today", "#today")}${t("portfolio", "Portfolio", "#portfolio")}
    <a href="#opal" class="opal" aria-label="Opal"><span>${ICON.opal}</span>Opal</a>${t("options", "Options", "#options")}${t("grow", "Grow", "#grow")}</nav>`;
}
let CUR_TAB = "today";
function page(html, tab = CUR_TAB) { CUR_TAB = tab; app().innerHTML = `<div class="wrap">${html}</div>${tabbar(tab)}`; window.scrollTo(0, 0); }
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
      <div class="card pad0" style="margin-top:12px">
        <div class="row between" style="padding:12px 0 6px"><h2 class="h2">${esc(m.name)}</h2><span class="small ${tot === 10000 ? "up" : "down"}">${h.length} holdings · ${F.bps(tot)}</span></div>
        ${h.length ? h.map((x) => { const qq = q[x.t] || {}; return `<a class="li" href="${x.cash ? "#" : "#stock/" + esc(x.t)}">${x.cash ? `<span class="logo" style="display:flex;align-items:center;justify-content:center">💵</span>` : logo(x.t)}
          <div class="grow1"><div style="font-weight:700">${esc(x.t)}</div><div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.n || "")}</div></div>
          <div style="text-align:right"><div class="n" style="font-weight:600">${x.cash ? "Cash" : F.px(qq.last)}</div><div class="n tiny ${F.cls(qq.changepct)}">${x.cash ? "" : F.chg(qq)}</div></div>
          <div class="n" style="width:56px;text-align:right;font-weight:700">${F.bps(x.w)}</div></a>`; }).join("")
        : `<div class="empty">This model has no holdings yet.<br><a href="#manager/${m.id}" class="btn primary" style="margin-top:12px">Add holdings</a></div>`}</div>
      <div class="sec"><h2 class="h2">Watchlist</h2><a href="#watchlist" class="small" style="font-weight:600;text-decoration:none">Edit</a></div><div id="p-watch" class="card pad0">${spinner()}</div>`);
    api("/watchlist").then((w) => fill("#p-watch", w.map((x) => `<a class="li" href="#stock/${esc(x.t)}">${logo(x.t, 30)}<div class="grow1" style="font-weight:700">${esc(x.t)}</div>
      <div class="n" style="font-weight:600">${F.px(x.last)}</div><div class="n small ${F.cls(x.changepct)}" style="width:64px;text-align:right">${F.chg(x)}</div></a>`).join("") || `<div class="empty">Empty.</div>`)).catch((e) => fill("#p-watch", err(e)));
  } catch (e) { fill("#p-body", err(e)); }
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

async function vManager(id) {
  page(`${hdr("Models", { back: "#portfolio", sub: "Edit holdings and targets. Each save keeps the last version so you can undo." })}<div id="m-body">${spinner()}</div>`, "portfolio");
  const ms = await getModels(true); let m = ms.find((x) => String(x.id) === String(id)) || ms[0];
  let H = JSON.parse(JSON.stringify(m ? m.holdings : []));
  const draw = () => {
    const tot = H.reduce((s, x) => s + (Number(x.w) || 0), 0);
    fill("#m-body", `<div class="chips">${ms.map((x) => `<a class="chip ${m && x.id === m.id ? "on" : ""}" href="#manager/${x.id}">${esc(x.name)}</a>`).join("")}<button class="chip" id="newm">+ New model</button></div>
      ${m ? `<div class="card"><div class="eyebrow">Name</div><input id="mname" class="inp" style="margin-top:6px;font-weight:700;font-size:18px" value="${esc(m.name)}"></div>
      <div class="card"><div class="row between"><h2 class="h2">Holdings</h2><button class="btn small soft" id="paste">Paste a list</button></div>
        <div class="field" style="margin-top:12px;height:44px"><input id="addt" placeholder="Add ticker (e.g. NVDA)" autocapitalize="characters"><button class="btn small primary" id="addb">Add</button></div>
        ${H.map((x, i) => `<div class="li" style="cursor:default"><div class="grow1"><div style="font-weight:700">${esc(x.t)}</div><input class="inp" data-n="${i}" value="${esc(x.n || "")}" placeholder="Name (optional)" style="height:30px;font-size:13px;margin-top:4px;border:0;padding:0;background:transparent"></div>
          <div class="row" style="gap:6px"><input class="inp n" data-w="${i}" inputmode="decimal" value="${(x.w / 100).toString()}" style="width:76px;text-align:right"><span class="muted">%</span>
          <button class="btn small soft" data-del="${i}" aria-label="Remove ${esc(x.t)}" style="width:38px;padding:0">✕</button></div></div>`).join("")}
        <div class="row between" style="padding:12px 0 2px;border-top:1px solid var(--line)"><span style="font-weight:600">Total</span><span class="n ${tot === 10000 ? "up" : "down"}" style="font-size:20px;font-weight:700">${F.bps(tot)} ${tot === 10000 ? "✓" : ""}</span></div>
        <button class="btn soft small" id="even" style="margin-top:10px">Split evenly</button></div>
      <div class="grid2" style="margin:14px 16px 0"><button class="btn primary" id="save">Save model</button><button class="btn ghost" id="undo">Undo last save</button></div>
      <button class="btn small soft" id="delm" style="margin:16px auto 0;color:var(--down)">Delete this model</button>` : ""}`);
    $("#newm").onclick = async () => { const n = prompt("Name for the new model?"); if (!n) return; const r = await api("/models", { body: { name: n, holdings: [] } }); MEM.models = null; location.hash = "#manager/" + r.id; };
    if (!m) return;
    $$("[data-w]").forEach((el) => el.oninput = () => { H[el.dataset.w].w = Math.round(Number(el.value) * 100) || 0; const t = H.reduce((s, x) => s + (Number(x.w) || 0), 0); });
    $$("[data-w]").forEach((el) => el.onchange = draw);
    $$("[data-n]").forEach((el) => el.oninput = () => { H[el.dataset.n].n = el.value; });
    $$("[data-del]").forEach((el) => el.onclick = () => { H.splice(Number(el.dataset.del), 1); draw(); });
    const add = () => { const t = $("#addt").value.trim().toUpperCase(); if (!t) return; if (H.find((x) => x.t === t)) return toast(t + " is already in the model."); H.push({ t, w: 0, n: "" }); draw(); };
    $("#addb").onclick = add; $("#addt").onkeydown = (e) => { if (e.key === "Enter") add(); };
    $("#even").onclick = () => { if (!H.length) return; const each = Math.floor(10000 / H.length); H.forEach((x, i) => x.w = each + (i < 10000 - each * H.length ? 1 : 0)); draw(); };
    $("#paste").onclick = () => {
      const s = sheet(`<div style="padding:0 18px"><h2 class="h2">Paste holdings</h2><p class="small muted">One per line: ticker and target %. Example: <b>AAPL 9</b> or <b>MSFT, 8.5%</b></p>
        <textarea class="box" id="pl" rows="10" placeholder="AAPL 9&#10;MSFT 9&#10;NVDA 8"></textarea><button class="btn primary" id="plok" style="margin-top:12px">Use this list</button></div>`);
      $("#plok", s).onclick = () => { const out = []; for (const line of $("#pl", s).value.split(/\n/)) { const mm = line.trim().match(/^\$?([A-Za-z.\-]{1,10})[\s,;:\t]+\$?([\d.]+)\s*%?/); if (mm) out.push({ t: mm[1].toUpperCase(), w: Math.round(Number(mm[2]) * 100), n: "" }); }
        if (!out.length) return toast("I couldn't read that. Use: TICKER percent"); H = out; s.remove(); draw(); };
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
  [/^#?$|^#today$/, vToday], [/^#portfolio(?:\/(\d+))?$/, vPortfolio], [/^#calc\/(\d+)$/, vCalc], [/^#manager(?:\/(\d+))?$/, vManager], [/^#rebalance\/(\d+)$/, vRebalance], [/^#watchlist$/, vWatchlist],
  [/^#opal$/, vOpal], [/^#opal\/run\/(\d+)$/, vOpalRun], [/^#theses$/, vTheses], [/^#signals(?:\/([A-Z]))?$/, vSignals], [/^#signal\/([A-Z0-9.\-]+)$/, vStock], [/^#earnings$/, vEarnings], [/^#overlay$/, vOverlay], [/^#feeds$/, vFeeds],
  [/^#options$/, vOptions], [/^#options\/new$/, vNewIdea], [/^#options\/tracking$/, vTracking], [/^#options\/results$/, vResults],
  [/^#grow$/, vGrow], [/^#grow\/(\d+)(?:\/([a-z_]+))?(?:\/([A-Za-z]+))?$/, vGrowIdea], [/^#stock\/([A-Za-z0-9.\-]+)$/, vStock], [/^#search$/, vSearch], [/^#settings$/, vSettings],
];
function route() {
  if (!TOKEN) return showLogin();
  const h = decodeURIComponent(location.hash || "#today");
  for (const [re, fn] of ROUTES) { const m = h.match(re); if (m) { fn(...m.slice(1)); return; } }
  vToday();
}
window.addEventListener("hashchange", route);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
route();
