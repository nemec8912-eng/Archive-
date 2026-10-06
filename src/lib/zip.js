// Минимальное чтение ZIP-архивов на устройстве (экспорт переписок WhatsApp, Telegram).
// Поддерживаются методы «без сжатия» и deflate через встроенный DecompressionStream.

const dv = (buf) => new DataView(buf);

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Распаковка ZIP не поддерживается на этом устройстве');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeName(bytes, utf8) {
  try {
    return new TextDecoder(utf8 ? 'utf-8' : 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}

// Возвращает список файлов: { name, size, read(): Promise<Blob> }.
export async function readZip(file) {
  const size = file.size;
  // Конец центрального каталога ищем в последних 64 КБ.
  const tailLen = Math.min(size, 65557);
  const tail = await file.slice(size - tailLen).arrayBuffer();
  const t = dv(tail);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (t.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Это не ZIP-архив');
  let count = t.getUint16(eocd + 10, true);
  let cdSize = t.getUint32(eocd + 12, true);
  let cdOffset = t.getUint32(eocd + 16, true);

  // ZIP64
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && t.getUint32(loc, true) === 0x07064b50) {
      const z64off = Number(t.getBigUint64(loc + 8, true));
      const z = dv(await file.slice(z64off, z64off + 56).arrayBuffer());
      count = Number(z.getBigUint64(32, true));
      cdSize = Number(z.getBigUint64(40, true));
      cdOffset = Number(z.getBigUint64(48, true));
    }
  }

  const cd = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const c = dv(cd);
  const bytes = new Uint8Array(cd);
  const entries = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (c.getUint32(p, true) !== 0x02014b50) break;
    const flags = c.getUint16(p + 8, true);
    const method = c.getUint16(p + 10, true);
    let compSize = c.getUint32(p + 20, true);
    let rawSize = c.getUint32(p + 24, true);
    const nameLen = c.getUint16(p + 28, true);
    const extraLen = c.getUint16(p + 30, true);
    const commentLen = c.getUint16(p + 32, true);
    let localOffset = c.getUint32(p + 42, true);
    const name = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), flags & 0x800);
    // ZIP64 extra field
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = c.getUint16(e, true);
      const len = c.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (rawSize === 0xffffffff) { rawSize = Number(c.getBigUint64(q, true)); q += 8; }
        if (compSize === 0xffffffff) { compSize = Number(c.getBigUint64(q, true)); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(c.getBigUint64(q, true)); }
      }
      e += 4 + len;
    }
    p = eEnd + commentLen;
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      size: rawSize,
      async read(type = '') {
        const head = dv(await file.slice(localOffset, localOffset + 30).arrayBuffer());
        const start = localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        const data = await file.slice(start, start + compSize).arrayBuffer();
        if (method === 0) return new Blob([data], { type });
        if (method === 8) return new Blob([await inflateRaw(data)], { type });
        throw new Error(`Неподдерживаемый метод сжатия: ${method}`);
      },
    });
  }
  return entries;
}

export async function isZip(file) {
  const h = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04;
}
