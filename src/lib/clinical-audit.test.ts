import { describe, expect, it } from "vitest";
import type { AnalysisStructured, DifferentialDiagnosis, TherapyOption } from "./types";
import {
  auditAnalysis,
  auditSummary,
  drugMatchesAllergen,
  therapyTargetMatchesDx,
} from "./clinical-audit";

function dx(partial: Partial<DifferentialDiagnosis> & { diagnosis: string; rank: number }): DifferentialDiagnosis {
  return {
    probability: 0.5,
    argumentsFor: ["аргумент 1", "аргумент 2"],
    argumentsAgainst: ["аргумент против"],
    workup: ["тест"],
    ...partial,
  };
}

function therapy(partial: Partial<TherapyOption> & { name: string }): TherapyOption {
  return {
    regimen: "5 мг внутрь 1 раз в сутки 5 дней",
    targetDx: "Пневмония",
    caution: "контроль функции почек",
    source: "КР Минздрава РФ 601",
    evidenceLevel: "B",
    ...partial,
  };
}

function baseStructured(overrides: Partial<AnalysisStructured> = {}): AnalysisStructured {
  return {
    differential: [
      dx({ diagnosis: "Внебольничная пневмония", rank: 1, probability: 0.6, icd10: "J18.9" }),
      dx({ diagnosis: "Тромбоэмболия лёгочной артерии", rank: 2, probability: 0.25 }),
      dx({ diagnosis: "Острый бронхит", rank: 3, probability: 0.15 }),
    ],
    workupPlan: [
      {
        name: "СРБ",
        priority: "urgent",
        purpose: "оценка воспаления",
        targetDxConfirm: ["Внебольничная пневмония"],
        normalRange: "0–5 мг/л",
        confirmsIf: "> 100 мг/л",
      },
      {
        name: "D-димер",
        priority: "high",
        purpose: "исключить ТЭЛА",
        targetDxRefute: ["Тромбоэмболия лёгочной артерии"],
        cutoffs: "до 500 нг/мл",
        refutesIf: "< 500 нг/мл",
      },
    ],
    therapyOptions: [therapy({ name: "Амоксициллин" })],
    monitoringPlan: [{ marker: "СРБ", frequency: "через 72 часа", target: "снижение" }],
    verification: { performed: true, passes: 1, corrections: [] },
    ...overrides,
  };
}

describe("therapyTargetMatchesDx", () => {
  it("сопоставляет по вложенности названий", () => {
    expect(
      therapyTargetMatchesDx("Внебольничная пневмония", [
        "Внебольничная пневмония, средней степени тяжести",
      ]),
    ).toBe(true);
  });

  it("не сопоставляет разные диагнозы", () => {
    expect(therapyTargetMatchesDx("Сахарный диабет 2 типа", ["Пневмония"])).toBe(false);
  });

  it("не сопоставляет пустую строку", () => {
    expect(therapyTargetMatchesDx("", ["Пневмония"])).toBe(false);
  });
});

describe("drugMatchesAllergen", () => {
  it("ловит совпадение по корню", () => {
    expect(drugMatchesAllergen("Амоксициллин", "пенициллины")).toBe(false);
    expect(drugMatchesAllergen("Амоксициллин", "амоксициллин")).toBe(true);
    expect(drugMatchesAllergen("Пенициллин G", "пенициллин")).toBe(true);
  });

  it("не срабатывает на короткие строки", () => {
    expect(drugMatchesAllergen("Аспирин", "АС")).toBe(false);
  });
});

describe("auditAnalysis — структура набора рекомендаций", () => {
  it("корректный набор не даёт критических замечаний", () => {
    const report = auditAnalysis({ structured: baseStructured(), citationsCount: 3 });
    expect(report.critical).toBe(0);
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.readiness).toBe("high");
  });

  it("пустой набор — критично", () => {
    const report = auditAnalysis({ structured: null });
    expect(report.findings.map((f) => f.id)).toContain("dx-empty");
    expect(report.critical).toBeGreaterThan(0);
    expect(report.readiness).toBe("low");
  });

  it("две гипотезы — ряд неполон", () => {
    const s = baseStructured({
      differential: [
        dx({ diagnosis: "A", rank: 1, probability: 0.8 }),
        dx({ diagnosis: "B", rank: 2, probability: 0.2 }),
      ],
      workupPlan: [
        { name: "Тест A", priority: "high", targetDxConfirm: ["A"], normalRange: "0-1" },
        { name: "Тест B", priority: "routine", targetDxConfirm: ["B"], normalRange: "0-1" },
      ],
      therapyOptions: [therapy({ name: "Препарат", targetDx: "A" })],
    });
    expect(auditAnalysis({ structured: s }).findings.map((f) => f.id)).toContain("dx-few");
  });

  it("нарушенный порядок вероятностей и сумма > 100%", () => {
    const s = baseStructured({
      differential: [
        dx({ diagnosis: "A", rank: 1, probability: 0.3 }),
        dx({ diagnosis: "B", rank: 2, probability: 0.9 }),
        dx({ diagnosis: "C", rank: 3, probability: 0.4 }),
      ],
    });
    const ids = auditAnalysis({ structured: s }).findings.map((f) => f.id);
    expect(ids).toContain("dx-probability-order");
    expect(ids).toContain("dx-probability-sum");
  });

  it("гипотеза без аргументов против и без обследования", () => {
    const s = baseStructured({
      differential: [
        dx({ diagnosis: "A", rank: 1, probability: 0.7, argumentsAgainst: [], workup: [] }),
        dx({ diagnosis: "B", rank: 2, probability: 0.2 }),
        dx({ diagnosis: "C", rank: 3, probability: 0.1 }),
      ],
      workupPlan: [{ name: "Тест", priority: "high", targetDxConfirm: ["C"], normalRange: "0-1" }],
    });
    const ids = auditAnalysis({ structured: s }).findings.map((f) => f.id);
    expect(ids).toContain("dx-no-counter");
    expect(ids).toContain("dx-no-workup");
  });

  it("дубли исследований", () => {
    const s = baseStructured({
      workupPlan: [
        { name: "СРБ", priority: "urgent" },
        { name: "срб, количественно", priority: "routine" },
      ],
    });
    expect(auditAnalysis({ structured: s }).findings.map((f) => f.id)).toContain(
      "workup-duplicates",
    );
  });

  it("терапия без целевого диагноза и с чужим диагнозом — критично", () => {
    const s = baseStructured({
      therapyOptions: [
        therapy({ name: "Препарат 1", targetDx: undefined }),
        therapy({ name: "Препарат 2", targetDx: "Сахарный диабет 2 типа" }),
      ],
    });
    const report = auditAnalysis({ structured: s });
    const ids = report.findings.map((f) => f.id);
    expect(ids).toContain("therapy-no-target");
    expect(ids).toContain("therapy-orphan");
    expect(report.critical).toBeGreaterThanOrEqual(2);
  });

  it("терапия без дозы, предупреждений и источника", () => {
    const s = baseStructured({
      therapyOptions: [
        therapy({ name: "Амоксициллин", regimen: "внутрь", caution: undefined, source: undefined }),
      ],
    });
    const ids = auditAnalysis({ structured: s }).findings.map((f) => f.id);
    expect(ids).toContain("therapy-no-dose");
    expect(ids).toContain("therapy-no-caution");
    expect(ids).toContain("therapy-no-source");
  });

  it("аллергия пациента на предложенный препарат — критично", () => {
    const s = baseStructured({
      therapyOptions: [therapy({ name: "Амоксициллин" })],
      patientSafety: { allergies: ["Пенициллины", "амоксициллин"] },
    });
    const report = auditAnalysis({ structured: s });
    const finding = report.findings.find((f) => f.id === "safety-allergy");
    expect(finding?.severity).toBe("critical");
    expect(finding?.detail).toContain("амоксициллин");
  });

  it("терапия без мониторинга", () => {
    const s = baseStructured({ monitoringPlan: [] });
    const ids = auditAnalysis({ structured: s }).findings.map((f) => f.id);
    expect(ids).toContain("monitoring-empty");
  });

  it("без самопроверки — информационное замечание", () => {
    const s = baseStructured({
      verification: { performed: false, passes: 0, corrections: [] },
    });
    const ids = auditAnalysis({ structured: s }).findings.map((f) => f.id);
    expect(ids).toContain("verification-not-run");
  });

  it("сортирует замечания по убыванию важности", () => {
    const s = baseStructured({ therapyOptions: [therapy({ name: "X", targetDx: undefined })] });
    const report = auditAnalysis({ structured: s });
    const sev = report.findings.map((f) => f.severity);
    const firstWarning = sev.indexOf("warning");
    const lastCritical = sev.lastIndexOf("critical");
    if (firstWarning >= 0 && lastCritical >= 0) expect(lastCritical).toBeLessThan(firstWarning);
  });

  it("сводка описывает количество замечаний", () => {
    const report = auditAnalysis({ structured: baseStructured() });
    expect(auditSummary(report)).toMatch(/замечан|внимани/);
  });
});
