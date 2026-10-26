import { SAFETY_RESOURCES } from "@/lib/copy";
import { PhoneIcon } from "../icons";

/** Alerta de risco: sempre visível e grátis (nunca atrás do paywall). Telefones como botões grandes. */
export function SafetyBox() {
  return (
    <aside className="alert-safety rounded-card" role="note" aria-labelledby="safety-title">
      <h2 id="safety-title" className="font-semibold text-amber-950">Se você precisar de ajuda agora</h2>
      <p className="mt-2 text-sm leading-relaxed">
        Este quadro aparece porque a leitura encontrou na conversa sinais que pedem cuidado, como ameaça, controle,
        violência ou falas sobre se machucar. A IA pode ter se enganado. Mesmo assim, se algo disso faz parte da sua vida
        ou da vida de alguém próximo, você não precisa passar por isso sem apoio. A seção “Um cuidado importante”, logo
        abaixo, traz mais detalhes. Os atendimentos a seguir são gratuitos.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {SAFETY_RESOURCES.map((r) => (
          <li key={r.phone}>
            <a
              href={`tel:${r.phone}`}
              className="flex h-full min-h-12 items-start gap-3 rounded-control border border-amber-400 bg-paper px-4 py-3 text-amber-950 hover:border-amber-700 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 motion-safe:transition-colors"
            >
              <PhoneIcon className="mt-0.5 h-5 w-5 text-amber-800" />
              <span>
                <span className="block font-semibold">{r.name}</span>
                <span className="block text-sm">{r.description}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
