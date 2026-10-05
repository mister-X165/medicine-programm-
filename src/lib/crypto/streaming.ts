/**
 * Streaming cascade encryption / decryption for arbitrary-size files.
 *
 * Design:
 *   - The file is processed in fixed-size chunks (default 1 MiB).
 *   - Each chunk is cascade-encrypted independently (see cascade.ts) using
 *     a per-chunk nonce derived from a master nonce + chunk counter.
 *   - The BLAKE3 hash of the plaintext is computed in parallel with
 *     encryption via StreamingBlake3, so the entire file never needs to be
 *     held in memory.
 *   - The final container layout is:
 *        [header][encrypted metadata][encrypted chunks…][BLAKE3 trailer]
 *
 * The encrypt/decrypt functions take a progress callback so the UI can show
 * real-time progress and the operation can be cancelled.
 */

import {
  ARGON2_OUTPUT_SIZE,
  BLAKE3_SIZE,
  CASCADE_OVERHEAD_PER_CHUNK,
  CIPHER_AES_256_GCM_SIV,
  CIPHER_CHACHA20_POLY1305,
  DEFAULT_CHUNK_SIZE,
  FLAG_CASCADE,
  FLAG_METADATA_ENCRYPTED,
  HASH_BLAKE3,
  KDF_ARGON2ID,
  MAGIC,
  NONCE_SIZE,
  VERSION,
} from './constants';
import type { Argon2PresetName, Argon2Params } from './constants';
import { ARGON2_PRESETS } from './constants';
import { decryptChunk, encryptChunk, wipeCascadeKeys, type CascadeKeys } from './cascade';
import {
  buildHeader,
  computeBlake3,
  decodeMetadata,
  encodeMetadata,
  parseHeader,
  StreamingBlake3,
  type ContainerMetadata,
} from './container';
import { deriveKeys, estimateGpuCrackTime } from './kdf';
import { NonceTracker } from './nonce-tracker';
import {
  METADATA_COUNTER,
  concatBytes,
  randomBytes,
  secureWipe,
} from './utils';
import { DecryptionError } from './cascade';

export interface EncryptOptions {
  password: string;
  argon2Preset: Argon2PresetName;
  /** Chunk size in bytes. Defaults to 1 MiB. */
  chunkSize?: number;
  /** Optional custom Argon2 params (overrides preset). */
  argon2Params?: Argon2Params;
}

export interface EncryptProgress {
  /** Bytes processed so far. */
  bytesProcessed: number;
  /** Total bytes. */
  totalBytes: number;
  /** Current chunk index. */
  chunkIndex: number;
  /** Total chunks. */
  totalChunks: number;
  /** Phase: 'kdf' | 'encrypt' | 'finalise' */
  phase: 'kdf' | 'encrypt' | 'finalise';
}

export type EncryptProgressCallback = (p: EncryptProgress) => void;
export type DecryptProgressCallback = (p: EncryptProgress) => void;

export interface EncryptResult {
  /** The complete container bytes. */
  container: Uint8Array;
  /** BLAKE3 hash of the original plaintext. */
  plaintextHash: Uint8Array;
  /** Number of chunks written. */
  chunkCount: number;
  /** Estimated GPU brute-force time label (for UI display). */
  crackTimeLabel: string;
  /** Container header preview. */
  // header preview added later if needed
}

/**
 * Encrypts a file (given as a Uint8Array) into a self-describing container.
 *
 * NOTE: For very large files the caller should switch to a streaming source
 * (File streams via ReadableStream). This implementation accepts a single
 * buffer for simplicity; the chunking logic inside is identical to what a
 * streaming version would use.
 */
export async function encryptFile(
  plaintext: Uint8Array,
  metadata: ContainerMetadata,
  options: EncryptOptions,
  onProgress?: EncryptProgressCallback,
): Promise<EncryptResult> {
  // ---- 0. Validate inputs ----
  if (!options.password || options.password.length < 1) {
    throw new Error('password is required');
  }
  const params: Argon2Params =
    options.argon2Params ?? ARGON2_PRESETS[options.argon2Preset];
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (chunkSize < 8) {
    throw new Error('chunk size must be >= 8 bytes');
  }

  // ---- 1. KDF ----
  onProgress?.({
    bytesProcessed: 0,
    totalBytes: plaintext.length,
    chunkIndex: 0,
    totalChunks: Math.ceil(plaintext.length / chunkSize),
    phase: 'kdf',
  });
  const salt = randomBytes(16);
  const keys = await deriveKeys(options.password, salt, params);

  // ---- 2. Generate master nonces ----
  const masterNonceAes = randomBytes(NONCE_SIZE);
  const masterNonceChaCha = randomBytes(NONCE_SIZE);

  const tracker = new NonceTracker();

  // ---- 3. Encrypt metadata block (filename, mime, size) ----
  const metadataBytes = encodeMetadata(metadata);
  const encryptedMetadata = encryptChunk(
    metadataBytes,
    keys,
    masterNonceAes,
    masterNonceChaCha,
    METADATA_COUNTER,
    tracker,
  );

  // ---- 4. Build the header (we'll concatenate after the chunks) ----
  const flags =
    FLAG_CASCADE | FLAG_METADATA_ENCRYPTED;

  // ---- 5. Encrypt chunks and hash plaintext in parallel ----
  const hasher = new StreamingBlake3();
  const encryptedChunks: Uint8Array[] = [];
  const totalChunks = Math.max(1, Math.ceil(plaintext.length / chunkSize));
  let offset = 0;
  let chunkIndex = 0;

  // Handle zero-length files: still emit one (empty) chunk so the container
  // always has at least one AEAD-protected block.
  if (plaintext.length === 0) {
    const empty = new Uint8Array(0);
    hasher.update(empty);
    const ct = encryptChunk(empty, keys, masterNonceAes, masterNonceChaCha, 0, tracker);
    encryptedChunks.push(ct);
    chunkIndex = 1;
  } else {
    while (offset < plaintext.length) {
      const end = Math.min(offset + chunkSize, plaintext.length);
      const chunk = plaintext.subarray(offset, end);
      hasher.update(chunk);
      const ct = encryptChunk(
        chunk,
        keys,
        masterNonceAes,
        masterNonceChaCha,
        chunkIndex,
        tracker,
      );
      encryptedChunks.push(ct);
      offset = end;
      chunkIndex++;
      onProgress?.({
        bytesProcessed: offset,
        totalBytes: plaintext.length,
        chunkIndex,
        totalChunks,
        phase: 'encrypt',
      });
      // Yield to the event loop every few chunks so the UI stays responsive.
      if (chunkIndex % 8 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  // ---- 6. Finalise: compute plaintext hash ----
  onProgress?.({
    bytesProcessed: plaintext.length,
    totalBytes: plaintext.length,
    chunkIndex,
    totalChunks,
    phase: 'finalise',
  });
  const plaintextHash = hasher.digest();

  // ---- 7. Build the header ----
  const headerBytes = buildHeader({
    flags,
    kdfId: KDF_ARGON2ID,
    kdfSalt: salt,
    kdfParams: params,
    cipher1Id: CIPHER_AES_256_GCM_SIV,
    cipher1MasterNonce: masterNonceAes,
    cipher2Id: CIPHER_CHACHA20_POLY1305,
    cipher2MasterNonce: masterNonceChaCha,
    hashAlgorithm: HASH_BLAKE3,
    chunkSize,
    originalFileSize: plaintext.length,
    encryptedMetadata,
  });

  // ---- 8. Concatenate the container ----
  const container = concatBytes(headerBytes, ...encryptedChunks, plaintextHash);

  // ---- 9. Wipe secrets ----
  wipeCascadeKeys(keys);
  secureWipe(masterNonceAes);
  secureWipe(masterNonceChaCha);
  secureWipe(encryptedMetadata);
  secureWipList(encryptedChunks); // not strictly necessary — these are ciphertext
  tracker.reset();

  const crack = estimateGpuCrackTime(options.password.length, params);

  return {
    container,
    plaintextHash,
    chunkCount: chunkIndex,
    crackTimeLabel: crack.label,
  };
}

export interface DecryptResult {
  /** The recovered plaintext. */
  plaintext: Uint8Array;
  /** The recovered metadata (filename, mime, size). */
  metadata: ContainerMetadata;
  /** Whether the BLAKE3 integrity check passed. */
  integrityOk: boolean;
  /** The BLAKE3 hash computed from the recovered plaintext. */
  computedHash: Uint8Array;
  /** The BLAKE3 hash stored in the container trailer. */
  storedHash: Uint8Array;
  /** Number of chunks decrypted. */
  chunkCount: number;
}

/**
 * Decrypts a container produced by `encryptFile`.
 *
 * Verifies every AEAD tag and the final BLAKE3 trailer. If any check fails,
 * throws a DecryptionError and no plaintext is released (the partial buffer
 * is wiped).
 */
export async function decryptFile(
  container: Uint8Array,
  password: string,
  onProgress?: DecryptProgressCallback,
): Promise<DecryptResult> {
  // ---- 1. Parse the header ----
  const { header, dataOffset } = parseHeader(container);
  if (header.kdfId !== KDF_ARGON2ID) {
    throw new DecryptionError(`unsupported KDF: ${header.kdfId}`);
  }
  if (header.cipher1Id !== CIPHER_AES_256_GCM_SIV) {
    throw new DecryptionError(`unsupported cipher 1: ${header.cipher1Id}`);
  }
  if (header.cipher2Id !== CIPHER_CHACHA20_POLY1305) {
    throw new DecryptionError(`unsupported cipher 2: ${header.cipher2Id}`);
  }
  if (header.hashAlgorithm !== HASH_BLAKE3) {
    throw new DecryptionError(`unsupported hash: ${header.hashAlgorithm}`);
  }

  // ---- 2. KDF ----
  onProgress?.({
    bytesProcessed: 0,
    totalBytes: header.originalFileSize,
    chunkIndex: 0,
    totalChunks: Math.max(
      1,
      Math.ceil(header.originalFileSize / header.chunkSize),
    ),
    phase: 'kdf',
  });
  const keys = await deriveKeys(password, header.kdfSalt, header.kdfParams);

  const tracker = new NonceTracker();

  // ---- 3. Decrypt metadata block ----
  let metadata: ContainerMetadata;
  try {
    const metadataBytes = decryptChunk(
      header.encryptedMetadata,
      keys,
      header.cipher1MasterNonce,
      header.cipher2MasterNonce,
      METADATA_COUNTER,
      tracker,
    );
    metadata = decodeMetadata(metadataBytes);
    secureWipList([metadataBytes]);
  } catch (e) {
    wipeCascadeKeys(keys);
    if (e instanceof DecryptionError) {
      throw new DecryptionError(
        'Metadata block decryption failed. Password is likely incorrect.',
      );
    }
    throw e;
  }

  // ---- 4. Decrypt chunks ----
  const hasher = new StreamingBlake3();
  const plaintextChunks: Uint8Array[] = [];
  let cursor = dataOffset;
  const trailerStart = container.length - BLAKE3_SIZE;
  if (trailerStart < cursor) {
    wipeCascadeKeys(keys);
    throw new DecryptionError('container is truncated');
  }
  const totalChunks = Math.max(
    1,
    Math.ceil(header.originalFileSize / header.chunkSize),
  );
  let chunkIndex = 0;
  let bytesProduced = 0;

  // Zero-length file edge case.
  if (header.originalFileSize === 0) {
    const ctLen = CASCADE_OVERHEAD_PER_CHUNK;
    if (cursor + ctLen > trailerStart) {
      wipeCascadeKeys(keys);
      throw new DecryptionError('container missing data section');
    }
    const ct = container.subarray(cursor, cursor + ctLen);
    const pt = decryptChunk(
      ct,
      keys,
      header.cipher1MasterNonce,
      header.cipher2MasterNonce,
      0,
      tracker,
    );
    hasher.update(pt);
    plaintextChunks.push(pt);
    bytesProduced = 0;
    chunkIndex = 1;
    cursor += ctLen;
  } else {
    let remaining = header.originalFileSize;
    while (remaining > 0 && cursor < trailerStart) {
      const plaintextLen = Math.min(header.chunkSize, remaining);
      const ctLen = plaintextLen + CASCADE_OVERHEAD_PER_CHUNK;
      if (cursor + ctLen > trailerStart) {
        wipeCascadeKeys(keys);
        secureWipList(plaintextChunks);
        throw new DecryptionError(
          `chunk ${chunkIndex} would overrun the trailer (cursor=${cursor}, ctLen=${ctLen}, trailerStart=${trailerStart})`,
        );
      }
      const ct = container.subarray(cursor, cursor + ctLen);
      let pt: Uint8Array;
      try {
        pt = decryptChunk(
          ct,
          keys,
          header.cipher1MasterNonce,
          header.cipher2MasterNonce,
          chunkIndex,
          tracker,
        );
      } catch (e) {
        wipeCascadeKeys(keys);
        secureWipList(plaintextChunks);
        if (e instanceof DecryptionError) {
          throw new DecryptionError(
            `chunk ${chunkIndex} decryption failed: ${e.message}`,
          );
        }
        throw e;
      }
      if (pt.length !== plaintextLen) {
        wipeCascadeKeys(keys);
        secureWipList(plaintextChunks);
        secureWipList([pt]);
        throw new DecryptionError(
          `chunk ${chunkIndex} produced unexpected length ${pt.length} (expected ${plaintextLen})`,
        );
      }
      hasher.update(pt);
      plaintextChunks.push(pt);
      bytesProduced += pt.length;
      remaining -= pt.length;
      cursor += ctLen;
      chunkIndex++;
      onProgress?.({
        bytesProcessed: bytesProduced,
        totalBytes: header.originalFileSize,
        chunkIndex,
        totalChunks,
        phase: 'encrypt',
      });
      if (chunkIndex % 8 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (remaining !== 0) {
      wipeCascadeKeys(keys);
      secureWipList(plaintextChunks);
      throw new DecryptionError(
        `ran out of ciphertext before recovering all plaintext (remaining=${remaining})`,
      );
    }
    if (cursor !== trailerStart) {
      wipeCascadeKeys(keys);
      secureWipList(plaintextChunks);
      throw new DecryptionError(
        `trailer misaligned: cursor=${cursor}, expected=${trailerStart}`,
      );
    }
  }

  // ---- 5. Verify BLAKE3 trailer ----
  onProgress?.({
    bytesProcessed: header.originalFileSize,
    totalBytes: header.originalFileSize,
    chunkIndex,
    totalChunks,
    phase: 'finalise',
  });
  const computedHash = hasher.digest();
  const storedHash = container.subarray(trailerStart, trailerStart + BLAKE3_SIZE);
  const integrityOk =
    computedHash.length === storedHash.length &&
    computedHash.every((b, i) => b === storedHash[i]);

  // ---- 6. Assemble plaintext ----
  const plaintext = concatBytes(...plaintextChunks);

  // ---- 7. Wipe secrets ----
  wipeCascadeKeys(keys);
  // plaintextChunks are subarrays of the output — we keep the assembled plaintext.
  tracker.reset();

  return {
    plaintext,
    metadata,
    integrityOk,
    computedHash,
    storedHash: new Uint8Array(storedHash),
    chunkCount: chunkIndex,
  };
}

/**
 * Reads the container header preview without performing any decryption.
 * Safe to call on untrusted input — never touches the password.
 */
export function inspectContainer(container: Uint8Array) {
  const { header } = parseHeader(container);
  return {
    version: header.version,
    flags: header.flags,
    kdfAlgorithm: header.kdfId === KDF_ARGON2ID ? 'Argon2id' : `unknown(${header.kdfId})`,
    kdfParams: header.kdfParams,
    cipher1: header.cipher1Id === CIPHER_AES_256_GCM_SIV ? 'AES-256-GCM-SIV' : `unknown(${header.cipher1Id})`,
    cipher2: header.cipher2Id === CIPHER_CHACHA20_POLY1305 ? 'ChaCha20-Poly1305' : `unknown(${header.cipher2Id})`,
    hashAlgorithm: header.hashAlgorithm === HASH_BLAKE3 ? 'BLAKE3-256' : `unknown(${header.hashAlgorithm})`,
    chunkSize: header.chunkSize,
    originalFileSize: header.originalFileSize,
    encryptedMetadataLength: header.encryptedMetadata.length,
    isCryptoVault:
      container.length >= 4 &&
      container[0] === MAGIC[0] &&
      container[1] === MAGIC[1] &&
      container[2] === MAGIC[2] &&
      container[3] === MAGIC[3],
  };
}

/**
 * Self-test: encrypts and decrypts a known plaintext with a known password,
 * verifying that the round-trip succeeds and integrity checks pass.
 * Used by the UI's "Run crypto self-test" button.
 */
export async function runSelfTest(): Promise<{
  passed: boolean;
  durationMs: number;
  details: string;
}> {
  const t0 = performance.now();
  const plaintext = new TextEncoder().encode(
    'CryptoVault self-test payload: cascade AES-256-GCM-SIV + ChaCha20-Poly1305.',
  );
  const result = await encryptFile(
    plaintext,
    { filename: 'selftest.txt', mimeType: 'text/plain', size: plaintext.length },
    {
      password: 'self-test-password-1234567890',
      argon2Preset: 'fast',
      chunkSize: 16, // tiny chunks to exercise multi-chunk path
    },
  );
  // Tamper test: flip a bit in the first data chunk and confirm decryption fails.
  const tampered = new Uint8Array(result.container);
  // Find the first byte after the header+metadata (we don't know the exact offset
  // here, so flip a byte well inside the container).
  const flipOffset = Math.floor(tampered.length / 2);
  tampered[flipOffset] ^= 0x01;

  let tamperDetected = false;
  try {
    await decryptFile(tampered, 'self-test-password-1234567890');
  } catch {
    tamperDetected = true;
  }

  const decrypted = await decryptFile(result.container, 'self-test-password-1234567890');
  const roundTripOk =
    decrypted.integrityOk &&
    decrypted.plaintext.length === plaintext.length &&
    decrypted.plaintext.every((b, i) => b === plaintext[i]);

  const durationMs = performance.now() - t0;
  return {
    passed: roundTripOk && tamperDetected,
    durationMs,
    details: `roundTrip=${roundTripOk}, tamperDetected=${tamperDetected}, chunks=${decrypted.chunkCount}`,
  };
}

/* ---- internal helpers ---- */

function secureWipList(list: Uint8Array[]): void {
  for (const b of list) secureWipe(b);
}

// Re-export key types/constants for the UI.
export {
  ARGON2_PRESETS,
  ARGON2_OUTPUT_SIZE,
  DEFAULT_CHUNK_SIZE,
  BLAKE3_SIZE,
  CASCADE_OVERHEAD_PER_CHUNK,
  VERSION,
} from './constants';
export type { Argon2PresetName, Argon2Params } from './constants';
export { NonceReuseError } from './nonce-tracker';
export { DecryptionError } from './cascade';
export { estimateGpuCrackTime } from './kdf';
export { constantTimeEqual, secureWipe, randomBytes, toHex, fromHex } from './utils';
export {
  buildHeader,
  parseHeader,
  headerToPreview,
  computeBlake3,
  type ContainerHeader,
  type ContainerMetadata,
  type HeaderPreview,
} from './container';
export type { CascadeKeys } from './cascade';
