import { test } from "./fixtures";

/** Compila as rotas no `next dev` antes dos testes (evita recargas na primeira visita). */
const ROUTES = ["/", "/analisar", "/entrar", "/entrar/verificar", "/minhas-analises", "/conta", "/admin", "/pagamento/retorno", "/termos", "/r/00000000-0000-7000-8000-000000000000"];

test("aquecimento das rotas", async ({ request }) => {
  test.setTimeout(180_000);
  for (const r of ROUTES) await request.get(r);
});
