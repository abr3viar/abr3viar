import type { Instrumentation } from "next";

/**
 * Monitoramento de erros SEM conteúdo: registra só nome/código do erro, o padrão da
 * rota e o tipo de renderização — nunca URL com parâmetros, corpo ou variáveis locais.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log, safeErr } = await import("@/server/log");
  log.error(
    {
      err: safeErr(err),
      method: request.method,
      route: context.routePath,
      routeType: context.routeType,
      digest: (err as { digest?: string }).digest,
    },
    "request_error",
  );
  const { sendAlert } = await import("@/server/alerts");
  await sendAlert("erro_no_servidor", { route: context.routePath });
};
