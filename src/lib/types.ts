// СППВР v2.0 — TypeScript type definitions

export type FileType = "discharge" | "genetic" | "image";
export type CaseStatus = "new" | "uploaded" | "analyzing" | "analyzed" | "reported" | "archived";

export interface Entity {
  type: "diagnosis" | "medication" | "dosage" | "procedure" | "lab_value" | "date" | "other";
  value: string;
  context: string;
}

export interface Mutation {
  gene: string;
  variant: string;
  interpretation: string;
  clinicalSignificance: "pathogenic" | "likely_pathogenic" | "vus" | "likely_benign" | "benign";
}

export interface Recommendation {
  id: string;
  title: string;
  category: string;
  gene?: string;
  mutation?: string;
  content: string;
  source: string;
  evidenceLevel?: string;
  relevanceScore: number;
}

export interface ImageFinding {
  description: string;
  regionOfInterest: string;
  measurements: string;
  suspicion: "low" | "moderate" | "high";
}

export interface Citation {
  claim: string;
  source: string;
  documentId?: string;
  fragment: string;
  location?: string;
}

export interface ConclusionSection {
  title: string;
  content: string;
  confidence: number;
  citations: Citation[];
}

export interface TherapyRecommendation {
  category: "medications" | "tactics" | "tests" | "dose_adjustments" | "alternatives";
  items: Array<{
    name: string;
    description: string;
    priority: "high" | "medium" | "low";
    evidenceLevel?: string;
  }>;
}

export interface CaseSummary {
  id: string;
  caseCode: string;
  patientToken: string;
  // Привязка к карте пациента (заполняется в GET /api/cases/[id]).
  patientId?: string | null;
  birthYear: number | null;
  sex: string | null;
  status: CaseStatus;
  diagnosisHint: string | null;
  notes: string | null;
  icd10Codes: ICD10CodeMatch[];
  doctorId: string;
  createdAt: string;
  updatedAt: string;
  doctor?: { id: string; fullName: string; specialization: string };
  _count?: { documents: number; reports: number };
}

export interface DocumentRecord {
  id: string;
  caseId: string;
  fileName: string;
  fileType: FileType;
  rawContent: string;
  deidContent: string;
  extractedMeta: string;
  storagePath: string | null;
  createdAt: string;
}

// ===========================================================================
// v5.0 — Структурированные клинические данные ИИ-анализа (analysis.structured)
// ---------------------------------------------------------------------------
// ИИ-конвейер (POST /api/cases/[id]/analyze) кроме текстовых разделов теперь
// формирует СТРУКТУРИРОВАННЫЙ блок: дифференциальный диагноз (несколько
// гипотез с аргументами «за»/«против»), план дообследования, варианты терапии
// (ТОЛЬКО после подтверждения диагноза), план мониторинга маркеров и отчёт
// самопроверки. Хранится одной JSON-колонкой `structured`.
// ===========================================================================

/** Одна гипотеза дифференциального диагноза. */
export interface DifferentialDiagnosis {
  /** Порядковый номер гипотезы (1 = наиболее вероятная). */
  rank: number;
  /** Название диагноза/синдрома (по-русски, клинически точное). */
  diagnosis: string;
  /** Код МКБ-10 (если определим). */
  icd10?: string;
  /** Оценка вероятности 0..1 (субъективная, обоснована данными). */
  probability: number;
  /** Аргументы ЗА гипотезу (симптомы, анамнез, данные). */
  argumentsFor: string[];
  /** Аргументы ПРОТИВ (что не укладывается, чем отличить). */
  argumentsAgainst: string[];
  /** Обследования для подтверждения/исключения гипотезы. */
  workup: string[];
  /** Настораживающие признаки («красные флаги»), требующие исключения. */
  redFlags?: string[];
  /** Код/версия КР Минздрава РФ, если гипотеза сверена с репозиторием. */
  clinrecCode?: string;
  /** Прочие источники (гайдлайны, PubMed и т.п.). */
  sources?: string[];
  /** Свободный комментарий ИИ (патофизиология, тактика различения). */
  notes?: string;
}

/** Пункт плана дообследования (до назначения терапии). */
export interface WorkupItem {
  /** Название обследования (лабораторного/инструментального). */
  name: string;
  priority: "urgent" | "high" | "routine";
  /** Зачем: что подтвердить/исключить. */
  purpose?: string;
  /** К какой гипотезе дифф. диагноза относится (название гипотезы). */
  targetDx?: string;
}

/** Вариант терапии, привязанный к подтверждённой гипотезе. */
export interface TherapyOption {
  /** МНН препарата или название схемы. */
  name: string;
  /** Доза, путь введения, кратность, длительность. */
  regimen?: string;
  /** Уровень доказательности (A/B/C/…). */
  evidenceLevel?: string;
  /** Источник: КР Минздрава [код], NICE, ESC, WHO и т.п. */
  source?: string;
  /** Развёрнутое обоснование: механизм, почему именно этот препарат. */
  justification?: string;
  /** Для какой гипотезы (после её подтверждения). */
  targetDx?: string;
  /** Важные предупреждения/противопоказания. */
  caution?: string;
}

/** Маркер мониторинга (что контролировать и как часто). */
export interface MonitoringMarker {
  /** Маркер/показатель (напр. «Ферритин», «HbA1c», «Спирометрия»). */
  marker: string;
  /** Частота контроля (напр. «через 1 месяц», «каждые 3 месяца»). */
  frequency?: string;
  /** Целевое значение/интерпретация. */
  target?: string;
  purpose?: string;
}

/** Отчёт самопроверки ИИ (verification pass). */
export interface VerificationReport {
  /** Выполнялась ли самопроверка. */
  performed: boolean;
  /** Число проходов проверки. */
  passes: number;
  /** Список найденных и исправленных проблем (или «существенных расхождений нет»). */
  corrections: string[];
  /** Итог верификации фактов: подтверждены ли все утверждения данными. */
  factsGrounded?: boolean;
  verifiedAt?: string;
}

/** Структура JSON-колонки AnalysisResult.structured. */
export interface AnalysisStructured {
  differential: DifferentialDiagnosis[];
  workupPlan: WorkupItem[];
  therapyOptions: TherapyOption[];
  monitoringPlan: MonitoringMarker[];
  verification: VerificationReport;
}

export interface AnalysisResultData {
  id: string;
  caseId: string;
  entities: Entity[];
  mutations: Mutation[];
  recommendations: Recommendation[];
  conclusion: string;
  sections: ConclusionSection[];
  confidence: Record<string, number>;
  citations: Citation[];
  imageFindings: ImageFinding[];
  controlWeights: Record<string, number>;
  doctorComments: DoctorComment[];
  therapyRecommendations: TherapyRecommendation[];
  ddiAlerts: DDIAlert[];
  icd10Suggestions: ICD10CodeMatch[];
  pathwayMatches: ClinicalPathwayMatch[];
  /** v5.0: структурированный диф. диагноз / обследование / терапия / мониторинг. */
  structured: AnalysisStructured;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DoctorComment {
  // v2.7.2 (audit fix): необязательный id для React-ключей и удаления в
  // ControlPanel; в сохранённых данных может отсутствовать.
  id?: string;
  author: string;
  text: string;
  ts: string;
}

export interface ReportRecord {
  id: string;
  caseId: string;
  doctorId: string;
  title: string;
  content: string;
  pdfPath: string | null;
  status: "draft" | "approved" | "signed";
  watermark: string;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
  signatures?: ReportSignatureRecord[];
}

export interface CaseShareRecord {
  id: string;
  caseId: string;
  fromDoctorId: string;
  toDoctorId: string;
  accessLevel: "read" | "comment";
  message: string | null;
  status: "active" | "revoked";
  createdAt: string;
  fromDoctor?: { id: string; fullName: string };
  toDoctor?: { id: string; fullName: string };
}

export interface NotificationItem {
  id: string;
  doctorId: string;
  type: "analysis_complete" | "report_approved" | "case_shared" | "warning" | "system" | "ddi_alert" | "consent_required";
  title: string;
  message: string;
  caseId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface TemplateItem {
  id: string;
  name: string;
  description: string;
  category: string;
  sections: TemplateSection[];
  watermark: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSection {
  id: string;
  title: string;
  type: "text" | "table" | "chart" | "signature";
  required: boolean;
}

export interface SystemStatus {
  ok: boolean;
  db: boolean;
  ai: { ok: boolean; provider: "llama-server" | "lm-studio" | "none"; error?: string; lmStudioOk?: boolean; lmStudioError?: string; model?: string; latency?: number };
  storage: boolean;
  rag: boolean;
  ddi: boolean;
  icd10: boolean;
  // v2.3: network status for web RAG. When offline, the system continues to
  // work with the local knowledge base — this is informational, not blocking.
  network?: {
    online: boolean;
    lastError: string | null;
    circuitOpen: boolean;
    lastCheck: number;
  };
  timestamp: string;
}

export interface SearchResultItem {
  caseId: string;
  caseCode: string;
  patientToken: string;
  diagnosisHint: string | null;
  status: CaseStatus;
  createdAt: string;
  matchedGenes: string[];
  matchedMutations: string[];
  relevanceScore: number;
  doctorName: string;
}

// NEW: ICD-10 types
export interface ICD10CodeMatch {
  code: string;
  description: string;
  confidence: number;
  source: "ai" | "manual";
}

export interface ICD10CodeRecord {
  id: string;
  code: string;
  description: string;
  chapter: string;
  block: string;
  parentCode: string | null;
}

// NEW: DDI types
export interface DDIAlert {
  drug1: string;
  drug2: string;
  severity: "contraindication" | "major" | "moderate" | "minor";
  description: string;
  mechanism: string;
  management: string;
  evidenceLevel: string;
  source: string;
  // v2.1: optional override record — present when a doctor has formally
  // overridden this alert with a documented clinical justification.
  override?: {
    overridden: boolean;
    overrideReason: string;
    overriddenBy: string;
    overriddenAt: string;
  };
}

// v5.0: ПОТОКОВЫЙ ОНЛАЙН-ПОИСК взаимодействий в базах данных РФ
// (РЛС rlsnet.ru · Видаль vidal.ru · ГРЛС Минздрава · КР Минздрава)

export interface DDISourceRef {
  title: string;
  url: string;
  host: string;
  trust: number;
  label: string;
}

/** Онлайн-алерт взаимодействия (дополнение к DDIAlert). */
export interface OnlineDDIAlert extends DDIAlert {
  origin: "rls" | "vidal" | "grls" | "clinrec" | "web" | "local-db" | "ai";
  confidence: "high" | "medium" | "low";
  sourceUrls: DDISourceRef[];
  fromCache?: boolean;
}

export interface NormalizedMedication {
  input: string;
  inn: string;
  mapped: boolean;
}

/** События SSE-потока /api/ddi/stream. */
export type DdiStreamEvent =
  | { type: "stage"; stage: "init" | "normalize" | "local" | "online" | "summary" | "done"; label: string }
  | { type: "normalized"; medications: NormalizedMedication[] }
  | { type: "local-alerts"; alerts: OnlineDDIAlert[]; count: number }
  | { type: "pair-start"; pairIndex: number; totalPairs: number; drugA: string; drugB: string; cached: boolean }
  | { type: "pair-search"; pairIndex: number; drugA: string; drugB: string; query: string; sources: string[] }
  | { type: "pair-found"; pairIndex: number; drugA: string; drugB: string; resultCount: number; domains: string[] }
  | { type: "pair-llm"; pairIndex: number; drugA: string; drugB: string }
  | { type: "pair-done"; pairIndex: number; drugA: string; drugB: string; alerts: OnlineDDIAlert[]; sources: DDISourceRef[]; fromCache: boolean; durationMs: number }
  | { type: "alert"; alert: OnlineDDIAlert }
  | { type: "pair-error"; pairIndex: number; drugA: string; drugB: string; error: string }
  | { type: "summary"; text: string }
  | { type: "complete"; totalAlerts: number; localAlerts: number; onlineAlerts: number; pairsChecked: number; pairsFromCache: number; sourcesUsed: string[]; durationMs: number }
  | { type: "error"; message: string };

export interface DDIRecord {
  id: string;
  drug1: string;
  drug2: string;
  severity: string;
  description: string;
  mechanism: string;
  management: string;
  evidenceLevel: string;
  source: string;
}

// NEW: Clinical Pathway types
export interface ClinicalPathwayStep {
  order: number;
  title: string;
  description: string;
  duration: string;
  criteria: string;
}

export interface ClinicalPathwayMatch {
  id: string;
  name: string;
  icd10Code: string | null;
  category: string;
  matchScore: number;
  steps: ClinicalPathwayStep[];
  medications: string[];
  monitoring: string[];
}

export interface ClinicalPathwayRecord {
  id: string;
  name: string;
  icd10Code: string | null;
  category: string;
  description: string;
  steps: ClinicalPathwayStep[];
  criteria: { inclusion: string[]; exclusion: string[] };
  medications: string[];
  monitoring: string[];
  source: string;
  version: string;
  isActive: boolean;
}

// NEW: Consent types
export interface ConsentRecord {
  id: string;
  caseId: string;
  doctorId: string;
  consentType: "data_processing" | "ai_analysis" | "genetic_analysis" | "report_sharing" | "data_retention";
  granted: boolean;
  notes: string;
  validUntil: string | null;
  createdAt: string;
}

// NEW: Electronic Signature types
export interface ReportSignatureRecord {
  id: string;
  reportId: string;
  doctorId: string;
  signatureType: "approval" | "review" | "cosign";
  comment: string;
  signedAt: string;
  doctor?: { id: string; fullName: string; specialization: string };
}

// NEW: Analysis Version History
export interface AnalysisVersionRecord {
  id: string;
  analysisId: string;
  version: number;
  snapshot: string;
  changeNote: string;
  doctorId: string | null;
  createdAt: string;
}

// NEW v2.1: Global Knowledge Search (aggregated across all 4 sources)
// Returned by /api/knowledge?q=... — a unified, ranked result list combining
// recommendations, DDI records, ICD-10 codes, clinical pathways, and uploaded
// knowledge documents.
export interface KnowledgeSearchResult {
  source: "recommendation" | "ddi" | "icd10" | "pathway" | "document";
  id: string;
  title: string;
  snippet: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

// NEW: Backup/Restore
export interface BackupData {
  version: string;
  timestamp: string;
  cases: unknown[];
  documents: unknown[];
  analysisResults: unknown[];
  reports: unknown[];
  clinicalRecommendations: unknown[];
  drugInteractions: unknown[];
  icd10Codes: unknown[];
  clinicalPathways: unknown[];
  auditLogs: unknown[];
  consents: unknown[];
}

// ============================================================================
// EMR v2.5.0 — Electronic Medical Record types
// ============================================================================

export interface PatientSummary {
  id: string;
  patientToken: string;
  lastName: string;
  firstName: string;
  middleName: string;
  birthDate: string | null;
  age: number | null;
  sex: string;
  bloodType: string;
  phone: string;
  email: string;
  address?: string;
  snils: string;
  omiPolicy: string;
  insuranceNumber?: string;
  nationality?: string;
  occupation: string;
  notes?: string;
  smokingStatus: string;
  alcoholUse: string;
  allergies: Array<{ allergen: string; reaction: string; severity: string; notedAt?: string }>;
  chronicDiseases: Array<{ name: string; icd10?: string; diagnosedAt?: string; status?: string }>;
  familyHistory: Array<{ relation: string; condition: string; notes?: string }>;
  height: number;
  weight: number;
  status: "active" | "archived" | "deceased";
  primaryDoctor?: { id: string; fullName: string; specialization: string };
  createdAt: string;
  updatedAt: string;
  // v2.7 — E2EE key-wrapping metadata (расшифровка/передача карт)
  /** Роль доступа: владелец / получил grant / наблюдатель (видит шифротекст). */
  accessRole?: "owner" | "granted" | "observer";
  /** PDEK карты, завёрнутый master-DEK владельца (присылается только владельцу). */
  wrappedPdek?: string | null;
  /** Мой активный grant на эту карту (для получателя). */
  myGrant?: {
    wrappedPdek: string;
    grantorWrapPub: string;
    grantorName: string;
    grantorCode: string;
    grantedAt: string;
  } | null;
  /** Легаси-карта владельца без PDEK — мигрируется фоном после unlock. */
  legacyPdek?: boolean;
  /** Поля зашифрованы чужим ключом (нет доступа к расшифровке). */
  foreignEncrypted?: boolean;
  _count?: {
    visits: number;
    cases: number;
    medications: number;
    problems: number;
    labResults: number;
    vitalSigns: number;
    immunizations: number;
    /** v2.7: количество активных передач доступа (для владельца). */
    accessGrants?: number;
  };
}

export interface VitalSign {
  id: string;
  patientId: string;
  visitId: string | null;
  recordedAt: string;
  systolicBP: number;
  diastolicBP: number;
  heartRate: number;
  respiratoryRate: number;
  temperature: number;
  oxygenSaturation: number;
  height: number;
  weight: number;
  bmi: number;
  waistCircumference: number;
  glucose: number;
  painScore: number;
  consciousness: string;
  notes: string;
  recordedById: string | null;
}

export interface Medication {
  id: string;
  patientId: string;
  visitId: string | null;
  drugName: string;
  brandName: string;
  form: string;
  dosage: string;
  route: string;
  frequency: string;
  duration: string;
  startDate: string;
  endDate: string | null;
  status: "active" | "completed" | "discontinued" | "on_hold";
  indication: string;
  prescriberId: string | null;
  notes: string;
  prescriber?: { id: string; fullName: string };
}

export interface LabResult {
  id: string;
  patientId: string;
  visitId: string | null;
  testName: string;
  testCode: string;
  category: string;
  value: string;
  numericValue: number | null;
  unit: string;
  refRangeLow: number | null;
  refRangeHigh: number | null;
  flag: "normal" | "low" | "high" | "critical" | "abnormal";
  method: string;
  specimen: string;
  collectedAt: string;
  resultedAt: string | null;
  labName: string;
  notes: string;
}

export interface Visit {
  id: string;
  patientId: string;
  doctorId: string;
  caseId: string | null;
  visitType: string;
  status: string;
  chiefComplaint: string;
  visitReason: string;
  soapSubjective: string;
  soapObjective: string;
  soapAssessment: string;
  soapPlan: string;
  diagnosis: Array<{ icd10: string; description: string; type: string }>;
  prescriptions: unknown[];
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMin: number;
  doctor?: { id: string; fullName: string; specialization: string };
  case?: { id: string; caseCode: string; status: string } | null;
  _count?: { vitalSigns: number; medications: number; labResults: number };
}

export interface Problem {
  id: string;
  patientId: string;
  title: string;
  icd10: string;
  category: string;
  status: string;
  severity: string;
  onsetDate: string | null;
  resolvedDate: string | null;
  description: string;
  notes: string;
  isPrimary: boolean;
}

export interface Immunization {
  id: string;
  patientId: string;
  visitId: string | null;
  vaccineName: string;
  vaccineCode: string;
  targetDisease: string;
  doseNumber: number;
  series: string;
  manufacturer: string;
  lotNumber: string;
  route: string;
  site: string;
  administeredAt: string;
  administeredById: string | null;
  nextDoseDate: string | null;
  reaction: string;
  notes: string;
}

export interface CarePlan {
  id: string;
  patientId: string;
  problemId: string | null;
  title: string;
  type: string;
  status: string;
  goals: Array<{ description: string; target?: string; deadline?: string; achieved?: boolean }>;
  interventions: Array<{ description: string; frequency?: string; duration?: string; status?: string }>;
  startDate: string;
  endDate: string | null;
  doctorId: string | null;
  notes: string;
  doctor?: { id: string; fullName: string };
  problem?: { id: string; title: string; icd10: string };
}

export interface PatientDetail extends PatientSummary {
  address: string;
  insuranceNumber: string;
  nationality: string;
  notes: string;
  deathDate: string | null;
  primaryDoctorId: string | null;
  visits: Visit[];
  vitalSigns: VitalSign[];
  medications: Medication[];
  immunizations: Immunization[];
  labResults: LabResult[];
  problems: Problem[];
  carePlans: CarePlan[];
  examinations: Examination[];
  cases: Array<{ id: string; caseCode: string; status: string; diagnosisHint: string | null; createdAt: string; updatedAt: string }>;
}

// ============================================================================
// ОБСЛЕДОВАНИЯ (v4.1) — раздел медицинской карты
// ============================================================================

export interface ExaminationResultParam {
  parameter: string;
  value: string | number;
  unit?: string;
  refLow?: number | null;
  refHigh?: number | null;
  flag?: string; // normal | low | high | critical | abnormal
}

export interface Examination {
  id: string;
  patientId: string;
  visitId: string | null;
  caseId: string | null;
  name: string;
  examType: "laboratory" | "instrumental" | "consultation" | "functional" | "radiology" | "endoscopy" | "morphological" | "other";
  modality: string;
  code: string;
  status: "ordered" | "scheduled" | "in_progress" | "completed" | "cancelled";
  priority: "routine" | "urgent" | "stat";
  indication: string;
  icd10: string;
  orderedAt: string;
  scheduledAt: string | null;
  completedAt: string | null;
  performedAt: string;
  orderedById: string | null;
  performedById: string | null;
  resultValue: string;
  resultData: ExaminationResultParam[];
  interpretation: string;
  conclusion: string;
  isAbnormal: boolean;
  clinrecCodeVersion: string;
  clinrecName: string;
  clinrecMkb: string;
  attachments: Array<{ fileName?: string; storagePath?: string; mimeType?: string }>;
  notes: string;
  createdAt: string;
  updatedAt: string;
  orderedByName?: string | null;
  performedByName?: string | null;
}

export interface ExaminationStats {
  total: number;
  ordered: number;
  scheduled: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  abnormal: number;
  overdue: number;
  urgent: number;
}

// ============================================================================
// КЛИНИЧЕСКИЕ РЕКОМЕНДАЦИИ МИНЗДРАВА РФ (v4.1)
// ============================================================================

export interface ClinrecMatch {
  codeVersion: string;
  name: string;
  mkbCodes: string[];
  mkbString: string;
  developers: string[];
  ageCategory: string;
  publishDate: string | null;
  npcApproved: boolean;
  applyStatusCalculated: number | null;
  url: string;
  pdfUrl: string;
  relevanceScore: number;
  contentExcerpt?: string;
  diagnosticsExcerpt?: string;
  therapyExcerpt?: string;
  sectionsCount?: number;
}

export interface ClinrecSearchApiResponse {
  source: string;
  repository: string;
  results: ClinrecMatch[];
  total: number;
  page: number;
  pageSize: number;
  fromCache: boolean;
  error?: string;
  cache?: { entries: number; fullTexts: number; searches: number; oldestFetch: string | null };
}

export interface ClinrecFullSection {
  id: string;
  title: string;
  content: string;
  text: string;
  hasContent: boolean;
}

export interface ClinrecFullApiResponse {
  clinrec: {
    codeVersion: string;
    name: string;
    mkb: string;
    publishDate: string | null;
    approved: string | null;
    adult: boolean;
    child: boolean;
    npcApproved: boolean | null;
    applyStatus: number | null;
    prevCrId: string | null;
    url: string;
    pdfUrl: string;
  };
  sections: ClinrecFullSection[];
  sectionsCount: number;
}

export interface MkbRefItem {
  Id: number;
  ParentId: number | null;
  Name: string;
  Code: string;
  IsGroup: boolean;
  treeLevel: number;
}
