// Код доступа хранится только в виде хеша с солью, сам код нигде не сохраняется.
const KEY = 'archive.security';

export function loadSecurity() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { lockEnabled: false };
  } catch {
    return { lockEnabled: false };
  }
}

export function saveSecurity(value) {
  localStorage.setItem(KEY, JSON.stringify(value));
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}:archive`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export function newSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return toHex(a);
}

export async function checkPin(pin, sec) {
  if (!sec?.pinHash) return false;
  return (await hashPin(pin, sec.salt)) === sec.pinHash;
}

export async function makePinRecord(pin) {
  const salt = newSalt();
  return { salt, pinHash: await hashPin(pin, salt) };
}
