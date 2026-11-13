// Phone notifications (Web Push). Works when Odesa is added to the iPhone home screen (iOS 16.4+) and notifications are allowed.
import webpush from "npm:web-push@3.6.7";
import { sql, kvGet, kvSet } from "./db.ts";

let ready = false;
export async function vapid() {
  let v = await kvGet<any>("vapid", null);
  if (!v?.publicKey) { v = webpush.generateVAPIDKeys(); await kvSet("vapid", v); }
  if (!ready) { webpush.setVapidDetails("mailto:odesa-app@users.noreply.github.com", v.publicKey, v.privateKey); ready = true; }
  return v.publicKey as string;
}
export async function subscribe(sub: any) {
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint)) throw new Error("bad subscription");
  await sql`insert into odesa.push_subs(endpoint, sub) values (${sub.endpoint}, ${sql.json(sub)}) on conflict (endpoint) do update set sub = excluded.sub`;
}
export async function unsubscribe(endpoint: string) { await sql`delete from odesa.push_subs where endpoint = ${endpoint}`; }
export async function notify(title: string, body: string, url = "#today") {
  const s = await kvGet<any>("settings", {});
  if (s.push === false) return 0;
  const subs = await sql`select endpoint, sub from odesa.push_subs`;
  if (!subs.length) return 0;
  await vapid(); let sent = 0;
  for (const r of subs) {
    try { await webpush.sendNotification(r.sub, JSON.stringify({ title, body, url }), { TTL: 3600 }); sent++; }
    catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await unsubscribe(r.endpoint as string); }
  }
  return sent;
}
