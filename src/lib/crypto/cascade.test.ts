import { describe, it, expect } from "vitest";
import { encryptChunk, decryptChunk, DecryptionError } from "./cascade";
import { NonceTracker, NonceReuseError } from "./nonce-tracker";

function makeKeys() {
  return {
    aesKey: new Uint8Array(32).map((_, i) => i),
    chachaKey: new Uint8Array(32).map((_, i) => (i * 7 + 1) & 0xff),
  };
}

describe("cascade cipher (AES-256-GCM-SIV + ChaCha20-Poly1305)", () => {
  const masterNonceAes = new Uint8Array(12).fill(0xaa);
  const masterNonceChaCha = new Uint8Array(12).fill(0xbb);

  it("round-trips a chunk", () => {
    const plaintext = new TextEncoder().encode(
      "пациент: Иван Иванов, СНИЛС 123-456-789 01",
    );
    const keys = makeKeys();
    const ct = encryptChunk(plaintext, keys, masterNonceAes, masterNonceChaCha, 0, new NonceTracker());
    // 32 байта — суммарные теги двух слоёв AEAD.
    expect(ct.length).toBe(plaintext.length + 32);

    const pt = decryptChunk(ct, keys, masterNonceAes, masterNonceChaCha, 0, new NonceTracker());
    expect(Array.from(pt)).toEqual(Array.from(plaintext));
  });

  it("rejects tampered ciphertext (authenticated encryption)", () => {
    const plaintext = new TextEncoder().encode("hello world");
    const keys = makeKeys();
    const ct = encryptChunk(plaintext, keys, masterNonceAes, masterNonceChaCha, 0, new NonceTracker());

    const tampered = ct.slice();
    tampered[tampered.length - 1] ^= 0xff;

    expect(() =>
      decryptChunk(tampered, keys, masterNonceAes, masterNonceChaCha, 0, new NonceTracker()),
    ).toThrow(DecryptionError);
  });

  it("rejects too-short ciphertext", () => {
    const keys = makeKeys();
    expect(() =>
      decryptChunk(new Uint8Array(10), keys, masterNonceAes, masterNonceChaCha, 0, new NonceTracker()),
    ).toThrow(DecryptionError);
  });
});

describe("NonceTracker", () => {
  it("aborts and poisons on nonce reuse", () => {
    const tracker = new NonceTracker();
    const nonce = new Uint8Array(12).fill(1);
    tracker.register(nonce);
    expect(() => tracker.register(nonce)).toThrow(NonceReuseError);
    expect(tracker.isAborted()).toBe(true);
  });
});
