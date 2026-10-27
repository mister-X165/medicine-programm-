import { describe, expect, it } from "vitest";
import type { WorkupItem, WorkupTracker } from "./types";
import {
  compareValueToRange,
  normalizeWorkupKey,
  parseReferenceRange,
  planToText,
  sortWorkupByPriority,
  workupKey,
  workupProgress,
  workupStatusMeta,
} from "./workup";

function item(partial: Partial<WorkupItem> & { name: string }): WorkupItem {
  return { priority: "routine", ...partial };
}

describe("normalizeWorkupKey", () => {
  it("устойчив к регистру, «ё», кавычкам и пунктуации", () => {
    expect(normalizeWorkupKey("Тропонин I, высокочувствительный")).toBe(
      normalizeWorkupKey("  тропонин  i высокочувствительный "),
    );
    expect(normalizeWorkupKey("Общий анализ крови (ОАК)")).toBe("общий анализ крови оак");
  });

  it("совпадает у одного и того же исследования из двух версий заключения", () => {
    const a = workupKey(item({ name: "СРБ, количественно" }), 0);
    const b = workupKey(item({ name: "срб, количественно" }), 7);
    expect(a).toBe(b);
  });

  it("не даёт пустой ключ", () => {
    expect(workupKey(item({ name: "***" }), 4)).toBe("item-4");
  });
});

describe("parseReferenceRange", () => {
  it("разбирает диапазон с запятой и единицей", () => {
    const r = parseReferenceRange("0,0–0,04 нг/мл");
    expect(r).toMatchObject({ min: 0, max: 0.04 });
    expect(r?.unit).toContain("нг/мл");
  });

  it("разбирает диапазон с точкой и дефисом", () => {
    expect(parseReferenceRange("3.5 - 5.5 ммоль/л")).toMatchObject({ min: 3.5, max: 5.5 });
  });

  it("берёт первый диапазон из составной строки", () => {
    expect(
      parseReferenceRange("Норма 0–0.04 нг/мл; серая зона 0.04–0.40; ≥ 0.40 — патология"),
    ).toMatchObject({ min: 0, max: 0.04 });
  });

  it("понимает верхнюю и нижнюю границу", () => {
    expect(parseReferenceRange("не более 30")).toMatchObject({ max: 30 });
    expect(parseReferenceRange("≥ 40")).toMatchObject({ min: 40 });
    expect(parseReferenceRange("до 5,5")).toMatchObject({ max: 5.5 });
  });

  it("возвращает null, если чисел нет", () => {
    expect(parseReferenceRange("отрицательный")).toBeNull();
    expect(parseReferenceRange(undefined)).toBeNull();
  });
});

describe("compareValueToRange", () => {
  it("определяет превышение нормы", () => {
    const c = compareValueToRange("0.12 нг/мл", "0,0–0,04 нг/мл");
    expect(c.verdict).toBe("above");
    expect(c.value).toBeCloseTo(0.12);
    expect(c.label).toContain("выше нормы");
  });

  it("определяет значение в пределах нормы", () => {
    expect(compareValueToRange("4,2", "3.5-5.5")).toMatchObject({ verdict: "within" });
  });

  it("определяет значение ниже нормы", () => {
    expect(compareValueToRange("2.1", "3.5-5.5")).toMatchObject({ verdict: "below" });
  });

  it("не притворяется, что понял нечисловой результат", () => {
    expect(compareValueToRange("отрицательный", "0-1")).toMatchObject({ verdict: "unknown" });
  });

  it("не сравнивает без референса", () => {
    const c = compareValueToRange("0.12", "");
    expect(c.verdict).toBe("unknown");
    expect(c.label).toContain("референс не распознан");
  });
});

describe("workupProgress", () => {
  const items = [
    item({ name: "Тропонин I", priority: "urgent" }),
    item({ name: "ОАК", priority: "high" }),
    item({ name: "ЭКГ", priority: "routine" }),
  ];

  it("считает закрытые пункты и результат", () => {
    const tracker: WorkupTracker = {
      [normalizeWorkupKey("Тропонин I")]: { status: "resulted", resultValue: "0.12" },
      [normalizeWorkupKey("ОАК")]: { status: "ordered" },
      [normalizeWorkupKey("ЭКГ")]: { status: "cancelled" },
    };
    const p = workupProgress(items, tracker);
    expect(p).toMatchObject({ total: 3, done: 1, ordered: 1, cancelled: 1, withResult: 1 });
    expect(p.pct).toBe(33);
  });

  it("без трекера всё в плане", () => {
    expect(workupProgress(items).pct).toBe(0);
    expect(workupProgress([]).pct).toBe(0);
  });
});

describe("sortWorkupByPriority", () => {
  it("ставит срочные первыми, сохраняя исходный порядок внутри группы", () => {
    const sorted = sortWorkupByPriority([
      item({ name: "A", priority: "routine" }),
      item({ name: "B", priority: "urgent" }),
      item({ name: "C", priority: "high" }),
      item({ name: "D", priority: "urgent" }),
    ]);
    expect(sorted.map((i) => i.name)).toEqual(["B", "D", "C", "A"]);
  });
});

describe("workupStatusMeta", () => {
  it("падает на planned для неизвестного статуса", () => {
    expect(workupStatusMeta("unknown").label).toBe("В плане");
    expect(workupStatusMeta("resulted").done).toBe(true);
  });
});

describe("planToText", () => {
  const items = [
    item({
      name: "Тропонин I",
      priority: "urgent",
      timing: "в течение 1 часа",
      targetDxConfirm: ["ОКС"],
      normalRange: "0–0.04 нг/мл",
    }),
    item({ name: "ОАК", priority: "routine" }),
  ];

  it("включает статус, срок и результат", () => {
    const tracker: WorkupTracker = {
      [normalizeWorkupKey("Тропонин I")]: {
        status: "resulted",
        resultValue: "0.12 нг/мл",
        comment: "контроль через 3 часа",
      },
    };
    const text = planToText(items, tracker, { caseCode: "CASE-1", versionLabel: "v2" });
    expect(text).toContain("CASE-1");
    expect(text).toContain("[СРОЧНО]");
    expect(text).toContain("срок: в течение 1 часа");
    expect(text).toContain("результат: 0.12 нг/мл (выше нормы");
    expect(text).toContain("Комментарий врача: контроль через 3 часа");
    expect(text).toContain("2. [плановое] ОАК");
  });

  it("пустой план — пустая строка", () => {
    expect(planToText([])).toBe("");
  });
});
