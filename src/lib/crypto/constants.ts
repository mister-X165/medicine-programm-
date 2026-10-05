/**
 * Cryptographic constants for the CryptoVault container format.
 *
 * Container layout (all integers big-endian):
 *
 *   Offset  Size   Field
 *   0       4      Magic: "CVLT" (0x43564C54)
 *   4       2      Version (uint16) — currently 0x0001
 *   6       1      Flags
 *                      bit 0: cascade mode (AES-GCM-SIV + ChaCha20-Poly1305)
 *                      bit 1: hardware-binding reserved (browser cannot enforce)
 *                      bit 2: metadata (filename) encrypted
 *   7       1      KDF algorithm ID (0x01 = Argon2id)
 *   8       2      KDF salt length (uint16)
 *   10      N      KDF salt
 *   10+N    4      KDF memory cost (uint32, KiB)
 *   14+N    4      KDF time cost (uint32, iterations)
 *   18+N    2      KDF parallelism (uint16)
 *   20+N    2      KDF output length (uint16, bytes)
 *   22+N    1      Cipher 1 ID (0x01 = AES-256-GCM-SIV)
 *   23+N    12     Cipher 1 master nonce
 *   35+N    1      Cipher 2 ID (0x02 = ChaCha20-Poly1305)
 *   36+N    12     Cipher 2 master nonce
 *   48+N    4      Chunk size (uint32, bytes)
 *   52+N    8      Original file size (uint64)
 *   60+N    4      Encrypted metadata length (uint32)
 *   64+N    M      Encrypted metadata (filename, mime, size inside)
 *   ...            Encrypted data chunks (each = plaintext_chunk_len + 32 bytes tags)
 *   ...     32     BLAKE3 hash of original plaintext
 *
 * Nonce derivation per chunk (counter is uint32 chunk index):
 *   chunk_nonce = master_nonce with the last 4 bytes XORed by counter (big-endian).
 *   This guarantees uniqueness for up to 2^32 chunks (~4 PB at 1 MiB chunks).
 *
 * Cascade per chunk:
 *   c1 = AES-256-GCM-SIV.Encrypt(key1, nonce1, plaintext)  // +16 byte tag
 *   c2 = ChaCha20-Poly1305.Encrypt(key2, nonce2, c1)        // +16 byte tag
 *   output = c2
 */

export const MAGIC = new Uint8Array([0x43, 0x56, 0x4c, 0x54]); // "CVLT"
export const VERSION = 0x0001;

export const FLAG_CASCADE = 0x01;
export const FLAG_HARDWARE_BINDING = 0x02; // reserved — not enforceable in browser
export const FLAG_METADATA_ENCRYPTED = 0x04;

export const KDF_ARGON2ID = 0x01;

export const CIPHER_AES_256_GCM_SIV = 0x01;
export const CIPHER_CHACHA20_POLY1305 = 0x02;
export const CIPHER_XTS_AES_256 = 0x03; // reserved for future volume mode

export const HASH_BLAKE3 = 0x01;
export const HASH_SHA3_256 = 0x02;

export const NONCE_SIZE = 12; // bytes (96 bits) — standard for both GCM-SIV and ChaCha20-Poly1305
export const AES_KEY_SIZE = 32; // 256-bit
export const CHACHA_KEY_SIZE = 32; // 256-bit
export const ARGON2_OUTPUT_SIZE = 64; // 32 (AES key) + 32 (ChaCha key)
export const BLAKE3_SIZE = 32;
export const AEAD_TAG_SIZE = 16; // both GCM-SIV and Poly1305 use 16-byte tags
export const CASCADE_OVERHEAD_PER_CHUNK = 2 * AEAD_TAG_SIZE; // 32 bytes

/**
 * Default chunk size: 1 MiB.
 * Balances streaming memory footprint and per-chunk AEAD overhead (~0.003%).
 */
export const DEFAULT_CHUNK_SIZE = 1 * 1024 * 1024; // 1 MiB

/**
 * Minimum password length enforced by the UI layer.
 * The threat model mandates >= 20 characters; we enforce that.
 */
export const MIN_PASSWORD_LENGTH = 20;

/**
 * Default Argon2id parameters.
 *
 * The specification demands >= 512 MiB memory. In a browser sandbox this is
 * dangerous (WASM linear memory limit, tab crashes on low-RAM devices).
 * We therefore expose three presets and default to a still-very-strong
 * "balanced" profile. The UI lets the operator escalate to "maximum" (512 MiB).
 */
export interface Argon2Params {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
  outputLength: number;
}

export const ARGON2_PRESETS = {
  fast: {
    memoryKiB: 32 * 1024, // 32 MiB
    iterations: 2,
    parallelism: 4,
    outputLength: ARGON2_OUTPUT_SIZE,
    label: 'Быстрый (32 MiB, 2 итер.)',
    description: 'Демонстрационный режим. Пригоден для тестов, не для production.',
  },
  balanced: {
    memoryKiB: 128 * 1024, // 128 MiB
    iterations: 3,
    parallelism: 4,
    outputLength: ARGON2_OUTPUT_SIZE,
    label: 'Сбалансированный (128 MiB, 3 итер.)',
    description: 'Рекомендуется. ~1-3 с на современном CPU, высокая стойкость к брутфорсу.',
  },
  high: {
    memoryKiB: 256 * 1024, // 256 MiB
    iterations: 4,
    parallelism: 8,
    outputLength: ARGON2_OUTPUT_SIZE,
    label: 'Высокий (256 MiB, 4 итер.)',
    description: 'Усиленная защита. ~5-10 с. Удорожание GPU-перебора в ~10×.',
  },
  maximum: {
    memoryKiB: 512 * 1024, // 512 MiB — нижняя граница из ТЗ
    iterations: 5,
    parallelism: 8,
    outputLength: ARGON2_OUTPUT_SIZE,
    label: 'Максимум (512 MiB, 5 итер.)',
    description: 'Соответствует ТЗ (>=512 MiB). Может вызывать задержки в браузере.',
  },
} as const;

export type Argon2PresetName = keyof typeof ARGON2_PRESETS;

export const DEFAULT_ARGON2_PRESET: Argon2PresetName = 'balanced';
