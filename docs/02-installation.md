# 02. Установка и конфигурация

## 1. Требования

| Компонент | Минимум | Рекомендуется |
|---|---|---|
| ОС | Windows 10/11, Ubuntu 22.04+ | Ubuntu LTS / Windows Server |
| Node.js | 20 LTS | 22 LTS |
| Bun (опционально) | 1.1 | 1.2+ |
| RAM | 8 ГБ (без модели) | 16–32 ГБ (модель 7–14B в Q4) |
| Диск | 2 ГБ + место под БД и файлы | SSD, ≥ 50 ГБ |
| GPU | не требуется | NVIDIA ≥ 12 ГБ VRAM для приемлемой латентности |
| LLM-сервер | llama.cpp `llama-server` **или** LM Studio | llama-server с `-ngl 99` |
| TLS-терминатор | Caddy/nginx | Caddy (см. `Caddyfile`) |

Проверка версий:

```bash
node -v            # >= 20
bun -v             # если используете bun
```

## 2. Установка

```bash
git clone <репозиторий> sppvr && cd sppvr
bun install                    # или: npm install
cp .env.example .env           # Windows: copy .env.example .env
```

При первом запуске секреты нужно создать. Для этого есть скрипт `scripts/ensure-env.ts`: он дописывает отсутствующие `JWT_SECRET`/`ENCRYPTION_KEY` (64 hex-символа) и настройки подключений, **не перезаписывая** существующие значения. Важно: в текущем `package.json` скрипт **не подключён** к `dev`/`start` — запустите его вручную (или добавьте в стартовый скрипт Process Manager):

```bash
bun scripts/ensure-env.ts      # или: npx tsx scripts/ensure-env.ts
```

Альтернатива — сгенерировать секреты вручную:

```bash
openssl rand -hex 32           # JWT_SECRET
openssl rand -hex 32           # ENCRYPTION_KEY
```

> Требование `src/lib/env.ts`: длина каждого секрета **≥ 64 символов**, значение не должно
> быть из чёрного списка скомпрометированных и не должно состоять из одного повторяющегося
> символа. Иначе приложение не стартует (fail-fast).

## 3. База данных

```bash
bun run db:push        # prisma db push --accept-data-loss (быстрый старт, без миграций)
bun run db:migrate     # prisma migrate dev (разработка, создаёт миграцию)
bun run db:reset       # prisma migrate reset (УДАЛЯЕТ данные!)
```

- Файл БД: `db/custom.db` (путь задаётся `DATABASE_URL=file:../db/custom.db` относительно
  `prisma/schema.prisma`).
- `src/lib/db.ts` сам подставляет `DATABASE_URL`, если переменная не задана, — приложение
  запускается «из коробки» на чистом клоне.
- Перед обновлением схемы **сделайте бэкап**: `GET /api/backup` (admin) или копию `db/custom.db`.

## 4. Переменные окружения

Полный список (значения по умолчанию — из `.env.example` и кода). `AI_*` приоритетнее
`LM_STUDIO_*` для общих параметров: `AI_ENABLED`, `AI_URL`, `AI_MODEL`, `AI_API_KEY`,
`AI_EXTRA_ALLOWED_HOSTS` — общие алиасы; провайдероспецифичные переменные переопределяют их.

### 4.1 База и секреты

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `DATABASE_URL` | `file:../db/custom.db` | Путь к SQLite |
| `JWT_SECRET` | генерируется | Подпись JWT (HS256). ≥ 64 символов. Смена = разлогин всех |
| `ENCRYPTION_KEY` | генерируется | Парольная фраза шифрования файлов at-rest. ≥ 64 символов |
| `NODE_ENV` | `development` | `production` ужесточает CSP (без `unsafe-eval`) |
| `REGISTRATION_OPEN` | `false` | Публичная саморегистрация врачей (для стенда) |

### 4.2 ИИ-провайдер

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `AI_PROVIDER` | `llama-server` | `llama-server` или `lm-studio` |
| `LLAMA_SERVER_URL` | `http://127.0.0.1:8080/v1` | OpenAI-совместимый endpoint llama.cpp |
| `LLAMA_SERVER_MODEL` | пусто | Имя модели; пусто = первая модель сервера |
| `LLAMA_SERVER_API_KEY` | пусто | Если сервер требует ключ |
| `LM_STUDIO_ENABLED` | `true` | Включает провайдер LM Studio |
| `LM_STUDIO_URL` | `http://127.0.0.1:1234/v1` | Endpoint LM Studio |
| `LM_STUDIO_MODEL` | пусто | Имя модели |
| `LM_STUDIO_API_KEY` | пусто | Ключ LM Studio (если включён) |
| `LM_STUDIO_TIMEOUT_MS` | `600000` | Тайм-аут одного LLM-запроса (10 мин) |
| `LM_STUDIO_IDLE_TIMEOUT_MS` | `180000` | Обрыв streaming при «молчании» |
| `LM_STUDIO_MAX_RETRIES` | `2` | Повторы при пустом/оборванном ответе |
| `LM_STUDIO_RETRY_BASE_DELAY_MS` | `1000` | Базовая задержка backoff |
| `LM_STUDIO_TEMPERATURE` | `0.2` | Температура по умолчанию |
| `LM_STUDIO_MAX_TOKENS` | `8192` | Лимит токенов ответа |
| `LM_STUDIO_HEALTH_TIMEOUT_MS` | `3000` | Тайм-аут health-check |
| `LM_STUDIO_HEALTH_CACHE_MS` | `15000` | Кэш статуса LLM |
| `LM_STUDIO_EXTRA_ALLOWED_HOSTS` | пусто | Доп. хосты ИИ помимо localhost (SSRF-защита) |

### 4.3 ИИ-конвейер анализа

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `AI_DEEP_ANALYSIS` | `true` | Включает проход самопроверки (`false` — быстрее, но без аудита черновика) |
| `AI_SELF_VERIFY_PASSES` | `1` | Число проходов самопроверки |
| `AI_TEMPERATURE_ANALYSIS` | `0.2` | Температура генерации заключения |
| `AI_MAX_TOKENS_ANALYSIS` | `8192` | Лимит токенов заключения |
| `INTL_RAG_ENABLED` | `true` | Поиск по PubMed/ВОЗ/NICE/Cochrane/CDC/ESC |
| `INTL_RAG_MAX_RESULTS` | `6` | Сколько источников подмешивать |
| `INTL_RAG_TIMEOUT_MS` | `12000` | Тайм-аут внешнего поиска |

### 4.4 Сеть и circuit breaker

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `NETWORK_PROBE_INTERVAL_MS` | `60000` | Интервал фонового probe |
| `NETWORK_PROBE_TIMEOUT_MS` | `8000` | Тайм-аут probe |
| `NETWORK_OFFLINE_AFTER_FAILURES` | `2` | Порог «сеть недоступна» |
| `NETWORK_CIRCUIT_FAILURE_THRESHOLD` | `4` | Порог размыкания circuit breaker |
| `NETWORK_CIRCUIT_COOLDOWN_MS` | `30000` | Пауза до полуоткрытого состояния |

## 5. Запуск

### 5.1 Разработка

```bash
bun run dev            # http://localhost:3000
```

### 5.2 Production

```bash
npx next build         # next.config: output: "standalone"
NODE_ENV=production node .next/standalone/server.js
```

> Скрипт `npm run build` содержит `cp -r` (POSIX). На Windows используйте `npx next build`
> и копирование `public`/`.next/static` вручную либо запустите сборку в WSL.

Caddy (`Caddyfile`):

```caddy
:81 {
  handle {
    reverse_proxy localhost:3000 {
      header_up Host {host}
      header_up X-Forwarded-For {remote_host}
      header_up X-Forwarded-Proto {scheme}
      header_up X-Real-IP {remote_host}
    }
  }
}
```

`X-Real-IP` важен: по нему proxy считает rate limit на IP.

### 5.3 Первичная инициализация

1. Откройте приложение → тултип статуса → «Инициализировать систему»
   (или `POST /api/auth/init`; маршрут принимает запросы **только с localhost**).
2. Система создаёт администратора и выдаёт **одноразовый пароль** (18 символов).
   Пароль показывается один раз и не сохраняется в открытом виде.
3. При первом входе требуется смена пароля.
4. Дальнейшие врачи создаются администратором (или `REGISTRATION_OPEN=true` для стенда).

## 6. Проверка после установки

| Проверка | Как |
|---|---|
| Приложение живо | `GET /api/health` → `ok: true` |
| БД доступна | `health.db === true` |
| ИИ доступен | `health.ai.ok === true`, провайдер и модель в ответе |
| Справочники загружены | `health.rag/ddi/icd10 === true` |
| Вход работает | вход под администратором, смена пароля |
| Анализ работает | демо-кейс → «Анализ» → есть структурированный блок |

## 7. Диагностика запуска

| Симптом | Причина | Решение |
|---|---|---|
| Все `/api/*` → `503` | `JWT_SECRET` отсутствует/короткий/скомпрометирован | Сгенерировать новый (≥ 64 символов), перезапустить |
| `[env] FATAL: …` при старте | Секрет не задан или слишком короткий | См. раздел 2 |
| `health.ai.ok = false` | LLM-сервер не запущен/не тот порт | Запустить llama-server/LM Studio, проверить URL |
| `403` на ИИ-хосте | Хост не в allowlist (SSRF) | `LM_STUDIO_EXTRA_ALLOWED_HOSTS` или localhost |
| Анализ идёт, структуры нет | Модель не вернула JSON / мало токенов | Увеличить `AI_MAX_TOKENS_ANALYSIS`, взять модель крупнее |
| `403 CONSENT_MISSING` | Нет согласия `ai_analysis` | Оформить согласие пациента в кейсе |
| `401` после перезапуска | Ротирован `JWT_SECRET` или `tokenVersion` | Войти заново |
| `413` при загрузке | Файл > 25 МБ | Разбить/сжать документ |
| `database is locked` | Несколько процессов/экземпляров | Оставить один экземпляр |
| Порт 3000 занят | Другой процесс | `next dev -p 3001` (учтите Caddy) |

## 8. Обновление

```bash
# 1. Бэкап
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/backup > backup.json
cp db/custom.db db/custom.db.bak

# 2. Код
git pull && bun install

# 3. Схема (если менялась)
bun run db:push

# 4. Сборка и рестарт
npx next build && NODE_ENV=production node .next/standalone/server.js
```

Проверьте `prisma/migrations` на новые миграции и прочитайте их до применения.
