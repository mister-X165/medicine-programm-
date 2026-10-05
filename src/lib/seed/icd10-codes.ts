// СППВР v2.0 — Seed-данные ICD-10 кодов (МКБ-10)
// Источник: МКБ-10 (российская версия), ВОЗ
// Покрывает: онкологию, кардиологию, эндокринологию, фармакогеномику, редкие заболевания

export interface ICD10CodeSeed {
  code: string;
  description: string;
  chapter: string;
  block: string;
  parentCode: string | null;
}

export const icd10Codes: ICD10CodeSeed[] = [
  // ==========================================================================
  // ОНКОЛОГИЯ (C00-C97)
  // ==========================================================================
  { code: "C00", description: "Злокачественное новообразование губы", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C15", description: "Злокачественное новообразование пищевода", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C16", description: "Злокачественное новообразование желудка", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C18", description: "Злокачественное новообразование ободочной кишки", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C18.0", description: "Злокачественное новообразование слепой кишки", chapter: "II Новообразования", block: "C00-C75", parentCode: "C18" },
  { code: "C18.7", description: "Злокачественное новообразование сигмовидной кишки", chapter: "II Новообразования", block: "C00-C75", parentCode: "C18" },
  { code: "C19", description: "Злокачественное новообразование ректосигмоидного соединения", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C20", description: "Злокачественное новообразование прямой кишки", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C25", description: "Злокачественное новообразование поджелудочной железы", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C34", description: "Злокачественное новообразование бронхов и лёгкого", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C34.0", description: "Злокачественное новообразование главного бронха", chapter: "II Новообразования", block: "C00-C75", parentCode: "C34" },
  { code: "C34.1", description: "Злокачественное новообразование верхней доли бронха/лёгкого", chapter: "II Новообразования", block: "C00-C75", parentCode: "C34" },
  { code: "C34.2", description: "Злокачественное новообразование средней доли бронха/лёгкого", chapter: "II Новообразования", block: "C00-C75", parentCode: "C34" },
  { code: "C34.3", description: "Злокачественное новообразование нижней доли бронха/лёгкого", chapter: "II Новообразования", block: "C00-C75", parentCode: "C34" },
  { code: "C50", description: "Злокачественное новообразование молочной железы", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C50.0", description: "Сосков и ареолы молочной железы", chapter: "II Новообразования", block: "C00-C75", parentCode: "C50" },
  { code: "C50.1", description: "Центральной части молочной железы", chapter: "II Новообразования", block: "C00-C75", parentCode: "C50" },
  { code: "C50.2", description: "Верхневнутреннего квадранта молочной железы", chapter: "II Новообразования", block: "C00-C75", parentCode: "C50" },
  { code: "C50.4", description: "Верхненаружного квадранта молочной железы", chapter: "II Новообразования", block: "C00-C75", parentCode: "C50" },
  { code: "C50.5", description: "Нижненаружного квадранта молочной железы", chapter: "II Новообразования", block: "C00-C75", parentCode: "C50" },
  { code: "C50.8", description: "Поражение молочной железы, выходящее за пределы одной и более вышеуказанных зон", chapter: "II Новообразования", block: "C00-C75", parentCode: "C50" },
  { code: "C50.9", description: "Молочной железы неуточнённой локализации", chapter: "II Новообразования", block: "C00-C75", parentCode: "C50" },
  { code: "C53", description: "Злокачественное новообразование шейки матки", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C54", description: "Злокачественное новообразование тела матки", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C56", description: "Злокачественное новообразование яичника", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C61", description: "Злокачественное новообразование предстательной железы", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C64", description: "Злокачественное новообразование почки, кроме почечной лоханки", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C67", description: "Злокачественное новообразование мочевого пузыря", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C71", description: "Злокачественное новообразование головного мозга", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C73", description: "Злокачественное новообразование щитовидной железы", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C43", description: "Злокачественная меланома кожи", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C44", description: "Другие злокачественные новообразования кожи", chapter: "II Новообразования", block: "C00-C75", parentCode: null },
  { code: "C77", description: "Вторичное и неуточнённое злокачественное новообразование лимфатических узлов", chapter: "II Новообразования", block: "C77-C80", parentCode: null },
  { code: "C78", description: "Вторичное злокачественное новообразование дыхательных и пищеварительных органов", chapter: "II Новообразования", block: "C77-C80", parentCode: null },
  { code: "C79", description: "Вторичное злокачественное новообразование других и неуточнённых локализаций", chapter: "II Новообразования", block: "C77-C80", parentCode: null },
  { code: "C80", description: "Злокачественное новообразование без уточнения локализации", chapter: "II Новообразования", block: "C77-C80", parentCode: null },
  { code: "C81", description: "Болезнь Ходжкина [лимфогранулематоз]", chapter: "II Новообразования", block: "C81-C96", parentCode: null },
  { code: "C82", description: "Фолликулярная неходжкинская лимфома", chapter: "II Новообразования", block: "C81-C96", parentCode: null },
  { code: "C85", description: "Другие и неуточнённые типы неходжкинской лимфомы", chapter: "II Новообразования", block: "C81-C96", parentCode: null },
  { code: "C90", description: "Множественная миелома и злокачественные плазмоклеточные новообразования", chapter: "II Новообразования", block: "C81-C96", parentCode: null },
  { code: "C91", description: "Лимфоидный лейкоз", chapter: "II Новообразования", block: "C81-C96", parentCode: null },
  { code: "C91.0", description: "Острый лимфобластный лейкоз", chapter: "II Новообразования", block: "C81-C96", parentCode: "C91" },
  { code: "C92", description: "Миелоидный лейкоз", chapter: "II Новообразования", block: "C81-C96", parentCode: null },
  { code: "C92.0", description: "Острый миелоидный лейкоз", chapter: "II Новообразования", block: "C81-C96", parentCode: "C92" },
  { code: "C95", description: "Лейкоз неуточнённого клеточного типа", chapter: "II Новообразования", block: "C81-C96", parentCode: null },

  // ==========================================================================
  // КАРДИОЛОГИЯ (I00-I99)
  // ==========================================================================
  { code: "I10", description: "Эссенциальная (первичная) гипертензия", chapter: "IX Болезни системы кровообращения", block: "I10-I15", parentCode: null },
  { code: "I11", description: "Гипертензивная болезнь сердца", chapter: "IX Болезни системы кровообращения", block: "I10-I15", parentCode: null },
  { code: "I20", description: "Стенокардия [грудная жаба]", chapter: "IX Болезни системы кровообращения", block: "I20-I25", parentCode: null },
  { code: "I21", description: "Острый инфаркт миокарда", chapter: "IX Болезни системы кровообращения", block: "I20-I25", parentCode: null },
  { code: "I21.0", description: "Острый трансмуральный инфаркт передней стенки левого желудочка", chapter: "IX Болезни системы кровообращения", block: "I20-I25", parentCode: "I21" },
  { code: "I21.1", description: "Острый трансмуральный инфаркт нижней стенки миокарда", chapter: "IX Болезни системы кровообращения", block: "I20-I25", parentCode: "I21" },
  { code: "I25", description: "Хроническая ишемическая болезнь сердца", chapter: "IX Болезни системы кровообращения", block: "I20-I25", parentCode: null },
  { code: "I25.1", description: "Атеросклеротическая болезнь сердца", chapter: "IX Болезни системы кровообращения", block: "I20-I25", parentCode: "I25" },
  { code: "I42", description: "Кардиомиопатия", chapter: "IX Болезни системы кровообращения", block: "I30-I52", parentCode: null },
  { code: "I42.1", description: "Обструктивная гипертрофическая кардиомиопатия", chapter: "IX Болезни системы кровообращения", block: "I30-I52", parentCode: "I42" },
  { code: "I42.2", description: "Другая гипертрофическая кардиомиопатия", chapter: "IX Болезни системы кровообращения", block: "I30-I52", parentCode: "I42" },
  { code: "I48", description: "Фибрилляция и трепетание предсердий", chapter: "IX Болезни системы кровообращения", block: "I30-I52", parentCode: null },
  { code: "I50", description: "Сердечная недостаточность", chapter: "IX Болезни системы кровообращения", block: "I30-I52", parentCode: null },
  { code: "I70", description: "Атеросклероз", chapter: "IX Болезни системы кровообращения", block: "I70-I79", parentCode: null },
  { code: "I71", description: "Аневризма и расслоение аорты", chapter: "IX Болезни системы кровообращения", block: "I70-I79", parentCode: null },
  { code: "I82", description: "Эмболия и тромбоз других вен", chapter: "IX Болезни системы кровообращения", block: "I80-I89", parentCode: null },

  // ==========================================================================
  // ЭНДОКРИНОЛОГИЯ (E00-E89)
  // ==========================================================================
  { code: "E03", description: "Другие формы гипотиреоза", chapter: "IV Болезни эндокринной системы", block: "E00-E07", parentCode: null },
  { code: "E05", description: "Тиреотоксикоз", chapter: "IV Болезни эндокринной системы", block: "E00-E07", parentCode: null },
  { code: "E06", description: "Тиреоидит", chapter: "IV Болезни эндокринной системы", block: "E00-E07", parentCode: null },
  { code: "E10", description: "Инсулинозависимый сахарный диабет", chapter: "IV Болезни эндокринной системы", block: "E10-E14", parentCode: null },
  { code: "E11", description: "Инсулинонезависимый сахарный диабет", chapter: "IV Болезни эндокринной системы", block: "E10-E14", parentCode: null },
  { code: "E11.5", description: "Инсулинонезависимый сахарный диабет с нарушением периферического кровообращения", chapter: "IV Болезни эндокринной системы", block: "E10-E14", parentCode: "E11" },
  { code: "E11.6", description: "Инсулинонезависимый сахарный диабет с другими осложнениями", chapter: "IV Болезни эндокринной системы", block: "E10-E14", parentCode: "E11" },
  { code: "E78", description: "Нарушения обмена липопротеинов и другие липидемии", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: null },
  { code: "E78.0", description: "Чистая гиперхолестеринемия", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: "E78" },
  { code: "E78.2", description: "Смешанная гиперлипидемия", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: "E78" },
  { code: "E78.3", description: "Гиперхолестеринемия семейная", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: "E78" },

  // ==========================================================================
  // ФАРМАКОГЕНОМИКА-СВЯЗАННЫЕ СОСТОЯНИЯ
  // ==========================================================================
  { code: "D57", description: "Серповидноклеточные нарушения", chapter: "III Болезни крови", block: "D55-D59", parentCode: null },
  { code: "D57.0", description: "Серповидноклеточная анемия с кризом", chapter: "III Болезни крови", block: "D55-D59", parentCode: "D57" },
  { code: "D57.1", description: "Серповидноклеточная анемия без криза", chapter: "III Болезни крови", block: "D55-D59", parentCode: "D57" },
  { code: "D58", description: "Другие наследственные гемолитические анемии", chapter: "III Болезни крови", block: "D55-D59", parentCode: null },
  { code: "E80", description: "Нарушения обмена порфирина и билирубина", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: null },
  { code: "E80.0", description: "Наследственный синдром Жильбера", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: "E80" },
  { code: "L23", description: "Аллергический контактный дерматит", chapter: "XII Болезни кожи", block: "L20-L30", parentCode: null },
  { code: "L27", description: "Дерматит, вызванный веществами, принятыми внутрь", chapter: "XII Болезни кожи", block: "L20-L30", parentCode: null },
  { code: "T88", description: "Другие осложнения хирургических и терапевтических процедур, не классифицированные в других рубриках", chapter: "XIX Травмы", block: "T80-T88", parentCode: null },
  { code: "T88.7", description: "Патологическая реакция на лекарственное средство или вакцину неуточнённая", chapter: "XIX Травмы", block: "T80-T88", parentCode: "T88" },

  // ==========================================================================
  // РЕДКИЕ ЗАБОЛЕВАНИЯ
  // ==========================================================================
  { code: "E84", description: "Муковисцидоз", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: null },
  { code: "E84.0", description: "Муковисцидоз с лёгочными проявлениями", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: "E84" },
  { code: "E84.1", description: "Муковисцидоз с кишечными проявлениями", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: "E84" },
  { code: "E84.8", description: "Муковисцидоз с другими проявлениями", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: "E84" },
  { code: "E84.9", description: "Муковисцидоз неуточнённый", chapter: "IV Болезни эндокринной системы", block: "E70-E90", parentCode: "E84" },
  { code: "Q85", description: "Факоматозы, не классифицированные в других рубриках", chapter: "XVII Врождённые аномалии", block: "Q80-Q89", parentCode: null },
  { code: "Q85.0", description: "Нейрофиброматоз (недоброкачественный)", chapter: "XVII Врождённые аномалии", block: "Q80-Q89", parentCode: "Q85" },
  { code: "Q85.1", description: "Туберозный склероз", chapter: "XVII Врождённые аномалии", block: "Q80-Q89", parentCode: "Q85" },
  { code: "G71", description: "Первичные поражения мышц", chapter: "VI Болезни нервной системы", block: "G70-G73", parentCode: null },
  { code: "G71.0", description: "Мышечная дистрофия", chapter: "VI Болезни нервной системы", block: "G70-G73", parentCode: "G71" },
  // NOTE: C91.0 was previously duplicated (lines 58 + 125). Removed the
  // duplicate here; the canonical entry remains at its original position.
  { code: "D46", description: "Миелодиспластические синдромы", chapter: "III Болезни крови", block: "D46-D47", parentCode: null },
  { code: "D47", description: "Другие новообразования неопределённого или неизвестного характера лимфоидной, кроветворной и родственных им тканей", chapter: "III Болезни крови", block: "D46-D47", parentCode: null },
  { code: "B20", description: "Болезнь, вызванная вирусом иммунодефицита человека [ВИЧ], проявляющаяся в виде инфекционных и паразитарных болезней", chapter: "I Инфекционные болезни", block: "B20-B24", parentCode: null },
  { code: "G40", description: "Эпилепсия", chapter: "VI Болезни нервной системы", block: "G40-G47", parentCode: null },
  { code: "G40.0", description: "Локализованная (фокальная) (парциальная) идиопатическая эпилепсия и эпилептические синдромы с судорожными припадками", chapter: "VI Болезни нервной системы", block: "G40-G47", parentCode: "G40" },
  { code: "G40.3", description: "Генерализованная идиопатическая эпилепсия и эпилептические синдромы", chapter: "VI Болезни нервной системы", block: "G40-G47", parentCode: "G40" },
];

export const ICD10_CODES_COUNT: number = icd10Codes.length;
