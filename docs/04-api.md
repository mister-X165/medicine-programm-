# 04. API

## 1. Базовые соглашения

| Параметр | Значение |
|---|---|
| База | `http://localhost:3000/api` (за Caddy — `http://host:81/api`) |
| Формат | JSON (`Content-Type: application/json`), кроме загрузки файлов (`multipart/form-data`) и SSE |
| Аутентификация | HttpOnly cookie `token` (SameSite=Strict). Заголовок `Authorization: Bearer …` поддерживается, но клиент его не использует |
| Валидация | zod-схемы из `src/lib/validation.ts`; ошибка → `400` с текстом |
| Ошибки | `{ "error": "…", "errorCode"?: "…" }` |
| Rate limit | 20 запросов/мин на IP для `/api/auth*`, 300/мин для остальных `/api/*` |
| Идемпотентность | Не гарантируется; повторный анализ создаёт новую версию |

### Коды ответов

| Код | Когда |
|---|---|
| `200/201` | Успех |
| `400` | Ошибка валидации/неверный JSON |
| `401` | Нет/истёк токен (сессия) |
| `403` | Нет прав, нет согласия (`CONSENT_MISSING`/`CONSENT_EXPIRED`), аккаунт заблокирован |
| `404` | Объект не найден |
| `409` | Конфликт (повторная подпись, дубль) |
| `413` | Файл больше 25 МБ |
| `429` | `RATE_LIMITED` — превышен лимит запросов |
| `500` | Внутренняя ошибка (анализ при этом возвращает кейс в `uploaded`) |
| `503` | `JWT_SECRET` не сконфигурирован (fail-closed) |

## 2. Аутентификация и роли

```bash
# Вход
curl -c cookies.txt -X POST http://localhost:3000/api/auth?action=login \
  -H "Content-Type: application/json" \
  -d '{"doctorCode":"ADMIN","password":"…"}'

# Дальше cookie подставляется автоматически
curl -b cookies.txt http://localhost:3000/api/cases
```

- JWT: HS256, TTL 2 ч, `tokenVersion` сверяется с БД (кэш 30 c), `isActive` проверяется.
- Скользящее продление: если до истечения < 1 ч, proxy выдаёт новый токен и обновляет cookie.
- Роли: `admin` — полный доступ + админские маршруты; `doctor` — свои кейсы, карты с грантами,
  общая база знаний.

### Уровни доступа в таблицах ниже

| Метка | Значение |
|---|---|
| **public** | Доступно без сессии (proxy allowlist) |
| **session** | Любой аутентифицированный врач |
| **admin** | Только `role=admin` (proxy + route-level) |
| **case** | Владелец кейса, получатель `CaseShare` или админ (`requireCaseAccess`) |
| **patient** | Владелец карты, получатель `PatientAccessGrant` или админ (`requirePatientAccess`) |

## 3. Каталог маршрутов

### 3.1 Система

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET | `/api` | public | Корневая заглушка/информация |
| GET | `/api/health` | public | Статус БД, ИИ, storage, RAG, DDI, МКБ-10 |
| GET | `/api/network/status` | public | Состояние сети/circuit breaker |
| POST | `/api/network/status` | admin | Принудительный probe |

### 3.2 Аутентификация и врачи

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| POST | `/api/auth?action=login` | public | Вход, выдача JWT + cookie |
| POST | `/api/auth?action=logout` | public | Очистка cookie |
| POST | `/api/auth?action=register` | public* | Саморегистрация (если `REGISTRATION_OPEN=true`) |
| POST | `/api/auth?action=set-password` | session/public** | Смена/установка пароля |
| GET | `/api/auth/init` | public | Статус инициализации (без пароля) |
| POST | `/api/auth/init` | public (localhost) | Создание админа + seed, одноразовый пароль |
| GET/POST/PUT | `/api/auth/key` | session | E2EE key material врача |
| GET | `/api/doctors` | public | Список врачей (ограниченные поля) |
| POST | `/api/doctors` | admin | Создать врача |
| GET | `/api/doctors/{id}` | session | Профиль |
| PATCH/DELETE | `/api/doctors/{id}` | admin | Изменить/деактивировать |

\* регистрация возвращает `403`, если `REGISTRATION_OPEN=false`.
\** установка первого пароля — по одноразовому паролю; смена — по сессии.

### 3.3 Кейсы и анализ

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET | `/api/cases` | session | Список кейсов (свои; админ — все) |
| POST | `/api/cases` | session | Создать кейс (`diagnosisHint`, `birthYear`, `sex`, `notes`, `icd10Codes`) |
| GET | `/api/cases/{id}` | case | Кейс + документы + анализ + отчёты |
| PATCH | `/api/cases/{id}` | case | Изменить статус/подсказку диагноза |
| DELETE | `/api/cases/{id}` | case | Удалить кейс |
| GET | `/api/cases/{id}/documents` | case | Список документов |
| POST | `/api/cases/{id}/documents` | case | Загрузка (multipart, ≤ 25 МБ, allowlist типов) |
| GET | `/api/cases/{id}/documents/{docId}` | case | Метаданные/содержимое документа |
| DELETE | `/api/cases/{id}/documents/{docId}` | case | Удалить документ |
| POST | `/api/cases/{id}/analyze` | владелец/админ | Запуск ИИ-конвейера (`{ manual?: boolean }`) |
| GET | `/api/cases/{id}/analysis` | case | Текущий результат анализа |
| PATCH | `/api/cases/{id}/analysis/control` | case | Подтверждение диагноза, статус трекера, веса, комментарии, правка заключения |
| GET | `/api/cases/{id}/analysis/versions` | case | История версий и снапшоты |
| GET/POST/PATCH | `/api/cases/{id}/consents` | case | Согласия пациента (ФЗ-152) |
| POST | `/api/cases/{id}/therapy` | case | Терапевтические рекомендации (устаревший контур) |
| POST | `/api/cases/{id}/ddi-override` | владелец/админ | Фиксация решения врача по DDI-алерту |
| GET/POST/DELETE | `/api/cases/{id}/share` | case | Передача кейса другому врачу |
| GET/POST | `/api/cases/{id}/reports` | case | Список/создание отчёта |

### 3.4 ИИ-помощники (вне основного конвейера)

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| POST | `/api/ai/chat` | session + patient | Чат по карте пациента (контекст ЭМК) |
| POST | `/api/ai/differential-diagnosis` | session | Быстрый диф. диагноз по тексту |
| POST | `/api/ai/drug-check` | session | Проверка препаратов |
| POST | `/api/ai/lab-interpretation` | session | Интерпретация анализов |
| POST | `/api/chat` | session | Общий чат-ассистент (RAG) |
| GET/POST | `/api/ner` | session | Де-идентификация/NER текста |

### 3.5 Знания, RAG, справочники

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET | `/api/recommendations` | public | Поиск по локальной базе КР (`q`, `gene`, `category`) |
| GET | `/api/icd10` | public | Поиск МКБ-10 по строке |
| POST | `/api/icd10` | session | Подбор кодов через LLM |
| GET | `/api/pathways` | public | Клинические пути |
| POST | `/api/pathways` | session | Сопоставление пути с диагнозом |
| GET | `/api/ddi` | public | Локальная таблица DDI |
| POST | `/api/ddi` | session | Проверка пары препаратов |
| POST | `/api/ddi/stream` | session | Потоковая проверка (SSE) — см. §6 |
| GET | `/api/knowledge` | session | Поиск по базе знаний |
| GET | `/api/knowledge/documents` | session | Список документов базы знаний |
| GET/DELETE | `/api/knowledge/documents/{id}` | session | Документ/удаление |
| GET | `/api/minzdrav/clinrecs` | session | Поиск КР Минздрава РФ |
| GET | `/api/minzdrav/clinrecs/{codeVersion}` | session | Полный текст КР |
| GET | `/api/minzdrav/mkb` | session | Справочник МКБ для сопоставления |
| GET/POST | `/api/web-rag` | session / case | Внешний поиск КР + международные источники |
| GET | `/api/search` | session | Глобальный поиск (кейсы, пациенты, знания) с ограничением по владельцу |

### 3.6 Пациенты и ЭМК

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET/POST | `/api/patients` | session | Список (свои)/создание карты |
| GET/PATCH/DELETE | `/api/patients/{id}` | patient | Карта, изменение, удаление |
| GET/POST | `/api/patients/{id}/visits` | patient | Визиты |
| GET/POST | `/api/patients/{id}/vitals` | patient | Витальные |
| GET/POST | `/api/patients/{id}/medications` | patient | Препараты |
| GET/POST | `/api/patients/{id}/labs` | patient | Лаборатория |
| GET/POST | `/api/patients/{id}/problems` | patient | Проблемы |
| GET/POST | `/api/patients/{id}/immunizations` | patient | Прививки |
| GET/POST | `/api/patients/{id}/careplans` | patient | Планы ведения |
| GET/POST | `/api/patients/{id}/examinations` | patient | Обследования (`status`, `type` фильтры) |
| PATCH/DELETE | `/api/examinations/{id}` | patient | Изменить/удалить обследование |
| GET/POST/DELETE | `/api/patients/{id}/grants` | patient | Гранты доступа к карте |
| GET | `/api/patients/{id}/health-score` | patient | Композитный индекс здоровья |
| GET | `/api/patients/{id}/ddi-overview` | patient | Сводка DDI по активной терапии |
| GET | `/api/patients/{id}/med-check` | patient | Проверка лекарственной безопасности |
| GET | `/api/health-scores-batch` | session | Индексы здоровья для списка пациентов |
| GET | `/api/clinical-reminders` | session | Напоминания (просроченные обследования и т.п.) |

### 3.7 Отчёты и подписи

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET | `/api/reports/{id}` | владелец/админ | Отчёт, подписи, скачивание PDF |
| PATCH | `/api/reports/{id}` | владелец/админ | Правка/статус (`draft`→`approved`) |
| DELETE | `/api/reports/{id}` | владелец/админ | Удаление |
| POST | `/api/reports/{id}/sign` | session | Подпись (`approval`/`review`/`cosign`); approval → `signed` |
| GET/POST | `/api/templates` | public (GET) / admin (POST) | Шаблоны отчётов |
| GET/PATCH/DELETE | `/api/templates/{id}` | session / admin | Шаблон |

### 3.8 Аудит, аналитика, эксплуатация

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET | `/api/audit` | admin | Журнал аудита (фильтры, пагинация) |
| GET | `/api/audit/export` | admin | Экспорт журнала |
| GET | `/api/audit/verify` | admin | Проверка целостности hash-цепочки |
| GET/DELETE | `/api/logs` | admin | Системные логи |
| GET | `/api/analytics` | admin | Агрегированная аналитика (кейсы, документы, ЭМК, население) |
| GET/POST | `/api/backup` | admin | Бэкап/восстановление |
| GET/POST | `/api/encryption` | admin | Статус шифрования и миграция файлов |
| GET/POST | `/api/notifications` | session | Уведомления |
| PATCH/DELETE | `/api/notifications/{id}` | session | Прочитать/удалить |
| POST | `/api/seed` | admin | Демо-данные |
| GET | `/api/seed` | session | Статус seed |
| POST | `/api/seed-templates` | admin | Шаблоны отчётов (seed) |

## 4. Ключевые сценарии

### 4.1 Запуск анализа

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/cases/<caseId>/analyze \
  -H "Content-Type: application/json" -d '{"manual":false}'
```

Ответ `200`:

```jsonc
{
  "analysis": {
    "id": "…", "caseId": "…", "version": 4,
    "conclusion": "Предварительный диагноз: …",
    "sections": [{ "title": "КЛИНИЧЕСКАЯ КАРТИНА", "content": "…", "confidence": 0.8 }],
    "structured": { "differential": [], "workupPlan": [], "therapyOptions": [], "monitoringPlan": [], "verification": {}, "workupTracker": {}, "patientSafety": {} },
    "audit": { "score": 82, "critical": 1, "warning": 2, "info": 1, "findings": [] }
  }
}
```

Ошибки: `403 CONSENT_MISSING` (нет согласия `ai_analysis`), `403 CONSENT_EXPIRED`,
`500` — конвейер упал (кейс возвращён в `uploaded`).

### 4.2 Подтверждение диагноза

```bash
curl -b cookies.txt -X PATCH http://localhost:3000/api/cases/<caseId>/analysis/control \
  -H "Content-Type: application/json" \
  -d '{"confirmDx":{"action":"confirm_dx","diagnosis":"Внебольничная пневмония …","evidence":"КТ: очаг консолидации S8 справа"}}'
```

Пишется в `structured.confirmedDx` и в аудит; терапия с этим `targetDx` разблокируется.

### 4.3 Трекер обследования

```bash
curl -b cookies.txt -X PATCH http://localhost:3000/api/cases/<caseId>/analysis/control \
  -H "Content-Type: application/json" \
  -d '{"workup":{"name":"СРБ, количественно","status":"resulted","resultValue":"112 мг/л","comment":"на фоне АБТ"}}'
```

Ключ считается сервером из названия (`normalizeWorkupKey`); запись сохраняется в
`structured.workupTracker` с автором и временем, действие — в аудит (`workup_status_update`).

### 4.4 Загрузка документа

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/cases/<caseId>/documents \
  -F "file=@vypiska.pdf" -F "fileType=discharge"
```

Ограничения: ≤ 25 МБ; расширения `.pdf .txt .md .csv .tsv .vcf .png .jpg .jpeg .gif .bmp
.dicom .dcm .docx .doc`; проверка magic-bytes. Сервер сохраняет файл в зашифрованном виде,
извлекает текст, де-идентифицирует и пишет `deidContent`.

## 5. Форматы ошибок

```jsonc
{ "error": "Patient consent for AI analysis is missing. …", "errorCode": "CONSENT_MISSING", "consentType": "ai_analysis" }
{ "error": "Patient consent for AI analysis has expired. …", "errorCode": "CONSENT_EXPIRED", "expiredAt": "2026-01-01T00:00:00.000Z" }
{ "error": "Слишком много запросов к авторизации. Повторите через минуту.", "code": "RATE_LIMITED" }
{ "error": "Admin access required" }
```

## 6. SSE: потоковая проверка DDI

`POST /api/ddi/stream` возвращает `text/event-stream`. События (`src/lib/ddi-online.ts`):

| `type` | Поля | Смысл |
|---|---|---|
| `stage` | `stage`, `label` | Этап: `init`, `normalize`, `local`, `online`, `summary`, `done` |
| `normalized` | `medications[]` | Препараты приведены к МНН |
| `local-alerts` | `alerts[]`, `count` | Совпадения с локальной таблицей |
| `pair-start` | `pairIndex`, `totalPairs`, `drugA`, `drugB`, `cached` | Начало проверки пары |
| `pair-search` | `query`, `sources[]` | Поисковый запрос по паре |
| `pair-found` | `resultCount`, `domains[]` | Найдены источники |
| `pair-llm` | — | Извлечение взаимодействия моделью |
| `pair-done` | `alerts[]`, `sources[]`, `fromCache`, `durationMs` | Результат пары |
| `alert` | `alert` | Отдельное предупреждение |
| `pair-error` | `error` | Ошибка по паре (поток продолжается) |
| `summary` | `text` | Итоговое заключение |
| `complete` | `totalAlerts`, `localAlerts`, `onlineAlerts`, `pairsChecked`, `pairsFromCache`, `sourcesUsed[]`, `durationMs` | Финал |
| `error` | `message` | Фатальная ошибка |

Клиент обязан корректно обрабатывать `pair-error` и продолжать чтение: одна недоступная
пара не должна обрывать всю проверку.

## 7. Ограничения и замечания

- `/api/cases/{id}/analyze` синхронный: ответ приходит после полного конвейера (до 10 минут).
  Прокси должен иметь достаточный тайм-аут; UI показывает прогресс по статусу кейса.
- `/api/auth/init` доступен только с localhost — защита от перехвата одноразового пароля.
- Публичные маршруты (GET `/api/recommendations`, `/api/icd10`, `/api/pathways`, `/api/ddi`,
  `/api/templates`) не содержат ПДн пациентов.
- Экспорт PDF отдаётся из `private-storage`, а не из `public/`.
