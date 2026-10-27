"use client";

import {
  Microscope,
  Stethoscope,
  ShieldCheck,
  Cpu,
  Dna,
  FileText,
  Image as ImageIcon,
  BookOpen,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Server,
  Activity,
  Code,
  Pill,
  UserRound,
  Heart,
  FlaskConical,
  Syringe,
  ClipboardList,
  Award,
  Calendar,
  TrendingUp,
  Printer,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function About() {
  return (
    <div className="space-y-6">
      {/* Hero header with gradient accent */}
      <div className="relative overflow-hidden rounded-xl border bg-medical-gradient-soft p-5 sm:p-6">
        <div className="absolute -right-8 -top-8 opacity-10">
          <Stethoscope className="h-32 w-32 text-primary" />
        </div>
        <div className="relative space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <Activity className="h-3.5 w-3.5" />
            Версия 4.2.0 · Локальное развёртывание · 5,6 МБ
          </div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">О системе СППВР</h1>
          <p className="text-sm text-muted-foreground">
            Локальная мультимодальная система поддержки принятия врачебных решений с полноценной электронной медицинской картой (ЭМК), генетическим анализом и генеративным ИИ
          </p>
        </div>
      </div>

      {/* Key stats — updated with EMR metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KeyStat icon={UserRound} value="ЭМК" label="Медкарта пациента" accent="emerald" />
        <KeyStat icon={FileText} value="1800+" label="КР Минздрава РФ" accent="blue" />
        <KeyStat icon={Pill} value="15+" label="Клинических калькуляторов" accent="purple" />
        <KeyStat icon={ShieldCheck} value="ФЗ-152" label="Соответствие" accent="amber" />
        <KeyStat icon={Cpu} value="100%" label="Локальная обработка" accent="emerald" />
        <KeyStat icon={Sparkles} value="10" label="Модулей ЭМК" accent="blue" />
      </div>

      {/* Architecture */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Server className="h-4 w-4 text-primary" />Архитектура</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <ArchItem icon={Cpu} title="ИИ-ядро" desc="LLM + VLM через локальный llama-server (llama.cpp) или LM Studio — OpenAI-совместимый API (backend). Graceful degradation при сбое." />
            <ArchItem icon={UserRound} title="ЭМК-модуль" desc="Полноценная электронная медкарта: визиты, витальные, препараты, анализы, проблемы, прививки, планы." />
            <ArchItem icon={Lock} title="Локализация" desc="On-premise: БД SQLite, локальное файловое хранилище. Нет облачных вызовов." />
          </div>
        </CardContent>
      </Card>

      {/* Минздрав-only knowledge source — v4.2: прямой разбор по теме */}
      <Card className="border-teal-500/30 bg-teal-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-teal-700 dark:text-teal-400">
            <BookOpen className="h-4 w-4" />
            Прямой разбор репозитория КР Минздрава РФ по теме — v4.2
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            ИИ подключается <strong>напрямую</strong> к официальному репозиторию клинических рекомендаций
            Минздрава России — <span className="font-mono text-xs">cr.minzdrav.gov.ru/clin-rec</span> — и
            <strong> парсит его по теме запроса</strong>: поиск КР → загрузка полных текстов → разбор всех
            разделов (диагностика, лечение, реабилитация, алгоритмы Прил. Б, шкалы Прил. Г) → отбор
            фрагментов, релевантных теме. RAG-конвейер анализа, ИИ-чата и подбора рекомендаций работает
            исключительно на официальных КР Минздрава РФ; локальный кэш обеспечивает офлайн-работу.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <EmrFeature icon={Sparkles} title="Разбор по теме (topic RAG)" desc="Фрагменты полных текстов КР ранжируются по релевантности теме запроса" color="teal" />
            <EmrFeature icon={BookOpen} title="Поиск по репозиторию" desc="1800+ утверждённых КР: по названию, МКБ-10, возрастной категории" color="emerald" />
            <EmrFeature icon={FileText} title="Полные тексты КР" desc="Структурированные разделы и официальный PDF каждой рекомендации" color="sky" />
            <EmrFeature icon={ShieldCheck} title="Статус НПС" desc="Признак одобрения Научно-практическим советом Минздрава" color="amber" />
          </div>
        </CardContent>
      </Card>

      {/* EMR Module — NEW v2.5 */}
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-emerald-700 dark:text-emerald-400">
            <UserRound className="h-4 w-4" />
            Модуль электронной медицинской карты (ЭМК) — v2.5
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <EmrFeature icon={UserRound} title="Карта пациента" desc="Демография, группа крови, СНИЛС/ОМС, аллергии, хронические заболевания, семейный анамнез, образ жизни" color="emerald" />
            <EmrFeature icon={Calendar} title="Визиты (SOAP)" desc="Структурированные визиты с протоколом SOAP: субъективно, объективно, оценка, план" color="sky" />
            <EmrFeature icon={Heart} title="Витальные показатели" desc="Тренды АД, пульса, SpO₂, температуры, веса, ИМТ с графиками" color="rose" />
            <EmrFeature icon={Pill} title="Фармакотерапия" desc="Назначение с проверкой аллергий и DDI в реальном времени" color="violet" />
            <EmrFeature icon={FlaskConical} title="Лаборатория" desc="Структурированные результаты с трендами и флагами отклонений" color="amber" />
            <EmrFeature icon={ClipboardList} title="Проблемный список" desc="Диагнозы по МКБ-10 с тяжестью и статусом" color="rose" />
            <EmrFeature icon={Syringe} title="Иммунизация" desc="Прививки с дозами, сериями, датами следующих доз" color="violet" />
            <EmrFeature icon={Award} title="Планы ведения" desc="Цели и вмешательства с отслеживанием выполнения" color="amber" />
            <EmrFeature icon={Microscope} title="Обследования" desc="Реестр назначенных обследований: жизненный цикл, результаты с нормами, привязка КР Минздрава" color="teal" />
            <EmrFeature icon={TrendingUp} title="Хронология" desc="Единая лента всех медицинских событий пациента" color="emerald" />
          </div>
        </CardContent>
      </Card>

      {/* CDSS Functional modules */}
      <Card>
        <CardHeader><CardTitle className="text-base">Функциональные модули ИИ-анализа</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            <ModuleRow num="3.1" icon={FileText} title="Загрузка и парсинг данных" points={["Drag-and-Drop: PDF/DOCX, VCF/CSV, DICOM/JPEG", "Автоматическая де-идентификация (ФИО, СНИЛС, адреса → токены)", "Локальное хранилище (замена MinIO)"]} />
            <ModuleRow num="3.2" icon={Cpu} title="Мультимодальный ИИ-анализ" points={["NER из выписок + интерпретация мутаций", "VLM-анализ медицинских изображений", "RAG-сопоставление с базой клинических рекомендаций", "Генерация заключения с уровнями уверенности"]} />
            <ModuleRow num="3.3" icon={BookOpen} title="Объяснимый ИИ (XAI)" points={["Каждое утверждение сопровождается цитатой-источником", "Гиперссылки на фрагменты выписок, строки VCF, протоколы"]} />
            <ModuleRow num="3.4" icon={ShieldCheck} title="Генерация отчётов" points={["PDF с водяными знаками, датой, временем, ID врача", "Контрольная панель: корректировка весов, комментарии", "Утверждение отчёта с электронной подписью и фиксацией в аудите"]} />
            <ModuleRow num="3.5" icon={Pill} title="Лекарственные взаимодействия (DDI)" points={["Автоматическая проверка DDI при назначении препаратов", "Проверка аллергий в реальном времени (классы препаратов)", "Классификация по серьёзности: противопоказание, значительное, умеренное", "Блокировка противопоказанных назначений"]} />
            <ModuleRow num="3.6" icon={Code} title="МКБ-10 и клинические пути" points={["Автоматическая кодировка МКБ-10", "Сопоставление клинических путей", "Интеграция с заключением анализа"]} />
            <ModuleRow num="3.7" icon={UserRound} title="EMR ↔ AI интеграция" points={["Создание ИИ-кейса из медкарты пациента (автозаполнение)", "Связь кейсов с медкартой для непрерывности ведения", "Печать сводки по пациенту для консилиумов"]} />
          </div>
        </CardContent>
      </Card>

      {/* Compliance + disclaimer */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-emerald-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-emerald-700 dark:text-emerald-400"><ShieldCheck className="h-4 w-4" />Соответствие ФЗ-152</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <ComplianceItem text="100% локальная обработка данных (on-premise)" />
              <ComplianceItem text="Де-идентификация перед ИИ-анализом" />
              <ComplianceItem text="WORM-журнал аудита: кто, что, когда (hash-chain)" />
              <ComplianceItem text="Псевдонимизация: пациенты идентифицируются по токену" />
              <ComplianceItem text="ID врача вместо ФИО в логах" />
              <ComplianceItem text="Управление согласиями пациента на обработку" />
              <ComplianceItem text="Электронные подписи отчётов с фиксацией в аудите" />
            </ul>
          </CardContent>
        </Card>

        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400"><AlertTriangle className="h-4 w-4" />Отказ от ответственности</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Система СППВР является инструментом поддержки принятия решений и не заменяет профессиональное медицинское заключение. Итоговый диагноз и тактика лечения определяются лечащим врачом. Все рекомендации требуют клинической верификации.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tech stack */}
      <Card>
        <CardHeader><CardTitle className="text-base">Технологический стек</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {["Next.js 16", "TypeScript 5", "Tailwind CSS 4", "shadcn/ui", "Prisma ORM", "SQLite", "llama-server / LM Studio", "TanStack Query", "Zustand", "Recharts", "Framer Motion", "next-themes", "Lucide Icons", "PDFKit", "Jose JWT"].map((tech) => (
              <Badge key={tech} variant="secondary">{tech}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KeyStat({ icon: Icon, value, label, accent }: { icon: React.ElementType; value: string; label: string; accent: "emerald" | "blue" | "purple" | "amber" }) {
  const ACCENT_BG: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20",
    blue: "bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/20",
    purple: "bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-violet-500/20",
    amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/20",
  };
  const cfg = ACCENT_BG[accent];
  const ringClass = cfg.split(" ").find((c) => c.startsWith("ring-"));
  const bgClass = cfg.split(" ").filter((c) => !c.startsWith("ring-")).join(" ");
  return (
    <Card className={cn("ring-1 transition-all hover:shadow-md", ringClass)}>
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", bgClass)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ArchItem({ icon: Icon, title, desc }: { icon: React.ElementType; title: string; desc: string }) {
  return (
    <div className="rounded-lg border p-3 transition-all hover:shadow-md">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-medical-gradient-soft text-primary"><Icon className="h-4 w-4" /></div>
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function EmrFeature({ icon: Icon, title, desc, color }: { icon: React.ElementType; title: string; desc: string; color: "emerald" | "sky" | "rose" | "violet" | "amber" | "teal" }) {
  const COLOR_MAP: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
    sky: "border-sky-500/30 bg-sky-500/5 text-sky-600 dark:text-sky-400",
    rose: "border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400",
    violet: "border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-400",
    amber: "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400",
    teal: "border-teal-500/30 bg-teal-500/5 text-teal-600 dark:text-teal-400",
  };
  return (
    <div className={cn("rounded-lg border p-3 transition-all hover:shadow-md", COLOR_MAP[color])}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" />
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <p className="mt-1 text-xs opacity-80">{desc}</p>
    </div>
  );
}

function ModuleRow({ num, icon: Icon, title, points }: { num: string; icon: React.ElementType; title: string; points: string[] }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-xs">ТЗ {num}</Badge>
        <Icon className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <ul className="mt-2 space-y-1 pl-6">
        {points.map((p, i) => (<li key={i} className="flex items-start gap-2 text-xs text-muted-foreground"><span className="mt-0.5 text-primary">•</span>{p}</li>))}
      </ul>
    </div>
  );
}

function ComplianceItem({ text }: { text: string }) {
  return <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span>{text}</span></li>;
}
