import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { exportUserData } from "@/server/account-export";
import { purgeOldAccessLogs, recordAccess } from "@/server/access-log";
import { consumeMagicLink } from "@/server/auth/magic-link";
import { randomToken, tokenHash } from "@/server/crypto";
import { deleteUserData } from "@/server/data-deletion";
import { closeDb, getDb } from "@/server/db/client";
import { accessLogs, loginTokens, users } from "@/server/db/schema";
import { stopBoss } from "@/server/jobs/boss";
import { describeDb, prepareTestDb } from "../helpers/db";

const IP = "198.51.100.77";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.77", "user-agent": "teste" }),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

/** J-04 (auditoria jurídica): Marco Civil da Internet, art. 15 — registros de acesso por 6 meses. */
describeDb("registro de acesso (Marco Civil, art. 15)", () => {
  beforeEach(async () => {
    await prepareTestDb();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  async function login(email: string) {
    const token = randomToken(32);
    await getDb().insert(loginTokens).values({ email, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60_000) });
    expect(await consumeMagicLink(token, "teste")).toBe(true);
    const [u] = await getDb().select().from(users).where(eq(users.email, email));
    return u!.id;
  }

  it("o login grava IP (cifrado), data e hora; a exportação devolve ao titular", async () => {
    const userId = await login("acesso@example.com");
    const rows = await getDb().select().from(accessLogs).where(eq(accessLogs.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toBe("login");
    // Nunca em texto puro no banco.
    expect(rows[0]!.ip).not.toContain(IP);
    const exported = await exportUserData(userId);
    expect(exported?.accessLogs).toEqual([expect.objectContaining({ event: "login", ip: IP })]);
  });

  it("os registros ficam depois da exclusão da conta (obrigação legal)", async () => {
    const userId = await login("excluir@example.com");
    await recordAccess("account_deletion", userId);
    await deleteUserData(userId);
    expect(await getDb().select().from(users).where(eq(users.id, userId))).toHaveLength(0);
    const kept = await getDb().select().from(accessLogs).where(eq(accessLogs.userId, userId));
    expect(kept.map((r) => r.event).sort()).toEqual(["account_deletion", "login"]);
  });

  it("a limpeza apaga só o que passou de 6 meses", async () => {
    const userId = await login("prazo@example.com");
    await recordAccess("upload", userId);
    await getDb().update(accessLogs).set({ occurredAt: new Date(Date.now() - 190 * 86_400_000) }).where(eq(accessLogs.event, "upload"));
    expect(await purgeOldAccessLogs()).toBe(1);
    const left = await getDb().select().from(accessLogs).where(eq(accessLogs.userId, userId));
    expect(left.map((r) => r.event)).toEqual(["login"]);
  });

  it("falha ao registrar não derruba a ação do usuário", async () => {
    // userId inválido (não é UUID): o insert falha e só vai para o log.
    await expect(recordAccess("login", "nao-e-uuid")).resolves.toBeUndefined();
  });
});
