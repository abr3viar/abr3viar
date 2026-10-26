export type MessageKind = "text" | "media_omitted" | "deleted" | "sticker" | "audio" | "system";

/** Formato comum a todas as entradas (plano.md, seção 4). */
export type NormalizedMessage = {
  seq: number;
  senderRaw: string; // "Ana", "Pessoa da direita"; "" para mensagens de sistema
  sentAt: Date | null;
  kind: MessageKind;
  content: string;
  source: "text" | "ocr";
  ocrConfidence?: number;
};

export type ParseResult = {
  messages: NormalizedMessage[];
  format: string;
  hasTimestamps: boolean;
};

export class IngestError extends Error {
  /** Código genérico (vai para `error_code`; nunca contém conteúdo). */
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "IngestError";
    this.code = code;
  }
}
