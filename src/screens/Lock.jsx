import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar } from '../components/Common.jsx';
import { useSecurity } from '../security.jsx';
import { useNav, useUi } from '../ui.jsx';
import { haptic } from '../lib/haptics.js';

const LEN = 4;

// Перешифрование архива: экран с ходом работы, приложение в это время недоступно.
export function BusyOverlay({ busy }) {
  const pct = busy.total ? Math.round((busy.done / busy.total) * 100) : 0;
  return (
    <div className="busy-overlay" role="alertdialog" aria-live="polite">
      <span className="pin-lock"><Icon name="lock" size={26} /></span>
      <h2>{busy.text}</h2>
      <div className="storage-bar"><i style={{ width: `${pct}%` }} /></div>
      <p className="muted">{busy.total > 1 ? `${busy.done} из ${busy.total}` : ' '} Не закрывайте приложение.</p>
    </div>
  );
}

// Обложка вместо содержимого, пока приложение свёрнуто (в переключателе приложений).
export function PrivacyCover() {
  return (
    <div className="privacy-cover" aria-hidden="true">
      <span className="pin-lock"><Icon name="lock" size={30} /></span>
      <div className="lock-brand">Архив</div>
    </div>
  );
}

export function PinPad({ title, sub, error, onComplete, resetKey, extraKey }) {
  const [pin, setPin] = useState('');
  useEffect(() => { setPin(''); }, [resetKey]);
  useEffect(() => { if (error) haptic('error'); }, [error, resetKey]);
  const press = (d) => {
    if (pin.length >= LEN) return;
    haptic('selection');
    const next = pin + d;
    setPin(next);
    if (next.length === LEN) setTimeout(() => onComplete(next), 120);
  };
  return (
    <div className="pinpad">
      <div className="pin-head">
        <span className="pin-lock"><Icon name="lock" size={26} /></span>
        <h2>{title}</h2>
        <p className={error ? 'error-text' : 'muted'}>{error || sub || ' '}</p>
      </div>
      <div className={`pin-dots ${error ? 'shake' : ''}`}>
        {Array.from({ length: LEN }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      <div className="keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="key" onClick={() => press(d)}>{d}</button>
        ))}
        {extraKey || <span />}
        <button className="key" onClick={() => press('0')}>0</button>
        <button className="key ghost" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Стереть"><Icon name="backspace" size={24} /></button>
      </div>
    </div>
  );
}

// Экран блокировки — закрывает всё содержимое, пока не введён код или не пройдена биометрия.
export function LockScreen() {
  const sec = useSecurity();
  const ui = useUi();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [checking, setChecking] = useState(false);
  const bio = sec.sec.bio;

  const afterUnlock = () => {
    const fresh = sec.attempts.list.filter((a) => a.at > (sec.attempts.seenAt || 0));
    if (fresh.length) {
      setTimeout(() => ui.showToast(`С прошлого входа неверных попыток: ${fresh.length}`, { label: 'Журнал', run: () => ui.open({ type: 'attempts' }) }, 6000), 400);
    }
  };

  const tryBio = async () => {
    setError('');
    const ok = await sec.unlockBio();
    if (ok) { haptic('success'); afterUnlock(); } else setError('Не удалось подтвердить. Введите код.');
  };

  // В установленном приложении биометрия запрашивается сразу; в браузере — по кнопке.
  useEffect(() => {
    if (bio && window.Capacitor?.isNativePlatform?.()) tryBio();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="lock-screen">
      <div className="lock-brand">Архив</div>
      <PinPad
        title={checking ? 'Проверка…' : 'Введите код'}
        error={error}
        resetKey={attempt}
        extraKey={bio ? (
          <button className="key ghost" onClick={tryBio} aria-label="Войти по Face ID или отпечатку"><Icon name="faceId" size={30} /></button>
        ) : null}
        onComplete={async (pin) => {
          setChecking(true);
          const ok = await sec.unlock(pin);
          setChecking(false);
          if (!ok) { setError('Неверный код'); setAttempt((a) => a + 1); } else afterUnlock();
        }}
      />
    </div>
  );
}

// Установка, смена и отключение кода доступа.
export function PinScreen({ route }) {
  const sec = useSecurity();
  const nav = useNav();
  const ui = useUi();
  const mode = route.mode; // setup | change | disable
  const [step, setStep] = useState(mode === 'setup' ? 'new' : 'old');
  const [first, setFirst] = useState('');
  const [error, setError] = useState('');
  const [k, setK] = useState(0);
  const reset = (msg) => { setError(msg); setK((x) => x + 1); };

  const titles = { old: 'Текущий код', new: 'Новый код', confirm: 'Повторите код' };
  const subs = { old: 'Введите действующий код', new: 'Придумайте код из 4 цифр', confirm: 'Введите код ещё раз' };

  const onComplete = async (pin) => {
    if (step === 'old') {
      if (!(await sec.verify(pin))) return reset('Неверный код');
      if (mode === 'disable') {
        await sec.disableLock();
        ui.showToast('Блокировка выключена, шифрование снято');
        nav.back();
        return;
      }
      setError(''); setStep('new'); setK((x) => x + 1);
    } else if (step === 'new') {
      setFirst(pin); setError(''); setStep('confirm'); setK((x) => x + 1);
    } else {
      if (pin !== first) { setStep('new'); setFirst(''); return reset('Коды не совпали, попробуйте снова'); }
      await sec.setPin(pin);
      haptic('success');
      ui.showToast(mode === 'setup' ? 'Блокировка включена, архив зашифрован' : 'Код изменён');
      nav.back();
    }
  };

  return (
    <div className="screen pin-screen">
      <TopBar title={mode === 'setup' ? 'Блокировка' : mode === 'change' ? 'Смена кода' : 'Выключить блокировку'} />
      <PinPad title={titles[step]} sub={subs[step]} error={error} resetKey={`${step}-${k}`} onComplete={onComplete} />
    </div>
  );
}
