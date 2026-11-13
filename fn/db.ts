// Postgres access for the Odesa function. Uses the project's direct DB URL (a default Edge Function secret).
import postgres from "npm:postgres@3.4.5";

export const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 4, idle_timeout: 20, connect_timeout: 10 });

export async function kvGet<T = unknown>(k: string, dflt: T): Promise<T> {
  const r = await sql`select v from odesa.kv where k = ${k}`;
  return r.length ? (r[0].v as T) : dflt;
}
export async function kvSet(k: string, v: unknown) {
  await sql`insert into odesa.kv(k, v, updated_at) values (${k}, ${sql.json(v as never)}, now())
            on conflict (k) do update set v = excluded.v, updated_at = now()`;
}

const _keys = new Map<string, { v: string | null; t: number }>();
/** API keys straight from Supabase Vault (cached 10 minutes). Values never leave this function. */
export async function key(name: string): Promise<string | null> {
  const c = _keys.get(name);
  if (c && Date.now() - c.t < 600_000) return c.v;
  const r = await sql`select decrypted_secret from vault.decrypted_secrets where name = ${name}`;
  const v = r.length ? String(r[0].decrypted_secret).trim() : null;
  _keys.set(name, { v, t: Date.now() });
  return v;
}

export async function usage(source: string, ok: boolean, cost = 0, err?: string) {
  try {
    if (ok) {
      await sql`insert into odesa.feed_usage(day, source, calls, cost, last_ok) values (current_date, ${source}, 1, ${cost}, now())
        on conflict (day, source) do update set calls = odesa.feed_usage.calls + 1, cost = odesa.feed_usage.cost + ${cost}, last_ok = now()`;
    } else {
      await sql`insert into odesa.feed_usage(day, source, calls, errors, last_err, last_err_msg) values (current_date, ${source}, 1, 1, now(), ${(err ?? "error").slice(0, 120)})
        on conflict (day, source) do update set calls = odesa.feed_usage.calls + 1, errors = odesa.feed_usage.errors + 1, last_err = now(), last_err_msg = excluded.last_err_msg`;
    }
  } catch (_) { /* usage tracking never breaks a request */ }
}

export async function monthCost(source: string): Promise<number> {
  const r = await sql`select coalesce(sum(cost), 0)::float8 c from odesa.feed_usage where source = ${source} and day >= date_trunc('month', current_date)`;
  return Number(r[0].c);
}

export async function event(kind: string, title: string, body = "", ref: Record<string, unknown> = {}) {
  const r = await sql`insert into odesa.events(kind, title, body, ref) values (${kind}, ${title}, ${body}, ${sql.json(ref as never)}) returning id`;
  return r[0].id as number;
}
