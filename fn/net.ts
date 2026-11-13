// One door for every outside call: timeout, one retry on 429/5xx, usage tracking, friendly errors.
import { usage } from "./db.ts";

export class SourceError extends Error {
  constructor(public source: string, msg: string, public status?: number) { super(`${source}: ${msg}`); }
}

const HINT: Record<number, string> = { 401: "key rejected", 403: "not on this plan", 404: "not found", 422: "bad request", 429: "rate limited" };

export async function call(source: string, url: string, init: RequestInit & { timeoutMs?: number; cost?: number } = {}): Promise<any> {
  const { timeoutMs = 20000, cost = 0, ...rest } = init;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      await usage(source, false, 0, (e as Error).name);
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue; }
      throw new SourceError(source, `network error (${(e as Error).name})`);
    }
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt === 0) {
      await usage(source, false, 0, `HTTP ${res.status}`); await res.body?.cancel(); await new Promise((r) => setTimeout(r, 2000)); continue;
    }
    if (res.status === 404) {
      const t = await res.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
      if (j && j.s === "no_data") { await usage(source, true, cost); return j; }
      await usage(source, false, 0, "HTTP 404");
      throw new SourceError(source, "HTTP 404 (not found)", 404);
    }
    if (res.status === 403) {
      const t = await res.text();
      if (/one device|IP address has changed/i.test(t)) { await usage(source, false, 0, "paused: address changed");
        throw new SourceError(source, "paused for 5 minutes by MarketData (requests came from a new internet address)", 403); }
      await usage(source, false, 0, "HTTP 403"); throw new SourceError(source, `HTTP 403 (${HINT[403]})`, 403);
    }
    if (res.status >= 400) {
      await usage(source, false, 0, `HTTP ${res.status}`); await res.body?.cancel();
      throw new SourceError(source, `HTTP ${res.status} (${HINT[res.status] ?? "error"})`, res.status);
    }
    const text = await res.text();
    await usage(source, true, cost);
    try { return text ? JSON.parse(text) : null; } catch { throw new SourceError(source, "response was not JSON"); }
  }
}

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
