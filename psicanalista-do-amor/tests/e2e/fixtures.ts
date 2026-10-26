import { test as base } from "@playwright/test";

/**
 * Cada teste usa um "IP" próprio (X-Forwarded-For) para que o rate limit por IP de um
 * teste não afete os outros — como clientes diferentes na vida real.
 */
export const test = base.extend<{ fakeIp: string }>({
  fakeIp: [
    async ({ context }, use) => {
      const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
      await context.setExtraHTTPHeaders({ "x-forwarded-for": ip });
      await use(ip);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
