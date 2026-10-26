import type { Metadata } from "next";
import { UploadForm } from "@/components/upload-form";
import { DEFAULT_UPLOAD_LIMITS, type UploadLimits } from "@/lib/upload-limits";
import { getEnv } from "@/env";

import { ExportInstructions } from "@/components/export-instructions";
import { getViewer } from "@/server/auth/session";
import { errorMessage } from "@/lib/messages";
import { PRIVATE_ROBOTS } from "@/lib/seo";

/** Os mesmos limites que o /api/uploads aplica (env), para a checagem no navegador. */
function uploadLimits(): UploadLimits {
  try {
    const env = getEnv();
    return { maxTotalBytes: env.UPLOAD_MAX_BYTES, maxImageBytes: env.MAX_IMAGE_BYTES, maxImages: env.MAX_IMAGES };
  } catch {
    return DEFAULT_UPLOAD_LIMITS;
  }
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analisar uma conversa", robots: PRIVATE_ROBOTS };

export default async function AnalisarPage(props: { searchParams: Promise<{ erro?: string | string[] }> }) {
  const { erro } = await props.searchParams;
  const viewer = await getViewer();
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="heading-1">Analisar uma conversa</h1>
      <p className="mt-2 text-muted">
        Envie a conversa entre duas pessoas. A primeira metade do relatório é grátis. Os arquivos originais são apagados
        logo depois de lidos.
      </p>
      {typeof erro === "string" && (
        <p role="status" className="mt-6 rounded-control bg-amber-50 p-4 text-sm text-amber-900">
          {errorMessage(erro)}
        </p>
      )}
      <div className="mt-8">
        <UploadForm modes={["paste", "txt", "zip", "images"]} defaultEmail={viewer?.email} limits={uploadLimits()} />
      </div>
      <ExportInstructions />
    </div>
  );
}
