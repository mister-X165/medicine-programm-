// СППВР — генератор медицинского PDF-отчёта (ТЗ п. 3.4)
// Чистая Node.js-реализация на pdfkit с поддержкой кириллицы и водяных знаков.
// Соответствие ФЗ-152: отчёт содержит только де-идентифицированные данные и doctorCode.

import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AnalysisResultData, Citation, Mutation, Recommendation } from "@/lib/types";
import { saveReport } from "@/lib/storage";

// ──────────────────────────────────────────────────────────────────────────────
// Константы путей к TTF-шрифтам с кириллицей (поиск с fallback)
// ──────────────────────────────────────────────────────────────────────────────

const FONT_CANDIDATES_REGULAR = [
  // Локальные шрифты проекта (наиболее надежный вариант)
  path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf"),
  // Системные шрифты (fallback)
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans.ttf",
  "/usr/share/fonts/liberation/LiberationSans-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  // Windows-пути (для развёртывания на Windows)
  "C:\\Windows\\Fonts\\DejaVuSans.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
];

const FONT_CANDIDATES_BOLD = [
  // Локальные шрифты проекта (наиболее надежный вариант)
  path.join(process.cwd(), "public", "fonts", "DejaVuSans-Bold.ttf"),
  // Системные шрифты (fallback)
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  // Windows-пути (для развёртывания на Windows)
  "C:\\Windows\\Fonts\\DejaVuSans-Bold.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
];

const FONT_REGULAR = "DejaVu";
const FONT_BOLD = "DejaVu-Bold";

/**
 * Пытается найти существующий файл шрифта из списка кандидатов.
 */
async function resolveFontPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // продолжаем перебор
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Типы параметров генератора
// ──────────────────────────────────────────────────────────────────────────────

export interface DoctorInfo {
  fullName: string;
  specialization: string;
  doctorCode: string;
}

export interface GeneratePDFParams {
  caseCode: string;
  doctor: DoctorInfo;
  analysis: AnalysisResultData;
  watermark?: string;
  outputDir?: string;
}

export interface GeneratePDFResult {
  buffer: Buffer;
  path: string;
  fileName: string;
  publicUrl: string;
  fontUsed: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Геометрия страницы A4
// ──────────────────────────────────────────────────────────────────────────────

const PAGE_WIDTH = 595.28; // A4 в pt (точках PostScript)
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

// ──────────────────────────────────────────────────────────────────────────────
// Утилиты форматирования
// ──────────────────────────────────────────────────────────────────────────────

function formatDateTime(d: Date): string {
  // Локальная дата/время в ISO-подобном формате с Z-смещением
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * Ключевые слова для фильтра цитат, относящихся к предупреждениям/противопоказаниям.
 */
const WARNING_KEYWORDS = [
  "противопоказ",
  "предупрежд",
  "осторож",
  "неблагоприят",
  "побочн",
  "риск",
  "не рекоменду",
  "избегать",
  "противопак",
  "вред",
  "токсич",
  "опасн",
];

function isWarningClaim(text: string): boolean {
  const lower = text.toLowerCase();
  return WARNING_KEYWORDS.some((k) => lower.includes(k));
}

// ──────────────────────────────────────────────────────────────────────────────
// Контекст состояния документа
// ──────────────────────────────────────────────────────────────────────────────

interface DrawContext {
  doc: InstanceType<typeof PDFDocument>;
  y: number;
  fontRegular: string;
  fontBold: string;
}

function ensureSpace(ctx: DrawContext, needed: number): void {
  if (ctx.y + needed > PAGE_HEIGHT - MARGIN - 40) {
    ctx.doc.addPage();
    ctx.y = MARGIN;
  }
}

function setFont(ctx: DrawContext, bold: boolean, size: number): void {
  ctx.doc.font(bold ? ctx.fontBold : ctx.fontRegular).fontSize(size);
}

// ──────────────────────────────────────────────────────────────────────────────
// Отрисовка водяного знака на текущей странице
// ──────────────────────────────────────────────────────────────────────────────

function drawWatermark(
  doc: InstanceType<typeof PDFDocument>,
  watermark: string,
  doctorCode: string,
  fontBold: string,
): void {
  const cx = PAGE_WIDTH / 2;
  const cy = PAGE_HEIGHT / 2;
  doc.save();
  doc.translate(cx, cy);
  doc.rotate(-45);
  doc.fillColor("#9CA3AF");
  doc.opacity(0.12);
  doc.fontSize(42);
  doc.font(fontBold);
  doc.text(watermark || "СППВР | КОНФИДЕНЦИАЛЬНО", -350, -30, {
    width: 700,
    align: "center",
    lineBreak: false,
  });
  doc.fontSize(20);
  doc.text(`Врач: ${doctorCode}`, -350, 18, {
    width: 700,
    align: "center",
    lineBreak: false,
  });
  doc.restore();
  // Сброс состояния для последующего контента
  doc.opacity(1);
  doc.fillColor("#000000");
}

// ──────────────────────────────────────────────────────────────────────────────
// Блоки отрисовки секций
// ──────────────────────────────────────────────────────────────────────────────

function drawSectionTitle(ctx: DrawContext, num: number, title: string): void {
  ensureSpace(ctx, 40);
  ctx.y += 12;
  setFont(ctx, true, 13);
  ctx.doc.fillColor("#0F172A");
  ctx.doc.text(`${num}. ${title}`, MARGIN, ctx.y, {
    width: CONTENT_WIDTH,
    underline: false,
  });
  // Подчёркивание-разделитель
  ctx.y = (ctx.doc.y as number) + 2;
  ctx.doc
    .moveTo(MARGIN, ctx.y)
    .lineTo(MARGIN + CONTENT_WIDTH, ctx.y)
    .strokeColor("#CBD5E1")
    .lineWidth(0.7)
    .stroke();
  ctx.y += 8;
  ctx.doc.fillColor("#000000");
}

function drawParagraph(ctx: DrawContext, text: string, opts: { size?: number; color?: string; italic?: boolean } = {}): void {
  const size = opts.size ?? 10;
  setFont(ctx, false, size);
  if (opts.color) ctx.doc.fillColor(opts.color);
  const wrapped = ctx.doc.heightOfString(text || "—", {
    width: CONTENT_WIDTH,
    align: "left",
    lineBreak: true,
  });
  ensureSpace(ctx, wrapped + 4);
  ctx.doc.text(text || "—", MARGIN, ctx.y, {
    width: CONTENT_WIDTH,
    align: "left",
    lineBreak: true,
  });
  ctx.y = (ctx.doc.y as number) + 6;
  ctx.doc.fillColor("#000000");
}

function drawKeyValue(ctx: DrawContext, key: string, value: string): void {
  ensureSpace(ctx, 16);
  setFont(ctx, true, 10);
  const keyWidth = ctx.doc.widthOfString(key + ": ") + 2;
  setFont(ctx, false, 10);
  const valWidth = ctx.doc.widthOfString(value || "—");
  if (MARGIN + keyWidth + valWidth > MARGIN + CONTENT_WIDTH) {
    // переносим значение на новую строку
    setFont(ctx, true, 10);
    ctx.doc.text(key + ":", MARGIN, ctx.y, { width: CONTENT_WIDTH, lineBreak: true });
    ctx.y = (ctx.doc.y as number) + 1;
    setFont(ctx, false, 10);
    ctx.doc.text(value || "—", MARGIN + 12, ctx.y, { width: CONTENT_WIDTH - 12, lineBreak: true });
    ctx.y = (ctx.doc.y as number) + 4;
  } else {
    setFont(ctx, true, 10);
    ctx.doc.text(key + ":", MARGIN, ctx.y, { continued: true, lineBreak: false });
    setFont(ctx, false, 10);
    ctx.doc.text(" " + (value || "—"), { width: CONTENT_WIDTH, lineBreak: false });
    ctx.y = (ctx.doc.y as number) + 4;
  }
}

interface TableColumn {
  header: string;
  width: number; // в pt
  key: string;
}

function drawTable(
  ctx: DrawContext,
  columns: TableColumn[],
  rows: Array<Record<string, string>>,
  opts: { rowHeight?: number; fontSize?: number; emptyText?: string } = {},
): void {
  const fontSize = opts.fontSize ?? 9;
  const rowHeight = opts.rowHeight ?? 34;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);

  if (rows.length === 0) {
    drawParagraph(ctx, opts.emptyText ?? "Нет данных для отображения.", { size: 10, color: "#6B7280", italic: true });
    return;
  }

  // Заголовок таблицы
  ensureSpace(ctx, rowHeight);
  setFont(ctx, true, fontSize);
  ctx.doc.fillColor("#FFFFFF");
  let x = MARGIN;
  for (const col of columns) {
    ctx.doc.rect(x, ctx.y, col.width, rowHeight).fill("#1E3A8A");
    ctx.doc.fillColor("#FFFFFF");
    ctx.doc.text(col.header, x + 4, ctx.y + 6, {
      width: col.width - 8,
      height: rowHeight - 8,
      lineBreak: false,
    });
    x += col.width;
  }
  ctx.doc.fillColor("#000000");
  ctx.y += rowHeight;

  // Тело таблицы
  setFont(ctx, false, fontSize);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Прикидываем высоту строки по самому высокому содержимому ячейки
    let maxCellHeight = rowHeight;
    for (const col of columns) {
      const cellText = String(row[col.key] ?? "");
      const h = ctx.doc.heightOfString(cellText, {
        width: col.width - 8,
        lineBreak: true,
      }) + 10;
      if (h > maxCellHeight) maxCellHeight = h;
    }
    ensureSpace(ctx, maxCellHeight);
    // Если после ensureSpace мы перешли на новую страницу — нужно перерисовать фон корректно
    x = MARGIN;
    const isAlt = i % 2 === 1;
    if (isAlt) {
      ctx.doc.rect(MARGIN, ctx.y, totalWidth, maxCellHeight).fill("#F1F5F9");
    }
    for (const col of columns) {
      const cellText = String(row[col.key] ?? "");
      ctx.doc.fillColor("#0F172A");
      ctx.doc.text(cellText, x + 4, ctx.y + 5, {
        width: col.width - 8,
        height: maxCellHeight - 6,
        lineBreak: true,
        ellipsis: true,
      });
      x += col.width;
    }
    // Линия-разделитель
    ctx.doc
      .moveTo(MARGIN, ctx.y + maxCellHeight)
      .lineTo(MARGIN + totalWidth, ctx.y + maxCellHeight)
      .strokeColor("#E2E8F0")
      .lineWidth(0.5)
      .stroke();
    ctx.y += maxCellHeight;
  }
  ctx.y += 6;
}

function drawProgressBar(
  ctx: DrawContext,
  label: string,
  value: number, // 0..1
): void {
  ensureSpace(ctx, 24);
  const labelWidth = 110;
  const barX = MARGIN + labelWidth;
  const barWidth = CONTENT_WIDTH - labelWidth - 60;
  const barHeight = 12;
  // Подпись
  setFont(ctx, false, 10);
  ctx.doc.fillColor("#0F172A");
  ctx.doc.text(label, MARGIN, ctx.y + 1, {
    width: labelWidth - 6,
    lineBreak: false,
  });
  // Фон прогресс-бара
  ctx.doc
    .rect(barX, ctx.y, barWidth, barHeight)
    .fill("#E2E8F0");
  // Заполнение
  const pct = Math.max(0, Math.min(1, value));
  const fillWidth = Math.round(barWidth * pct);
  const fillColor =
    pct >= 0.8 ? "#16A34A" : pct >= 0.5 ? "#2563EB" : pct >= 0.3 ? "#D97706" : "#DC2626";
  ctx.doc.rect(barX, ctx.y, fillWidth, barHeight).fill(fillColor);
  // Значение справа
  setFont(ctx, true, 10);
  ctx.doc.fillColor("#0F172A");
  ctx.doc.text(`${Math.round(pct * 100)}%`, barX + barWidth + 6, ctx.y + 1, {
    width: 50,
    lineBreak: false,
  });
  ctx.y += barHeight + 6;
  ctx.doc.fillColor("#000000");
}

// ──────────────────────────────────────────────────────────────────────────────
// Главная функция генерации
// ──────────────────────────────────────────────────────────────────────────────

export async function generateMedicalReportPDF(
  params: GeneratePDFParams,
): Promise<GeneratePDFResult> {
  const {
    caseCode,
    doctor,
    analysis,
    watermark = "СППВР | КОНФИДЕНЦИАЛЬНО",
    // v2.7.2 (audit fix): outputDir больше не используется — файл всегда
    // пишется через saveReport в private-storage/reports (с шифрованием).
    outputDir: _outputDir = path.join(process.cwd(), "private-storage", "reports"),
  } = params;

  // 1. Резолв шрифтов с поддержкой кириллицы
  const regularPath = await resolveFontPath(FONT_CANDIDATES_REGULAR);
  const boldPath = await resolveFontPath(FONT_CANDIDATES_BOLD);

  // Определяем, какие шрифты доступны: TTF с кириллицей или Courier как fallback
  const useTTF = !!(regularPath && boldPath);
  const fontRegular = useTTF ? FONT_REGULAR : "Courier";
  const fontBold = useTTF ? FONT_BOLD : "Courier-Bold";

  // 2. Создаём PDF-документ
  // КЛЮЧЕВЫЙ ФИКС: font: null предотвращает загрузку Helvetica по умолчанию.
  // Без этого pdfkit вызывает initFonts('Helvetica'), что пытается прочитать
  // Helvetica.afm из node_modules/pdfkit/js/data/ — если AFM-файл отсутствует
  // (частая проблема на Windows), конструктор выбрасывает ENOENT.
  // Передавая font: null, мы отключаем автозагрузку шрифта в конструкторе,
  // а затем регистрируем и устанавливаем кастомный шрифт ДО любых текстовых операций.
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title: `Медицинское заключение — ${caseCode}`,
      Author: `СППВР / ${doctor.doctorCode}`,
      Subject: "Итоговое заключение СППВР",
      Producer: "СППВР pdf-generator",
      Creator: "СППВР",
    },
    compress: true,
    // v2.7.2 (audit fix): pdfkit 0.19 допускает font: null в типах — старая
    // подавляющая директива удалена. font: null отключает автозагрузку
    // Helvetica в конструкторе (initFonts(options.font)): if (defaultFont)
    // === false, и AFM-файл не читается с диска.
    font: null,
  });

  // Регистрируем TTF-шрифты с кириллицей (если найдены)
  if (useTTF) {
    try {
      doc.registerFont(FONT_REGULAR, regularPath!);
      doc.registerFont(FONT_BOLD, boldPath!);
    } catch (e) {
      throw new Error(
        `Не удалось зарегистрировать шрифт в pdfkit: ${e instanceof Error ? e.message : e}. ` +
          `Проверьте целостность файлов DejaVuSans.ttf и DejaVuSans-Bold.ttf.`
      );
    }
  }
  // Fallback на Courier: шрифт всегда доступен в PDF, но НЕ поддерживает кириллицу.
  // Используется только если TTF-шрифты не найдены, чтобы PDF всё равно генерировался.

  // 3. Установка шрифта по умолчанию + водяной знак
  doc.font(fontRegular).fontSize(10).fillColor("#000000");

  const applyWatermark = (): void => {
    drawWatermark(doc, watermark, doctor.doctorCode, fontBold);
    // После водяного знака восстанавливаем шрифт основного контента
    doc.font(fontRegular).fontSize(10).fillColor("#000000");
  };

  // Водяной знак на первой странице
  applyWatermark();
  // И на всех последующих страницах
  doc.on("pageAdded", () => {
    applyWatermark();
  });

  // 4. Контекст отрисовки
  const ctx: DrawContext = {
    doc,
    y: MARGIN,
    fontRegular,
    fontBold,
  };

  const now = new Date();

  // ── Заголовок ─────────────────────────────────────────────────────────────
  ensureSpace(ctx, 60);
  setFont(ctx, true, 16);
  ctx.doc.fillColor("#0F172A");
  ctx.doc.text("Медицинское заключение СППВР СППВР", MARGIN, ctx.y, {
    width: CONTENT_WIDTH,
    align: "center",
  });
  ctx.y = (ctx.doc.y as number) + 4;
  setFont(ctx, false, 9);
  ctx.doc.fillColor("#475569");
  ctx.doc.text(
    "Система поддержки принятия врачебных решений · Де-идентифицированный протокол",
    MARGIN,
    ctx.y,
    { width: CONTENT_WIDTH, align: "center" },
  );
  ctx.y = (ctx.doc.y as number) + 6;
  ctx.doc.fillColor("#000000");

  // ── Шапка ─────────────────────────────────────────────────────────────────
  ensureSpace(ctx, 90);
  ctx.doc
    .rect(MARGIN, ctx.y, CONTENT_WIDTH, 70)
    .fillColor("#F8FAFC")
    .fill();
  ctx.doc
    .rect(MARGIN, ctx.y, CONTENT_WIDTH, 70)
    .strokeColor("#CBD5E1")
    .lineWidth(0.5)
    .stroke();
  ctx.y += 8;

  drawKeyValue(ctx, "Код случая", caseCode);
  drawKeyValue(ctx, "Дата и время формирования", formatDateTime(now));
  drawKeyValue(ctx, "ID врача", doctor.doctorCode);
  drawKeyValue(ctx, "Специализация", doctor.specialization);
  ctx.y += 4;

  // ── Раздел 1. Клиническая картина ─────────────────────────────────────────
  drawSectionTitle(ctx, 1, "Клиническая картина");
  const conclusionText = analysis.conclusion && analysis.conclusion.trim().length > 0
    ? analysis.conclusion
    : "Заключение ИИ не сформировано. Требуется ручной анализ клинических данных.";
  drawParagraph(ctx, conclusionText);

  // ── Раздел 2. Генетический профиль ────────────────────────────────────────
  drawSectionTitle(ctx, 2, "Генетический профиль (выявленные варианты)");
  const mutations: Mutation[] = Array.isArray(analysis.mutations) ? analysis.mutations : [];
  const mutationRows = mutations.slice(0, 50).map((m) => ({
    gene: m.gene || "—",
    variant: truncate(m.variant || "—", 40),
    interpretation: truncate(m.interpretation || "—", 80),
    significance: m.clinicalSignificance || "—",
  }));
  drawTable(
    ctx,
    [
      { header: "Ген", width: 70, key: "gene" },
      { header: "Вариант", width: 130, key: "variant" },
      { header: "Интерпретация", width: 245, key: "interpretation" },
      { header: "Значимость", width: 100, key: "significance" },
    ],
    mutationRows,
    { emptyText: "Мутации не выявлены или генетический анализ не проводился." },
  );

  // ── Раздел 3. Клинические рекомендации ────────────────────────────────────
  drawSectionTitle(ctx, 3, "Клинические рекомендации (RAG)");
  const recs: Recommendation[] = Array.isArray(analysis.recommendations) ? analysis.recommendations : [];
  const recRows = recs.slice(0, 20).map((r) => ({
    title: truncate(r.title || "—", 60),
    source: truncate(r.source || "—", 40),
    evidence: r.evidenceLevel || "—",
    relevance: `${Math.round((r.relevanceScore ?? 0) * 100)}%`,
  }));
  drawTable(
    ctx,
    [
      { header: "Название", width: 280, key: "title" },
      { header: "Источник", width: 165, key: "source" },
      { header: "Доказ.", width: 50, key: "evidence" },
      { header: "Релев.", width: 50, key: "relevance" },
    ],
    recRows,
    { emptyText: "Сопоставленные клинические рекомендации отсутствуют." },
  );

  // ── Раздел 4. Предупреждения и противопоказания ───────────────────────────
  drawSectionTitle(ctx, 4, "Предупреждения и противопоказания");
  const allCitations: Citation[] = Array.isArray(analysis.citations) ? analysis.citations : [];
  const warningCitations = allCitations
    .filter((c) => isWarningClaim(c.claim || "") || isWarningClaim(c.fragment || ""))
    .slice(0, 10);

  if (warningCitations.length === 0) {
    drawParagraph(ctx, "Явных предупреждений и противопоказаний в источниках не выявлено.", {
      size: 10,
      color: "#6B7280",
    });
  } else {
    for (const c of warningCitations) {
      ensureSpace(ctx, 40);
      drawParagraph(ctx, `• ${c.claim || "Без описания"}`, { size: 10 });
      if (c.fragment) {
        drawParagraph(ctx, `  Фрагмент: ${truncate(c.fragment, 280)}`, {
          size: 9,
          color: "#475569",
        });
      }
    }
  }

  // ── Раздел 5. Степени уверенности модели ──────────────────────────────────
  drawSectionTitle(ctx, 5, "Степени уверенности модели");
  const conf = analysis.confidence || {};
  const confLabels: Record<string, string> = {
    diagnosis: "Диагностика",
    therapy: "Терапия",
    prognosis: "Прогноз",
    overall: "Общая уверенность",
  };
  const confKeys = Object.keys(conf).filter((k) => typeof conf[k] === "number");
  if (confKeys.length === 0) {
    drawParagraph(ctx, "Показатели уверенности не рассчитаны.", {
      size: 10,
      color: "#6B7280",
    });
  } else {
    for (const k of confKeys) {
      drawProgressBar(ctx, confLabels[k] || k, Number(conf[k]));
    }
  }

  // ── Раздел 6. Цитаты-источники XAI ────────────────────────────────────────
  drawSectionTitle(ctx, 6, "Цитаты-источники (XAI)");
  const citationsForTable = allCitations.slice(0, 15);
  const citRows = citationsForTable.map((c) => ({
    claim: truncate(c.claim || "—", 70),
    source: c.source || "—",
    fragment: truncate(c.fragment || "—", 120),
    location: truncate(c.location || "—", 30),
  }));
  drawTable(
    ctx,
    [
      { header: "Утверждение", width: 170, key: "claim" },
      { header: "Источник", width: 75, key: "source" },
      { header: "Фрагмент", width: 215, key: "fragment" },
      { header: "Локация", width: 85, key: "location" },
    ],
    citRows,
    { emptyText: "Цитаты-источники не сформированы.", fontSize: 8 },
  );

  // ── Подвал ────────────────────────────────────────────────────────────────
  ensureSpace(ctx, 60);
  ctx.y += 10;
  ctx.doc
    .moveTo(MARGIN, ctx.y)
    .lineTo(MARGIN + CONTENT_WIDTH, ctx.y)
    .strokeColor("#0F172A")
    .lineWidth(0.8)
    .stroke();
  ctx.y += 6;
  setFont(ctx, false, 8);
  ctx.doc.fillColor("#475569");
  ctx.doc.text(
    "Документ сформирован автоматически системой СППВР. Не является окончательным диагнозом. Требует утверждения врачом.",
    MARGIN,
    ctx.y,
    { width: CONTENT_WIDTH, align: "center", lineBreak: true },
  );
  ctx.y = (ctx.doc.y as number) + 3;
  setFont(ctx, true, 8);
  ctx.doc.text(
    `Сгенерировано: ${formatDateTime(now)} · Врач: ${doctor.doctorCode} · ${caseCode}`,
    MARGIN,
    ctx.y,
    { width: CONTENT_WIDTH, align: "center" },
  );
  ctx.doc.fillColor("#000000");

  // 5. Сборка Buffer и запись на диск
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  await new Promise<void>((resolve, reject) => {
    doc.on("error", reject);
    doc.on("end", () => resolve());
    doc.end();
  });

  const buffer = Buffer.concat(chunks);

  // v2.7.2 (audit fix, SECURITY): запись через saveReport из storage.ts —
  // шифрование AES-256-GCM в памяти, на диск попадает только шифротекст
  // (.enc + .enc.meta). Раньше PDF писался здесь напрямую через fs.writeFile
  // в открытом виде — обходил at-rest-шифрование (на диске лежал читаемый
  // PDF с PHI). Чтение через /api/reports/[id]?download=1 уже умеет
  // расшифровывать .enc (decryptFile) с фолбэком на легаси-файлы.
  const fileName = `${randomUUID()}.pdf`;
  const storagePath = await saveReport(buffer, fileName);

  return {
    buffer,
    path: path.join(process.cwd(), "private-storage", storagePath),
    fileName,
    publicUrl: storagePath, // сохраняем имя поля для обратной совместимости;
    // но теперь это путь внутри private-storage, а не публичный URL.
    fontUsed: useTTF ? regularPath! : "Courier (fallback — кириллица не поддерживается)",
  };
}
