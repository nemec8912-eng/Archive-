import React, { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { usePrefs } from '../prefs.jsx';
import { haptic } from '../lib/haptics.js';

const SLIDES = [
  {
    icon: 'shield',
    title: 'Только на этом устройстве',
    text: 'Фото, видео, переписки, голосовые и заметки хранятся внутри приложения и никуда не отправляются.',
  },
  {
    icon: 'plus',
    title: 'Кнопка «+» — добавить',
    text: 'Из галереи, с камеры, запись голосового, заметка, скриншот, переписка или новая папка.',
  },
  {
    icon: 'hand',
    title: 'Удерживайте материал',
    text: 'Долгое нажатие открывает быстрый просмотр и действия: переименовать, переместить, в избранное, поделиться.',
  },
  {
    icon: 'trash',
    title: 'Удалённое — в Корзине',
    text: 'Случайно удалили? Материал можно восстановить из Корзины в исходную папку.',
  },
];

// Подсказки при первом запуске.
export default function Onboarding() {
  const prefs = usePrefs();
  const [i, setI] = useState(0);
  const touch = useRef(null);
  if (prefs.onboarded) return null;

  const last = i === SLIDES.length - 1;
  const finish = () => { haptic('success'); prefs.set({ onboarded: true }); };
  const next = () => { haptic('selection'); if (last) finish(); else setI(i + 1); };
  const s = SLIDES[i];

  return (
    <div
      className="onboarding"
      role="dialog"
      aria-label="Знакомство с приложением"
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touch.current == null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (dx < -50 && !last) setI(i + 1);
        if (dx > 50 && i > 0) setI(i - 1);
      }}
    >
      <button className="ob-skip text-btn" onClick={finish}>Пропустить</button>
      <div className="ob-body" key={i}>
        <div className="ob-art">
          <span className="ob-ring r1" />
          <span className="ob-ring r2" />
          <span className="ob-icon"><Icon name={s.icon} size={40} /></span>
        </div>
        <h2>{s.title}</h2>
        <p>{s.text}</p>
      </div>
      <div className="ob-dots">
        {SLIDES.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}
      </div>
      <button className="btn primary ob-next" onClick={next}>{last ? 'Начать' : 'Далее'}</button>
    </div>
  );
}
