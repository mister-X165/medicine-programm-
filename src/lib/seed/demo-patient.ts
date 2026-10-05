// СППВР - Демонстрационные данные пациента
// Сидируется при первой инициализации системы для демонстрации функционала.

// ============================================================================
// Данные демо-пациента: женщина 56 лет, онкологический случай (рак молочной железы),
// фармакогенетическое тестирование, полная ЭМК с визитами, показателями,
// медикаментами (с потенциальными DDI), лаб. результатами и планом ведения.
// ============================================================================

export const DEMO_PATIENT = {
  token: "П-2024-0001",
  lastName: "Иванова",
  firstName: "Елена",
  middleName: "Сергеевна",
  birthDate: "1968-03-15T00:00:00.000Z" as string,
  sex: "Ж",
  bloodType: "A(II)+",
  height: 165,
  weight: 72,
  phone: "",
  email: "",
  address: "",
  snils: "",
  omiPolicy: "",
  nationality: "РФ",
  occupation: "Бухгалтер",
  smokingStatus: "never" as const,
  alcoholUse: "occasional" as const,
  allergies: JSON.stringify([
    { allergen: "Пенициллин", reaction: "Крапивница", severity: "moderate", notedAt: "2015-06-10" },
    { allergen: "Йод (контраст)", reaction: "Ангиоотёк", severity: "severe", notedAt: "2020-01-22" },
  ]),
  chronicDiseases: JSON.stringify([
    { name: "Артериальная гипертензия", icd10: "I10", diagnosedAt: "2018-09-01", status: "controlled" },
    { name: "Сахарный диабет 2 типа", icd10: "E11.9", diagnosedAt: "2020-11-15", status: "controlled" },
  ]),
  familyHistory: JSON.stringify([
    { relation: "Мать", condition: "Рак молочной железы", notes: "Диагностирован в 55 лет" },
    { relation: "Сестра", condition: "Рак яичников", notes: "Диагностирован в 48 лет" },
  ]),
  status: "active" as const,
  notes: "Демонстрационный пациент. Семейный анамнез отягощён по раку молочной железы и яичников.",
};

export const DEMO_CASE = {
  caseCode: "СЛЧ-2024-0001",
  patientToken: DEMO_PATIENT.token,
  birthYear: 1968,
  sex: "Ж",
  status: "analyzed" as const,
  diagnosisHint: "Рак левой молочной железы T2N1M0, IIА стадия. BRCA1-мутация.",
  notes: "Пациентка направлена на фармакогенетическое тестирование перед назначением химиотерапии. Семейный анамнез: мать - РМЖ, сестра - рак яичников.",
};

export const DEMO_VISIT = {
  visitType: "outpatient" as const,
  status: "completed" as const,
  chiefComplaint: "Пальпируемое уплотнение в левой молочной железе, обнаруженное 2 недели назад.",
  visitReason: "Консультация онколога, уточнение диагноза, назначение лечения",
  soapSubjective:
    "Пациентка 56 лет жалуется на безболезненное уплотнение в верхне-наружном квадранте левой молочной железы, обнаруженное при самообследовании 14 дней назад. Отмечает увеличение подмышечных лимфоузлов слева. Снижения массы тела, слабости, ночных потов отрицает. Менопауза с 51 года.",
  soapObjective:
    "В ВНКЛ левой молочной железы пальпируется образование 2.5x2.0 см, плотное, бугристое, слабо подвижное, безболезненное. Кожа над образованием не изменена. В левой подмышечной области пальпируются 2 увеличенных лимфоузла до 1.5 см, плотноэластической консистенции. Правая молочная железа без патологии.",
  soapAssessment:
    "Образование левой молочной железы T2N1M0, клиническая стадия IIA. Показано гистологическое верифицирование, иммуногистохимическое исследование, фармакогенетическое тестирование.",
  soapPlan:
    "1. Трепан-биопсия образования левой МЖ. 2. УЗИ органов брюшной полости, рентгенография органов грудной клетки. 3. МРТ молочных желёз. 4. Фармакогенетический панель (CYP2D6, DPYD, TPMT, UGT1A1). 5. Генетическое тестирование BRCA1/2. 6. Консилиум для определения тактики лечения.",
  diagnosis: JSON.stringify([
    { icd10: "C50.9", description: "Злокачественное новообразование молочной железы, неуточнённой локализации", type: "main" },
    { icd10: "C77.3", description: "Поражение лимфоузлов подмышечной и подключичной областей", type: "concomitant" },
    { icd10: "Z80.3", description: "Наследственная предрасположенность к злокачественным новообразованиям молочной железы", type: "concomitant" },
  ]),
  prescriptions: JSON.stringify([
    { drug: "Тамоксифен 20 мг", frequency: "1 раз в день", duration: "5 лет" },
    { drug: "Анастрозол 1 мг", frequency: "1 раз в день", duration: "5 лет (альтернатива)" },
    { drug: "Золедроновая кислота 4 мг", frequency: "1 раз в 6 месяцев", duration: "3 года" },
  ]),
  scheduledAt: "2024-06-15T09:00:00.000Z" as string,
  startedAt: "2024-06-15T09:15:00.000Z" as string,
  completedAt: "2024-06-15T10:30:00.000Z" as string,
  durationMin: 75,
};

export const DEMO_VITAL_SIGNS: Array<{
  recordedAt: string; systolicBP: number; diastolicBP: number; heartRate: number;
  respiratoryRate: number; temperature: number; oxygenSaturation: number;
  height: number; weight: number; bmi: number; painScore?: number; notes: string;
}> = [
  {
    recordedAt: "2024-06-15T09:20:00.000Z", systolicBP: 142, diastolicBP: 88, heartRate: 78,
    respiratoryRate: 16, temperature: 36.6, oxygenSaturation: 98, height: 165, weight: 72,
    bmi: 26.4, notes: "Визит 1: первичный осмотр",
  },
  {
    recordedAt: "2024-07-10T09:00:00.000Z", systolicBP: 138, diastolicBP: 85, heartRate: 74,
    respiratoryRate: 16, temperature: 36.5, oxygenSaturation: 99, height: 165, weight: 70.5,
    bmi: 25.9, notes: "Перед началом химиотерапии",
  },
  {
    recordedAt: "2024-07-25T09:00:00.000Z", systolicBP: 145, diastolicBP: 92, heartRate: 82,
    respiratoryRate: 18, temperature: 37.2, oxygenSaturation: 97, height: 165, weight: 69,
    bmi: 25.3, painScore: 3, notes: "После 1-го цикла ХТ. Нейтропения II степени.",
  },
  {
    recordedAt: "2024-08-15T09:00:00.000Z", systolicBP: 136, diastolicBP: 84, heartRate: 76,
    respiratoryRate: 16, temperature: 36.7, oxygenSaturation: 98, height: 165, weight: 68,
    bmi: 25.0, notes: "После 2-го цикла ХТ. Улучшение.",
  },
];

export const DEMO_MEDICATIONS: Array<{
  drugName: string; brandName: string; form: string; dosage: string;
  route: string; frequency: string; duration: string;
  startDate: string; endDate?: string; status: string;
  indication: string; notes: string;
}> = [
  {
    drugName: "Тамоксифен", brandName: "Нолвадекс", form: "tablet",
    dosage: "20 мг", route: "oral", frequency: "1 раз в день утром",
    duration: "5 лет", startDate: "2024-08-01T00:00:00.000Z",
    status: "active", indication: "Адъювантная гормонотерапия РМЖ, ER+",
    notes: "CYP2D6 промежуточный метаболизатор - рассмотреть анастрозол",
  },
  {
    drugName: "Периндоприл", brandName: "Престанс", form: "tablet",
    dosage: "5 мг", route: "oral", frequency: "1 раз в день утром",
    duration: "Постоянно", startDate: "2018-09-01T00:00:00.000Z",
    status: "active", indication: "Артериальная гипертензия",
    notes: "",
  },
  {
    drugName: "Метформин", brandName: "Глюкофаж", form: "tablet",
    dosage: "850 мг", route: "oral", frequency: "2 раза в день во время еды",
    duration: "Постоянно", startDate: "2020-11-15T00:00:00.000Z",
    status: "active", indication: "Сахарный диабет 2 типа",
    notes: "",
  },
  {
    drugName: "Ондансетрон", brandName: "Зофран", form: "tablet",
    dosage: "8 мг", route: "oral", frequency: "По необходимости",
    duration: "На период ХТ", startDate: "2024-07-15T00:00:00.000Z",
    endDate: "2024-11-15T00:00:00.000Z",
    status: "active", indication: "Противорвотная терапия при ХТ",
    notes: "",
  },
  {
    drugName: "Доксорубицин", brandName: "Адриамицин", form: "injection",
    dosage: "60 мг/м2", route: "iv", frequency: "Каждые 3 недели (4 цикла)",
    duration: "12 недель", startDate: "2024-07-15T00:00:00.000Z",
    endDate: "2024-10-07T00:00:00.000Z",
    status: "completed", indication: "Неоадъювантная химиотерапия (AC)",
    notes: "Кумулятивная доза 240 мг/м2 (предел 550 мг/м2)",
  },
];

export const DEMO_LAB_RESULTS: Array<{
  testName: string; testCode: string; category: string; value: string;
  numericValue: number; unit: string; refRangeLow: number; refRangeHigh: number;
  flag: string; specimen: string; collectedAt: string; notes?: string;
}> = [
  // ОАК - перед ХТ
  { testName: "Гемоглобин", testCode: "718-7", category: "hematology", value: "128", numericValue: 128, unit: "г/л", refRangeLow: 120, refRangeHigh: 150, flag: "normal", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  { testName: "Лейкоциты", testCode: "6690-2", category: "hematology", value: "6.2", numericValue: 6.2, unit: "x10^9/л", refRangeLow: 4.0, refRangeHigh: 9.0, flag: "normal", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  { testName: "Тромбоциты", testCode: "777-3", category: "hematology", value: "245", numericValue: 245, unit: "x10^9/л", refRangeLow: 150, refRangeHigh: 400, flag: "normal", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  { testName: "Нейтрофилы", testCode: "751-8", category: "hematology", value: "3.8", numericValue: 3.8, unit: "x10^9/л", refRangeLow: 1.8, refRangeHigh: 7.0, flag: "normal", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  // После 1-го цикла ХТ - нейтропения
  { testName: "Лейкоциты", testCode: "6690-2", category: "hematology", value: "2.8", numericValue: 2.8, unit: "x10^9/л", refRangeLow: 4.0, refRangeHigh: 9.0, flag: "low", specimen: "Венозная кровь", collectedAt: "2024-07-25T08:00:00.000Z" },
  { testName: "Нейтрофилы", testCode: "751-8", category: "hematology", value: "1.1", numericValue: 1.1, unit: "x10^9/л", refRangeLow: 1.8, refRangeHigh: 7.0, flag: "low", specimen: "Венозная кровь", collectedAt: "2024-07-25T08:00:00.000Z" },
  { testName: "Гемоглобин", testCode: "718-7", category: "hematology", value: "115", numericValue: 115, unit: "г/л", refRangeLow: 120, refRangeHigh: 150, flag: "low", specimen: "Венозная кровь", collectedAt: "2024-07-25T08:00:00.000Z" },
  // Биохимия
  { testName: "Глюкоза (натощак)", testCode: "2345-7", category: "biochemistry", value: "7.8", numericValue: 7.8, unit: "ммоль/л", refRangeLow: 4.1, refRangeHigh: 5.9, flag: "high", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  { testName: "HbA1c", testCode: "4548-4", category: "endocrinology", value: "7.2", numericValue: 7.2, unit: "%", refRangeLow: 4.0, refRangeHigh: 6.0, flag: "high", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  { testName: "Креатинин", testCode: "2160-0", category: "biochemistry", value: "78", numericValue: 78, unit: "мкмоль/л", refRangeLow: 44, refRangeHigh: 97, flag: "normal", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  { testName: "АЛТ", testCode: "1742-6", category: "biochemistry", value: "28", numericValue: 28, unit: "ЕД/л", refRangeLow: 7, refRangeHigh: 56, flag: "normal", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  { testName: "АСТ", testCode: "1920-8", category: "biochemistry", value: "32", numericValue: 32, unit: "ЕД/л", refRangeLow: 10, refRangeHigh: 40, flag: "normal", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  // Онкомаркеры
  { testName: "CA 15-3", testCode: "2988-6", category: "biochemistry", value: "45.2", numericValue: 45.2, unit: "ЕД/мл", refRangeLow: 0, refRangeHigh: 25, flag: "high", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z", notes: "Повышен - соответствует активности процесса" },
  { testName: "REA", testCode: "2153-1", category: "biochemistry", value: "3.2", numericValue: 3.2, unit: "нг/мл", refRangeLow: 0, refRangeHigh: 5, flag: "normal", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
  // Коагуляция
  { testName: "МНО (INR)", testCode: "6301-6", category: "coagulation", value: "1.05", numericValue: 1.05, unit: "", refRangeLow: 0.8, refRangeHigh: 1.2, flag: "normal", specimen: "Венозная кровь", collectedAt: "2024-07-10T08:00:00.000Z" },
];

export const DEMO_PROBLEMS: Array<{
  title: string; icd10: string; category: string; status: string;
  severity: string; onsetDate: string; description: string; isPrimary: boolean;
}> = [
  {
    title: "Рак левой молочной железы T2N1M0, стадия IIA",
    icd10: "C50.9", category: "acute", status: "active", severity: "severe",
    onsetDate: "2024-06-01T00:00:00.000Z",
    description: "Инвазивная протоковая карцинома, ER+/PR+, HER2-. Клеточный град G2. Ki-67 25%.",
    isPrimary: true,
  },
  {
    title: "Мутация BRCA1 (c.5266dupC)",
    icd10: "Z80.3", category: "chronic", status: "active", severity: "severe",
    onsetDate: "2024-07-12T00:00:00.000Z",
    description: "Патогенная мутация BRCA1 - повышенный риск рецидива, показана терапия парпибом (олапариб). Наследственный синдром.",
    isPrimary: false,
  },
  {
    title: "Артериальная гипертензия",
    icd10: "I10", category: "chronic", status: "controlled", severity: "moderate",
    onsetDate: "2018-09-01T00:00:00.000Z",
    description: "Контролируется периндоприлом 5 мг/сут. Целевое АД < 130/80.",
    isPrimary: false,
  },
  {
    title: "Сахарный диабет 2 типа",
    icd10: "E11.9", category: "chronic", status: "controlled", severity: "moderate",
    onsetDate: "2020-11-15T00:00:00.000Z",
    description: "HbA1c 7.2% (цель < 7.0%). Метформин 850 мг 2 раза/день. Диетотерапия.",
    isPrimary: false,
  },
  {
    title: "Нейтропения II степени (после ХТ)",
    icd10: "D70", category: "acute", status: "active", severity: "moderate",
    onsetDate: "2024-07-25T00:00:00.000Z",
    description: "Нейтрофилы 1.1x10^9/л после 1-го цикла AC. Рассмотреть снижение дозы или G-CSF.",
    isPrimary: false,
  },
];

export const DEMO_CARE_PLAN = {
  title: "Лечебный план: РМЖ IIА ст., BRCA1+",
  type: "treatment" as const,
  status: "active" as const,
  goals: JSON.stringify([
    { description: "Завершение неоадъювантной ХТ (4 цикла AC)", target: "4 цикла", deadline: "2024-10-07", achieved: false },
    { description: "Хирургическое лечение (лумпэктомия + биопсия сторожевого узла)", target: "R0 резекция", deadline: "2024-11-01", achieved: false },
    { description: "Компенсация СД2 (HbA1c < 7.0%)", target: "HbA1c < 7.0%", deadline: "2024-12-01", achieved: false },
    { description: "Контроль АД < 130/80 мм рт.ст.", target: "< 130/80", deadline: "2024-12-01", achieved: false },
  ]),
  interventions: JSON.stringify([
    { description: "Химиотерапия: Доксорубицин 60 мг/м2 + Циклофосфамид 600 мг/м2, каждые 21 день", frequency: "Каждые 3 недели", duration: "12 недель", status: "in_progress" },
    { description: "Адъювантная гормонотерапия: Тамоксифен 20 мг/день x 5 лет (или анастрозол при менопаузе)", frequency: "Ежедневно", duration: "5 лет", status: "planned" },
    { description: "Таргетная терапия: Олапариб 300 мг 2 раза/день x 1 год (BRCA1+)", frequency: "2 раза в день", duration: "1 год", status: "planned" },
    { description: "Бисфосфонаты: Золедроновая кислота 4 мг в/в каждые 6 месяцев x 3 года", frequency: "1 раз в 6 месяцев", duration: "3 года", status: "planned" },
    { description: "Контроль: ОАК перед каждым циклом, онкомаркеры CA 15-3 каждые 3 мес.", frequency: "Каждый цикл / 3 мес.", duration: "Постоянно", status: "in_progress" },
  ]),
  notes: "Консилиум 10.07.2024: план одобрен. Учитывая BRCA1-мутацию, после ХТ рассмотреть олапариб в адъювантной настройке (OlympiA). Фармакогенетика: CYP2D6 *1/*4 (промежуточный метаболизатор) - при выборе тамоксифена рассмотреть замену на ИИ.",
};

// Результат ИИ-анализа кейса
export const DEMO_ANALYSIS = {
  entities: JSON.stringify([
    { text: "рак молочной железы", type: "diagnosis", confidence: 0.95 },
    { text: "BRCA1", type: "gene", confidence: 0.99 },
    { text: "тамоксифен", type: "medication", confidence: 0.92 },
    { text: "доксорубицин", type: "medication", confidence: 0.90 },
    { text: "T2N1M0", type: "staging", confidence: 0.88 },
  ]),
  mutations: JSON.stringify([
    { gene: "BRCA1", variant: "c.5266dupC", significance: "pathogenic", clinicalEffect: "Повышенный риск рецидива РМЯ, показана таргетная терапия парпибом (олапариб)" },
    { gene: "CYP2D6", variant: "*1/*4", significance: "reduced_function", clinicalEffect: "Промежуточный метаболизатор - сниженная конверсия тамоксифена в активный метаболит эндоксифен. Рекомендуется анастрозол." },
    { gene: "DPYD", variant: "*1/*1 (норма)", significance: "normal_function", clinicalEffect: "Нормальный метаболизм фторпиримидинов - стандартные дозы 5-ФУ/капецитабина допустимы" },
  ]),
  recommendations: JSON.stringify([
    { priority: 1, category: "therapy", text: "Рекомендована неоадъювантная химиотерапия AC (доксорубицин + циклофосфамид) x 4 цикла с последующим хирургическим лечением", evidenceLevel: "A", source: "NCCN Guidelines Breast Cancer v.2.2024" },
    { priority: 2, category: "pharmacogenomics", text: "CYP2D6 *1/*4 (промежуточный метаболизатор): рассмотреть замену тамоксифена на ароматазный ингибитор (анастрозол/летрозол) для оптимальной эффективности", evidenceLevel: "A", source: "CPIC Guidelines CYP2D6-Tamoxifen" },
    { priority: 3, category: "targeted_therapy", text: "BRCA1 pathogenic мутация: показан олапариб 300 мг 2р/д в адъювантной настройке в течение 1 года (исследование OlympiA)", evidenceLevel: "A", source: "OlympiA Trial, NEJM 2021" },
    { priority: 4, category: "ddi", text: "ВНИМАНИЕ: Тамоксифен + Периндоприл - умеренное взаимодействие (CYP3A4). Рекомендуется мониторинг АД.", evidenceLevel: "B", source: "Лекарственные взаимодействия (Справочник Видаль)" },
  ]),
  conclusion: `Пациентка 56 лет, РМЖ левой молочной железы T2N1M0, стадия IIA, ER+/PR+, HER2-.

Ключевые находки:
1. Патогенная мутация BRCA1 (c.5266dupC) - показана таргетная терапия олапарибом (OlympiA).
2. CYP2D6 *1/*4 (промежуточный метаболизатор) - тамоксифен может быть менее эффективен, рекомендуется ароматазный ингибитор.
3. DPYD нормальный функционал - фторпиримидины в стандартных дозах допустимы.
4. Умеренное лекарственное взаимодействие тамоксифен + периндоприл (CYP3A4).

Рекомендуемая тактика: неоадъювантная ХТ AC -> хирургия -> адъювантная гормонотерапия (ИИ) + олапариб.`,
  confidence: JSON.stringify({ diagnosis: 0.92, therapy: 0.88, pharmacogenomics: 0.95, ddi: 0.85 }),
  therapyRecommendations: JSON.stringify([
    { drug: "Анастрозол", dosage: "1 мг/день", duration: "5 лет", rationale: "Предпочтителен при CYP2D6 *1/*4 (снижена активация тамоксифена)", alternatives: ["Летрозол 2.5 мг/день", "Эксеместан 25 мг/день"] },
    { drug: "Олапариб", dosage: "300 мг 2 раза/день", duration: "1 год", rationale: "BRCA1-мутация (OlympiA)", alternatives: [] },
    { drug: "Золедроновая кислота", dosage: "4 мг в/в каждые 6 мес.", duration: "3 года", rationale: "Профилактика костных метастазов (EBCTCG)", alternatives: [] },
  ]),
  ddiAlerts: JSON.stringify([
    { drug1: "Тамоксифен", drug2: "Периндоприл", severity: "moderate", description: "Периндоприл может снижать эффективность тамоксифена через ингибирование CYP3A4", management: "Мониторинг АД, рассмотреть альтернативный АГП (лозартан)", evidenceLevel: "B" },
    { drug1: "Метформин", drug2: "Доксорубицин", severity: "minor", description: "Метформин может потенцировать кардиотоксичность антрациклинов", management: "Контроль ЭхоКГ перед каждым циклом", evidenceLevel: "C" },
  ]),
  icd10Suggestions: JSON.stringify([
    { code: "C50.9", description: "Злокачественное новообразование молочной железы, неуточнённой локализации", confidence: 0.95 },
    { code: "C77.3", description: "Поражение лимфоузлов подмышечной области", confidence: 0.85 },
    { code: "Z80.3", description: "Наследственная предрасположенность к злокачественным новообразованиям молочной железы", confidence: 0.80 },
    { code: "Z85.3", description: "Личный анамнез злокачественного новообразования молочной железы", confidence: 0.70 },
  ]),
  pathwayMatches: JSON.stringify([
    { name: "Рак молочной железы ER+ - ранняя стадия", icd10Code: "C50.9", matchScore: 0.92, phase: "Неоадъювантная терапия" },
  ]),
};

export const DEMO_CONSENT = {
  consentType: "data_processing" as const,
  granted: true,
  notes: "Информированное согласие на обработку персональных данных (ФЗ-152). Подписано пациенткой при первичном приёме.",
};

export const DEMO_NOTIFICATION = {
  type: "analysis_complete" as const,
  title: "ИИ-анализ завершён",
  message: "Анализ случая СЛЧ-2024-0001 завершён. Обнаружена мутация BRCA1. Рекомендована коррекция гормонотерапии (CYP2D6). Есть 2 предупреждения о лекарственных взаимодействиях.",
};
