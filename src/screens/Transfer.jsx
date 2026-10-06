import React, { useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar, Toggle } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useNav, useUi } from '../ui.jsx';
import { getBlob, saveBlob, blobIdsOf } from '../lib/db.js';
import { packBox, openBox, isBox } from '../lib/cryptoBox.js';
import { offerFile } from '../lib/media.js';
import { fmtSize, filesWord, fmtDate, fmtDay } from '../lib/format.js';
import { haptic } from '../lib/haptics.js';

const MIN_PASS = 6;

function PasswordFields({ value, onChange, confirm, id }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pass-fields">
      <label className="pass-field">
        <input
          id={`${id}-1`}
          className="field"
          type={show ? 'text' : 'password'}
          placeholder="Пароль для файла"
          autoComplete="new-password"
          value={value.a}
          onChange={(e) => onChange({ ...value, a: e.target.value })}
        />
        <button type="button" className="pass-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}>
          <Icon name={show ? 'eyeOff' : 'eye'} size={20} />
        </button>
      </label>
      {confirm && (
        <input
          id={`${id}-2`}
          className="field"
          type={show ? 'text' : 'password'}
          placeholder="Повторите пароль"
          autoComplete="new-password"
          value={value.b}
          onChange={(e) => onChange({ ...value, b: e.target.value })}
        />
      )}
    </div>
  );
}

// Экспорт выбранных папок в один зашифрованный файл.
export function ExportFolders() {
  const store = useStore();
  const ui = useUi();
  const nav = useNav();
  const [sel, setSel] = useState(() => new Set());
  const [pass, setPass] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState('');

  const live = store.items.filter((i) => !i.deletedAt);
  const stat = (fid) => {
    const l = live.filter((i) => i.folderId === fid);
    return { count: l.length, size: l.reduce((s, i) => s + (i.size || 0), 0) };
  };
  const chosen = store.folders.filter((f) => sel.has(f.id));
  const items = live.filter((i) => sel.has(i.folderId));
  const total = items.reduce((s, i) => s + (i.size || 0), 0);
  const passOk = pass.a.length >= MIN_PASS && pass.a === pass.b;
  const passHint = !pass.a ? `Не короче ${MIN_PASS} символов. Без пароля файл не открыть — запишите его.`
    : pass.a.length < MIN_PASS ? `Пароль короче ${MIN_PASS} символов`
      : pass.b && pass.a !== pass.b ? 'Пароли не совпадают' : 'Без пароля файл не открыть — запишите его.';

  const toggle = (id) => { haptic('selection'); setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };

  const run = async () => {
    setBusy('Шифрование…');
    try {
      const ids = [...new Set(items.flatMap(blobIdsOf))];
      const blobs = [];
      for (const id of ids) {
        const b = await getBlob(id);
        if (b) blobs.push({ id, blob: b });
      }
      const box = await packBox(pass.a, { magic: 'archive-folders', version: 1, createdAt: Date.now(), folders: chosen, items }, blobs,
        (n, m) => setBusy(`Шифрование… ${n} из ${m}`));
      const name = `archive-folders-${fmtDay(Date.now()).split('.').reverse().join('-')}.archivebox`;
      setBusy('');
      await offerFile(box, name);
      haptic('success');
      ui.showToast(`Файл создан: ${fmtSize(box.size)}`);
      nav.back();
    } catch {
      setBusy('');
      haptic('error');
      ui.showToast('Не удалось создать файл');
    }
  };

  return (
    <div className="screen">
      <TopBar title="Экспорт папок" />
      <p className="hint">Выбранные папки сохраняются в один файл, зашифрованный паролем. Его можно перенести на другой телефон и открыть в Архиве через «Импорт папок».</p>
      <div className="set-card">
        {store.folders.map((f) => {
          const st = stat(f.id);
          return (
            <button key={f.id} className="set-row" onClick={() => toggle(f.id)} role="checkbox" aria-checked={sel.has(f.id)}>
              <span className="set-icon"><Icon name={f.hidden ? 'hidden' : 'folderFill'} size={20} /></span>
              <span className="set-label">{f.name}<small className="row-sub">{filesWord(st.count)} • {fmtSize(st.size)}</small></span>
              <Toggle on={sel.has(f.id)} />
            </button>
          );
        })}
      </div>
      <h4 className="set-group">Пароль</h4>
      <PasswordFields id="export-pass" value={pass} onChange={setPass} confirm />
      <p className={`hint ${pass.b && !passOk ? 'error-hint' : ''}`}>{passHint}</p>
      <button className="btn primary wide" disabled={!chosen.length || !passOk || !!busy} onClick={run}>
        <Icon name="lock" size={18} />{busy || (chosen.length ? `Создать файл • ${filesWord(items.length)}, ${fmtSize(total)}` : 'Выберите папки')}
      </button>
    </div>
  );
}

// Импорт папок из зашифрованного файла: папки добавляются к архиву, ничего не заменяется.
export function ImportFolders() {
  const store = useStore();
  const ui = useUi();
  const nav = useNav();
  const input = useRef();
  const [file, setFile] = useState(null);
  const [pass, setPass] = useState({ a: '', b: '' });
  const [box, setBox] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBox(null); setError('');
    if (!(await isBox(f))) { setFile(null); setError('Это не файл экспорта Архива (.archivebox)'); return; }
    setFile(f);
  };

  const unlock = async () => {
    setBusy('Проверка пароля…'); setError('');
    try {
      setBox(await openBox(file, pass.a));
      haptic('success');
    } catch (err) {
      haptic('error');
      setError(err.code === 'password' ? 'Неверный пароль' : err.message || 'Не удалось открыть файл');
    }
    setBusy('');
  };

  const run = async () => {
    const { payload } = box;
    setBusy('Импорт…');
    try {
      const map = new Map();
      const ids = [...new Set(payload.items.flatMap(blobIdsOf))];
      for (let k = 0; k < ids.length; k++) {
        setBusy(`Импорт… ${k + 1} из ${ids.length}`);
        const b = await box.readBlob(ids[k]);
        if (b) map.set(ids[k], await saveBlob(b));
      }
      const re = (id) => (id ? map.get(id) || null : id);
      const items = payload.items.map((it) => ({
        ...it,
        blobId: re(it.blobId),
        thumbId: re(it.thumbId),
        attachments: it.attachments?.map((a) => ({ ...a, blobId: re(a.blobId), thumbId: re(a.thumbId) })),
        messages: it.messages?.map((m) => ({ ...m, blobId: re(m.blobId), thumbId: re(m.thumbId) })),
      }));
      store.importBundle(payload.folders, items);
      haptic('success');
      ui.showToast(`Добавлено папок: ${payload.folders.length}, ${filesWord(items.length)}`);
      nav.back();
    } catch {
      haptic('error');
      ui.showToast('Не удалось импортировать');
    }
    setBusy('');
  };

  const counts = {};
  box?.payload.items.forEach((i) => { counts[i.folderId] = (counts[i.folderId] || 0) + 1; });

  return (
    <div className="screen">
      <TopBar title="Импорт папок" />
      <p className="hint">Откройте файл .archivebox, созданный через «Экспорт папок». Папки добавятся к архиву, текущие материалы не изменятся.</p>
      <div className="set-card">
        <button className="set-row" onClick={() => input.current.click()} disabled={!!busy}>
          <span className="set-icon"><Icon name="upload" size={20} /></span>
          <span className="set-label">{file ? file.name : 'Выбрать файл'}{file && <small className="row-sub">{fmtSize(file.size)}</small>}</span>
          <Icon name="chevron" size={18} className="muted" />
        </button>
      </div>
      {file && !box && (
        <>
          <h4 className="set-group">Пароль файла</h4>
          <PasswordFields id="import-pass" value={pass} onChange={setPass} />
          <button className="btn primary wide gap-top" disabled={!pass.a || !!busy} onClick={unlock}>{busy || 'Открыть'}</button>
        </>
      )}
      {error && <p className="error-text gap-top">{error}</p>}
      {box && (
        <>
          <h4 className="set-group">В файле от {fmtDate(box.payload.createdAt)}</h4>
          <div className="set-card">
            {box.payload.folders.map((f) => (
              <div key={f.id} className="set-row static">
                <span className="set-icon"><Icon name="folderFill" size={20} /></span>
                <span className="set-label">{f.name}</span>
                <span className="set-value">{filesWord(counts[f.id] || 0)}</span>
              </div>
            ))}
          </div>
          <button className="btn primary wide gap-top" disabled={!!busy} onClick={run}>
            <Icon name="download" size={18} />{busy || 'Добавить в архив'}
          </button>
        </>
      )}
      <input ref={input} type="file" hidden onChange={pick} />
    </div>
  );
}
