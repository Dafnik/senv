import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import env from './env';

const secretKey = () => createHash('sha256').update(env.BETTER_AUTH_SECRET).digest();
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}
export function decrypt<T>(value: string): T {
  const [iv, tag, ciphertext] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv!, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag!, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext!, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  ) as T;
}

export function canonicalJson(value: unknown): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, canonical(value)]),
          )
        : value;
  return JSON.stringify(canonical(value));
}
export function runtimeFingerprint(runtime: {
  env: Record<string, string>;
  secrets: Record<string, string>;
}) {
  return createHmac('sha256', secretKey()).update(canonicalJson(runtime)).digest('hex');
}
