import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { TopBar } from '../components/Common.jsx';
import { useSecurity } from '../security.jsx';
import { useNav, useUi } from '../ui.jsx';

const LEN = 4;

export function PinPad({ title, sub, error, onComplete, resetKey }) {
  const [pin, setPin] = useState('');
  useEffect(() => { setPin(''); }, [resetKey]);
  const press = (d) => {
    if (pin.length >= LEN) return;
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
        <span />
        <button className="key" onClick={() => press('0')}>0</button>
        <button className="key ghost" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Стереть"><Icon name="backspace" size={24} /></button>
      </div>
    </div>
  );
}

// Экран блокировки — закрывает всё содержимое, пока не введён код.
export function LockScreen() {
  const sec = useSecurity();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="lock-screen">
      <div className="lock-brand">Архив</div>
      <PinPad
        title="Введите код"
        error={error}
        resetKey={attempt}
        onComplete={async (pin) => {
          const ok = await sec.unlock(pin);
          if (!ok) { setError('Неверный код'); setAttempt((a) => a + 1); }
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
        sec.disableLock();
        ui.showToast('Блокировка выключена');
        nav.back();
        return;
      }
      setError(''); setStep('new'); setK((x) => x + 1);
    } else if (step === 'new') {
      setFirst(pin); setError(''); setStep('confirm'); setK((x) => x + 1);
    } else {
      if (pin !== first) { setStep('new'); setFirst(''); return reset('Коды не совпали, попробуйте снова'); }
      await sec.setPin(pin);
      ui.showToast(mode === 'setup' ? 'Блокировка включена' : 'Код изменён');
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
