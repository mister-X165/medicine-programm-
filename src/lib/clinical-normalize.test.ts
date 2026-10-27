import { describe, expect, it } from "vitest";
import type { AnalysisStructured } from "./types";
import { carryOverDoctorState, applyWorkupUpdate, sanitizeClinicalStructure } from "./clinical-normalize";

function base(overrides: Partial<AnalysisStructured> = {}): AnalysisStructured {
  return {
    differential: [
      {
        rank: 1,
        diagnosis: "Внебольничная пневмония",
        probability: 65,
        argumentsFor: ["a", "b"],
        argumentsAgainst: ["c"],
        workup: ["КТ"],
      },
      {
        rank: 1,
        diagnosis: "ТЭЛА",
        probability: 0.2,
        argumentsFor: ["a", "b"],
        argumentsAgainst: ["c"],
        workup: ["D-димер"],
      },
    ],
    workupPlan: [
      {
        name: "СРБ, количественно",
        priority: "routine",
        purpose: "воспаление",
        normalRange: "0–5 мг/л",
      },
      { name: "СРБ", priority: "urgent", interpretation: "растёт при инфекции" },
    ],
    therapyOptions: [
      {
        name: "Амоксициллин",
        regimen: "875 мг 2 раза в сутки",
        targetDx: "пневмония",
      },
      { name: "Амоксициллин", regimen: "875 мг 2 раза в сутки", targetDx: "пневмония" },
    ],
    monitoringPlan: [{ marker: "СРБ" }],
    verification: { performed: true, passes: 1, corrections: [] },
    ...overrides,
  };
}

describe("sanitizeClinicalStructure", () => {
  it("приводит вероятность 65 к доле 0.65 и перенумеровывает ранги", () => {
    const { structured, fixes } = sanitizeClinicalStructure(base());
    expect(structured.differential[0].probability).toBeCloseTo(0.65);
    expect(structured.differential.map((d) => d.rank)).toEqual([1, 2]);
    expect(fixes.join(" ")).toMatch(/Вероятность/);
  });

  it("объединяет дубль исследования, сохраняя приоритет и оба поля", () => {
    const { structured, fixes } = sanitizeClinicalStructure(base());
    expect(structured.workupPlan).toHaveLength(1);
    expect(structured.workupPlan[0].priority).toBe("urgent");
    expect(structured.workupPlan[0].normalRange).toBe("0–5 мг/л");
    expect(structured.workupPlan[0].interpretation).toContain("растёт");
    expect(fixes.join(" ")).toMatch(/дубль исследования/);
  });

  it("сопоставляет целевой диагноз терапии с названием гипотезы", () => {
    const { structured, fixes } = sanitizeClinicalStructure(base());
    expect(structured.therapyOptions[0].targetDx).toBe("Внебольничная пневмония");
    expect(fixes.join(" ")).toMatch(/сопоставлен с гипотезой/);
  });

  it("удаляет дубль терапевтической опции", () => {
    const { structured } = sanitizeClinicalStructure(base());
    expect(structured.therapyOptions).toHaveLength(1);
  });

  it("не удаляет терапию с несовпадающим диагнозом — только оставляет как есть", () => {
    const s = base({
      therapyOptions: [{ name: "Апиксабан", regimen: "5 мг", targetDx: "Фибрилляция предсердий" }],
    });
    const { structured } = sanitizeClinicalStructure(s);
    expect(structured.therapyOptions[0].targetDx).toBe("Фибрилляция предсердий");
  });

  it("сохраняет решения врача и служебные поля", () => {
    const s = base({
      confirmedDx: ["ТЭЛА"],
      workupTracker: { срб: { status: "ordered" } },
      patientSafety: { allergies: ["Пенициллины"] },
    });
    const { structured } = sanitizeClinicalStructure(s);
    expect(structured.confirmedDx).toEqual(["ТЭЛА"]);
    expect(structured.workupTracker?.срб.status).toBe("ordered");
    expect(structured.patientSafety?.allergies).toEqual(["Пенициллины"]);
  });

  it("удаляет пустые названия и собирает список исправлений", () => {
    const s = base({
      differential: [
        { rank: 1, diagnosis: "  ", probability: 0.5, argumentsFor: [], argumentsAgainst: [], workup: [] },
      ],
      workupPlan: [{ name: "", priority: "routine" }],
      therapyOptions: [{ name: "", regimen: "1 мг" }],
      monitoringPlan: [{ marker: "" }],
    });
    const { structured, fixes } = sanitizeClinicalStructure(s);
    expect(structured.differential).toHaveLength(0);
    expect(structured.workupPlan).toHaveLength(0);
    expect(structured.therapyOptions).toHaveLength(0);
    expect(structured.monitoringPlan).toHaveLength(0);
    expect(fixes.length).toBeGreaterThanOrEqual(4);
  });
});

describe("applyWorkupUpdate", () => {
  const now = "2026-10-25T12:00:00.000Z";

  it("создаёт запись с автором и временем", () => {
    const next = applyWorkupUpdate(
      { differential: [] },
      { name: "СРБ, количественно", status: "resulted", resultValue: "12 мг/л", updatedBy: "DOC-1" },
      now,
    );
    const tracker = next.workupTracker as Record<string, Record<string, unknown>>;
    expect(Object.keys(tracker)).toEqual(["срб количественно"]);
    expect(tracker["срб количественно"]).toMatchObject({
      status: "resulted",
      resultValue: "12 мг/л",
      resultAt: now,
      updatedBy: "DOC-1",
      updatedAt: now,
    });
  });

  it("не перезаписывает время результата, если результат не меняли", () => {
    const prev = {
      workupTracker: {
        срб: { status: "resulted", resultValue: "12", resultAt: "2026-01-01T00:00:00.000Z" },
      },
    };
    const next = applyWorkupUpdate(prev, { name: "СРБ", status: "completed" }, now);
    const entry = (next.workupTracker as Record<string, Record<string, unknown>>).срб;
    expect(entry.resultAt).toBe("2026-01-01T00:00:00.000Z");
    expect(entry.status).toBe("completed");
  });

  it("очищает запись при возврате в «В плане» без данных", () => {
    const prev = { workupTracker: { срб: { status: "resulted", resultValue: "12" } } };
    const next = applyWorkupUpdate(prev, { name: "СРБ", status: "planned" }, now);
    expect(next.workupTracker).toEqual({});
  });

  it("сохраняет комментарий в статусе «В плане»", () => {
    const next = applyWorkupUpdate({}, { name: "ЭКГ", status: "planned", comment: "отложено" }, now);
    expect((next.workupTracker as Record<string, { comment?: string }>).экг.comment).toBe("отложено");
  });

  it("не мутирует исходную структуру", () => {
    const prev: Record<string, unknown> = { workupTracker: {} };
    applyWorkupUpdate(prev, { name: "СРБ", status: "ordered" }, now);
    expect(prev.workupTracker).toEqual({});
  });

  it("возвращает структуру без изменений при пустом названии", () => {
    const prev = { workupTracker: {} };
    expect(applyWorkupUpdate(prev, { name: "   ", status: "ordered" }, now)).toBe(prev);
  });
});

describe("carryOverDoctorState", () => {
  const next = base({
    differential: [
      {
        rank: 1,
        diagnosis: "Внебольничная пневмония",
        probability: 0.6,
        argumentsFor: ["a", "b"],
        argumentsAgainst: ["c"],
        workup: [],
      },
    ],
  });

  it("переносит подтверждённый диагноз, который остался в новой версии", () => {
    const prev = base({ confirmedDx: ["Внебольничная пневмония", "ТЭЛА"] });
    const { structured, carried } = carryOverDoctorState(prev, next);
    expect(structured.confirmedDx).toEqual(["Внебольничная пневмония"]);
    expect(carried.confirmedDx).toBe(1);
  });

  it("переносит отметки трекера только по существующим исследованиям", () => {
    const prev = base({
      workupTracker: {
        срб: { status: "resulted", resultValue: "12" },
        "несуществующий тест": { status: "ordered" },
      },
    });
    const { structured, carried } = carryOverDoctorState(prev, next);
    expect(Object.keys(structured.workupTracker ?? {})).toEqual(["срб"]);
    expect(carried.workup).toBe(1);
  });

  it("не падает без предыдущей версии", () => {
    const { structured, carried } = carryOverDoctorState(null, next);
    expect(structured).toEqual(next);
    expect(carried).toEqual({ confirmedDx: 0, workup: 0 });
  });

  it("не оставляет пустых полей, если переносить нечего", () => {
    const prev = base({ confirmedDx: ["ТЭЛА"], workupTracker: { "несуществующий тест": { status: "ordered" } } });
    const { structured } = carryOverDoctorState(prev, next);
    expect(structured.confirmedDx).toBeUndefined();
    expect(structured.workupTracker).toBeUndefined();
  });
});
