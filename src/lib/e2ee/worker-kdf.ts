// ============================================================================
// СППВР v2.7 — Пул Argon2id-воркеров (не блокирует UI)
// ============================================================================
// Единая точка входа для вывода Argon2id вне главного потока:
//   • ленивая инициализация module-worker'а (Turbopack/webpack совместимо)
//   • карта ожидающих запросов по id (несколько параллельных выводов)
//   • деградация: при недоступности Worker (старый браузер, CSP, ошибка
//     загрузки) вызывающий код получает null и переключается на главный
//     поток — функциональность не теряется, теряется только отзывчивость UI
// ============================================================================

import type { WorkerDeriveRequest } from "./argon2-worker";

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;

interface Pending {
  resolve: (output: Uint8Array) => void;
  reject: (err: Error) => void;
}
const pending = new Map<number, Pending>();

/** Лениво создаёт worker; возвращает null, если worker'ы недоступны. */
function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;

  try {
    worker = new Worker(new URL("./argon2-worker.ts", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, output, error } = e.data as {
        id: number;
        ok: boolean;
        output?: ArrayBuffer;
        error?: string;
      };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok && output) {
        p.resolve(new Uint8Array(output));
      } else {
        p.reject(new Error(error || "argon2-worker: неизвестная ошибка"));
      }
    };

    worker.onerror = () => {
      // Worker не загрузился/упал — переводим систему в режим главного потока
      workerBroken = true;
      for (const [, p] of pending) {
        p.reject(new Error("argon2-worker недоступен"));
      }
      pending.clear();
      worker?.terminate();
      worker = null;
    };

    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

export interface Argon2Request {
  password: Uint8Array;
  salt: Uint8Array;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/**
 * Argon2id вне главного потока. Возвращает 64 байта KEK-материала или null,
 * если worker недоступен (вызывающий код использует фолбэк на месте).
 * Буферы копируются structured-клоном — оригиналы остаются у отправителя.
 */
export async function argon2idOffThread(req: Argon2Request): Promise<Uint8Array | null> {
  const w = ensureWorker();
  if (!w) return null;

  // Копии буферов для клона: пароль — копия (оригинал затрёт отправитель),
  // соль публичная, но клонируем так же для простоты протокола.
  const passwordCopy = new Uint8Array(req.password);
  const saltCopy = new Uint8Array(req.salt);

  return new Promise<Uint8Array | null>((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      // Страховка от зависшего worker'а (WASM не должен так долго)
      pending.delete(id);
      resolve(null); // мягкая деградация: вызывающий код сделает фолбэк
    }, 60_000);

    pending.set(id, {
      resolve: (output) => {
        clearTimeout(timer);
        resolve(output);
      },
      reject: (err) => {
        clearTimeout(timer);
        // Ошибка вывода (не загрузки) — отдадим вызывающему null,
        // чтобы он попробовал главный поток
        resolve(null);
        void err;
      },
    });

    const msg: WorkerDeriveRequest = {
      id,
      password: passwordCopy.buffer,
      salt: saltCopy.buffer,
      memoryKiB: req.memoryKiB,
      iterations: req.iterations,
      parallelism: req.parallelism,
    };
    w.postMessage(msg);
  });
}

/** Для диагностики: жив ли worker-путь. */
export function argon2WorkerAvailable(): boolean {
  return !workerBroken && typeof Worker !== "undefined";
}
