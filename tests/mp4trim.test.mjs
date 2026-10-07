import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trimMp4, canTrim } from '../src/lib/mp4trim.js';

const fixture = (name, type) => new Blob([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], { type });

// Длительность и дорожки нового файла — из его оглавления.
async function describe(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const out = { tracks: 0 };
  const walk = (s, e) => {
    for (let o = s; o + 8 <= e;) {
      const size = dv.getUint32(o);
      const type = String.fromCharCode(...buf.subarray(o + 4, o + 8));
      if (type === 'moov' || type === 'trak') walk(o + 8, o + size);
      if (type === 'trak') out.tracks += 1;
      if (type === 'mvhd') out.duration = dv.getUint32(o + 24) / dv.getUint32(o + 20);
      o += size;
    }
  };
  walk(0, buf.length);
  return out;
}

let ffmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); ffmpeg = true; } catch { /* нет ffmpeg — проверяем без декодирования */ }

for (const [name, type] of [['bframes.mp4', 'video/mp4'], ['hevc.mov', 'video/quicktime']]) {
  test(`обрезка без перекодирования: ${name}`, async () => {
    const src = fixture(name, type);
    assert.equal(await canTrim(src), true);
    const out = await trimMp4(src, 1.1, 2.9);
    assert.equal(out.type, type);
    assert.ok(out.size < src.size);
    const d = await describe(out);
    assert.equal(d.tracks, 2);
    assert.ok(Math.abs(d.duration - 1.8) < 0.01, `длительность ${d.duration}`);
    // результат снова можно обрезать
    const again = await trimMp4(out, 0.5, 1.0);
    assert.ok(Math.abs((await describe(again)).duration - 0.5) < 0.01);
    if (ffmpeg) {
      const dir = mkdtempSync(join(tmpdir(), 'trim-'));
      const file = join(dir, name);
      writeFileSync(file, Buffer.from(await out.arrayBuffer()));
      execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
      const frames = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString().trim();
      assert.equal(+frames, 54); // 1,8 с × 30 кадров
    }
  });
}

test('конец за пределами видео — обрезается до конца', async () => {
  const out = await trimMp4(fixture('bframes.mp4', 'video/mp4'), 3, 99);
  assert.ok(Math.abs((await describe(out)).duration - 1) < 0.05);
});

test('фрагментированное видео не обрезается этим способом', async () => {
  const src = fixture('fragmented.mp4', 'video/mp4');
  assert.equal(await canTrim(src), false);
  await assert.rejects(trimMp4(src, 0.5, 1.5), (e) => e.code === 'unsupported');
});
