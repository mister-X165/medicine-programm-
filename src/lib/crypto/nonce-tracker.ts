/**
 * Nonce-uniqueness tracker.
 *
 * The threat model mandates: "Повторное использование nonce блокируется на
 * уровне ядра криптографии" — nonce reuse must be detected and aborted.
 *
 * Although our counter-based derivation makes collisions impossible by
 * construction, we still maintain this tracker as defence-in-depth: if a
 * programming error or future code path ever fed a duplicate nonce to an
 * AEAD primitive, the tracker throws NonceReuseError and the operation
 * aborts immediately. No ciphertext produced after such a detection is
 * ever emitted.
 */

import { toHex } from './utils';

export class NonceReuseError extends Error {
  constructor(public readonly nonceHex: string) {
    super(
      `FATAL: nonce reuse detected (nonce=${nonceHex}). Operation aborted to protect confidentiality.`,
    );
    this.name = 'NonceReuseError';
  }
}

export class NonceTracker {
  private seen = new Set<string>();
  private aborted = false;

  /**
   * Records a nonce. Throws NonceReuseError if the nonce has already been seen.
   * Once aborted, the tracker is poisoned and rejects all further calls.
   */
  register(nonce: Uint8Array): void {
    if (this.aborted) {
      throw new NonceReuseError('<poisoned>');
    }
    const hex = toHex(nonce);
    if (this.seen.has(hex)) {
      this.aborted = true;
      this.seen.clear();
      throw new NonceReuseError(hex);
    }
    this.seen.add(hex);
  }

  /**
   * Returns true once the tracker has been poisoned (i.e. an abort happened).
   */
  isAborted(): boolean {
    return this.aborted;
  }

  /**
   * Clears state. Should only be called after a successful operation.
   * Sensitive material (the hex strings) is dropped from memory.
   */
  reset(): void {
    this.seen.clear();
    this.aborted = false;
  }

  size(): number {
    return this.seen.size;
  }
}
