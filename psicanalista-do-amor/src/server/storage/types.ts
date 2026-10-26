export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Apaga todos os objetos com o prefixo (ex.: `uploads/<conversationId>/`). */
  deletePrefix(prefix: string): Promise<void>;
  /** Lista chaves com o prefixo (para limpeza de órfãos). */
  list(prefix: string): Promise<{ key: string; lastModified: Date }[]>;
  ping(): Promise<void>;
}

/** Chaves são sempre geradas por nós: só [a-zA-Z0-9/_-.] e sem "..". */
export function assertSafeKey(key: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("invalid_storage_key");
  }
}
