import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey() {
  const raw=process.env.KYC_ENCRYPTION_KEY || (process.env.NODE_ENV === 'test' ? 'ab'.repeat(32) : '');
  const key=/^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw,'hex') : Buffer.from(raw,'base64');
  if (key.length !== 32) throw Object.assign(new Error('KYC document encryption is not configured. Add a random 32-byte KYC_ENCRYPTION_KEY.'),{status:503});
  return key;
}

export function encryptDocument(bytes) {
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',encryptionKey(),nonce);
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return Buffer.concat([Buffer.from('NLK1'),nonce,cipher.getAuthTag(),encrypted]);
}

export function decryptDocument(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.toString('ascii',0,4) !== 'NLK1') throw new Error('Encrypted KYC document could not be read.');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(4,16));
  decipher.setAuthTag(bytes.subarray(16,32));
  return Buffer.concat([decipher.update(bytes.subarray(32)),decipher.final()]);
}

export function createKycAdapter() {
  const provider=process.env.KYC_PROVIDER || 'manual';
  if (provider!=='manual') throw new Error('KYC_PROVIDER currently supports the manual-review adapter only.');
  return {
    provider,
    encrypt:encryptDocument,
    decrypt:decryptDocument,
    normalizeDecision(status) {
      if (!['unverified','verified','suspended'].includes(status)) throw new Error('Unsupported identity decision.');
      return status;
    }
  };
}
