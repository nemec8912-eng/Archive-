// Куда пишется большой файл (резервная копия, экспорт папок) — по частям, по мере готовности.
// В браузере — собирается в Blob (браузер сам держит большие части на диске).
// В приложении для телефона — дописывается во временный файл (см. native.js), чтобы весь архив
// не оказывался в памяти телефона разом.
export function memorySink(type = 'application/octet-stream') {
  const parts = [];
  let size = 0;
  return {
    async write(part) { parts.push(part); size += part.size ?? part.byteLength ?? part.length; },
    async finish() { return new Blob(parts, { type }); },
    get size() { return size; },
  };
}

export function fileSink(name, type) {
  const native = typeof window !== 'undefined' && window.ArchiveNative?.tempSink;
  return native ? native(name) : memorySink(type);
}
