-- CreateTable
CREATE TABLE "doctors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "doctorCode" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'doctor',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseCode" TEXT NOT NULL,
    "patientToken" TEXT NOT NULL,
    "birthYear" INTEGER,
    "sex" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "diagnosisHint" TEXT,
    "notes" TEXT,
    "icd10Codes" TEXT NOT NULL DEFAULT '[]',
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cases_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cases_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "rawContent" TEXT NOT NULL DEFAULT '',
    "deidContent" TEXT NOT NULL DEFAULT '',
    "extractedMeta" TEXT NOT NULL DEFAULT '{}',
    "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "storagePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "analysis_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "entities" TEXT NOT NULL DEFAULT '[]',
    "mutations" TEXT NOT NULL DEFAULT '[]',
    "recommendations" TEXT NOT NULL DEFAULT '[]',
    "conclusion" TEXT NOT NULL DEFAULT '',
    "sections" TEXT NOT NULL DEFAULT '[]',
    "confidence" TEXT NOT NULL DEFAULT '{}',
    "citations" TEXT NOT NULL DEFAULT '[]',
    "imageFindings" TEXT NOT NULL DEFAULT '[]',
    "controlWeights" TEXT NOT NULL DEFAULT '{}',
    "doctorComments" TEXT NOT NULL DEFAULT '[]',
    "therapyRecommendations" TEXT NOT NULL DEFAULT '[]',
    "ddiAlerts" TEXT NOT NULL DEFAULT '[]',
    "icd10Suggestions" TEXT NOT NULL DEFAULT '[]',
    "pathwayMatches" TEXT NOT NULL DEFAULT '[]',
    "structured" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "analysis_results_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "analysis_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL DEFAULT '',
    "doctorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analysis_versions_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "analysis_results" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "doctorId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '{}',
    "pdfPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "watermark" TEXT NOT NULL DEFAULT 'СППВР | КОНФИДЕНЦИАЛЬНО',
    "templateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reports_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reports_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "reports_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "report_templates" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "report_signatures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "doctorId" TEXT,
    "signatureType" TEXT NOT NULL DEFAULT 'approval',
    "comment" TEXT NOT NULL DEFAULT '',
    "signedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_signatures_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "report_signatures_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "clinical_recommendations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "gene" TEXT,
    "mutation" TEXT,
    "content" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "evidenceLevel" TEXT NOT NULL DEFAULT 'C',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "rawText" TEXT NOT NULL DEFAULT '',
    "deidText" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT '',
    "storagePath" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "icd10_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "chapter" TEXT NOT NULL,
    "block" TEXT NOT NULL,
    "parentCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "drug_interactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drug1" TEXT NOT NULL,
    "drug2" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "mechanism" TEXT NOT NULL DEFAULT '',
    "management" TEXT NOT NULL DEFAULT '',
    "evidenceLevel" TEXT NOT NULL DEFAULT 'C',
    "source" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ddi_online_cache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "drugA" TEXT NOT NULL,
    "drugB" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "clinical_pathways" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icd10Code" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "steps" TEXT NOT NULL DEFAULT '[]',
    "criteria" TEXT NOT NULL DEFAULT '{}',
    "medications" TEXT NOT NULL DEFAULT '[]',
    "monitoring" TEXT NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '1.0',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '{}',
    "caseId" TEXT,
    "doctorId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audit_logs_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "doctorId" TEXT,
    "consentType" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "validUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consents_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "consents_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "case_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "fromDoctorId" TEXT,
    "toDoctorId" TEXT,
    "accessLevel" TEXT NOT NULL DEFAULT 'read',
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_shares_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "case_shares_fromDoctorId_fkey" FOREIGN KEY ("fromDoctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "case_shares_toDoctorId_fkey" FOREIGN KEY ("toDoctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "doctorId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "caseId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "sections" TEXT NOT NULL DEFAULT '[]',
    "watermark" TEXT NOT NULL DEFAULT 'СППВР | КОНФИДЕНЦИАЛЬНО',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientToken" TEXT NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "firstName" TEXT NOT NULL DEFAULT '',
    "middleName" TEXT NOT NULL DEFAULT '',
    "birthDate" TEXT,
    "birthYear" INTEGER,
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "snils" TEXT NOT NULL DEFAULT '',
    "omiPolicy" TEXT NOT NULL DEFAULT '',
    "insuranceNumber" TEXT NOT NULL DEFAULT '',
    "nationality" TEXT NOT NULL DEFAULT '',
    "occupation" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "wrappedPdek" TEXT,
    "sex" TEXT NOT NULL DEFAULT '',
    "bloodType" TEXT NOT NULL DEFAULT '',
    "height" INTEGER NOT NULL DEFAULT 0,
    "weight" REAL NOT NULL DEFAULT 0,
    "smokingStatus" TEXT NOT NULL DEFAULT 'unknown',
    "alcoholUse" TEXT NOT NULL DEFAULT 'unknown',
    "allergies" TEXT NOT NULL DEFAULT '[]',
    "chronicDiseases" TEXT NOT NULL DEFAULT '[]',
    "familyHistory" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "deathDate" DATETIME,
    "primaryDoctorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "patients_primaryDoctorId_fkey" FOREIGN KEY ("primaryDoctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "doctor_key_material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "doctorId" TEXT NOT NULL,
    "wrappedDek" TEXT NOT NULL,
    "kdfSalt" TEXT NOT NULL,
    "kdfParamsJson" TEXT NOT NULL,
    "checkBlob" TEXT NOT NULL,
    "wrapPubKey" TEXT,
    "wrappedWrapKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "doctor_key_material_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "patient_access_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "grantorDoctorId" TEXT NOT NULL,
    "granteeDoctorId" TEXT NOT NULL,
    "wrappedPdek" TEXT NOT NULL,
    "grantorWrapPub" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    CONSTRAINT "patient_access_grants_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "patient_access_grants_grantorDoctorId_fkey" FOREIGN KEY ("grantorDoctorId") REFERENCES "doctors" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "patient_access_grants_granteeDoctorId_fkey" FOREIGN KEY ("granteeDoctorId") REFERENCES "doctors" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT,
    "caseId" TEXT,
    "visitType" TEXT NOT NULL DEFAULT 'outpatient',
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "chiefComplaint" TEXT NOT NULL DEFAULT '',
    "visitReason" TEXT NOT NULL DEFAULT '',
    "soapSubjective" TEXT NOT NULL DEFAULT '',
    "soapObjective" TEXT NOT NULL DEFAULT '',
    "soapAssessment" TEXT NOT NULL DEFAULT '',
    "soapPlan" TEXT NOT NULL DEFAULT '',
    "diagnosis" TEXT NOT NULL DEFAULT '[]',
    "prescriptions" TEXT NOT NULL DEFAULT '[]',
    "scheduledAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "durationMin" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "visits_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "visits_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "visits_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "vital_signs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "systolicBP" INTEGER NOT NULL DEFAULT 0,
    "diastolicBP" INTEGER NOT NULL DEFAULT 0,
    "heartRate" INTEGER NOT NULL DEFAULT 0,
    "respiratoryRate" INTEGER NOT NULL DEFAULT 0,
    "temperature" REAL NOT NULL DEFAULT 0,
    "oxygenSaturation" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "weight" REAL NOT NULL DEFAULT 0,
    "bmi" REAL NOT NULL DEFAULT 0,
    "waistCircumference" REAL NOT NULL DEFAULT 0,
    "glucose" REAL NOT NULL DEFAULT 0,
    "painScore" INTEGER NOT NULL DEFAULT 0,
    "consciousness" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vital_signs_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "vital_signs_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "vital_signs_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "medications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "drugName" TEXT NOT NULL,
    "brandName" TEXT NOT NULL DEFAULT '',
    "form" TEXT NOT NULL DEFAULT 'tablet',
    "dosage" TEXT NOT NULL DEFAULT '',
    "route" TEXT NOT NULL DEFAULT 'oral',
    "frequency" TEXT NOT NULL DEFAULT '',
    "duration" TEXT NOT NULL DEFAULT '',
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "indication" TEXT NOT NULL DEFAULT '',
    "prescriberId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "medications_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "medications_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "medications_prescriberId_fkey" FOREIGN KEY ("prescriberId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "immunizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "vaccineName" TEXT NOT NULL,
    "vaccineCode" TEXT NOT NULL DEFAULT '',
    "targetDisease" TEXT NOT NULL DEFAULT '',
    "doseNumber" INTEGER NOT NULL DEFAULT 1,
    "series" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "lotNumber" TEXT NOT NULL DEFAULT '',
    "route" TEXT NOT NULL DEFAULT 'im',
    "site" TEXT NOT NULL DEFAULT '',
    "administeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "administeredById" TEXT,
    "nextDoseDate" DATETIME,
    "reaction" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "immunizations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "immunizations_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "immunizations_administeredById_fkey" FOREIGN KEY ("administeredById") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "testName" TEXT NOT NULL,
    "testCode" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "value" TEXT NOT NULL,
    "numericValue" REAL,
    "unit" TEXT NOT NULL DEFAULT '',
    "refRangeLow" REAL,
    "refRangeHigh" REAL,
    "flag" TEXT NOT NULL DEFAULT 'normal',
    "method" TEXT NOT NULL DEFAULT '',
    "specimen" TEXT NOT NULL DEFAULT '',
    "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultedAt" DATETIME,
    "labName" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lab_results_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lab_results_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "problems" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "icd10" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'active',
    "severity" TEXT NOT NULL DEFAULT 'mild',
    "onsetDate" DATETIME,
    "resolvedDate" DATETIME,
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "problems_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "care_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "problemId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'treatment',
    "status" TEXT NOT NULL DEFAULT 'active',
    "goals" TEXT NOT NULL DEFAULT '[]',
    "interventions" TEXT NOT NULL DEFAULT '[]',
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" DATETIME,
    "doctorId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "care_plans_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "care_plans_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "care_plans_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "examinations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patientId" TEXT NOT NULL,
    "visitId" TEXT,
    "caseId" TEXT,
    "name" TEXT NOT NULL,
    "examType" TEXT NOT NULL DEFAULT 'laboratory',
    "modality" TEXT NOT NULL DEFAULT '',
    "code" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "priority" TEXT NOT NULL DEFAULT 'routine',
    "indication" TEXT NOT NULL DEFAULT '',
    "icd10" TEXT NOT NULL DEFAULT '',
    "orderedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledAt" DATETIME,
    "completedAt" DATETIME,
    "performedAt" TEXT NOT NULL DEFAULT '',
    "orderedById" TEXT,
    "performedById" TEXT,
    "resultValue" TEXT NOT NULL DEFAULT '',
    "resultData" TEXT NOT NULL DEFAULT '[]',
    "interpretation" TEXT NOT NULL DEFAULT '',
    "conclusion" TEXT NOT NULL DEFAULT '',
    "isAbnormal" BOOLEAN NOT NULL DEFAULT false,
    "clinrecCodeVersion" TEXT NOT NULL DEFAULT '',
    "clinrecName" TEXT NOT NULL DEFAULT '',
    "clinrecMkb" TEXT NOT NULL DEFAULT '',
    "attachments" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "examinations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "examinations_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "examinations_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "examinations_orderedById_fkey" FOREIGN KEY ("orderedById") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "examinations_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "doctors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "minzdrav_cache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "doctors_doctorCode_key" ON "doctors"("doctorCode");

-- CreateIndex
CREATE UNIQUE INDEX "cases_caseCode_key" ON "cases"("caseCode");

-- CreateIndex
CREATE INDEX "cases_doctorId_idx" ON "cases"("doctorId");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE INDEX "cases_createdAt_idx" ON "cases"("createdAt");

-- CreateIndex
CREATE INDEX "documents_caseId_idx" ON "documents"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_results_caseId_key" ON "analysis_results"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_versions_analysisId_version_key" ON "analysis_versions"("analysisId", "version");

-- CreateIndex
CREATE INDEX "reports_caseId_idx" ON "reports"("caseId");

-- CreateIndex
CREATE INDEX "reports_doctorId_idx" ON "reports"("doctorId");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "report_signatures_reportId_idx" ON "report_signatures"("reportId");

-- CreateIndex
CREATE INDEX "clinical_recommendations_category_idx" ON "clinical_recommendations"("category");

-- CreateIndex
CREATE INDEX "clinical_recommendations_gene_idx" ON "clinical_recommendations"("gene");

-- CreateIndex
CREATE INDEX "knowledge_documents_category_idx" ON "knowledge_documents"("category");

-- CreateIndex
CREATE INDEX "knowledge_documents_createdAt_idx" ON "knowledge_documents"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "icd10_codes_code_key" ON "icd10_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "drug_interactions_drug1_drug2_key" ON "drug_interactions"("drug1", "drug2");

-- CreateIndex
CREATE UNIQUE INDEX "ddi_online_cache_cacheKey_key" ON "ddi_online_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_doctorId_idx" ON "audit_logs"("doctorId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "consents_caseId_idx" ON "consents"("caseId");

-- CreateIndex
CREATE INDEX "consents_doctorId_idx" ON "consents"("doctorId");

-- CreateIndex
CREATE INDEX "case_shares_caseId_idx" ON "case_shares"("caseId");

-- CreateIndex
CREATE INDEX "case_shares_toDoctorId_idx" ON "case_shares"("toDoctorId");

-- CreateIndex
CREATE INDEX "notifications_doctorId_idx" ON "notifications"("doctorId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE UNIQUE INDEX "patients_patientToken_key" ON "patients"("patientToken");

-- CreateIndex
CREATE INDEX "patients_primaryDoctorId_idx" ON "patients"("primaryDoctorId");

-- CreateIndex
CREATE INDEX "patients_status_idx" ON "patients"("status");

-- CreateIndex
CREATE INDEX "patients_birthYear_idx" ON "patients"("birthYear");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_key_material_doctorId_key" ON "doctor_key_material"("doctorId");

-- CreateIndex
CREATE INDEX "patient_access_grants_granteeDoctorId_status_idx" ON "patient_access_grants"("granteeDoctorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "patient_access_grants_patientId_granteeDoctorId_key" ON "patient_access_grants"("patientId", "granteeDoctorId");

-- CreateIndex
CREATE INDEX "visits_patientId_idx" ON "visits"("patientId");

-- CreateIndex
CREATE INDEX "visits_doctorId_idx" ON "visits"("doctorId");

-- CreateIndex
CREATE INDEX "visits_scheduledAt_idx" ON "visits"("scheduledAt");

-- CreateIndex
CREATE INDEX "visits_status_idx" ON "visits"("status");

-- CreateIndex
CREATE INDEX "vital_signs_patientId_idx" ON "vital_signs"("patientId");

-- CreateIndex
CREATE INDEX "vital_signs_recordedAt_idx" ON "vital_signs"("recordedAt");

-- CreateIndex
CREATE INDEX "medications_patientId_idx" ON "medications"("patientId");

-- CreateIndex
CREATE INDEX "medications_status_idx" ON "medications"("status");

-- CreateIndex
CREATE INDEX "medications_startDate_idx" ON "medications"("startDate");

-- CreateIndex
CREATE INDEX "immunizations_patientId_idx" ON "immunizations"("patientId");

-- CreateIndex
CREATE INDEX "immunizations_administeredAt_idx" ON "immunizations"("administeredAt");

-- CreateIndex
CREATE INDEX "lab_results_patientId_idx" ON "lab_results"("patientId");

-- CreateIndex
CREATE INDEX "lab_results_collectedAt_idx" ON "lab_results"("collectedAt");

-- CreateIndex
CREATE INDEX "lab_results_testName_idx" ON "lab_results"("testName");

-- CreateIndex
CREATE INDEX "problems_patientId_idx" ON "problems"("patientId");

-- CreateIndex
CREATE INDEX "problems_status_idx" ON "problems"("status");

-- CreateIndex
CREATE INDEX "care_plans_patientId_idx" ON "care_plans"("patientId");

-- CreateIndex
CREATE INDEX "care_plans_status_idx" ON "care_plans"("status");

-- CreateIndex
CREATE INDEX "examinations_patientId_idx" ON "examinations"("patientId");

-- CreateIndex
CREATE INDEX "examinations_status_idx" ON "examinations"("status");

-- CreateIndex
CREATE INDEX "examinations_examType_idx" ON "examinations"("examType");

-- CreateIndex
CREATE INDEX "examinations_orderedAt_idx" ON "examinations"("orderedAt");

-- CreateIndex
CREATE INDEX "examinations_scheduledAt_idx" ON "examinations"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "minzdrav_cache_cacheKey_key" ON "minzdrav_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "minzdrav_cache_kind_idx" ON "minzdrav_cache"("kind");

-- CreateIndex
CREATE INDEX "minzdrav_cache_expiresAt_idx" ON "minzdrav_cache"("expiresAt");
