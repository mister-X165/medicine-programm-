/**
 * Container format (de)serialisation.
 *
 * See constants.ts for the full byte layout. This module provides a typed
 * builder and parser, plus a small JSON-serialisable "header preview" used
 * by the UI to display container metadata without exposing secrets.
 */

import { blake3 } from '@noble/hashes/blake3.js';
import {
  AEAD_TAG_SIZE,
  ARGON2_OUTPUT_SIZE,
  BLAKE3_SIZE,
  CASCADE_OVERHEAD_PER_CHUNK,
  CIPHER_AES_256_GCM_SIV,
  CIPHER_CHACHA20_POLY1305,
  CIPHER_XTS_AES_256,
  DEFAULT_CHUNK_SIZE,
  FLAG_CASCADE,
  FLAG_HARDWARE_BINDING,
  FLAG_METADATA_ENCRYPTED,
  HASH_BLAKE3,
  HASH_SHA3_256,
  KDF_ARGON2ID,
  MAGIC,
  NONCE_SIZE,
  VERSION,
} from './constants';
import type { Argon2Params } from './constants';
import {
  concatBytes,
  readUint16BE,
  readUint32BE,
  readUint64BE,
  writeUint16BE,
  writeUint32BE,
  writeUint64BE,
} from './utils';

export interface ContainerHeader {
  version: number;
  flags: number;
  kdfId: number;
  kdfSalt: Uint8Array;
  kdfParams: Argon2Params;
  cipher1Id: number;
  cipher1MasterNonce: Uint8Array;
  cipher2Id: number;
  cipher2MasterNonce: Uint8Array;
  hashAlgorithm: number;
  chunkSize: number;
  originalFileSize: number;
  encryptedMetadata: Uint8Array;
}

export interface ContainerMetadata {
  /** Original filename (UTF-8). */
  filename: string;
  /** MIME type if known. */
  mimeType: string;
  /** Original size in bytes (also stored in the header for streaming). */
  size: number;
}

/**
 * Serialises a plaintext metadata object. The bytes returned here are then
 * cascade-encrypted with counter = METADATA_COUNTER before being written to
 * the container.
 */
export function encodeMetadata(meta: ContainerMetadata): Uint8Array {
  const encoder = new TextEncoder();
  const filenameBytes = encoder.encode(meta.filename);
  const mimeBytes = encoder.encode(meta.mimeType);
  if (filenameBytes.length > 1024) {
    throw new Error('filename too long (max 1024 bytes UTF-8)');
  }
  if (mimeBytes.length > 256) {
    throw new Error('mime type too long (max 256 bytes)');
  }
  return concatBytes(
    writeUint16BE(filenameBytes.length),
    filenameBytes,
    writeUint16BE(mimeBytes.length),
    mimeBytes,
    writeUint64BE(meta.size),
  );
}

export function decodeMetadata(bytes: Uint8Array): ContainerMetadata {
  let offset = 0;
  const filenameLen = readUint16BE(bytes, offset);
  offset += 2;
  const filename = new TextDecoder().decode(bytes.subarray(offset, offset + filenameLen));
  offset += filenameLen;
  const mimeLen = readUint16BE(bytes, offset);
  offset += 2;
  const mimeType = new TextDecoder().decode(bytes.subarray(offset, offset + mimeLen));
  offset += mimeLen;
  const size = readUint64BE(bytes, offset);
  return { filename, mimeType, size };
}

/**
 * Builds the binary container header (everything before the encrypted data
 * chunks).
 */
export function buildHeader(
  header: Omit<ContainerHeader, 'version'>,
): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(MAGIC);
  parts.push(writeUint16BE(VERSION));
  parts.push(new Uint8Array([header.flags]));
  parts.push(new Uint8Array([header.kdfId]));
  parts.push(writeUint16BE(header.kdfSalt.length));
  parts.push(header.kdfSalt);
  parts.push(writeUint32BE(header.kdfParams.memoryKiB));
  parts.push(writeUint32BE(header.kdfParams.iterations));
  parts.push(writeUint16BE(header.kdfParams.parallelism));
  parts.push(writeUint16BE(header.kdfParams.outputLength));
  parts.push(new Uint8Array([header.cipher1Id]));
  parts.push(header.cipher1MasterNonce);
  parts.push(new Uint8Array([header.cipher2Id]));
  parts.push(header.cipher2MasterNonce);
  parts.push(new Uint8Array([header.hashAlgorithm]));
  parts.push(writeUint32BE(header.chunkSize));
  parts.push(writeUint64BE(header.originalFileSize));
  parts.push(writeUint32BE(header.encryptedMetadata.length));
  parts.push(header.encryptedMetadata);
  return concatBytes(...parts);
}

/**
 * Parses a container header from the beginning of a Uint8Array.
 * Returns the header plus the byte offset where the encrypted chunks begin.
 */
export function parseHeader(buf: Uint8Array): { header: ContainerHeader; dataOffset: number } {
  if (buf.length < 4 + 2 + 1 + 1 + 2) {
    throw new Error('buffer too short to be a container');
  }
  // Verify magic.
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== MAGIC[i]) {
      throw new Error(`bad magic: expected CVLT, got byte ${buf[i].toString(16)} at offset ${i}`);
    }
  }
  let offset = 4;
  const version = readUint16BE(buf, offset);
  offset += 2;
  if (version !== VERSION) {
    throw new Error(`unsupported container version: ${version}`);
  }
  const flags = buf[offset++];
  const kdfId = buf[offset++];
  const saltLen = readUint16BE(buf, offset);
  offset += 2;
  const kdfSalt = buf.subarray(offset, offset + saltLen);
  offset += saltLen;
  const memoryKiB = readUint32BE(buf, offset);
  offset += 4;
  const iterations = readUint32BE(buf, offset);
  offset += 4;
  const parallelism = readUint16BE(buf, offset);
  offset += 2;
  const outputLength = readUint16BE(buf, offset);
  offset += 2;
  const cipher1Id = buf[offset++];
  const cipher1MasterNonce = buf.subarray(offset, offset + NONCE_SIZE);
  offset += NONCE_SIZE;
  const cipher2Id = buf[offset++];
  const cipher2MasterNonce = buf.subarray(offset, offset + NONCE_SIZE);
  offset += NONCE_SIZE;
  const hashAlgorithm = buf[offset++];
  const chunkSize = readUint32BE(buf, offset);
  offset += 4;
  const originalFileSize = readUint64BE(buf, offset);
  offset += 8;
  const metadataLen = readUint32BE(buf, offset);
  offset += 4;
  const encryptedMetadata = buf.subarray(offset, offset + metadataLen);
  offset += metadataLen;

  return {
    header: {
      version,
      flags,
      kdfId,
      kdfSalt: new Uint8Array(kdfSalt), // copy out of the source buffer
      kdfParams: { memoryKiB, iterations, parallelism, outputLength },
      cipher1Id,
      cipher1MasterNonce: new Uint8Array(cipher1MasterNonce),
      cipher2Id,
      cipher2MasterNonce: new Uint8Array(cipher2MasterNonce),
      hashAlgorithm,
      chunkSize,
      originalFileSize,
      encryptedMetadata: new Uint8Array(encryptedMetadata),
    },
    dataOffset: offset,
  };
}

/**
 * Computes the BLAKE3-256 hash of a complete byte stream.
 * Used for the integrity trailer recorded at the end of the container.
 */
export function computeBlake3(data: Uint8Array): Uint8Array {
  return blake3(data, { dkLen: BLAKE3_SIZE });
}

/**
 * Computes the BLAKE3 hash of a stream of chunks. Returns the final 32-byte
 * digest. Used during streaming encryption so we never need to hold the
 * entire plaintext in memory.
 */
export class StreamingBlake3 {
  private hasher: ReturnType<typeof blake3.create>;
  constructor() {
    this.hasher = blake3.create({ dkLen: BLAKE3_SIZE });
  }
  update(chunk: Uint8Array): void {
    this.hasher.update(chunk);
  }
  digest(): Uint8Array {
    return this.hasher.digest();
  }
}

/**
 * A sanitised, JSON-safe preview of a container header for UI display.
 * Never includes the salt (could be considered sensitive in some models)
 * but does include the KDF parameters and cipher IDs.
 */
export interface HeaderPreview {
  version: number;
  cascadeMode: boolean;
  hardwareBinding: boolean;
  metadataEncrypted: boolean;
  kdfAlgorithm: string;
  kdfParams: Argon2Params;
  cipher1: string;
  cipher2: string;
  hashAlgorithm: string;
  chunkSize: number;
  originalFileSize: number;
  saltHex: string;
  cipher1NonceHex: string;
  cipher2NonceHex: string;
}

export function headerToPreview(h: ContainerHeader): HeaderPreview {
  return {
    version: h.version,
    cascadeMode: (h.flags & FLAG_CASCADE) !== 0,
    hardwareBinding: (h.flags & FLAG_HARDWARE_BINDING) !== 0,
    metadataEncrypted: (h.flags & FLAG_METADATA_ENCRYPTED) !== 0,
    kdfAlgorithm: kdfIdToName(h.kdfId),
    kdfParams: h.kdfParams,
    cipher1: cipherIdToName(h.cipher1Id),
    cipher2: cipherIdToName(h.cipher2Id),
    hashAlgorithm: hashIdToName(h.hashAlgorithm),
    chunkSize: h.chunkSize,
    originalFileSize: h.originalFileSize,
    saltHex: toHexSafe(h.kdfSalt),
    cipher1NonceHex: toHexSafe(h.cipher1MasterNonce),
    cipher2NonceHex: toHexSafe(h.cipher2MasterNonce),
  };
}

export function kdfIdToName(id: number): string {
  switch (id) {
    case KDF_ARGON2ID:
      return 'Argon2id';
    default:
      return `unknown (0x${id.toString(16)})`;
  }
}

export function cipherIdToName(id: number): string {
  switch (id) {
    case CIPHER_AES_256_GCM_SIV:
      return 'AES-256-GCM-SIV';
    case CIPHER_CHACHA20_POLY1305:
      return 'ChaCha20-Poly1305';
    case CIPHER_XTS_AES_256:
      return 'XTS-AES-256';
    default:
      return `unknown (0x${id.toString(16)})`;
  }
}

export function hashIdToName(id: number): string {
  switch (id) {
    case HASH_BLAKE3:
      return 'BLAKE3-256';
    case HASH_SHA3_256:
      return 'SHA3-256';
    default:
      return `unknown (0x${id.toString(16)})`;
  }
}

function toHexSafe(b: Uint8Array): string {
  // Only show the first 8 bytes for preview, to avoid dumping full material.
  const head = b.subarray(0, Math.min(8, b.length));
  let s = '';
  for (let i = 0; i < head.length; i++) s += head[i].toString(16).padStart(2, '0');
  return s + (b.length > 8 ? '…' : '');
}

export const CONTAINER_CONSTANTS = {
  DEFAULT_CHUNK_SIZE,
  AEAD_TAG_SIZE,
  CASCADE_OVERHEAD_PER_CHUNK,
  ARGON2_OUTPUT_SIZE,
  BLAKE3_SIZE,
  VERSION,
};
