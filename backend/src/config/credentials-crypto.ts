import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

/**
 * Credential encryption at rest.
 *
 * Local development derives a stable key from JWT_SECRET, so credentials survive
 * restarts without another env var. Production must provide CREDENTIALS_KEY.
 */
function credentialKey(): Buffer {
  const configured = process.env.CREDENTIALS_KEY?.trim();
  if (configured) {
    if (/^[a-f0-9]{64}$/i.test(configured)) return Buffer.from(configured, 'hex');
    const base64 = Buffer.from(configured, 'base64');
    if (base64.length === 32) return base64;
    return createHash('sha256').update(configured, 'utf8').digest();
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('CREDENTIALS_KEY non configurata: impossibile cifrare le credenziali in produzione');
  }

  const seed = process.env.JWT_SECRET?.trim() || 'orderez-local-development-secret';
  return scryptSync(seed, 'orderez-credentials-v1', 32);
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value: string): string {
  if (!isEncryptedSecret(value)) return value;
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Credenziale cifrata non valida');
  const [iv, tag, encrypted] = parts;
  const decipher = createDecipheriv(ALGO, credentialKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}
