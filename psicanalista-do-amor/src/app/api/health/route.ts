import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { log, safeErr } from "@/server/log";

export const dynamic = "force-dynamic";

/** Healthcheck da hospedagem: verifica banco e fila, sem expor detalhes. */
export async function GET() {
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    // A fila vive no próprio Postgres: confere se o schema do pg-boss está instalado.
    const res = await db.execute(sql`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`);
    const ok = (res.rows[0] as { ok?: boolean } | undefined)?.ok === true;
    if (!ok) throw new Error("queue_not_installed");
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.warn({ err: safeErr(err) }, "health_failed");
    return Response.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
