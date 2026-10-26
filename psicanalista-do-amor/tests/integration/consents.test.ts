import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/uploads/route";
import { LEGAL_VERSION } from "@/lib/copy";
import { closeDb, getDb } from "@/server/db/client";
import { consents } from "@/server/db/schema";
import { stopBoss } from "@/server/jobs/boss";
import { describeDb, prepareTestDb } from "../helpers/db";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200)}`, "user-agent": "teste" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

const BASE = {
  mode: "paste",
  text: "Ana: oi, tudo bem?\nLéo: tudo e você?\nAna: também",
  consent_terms: "on",
  consent_adult: "on",
};

function upload(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { origin: process.env.APP_URL! }, body: form }));
}

/**
 * Consentimentos do envio (D101): duas caixas. A dos Termos traz, no texto e em destaque, a participação na
 * conversa, o aviso de IA e a autorização de dados sensíveis e de transferência internacional.
 */
describeDb("consentimentos do envio (LGPD, arts. 11 e 33)", () => {
  beforeEach(async () => {
    await prepareTestDb();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  it("sem a caixa dos Termos ou a dos 18 anos, o envio é recusado", async () => {
    for (const missing of ["consent_terms", "consent_adult"]) {
      const { [missing]: _omit, ...fields } = BASE as Record<string, string>;
      void _omit;
      const res = await upload({ ...fields, email: `a${Math.random()}@example.com` });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "consent_required" });
    }
    expect(await getDb().select().from(consents)).toHaveLength(0);
  });

  it("com todos, registra cada consentimento com a versão dos textos", async () => {
    const res = await upload({ ...BASE, email: `b${Math.random()}@example.com` });
    expect(res.status).toBe(201);
    const { conversationId } = (await res.json()) as { conversationId: string };
    const rows = await getDb().select().from(consents).where(eq(consents.conversationId, conversationId));
    expect(rows.map((r) => r.kind).sort()).toEqual(
      ["adult", "ai_disclaimer", "international_transfer", "privacy", "sensitive_data", "terms", "third_party_data"].sort(),
    );
    expect(rows.every((r) => r.version === LEGAL_VERSION)).toBe(true);
  });
});
