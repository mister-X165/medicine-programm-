/**
 * Public API of the CryptoVault crypto core.
 *
 * UI code imports from here — internal modules may change without notice.
 */

export {
  encryptFile,
  decryptFile,
  inspectContainer,
  runSelfTest,
  estimateGpuCrackTime,
  type EncryptOptions,
  type EncryptResult,
  type EncryptProgress,
  type DecryptResult,
  type EncryptProgressCallback,
  type DecryptProgressCallback,
} from './streaming';

export {
  ARGON2_PRESETS,
  DEFAULT_ARGON2_PRESET,
  DEFAULT_CHUNK_SIZE,
  MIN_PASSWORD_LENGTH,
  NONCE_SIZE,
  AES_KEY_SIZE,
  CHACHA_KEY_SIZE,
  ARGON2_OUTPUT_SIZE,
  BLAKE3_SIZE,
  AEAD_TAG_SIZE,
  CASCADE_OVERHEAD_PER_CHUNK,
  VERSION,
  MAGIC,
  type Argon2PresetName,
  type Argon2Params,
} from './constants';

export {
  constantTimeEqual,
  secureWipe,
  randomBytes,
  toHex,
  fromHex,
  toBase64,
  fromBase64,
  deriveNonce,
  estimatePasswordEntropyBits,
  METADATA_COUNTER,
} from './utils';

export { NonceTracker, NonceReuseError } from './nonce-tracker';
export {
  encryptChunk,
  decryptChunk,
  DecryptionError,
  wipeCascadeKeys,
  type CascadeKeys,
} from './cascade';

export {
  buildHeader,
  parseHeader,
  headerToPreview,
  computeBlake3,
  StreamingBlake3,
  encodeMetadata,
  decodeMetadata,
  cipherIdToName,
  kdfIdToName,
  hashIdToName,
  type ContainerHeader,
  type ContainerMetadata,
  type HeaderPreview,
} from './container';

export { deriveKeys, type DerivedKeyMaterial } from './kdf';
