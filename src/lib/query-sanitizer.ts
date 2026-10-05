// СППВР v2.2 — PHI Query Sanitizer for Web RAG
// ============================================================================
// PURPOSE: Before sending ANY query to an external search engine (DuckDuckGo,
// PubMed, etc.), we MUST strip all Protected Health Information (PHI) and
// personally identifiable information from the query. This is a HARD
// compliance requirement:
//   - ФЗ-152 ст. 3 п. 1 (персональные данные)
//   - ФЗ-323 ст. 13 ч. 1 (врачебная тайна)
//   - HIPAA §164.502(a) (minimum necessary / de-identification)
//
// This module extracts ONLY clinical terminology (diagnoses, gene names,
// medication INNs, procedures, lab test names) from case data and builds a
// sanitized search query. NO patient names, IDs, dates of birth, addresses,
// phone numbers, or free-form narrative text ever leaves the system.
//
// STRATEGY:
//   1. Input is ALREADY de-identified (ner-deidentify.ts ran on the source).
//      This sanitizer is a SECOND layer of defense — it extracts only known
//      clinical patterns and discards everything else.
//   2. We use allowlist-based extraction: only tokens matching known clinical
//      patterns (gene names, ICD-10 codes, medication INNs, medical terms)
//      are kept. Everything else is dropped.
//   3. The output query is a short string of clinical keywords, suitable for
//      a search engine. No narrative, no sentences, no context that could
//      identify a patient.

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Clinical term allowlists
// ---------------------------------------------------------------------------

// Common pharmacogenomic / cancer gene symbols (HGNC). This is NOT exhaustive
// but covers the genes most commonly encountered in CDSS workflows.
const KNOWN_GENES = new Set([
  "BRCA1", "BRCA2", "EGFR", "KRAS", "NRAS", "BRAF", "PIK3CA", "TP53", "PTEN",
  "ALK", "ROS1", "MET", "HER2", "ERBB2", "RET", "NTRK1", "NTRK2", "NTRK3",
  "MSI", "MMR", "MLH1", "MSH2", "MSH6", "PMS2", "EPCAM",
  "CYP2D6", "CYP2C19", "CYP2C9", "CYP3A4", "CYP3A5",
  "DPYD", "TPMT", "NUDT15", "UGT1A1", "SLCO1B1",
  "HLA-B", "HLA-A", "HLA-C", "HLA-DRB1",
  "VKORC1", "MTHFR", "G6PD", "F5", "F2",
  "JAK2", "CALR", "MPL", "BCR-ABL", "FLT3", "IDH1", "IDH2",
  "CFTR", "HBB", "HBA1", "HBA2",
  "APOE", "LDLR", "PCSK9", "LPA",
  "ESR1", "PGR", "AR",
  "KIT", "PDGFRA", "FGFR1", "FGFR2", "FGFR3",
]);

// Medication INN allowlist — a curated list of common medications by INN
// (international nonproprietary name). We use an allowlist instead of a
// suffix-based regex because suffix matching produces false positives:
//   - "один" (Russian for "one") ends in -ин → false positive
//   - "сахарин" (sweetener) ends in -ин → false positive
//   - "медицин" (root of "медицина") ends in -ин → false positive
// The allowlist is safer and still covers the medications most commonly
// encountered in CDSS workflows. New medications can be added as needed.
const KNOWN_MEDICATIONS = new Set([
  // Antidiabetics
  "метформин", "инсулин", "глибенкламид", "глимепирид", "ситаглиптин",
  "эмпаглифлозин", "дапаглифлозин", "лираглутид", "семаглутид", "эксенатид",
  "пиоглитазон", "акарбоза", "репаглинид", "натеглинид",
  // Cardiovascular
  "эналаприл", "лизиноприл", "рамиприл", "периндоприл", "каптоприл",
  "лозартан", "валсартан", "телмисартан", "кандесартан", "ирбесартан",
  "аторвастатин", "симвастатин", "розувастатин", "флувастатин", "правастатин",
  "амлодипин", "нифедипин", "верапамил", "дилтиазем", "фелодипин",
  "бисопролол", "метопролол", "карведилол", "небиволол", "атенолол", "пропранолол",
  "дигоксин", "амиодарон", "варфарин", "ривароксабан", "апиксабан", "дабигатран",
  "клопидогрел", "тикагрелор", "празугрел", "аспирин", "ацетилсалициловая кислота",
  "фуросемид", "торасемид", "спиронолактон", "гидрохлоротиазид", "индапамид",
  "нитроглицерин", "изосорбида динитрат", "моксонидин", "клофелин", "доксазозин",
  // Oncology / targeted
  "тамоксифен", "летрозол", "анастрозол", "эксеместан", "фулвестрант",
  "трастузумаб", "пертузумаб", "адо-трастузумаб", "цетуксимаб", "панитумумаб",
  "ритуксимаб", "обинутузумаб", "ибритумомаб", "брентуксимаб",
  "иматиниб", "дазатиниб", "нилотиниб", "бозутиниб", "понатиниб",
  "эрлотиниб", "гефитиниб", "осимертиниб", "афатиниб", "дакомитиниб",
  "кризотиниб", "церитиниб", "алектиниб", "бригатиниб", "лорлатиниб",
  "сорафениб", "сунитиниб", "пазопаниб", "акситиниб", "ленватиниб", "кабозантиниб",
  "олапариб", "нирапариб", "рукапариб", "талазопариб",
  "вемурафениб", "дабрафениб", "траметиниб", "кобиметиниб", "селуметиниб",
  "палбоциклиб", "рибоциклиб", "абемациклиб",
  "темозоломид", "капецитабин", "фторурацин", "гемцитабин", "пеметрексед",
  "доцетаксел", "паклитаксел", "наб-паклитаксел",
  "карбоплатин", "цисплатин", "оксалиплатин",
  "доксорубицин", "липосомальный доксорубицин",
  "циклофосфамид", "ифосфамид", "мелфалан", "бендамустин",
  "винкристин", "винбластин", "винорелбин", "этопозид",
  "иринотекан", "топотекан",
  "бевацизумаб", "афлиберцепт", "рамуцирумаб",
  "ипилимумаб", "нивелумаб", "пембролизумаб", "атезолизумаб", "дурвалумаб",
  "брентуксимаб", "полатузумаб",
  // Antibiotics
  "амоксициллин", "амоксициллин-клавуланат", "ко-амоксиклав",
  "азитромицин", "кларитромицин", "эритромицин", "клиндамицин",
  "цефазолин", "цефуроксим", "цефтриаксон", "цефепим", "цефтаролин",
  "ципрофлоксацин", "левофлоксацин", "моксифлоксацин",
  "гентамицин", "амикацин", "тобрамицин",
  "ванкомицин", "тейкопланин", "даптомицин", "линезолид",
  "метронидазол", "тинидазол",
  "доксициклин", "миноциклин", "тетрациклин",
  "сульфаметоксазол", "триметоприм", "ко-тримоксазол",
  "фосфомицин", "нитрофурантоин",
  "флуконазол", "итраконазол", "вориконазол", "позаконазол", "каспофунгин",
  "ацикловир", "валацикловир", "фамцикловир", "ганцикловир",
  "осельтамивир", "занамивир",
  // NSAIDs / analgesics
  "парацетамол", "ибупрофен", "напроксен", "диклофенак", "кеторолак",
  "мелоксикам", "целекоксиб", "нимесулид", "индометацин",
  "морфин", "трамадол", "бупренорфин", "фентанил", "кодеин",
  // GI / respiratory / neuro
  "омепразол", "пантопразол", "эзомепразол", "рабепразол", "лансопразол",
  "ранитидин", "фамотидин",
  "метоклопрамид", "ондансетрон", "гранисетрон",
  "сальбутамол", "фенотерол", "формотерол", "сальметерол", "тиотропий",
  "будесонид", "флутиказон", "беклометазон", "мометазон",
  "монтелукаст", "зафирлукаст",
  "леводопа", "карбидопа", "прамипексол", "ропинирол", "амантадин",
  "фенитоин", "карбамазепин", "окскарбазепин", "ламотриджин", "леветирацетам",
  "валипроевая кислота", "вальпроат натрия", "топирамат", "габапентин", "прегабалин",
  "клоназепам", "диазепам", "лоразепам", "мидазолам",
  "сертралин", "флуоксетин", "пароксетин", "эсциталопрам", "венлафаксин",
  "дулоксетин", "митразапин", "бупропион", "амитриптилин",
  "оланзапин", "рисперидон", "кветиапин", "арипипразол", "галоперидол",
  "левотироксин", "тиамазол", "пропилтиоурацил",
  "преднизолон", "преднизон", "метилпреднизолон", "дексаметазон", "гидрокортизон",
  "флудрокортизон",
  "аллопуринол", "колхицин",
  "циклоспорин", "такролимус", "сиролимус", "микофенолат",
  "азатиоприн", "метотрексат",
  "гепарин", "эноксапарин", "далтепарин", "бемипарин",
]);

// Build a regex from the allowlist. We escape special chars and sort by
// length (longest first) so "валипроевая кислота" matches before "кислота".
const MEDICATION_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(${Array.from(KNOWN_MEDICATIONS)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

// ICD-10 code pattern: letter + 2 digits + optional .digits
const ICD10_PATTERN = /\b([A-Z]\d{2}(?:\.\d{1,4})?)\b/g;

// Clinical term patterns (Russian + English) — diagnosis/condition keywords
// that are safe to search for. These are GENERIC medical terms, never
// patient-specific.
const CLINICAL_TERMS_RU = [
  "сахарный диабет", "гипертония", "гипертензия", "ишемическая болезнь сердца",
  "инфаркт миокарда", "сердечная недостаточность", "фибрилляция предсердий",
  "рак молочной железы", "рак легкого", "рак желудка", "рак кишечника",
  "колоректальный рак", "меланома", "лимфома", "лейкоз", "лейкемия",
  "миелома", "саркома", "карцинома", "аденокарцинома", "неоплазма",
  "метастаз", "метастазы", "опухоль",
  "тиреотоксикоз", "гипотиреоз", "тиреоидит",
  "хроническая обструктивная болезнь легких", "ХОБЛ", "бронхиальная астма",
  "пневмония", "туберкулез",
  "цирроз", "гепатит", "панкреатит",
  "хроническая почечная недостаточность", "ХПН", "гломерулонефрит",
  "инсульт", "эпилепсия", "болезнь Альцгеймера", "болезнь Паркинсона",
  "рассеянный склероз",
  "артрит", "артроз", "ревматоидный артрит", "остеопороз",
  "тромбоз", "тромбоэмболия", "ТЭЛА",
  "сепсис", "инфекция",
  "муковисцидоз", "гемохроматоз",
  "фармакогеномика", "фармакокинетика", "фармакодинамика",
  "лекарственное взаимодействие", "DDI",
  "химиотерапия", "таргетная терапия", "иммунотерапия", "лучевая терапия",
];

const CLINICAL_TERMS_EN = [
  "diabetes", "hypertension", "ischemic heart disease", "myocardial infarction",
  "heart failure", "atrial fibrillation",
  "breast cancer", "lung cancer", "gastric cancer", "colorectal cancer",
  "melanoma", "lymphoma", "leukemia", "myeloma", "sarcoma", "carcinoma",
  "metastasis", "metastatic", "tumor", "neoplasm", "oncology",
  "thyrotoxicosis", "hypothyroidism", "thyroiditis",
  "COPD", "asthma", "pneumonia", "tuberculosis",
  "cirrhosis", "hepatitis", "pancreatitis",
  "chronic kidney disease", "CKD", "glomerulonephritis",
  "stroke", "epilepsy", "alzheimer", "parkinson", "multiple sclerosis",
  "arthritis", "osteoporosis",
  "thrombosis", "thromboembolism", "pulmonary embolism",
  "sepsis", "infection",
  "pharmacogenomics", "pharmacokinetics", "pharmacodynamics",
  "drug interaction", "chemotherapy", "targeted therapy", "immunotherapy",
  "radiotherapy",
];

// v2.3.1: Russian→English clinical term translation map.
// PubMed (NCBI) is an English-language database — Russian clinical terms
// return 0 results. When we detect a Russian clinical term, we ALSO add
// its English translation to the search query so PubMed can find relevant
// articles. The original Russian term is kept for DuckDuckGo (which can
// search Russian sources like Минздрав РФ).
const RU_TO_EN_CLINICAL: Record<string, string> = {
  "сахарный диабет": "diabetes",
  "гипертония": "hypertension",
  "гипертензия": "hypertension",
  "ишемическая болезнь сердца": "ischemic heart disease",
  "инфаркт миокарда": "myocardial infarction",
  "сердечная недостаточность": "heart failure",
  "фибрилляция предсердий": "atrial fibrillation",
  "рак молочной железы": "breast cancer",
  "рак легкого": "lung cancer",
  "рак желудка": "gastric cancer",
  "рак кишечника": "colorectal cancer",
  "колоректальный рак": "colorectal cancer",
  "меланома": "melanoma",
  "лимфома": "lymphoma",
  "лейкоз": "leukemia",
  "лейкемия": "leukemia",
  "миелома": "myeloma",
  "саркома": "sarcoma",
  "карцинома": "carcinoma",
  "аденокарцинома": "adenocarcinoma",
  "неоплазма": "neoplasm",
  "метастаз": "metastasis",
  "метастазы": "metastasis",
  "опухоль": "tumor",
  "тиреотоксикоз": "thyrotoxicosis",
  "гипотиреоз": "hypothyroidism",
  "тиреоидит": "thyroiditis",
  "хроническая обструктивная болезнь легких": "COPD",
  "хобл": "COPD",
  "бронхиальная астма": "asthma",
  "пневмония": "pneumonia",
  "туберкулез": "tuberculosis",
  "цирроз": "cirrhosis",
  "гепатит": "hepatitis",
  "панкреатит": "pancreatitis",
  "хроническая почечная недостаточность": "chronic kidney disease",
  "хпн": "chronic kidney disease",
  "гломерулонефрит": "glomerulonephritis",
  "инсульт": "stroke",
  "эпилепсия": "epilepsy",
  "болезнь альцгеймера": "alzheimer",
  "болезнь паркинсона": "parkinson",
  "рассеянный склероз": "multiple sclerosis",
  "артрит": "arthritis",
  "артроз": "arthritis",
  "ревматоидный артрит": "rheumatoid arthritis",
  "остеопороз": "osteoporosis",
  "тромбоз": "thrombosis",
  "тромбоэмболия": "thromboembolism",
  "тэла": "pulmonary embolism",
  "сепсис": "sepsis",
  "инфекция": "infection",
  "муковисцидоз": "cystic fibrosis",
  "гемохроматоз": "hemochromatosis",
  "фармакогеномика": "pharmacogenomics",
  "фармакокинетика": "pharmacokinetics",
  "фармакодинамика": "pharmacodynamics",
  "лекарственное взаимодействие": "drug interaction",
  "химиотерапия": "chemotherapy",
  "таргетная терапия": "targeted therapy",
  "иммунотерапия": "immunotherapy",
  "лучевая терапия": "radiotherapy",
};

// v2.3.1: Russian→English medication translation map.
// PubMed uses English INNs. When we detect a Russian medication name, we
// also add its English INN so PubMed can find articles about it.
const RU_TO_EN_MEDICATION: Record<string, string> = {
  "метформин": "metformin",
  "инсулин": "insulin",
  "глибенкламид": "glyburide",
  "глимепирид": "glimepiride",
  "ситаглиптин": "sitagliptin",
  "эмпаглифлозин": "empagliflozin",
  "дапаглифлозин": "dapagliflozin",
  "лираглутид": "liraglutide",
  "семаглутид": "semaglutide",
  "эналаприл": "enalapril",
  "лизиноприл": "lisinopril",
  "рамиприл": "ramipril",
  "каптоприл": "captopril",
  "лозартан": "losartan",
  "валсартан": "valsartan",
  "телмисартан": "telmisartan",
  "аторвастатин": "atorvastatin",
  "симвастатин": "simvastatin",
  "розувастатин": "rosuvastatin",
  "амлодипин": "amlodipine",
  "бисопролол": "bisoprolol",
  "метопролол": "metoprolol",
  "карведилол": "carvedilol",
  "дигоксин": "digoxin",
  "амиодарон": "amiodarone",
  "варфарин": "warfarin",
  "ривароксабан": "rivaroxaban",
  "апиксабан": "apixaban",
  "дабигатран": "dabigatran",
  "клопидогрел": "clopidogrel",
  "тикагрелор": "ticagrelor",
  "аспирин": "aspirin",
  "фуросемид": "furosemide",
  "спиронолактон": "spironolactone",
  "тамоксифен": "tamoxifen",
  "летрозол": "letrozole",
  "анастрозол": "anastrozole",
  "трастузумаб": "trastuzumab",
  "цетуксимаб": "cetuximab",
  "ритуксимаб": "rituximab",
  "иматиниб": "imatinib",
  "эрлотиниб": "erlotinib",
  "осимертиниб": "osimertinib",
  "сорафениб": "sorafenib",
  "сунитиниб": "sunitinib",
  "олапариб": "olaparib",
  "вемурафениб": "vemurafenib",
  "дабрафениб": "dabrafenib",
  "траметиниб": "trametinib",
  "палбоциклиб": "palbociclib",
  "капецитабин": "capecitabine",
  "фторурацил": "fluorouracil",
  "гемцитабин": "gemcitabine",
  "доцетаксел": "docetaxel",
  "паклитаксел": "paclitaxel",
  "карбоплатин": "carboplatin",
  "цисплатин": "cisplatin",
  "доксорубицин": "doxorubicin",
  "циклофосфамид": "cyclophosphamide",
  "винкристин": "vincristine",
  "винорелбин": "vinorelbine",
  "этопозид": "etoposide",
  "иринотекан": "irinotecan",
  "бевацизумаб": "bevacizumab",
  "нивелумаб": "nivolumab",
  "пембролизумаб": "pembrolizumab",
  "амоксициллин": "amoxicillin",
  "азитромицин": "azithromycin",
  "кларитромицин": "clarithromycin",
  "цефтриаксон": "ceftriaxone",
  "цефепим": "cefepime",
  "ципрофлоксацин": "ciprofloxacin",
  "левофлоксацин": "levofloxacin",
  "ванкомицин": "vancomycin",
  "метронидазол": "metronidazole",
  "доксициклин": "doxycycline",
  "флуконазол": "fluconazole",
  "ацикловир": "acyclovir",
  "осельтамивир": "oseltamivir",
  "парацетамол": "paracetamol",
  "ибупрофен": "ibuprofen",
  "диклофенак": "diclofenac",
  "морфин": "morphine",
  "трамадол": "tramadol",
  "омепразол": "omeprazole",
  "ондансетрон": "ondansetron",
  "сальбутамол": "salbutamol",
  "будесонид": "budesonide",
  "леводопа": "levodopa",
  "карбамазепин": "carbamazepine",
  "ламотриджин": "lamotrigine",
  "леветирацетам": "levetiracetam",
  "габапентин": "gabapentin",
  "сертралин": "sertraline",
  "флуоксетин": "fluoxetine",
  "оланзапин": "olanzapine",
  "левотироксин": "levothyroxine",
  "преднизолон": "prednisolone",
  "дексаметазон": "dexamethasone",
  "аллопуринол": "allopurinol",
  "колхицин": "colchicine",
  "метотрексат": "methotrexate",
  "гепарин": "heparin",
  "эноксапарин": "enoxaparin",
};

// Build a single regex that matches any clinical term (case-insensitive, whole word).
// IMPORTANT: JavaScript's `\b` word boundary only works for ASCII word chars [A-Za-z0-9_].
// Russian letters are NOT in `\w`, so `\bсахарный\b` would FAIL to match "сахарный"
// in "сахарный диабет". We use Unicode-aware lookarounds `(?<![\p{L}\p{N}])` and
// `(?![\p{L}\p{N}])` with the `u` flag to match word boundaries for any script.
const ALL_CLINICAL_TERMS = [...CLINICAL_TERMS_RU, ...CLINICAL_TERMS_EN]
  .sort((a, b) => b.length - a.length) // longer terms first for greedy match
  .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const CLINICAL_TERM_REGEX = new RegExp(
  `(?<![\\p{L}\\p{N}])(${ALL_CLINICAL_TERMS.join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

// PHI patterns to ALWAYS strip (defense in depth — the source is already
// de-identified, but we run these to catch any residual PII).
const PHI_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // Names like "Иванов Иван Иванович" or "John Smith"
  { regex: /\b[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?\b/g, label: "name" },
  // Phone numbers
  { regex: /\+?\d{1,3}[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/g, label: "phone" },
  // Email
  { regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, label: "email" },
  // Dates of birth / full dates
  { regex: /\b\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}\b/g, label: "date" },
  // Passport / policy numbers
  { regex: /\b\d{4}\s?\d{6}\b/g, label: "passport" },
  // Addresses (very rough)
  { regex: /\bул\.\s+[А-ЯЁ][а-яё]+,?\s+д\.\s*\d+/gi, label: "address" },
  // Patient IDs / case codes (any token that looks like ID-XXXX or ПТ-XXXX)
  { regex: /\b(?:ID|ПТ|PT|GM|Case|Случай)[\-\s]?\w{3,}\b/gi, label: "patient_id" },
  // "Пациент" followed by anything (narrative context)
  { regex: /пациент[а-яё]*\s+(?:по\s+имени|фамили[яеюх])\s+[А-ЯЁ][а-яё]+/gi, label: "patient_ref" },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SanitizedQuery {
  query: string;
  terms: string[];
  // v2.3.1: English translations of Russian clinical terms & medications.
  // Used by PubMed direct search (NCBI is English-only). DuckDuckGo uses
  // the original `terms` (which can be Russian) to find Russian sources.
  englishTerms?: string[];
  removedPHI: string[];
  warnings: string[];
}

/**
 * Extract ONLY clinical terms from case data and build a search query.
 *
 * Input is the de-identified discharge summary / diagnosis hint / mutations /
 * medications. Output is a short string of clinical keywords safe to send
 * to an external search engine.
 *
 * Example:
 *   Input:  "Пациент с СД2, на метформине 1000 мг 2 раза. BRCA1 мутация."
 *   Output: "сахарный диабет BRCA1 метформин"
 *
 * NO patient names, IDs, dates, or narrative context are included.
 */
export function sanitizeCaseForQuery(params: {
  diagnosisHint?: string | null;
  dischargeSummary?: string;
  mutations?: Array<{ gene: string; variant: string }>;
  medications?: string[];
  entities?: Array<{ type: string; value: string }>;
}): SanitizedQuery {
  const { diagnosisHint, dischargeSummary, mutations, medications, entities } = params;

  const terms = new Set<string>();
  const removedPHI: string[] = [];
  const warnings: string[] = [];

  // Combine all source text into one blob for PHI scanning + term extraction
  const sourceParts: string[] = [];
  if (diagnosisHint) sourceParts.push(diagnosisHint);
  if (dischargeSummary) sourceParts.push(dischargeSummary);
  const sourceText = sourceParts.join(" ");

  // 1. Scan for residual PHI (defense in depth) — record what we'd remove
  if (sourceText) {
    for (const { regex, label } of PHI_PATTERNS) {
      const matches = sourceText.match(regex);
      if (matches) {
        for (const m of matches) {
          removedPHI.push(`[${label}] ${m.slice(0, 50)}`);
        }
      }
    }
  }

  // 2. Extract clinical terms (allowlist-based)
  if (sourceText) {
    let m: RegExpExecArray | null;
    CLINICAL_TERM_REGEX.lastIndex = 0;
    while ((m = CLINICAL_TERM_REGEX.exec(sourceText)) !== null) {
      terms.add(m[1].toLowerCase().trim());
    }
  }

  // 3. Extract gene symbols (exact match against known set)
  if (mutations && mutations.length > 0) {
    for (const mut of mutations) {
      const gene = mut.gene?.trim().toUpperCase();
      if (gene && KNOWN_GENES.has(gene)) {
        terms.add(gene);
      }
      // Also extract variant if it looks like standard nomenclature
      const variant = mut.variant?.trim();
      if (variant && /^(?:c\.|p\.|g\.|chr|exon|NM_|rs\d)/i.test(variant)) {
        // Only keep the nomenclature prefix + first token — no full variant
        // string (which could theoretically contain identifiable info in
        // non-standard reports).
        const firstToken = variant.split(/\s+/)[0];
        if (firstToken.length <= 30) {
          terms.add(firstToken);
        }
      }
    }
  }

  // 3b. Also extract gene symbols from the source text (the mutations array
  // might not be populated yet, e.g. during chat before analysis). We scan
  // the text for known gene symbols as whole words (case-insensitive).
  //
  // v2.3.1 FIX: The previous version used a case-SENSITIVE regex (no `i` flag),
  // so "brca1" (lowercase) in text was NOT extracted — only "BRCA1" (uppercase)
  // was found. This missed genes mentioned in lowercase in narrative text.
  // Now we use the `i` flag for case-insensitive matching, then normalize to
  // uppercase before adding to the terms set.
  if (sourceText) {
    // Build a regex that matches any known gene as a whole word.
    // We use `(?<![A-Za-z0-9])` and `(?![A-Za-z0-9])` because gene symbols
    // are ASCII-only — no need for full Unicode here.
    // The `i` flag makes it case-insensitive so "brca1", "Brca1", "BRCA1"
    // are all matched.
    const genePattern = new RegExp(
      `(?<![A-Za-z0-9])(${Array.from(KNOWN_GENES).join("|")})(?![A-Za-z0-9])`,
      "gi", // ← case-insensitive
    );
    let gm: RegExpExecArray | null;
    while ((gm = genePattern.exec(sourceText)) !== null) {
      terms.add(gm[1].toUpperCase()); // normalize to uppercase
    }
  }

  // 4. Extract ICD-10 codes
  if (sourceText) {
    let m: RegExpExecArray | null;
    ICD10_PATTERN.lastIndex = 0;
    while ((m = ICD10_PATTERN.exec(sourceText)) !== null) {
      terms.add(m[1]);
    }
  }
  if (entities) {
    for (const e of entities) {
      if (e.type === "diagnosis") {
        let m: RegExpExecArray | null;
        ICD10_PATTERN.lastIndex = 0;
        while ((m = ICD10_PATTERN.exec(e.value)) !== null) {
          terms.add(m[1]);
        }
      }
    }
  }

  // 5. Extract medication INNs (allowlist by pattern + known common drugs)
  if (medications && medications.length > 0) {
    for (const med of medications) {
      const lower = med.toLowerCase().trim();
      // Only keep if it matches a known medication pattern AND is short
      // (avoids keeping narrative like "пациенту назначен препарат X по такой-то схеме")
      if (lower.length <= 30 && /^[а-яёa-z][а-яёa-z\-]{3,25}$/i.test(lower)) {
        terms.add(lower);
      }
    }
  }
  if (sourceText) {
    let m: RegExpExecArray | null;
    MEDICATION_PATTERN.lastIndex = 0;
    while ((m = MEDICATION_PATTERN.exec(sourceText)) !== null) {
      const drug = m[1]?.toLowerCase().trim();
      if (drug && drug.length >= 4 && drug.length <= 25) {
        terms.add(drug);
      }
    }
  }

  // 6. Extract diagnosis entities
  if (entities) {
    for (const e of entities) {
      if (e.type === "diagnosis") {
        // Check if the diagnosis value contains a known clinical term
        let m: RegExpExecArray | null;
        CLINICAL_TERM_REGEX.lastIndex = 0;
        while ((m = CLINICAL_TERM_REGEX.exec(e.value)) !== null) {
          terms.add(m[1].toLowerCase().trim());
        }
      }
    }
  }

  // 7. Cap the number of terms (avoid overly long queries) with PRIORITIZATION.
  // Order: genes (uppercase) > clinical terms (lowercase phrases) > medications
  // > ICD-10 codes. This ensures the most clinically specific terms are kept
  // when the cap is hit, giving the search engine the best chance of finding
  // relevant articles.
  const MAX_TERMS = 8;
  const allTerms = Array.from(terms);
  const genes = allTerms.filter(t => /^[A-Z][A-Z0-9\-]{1,10}$/.test(t) && KNOWN_GENES.has(t));
  const icd10 = allTerms.filter(t => /^[A-Z]\d{2}(\.\d+)?$/.test(t));
  const meds = allTerms.filter(t => KNOWN_MEDICATIONS.has(t.toLowerCase()));
  const clinical = allTerms.filter(t =>
    !genes.includes(t) && !icd10.includes(t) && !meds.includes(t)
  );
  // Interleave: 2 genes, 3 clinical terms, 2 medications, 1 ICD-10 (adjust as available)
  const termArray = [
    ...genes.slice(0, 3),
    ...clinical.slice(0, 3),
    ...meds.slice(0, 2),
    ...icd10.slice(0, 1),
  ]
    // Deduplicate (a term could appear in multiple categories if it matches
    // multiple patterns — e.g. "MSI" is both a gene and could be clinical)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, MAX_TERMS);

  // 8. v2.3.1: Add English translations for Russian clinical terms & medications.
  // PubMed (NCBI) is an English-language database — Russian terms return 0
  // results. We add the English translation ALONGSIDE the Russian term so:
  //   - PubMed can find articles (English)
  //   - DuckDuckGo can find Russian sources like Минздав РФ (Russian)
  // The English terms are stored in a separate field so the web-rag module
  // can use them for the PubMed query specifically.
  const englishTerms: string[] = [];
  for (const term of termArray) {
    const lower = term.toLowerCase();
    // Check clinical term translations
    const clinTrans = RU_TO_EN_CLINICAL[lower];
    if (clinTrans && !englishTerms.includes(clinTrans) && !termArray.includes(clinTrans)) {
      englishTerms.push(clinTrans);
    }
    // Check medication translations
    const medTrans = RU_TO_EN_MEDICATION[lower];
    if (medTrans && !englishTerms.includes(medTrans) && !termArray.includes(medTrans)) {
      englishTerms.push(medTrans);
    }
  }

  if (termArray.length === 0) {
    warnings.push("No clinical terms could be extracted for web search query.");
  }
  if (removedPHI.length > 0) {
    warnings.push(`${removedPHI.length} PHI token(s) detected in source and excluded from query.`);
  }

  const query = termArray.join(" ");

  if (removedPHI.length > 0 || warnings.length > 0) {
    logger.info("web-rag", "Query sanitized", {
      termCount: termArray.length,
      removedPHICount: removedPHI.length,
      warnings,
    });
  }

  return {
    query,
    terms: termArray,
    englishTerms,
    removedPHI,
    warnings,
  };
}

/**
 * Build multiple targeted search queries for different authoritative sources.
 * Returns an array of { query, siteFilter } pairs so the web-rag module can
 * search PubMed, NCBI Books, WHO, Cochrane, etc. in parallel.
 *
 * Each query uses the SAME sanitized terms — only the site filter differs.
 * This maximizes coverage across authoritative medical sources while
 * keeping the query PHI-free.
 */
export function buildTargetedQueries(
  sanitized: SanitizedQuery,
): Array<{ query: string; site: string; label: string }> {
  if (!sanitized.query) return [];

  const targets = [
    { site: "pubmed.ncbi.nlm.nih.gov", label: "PubMed" },
    { site: "ncbi.nlm.nih.gov", label: "NCBI" },
    { site: "who.int", label: "WHO" },
    { site: "cochranelibrary.com", label: "Cochrane" },
    { site: "escardio.org", label: "ESC" },
    { site: "nccn.org", label: "NCCN" },
    { site: "minzdrav.gov.ru", label: "Минздрав РФ" },
  ];

  return targets.map((t) => ({
    query: `${sanitized.query} site:${t.site}`,
    site: t.site,
    label: t.label,
  }));
}

// ---------------------------------------------------------------------------
// v4.1: Извлечение диагностических фраз для поиска КР Минздрава
// ---------------------------------------------------------------------------
// Репозиторий КР Минздрава (cr.minzdrav.gov.ru) ищет по подстроке НАЗВАНИЯ
// клинической рекомендации, напр. «Артериальная гипертензия у взрослых».
// Короткие термины-слова («гипертензия») дают шумный/нулевой результат, а
// падежные формы («гипертензией») не совпадают со словарём. Эта функция
// извлекает ПОЛНЫЕ диагностические фразы (до 6 слов) из:
//   • diagnosisHint врача (уже деидентифицирован — это название диагноза)
//   • NER-сущностей типа «diagnosis» (номинативная форма от NER)
//   • словарных клинических терминов с морфологической толерантностью
//     (стем до 6+ символов + до 4 падежных окончаний)
// Каждая фраза прогоняется через PHI-фильтр перед возвратом — наружу
// уходит только клиническая терминология (ФЗ-152, ФЗ-323 ст. 13).
// ---------------------------------------------------------------------------

/** Морфологически-толерантная проверка вхождения словарного термина. */
function termMatchesWithMorphology(text: string, term: string): boolean {
  if (text.includes(term)) return true;
  // Стем: основа термина (без последних 2 символов, если длинно) + окончания
  if (term.length >= 7) {
    const stem = term.slice(0, Math.max(6, term.length - 2));
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[а-яё]{0,4}(?![\\p{L}\\p{N}])`,
      "iu",
    );
    if (re.test(text)) return true;
  }
  return false;
}

/** Очищает фразу диагноза от немедицинских слов и PHI-паттернов. */
function cleanDiagnosisPhrase(raw: string): string {
  let phrase = raw
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    // обрезаем ведущие связки
    .replace(/^(?:у\s+|диагноз[:\s]+|предположительно\s+|основной\s+|сопутствующий\s+)/g, "")
    // удаляем возрастные/половые маркеры с числами (потенциальный PHI)
    .replace(/\b\d{1,3}\s*(?:лет|год(?:а|ов)|мес|месяцев|дн(?:я|ей))\b/g, "")
    .trim();

  // PHI-фильтр: если фраза содержит что-то похожее на имя/телефон/дату — отбрасываем
  for (const { regex } of PHI_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(phrase)) return "";
  }

  // Оставляем максимум 6 слов
  const words = phrase.split(" ").filter(Boolean).slice(0, 6);
  phrase = words.join(" ");

  // Минимальная длина и хотя бы одно слово длиннее 4 символов
  if (phrase.length < 5) return "";
  if (!words.some((w) => w.length >= 5 && /[а-яёa-z]/.test(w))) return "";
  return phrase;
}

/**
 * Извлекает диагностические фразы для поиска КР Минздрава.
 * Возвращает до 3 фраз, приоритет: diagnosisHint → NER-диагнозы → словарь.
 */
export function extractDiagnosisPhrasesForCrSearch(params: {
  diagnosisHint?: string | null;
  entities?: Array<{ type: string; value: string }>;
  dischargeSummary?: string;
}): string[] {
  const phrases: string[] = [];
  const push = (p: string) => {
    const cleaned = cleanDiagnosisPhrase(p);
    if (cleaned && !phrases.includes(cleaned) && phrases.length < 3) {
      phrases.push(cleaned);
    }
  };

  // 1. DiagnosisHint врача — самый сильный сигнал
  if (params.diagnosisHint) {
    // Берём первое предложение / до точки, запятой или переноса
    const first = params.diagnosisHint.split(/[.,;\n]/)[0] ?? params.diagnosisHint;
    push(first);
  }

  // 2. NER-диагнозы (номинативная форма)
  if (params.entities) {
    for (const e of params.entities) {
      if (e.type === "diagnosis" && e.value) {
        push(e.value);
        if (phrases.length >= 3) break;
      }
    }
  }

  // 3. Словарные клинические термины из текста (с морфологией)
  if (params.dischargeSummary && phrases.length < 3) {
    const lower = params.dischargeSummary.toLowerCase();
    for (const term of CLINICAL_TERMS_RU) {
      const plain = term.replace(/[.*+?^${}()|[\]\\]/g, "");
      if (termMatchesWithMorphology(lower, plain.toLowerCase())) {
        push(plain);
        if (phrases.length >= 3) break;
      }
    }
  }

  return phrases;
}
