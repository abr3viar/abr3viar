import { afterAll, beforeEach, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { stopBoss } from "@/server/jobs/boss";
import { consumeGlobalUploadSlot, consumeRateLimit } from "@/server/rate-limit";
import { describeDb, prepareTestDb } from "../helpers/db";

describeDb("rate limit no Postgres", () => {
  beforeEach(async () => {
    await prepareTestDb();
  });
  afterAll(async () => {
    await stopBoss();
    await closeDb();
  });

  it("requisições paralelas não furam o limite (5 envios/hora por e-mail)", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => consumeRateLimit("upload", ["email:paralelo@example.com"])));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("IP tem limite próprio, maior (CGNAT), e IPv6 conta pelo /64", async () => {
    let ok = 0;
    for (let i = 0; i < 25; i++) if (await consumeRateLimit("upload", [`ip:2001:db8:1:2::${i.toString(16)}`])) ok++;
    expect(ok).toBe(20);
  });

  it("teto global por hora", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => consumeGlobalUploadSlot(4)));
    expect(results.filter(Boolean)).toHaveLength(4);
  });
});
