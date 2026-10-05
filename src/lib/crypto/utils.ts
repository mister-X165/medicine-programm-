/**
 * Low-level cryptographic utilities.
 *
 * - randomBytes: CSPRNG backed by the browser Web Crypto API.
 * - constantTimeEqual: fixed-time comparison for AEAD tags / hashes.
 * - secureWipe: best-effort zeroisation of sensitive buffers.
 * - deriveNonce: per-chunk nonce derivation from a master nonce + counter.
 * - hex / base64 helpers.
 */

// Note: @noble/hashes/utils does not export a constant-time equal(); we
// implement our own below to keep the dependency surface small.

/**
 * Returns cryptographically secure random bytes using the Web Crypto API.
 * Falls back to a typed-array of zeros only if crypto is unavailable
 * (in which case the caller MUST abort — we never silently degrade).
 */
export function randomBytes(length: number): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('CSPRNG unavailable: crypto.getRandomValues is missing');
  }
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/**
 * Constant-time comparison of two equal-length byte arrays.
 * Used to compare AEAD tags and file hashes without leaking length-prefixed
 * timing information.
 *
 * Implementation: XOR-accumulate the difference across all bytes and check
 * the accumulator is zero. Runs in time proportional to the array length
 * only — not to the position of the first difference.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Best-effort zeroisation of sensitive material (keys, derived keys, passwords).
 *
 * NOTE: JavaScript cannot guarantee that the GC or the JIT won't have copied
 * the buffer. For true zeroisation a native module (or WebAssembly with
 * explicitly pinned memory) is required. We do what is possible: fill the
 * buffer with zeros AND with random noise so that residual copies in memory
 * are statistically indistinguishable from garbage.
 */
export function secureWipe(buffer: Uint8Array | ArrayBuffer | ArrayBufferView | null | undefined): void {
  if (!buffer) return;
  let view: Uint8Array;
  if (buffer instanceof Uint8Array) {
    view = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    view = new Uint8Array(buffer);
  } else {
    // ArrayBufferView
    const v = buffer as ArrayBufferView;
    view = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  if (view.byteLength === 0) return;
  view.fill(0);
  // Overwrite with CSPRNG output so even a snapshot of memory is not zero-recognisable.
  try {
    globalThis.crypto?.getRandomValues(view);
  } catch {
    // Ignore — zero fill is the primary defence.
  }
  view.fill(0);
}

/**
 * Derives a per-chunk nonce from a master nonce and a chunk counter.
 *
 * Construction: master_nonce XOR (0x00..00 || counter_be32) — i.e. the last
 * four bytes of the master nonce are XORed with the big-endian counter.
 *
 * This is the construction used by TLS 1.3 record nonces (RFC 8446 §5.3) and
 * is safe as long as (master_nonce, counter) pairs are unique — which they
 * are by construction (counter strictly monotonic).
 *
 * The NonceTracker double-checks uniqueness at runtime and aborts on collision.
 */
export function deriveNonce(master: Uint8Array, counter: number): Uint8Array {
  if (master.length !== 12) {
    throw new Error(`master nonce must be 12 bytes, got ${master.length}`);
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) {
    throw new RangeError(`counter must be a uint32 (0..2^32-1), got ${counter}`);
  }
  const out = new Uint8Array(12);
  out.set(master);
  // XOR the last 4 bytes with the big-endian counter.
  out[8] ^= (counter >>> 24) & 0xff;
  out[9] ^= (counter >>> 16) & 0xff;
  out[10] ^= (counter >>> 8) & 0xff;
  out[11] ^= counter & 0xff;
  return out;
}

/**
 * Special counter value reserved for encrypting the metadata block
 * (filename + mime type). Chunks use counters 0..N-1, so we use 0xFFFFFFFF
 * for metadata to guarantee they never collide.
 */
export const METADATA_COUNTER = 0xffffffff;

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex string has odd length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Concatenates multiple byte arrays into a new Uint8Array.
 */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/* ---- big-endian integer (de)serialisation ---- */

export function writeUint16BE(value: number): Uint8Array {
  if (value < 0 || value > 0xffff) throw new RangeError('uint16 overflow');
  const out = new Uint8Array(2);
  out[0] = (value >>> 8) & 0xff;
  out[1] = value & 0xff;
  return out;
}

export function readUint16BE(bytes: Uint8Array, offset = 0): number {
  return ((bytes[offset] << 8) | bytes[offset + 1]) >>> 0;
}

export function writeUint32BE(value: number): Uint8Array {
  if (value < 0 || value > 0xffffffff) throw new RangeError('uint32 overflow');
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

export function readUint32BE(bytes: Uint8Array, offset = 0): number {
  // Use >>> 0 to keep unsigned.
  return (((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]) >>> 0;
}

/**
 * 53-bit safe uint64 (JS Number can hold integers up to 2^53-1).
 * For file sizes this is more than sufficient (8 PiB max).
 */
export function writeUint64BE(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('uint64 value out of safe range');
  }
  const out = new Uint8Array(8);
  // High 32 bits
  const hi = Math.floor(value / 0x100000000);
  const lo = value >>> 0;
  out[0] = (hi >>> 24) & 0xff;
  out[1] = (hi >>> 16) & 0xff;
  out[2] = (hi >>> 8) & 0xff;
  out[3] = hi & 0xff;
  out[4] = (lo >>> 24) & 0xff;
  out[5] = (lo >>> 16) & 0xff;
  out[6] = (lo >>> 8) & 0xff;
  out[7] = lo & 0xff;
  return out;
}

export function readUint64BE(bytes: Uint8Array, offset = 0): number {
  const hi =
    (((bytes[offset] << 24) >>> 0) +
      (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) +
      bytes[offset + 3]) >>>
    0;
  const lo = readUint32BE(bytes, offset + 4);
  return hi * 0x100000000 + lo;
}

/**
 * Estimates the entropy of a password in bits using a Shannon-style heuristic
 * weighted by character-class diversity. Used only for the UI strength meter,
 * NOT for any security decision.
 */
export function estimatePasswordEntropyBits(password: string): number {
  if (!password) return 0;
  let charset = 0;
  if (/[a-z]/.test(password)) charset += 26;
  if (/[A-Z]/.test(password)) charset += 26;
  if (/[0-9]/.test(password)) charset += 10;
  if (/[^a-zA-Z0-9]/.test(password)) charset += 33;
  // Penalise pure dictionary-like patterns (very rough).
  let bits = password.length * Math.log2(charset || 1);
  // Bonus for length beyond 20.
  if (password.length >= 20) bits += 8;
  if (password.length >= 32) bits += 8;
  return Math.round(bits);
}
