import { describe, expect, it } from "vitest";
import { normalizeIpForLimit } from "@/server/rate-limit";

describe("IP para rate limit", () => {
  it("IPv6 vira o prefixo /64; IPv4 (e IPv4 mapeado) fica igual", () => {
    expect(normalizeIpForLimit("2001:db8:abcd:12:1:2:3:4")).toBe("2001:0db8:abcd:0012::/64");
    expect(normalizeIpForLimit("2001:db8:abcd:12::99")).toBe("2001:0db8:abcd:0012::/64");
    expect(normalizeIpForLimit("2001:db8::1")).toBe("2001:0db8:0000:0000::/64");
    expect(normalizeIpForLimit("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIpForLimit("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIpForLimit("unknown")).toBe("unknown");
  });
});

describe("faixa de rede para o limite por rede", () => {
  it("IPv4 /24 e IPv6 /48", async () => {
    const { subnetForLimit } = await import("@/server/rate-limit");
    expect(subnetForLimit("203.0.113.9")).toBe("203.0.113.0/24");
    expect(subnetForLimit("2001:db8:abcd:12:1::4")).toBe("2001:0db8:abcd::/48");
  });
});
