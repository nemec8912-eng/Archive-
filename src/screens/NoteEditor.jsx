import React, { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar } from '../components/Common.jsx';
import { useStore } from '../store.jsx';
import { useNav, useUi } from '../ui.jsx';
import { useActions } from '../actions.js';
import { useBlobUrl } from '../lib/hooks.js';
import { saveBlob, deleteBlobs, uid } from '../lib/db.js';
import { imageInfo, audioInfo } from '../lib/media.js';
import { stamp } from '../lib/format.js';
import { VoiceBubble } from './ChatView.jsx';
import { haptic } from '../lib/haptics.js';

function PhotoAttachment({ a, onRemove }) {
  const url = useBlobUrl(a.thumbId || a.blobId, { cache: true });
  return (
    <div className="att-photo">
      {url && <img src={url} alt="" />}
      <button className="att-remove" onClick={onRemove} aria-label="Убрать"><Icon name="close" size={14} /></button>
    </div>
  );
}

// Создание и редактирование заметки (ТЗ, п. 11).
export default function NoteEditor({ route }) {
  const store = useStore();
  const nav = useNav();
  const ui = useUi();
  const act = useActions();
  const existing = route.id ? store.byId[route.id] : null;

  const [text, setText] = useState(existing?.text || '');
  const [attachments, setAttachments] = useState(existing?.attachments || []);
  const [folderId, setFolderId] = useState(
    existing ? existing.folderId : store.folders.find((f) => f.name === 'Заметки' && !f.hidden)?.id || null
  );
  const [dirty, setDirty] = useState(false);
  const added = useRef([]); // файлы, добавленные в этом сеансе
  const removed = useRef([]); // файлы, убранные из заметки
  const photoInput = useRef();
  const folder = store.folderById(folderId);

  const change = (fn) => { fn(); setDirty(true); };

  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    for (const f of files) {
      const blobId = await saveBlob(f);
      const info = await imageInfo(f);
      const thumbId = info.thumb ? await saveBlob(info.thumb) : null;
      added.current.push(blobId, thumbId);
      change(() => setAttachments((l) => [...l, { id: uid(), kind: 'photo', blobId, thumbId, mime: f.type, size: f.size }]));
    }
  };

  const addVoice = () =>
    ui.open({
      type: 'recorder',
      onDone: async (blob, duration) => {
        const blobId = await saveBlob(blob);
        const info = await audioInfo(blob, duration);
        added.current.push(blobId);
        change(() =>
          setAttachments((l) => [...l, { id: uid(), kind: 'voice', blobId, mime: blob.type, size: blob.size, duration: info.duration || duration, waveform: info.waveform }])
        );
      },
    });

  const removeAtt = (a) => change(() => {
    removed.current.push(a.blobId, a.thumbId);
    setAttachments((l) => l.filter((x) => x.id !== a.id));
  });

  const save = () => {
    const firstLine = text.trim().split('\n')[0].slice(0, 60);
    const size = new Blob([text]).size + attachments.reduce((s, a) => s + (a.size || 0), 0);
    if (existing) {
      store.updateItem(existing.id, { text, attachments, folderId, size, name: existing.demo || !existing.name ? firstLine || existing.name : existing.name });
    } else {
      store.addItems([{
        id: uid(),
        type: 'note',
        name: firstLine || `Заметка_${stamp()}`,
        text,
        attachments,
        folderId,
        size,
        createdAt: Date.now(),
        favorite: false,
        deletedAt: null,
      }]);
    }
    deleteBlobs(removed.current).catch(() => {});
    added.current = [];
    removed.current = [];
    setDirty(false);
    haptic('success');
    ui.showToast('Заметка сохранена');
    nav.back();
  };

  const leave = () => {
    if (!dirty) { nav.back(); return; }
    ui.confirm({
      title: 'Выйти без сохранения?',
      text: 'Изменения в заметке будут потеряны.',
      okText: 'Выйти',
      onOk: () => {
        deleteBlobs(added.current).catch(() => {});
        nav.back();
      },
    });
  };

  // Жест «назад» тоже спрашивает, если есть несохранённые изменения.
  useEffect(() => {
    nav.setGuard(dirty ? leave : null);
    return () => nav.setGuard(null);
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSave = text.trim() || attachments.length;

  return (
    <div className="screen note-screen">
      <TopBar
        title={existing ? 'Заметка' : 'Новая заметка'}
        left={<button className="icon-btn" onClick={leave} aria-label="Назад"><Icon name="back" size={24} /></button>}
        right={<button className="link-btn" onClick={save} disabled={!canSave}>Сохранить</button>}
      />
      <textarea
        className="note-input"
        placeholder="Введите текст заметки…"
        value={text}
        onChange={(e) => change(() => setText(e.target.value))}
        autoFocus={!existing}
      />

      {attachments.length > 0 && (
        <div className="attachments">
          <div className="att-photos">
            {attachments.filter((a) => a.kind === 'photo').map((a) => <PhotoAttachment key={a.id} a={a} onRemove={() => removeAtt(a)} />)}
          </div>
          {attachments.filter((a) => a.kind === 'voice').map((a) => (
            <div key={a.id} className="att-voice">
              <VoiceBubble blobId={a.blobId} duration={a.duration} waveform={a.waveform} />
              <button className="icon-btn" onClick={() => removeAtt(a)} aria-label="Убрать"><Icon name="close" size={18} /></button>
            </div>
          ))}
        </div>
      )}

      <div className="menu-list card">
        <button className="menu-item" onClick={() => photoInput.current.click()}>
          <span className="mi-icon accent-bg"><Icon name="camera" size={20} /></span>
          <span className="mi-label">Добавить фото</span>
          <Icon name="chevron" size={18} className="muted" />
        </button>
        <button className="menu-item" onClick={addVoice}>
          <span className="mi-icon accent-bg"><Icon name="mic" size={20} /></span>
          <span className="mi-label">Добавить голосовое</span>
          <Icon name="chevron" size={18} className="muted" />
        </button>
        <button className="menu-item" onClick={() => ui.pickFolder({ title: 'Папка заметки', onPick: (id) => change(() => setFolderId(id)) })}>
          <span className="mi-icon accent-bg"><Icon name="folder" size={20} /></span>
          <span className="mi-label">Выбрать папку</span>
          <span className="mi-value">{folder?.name || 'Без папки'}</span>
          <Icon name="chevron" size={18} className="muted" />
        </button>
      </div>

      {existing && (
        <div className="note-actions">
          <button className="text-btn" onClick={() => act.menu(existing, { inViewer: true, onDeleted: () => nav.back() })}>
            <Icon name="more" size={18} /> Действия с заметкой
          </button>
        </div>
      )}
      <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
    </div>
  );
}
