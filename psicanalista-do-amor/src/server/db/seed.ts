import "server-only";
import { sql } from "drizzle-orm";
import { stripeFeesFor } from "@/env";
import { grossFromNet } from "@/lib/pricing";
import { CATALOG } from "@/server/reports/catalog";
import { log } from "@/server/log";
import { getDb } from "./client";
import { reportTypes } from "./schema";

/**
 * Seed idempotente de `report_types` (principal + adicionais).
 * Insere o que falta; nos existentes só atualiza campos controlados pelo código.
 * Payment Links, preço, moeda, nome, textos e `is_active` pertencem ao painel /admin.
 */
export async function seedReportTypes(): Promise<{ total: number }> {
  const db = getDb();
  for (const entry of CATALOG) {
    await db
      .insert(reportTypes)
      .values({
        slug: entry.slug,
        kind: entry.kind,
        name: entry.name,
        teaser: entry.teaser,
        description: entry.description,
        netPriceCents: entry.netPriceCents,
        priceCents: grossFromNet(entry.netPriceCents, stripeFeesFor(entry.kind)),
        currency: entry.currency,
        promptTemplate: entry.promptTemplate,
        outputSchemaVersion: entry.outputSchemaVersion,
        sortOrder: entry.sortOrder,
        requiresUserSide: entry.requiresUserSide,
      })
      .onConflictDoUpdate({
        target: reportTypes.slug,
        set: {
          kind: sql`excluded.kind`,
          promptTemplate: sql`excluded.prompt_template`,
          outputSchemaVersion: sql`excluded.output_schema_version`,
          requiresUserSide: sql`excluded.requires_user_side`,
          // Linhas antigas (sem líquido definido) recebem líquido + bruto calculado; as demais ficam como o /admin deixou.
          netPriceCents: sql`CASE WHEN ${reportTypes.netPriceCents} = 0 THEN excluded.net_price_cents ELSE ${reportTypes.netPriceCents} END`,
          priceCents: sql`CASE WHEN ${reportTypes.netPriceCents} = 0 THEN excluded.price_cents ELSE ${reportTypes.priceCents} END`,
          updatedAt: new Date(),
        },
      });
  }
  log.info({ total: CATALOG.length }, "seed_report_types_done");
  return { total: CATALOG.length };
}
