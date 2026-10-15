/**
 * Argon2id Key Derivation Function.
 *
 * Uses the `hash-wasm` package which ships a hand-tuned WASM build of the
 * reference Argon2 implementation. This is the same algorithm family used
 * by the OWASP password storage cheat-sheet and is currently the recommended
 * KDF for password-based encryption.
 *
 * Output: 64 bytes — split into two 32-byte keys:
 *   key1 (AES-256-GCM-SIV) = output[0..32]
 *   key2 (ChaCha20-Poly1305) = output[32..64]
 */

import { argon2id } from 'hash-wasm';
import type { Argon2Params } from './constants';
import { ARGON2_OUTPUT_SIZE } from './constants';
import { secureWipe } from './utils';

export interface DerivedKeyMaterial {
  /** 32-byte key for AES-256-GCM-SIV (layer 1). */
  aesKey: Uint8Array;
  /** 32-byte key for ChaCha20-Poly1305 (layer 2). */
  chachaKey: Uint8Array;
}

/**
 * Derives two 256-bit keys from a password and salt using Argon2id.
 *
 * The password buffer is wiped from memory immediately after the KDF runs.
 * Callers should also wipe the source password string.
 */
export async function deriveKeys(
  password: string,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<DerivedKeyMaterial> {
  if (salt.length < 16) {
    throw new Error(`salt must be >= 16 bytes, got ${salt.length}`);
  }
  if (params.outputLength !== ARGON2_OUTPUT_SIZE) {
    throw new Error(`expected output length ${ARGON2_OUTPUT_SIZE}, got ${params.outputLength}`);
  }

  // Encode the password into a Uint8Array we control and can wipe.
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  let output: Uint8Array;
  try {
    output = await argon2id({
      password: passwordBytes,
      salt,
      parallelism: params.parallelism,
      memorySize: params.memoryKiB,
      hashLength: params.outputLength,
      iterations: params.iterations,
      outputType: 'binary',
    });
  } finally {
    secureWipe(passwordBytes);
  }

  const aesKey = output.slice(0, 32);
  const chachaKey = output.slice(32, 64);
  // Wipe the merged buffer; the two slices are independent copies.
  secureWipe(output);

  return { aesKey, chachaKey };
}

/**
 * Estimates the cost of an offline GPU brute-force attack against a
 * 20-character password derived with the given Argon2id parameters.
 *
 * Model: RTX 4090 achieves roughly 4 H/s per stream processor at the
 * "fast" preset (32 MiB). Memory-hardness scales inversely with throughput
 * because each hash requires allocating and clearing a large buffer.
 *
 * Returns a human-readable estimate. This is a rough order-of-magnitude
 * figure for the UI, not a formal security claim.
 */
export function estimateGpuCrackTime(
  passwordLength: number,
  params: Argon2Params,
): { years: number; label: string } {
  // Assume a 94-character alphabet (printable ASCII).
  const entropyBits = passwordLength * Math.log2(94);
  const combinations = Math.pow(2, entropyBits);

  // Baseline: RTX 4090 ~ 3500 H/s on Argon2id with 64 MiB / 3 iter.
  // Throughput scales inversely with memory and iterations.
  const baselineHps = 3500;
  const baselineMemory = 64 * 1024;
  const baselineIter = 3;
  const memoryFactor = baselineMemory / params.memoryKiB;
  const iterFactor = baselineIter / params.iterations;
  const hps = baselineHps * memoryFactor * iterFactor;

  const seconds = combinations / (2 * hps); // average = half the keyspace
  const years = seconds / (60 * 60 * 24 * 365);

  let label: string;
  if (years > 1e9) label = '> 10^9 лет';
  else if (years > 1e6) label = `≈ ${years.toExponential(1)} лет`;
  else if (years > 1) label = `≈ ${years.toFixed(0)} лет`;
  else if (years * 365 > 1) label = `≈ ${(years * 365).toFixed(0)} дней`;
  else label = '< 1 дня';

  return { years, label };
}
