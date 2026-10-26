import { afterAll, beforeEach, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { stopBoss } from "@/server/jobs/boss";
import { processStripeEvent } from "@/server/payments/fulfill";
import { loadDeliveredReading } from "@/server/reports/generate-extra";
import { describeDb, prepareTestDb } from "../helpers/db";
import { configureTestLinks, createPendingPurchase, createReadyMainReport, createUserWithSession, SECRET } from "../helpers/factories";
import { checkoutSession, event } from "../helpers/stripe-events";

describeDb("LEITURA JÁ ENTREGUE (títulos do principal para o adicional)", () => {
  beforeEach(async () => {
    await prepareTestDb();
    await configureTestLinks();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  it("só existe depois que o webhook liberou o principal; leva os títulos reais, sem o alerta nem o conteúdo", async () => {
    const { user } = await createUserWithSession("entregue@example.com");
    const { report, conversation } = await createReadyMainReport(user.id, { safety: true });
    expect(await loadDeliveredReading(conversation.id)).toBeNull();

    const purchase = await createPendingPurchase(user.id, report.id);
    await processStripeEvent(event("checkout.session.completed", checkoutSession({ client_reference_id: purchase.id })));

    const delivered = await loadDeliveredReading(conversation.id);
    expect(delivered!.label).toBe("Relatório completo");
    expect(delivered!.titles).toHaveLength(8);
    expect(delivered!.titles[0]).toBe("Aberto retrato");
    expect(delivered!.titles[4]).toBe(`${SECRET}-titulo-virada`);
    expect(delivered!.titles).not.toContain("Um cuidado importante");
    expect(JSON.stringify(delivered)).not.toContain("conteudo");
  });
});
