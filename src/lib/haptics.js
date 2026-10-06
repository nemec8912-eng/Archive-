// Тактильная отдача на важные действия.
// В приложении (Capacitor) — системный модуль Haptics; в браузере Android — вибрация;
// в Safari на iPhone (iOS 18+) — системный отклик переключателя.
const PATTERNS = {
  selection: 8,
  light: 10,
  medium: 18,
  heavy: 28,
  success: [10, 40, 14],
  warning: [18, 60, 18],
  error: [24, 50, 24, 50, 24],
};

let iosSwitch;
function iosTick() {
  try {
    if (!iosSwitch) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      iosSwitch = label;
    }
    iosSwitch.click();
  } catch { /* не поддерживается */ }
}

export function haptic(kind = 'light') {
  try {
    const native = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.Haptics;
    if (native) {
      if (kind === 'selection') native.selectionChanged?.();
      else if (kind === 'success' || kind === 'warning' || kind === 'error') native.notification?.({ type: kind.toUpperCase() });
      else native.impact?.({ style: kind === 'heavy' ? 'HEAVY' : kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
      return;
    }
    if (navigator.vibrate) {
      navigator.vibrate(PATTERNS[kind] ?? 10);
      return;
    }
    iosTick();
    if (kind === 'warning' || kind === 'error') setTimeout(iosTick, 90);
  } catch { /* тактильная отдача необязательна */ }
}
