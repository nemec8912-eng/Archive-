// Ключи архива. Ключ данных (DEK) — случайный AES-256; на устройстве он хранится только
// в зашифрованном виде: ключом из кода доступа (PBKDF2) и, если включено, ключом биометрии.
import { deriveKey, randomBytes, toB64, fromB64 } from './cryptoBox.js';

export const PIN_ITER = 600000;

export async function newDataKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

const importDek = (raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);

async function wrapWith(kek, dek) {
  const raw = await crypto.subtle.exportKey('raw', dek);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { iv: toB64(iv), wrapped: toB64(new Uint8Array(ct)) };
}

async function unwrapWith(kek, rec) {
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(rec.iv) }, kek, fromB64(rec.wrapped));
  return importDek(raw);
}

// Запись для кода доступа: соль, число итераций и ключ данных, зашифрованный ключом из кода.
export async function wrapWithPin(pin, dek) {
  const salt = randomBytes(16);
  const kek = await deriveKey(`archive:${pin}`, salt, { iterations: PIN_ITER });
  return { v: 2, salt: toB64(salt), iter: PIN_ITER, ...(await wrapWith(kek, dek)) };
}

// Неверный код — расшифровка не проходит проверку подлинности (AES-GCM), возвращается null.
export async function unwrapWithPin(pin, rec) {
  try {
    const kek = await deriveKey(`archive:${pin}`, fromB64(rec.salt), { iterations: rec.iter || PIN_ITER });
    return await unwrapWith(kek, rec);
  } catch {
    return null;
  }
}

// ── Биометрия ──
const native = () => window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.NativeBiometric;
const BIO_SERVER = 'archive.local.vault';

export async function biometricAvailable() {
  try {
    const nb = native();
    if (nb) {
      const r = await nb.isAvailable();
      return r?.isAvailable ? { kind: 'native', label: r.biometryType === 1 || r.biometryType === 'touchId' ? 'отпечатку' : 'Face ID или отпечатку' } : null;
    }
    if (window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.())) {
      return { kind: 'webauthn', label: 'Face ID или отпечатку' };
    }
  } catch { /* недоступно */ }
  return null;
}

async function prfKey(credId, prfSalt) {
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: 'public-key', id: credId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const first = res.getClientExtensionResults()?.prf?.results?.first;
  if (!first) throw Object.assign(new Error('Это устройство не поддерживает ключи биометрии в браузере'), { code: 'noprf' });
  return crypto.subtle.importKey('raw', first, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Включить вход по биометрии: ключ данных шифруется ключом, который выдаёт только системная биометрия.
export async function enrollBiometric(dek) {
  const nb = native();
  if (nb) {
    await nb.verifyIdentity({ reason: 'Включить вход в Архив', title: 'Архив' });
    const raw = await crypto.subtle.exportKey('raw', dek);
    await nb.setCredentials({ username: 'archive', password: toB64(new Uint8Array(raw)), server: BIO_SERVER });
    return { kind: 'native' };
  }
  const prfSalt = randomBytes(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Архив', id: location.hostname },
      user: { id: randomBytes(16), name: 'archive', displayName: 'Архив' },
      challenge: randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const ext = cred.getClientExtensionResults()?.prf;
  if (ext && ext.enabled === false) throw Object.assign(new Error('Это устройство не поддерживает ключи биометрии в браузере'), { code: 'noprf' });
  const credId = new Uint8Array(cred.rawId);
  const kek = await prfKey(credId, prfSalt);
  return { kind: 'webauthn', credId: toB64(credId), prfSalt: toB64(prfSalt), ...(await wrapWith(kek, dek)) };
}

export async function unlockBiometric(bio) {
  const nb = native();
  if (bio.kind === 'native' && nb) {
    await nb.verifyIdentity({ reason: 'Вход в Архив', title: 'Архив' });
    const c = await nb.getCredentials({ server: BIO_SERVER });
    return importDek(fromB64(c.password));
  }
  const kek = await prfKey(fromB64(bio.credId), fromB64(bio.prfSalt));
  return unwrapWith(kek, bio);
}

export async function removeBiometric(bio) {
  const nb = native();
  if (bio?.kind === 'native' && nb) await nb.deleteCredentials({ server: BIO_SERVER }).catch(() => {});
}
