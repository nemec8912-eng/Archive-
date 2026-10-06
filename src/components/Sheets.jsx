import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Peek from './Peek.jsx';
import { Thumb, TypeIcon } from './Common.jsx';
import { useUi, useNav } from '../ui.jsx';
import { useStore } from '../store.jsx';
import { usePrefs } from '../prefs.jsx';
import { haptic } from '../lib/haptics.js';
import { importFile, audioExt, audioInfo, imageInfo } from '../lib/media.js';
import { parseChatFile, buildChatItem } from '../lib/chatImport.js';
import { saveBlob, uid } from '../lib/db.js';
import { fmtDur, fmtSize, fmtDate, filesWord, stamp } from '../lib/format.js';

function Sheet({ title, onClose, children, className = '' }) {
  return (
    <div className="sheet-layer" onClick={onClose}>
      <div className={`sheet ${className}`} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="sheet-grip" />
        {title && (
          <div className="sheet-head">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><Icon name="close" size={20} /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

function MenuList({ items, onPick }) {
  return (
    <div className="menu-list">
      {items.map((a) => (
        <button key={a.label} className={`menu-item ${a.danger ? 'danger' : ''}`} onClick={() => onPick(a)}>
          <span className="mi-icon"><Icon name={a.icon} size={21} /></span>
          <span className="mi-label">{a.label}</span>
          {a.value && <span className="mi-value">{a.value}</span>}
        </button>
      ))}
    </div>
  );
}

export function Recorder({ onDone, onCancel }) {
  const [state, setState] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const rec = useRef(null);
  const chunks = useRef([]);
  const started = useRef(0);
  const timer = useRef();
  const stream = useRef(null);

  const stopTracks = () => stream.current?.getTracks().forEach((t) => t.stop());
  useEffect(() => () => { clearInterval(timer.current); stopTracks(); }, []);

  const start = async () => {
    setError('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
        .find((m) => window.MediaRecorder?.isTypeSupported?.(m));
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        stopTracks();
        const type = r.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunks.current, { type });
        onDone(blob, (Date.now() - started.current) / 1000);
      };
      rec.current = r;
      r.start();
      haptic('medium');
      started.current = Date.now();
      setState('rec');
      timer.current = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 200);
    } catch {
      setError('Нет доступа к микрофону. Разрешите доступ в настройках телефона.');
    }
  };

  const stop = () => {
    haptic('medium');
    clearInterval(timer.current);
    setState('saving');
    rec.current?.stop();
  };

  return (
    <Sheet title="Голосовая запись" onClose={state === 'rec' ? undefined : onCancel}>
      <div className="recorder">
        <div className={`rec-time ${state === 'rec' ? 'live' : ''}`}>
          {state === 'rec' && <i className="rec-dot" />}
          {fmtDur(elapsed)}
        </div>
        <p className="muted">{state === 'idle' ? 'Нажмите, чтобы начать запись' : state === 'rec' ? 'Идёт запись…' : 'Сохранение…'}</p>
        {error && <p className="error-text">{error}</p>}
        <button
          className={`rec-btn ${state === 'rec' ? 'on' : ''}`}
          onClick={state === 'idle' ? start : state === 'rec' ? stop : undefined}
          aria-label={state === 'rec' ? 'Остановить' : 'Записать'}
        >
          <Icon name={state === 'rec' ? 'stop' : 'mic'} size={34} />
        </button>
        {state !== 'rec' && <button className="text-btn" onClick={onCancel}>Отмена</button>}
      </div>
    </Sheet>
  );
}

function FolderPicker({ title, onPick, onClose }) {
  const store = useStore();
  const ui = useUi();
  const folders = store.folders.filter((f) => !f.hidden);
  const pick = (id) => { onClose(); onPick(id); };
  return (
    <Sheet title={title || 'Выберите папку'} onClose={onClose}>
      <div className="menu-list scroll">
        <button className="menu-item" onClick={() => pick(null)}>
          <span className="mi-icon"><Icon name="close" size={20} /></span>
          <span className="mi-label">Без папки</span>
        </button>
        {folders.map((f) => (
          <button key={f.id} className="menu-item" onClick={() => pick(f.id)}>
            <span className="mi-icon accent"><Icon name="folderFill" size={22} /></span>
            <span className="mi-label">{f.name}</span>
          </button>
        ))}
        <button
          className="menu-item"
          onClick={() =>
            ui.prompt({
              title: 'Новая папка',
              placeholder: 'Название папки',
              okText: 'Создать',
              onOk: (name) => {
                if (!name.trim()) return;
                const id = store.createFolder(name.trim());
                onPick(id);
              },
            })
          }
        >
          <span className="mi-icon"><Icon name="folderPlus" size={21} /></span>
          <span className="mi-label">Создать папку</span>
        </button>
      </div>
    </Sheet>
  );
}

function Confirm({ title, text, okText = 'Удалить', danger = true, onOk, onClose }) {
  return (
    <div className="dialog-layer" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="alertdialog">
        <h3>{title}</h3>
        {text && <p>{text}</p>}
        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => { haptic(danger ? 'warning' : 'light'); onClose(); onOk(); }}>{okText}</button>
        </div>
      </div>
    </div>
  );
}

function Prompt({ title, value = '', placeholder, okText = 'Готово', onOk, onClose, multiline = false, allowEmpty = false, maxLength = 120 }) {
  const [v, setV] = useState(value);
  const ref = useRef();
  useEffect(() => {
    const t = setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 60);
    return () => clearTimeout(t);
  }, []);
  const submit = (e) => { e.preventDefault(); onClose(); onOk(v); };
  return (
    <div className="dialog-layer" onClick={onClose}>
      <form className="dialog" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        {multiline ? (
          <textarea ref={ref} className="field area" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} maxLength={maxLength} rows={4} />
        ) : (
          <input ref={ref} className="field" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} maxLength={maxLength} />
        )}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn primary" disabled={!allowEmpty && !v.trim()}>{okText}</button>
        </div>
      </form>
    </div>
  );
}

function ItemHeader({ item }) {
  return (
    <div className="sheet-item">
      <div className="row-thumb">
        {item.thumbId ? <Thumb item={item} /> : <div className="row-icon"><TypeIcon type={item.type} /></div>}
      </div>
      <div className="row-text">
        <b>{item.name}</b>
        <span>{[item.size ? fmtSize(item.size) : null, fmtDate(item.createdAt)].filter(Boolean).join(' • ')}</span>
      </div>
    </div>
  );
}

function Help({ onClose }) {
  const prefs = usePrefs();
  return (
    <Sheet title="Помощь и поддержка" onClose={onClose}>
      <div className="help-text">
        <p><b>Где хранятся материалы?</b> Только на этом устройстве, внутри приложения. Никуда не отправляются и не публикуются.</p>
        <p><b>Добавление.</b> Кнопка «+» внизу экрана: фото, видео, голосовые, заметки, скриншоты, папки.</p>
        <p><b>Действия.</b> Удерживайте материал, чтобы открыть меню: переименовать, переместить, копировать, в избранное, поделиться, удалить.</p>
        <p><b>Удаление.</b> Удалённое попадает в Корзину (Папки → Корзина). Оттуда можно восстановить или удалить навсегда.</p>
        <p><b>Сохранность.</b> Регулярно делайте резервную копию: Настройки → Резервное копирование. Если удалить приложение или очистить данные браузера, материалы будут потеряны.</p>
      </div>
      <button className="btn ghost help-tips" onClick={() => { prefs.resetTips(); onClose(); }}>
        <Icon name="info" size={18} />Показать подсказки снова
      </button>
    </Sheet>
  );
}

// Все всплывающие окна и меню приложения + скрытые поля выбора файлов.
export function SheetHost() {
  const ui = useUi();
  const nav = useNav();
  const store = useStore();
  const inputs = { photo: useRef(), video: useRef(), cameraPhoto: useRef(), cameraVideo: useRef(), screenshot: useRef(), chat: useRef() };
  const s = ui.sheet;
  const close = ui.close;

  const runImport = async (files, type) => {
    ui.pickFolder({
      title: 'Куда сохранить?',
      onPick: async (folderId) => {
        const list = [];
        for (let i = 0; i < files.length; i++) {
          ui.showToast(`Добавление… ${i + 1} из ${files.length}`, null, 0);
          try {
            list.push(await importFile(files[i], type, folderId));
          } catch {
            /* файл пропускается */
          }
        }
        // Распознанные скриншоты из папки «Фото» переносим в папку «Скриншоты», если она есть.
        const shots = list.filter((it) => it.type === 'screenshot' && type === 'photo');
        const photoFolder = store.folderById(folderId);
        const shotFolder = store.folders.find((f) => f.name === 'Скриншоты' && !f.hidden);
        if (shots.length && photoFolder?.name === 'Фото' && shotFolder) shots.forEach((it) => { it.folderId = shotFolder.id; });
        store.addItems(list);
        haptic(list.length ? 'success' : 'error');
        ui.showToast(
          !list.length ? 'Не удалось добавить файл'
            : shots.length ? `Добавлено: ${filesWord(list.length)}, скриншотов: ${shots.length}`
              : `Добавлено: ${filesWord(list.length)}`
        );
      },
    });
  };

  // Импорт переписки: разбор файла, выбор «кто вы», выбор папки.
  const onChatFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    ui.showToast('Чтение переписки…', null, 0);
    let parsed;
    try {
      parsed = await parseChatFile(file);
    } catch (err) {
      haptic('error');
      ui.showToast(err?.message || 'Не удалось прочитать файл переписки', null, 4500);
      return;
    }
    ui.hideToast();
    const finish = (me) =>
      ui.pickFolder({
        title: 'Куда сохранить переписку?',
        onPick: async (folderId) => {
          try {
            const item = await buildChatItem(parsed, me, folderId, {
              saveBlob, imageInfo, audioInfo, uid,
              onProgress: (i, n) => ui.showToast(`Импорт… ${Math.round((i / n) * 100)}%`, null, 0),
            });
            store.addItems([item]);
            haptic('success');
            ui.showToast(`Переписка сохранена: ${item.messages.length} сообщ.`);
          } catch {
            haptic('error');
            ui.showToast('Не удалось сохранить переписку');
          }
        },
      });
    if (parsed.participants.length <= 1) { finish(null); return; }
    ui.open({
      type: 'menu',
      title: 'Кто из участников — вы?',
      actions: [
        ...parsed.participants.slice(0, 12).map((name) => ({ icon: 'chat', label: name, run: () => finish(name) })),
        { icon: 'close', label: 'Не указывать', run: () => finish(null) },
      ],
    });
  };

  const onFiles = (type) => (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length) runImport(files, type);
  };

  const saveVoice = (blob, duration) => {
    ui.pickFolder({
      title: 'Куда сохранить?',
      onPick: async (folderId) => {
        const now = Date.now();
        const info = await audioInfo(blob, duration);
        const item = {
          id: uid(),
          type: 'voice',
          name: `Голосовая_${stamp(now)}.${audioExt(blob.type)}`,
          folderId: folderId || null,
          createdAt: now,
          size: blob.size,
          mime: blob.type,
          blobId: await saveBlob(blob),
          duration: info.duration || duration,
          waveform: info.waveform,
          favorite: false,
          deletedAt: null,
        };
        store.addItems([item]);
        haptic('success');
        ui.showToast('Голосовое сохранено');
      },
    });
  };

  const addActions = [
    { icon: 'image', label: 'Фото из галереи', run: () => inputs.photo.current.click() },
    { icon: 'video', label: 'Видео из галереи', run: () => inputs.video.current.click() },
    { icon: 'camera', label: 'Сделать фото', run: () => inputs.cameraPhoto.current.click() },
    { icon: 'videoCam', label: 'Сделать видео', run: () => inputs.cameraVideo.current.click() },
    { icon: 'mic', label: 'Записать голосовое', run: () => ui.open({ type: 'recorder', onDone: saveVoice }) },
    { icon: 'note', label: 'Создать заметку', run: () => nav.push({ name: 'note', id: null }) },
    { icon: 'phone', label: 'Импортировать скриншот', run: () => inputs.screenshot.current.click() },
    { icon: 'chat', label: 'Импортировать переписку', run: () => inputs.chat.current.click() },
    {
      icon: 'folderPlus',
      label: 'Создать папку',
      run: () =>
        ui.prompt({
          title: 'Новая папка',
          placeholder: 'Название папки',
          okText: 'Создать',
          onOk: (name) => {
            if (!name.trim()) return;
            store.createFolder(name.trim());
            ui.showToast('Папка создана');
          },
        }),
    },
  ];

  let content = null;
  if (s?.type === 'add') {
    content = (
      <Sheet title="Добавить" onClose={close}>
        <MenuList items={addActions} onPick={(a) => { close(); a.run(); }} />
      </Sheet>
    );
  } else if (s?.type === 'actions' || s?.type === 'menu') {
    content = (
      <Sheet title={s.title} onClose={close} className="actions-sheet">
        {s.item && <ItemHeader item={s.item} />}
        <MenuList items={s.actions} onPick={(a) => { close(); a.run(); }} />
      </Sheet>
    );
  } else if (s?.type === 'peek') {
    content = (
      <Peek
        item={store.byId[s.item.id] || s.item}
        actions={s.actions}
        onOpen={() => { close(); s.onOpen(); }}
        onPick={(a) => { close(); a.run(); }}
        onClose={close}
      />
    );
  } else if (s?.type === 'folderPicker') {
    content = <FolderPicker title={s.title} onPick={s.onPick} onClose={close} />;
  } else if (s?.type === 'confirm') {
    content = <Confirm {...s} onClose={close} />;
  } else if (s?.type === 'prompt') {
    content = <Prompt {...s} onClose={close} />;
  } else if (s?.type === 'recorder') {
    content = <Recorder onCancel={close} onDone={(blob, dur) => { close(); s.onDone(blob, dur); }} />;
  } else if (s?.type === 'help') {
    content = <Help onClose={close} />;
  }

  return (
    <>
      {content}
      <div className="hidden-inputs" aria-hidden="true">
        <input ref={inputs.photo} type="file" accept="image/*" multiple onChange={onFiles('photo')} />
        <input ref={inputs.video} type="file" accept="video/*" multiple onChange={onFiles('video')} />
        <input ref={inputs.cameraPhoto} type="file" accept="image/*" capture="environment" onChange={onFiles('photo')} />
        <input ref={inputs.cameraVideo} type="file" accept="video/*" capture="environment" onChange={onFiles('video')} />
        <input ref={inputs.screenshot} type="file" accept="image/*" multiple onChange={onFiles('screenshot')} />
        <input ref={inputs.chat} type="file" accept=".txt,.zip,.json,.html,.htm,text/plain,application/zip,application/json,text/html" onChange={onChatFile} />
      </div>
    </>
  );
}

export function Toast() {
  const ui = useUi();
  const t = ui.toast;
  if (!t) return null;
  return (
    <div className="toast" key={t.key}>
      <span>{t.text}</span>
      {t.action && (
        <button onClick={() => { t.action.run(); ui.hideToast(); }}>{t.action.label}</button>
      )}
    </div>
  );
}
