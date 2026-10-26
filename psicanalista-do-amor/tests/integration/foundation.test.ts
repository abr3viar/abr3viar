import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db/client";
import { reportTypes } from "@/server/db/schema";
import { seedReportTypes } from "@/server/db/seed";
import { CATALOG } from "@/server/reports/catalog";
import { getBoss, stopBoss } from "@/server/jobs/boss";
import { describeDb, prepareTestDb } from "../helpers/db";

describeDb("fundação: migrations, seed e fila", () => {
  beforeAll(async () => {
    await prepareTestDb();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  it("seed cria principal + adicionais (preço bruto com taxa) e é idempotente sem sobrescrever o /admin", async () => {
    const db = getDb();
    const rows = await db.select().from(reportTypes);
    expect(rows).toHaveLength(CATALOG.length);
    expect(rows.filter((r) => r.kind === "main")).toHaveLength(1);
    expect(rows.find((r) => r.slug === "principal")?.netPriceCents).toBe(3000);
    expect(rows.find((r) => r.slug === "principal")?.priceCents).toBe(3166); // líquido + taxa do Stripe
    expect(rows.find((r) => r.slug === "quem-gosta-mais")?.priceCents).toBe(1083);

    await db
      .update(reportTypes)
      .set({ priceCents: 3500, stripePaymentLinkUrl: "https://buy.stripe.com/x", name: "Editado" })
      .where(eq(reportTypes.slug, "principal"));
    await seedReportTypes();
    await seedReportTypes();
    const again = await db.select().from(reportTypes);
    expect(again).toHaveLength(CATALOG.length);
    const principal = again.find((r) => r.slug === "principal")!;
    expect(principal.priceCents).toBe(3500);
    expect(principal.stripePaymentLinkUrl).toBe("https://buy.stripe.com/x");
    expect(principal.name).toBe("Editado");
  });

  it("pg-boss envia e processa um job de teste", async () => {
    const boss = await getBoss("worker");
    const done = new Promise<string>((resolve) => {
      void boss.work<{ at: string }>("healthcheck", async ([job]) => {
        resolve(job!.data.at);
      });
    });
    const at = new Date().toISOString();
    await boss.send("healthcheck", { at });
    await expect(done).resolves.toBe(at);
  });
});
