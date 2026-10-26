import { crc32, deflateRawSync } from "node:zlib";

/**
 * Gerador de .zip MÍNIMO para testes — permite nomes maliciosos, symlinks,
 * criptografia marcada e tamanhos declarados falsos (coisas que bibliotecas
 * normais de zip se recusam a gerar).
 */
export type RawEntry = {
  name: string;
  data: Buffer;
  deflate?: boolean;
  /** Atributos externos (ex.: symlink = (0o120777 << 16)). */
  externalAttrs?: number;
  encryptedFlag?: boolean;
  /** Mente o tamanho descompactado declarado. */
  declaredSize?: number;
};

export function buildZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const crc = crc32(e.data);
    const flags = (e.encryptedFlag ? 0x1 : 0) | 0x800;
    const method = e.deflate ? 8 : 0;
    const size = e.declaredSize ?? e.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // feito em Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((e.externalAttrs ?? (0o100644 << 16)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
