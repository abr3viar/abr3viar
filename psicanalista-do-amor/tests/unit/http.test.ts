import { describe, expect, it } from "vitest";
import { BodyTimeoutError, clientIpFromForwarded, readBodyLimited } from "@/server/http";

describe("IP do cliente atrás do proxy", () => {
  it("usa a entrada acrescentada pelo proxy confiável (não a forjada pelo cliente)", () => {
    expect(clientIpFromForwarded("1.1.1.1, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientIpFromForwarded("forjado, 198.51.100.2, 10.0.0.1", 2)).toBe("198.51.100.2");
    expect(clientIpFromForwarded("203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientIpFromForwarded(null, 1)).toBeNull();
  });
});

describe("leitura do corpo com limite real de bytes", () => {
  const streamOf = (chunks: number, size: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < chunks; i++) c.enqueue(new Uint8Array(size));
        c.close();
      },
    });
  const req = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
    new Request("http://localhost/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

  it("aborta corpo chunked (sem Content-Length) que passa do limite", async () => {
    expect(await readBodyLimited(req(streamOf(10, 1024)), 4096)).toBeNull();
  });
  it("recusa pelo Content-Length declarado sem ler", async () => {
    expect(await readBodyLimited(req(streamOf(1, 10), { "content-length": "999999" }), 4096)).toBeNull();
  });
  it("devolve o corpo dentro do limite", async () => {
    expect((await readBodyLimited(req(streamOf(3, 1000)), 4096))?.length).toBe(3000);
  });
});

describe("prazo de leitura do corpo", () => {
  it("corpo que nunca termina estoura o prazo", async () => {
    const stalled = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(10)); } });
    const req = new Request("http://localhost/x", { method: "POST", body: stalled, duplex: "half" } as RequestInit);
    await expect(readBodyLimited(req, 4096, 50)).rejects.toBeInstanceOf(BodyTimeoutError);
  });
});
