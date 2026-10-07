// Обрезка видео MP4/MOV по времени без перекодирования.
// Кадры и звук копируются как есть, перестраивается только оглавление файла (moov),
// поэтому обрезка мгновенная, качество не теряется и работает на любом телефоне, в том числе на iPhone.
// Точное начало задаётся списком правки (edit list): файл начинается с ближайшего ключевого кадра,
// а лишние доли секунды до выбранного начала плеер не показывает.
//
// Не подходит для фрагментированных файлов (moof) и необычных раскладок — тогда бросается ошибка
// с code = 'unsupported', и вызывающий код переходит к перекодированию.

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);
const KEEP_TRACKS = new Set(['vide', 'soun']);
const DROP_STBL = new Set(['sdtp', 'sbgp', 'sgpd', 'cslg', 'stps', 'subs', 'saiz', 'saio']);

const unsupported = (why) => Object.assign(new Error(`Неподдерживаемый файл: ${why}`), { code: 'unsupported' });
const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
const u64 = (dv, o) => dv.getUint32(o) * 2 ** 32 + dv.getUint32(o + 4);
const i64 = (dv, o) => dv.getInt32(o) * 2 ** 32 + dv.getUint32(o + 4);

function* boxes(dv, start, end) {
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    const type = fourcc(dv, o + 4);
    let hdr = 8;
    if (size === 1) { size = u64(dv, o + 8); hdr = 16; } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) throw unsupported('повреждённый блок');
    yield { type, start: o, body: o + hdr, end: o + size };
    o += size;
  }
}
const child = (dv, box, type) => { for (const b of boxes(dv, box.body, box.end)) if (b.type === type) return b; return null; };

// ── Верхний уровень файла: ftyp, moov, mdat… — читаем только заголовки блоков ──
async function topLevel(blob) {
  const list = [];
  let o = 0;
  while (o + 8 <= blob.size) {
    const h = new DataView(await blob.slice(o, o + 16).arrayBuffer());
    let size = h.getUint32(0);
    const type = fourcc(h, 4);
    if (size === 1) size = u64(h, 8); else if (size === 0) size = blob.size - o;
    if (size < 8 || o + size > blob.size) throw unsupported('повреждённый файл');
    list.push({ type, start: o, end: o + size });
    o += size;
  }
  return list;
}

// ── Таблица кадров дорожки ──
function readTrack(dv, trak) {
  const tkhd = child(dv, trak, 'tkhd');
  const mdia = child(dv, trak, 'mdia');
  const hdlr = mdia && child(dv, mdia, 'hdlr');
  const handler = hdlr ? fourcc(dv, hdlr.body + 8) : '';
  const mdhd = mdia && child(dv, mdia, 'mdhd');
  const minf = mdia && child(dv, mdia, 'minf');
  const stbl = minf && child(dv, minf, 'stbl');
  if (!tkhd || !mdhd || !stbl) throw unsupported('нет описания дорожки');
  const mv = dv.getUint8(mdhd.body);
  const timescale = dv.getUint32(mdhd.body + (mv === 1 ? 20 : 12));

  // Список правки: поддерживаем одну обычную правку (и пустую правку перед ней).
  let mediaTime = 0;
  const edts = child(dv, trak, 'edts');
  const elst = edts && child(dv, edts, 'elst');
  if (elst) {
    const ev = dv.getUint8(elst.body);
    const n = dv.getUint32(elst.body + 4);
    const entries = [];
    for (let i = 0, o = elst.body + 8; i < n; i++) {
      entries.push(ev === 1 ? { mt: i64(dv, o + 8) } : { mt: dv.getInt32(o + 4) });
      o += ev === 1 ? 20 : 12;
    }
    const real = entries.filter((e) => e.mt !== -1);
    if (real.length > 1) throw unsupported('несколько правок');
    mediaTime = real[0]?.mt || 0;
  }

  const get = (t) => child(dv, stbl, t);
  const stts = get('stts');
  const stsc = get('stsc');
  const stsz = get('stsz');
  const stco = get('stco');
  const co64 = get('co64');
  if (!stts || !stsc || !stsz || !(stco || co64)) throw unsupported('нет таблицы кадров');

  const count = dv.getUint32(stsz.body + 8);
  const fixed = dv.getUint32(stsz.body + 4);
  const size = new Uint32Array(count);
  for (let i = 0; i < count; i++) size[i] = fixed || dv.getUint32(stsz.body + 12 + i * 4);

  const dur = new Uint32Array(count);
  const dts = new Float64Array(count);
  {
    const n = dv.getUint32(stts.body + 4);
    let k = 0;
    let t = 0;
    for (let e = 0; e < n; e++) {
      const c = dv.getUint32(stts.body + 8 + e * 8);
      const d = dv.getUint32(stts.body + 12 + e * 8);
      for (let j = 0; j < c && k < count; j++, k++) { dur[k] = d; dts[k] = t; t += d; }
    }
    if (k < count) throw unsupported('неполная таблица времени');
  }

  const ctts = get('ctts');
  const cts = new Float64Array(count);
  let cttsVersion = -1;
  if (ctts) {
    cttsVersion = dv.getUint8(ctts.body);
    const n = dv.getUint32(ctts.body + 4);
    let k = 0;
    for (let e = 0; e < n; e++) {
      const c = dv.getUint32(ctts.body + 8 + e * 8);
      const off = cttsVersion === 1 ? dv.getInt32(ctts.body + 12 + e * 8) : dv.getUint32(ctts.body + 12 + e * 8);
      for (let j = 0; j < c && k < count; j++, k++) cts[k] = off;
    }
  }

  const stss = get('stss');
  const sync = new Uint8Array(count).fill(stss ? 0 : 1);
  if (stss) {
    const n = dv.getUint32(stss.body + 4);
    for (let e = 0; e < n; e++) { const s = dv.getUint32(stss.body + 8 + e * 4) - 1; if (s < count) sync[s] = 1; }
  }

  // Смещения кадров по кускам (chunks) и описаниям (stsd).
  const chunkCount = dv.getUint32((stco || co64).body + 4);
  const chunkOff = (c) => (stco ? dv.getUint32(stco.body + 8 + c * 4) : u64(dv, co64.body + 8 + c * 8));
  const offset = new Float64Array(count);
  const sdi = new Uint32Array(count);
  {
    const n = dv.getUint32(stsc.body + 4);
    const ent = [];
    for (let e = 0; e < n; e++) {
      const o = stsc.body + 8 + e * 12;
      ent.push({ first: dv.getUint32(o) - 1, spc: dv.getUint32(o + 4), sdi: dv.getUint32(o + 8) });
    }
    let k = 0;
    for (let e = 0; e < ent.length; e++) {
      const last = e + 1 < ent.length ? ent[e + 1].first : chunkCount;
      for (let c = ent[e].first; c < last && k < count; c++) {
        let o = chunkOff(c);
        for (let j = 0; j < ent[e].spc && k < count; j++, k++) { offset[k] = o; sdi[k] = ent[e].sdi; o += size[k]; }
      }
    }
    if (k < count) throw unsupported('неполная таблица кусков');
  }

  return { trak, tkhd, mdia, mdhd, minf, stbl, handler, timescale, mediaTime, count, size, dur, dts, cts, cttsVersion, hasCtts: !!ctts, sync, hasStss: !!stss, offset, sdi };
}

// ── Запись блоков ──
function box(type, ...parts) {
  const len = parts.reduce((s, p) => s + p.length, 8);
  const out = new Uint8Array(len);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function words(list, { version = 0 } = {}) {
  const out = new Uint8Array(4 + list.length * 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, version << 24);
  list.forEach((v, i) => (v < 0 ? dv.setInt32(4 + i * 4, v) : dv.setUint32(4 + i * 4, v)));
  return out;
}
const raw = (dv, b) => new Uint8Array(dv.buffer, dv.byteOffset + b.start, b.end - b.start);

// Поменять длительность в mvhd/tkhd/mdhd (поле после времени создания и изменения).
function withDuration(dv, b, durField0, durField1, value) {
  const src = raw(dv, b);
  const out = src.slice();
  const odv = new DataView(out.buffer);
  const v = out[b.body - b.start];
  const at = (b.body - b.start) + (v === 1 ? durField1 : durField0);
  if (v === 1) { odv.setUint32(at, Math.floor(value / 2 ** 32)); odv.setUint32(at + 4, value >>> 0); }
  else odv.setUint32(at, Math.min(value, 0xffffffff));
  return out;
}

function runLength(values, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = values(i);
    if (out.length && out[out.length - 2 + 1] === v) out[out.length - 2] += 1; else out.push(1, v);
  }
  return out;
}

function buildStbl(dv, t, sel, chunkOffsets, big) {
  const n = sel.length;
  const parts = [];
  for (const b of boxes(dv, t.stbl.body, t.stbl.end)) {
    if (b.type === 'stsd') parts.push(raw(dv, b));
  }
  const stts = runLength((i) => t.dur[sel[i]], n);
  parts.push(box('stts', words([stts.length / 2, ...stts])));
  if (t.hasCtts) {
    const c = runLength((i) => t.cts[sel[i]], n);
    parts.push(box('ctts', words([c.length / 2, ...c], { version: t.cttsVersion === 1 ? 1 : 0 })));
  }
  if (t.hasStss) {
    const s = [];
    for (let i = 0; i < n; i++) if (t.sync[sel[i]]) s.push(i + 1);
    parts.push(box('stss', words([s.length, ...s])));
  }
  // Каждый кадр — отдельный кусок; записи stsc меняются только при смене описания.
  const stsc = [];
  for (let i = 0; i < n; i++) {
    const d = t.sdi[sel[i]];
    if (!stsc.length || stsc[stsc.length - 1] !== d) stsc.push(i + 1, 1, d);
  }
  parts.push(box('stsc', words([stsc.length / 3, ...stsc])));
  parts.push(box('stsz', words([0, n, ...Array.from(sel, (k) => t.size[k])])));
  if (big) {
    const out = new Uint8Array(8 + n * 8);
    const odv = new DataView(out.buffer);
    odv.setUint32(4, n);
    chunkOffsets.forEach((o, i) => { odv.setUint32(8 + i * 8, Math.floor(o / 2 ** 32)); odv.setUint32(12 + i * 8, o >>> 0); });
    parts.push(box('co64', out));
  } else {
    parts.push(box('stco', words([n, ...chunkOffsets])));
  }
  return box('stbl', ...parts);
}

function elstBox(segment, mediaTime) {
  const v1 = segment > 0xffffffff || mediaTime > 0x7fffffff;
  if (v1) {
    const out = new Uint8Array(8 + 20);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 1 << 24); dv.setUint32(4, 1);
    dv.setUint32(8, Math.floor(segment / 2 ** 32)); dv.setUint32(12, segment >>> 0);
    dv.setUint32(16, Math.floor(mediaTime / 2 ** 32)); dv.setUint32(20, mediaTime >>> 0);
    dv.setUint32(24, 0x00010000);
    return box('edts', box('elst', out));
  }
  return box('edts', box('elst', words([1, segment, mediaTime, 0x00010000])));
}

// Выбрать кадры дорожки для отрезка [S, E) секунд. Возвращает номера кадров и сдвиг правки.
function select(t, S, E, isVideo) {
  const Sx = Math.round(S * t.timescale);
  const Ex = Math.round(E * t.timescale);
  const pts = (i) => t.dts[i] + t.cts[i] - t.mediaTime;
  let start = 0;
  let end = 0;
  if (isVideo) {
    for (let i = 0; i < t.count; i++) {
      if (t.sync[i] && pts(i) <= Sx) start = i;
      if (pts(i) < Ex) end = i + 1;
    }
  } else {
    start = t.count;
    for (let i = 0; i < t.count; i++) {
      if (start === t.count && pts(i) + t.dur[i] > Sx) start = i;
      if (pts(i) < Ex) end = i + 1;
    }
    start = Math.max(0, start - 2); // пара кадров звука до начала — для правильного декодирования, их не слышно
  }
  if (end <= start) return null;
  const sel = new Uint32Array(end - start);
  for (let i = 0; i < sel.length; i++) sel[i] = start + i;
  const mediaTime = Math.max(0, Sx + t.mediaTime - t.dts[start]);
  return { sel, mediaTime };
}

export async function canTrim(blob) {
  try {
    const top = await topLevel(blob);
    return top.some((b) => b.type === 'moov') && !top.some((b) => b.type === 'moof');
  } catch {
    return false;
  }
}

// blob — видео, start/end — секунды. Возвращает новое видео того же типа.
export async function trimMp4(blob, start, end) {
  const top = await topLevel(blob);
  if (top.some((b) => b.type === 'moof')) throw unsupported('фрагментированный файл');
  const moovRef = top.find((b) => b.type === 'moov');
  const ftypRef = top.find((b) => b.type === 'ftyp');
  if (!moovRef) throw unsupported('нет оглавления');
  const moovBuf = await blob.slice(moovRef.start, moovRef.end).arrayBuffer();
  const dv = new DataView(moovBuf);
  const moov = { type: 'moov', start: 0, body: 8, end: moovBuf.byteLength };
  if (dv.getUint32(0) === 1) moov.body = 16;
  if (child(dv, moov, 'mvex')) throw unsupported('фрагментированный файл');
  const mvhd = child(dv, moov, 'mvhd');
  if (!mvhd) throw unsupported('нет mvhd');
  const movieTs = dv.getUint32(mvhd.body + (dv.getUint8(mvhd.body) === 1 ? 20 : 12));

  const tracks = [];
  for (const b of boxes(dv, moov.body, moov.end)) {
    if (b.type !== 'trak') continue;
    const t = readTrack(dv, b);
    if (KEEP_TRACKS.has(t.handler) && t.count) tracks.push(t);
  }
  const video = tracks.find((t) => t.handler === 'vide');
  if (!video) throw unsupported('нет видеодорожки');
  const total = video.dts[video.count - 1] / video.timescale + video.dur[video.count - 1] / video.timescale;
  const S = Math.max(0, start);
  const E = Math.min(end, total);
  if (E - S < 0.05) throw new Error('Слишком короткий отрезок');

  const picked = [];
  for (const t of tracks) {
    const s = select(t, S, E, t === video);
    if (s) picked.push({ t, ...s });
  }

  // Порядок кадров в новом файле — вперемешку по времени, как в обычных видео.
  const order = [];
  for (const p of picked) for (let i = 0; i < p.sel.length; i++) order.push({ p, i, time: p.t.dts[p.sel[i]] / p.t.timescale });
  order.sort((a, b) => a.time - b.time);
  let dataSize = 0;
  for (const o of order) dataSize += o.p.t.size[o.p.sel[o.i]];

  const segment = Math.round((E - S) * movieTs);
  const build = (base, big) => {
    let pos = base;
    for (const p of picked) p.offsets = new Array(p.sel.length);
    for (const o of order) { o.p.offsets[o.i] = pos; pos += o.p.t.size[o.p.sel[o.i]]; }
    const traks = picked.map((p) => {
      const t = p.t;
      const mdhdDur = p.sel.reduce((s, k) => s + t.dur[k], 0);
      const minfParts = [];
      for (const b of boxes(dv, t.minf.body, t.minf.end)) {
        if (b.type === 'stbl') minfParts.push(buildStbl(dv, t, p.sel, p.offsets, big));
        else minfParts.push(raw(dv, b));
      }
      const mdiaParts = [];
      for (const b of boxes(dv, t.mdia.body, t.mdia.end)) {
        if (b.type === 'mdhd') mdiaParts.push(withDuration(dv, b, 16, 24, mdhdDur));
        else if (b.type === 'minf') mdiaParts.push(box('minf', ...minfParts));
        else mdiaParts.push(raw(dv, b));
      }
      const trakParts = [];
      for (const b of boxes(dv, t.trak.body, t.trak.end)) {
        if (b.type === 'tkhd') { trakParts.push(withDuration(dv, b, 20, 28, segment)); trakParts.push(elstBox(segment, p.mediaTime)); }
        else if (b.type === 'mdia') trakParts.push(box('mdia', ...mdiaParts));
        else if (b.type !== 'edts' && b.type !== 'tref') trakParts.push(raw(dv, b));
      }
      return box('trak', ...trakParts);
    });
    const moovParts = [];
    let tracksPlaced = false;
    for (const b of boxes(dv, moov.body, moov.end)) {
      if (b.type === 'mvhd') moovParts.push(withDuration(dv, b, 16, 24, segment));
      else if (b.type === 'trak') { if (!tracksPlaced) { moovParts.push(...traks); tracksPlaced = true; } }
      else if (b.type !== 'mvex') moovParts.push(raw(dv, b));
    }
    return box('moov', ...moovParts);
  };

  const ftyp = ftypRef ? new Uint8Array(await blob.slice(ftypRef.start, ftypRef.end).arrayBuffer()) : new Uint8Array(0);
  const bigMdat = dataSize + 8 > 0xffffffff;
  const mdatHdrLen = bigMdat ? 16 : 8;
  // Сначала считаем размер оглавления, затем пишем его с настоящими смещениями (размер от этого не меняется).
  const probe = build(0, false);
  let big = ftyp.length + probe.length + mdatHdrLen + dataSize > 0xffffffff;
  const sizeGuess = big ? build(0, true).length : probe.length;
  const base = ftyp.length + sizeGuess + mdatHdrLen;
  const moovOut = build(base, big);

  const mdatHdr = new Uint8Array(mdatHdrLen);
  const hdv = new DataView(mdatHdr.buffer);
  if (bigMdat) {
    hdv.setUint32(0, 1); mdatHdr.set([0x6d, 0x64, 0x61, 0x74], 4);
    const n = dataSize + 16;
    hdv.setUint32(8, Math.floor(n / 2 ** 32)); hdv.setUint32(12, n >>> 0);
  } else {
    hdv.setUint32(0, dataSize + 8); mdatHdr.set([0x6d, 0x64, 0x61, 0x74], 4);
  }

  // Кадры не копируются в память: новый файл ссылается на куски исходного (соседние куски склеиваются).
  const parts = [ftyp, moovOut, mdatHdr];
  let runStart = -1;
  let runEnd = -1;
  for (const o of order) {
    const k = o.p.sel[o.i];
    const a = o.p.t.offset[k];
    const b = a + o.p.t.size[k];
    if (a === runEnd) runEnd = b;
    else { if (runStart >= 0) parts.push(blob.slice(runStart, runEnd)); runStart = a; runEnd = b; }
  }
  if (runStart >= 0) parts.push(blob.slice(runStart, runEnd));
  return new Blob(parts, { type: blob.type || 'video/mp4' });
}
