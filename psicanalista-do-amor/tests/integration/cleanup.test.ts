import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db/client";
import { conversationFiles, conversations } from "@/server/db/schema";
import { stopBoss } from "@/server/jobs/boss";
import { cleanupFiles } from "@/server/jobs/maintenance";
import { putEncrypted, setStorageForTests } from "@/server/storage";
import { describeDb, prepareTestDb } from "../helpers/db";
import { createUserWithSession } from "../helpers/factories";
import { MemoryStorage } from "../helpers/memory-storage";

describeDb("limpeza de originais (24 h) e órfãos", () => {
  const storage = new MemoryStorage();
  beforeEach(async () => {
    await prepareTestDb();
    storage.objects.clear();
    setStorageForTests(storage);
  });
  afterAll(async () => {
    setStorageForTests(undefined);
    await stopBoss();
    await closeDb();
  });

  it("apaga originais com mais de 24 h, mantém os recentes e remove órfãos", async () => {
    const { user } = await createUserWithSession("limpeza@example.com");
    const db = getDb();
    const mk = async (ageH: number) => {
      const [c] = await db
        .insert(conversations)
        .values({ userId: user.id, sourceType: "images", status: "failed", expiresAt: new Date(Date.now() + 86_400_000) })
        .returning();
      const key = `uploads/${c!.id}/f1`;
      await putEncrypted(key, Buffer.from("print"));
      await db.insert(conversationFiles).values({
        conversationId: c!.id,
        storageKey: key,
        mime: "image/png",
        sizeBytes: 5,
        sha256: "x",
        orderIndex: 0,
        createdAt: new Date(Date.now() - ageH * 3_600_000),
      });
      return c!.id;
    };
    const oldId = await mk(25);
    const newId = await mk(1);
    await putEncrypted("uploads/0192f000-0000-7000-8000-00000000abcd/x", Buffer.from("orfao"));
    for (const o of storage.objects.values()) o.lastModified = new Date(Date.now() - 2 * 3_600_000);

    const res = await cleanupFiles();
    expect(res.purged).toBe(1);
    expect(res.orphans).toBe(1);
    expect([...storage.objects.keys()]).toEqual([`uploads/${newId}/f1`]);
    const [oldConv] = await db.select().from(conversations).where(eq(conversations.id, oldId));
    expect(oldConv!.filesPurgedAt).not.toBeNull();
  });
});
