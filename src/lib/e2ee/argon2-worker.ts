// ============================================================================
// СППВР v2.7 — Web Worker: вывод Argon2id вне главного потока
// ============================================================================
// Причина: Argon2id (64 MiB / 3 итер.) занимает 0.7–1.5 с CPU. На главном
// потоке это замораживает UI (спиннеры не крутятся, вкладка «не отвечает»).
// Worker выводит ключ параллельно, UI остаётся отзывчивым.
//
// Протокол (postMessage):
//   → { id, password: ArrayBuffer, salt: ArrayBuffer, memoryKiB, iterations, parallelism }
//   ← { id, ok: true, output: ArrayBuffer }  (transfer, без копии)
//   ← { id, ok: false, error: string }
//
// Буфер пароля копируется при клоне (structured clone) — оригинал остаётся
// у отправителя и затирается secureWipe. Worker затирает СВОЮ копию после
// вывода ключа. Ключ возвращается transfer'ом — в памяти worker'а копий нет.
// ============================================================================

import { argon2id } from "hash-wasm";

export interface WorkerDeriveRequest {
  id: number;
  password: ArrayBuffer;
  salt: ArrayBuffer;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

interface WorkerDeriveResponse {
  id: number;
  ok: boolean;
  output?: ArrayBuffer;
  error?: string;
}

self.onmessage = async (e: MessageEvent<WorkerDeriveRequest>) => {
  const { id, password, salt, memoryKiB, iterations, parallelism } = e.data;
  const passwordBytes = new Uint8Array(password);
  const saltBytes = new Uint8Array(salt);
  try {
    const output = (await argon2id({
      password: passwordBytes,
      salt: saltBytes,
      parallelism,
      memorySize: memoryKiB,
      hashLength: 64, // 32 (AES) + 32 (ChaCha) — KEK каскада
      iterations,
      outputType: "binary",
    })) as unknown as Uint8Array;

    // Затираем копию пароля в worker'е ДО ответа (output передаётся transfer'ом)
    passwordBytes.fill(0);

    // v2.7.2 (audit fix): hash-wasm типизирует buffer как ArrayBufferLike —
    // в рантайме это всегда обычный ArrayBuffer, безопасно приводим для transfer.
    const outputBuffer = output.buffer as ArrayBuffer;
    const res: WorkerDeriveResponse = { id, ok: true, output: outputBuffer };
    (self as unknown as Worker).postMessage(res, [outputBuffer]);
  } catch (err) {
    passwordBytes.fill(0);
    const res: WorkerDeriveResponse = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(res);
  }
};
