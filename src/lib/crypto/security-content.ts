/**
 * Static security content for the CryptoVault UI.
 * Centralises the threat model, container layout, and incident-response
 * procedures so the React components stay declarative.
 */

export interface Threat {
  id: string;
  scenario: string;
  vector: string;
  mitigation: string;
  status: 'active' | 'partial' | 'unavailable';
  specRef: string;
}

export const THREATS: Threat[] = [
  {
    id: 'traffic-intercept',
    scenario: 'Перехват трафика',
    vector: 'Сниффинг, MITM-атаки при передаче зашифрованных файлов по сети.',
    mitigation:
      'AEAD-аутентификация каждого чанка (два независимых тега). Изменение даже 1 бита детектируется до выдачи открытого текста. Контейнер самодостаточен — не требует отдельного TLS для конфиденциальности.',
    status: 'active',
    specRef: 'ТЗ §2 — Перехват трафика',
  },
  {
    id: 'physical-access',
    scenario: 'Физический доступ к носителю',
    vector: 'Извлечение SSD/HDD, холодная boot-атака, чтение дампов памяти.',
    mitigation:
      'Каскадное шифрование (AES-GCM-SIV + ChaCha20-Poly1305). Мастер-ключ выводится из пароля через Argon2id и никогда не записывается на диск. На носителе — только зашифрованный контейнер.',
    status: 'active',
    specRef: 'ТЗ §2 — Физический доступ',
  },
  {
    id: 'cold-boot',
    scenario: 'Cold boot-атака (остатки ключа в RAM)',
    vector: 'Злоумышленник извлекает модули RAM и пытается восстановить ключ.',
    mitigation:
      'secureWipe() зачищает ключи, пароли и промежуточные буферы сразу после использования. Best-effort в браузере; полная гарантия требует native-модуля с memset_s / mlock.',
    status: 'partial',
    specRef: 'ТЗ §2, §3.2 — Защита памяти',
  },
  {
    id: 'bruteforce',
    scenario: 'Брутфорс пароля на GPU/ASIC',
    vector: 'RTX 4090, фермы из тысяч GPU, специализированные ASIC.',
    mitigation:
      'Argon2id с memory-hard параметрами (до 512 MiB). При пароле 20+ символов оценка времени перебора > 10^5 лет на одном RTX 4090.',
    status: 'active',
    specRef: 'ТЗ §3.2, §9',
  },
  {
    id: 'nonce-reuse',
    scenario: 'Повторное использование nonce',
    vector: 'Программная ошибка или компрометация RNG приводит к коллизии nonce.',
    mitigation:
      'NonceTracker регистрирует каждый использованный nonce. При обнаружении коллизии вызывается abort() — операция прерывается, никакого шифротекста не выдаётся. Defence-in-depth поверх детерминированной counter-деривации.',
    status: 'active',
    specRef: 'ТЗ §9 — Повторное использование nonce',
  },
  {
    id: 'keylogger',
    scenario: 'Кейлоггинг',
    vector: 'Вредоносное ПО с правами пользователя перехватывает ввод пароля.',
    mitigation:
      'В браузере невозможно полностью изолировать ввод. Рекомендуется ввод через защищённое окно (UAC secure desktop) в native-сборке. Частичная защита: отсутствие автозаполнения, отключение кэша ввода.',
    status: 'partial',
    specRef: 'ТЗ §5 — Защита от кейлоггинга',
  },
  {
    id: 'side-channel',
    scenario: 'Атаки по сторонним каналам',
    vector: 'Timing analysis, power analysis, cache-timing на AES без AESNI.',
    mitigation:
      'ChaCha20-Poly1305 (второй слой каскада) устойчив к timing-атакам на CPU без аппаратного ускорения AES. Constant-time сравнение тегов и хэшей. AES-GCM-SIV устойчив к nonce-misuse.',
    status: 'active',
    specRef: 'ТЗ §3.1, §5',
  },
  {
    id: 'malware-pc',
    scenario: 'Целенаправленный взлом ПК',
    vector: 'Вредоносное ПО с правами пользователя, чтение памяти процесса.',
    mitigation:
      'В браузере невозможно. Требует native-приложения с анти-дампом (SetProcessMitigation), анти-отладкой (IsDebuggerPresent) и привязкой к TPM 2.0 / YubiKey.',
    status: 'unavailable',
    specRef: 'ТЗ §2, §5 — Целенаправленный взлом',
  },
  {
    id: 'tampering',
    scenario: 'Подмена/модификация контейнера',
    vector: 'Злоумышленник изменяет биты в зашифрованном файле.',
    mitigation:
      'AEAD-тег GCM-SIV и Poly1305 верифицируются до выдачи открытого текста. BLAKE3-256 исходного файла проверяется в трейлере. Изменение 1 бита → отказ расшифровки, ни одного байта plaintext не утекает.',
    status: 'active',
    specRef: 'ТЗ §4.2, §8 — Тестирование целостности',
  },
];

export interface ContainerField {
  offset: string;
  size: string;
  field: string;
  description: string;
}

export const CONTAINER_LAYOUT: ContainerField[] = [
  { offset: '0x00', size: '4 B', field: 'Magic', description: '“CVLT” (0x43564C54) — сигнатура формата.' },
  { offset: '0x04', size: '2 B', field: 'Version', description: 'Версия формата (uint16 BE). Текущая: 0x0001.' },
  { offset: '0x06', size: '1 B', field: 'Flags', description: 'Битовая маска: cascade, hardware-binding (reserved), metadata-encrypted.' },
  { offset: '0x07', size: '1 B', field: 'KDF ID', description: '0x01 = Argon2id.' },
  { offset: '0x08', size: '2 B', field: 'Salt length', description: 'Длина соли KDF (uint16 BE), обычно 16 байт.' },
  { offset: '0x0A', size: 'N', field: 'KDF salt', description: 'Случайная соль для Argon2id.' },
  { offset: '0x0A+N', size: '4 B', field: 'KDF memory', description: 'Memory cost Argon2id в KiB (uint32 BE).' },
  { offset: '0x0E+N', size: '4 B', field: 'KDF iterations', description: 'Time cost Argon2id (uint32 BE).' },
  { offset: '0x12+N', size: '2 B', field: 'KDF parallelism', description: 'Параллелизм Argon2id (uint16 BE).' },
  { offset: '0x14+N', size: '2 B', field: 'KDF output length', description: 'Длина вывода KDF (uint16 BE), обычно 64 байта.' },
  { offset: '0x16+N', size: '1 B', field: 'Cipher 1 ID', description: '0x01 = AES-256-GCM-SIV.' },
  { offset: '0x17+N', size: '12 B', field: 'Cipher 1 master nonce', description: 'Базовый nonce для AES-GCM-SIV.' },
  { offset: '0x23+N', size: '1 B', field: 'Cipher 2 ID', description: '0x02 = ChaCha20-Poly1305.' },
  { offset: '0x24+N', size: '12 B', field: 'Cipher 2 master nonce', description: 'Базовый nonce для ChaCha20-Poly1305.' },
  { offset: '0x30+N', size: '1 B', field: 'Hash algorithm', description: '0x01 = BLAKE3-256.' },
  { offset: '0x31+N', size: '4 B', field: 'Chunk size', description: 'Размер блока в байтах (uint32 BE), по умолчанию 1 MiB.' },
  { offset: '0x35+N', size: '8 B', field: 'Original file size', description: 'Размер исходного файла (uint64 BE).' },
  { offset: '0x3D+N', size: '4 B', field: 'Metadata length', description: 'Длина зашифрованного блока метаданных (uint32 BE).' },
  { offset: '0x41+N', size: 'M', field: 'Encrypted metadata', description: 'Каскадно-зашифрованные имя файла + MIME + размер (counter=0xFFFFFFFF).' },
  { offset: '…', size: 'var', field: 'Encrypted chunks', description: 'Последовательность шифротекстов: каждый = plaintext_chunk + 32 байта (два AEAD-тега).' },
  { offset: 'EOF-32', size: '32 B', field: 'BLAKE3 trailer', description: 'BLAKE3-256 хэш исходного открытого текста.' },
];

export interface IncidentProcedure {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium';
  trigger: string;
  steps: string[];
  recovery: string;
}

export const INCIDENT_PROCEDURES: IncidentProcedure[] = [
  {
    id: 'password-compromised',
    title: 'Компрометация пароля',
    severity: 'critical',
    trigger: 'Подозрение или подтверждение утечки пароля (фишинг, кейлоггер, социальная инженерия).',
    steps: [
      'Немедленно прекратить использование скомпрометированного пароля. Считать все контейнеры, зашифрованные этим паролем, скомпрометированными.',
      'Изолировать затронутые контейнеры: переместить в карантин, ограничить доступ по сети.',
      'Если доступен исходный открытый файл — перешифровать его с новым паролем (минимум 20 символов, лучше passphrase из 4+ случайных слов) и пресетом Argon2id «Максимум» (512 MiB).',
      'Безопасно удалить старые контейнеры (DoD 5220.22-M или физическое уничтожение носителя для критичных данных).',
      'Проверить все системы, где вводился пароль, на наличие вредоносного ПО (антивирус + ручной аудит процессов).',
      'Уведомить ответственных за безопасность в течение 24 часов согласно политике организации.',
    ],
    recovery:
      'Все новые контейнеры должны использовать новый пароль и пресет Argon2id «Максимум». Рекомендуется внедрить аппаратный фактор (TPM/YubiKey) в native-сборке.',
  },
  {
    id: 'container-leak',
    title: 'Утечка зашифрованного контейнера',
    severity: 'high',
    trigger: 'Зашифрованный файл оказался в публичном доступе или у неавторизованных лиц.',
    steps: [
      'Оценить силу пароля и параметры Argon2id, использованные при шифровании. Если пресет «Максимум» (512 MiB) и пароль ≥ 20 символов — риск расшифровки минимален (оценка > 10^5 лет на RTX 4090).',
      'Проверить, не скомпрометирован ли пароль отдельно (если утекли и контейнер, и пароль — данные считаются раскрытыми).',
      'Если пароль не утек — контейнер можно НЕ перешифровывать, но рекомендуется ротация всех связанных паролей.',
      'Задокументировать инцидент: время обнаружения, объём утекших данных, канал утечки.',
      'Уведомить субъектов данных в течение 72 часов согласно GDPR/152-ФЗ, если утекли персональные данные.',
    ],
    recovery:
      'Контейнер остаётся безопасным до тех пор, пока пароль остаётся неизвестен злоумышленнику. Контролируйте каналы распространения.',
  },
  {
    id: 'pc-compromise',
    title: 'Подозрение на компрометацию рабочей станции',
    severity: 'critical',
    trigger: 'Обнаружение вредоносного ПО, аномальная сетевая активность, несанкционированный доступ.',
    steps: [
      'Считать, что все ключи, введённые на этой станции, скомпрометированы. В браузере нет защиты от кейлоггеров и memory-scraping вредоносного ПО.',
      'Физически изолировать станцию от сети. Загрузиться с доверенного live-носителя (Tails / Kali).',
      'Перенести зашифрованные контейнеры на чистый носитель через односторонний канал (только чтение).',
      'Перешифровать все перенесённые контейнеры с новым паролем на заведомо чистой станции.',
      'Полная переустановка ОС на скомпрометированной станции; сброс паролей всех учётных записей.',
      'Аудит всех доступов, выполненных с момента предполагаемой компрометации.',
    ],
    recovery:
      'Браузерная сборка НЕ обеспечивает защиту при компрометации ПК. Для критичных данных необходима native-сборка с TPM 2.0, анти-дампом и secure desktop.',
  },
  {
    id: 'tampering-detected',
    title: 'Обнаружена модификация контейнера',
    severity: 'medium',
    trigger: 'При расшифровке получена ошибка DecryptionError или несовпадение BLAKE3.',
    steps: [
      'Не пытаться расшифровать повторно — возможна атака oracle. Изолировать контейнер.',
      'Проверить канал передачи: возможно повреждение при передаче или целенаправленная подмена.',
      'Если есть эталонная копия — сравнить хэши. Если эталон отсутствует — данные считаются утерянными.',
      'Определить, какой именно чанк повреждён (по индексу в сообщении об ошибке).',
      'Если повреждение случайное (bit rot) — восстановить из резервной копии. Если целенаправленное — инцидент безопасности, см. процедуру container-leak.',
    ],
    recovery:
      'Каскад AEAD гарантирует: при любой модификации ни одного байта открытого текста не будет выдано. Это свойство «fail-closed» защищает от oracle-атак.',
  },
];

export interface BrowserLimitation {
  requirement: string;
  specRef: string;
  reason: string;
  nativeSolution: string;
}

export const BROWSER_LIMITATIONS: BrowserLimitation[] = [
  {
    requirement: 'Привязка к TPM 2.0 / аппаратному ключу (YubiKey)',
    specRef: 'ТЗ §3.2, §4.1',
    reason:
      'Браузерный JavaScript не имеет API для прямой работы с TPM. WebAuthn/FIDO2 доступен, но предназначен для аутентификации, а не для симметричного шифрования ключей.',
    nativeSolution:
      'Rust + tss-esapi или Go + go-tpm2. Мастер-ключ генерируется внутри TPM, недоступен для CPU. YubiKey через PIV/PIVX.',
  },
  {
    requirement: 'Hardware Binding (MAC, серийник материнской платы)',
    specRef: 'ТЗ §4.1',
    reason:
      'Браузер намеренно скрывает аппаратные идентификаторы для защиты приватности. Любой fingerprinting — вероятностный и не криптостойкий.',
    nativeSolution:
      'Native-модуль: чтение DMI/SMBIOS, MAC через netlink, серийного номера диска через ioctl SG_IO.',
  },
  {
    requirement: 'Анти-дамп памяти (SetProcessMitigation)',
    specRef: 'ТЗ §5',
    reason:
      'Браузерный процесс управляется ОС, JS не может устанавливать mitigation-политики. Любой процесс-дампер (gdb, procdump) получит память вкладки целиком.',
    nativeSolution:
      'Windows: SetProcessMitigationPolicy(ProcessSystemCallDisablePolicy, ProcessExtensionPointDisablePolicy, ProcessASLRPolicy). Linux: prctl(PR_SET_DUMPABLE, 0).',
  },
  {
    requirement: 'Анти-отладка (IsDebuggerPresent, ptrace)',
    specRef: 'ТЗ §5',
    reason:
      'JS не может обнаружить отладчик host-процесса. DevTools детектируются ненадёжно (через timing), но это легко обходится.',
    nativeSolution:
      'Windows: IsDebuggerPresent, NtQueryInformationProcess(ProcessDebugPort), CheckRemoteDebuggerPresent. Linux: ptrace(PTRACE_TRACEME) fail-check.',
  },
  {
    requirement: 'Защищённый ввод пароля (UAC / secure desktop)',
    specRef: 'ТЗ §5',
    reason:
      'Браузер работает в user-space текущего desktop-сеанса. Кейлоггер user-space перехватит ввод в любое DOM-поле.',
    nativeSolution:
      'Native: CreateDialog на WinSta\\Winlogon desktop ( secure desktop) или отдельный процесс с SYSTEM-токеном.',
  },
  {
    requirement: 'Гарантированная зачистка памяти (memset_s)',
    specRef: 'ТЗ §3.2',
    reason:
      'GC и JIT компилятор JavaScript могут оставлять копии строк и буферов в памяти. secureWipe() работает best-effort, но не гарантирует полное уничтожение.',
    nativeSolution:
      'Rust: zeroize crate с #[zeroize(drop)] на структурах с ключами. C: memset_s (C11 Annex K), explicit_bzero (POSIX), SecureZeroMemory (Windows).',
  },
  {
    requirement: 'NIST CAVP сертификация AES/DRBG',
    specRef: 'ТЗ §9',
    reason:
      'Сертификация NIST CAVP применяется к конкретным бинарным реализациям алгоритмов, скомпилированным под конкретную платформу. Браузерный WASM не сертифицируется.',
    nativeSolution:
      'Использовать сертифицированную библиотеку: OpenSSL FIPS module, AWS-LC FIPS, BoringCrypto FIPS. Пройти CAVP-тестирование на целевой платформе.',
  },
];

export interface AcceptanceCriterion {
  id: string;
  criterion: string;
  status: 'met' | 'partial' | 'not-applicable';
  evidence: string;
}

export const ACCEPTANCE_CRITERIA: AcceptanceCriterion[] = [
  {
    id: 'cavp',
    criterion: 'Продукт успешно проходит все тесты NIST CAVP для AES и DRBG.',
    status: 'not-applicable',
    evidence:
      'Браузерная сборка использует @noble/ciphers (JS/WASM) — не сертифицируется CAVP. Сертификация доступна только для native FIPS-модуля (OpenSSL FIPS / AWS-LC).',
  },
  {
    id: 'argon2-cost',
    criterion:
      'Время взлома пароля Argon2id при переборе на RTX 4090 — > 10^5 лет (при пароле 20 символов).',
    status: 'met',
    evidence:
      'При пресете «Максимум» (512 MiB, 5 итераций) оценка времени перебора 20-символьного пароля составляет > 10^9 лет на одном RTX 4090. См. калькулятор в инструменте.',
  },
  {
    id: 'nonce-abort',
    criterion: 'Повторное использование nonce блокируется на уровне ядра криптографии.',
    status: 'met',
    evidence:
      'Класс NonceTracker регистрирует каждый использованный nonce. При обнаружении коллизии выбрасывается NonceReuseError и операция прерывается без выдачи шифротекста.',
  },
  {
    id: 'disk-encryption',
    criterion:
      'При физическом извлечении SSD данные на диске нечитаемы (при условии, что ключ не хранится на диске).',
    status: 'met',
    evidence:
      'Контейнер хранит только зашифрованные данные и KDF-соль. Мастер-ключ выводится из пароля в RAM и никогда не записывается на диск.',
  },
  {
    id: 'incident-plan',
    criterion: 'Наличие детализированного плана реагирования на инциденты.',
    status: 'met',
    evidence:
      'См. раздел «План реагирования на инциденты» ниже — 4 процедуры: компрометация пароля, утечка контейнера, компрометация ПК, обнаружение модификации.',
  },
];
