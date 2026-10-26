import Markdown from "react-markdown";

/** Markdown RESTRITO para o texto da IA: sem HTML cru, sem links, sem imagens (plano.md 10.4). */
const ALLOWED = ["p", "strong", "em", "ul", "ol", "li", "blockquote", "br"];

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <div className="prose-report">
      <Markdown allowedElements={ALLOWED} unwrapDisallowed skipHtml>
        {children}
      </Markdown>
    </div>
  );
}
