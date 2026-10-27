/**
 * Cascade cipher core.
 *
 * Layer 1: AES-256-GCM-SIV  (nonce-misuse resistant, NIST SP 800-38D)
 * Layer 2: ChaCha20-Poly1305 (RFC 8439, side-channel resistant on non-AESNI CPUs)
 *
 * Per chunk:
 *   c1 = AES-GCM-SIV.Enc(key1, nonce1, plaintext)  // ciphertext + 16-byte tag
 *   c2 = ChaCha20-Poly1305.Enc(key2, nonce2, c1)    // ciphertext + 16-byte tag
 *
 * Decryption reverses the order. Authentication is verified at every layer
 * BEFORE any plaintext is released — a tampered chunk fails fast and no
 * plaintext is emitted.
 *
 * Both primitives come from @noble/ciphers, which is audited and used in
 * production by several wallet projects. The library is constant-time on
 * platforms with a native big-integer path.
 */

import { gcmsiv } from '@noble/ciphers/aes.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { AEAD_TAG_SIZE, CASCADE_OVERHEAD_PER_CHUNK } from './constants';
import { constantTimeEqual, deriveNonce, secureWipe } from './utils';
import { NonceTracker } from './nonce-tracker';

export interface CascadeKeys {
  aesKey: Uint8Array;
  chachaKey: Uint8Array;
}

/**
 * Encrypts a single chunk with the cascade.
 *
 * The caller supplies the master nonces (one per cipher) and the chunk
 * counter. The tracker is consulted/updated to guarantee nonce uniqueness.
 *
 * Returns the cascade ciphertext (plaintext.length + 32 bytes).
 */
export function encryptChunk(
  plaintext: Uint8Array,
  keys: CascadeKeys,
  masterNonceAes: Uint8Array,
  masterNonceChaCha: Uint8Array,
  counter: number,
  tracker: NonceTracker,
): Uint8Array {
  const nonce1 = deriveNonce(masterNonceAes, counter);
  const nonce2 = deriveNonce(masterNonceChaCha, counter);
  tracker.register(nonce1);
  tracker.register(nonce2);

  try {
    const aesCipher = gcmsiv(keys.aesKey, nonce1);
    const c1 = aesCipher.encrypt(plaintext);
    if (c1.length !== plaintext.length + AEAD_TAG_SIZE) {
      throw new Error(
        `AES-GCM-SIV produced unexpected length: ${c1.length} vs ${plaintext.length + AEAD_TAG_SIZE}`,
      );
    }

    const chaCipher = chacha20poly1305(keys.chachaKey, nonce2);
    const c2 = chaCipher.encrypt(c1);
    if (c2.length !== c1.length + AEAD_TAG_SIZE) {
      throw new Error(
        `ChaCha20-Poly1305 produced unexpected length: ${c2.length} vs ${c1.length + AEAD_TAG_SIZE}`,
      );
    }

    // Wipe intermediate ciphertext (layer 1) — it is a secret.
    secureWipe(c1);
    return c2;
  } finally {
    secureWipe(nonce1);
    secureWipe(nonce2);
  }
}

/**
 * Decrypts a single chunk produced by `encryptChunk`.
 *
 * Verifies both AEAD tags BEFORE returning any plaintext. If either tag
 * fails, throws a DecryptionError and no plaintext is released.
 *
 * The counter MUST match the one used at encryption time for the same chunk.
 */
export function decryptChunk(
  cascadeCiphertext: Uint8Array,
  keys: CascadeKeys,
  masterNonceAes: Uint8Array,
  masterNonceChaCha: Uint8Array,
  counter: number,
  tracker: NonceTracker,
): Uint8Array {
  if (cascadeCiphertext.length < CASCADE_OVERHEAD_PER_CHUNK) {
    throw new DecryptionError(
      `ciphertext too short: ${cascadeCiphertext.length} < ${CASCADE_OVERHEAD_PER_CHUNK}`,
    );
  }

  const nonce1 = deriveNonce(masterNonceAes, counter);
  const nonce2 = deriveNonce(masterNonceChaCha, counter);
  tracker.register(nonce1);
  tracker.register(nonce2);

  try {
    // Layer 2 first (ChaCha20-Poly1305).
    const chaCipher = chacha20poly1305(keys.chachaKey, nonce2);
    let c1: Uint8Array;
    try {
      c1 = chaCipher.decrypt(cascadeCiphertext);
    } catch {
      throw new DecryptionError('ChaCha20-Poly1305 tag verification failed (layer 2).');
    }

    // Layer 1 (AES-GCM-SIV).
    const aesCipher = gcmsiv(keys.aesKey, nonce1);
    let plaintext: Uint8Array;
    try {
      plaintext = aesCipher.decrypt(c1);
    } catch {
      secureWipe(c1);
      throw new DecryptionError('AES-GCM-SIV tag verification failed (layer 1).');
    }

    secureWipe(c1);
    return plaintext;
  } finally {
    secureWipe(nonce1);
    secureWipe(nonce2);
  }
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * Verifies two AEAD tags in constant time. Helper exposed for the
 * integrity self-test; production code relies on the in-place decrypt()
 * which throws on mismatch.
 */
export function verifyTag(received: Uint8Array, expected: Uint8Array): boolean {
  return constantTimeEqual(received, expected);
}

/**
 * Zeroises both keys in a CascadeKeys object.
 */
export function wipeCascadeKeys(keys: CascadeKeys): void {
  secureWipe(keys.aesKey);
  secureWipe(keys.chachaKey);
}
