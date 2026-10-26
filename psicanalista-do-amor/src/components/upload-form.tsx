"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { errorMessage } from "@/lib/messages";
import { AlertIcon, ArchiveIcon, CheckIcon, FileTextIcon, ImagesIcon, TextIcon } from "./icons";
import { DEFAULT_UPLOAD_LIMITS, type UploadLimits } from "@/lib/upload-limits";

export type UploadMode = "paste" | "txt" | "zip" | "images";


const MODES: { mode: UploadMode; label: string; hint: string; icon: ReactNode }[] = [
  { mode: "paste", label: "Colar texto", hint: "Cole a conversa exportada ou no formato \"Nome: mensagem\".", icon: <TextIcon className="h-5 w-5 shrink-0" /> },
  { mode: "txt", label: "Arquivo .txt", hint: "A exportação do WhatsApp (\"Exportar conversa\" → \"Sem mídia\").", icon: <FileTextIcon className="h-5 w-5 shrink-0" /> },
  { mode: "zip", label: "Arquivo .zip", hint: "A exportação \"com mídia\" do WhatsApp ou um .zip com prints.", icon: <ArchiveIcon className="h-5 w-5 shrink-0" /> },
  { mode: "images", label: "Prints", hint: "Capturas de tela, na ordem da conversa.", icon: <ImagesIcon className="h-5 w-5 shrink-0" /> },
];

type Consent = { name: string; label: ReactNode; highlight?: boolean };

// Duas caixas (decisão do dono, D101). A primeira reúne os Termos, a declaração de participação, o
// aviso de IA e a autorização da LGPD (dados sensíveis e envio aos EUA) em destaque no próprio texto.
const CONSENTS: Consent[] = [
  {
    name: "consent_terms",
    label: (
      <>
        Li e aceito os <a href="/termos" target="_blank" className="link">Termos de Uso</a> e a{" "}
        <a href="/privacidade" target="_blank" className="link">Política de Privacidade</a>, e{" "}
        <strong>
          autorizo o tratamento dos dados desta conversa (que podem ser sensíveis) e o envio dela para análise por IA nos
          Estados Unidos
        </strong>
        , só para gerar o relatório.
      </>
    ),
  },
  { name: "consent_adult", label: <>Tenho 18 anos ou mais.</> },
];

const mb = (bytes: number) => (bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** Checagem de tamanho no navegador (QA-12): avisa antes de gastar o envio. Devolve a mensagem ou null. */
function checkFiles(mode: UploadMode, files: File[], limits: UploadLimits): string | null {
  const { maxTotalBytes: MAX_TOTAL_BYTES, maxImageBytes: MAX_IMAGE_BYTES, maxImages: MAX_IMAGES } = limits;
  if (files.length === 0) return null;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (mode === "images") {
    if (files.length > MAX_IMAGES) return `Você selecionou ${files.length} prints, e o máximo é ${MAX_IMAGES} por análise. Escolha as mais importantes e selecione de novo.`;
    const big = files.findIndex((f) => f.size > MAX_IMAGE_BYTES);
    if (big >= 0) return `A ${big + 1}ª imagem tem ${mb(files[big]!.size)} MB, e cada print pode ter no máximo ${mb(MAX_IMAGE_BYTES)} MB. Corte a imagem ou salve em JPG e selecione de novo.`;
  }
  if (total > MAX_TOTAL_BYTES) {
    return mode === "zip"
      ? `O arquivo tem ${mb(total)} MB, e o limite é ${mb(MAX_TOTAL_BYTES)} MB. Se for a exportação do WhatsApp, exporte de novo escolhendo "Sem mídia" e envie o .txt. Se for um .zip de prints, coloque menos imagens nele.`
      : mode === "images"
        ? `As prints somam ${mb(total)} MB, e o limite por envio é ${mb(MAX_TOTAL_BYTES)} MB. Tire as repetidas ou salve as imagens em JPG, que ocupa menos espaço.`
        : `O arquivo tem ${mb(total)} MB, e o limite é ${mb(MAX_TOTAL_BYTES)} MB. Confira se escolheu o arquivo certo: a exportação "Sem mídia" do WhatsApp costuma ser bem menor.`;
  }
  return null;
}

export function UploadForm({
  modes,
  defaultEmail,
  limits = DEFAULT_UPLOAD_LIMITS,
}: {
  modes: UploadMode[];
  defaultEmail?: string;
  limits?: UploadLimits;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<UploadMode>(modes[0] ?? "paste");
  // O texto colado sobrevive à troca de modo (QA-12).
  const [text, setText] = useState("");
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [picked, setPicked] = useState<{ count: number; bytes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "sending" | "opening">("idle");
  const fileRef = useRef<HTMLInputElement>(null);
  const sending = step !== "idle";

  const normalizedEmail = email.trim().toLowerCase();
  const switchingEmail =
    !!defaultEmail && normalizedEmail.includes("@") && normalizedEmail !== defaultEmail.trim().toLowerCase();

  function changeMode(next: UploadMode) {
    setMode(next);
    setError(null);
    setPicked(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onFilesChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    setPicked(files.length ? { count: files.length, bytes: files.reduce((n, f) => n + f.size, 0) } : null);
    setError(checkFiles(mode, files, limits));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    data.set("mode", mode);
    if (mode !== "paste") {
      data.delete("text");
      const tooBig = checkFiles(mode, Array.from(fileRef.current?.files ?? []), limits);
      if (tooBig) {
        setError(tooBig);
        return;
      }
    }
    if (mode === "paste") data.delete("files");
    setStep("sending");
    try {
      const res = await fetch("/api/uploads", { method: "POST", body: data, credentials: "same-origin" });
      const body = (await res.json().catch(() => ({}))) as { conversationId?: string; error?: string };
      if (!res.ok || !body.conversationId) {
        setError(errorMessage(body.error ?? "server_error"));
        setStep("idle");
        return;
      }
      setStep("opening");
      router.push(`/r/${body.conversationId}/processando`);
    } catch {
      setError(errorMessage("network"));
      setStep("idle");
    }
  }

  const active = MODES.find((t) => t.mode === mode)!;

  return (
    <form onSubmit={onSubmit} className="space-y-6" aria-describedby={error ? "upload-error" : undefined} aria-busy={sending || undefined}>
      <fieldset disabled={sending} className="space-y-6">
        <fieldset>
          <legend className="label mb-2">Forma de envio</legend>
          <div className="grid grid-cols-2 gap-2">
            {MODES.filter((t) => modes.includes(t.mode)).map((t) => (
              <label
                key={t.mode}
                className="relative flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-control border border-field bg-paper px-3 py-2 text-center text-sm font-semibold text-wine-800 hover:border-wine-600 hover:bg-wine-50 has-[:checked]:border-wine-700 has-[:checked]:bg-wine-700 has-[:checked]:text-white has-[:disabled]:cursor-not-allowed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-wine-600 motion-safe:transition-colors"
              >
                <input
                  type="radio"
                  name="mode"
                  value={t.mode}
                  checked={mode === t.mode}
                  onChange={() => changeMode(t.mode)}
                  // Invisível, mas do tamanho do cartão (não `sr-only` de 1 px): o toque cai no
                  // próprio rádio e o leitor de tela do celular mostra o foco no cartão inteiro.
                  className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none rounded-control opacity-0 disabled:cursor-not-allowed"
                />
                {t.icon}
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="card space-y-4">
          {/* Altura mínima: a dica de cada modo tem tamanho diferente e não pode empurrar o resto. */}
          <p className="hint min-h-10">{active.hint}</p>
          {mode === "paste" ? (
            <>
              <label htmlFor="text" className="label">Conversa</label>
              <textarea
                id="text"
                name="text"
                required
                rows={12}
                maxLength={500_000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="input font-mono text-sm"
                placeholder={"23/10/2026 14:05 - Ana: oi, sumido\n23/10/2026 14:07 - Lucas: tava com a cabeça cheia, desculpa"}
              />
            </>
          ) : (
            <>
              <label htmlFor="files" className="label">
                {mode === "images" ? "Prints (PNG, JPG ou WEBP)" : mode === "zip" ? "Arquivo .zip" : "Arquivo .txt"}
              </label>
              <input
                ref={fileRef}
                id="files"
                name="files"
                type="file"
                required
                multiple={mode === "images"}
                onChange={onFilesChange}
                aria-describedby="files-help"
                accept={
                  mode === "images"
                    ? "image/png,image/jpeg,image/webp"
                    : mode === "zip"
                      ? ".zip,application/zip"
                      : ".txt,text/plain"
                }
                aria-invalid={error ? true : undefined}
                className="block w-full rounded-control border border-field bg-paper text-sm text-ink file:mr-4 file:min-h-11 file:cursor-pointer file:border-0 file:bg-wine-100 file:px-4 file:py-2 file:font-semibold file:text-wine-900 hover:file:bg-wine-200 aria-[invalid=true]:border-red-700"
              />
              <p id="files-help" className={`flex items-start gap-1.5 text-xs ${error ? "font-medium text-red-800" : picked ? "font-medium text-green-900" : "text-muted"}`}>
                {picked && !error && <CheckIcon className="mt-px h-4 w-4 text-green-700" />}
                <span>
                  {picked
                    ? `${picked.count} ${picked.count === 1 ? "arquivo selecionado" : "arquivos selecionados"} · ${mb(picked.bytes)} MB${error ? "" : " · tamanho ok"}`
                    : mode === "images"
                      ? `Até ${limits.maxImages} prints, de até ${mb(limits.maxImageBytes)} MB cada (${mb(limits.maxTotalBytes)} MB no total).`
                      : `Até ${mb(limits.maxTotalBytes)} MB.`}
                </span>
              </p>
            </>
          )}
        </div>

        <div className="card space-y-4">
          <div>
            <label htmlFor="email" className="label">Seu e-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="voce@exemplo.com"
              aria-describedby={switchingEmail ? "email-help email-switch" : "email-help"}
            />
            <p id="email-help" className="mt-1.5 text-xs text-muted">
              Usamos o e-mail para você voltar à análise de outro aparelho e para avisos sobre ela. Nada de spam.
            </p>
            {switchingEmail && (
              <p id="email-switch" className="alert alert-warning mt-3 text-xs">
                Este navegador está conectado com {defaultEmail}. Se você enviar com outro e-mail, esta análise fica no novo
                endereço e o navegador passa a usá-lo. Para voltar às análises de {defaultEmail}, é só{" "}
                <a href="/entrar" className="underline underline-offset-2">pedir um link de acesso</a> com ele.
              </p>
            )}
          </div>
          <fieldset className="space-y-1">
            <legend className="label mb-2">Declarações obrigatórias</legend>
            {CONSENTS.map((c) => (
              <label
                key={c.name}
                className={`flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-sm text-ink ${c.highlight ? "rounded-control border border-amber-400 bg-amber-50 px-3 py-2.5" : ""}`}
              >
                <input type="checkbox" name={c.name} required className="mt-0.5 h-5 w-5 shrink-0 accent-wine-600" />
                <span>{c.label}</span>
              </label>
            ))}
          </fieldset>
        </div>

        {error && (
          <p id="upload-error" role="alert" className="alert alert-danger">
            <AlertIcon className="mt-0.5 h-5 w-5 text-red-700" />
            <span>{error}</span>
          </p>
        )}

        <div className="space-y-2">
          <button type="submit" className="btn-primary min-h-12 w-full px-6 text-base sm:w-auto">
            {step === "sending" ? "Enviando…" : step === "opening" ? "Abrindo a análise…" : "Analisar conversa"}
          </button>
          <p aria-live="polite" className="min-h-5 text-sm text-muted">
            {step === "sending"
              ? "Enviando a conversa com segurança. Não feche esta página."
              : step === "opening"
                ? "Recebemos a conversa. Abrindo o acompanhamento…"
                : ""}
          </p>
        </div>
      </fieldset>
    </form>
  );
}
