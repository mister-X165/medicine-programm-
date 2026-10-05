"use client";

import * as React from "react";
import {
  Calculator,
  Heart,
  Activity,
  Droplet,
  Brain,
  ShieldAlert,
  ShieldCheck,
  Info,
  RotateCcw,
  TrendingUp,
  Pill,
  Search,
  X,
  Plus,
  AlertOctagon,
  HeartPulse,
  Stethoscope,
  ChevronDown,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useDDIStream, DDIStreamPanel } from "@/components/shared/ddi-stream-checker";

export function Calculators() {
  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-xl border bg-medical-gradient-soft p-5 sm:p-6">
        <div className="absolute -right-8 -top-8 opacity-10">
          <Calculator className="h-32 w-32 text-primary" />
        </div>
        <div className="relative space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <Activity className="h-3.5 w-3.5" />
            Клинические калькуляторы
          </div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Медицинские калькуляторы</h1>
          <p className="text-sm text-muted-foreground">
            Расчёт клинических шкал и индексов для стратификации риска и принятия решений. Все расчёты выполняются локально в браузере.
          </p>
        </div>
      </div>

      <Tabs defaultValue="cardio" className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap gap-1">
          <TabsTrigger value="cardio" className="gap-1.5">
            <Heart className="h-4 w-4" />
            <span className="hidden sm:inline">Кардио</span>
          </TabsTrigger>
          <TabsTrigger value="renal" className="gap-1.5">
            <Droplet className="h-4 w-4" />
            <span className="hidden sm:inline">Почки</span>
          </TabsTrigger>
          <TabsTrigger value="metabolic" className="gap-1.5">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Метабол.</span>
          </TabsTrigger>
          <TabsTrigger value="infection" className="gap-1.5">
            <ShieldAlert className="h-4 w-4" />
            <span className="hidden sm:inline">Инфекции</span>
          </TabsTrigger>
          <TabsTrigger value="neuro" className="gap-1.5">
            <Brain className="h-4 w-4" />
            <span className="hidden sm:inline">Неврол.</span>
          </TabsTrigger>
          <TabsTrigger value="ddi" className="gap-1.5">
            <Pill className="h-4 w-4" />
            <span className="hidden sm:inline">Лек. взаим.</span>
          </TabsTrigger>
          <TabsTrigger value="dosage" className="gap-1.5">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">Дозировка</span>
          </TabsTrigger>
          <TabsTrigger value="vitals" className="gap-1.5">
            <HeartPulse className="h-4 w-4" />
            <span className="hidden sm:inline">Витальные</span>
          </TabsTrigger>
          <TabsTrigger value="symptoms" className="gap-1.5">
            <Stethoscope className="h-4 w-4" />
            <span className="hidden sm:inline">Симптомы</span>
          </TabsTrigger>
          <TabsTrigger value="emergency" className="gap-1.5">
            <AlertOctagon className="h-4 w-4" />
            <span className="hidden sm:inline">Экстрено</span>
          </TabsTrigger>
          <TabsTrigger value="labs" className="gap-1.5">
            <FlaskConical className="h-4 w-4" />
            <span className="hidden sm:inline">Анализы</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cardio" className="space-y-4">
          <Cha2ds2vascCalculator />
          <Score2Calculator />
          <BmiCalculator />
        </TabsContent>

        <TabsContent value="renal" className="space-y-4">
          <EgfrCalculator />
          <CockcroftGaultCalculator />
        </TabsContent>

        <TabsContent value="metabolic" className="space-y-4">
          <HomaIrCalculator />
          <BmiCalculator />
        </TabsContent>

        <TabsContent value="infection" className="space-y-4">
          <Curb65Calculator />
        </TabsContent>

        <TabsContent value="neuro" className="space-y-4">
          <NihssCalculator />
          <MeldCalculator />
        </TabsContent>

        <TabsContent value="ddi" className="space-y-4">
          <DrugInteractionChecker />
          <AllergyContraindicationChecker />
        </TabsContent>

        <TabsContent value="dosage" className="space-y-4">
          <RenalDoseAdjustmentCalculator />
        </TabsContent>

        <TabsContent value="vitals" className="space-y-4">
          <VitalSignsMonitor />
        </TabsContent>

        <TabsContent value="symptoms" className="space-y-4">
          <SymptomChecker />
        </TabsContent>

        <TabsContent value="emergency" className="space-y-4">
          <EmergencyProtocols />
        </TabsContent>

        <TabsContent value="labs" className="space-y-4">
          <LabReferenceRanges />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────

function CalculatorCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-medical-gradient-soft text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function ResultBadge({ level, label, score }: { level: "low" | "moderate" | "high" | "very-high"; label: string; score: string }) {
  const config = {
    low: { color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500" },
    moderate: { color: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", bar: "bg-amber-500" },
    high: { color: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300", bar: "bg-orange-500" },
    "very-high": { color: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300", bar: "bg-red-500" },
  };
  const cfg = config[level];
  return (
    <div className={cn("rounded-lg border p-4", cfg.color)}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide opacity-80">Результат</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{score}</div>
        </div>
        <Badge variant="outline" className={cn("border-current", cfg.color)}>
          {label}
        </Badge>
      </div>
    </div>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={onClick}>
      <RotateCcw className="h-3.5 w-3.5" />
      Сбросить
    </Button>
  );
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── CHA₂DS₂-VASc ────────────────────────────────────────────────────────

function Cha2ds2vascCalculator() {
  const [age, setAge] = React.useState("");
  const [sex, setSex] = React.useState<"male" | "female" | "">("");
  const [chf, setChf] = React.useState(false);
  const [htn, setHtn] = React.useState(false);
  const [stroke, setStroke] = React.useState(false);
  const [vasc, setVasc] = React.useState(false);
  const [dm, setDm] = React.useState(false);

  const score = React.useMemo(() => {
    if (!age || !sex) return null;
    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum)) return null;
    let s = 0;
    // Age
    if (ageNum >= 75) s += 2;
    else if (ageNum >= 65) s += 1;
    // Sex (female adds 1)
    if (sex === "female") s += 1;
    // CHF
    if (chf) s += 1;
    // HTN
    if (htn) s += 1;
    // Stroke/TIA/TE
    if (stroke) s += 2;
    // Vascular disease
    if (vasc) s += 1;
    // Diabetes
    if (dm) s += 1;
    return s;
  }, [age, sex, chf, htn, stroke, vasc, dm]);

  const risk = React.useMemo(() => {
    if (score === null) return null;
    // Approximate annual stroke risk (%) based on CHA2DS2-VASc score
    const riskTable: Record<number, number> = {
      0: 0.2, 1: 0.6, 2: 2.2, 3: 3.2, 4: 4.8, 5: 7.2, 6: 9.7, 7: 11.2, 8: 10.8, 9: 12.2,
    };
    return riskTable[score] ?? 0;
  }, [score]);

  const level = score === null ? null : score === 0 ? "low" : score === 1 ? "moderate" : score <= 3 ? "high" : "very-high";
  const label = level === "low" ? "Низкий риск" : level === "moderate" ? "Умеренный" : level === "high" ? "Высокий" : "Очень высокий";

  const reset = () => {
    setAge(""); setSex(""); setChf(false); setHtn(false); setStroke(false); setVasc(false); setDm(false);
  };

  return (
    <CalculatorCard
      icon={Heart}
      title="CHA₂DS₂-VASc"
      description="Оценка риска инсульта при фибрилляции предсердий (неклапанная ФП)"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Возраст (лет)
            <InfoTooltip text="Возраст пациента в годах на момент оценки" />
          </Label>
          <Input type="number" placeholder="напр. 72" value={age} onChange={(e) => setAge(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Пол</Label>
          <Select value={sex} onValueChange={(v) => setSex(v as "male" | "female")}>
            <SelectTrigger><SelectValue placeholder="Выберите…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="male">♂ Мужской</SelectItem>
              <SelectItem value="female">♀ Женский</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <CheckboxRow label="ХСН (сердечная недостаточность)" checked={chf} onChange={setChf} />
        <CheckboxRow label="Артериальная гипертензия" checked={htn} onChange={setHtn} />
        <CheckboxRow label="Инсульт/ТИА в анамнезе" checked={stroke} onChange={setStroke} weight={2} />
        <CheckboxRow label="Сосудистые заболевания (ИБС, перифер. атеросклероз)" checked={vasc} onChange={setVasc} />
        <CheckboxRow label="Сахарный диабет" checked={dm} onChange={setDm} />
      </div>

      {score !== null && level && (
        <div className="space-y-3">
          <ResultBadge level={level} label={label} score={`${score} баллов`} />
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <TrendingUp className="h-4 w-4 text-primary" />
              Оценочный годовой риск инсульта: <span className="font-bold tabular-nums">{risk}%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {score === 0 && sex === "male" && "Антикоагуляция не показана (низкий риск)."}
              {score === 1 && sex === "male" && "Рассмотреть антикоагулянтную терапию (решение индивидуально)."}
              {(score >= 2 || (score >= 3 && sex === "female")) && "Показана пероральная антикоагулянтная терапия (ПОАК или варфарин)."}
              {sex === "female" && score === 1 && "Один балл за женский пол — антикоагуляция не показана."}
              {sex === "female" && score === 2 && "Рассмотреть антикоагулянтную терапию."}
            </p>
          </div>
        </div>
      )}
      <ResetButton onClick={reset} />
    </CalculatorCard>
  );
}

function CheckboxRow({ label, checked, onChange, weight }: { label: string; checked: boolean; onChange: (v: boolean) => void; weight?: number }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-all hover:shadow-sm",
        checked ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
      )}
    >
      <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors", checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30")}>
        {checked && <span className="text-xs">✓</span>}
      </div>
      <span className="flex-1">{label}</span>
      {weight && weight > 1 && (
        <Badge variant="secondary" className="text-[10px]">+{weight}</Badge>
      )}
      {weight === undefined && (
        <Badge variant="secondary" className="text-[10px]">+1</Badge>
      )}
    </button>
  );
}

// ─── SCORE2 ───────────────────────────────────────────────────────────────

function Score2Calculator() {
  const [age, setAge] = React.useState("");
  const [sex, setSex] = React.useState<"male" | "female" | "">("");
  const [smoker, setSmoker] = React.useState(false);
  const [sbp, setSbp] = React.useState("");
  const [tchol, setTchol] = React.useState("");
  const [hdL, setHdl] = React.useState("");

  // Simplified SCORE2 (10-year fatal/non-fatal CVD risk)
  // This is an approximation for educational purposes
  const result = React.useMemo(() => {
    if (!age || !sex || !sbp || !tchol) return null;
    const ageNum = parseInt(age, 10);
    const sbpNum = parseInt(sbp, 10);
    const tcholNum = parseFloat(tchol);
    if (isNaN(ageNum) || isNaN(sbpNum) || isNaN(tcholNum)) return null;

    // Simplified calculation (not the full SCORE2 equation)
    let points = 0;
    if (ageNum >= 60) points += 3;
    else if (ageNum >= 50) points += 2;
    else if (ageNum >= 40) points += 1;
    if (sex === "male") points += 1;
    if (smoker) points += 2;
    if (sbpNum >= 160) points += 2;
    else if (sbpNum >= 140) points += 1;
    if (tcholNum >= 7) points += 2;
    else if (tcholNum >= 6) points += 1;
    if (hdL && parseFloat(hdL) < 1) points += 1;

    // Approximate 10-year risk %
    let risk: number;
    if (points <= 3) risk = 1;
    else if (points <= 5) risk = 3;
    else if (points <= 7) risk = 8;
    else if (points <= 9) risk = 15;
    else risk = 25;

    let level: "low" | "moderate" | "high" | "very-high";
    if (ageNum < 50) {
      level = risk < 2 ? "low" : risk < 5 ? "moderate" : risk < 10 ? "high" : "very-high";
    } else {
      level = risk < 5 ? "low" : risk < 10 ? "moderate" : risk < 15 ? "high" : "very-high";
    }
    return { points, risk, level };
  }, [age, sex, smoker, sbp, tchol, hdL]);

  const label = result?.level === "low" ? "Низкий риск" : result?.level === "moderate" ? "Умеренный" : result?.level === "high" ? "Высокий" : "Очень высокий";

  const reset = () => {
    setAge(""); setSex(""); setSmoker(false); setSbp(""); setTchol(""); setHdl("");
  };

  return (
    <CalculatorCard
      icon={Activity}
      title="SCORE2"
      description="10-летний риск сердечно-сосудистых событий (ESC 2021)"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Возраст (лет)</Label>
          <Input type="number" placeholder="напр. 55" value={age} onChange={(e) => setAge(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Пол</Label>
          <Select value={sex} onValueChange={(v) => setSex(v as "male" | "female")}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="male">♂ Муж</SelectItem>
              <SelectItem value="female">♀ Жен</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Курение</Label>
          <Select value={smoker ? "yes" : "no"} onValueChange={(v) => setSmoker(v === "yes")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="no">Не курит</SelectItem>
              <SelectItem value="yes">Курит</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Систолическое АД (мм рт.ст.)</Label>
          <Input type="number" placeholder="напр. 145" value={sbp} onChange={(e) => setSbp(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Общий холестерин (ммоль/л)</Label>
          <Input type="number" step="0.1" placeholder="напр. 6.2" value={tchol} onChange={(e) => setTchol(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>ХС-ЛВП (ммоль/л)</Label>
          <Input type="number" step="0.1" placeholder="напр. 1.2" value={hdL} onChange={(e) => setHdl(e.target.value)} />
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <ResultBadge level={result.level} label={label} score={`${result.risk}%`} />
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong>Примечание:</strong> Это упрощённая оценка для образовательных целей. Для клинических решений используйте полноценный калькулятор SCORE2 (escardio.org) с учётом региона риска.
          </div>
        </div>
      )}
      <ResetButton onClick={reset} />
    </CalculatorCard>
  );
}

// ─── BMI ──────────────────────────────────────────────────────────────────

function BmiCalculator() {
  const [weight, setWeight] = React.useState("");
  const [height, setHeight] = React.useState("");

  const result = React.useMemo(() => {
    if (!weight || !height) return null;
    const w = parseFloat(weight);
    const h = parseFloat(height) / 100;
    if (isNaN(w) || isNaN(h) || h === 0) return null;
    const bmi = w / (h * h);
    let level: "low" | "moderate" | "high" | "very-high";
    let label: string;
    if (bmi < 18.5) { level = "low"; label = "Дефицит массы"; }
    else if (bmi < 25) { level = "low"; label = "Норма"; }
    else if (bmi < 30) { level = "moderate"; label = "Избыточный вес"; }
    else if (bmi < 35) { level = "high"; label = "Ожирение I"; }
    else if (bmi < 40) { level = "high"; label = "Ожирение II"; }
    else { level = "very-high"; label = "Ожирение III"; }
    return { bmi: bmi.toFixed(1), level, label };
  }, [weight, height]);

  const reset = () => { setWeight(""); setHeight(""); };

  return (
    <CalculatorCard
      icon={TrendingUp}
      title="ИМТ (BMI)"
      description="Индекс массы тела — оценка нутритивного статуса"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Вес (кг)</Label>
          <Input type="number" step="0.1" placeholder="напр. 78.5" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Рост (см)</Label>
          <Input type="number" placeholder="напр. 175" value={height} onChange={(e) => setHeight(e.target.value)} />
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <ResultBadge level={result.level} label={result.label} score={result.bmi} />
          <div className="grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
            <div className="rounded border border-sky-500/30 bg-sky-500/5 p-1.5 text-center">
              <div className="font-semibold">&lt;18.5</div>
              <div>Дефицит</div>
            </div>
            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-1.5 text-center">
              <div className="font-semibold">18.5–25</div>
              <div>Норма</div>
            </div>
            <div className="rounded border border-amber-500/30 bg-amber-500/5 p-1.5 text-center">
              <div className="font-semibold">25–30</div>
              <div>Избыток</div>
            </div>
            <div className="rounded border border-red-500/30 bg-red-500/5 p-1.5 text-center">
              <div className="font-semibold">≥30</div>
              <div>Ожирение</div>
            </div>
          </div>
        </div>
      )}
      <ResetButton onClick={reset} />
    </CalculatorCard>
  );
}

// ─── eGFR (CKD-EPI) ───────────────────────────────────────────────────────

function EgfrCalculator() {
  const [age, setAge] = React.useState("");
  const [sex, setSex] = React.useState<"male" | "female" | "">("");
  const [creatinine, setCreatinine] = React.useState("");

  // Simplified CKD-EPI 2021 (race-free)
  const result = React.useMemo(() => {
    if (!age || !sex || !creatinine) return null;
    const ageNum = parseInt(age, 10);
    const scr = parseFloat(creatinine);
    if (isNaN(ageNum) || isNaN(scr)) return null;

    // CKD-EPI 2021 creatinine equation (simplified)
    // eGFR = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^-1.200 × 0.9938^Age × 1.012 [if female]
    const kappa = sex === "female" ? 0.7 : 0.9;
    const alpha = sex === "female" ? -0.241 : -0.302;
    const scrK = scr / kappa;
    const minPart = Math.min(scrK, 1);
    const maxPart = Math.max(scrK, 1);
    const sexMultiplier = sex === "female" ? 1.012 : 1;
    const egfr = 142 * Math.pow(minPart, alpha) * Math.pow(maxPart, -1.200) * Math.pow(0.9938, ageNum) * sexMultiplier;

    let level: "low" | "moderate" | "high" | "very-high";
    let label: string;
    let stage: string;
    if (egfr >= 90) { level = "low"; label = "Норма (G1)"; stage = "G1"; }
    else if (egfr >= 60) { level = "low"; label = "Начальное снижение (G2)"; stage = "G2"; }
    else if (egfr >= 45) { level = "moderate"; label = "Умеренное снижение (G3a)"; stage = "G3a"; }
    else if (egfr >= 30) { level = "moderate"; label = "Снижение (G3b)"; stage = "G3b"; }
    else if (egfr >= 15) { level = "high"; label = "Тяжёлое снижение (G4)"; stage = "G4"; }
    else { level = "very-high"; label = "Терминальная (G5)"; stage = "G5"; }
    return { egfr: egfr.toFixed(0), level, label, stage };
  }, [age, sex, creatinine]);

  const reset = () => { setAge(""); setSex(""); setCreatinine(""); };

  return (
    <CalculatorCard
      icon={Droplet}
      title="eGFR (CKD-EPI 2021)"
      description="Скорость клубочковой фильтрации — оценка функции почек"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Возраст (лет)</Label>
          <Input type="number" placeholder="напр. 65" value={age} onChange={(e) => setAge(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Пол</Label>
          <Select value={sex} onValueChange={(v) => setSex(v as "male" | "female")}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="male">♂ Муж</SelectItem>
              <SelectItem value="female">♀ Жен</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Креатинин (мг/дл)
            <InfoTooltip text="1 мг/дл ≈ 88.4 мкмоль/л. Для перевода из мкмоль/л разделите на 88.4." />
          </Label>
          <Input type="number" step="0.01" placeholder="напр. 1.2" value={creatinine} onChange={(e) => setCreatinine(e.target.value)} />
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <ResultBadge level={result.level} label={result.label} score={`${result.egfr} мл/мин/1.73м²`} />
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <div className="mb-2 font-medium">Стадии ХБП (KDIGO):</div>
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              <div className={cn("rounded p-1.5 text-center", result.stage === "G1" && "bg-emerald-500/15 font-semibold")}>G1: ≥90</div>
              <div className={cn("rounded p-1.5 text-center", result.stage === "G2" && "bg-emerald-500/15 font-semibold")}>G2: 60–89</div>
              <div className={cn("rounded p-1.5 text-center", result.stage === "G3a" && "bg-amber-500/15 font-semibold")}>G3a: 45–59</div>
              <div className={cn("rounded p-1.5 text-center", result.stage === "G3b" && "bg-amber-500/15 font-semibold")}>G3b: 30–44</div>
              <div className={cn("rounded p-1.5 text-center", result.stage === "G4" && "bg-orange-500/15 font-semibold")}>G4: 15–29</div>
              <div className={cn("rounded p-1.5 text-center", result.stage === "G5" && "bg-red-500/15 font-semibold")}>G5: &lt;15</div>
            </div>
          </div>
        </div>
      )}
      <ResetButton onClick={reset} />
    </CalculatorCard>
  );
}

// ─── Cockcroft-Gault ──────────────────────────────────────────────────────

function CockcroftGaultCalculator() {
  const [age, setAge] = React.useState("");
  const [sex, setSex] = React.useState<"male" | "female" | "">("");
  const [weight, setWeight] = React.useState("");
  const [creatinine, setCreatinine] = React.useState("");

  const result = React.useMemo(() => {
    if (!age || !sex || !weight || !creatinine) return null;
    const ageNum = parseInt(age, 10);
    const w = parseFloat(weight);
    const scr = parseFloat(creatinine);
    if (isNaN(ageNum) || isNaN(w) || isNaN(scr)) return null;
    // Cockcroft-Gault: CrCl = [(140 - age) × weight × (0.85 if female)] / (72 × Scr)
    const sexMult = sex === "female" ? 0.85 : 1;
    const crcl = ((140 - ageNum) * w * sexMult) / (72 * scr);
    let level: "low" | "moderate" | "high" | "very-high";
    let label: string;
    if (crcl >= 90) { level = "low"; label = "Норма"; }
    else if (crcl >= 60) { level = "low"; label = "Начальное снижение"; }
    else if (crcl >= 30) { level = "moderate"; label = "Умеренное снижение"; }
    else if (crcl >= 15) { level = "high"; label = "Тяжёлое снижение"; }
    else { level = "very-high"; label = "Терминальная"; }
    return { crcl: crcl.toFixed(0), level, label };
  }, [age, sex, weight, creatinine]);

  const reset = () => { setAge(""); setSex(""); setWeight(""); setCreatinine(""); };

  return (
    <CalculatorCard
      icon={Droplet}
      title="Cockcroft-Gault"
      description="Клиренс креатинина — для коррекции доз препаратов"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Возраст (лет)</Label>
          <Input type="number" placeholder="напр. 70" value={age} onChange={(e) => setAge(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Пол</Label>
          <Select value={sex} onValueChange={(v) => setSex(v as "male" | "female")}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="male">♂ Муж</SelectItem>
              <SelectItem value="female">♀ Жен</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Вес (кг)</Label>
          <Input type="number" step="0.1" placeholder="напр. 70" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Креатинин (мг/дл)
            <InfoTooltip text="Используется для коррекции доз: НОШ, антибиотиков, цитостатиков" />
          </Label>
          <Input type="number" step="0.01" placeholder="напр. 1.1" value={creatinine} onChange={(e) => setCreatinine(e.target.value)} />
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <ResultBadge level={result.level} label={result.label} score={`${result.crcl} мл/мин`} />
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            Используется для дозирования препаратов, выводимых почками (НОШ, дабигатран, ривароксабан, многие антибиотики).
          </div>
        </div>
      )}
      <ResetButton onClick={reset} />
    </CalculatorCard>
  );
}

// ─── HOMA-IR ──────────────────────────────────────────────────────────────

function HomaIrCalculator() {
  const [glucose, setGlucose] = React.useState("");
  const [insulin, setInsulin] = React.useState("");

  const result = React.useMemo(() => {
    if (!glucose || !insulin) return null;
    const g = parseFloat(glucose);
    const i = parseFloat(insulin);
    if (isNaN(g) || isNaN(i)) return null;
    // HOMA-IR = (glucose [mmol/L] × insulin [µIU/mL]) / 22.5
    const homa = (g * i) / 22.5;
    let level: "low" | "moderate" | "high" | "very-high";
    let label: string;
    if (homa < 1.0) { level = "low"; label = "Чувствительность повышена"; }
    else if (homa < 2.7) { level = "low"; label = "Норма"; }
    else if (homa < 5.0) { level = "moderate"; label = "Инсулинорезистентность"; }
    else { level = "high"; label = "Выраженная ИР"; }
    return { homa: homa.toFixed(2), level, label };
  }, [glucose, insulin]);

  const reset = () => { setGlucose(""); setInsulin(""); };

  return (
    <CalculatorCard
      icon={TrendingUp}
      title="HOMA-IR"
      description="Индекс инсулинорезистентности (глюкоза + инсулин натощак)"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Глюкоза натощак (ммоль/л)
            <InfoTooltip text="Норма: 3.3–5.5 ммоль/л. СД: ≥7.0" />
          </Label>
          <Input type="number" step="0.1" placeholder="напр. 5.8" value={glucose} onChange={(e) => setGlucose(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Инсулин натощак (мкЕд/мл)
            <InfoTooltip text="Норма: 2.6–24.9 мкЕд/мл" />
          </Label>
          <Input type="number" step="0.1" placeholder="напр. 12.5" value={insulin} onChange={(e) => setInsulin(e.target.value)} />
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <ResultBadge level={result.level} label={result.label} score={result.homa} />
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong>Интерпретация:</strong> HOMA-IR &lt; 2.7 — норма; 2.7–5.0 — инсулинорезистентность; &gt; 5.0 — выраженная ИР (высокий риск СД2).
          </div>
        </div>
      )}
      <ResetButton onClick={reset} />
    </CalculatorCard>
  );
}

// ─── CURB-65 ──────────────────────────────────────────────────────────────

function Curb65Calculator() {
  const [confusion, setConfusion] = React.useState(false);
  const [urea, setUrea] = React.useState("");
  const [sbp, setSbp] = React.useState("");
  const [dbp, setDbp] = React.useState("");
  const [age, setAge] = React.useState("");

  const result = React.useMemo(() => {
    let score = 0;
    if (confusion) score += 1;
    if (urea && parseFloat(urea) > 7) score += 1;
    if (sbp && parseInt(sbp, 10) < 90) score += 1;
    if (dbp && parseInt(dbp, 10) <= 60) score += 1;
    if (age && parseInt(age, 10) >= 65) score += 1;
    return score;
  }, [confusion, urea, sbp, dbp, age]);

  const level = result === 0 ? "low" : result === 1 ? "low" : result === 2 ? "moderate" : "high";
  const label = result <= 1 ? "Низкий риск (амбулаторно)" : result === 2 ? "Умеренный (госпитализация)" : "Высокий (ОРИТ)";
  const recommendation = result <= 1 ? "Лечение амбулаторно." : result === 2 ? "Рассмотреть госпитализацию." : "Госпитализация, рассмотреть ОРИТ.";

  const reset = () => {
    setConfusion(false); setUrea(""); setSbp(""); setDbp(""); setAge("");
  };

  return (
    <CalculatorCard
      icon={ShieldAlert}
      title="CURB-65"
      description="Оценка тяжести внебольничной пневмонии и решения о госпитализации"
    >
      <div className="space-y-3">
        <CheckboxRow label="Спутанность сознания (Confusion)" checked={confusion} onChange={setConfusion} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              Мочевина (ммоль/л)
              <InfoTooltip text="Urea > 7 ммоль/л = +1 балл" />
            </Label>
            <Input type="number" step="0.1" placeholder="напр. 6.5" value={urea} onChange={(e) => setUrea(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Возраст (лет)</Label>
            <Input type="number" placeholder="напр. 72" value={age} onChange={(e) => setAge(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Систолическое АД (мм рт.ст.)</Label>
            <Input type="number" placeholder="напр. 110" value={sbp} onChange={(e) => setSbp(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Диастолическое АД (мм рт.ст.)</Label>
            <Input type="number" placeholder="напр. 70" value={dbp} onChange={(e) => setDbp(e.target.value)} />
          </div>
        </div>
      </div>

      {result > 0 || confusion || urea || sbp || dbp || age ? (
        <div className="space-y-3">
          <ResultBadge level={level} label={label} score={`${result} баллов`} />
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <div className="font-medium">{recommendation}</div>
          </div>
        </div>
      ) : null}
      <ResetButton onClick={reset} />
    </CalculatorCard>
  );
}

// ─── NIHSS (simplified) ───────────────────────────────────────────────────

function NihssCalculator() {
  const [loc, setLoc] = React.useState("0");
  const [gaze, setGaze] = React.useState("0");
  const [visual, setVisual] = React.useState("0");
  const [facial, setFacial] = React.useState("0");
  const [armL, setArmL] = React.useState("0");
  const [armR, setArmR] = React.useState("0");
  const [legL, setLegL] = React.useState("0");
  const [legR, setLegR] = React.useState("0");
  const [lang, setLang] = React.useState("0");
  const [dysarthria, setDysarthria] = React.useState("0");
  const [extinction, setExtinction] = React.useState("0");

  const score = React.useMemo(() => {
    return (
      parseInt(loc) + parseInt(gaze) + parseInt(visual) + parseInt(facial) +
      parseInt(armL) + parseInt(armR) + parseInt(legL) + parseInt(legR) +
      parseInt(lang) + parseInt(dysarthria) + parseInt(extinction)
    );
  }, [loc, gaze, visual, facial, armL, armR, legL, legR, lang, dysarthria, extinction]);

  const level = score === 0 ? "low" : score <= 4 ? "low" : score <= 15 ? "moderate" : score <= 20 ? "high" : "very-high";
  const label = score === 0 ? "Нет дефицита" : score <= 4 ? "Лёгкий" : score <= 15 ? "Среднетяжёлый" : score <= 20 ? "Тяжёлый" : "Крайне тяжёлый";

  const reset = () => {
    setLoc("0"); setGaze("0"); setVisual("0"); setFacial("0");
    setArmL("0"); setArmR("0"); setLegL("0"); setLegR("0");
    setLang("0"); setDysarthria("0"); setExtinction("0");
  };

  return (
    <CalculatorCard
      icon={Brain}
      title="NIHSS"
      description="Шкала инсульта National Institutes of Health Stroke Scale"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <ScoreSelect label="1a. Уровень сознания" value={loc} onChange={setLoc} options={[["0", "Ясное"], ["1", "Сонливое"], ["2", "Сопор"], ["3", "Кома"]]} />
        <ScoreSelect label="2. Взгляд" value={gaze} onChange={setGaze} options={[["0", "Норма"], ["1", "Парциальный парез"], ["2", "Полное отклонение"]]} />
        <ScoreSelect label="3. Поля зрения" value={visual} onChange={setVisual} options={[["0", "Норма"], ["1", "Квадрантная гемианопсия"], ["2", "Полная гемианопсия"], ["3", "Билатеральная"]]} />
        <ScoreSelect label="4. Лицевые мышцы" value={facial} onChange={setFacial} options={[["0", "Норма"], ["1", "Лёгкий парез"], ["2", "Умеренный"], ["3", "Полный парез"]]} />
        <ScoreSelect label="5a. Левая рука" value={armL} onChange={setArmL} options={[["0", "Удерживает"], ["1", "Дрейф"], ["2", "Падает"], ["3", "Нет силы"], ["4", "Нет движения"]]} />
        <ScoreSelect label="5b. Правая рука" value={armR} onChange={setArmR} options={[["0", "Удерживает"], ["1", "Дрейф"], ["2", "Падает"], ["3", "Нет силы"], ["4", "Нет движения"]]} />
        <ScoreSelect label="6a. Левая нога" value={legL} onChange={setLegL} options={[["0", "Удерживает"], ["1", "Дрейф"], ["2", "Падает"], ["3", "Нет силы"], ["4", "Нет движения"]]} />
        <ScoreSelect label="6b. Правая нога" value={legR} onChange={setLegR} options={[["0", "Удерживает"], ["1", "Дрейф"], ["2", "Падает"], ["3", "Нет силы"], ["4", "Нет движения"]]} />
        <ScoreSelect label="9. Речь" value={lang} onChange={setLang} options={[["0", "Норма"], ["1", "Лёгкая афазия"], ["2", "Тяжёлая афазия"], ["3", "Мутизм"]]} />
        <ScoreSelect label="10. Дизартрия" value={dysarthria} onChange={setDysarthria} options={[["0", "Норма"], ["1", "Лёгкая"], ["2", "Тяжёлая"]]} />
        <ScoreSelect label="11. Игнорирование" value={extinction} onChange={setExtinction} options={[["0", "Нет"], ["1", "Одностороннее"], ["2", "Полное"]]} />
      </div>

      <div className="space-y-3">
        <ResultBadge level={level} label={label} score={`${score} баллов`} />
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <strong>Интерпретация:</strong> 0 — нет дефицита; 1–4 — лёгкий; 5–15 — среднетяжёлый; 16–20 — тяжёлый; 21–42 — крайне тяжёлый. Тромболизис рассматривается при &gt; 4 баллов (в окне 4.5 ч).
        </div>
      </div>
      <ResetButton onClick={reset} />
    </CalculatorCard>
  );
}

function ScoreSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([val, lbl]) => (
            <SelectItem key={val} value={val}>{val} — {lbl}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── MELD ─────────────────────────────────────────────────────────────────

function MeldCalculator() {
  const [bilirubin, setBilirubin] = React.useState("");
  const [inr, setInr] = React.useState("");
  const [creatinine, setCreatinine] = React.useState("");
  const [dialysis, setDialysis] = React.useState(false);

  const result = React.useMemo(() => {
    if (!bilirubin || !inr || !creatinine) return null;
    const bili = parseFloat(bilirubin);
    const i = parseFloat(inr);
    const cr = parseFloat(creatinine);
    if (isNaN(bili) || isNaN(i) || isNaN(cr)) return null;
    // MELD-Na simplified (without sodium for this version)
    // MELD = 3.78 × ln(bilirubin) + 11.2 × ln(INR) + 9.57 × ln(creatinine) + 6.43
    const crUsed = dialysis ? 4 : Math.max(cr, 1);
    const biliUsed = Math.max(bili, 1);
    const inrUsed = Math.max(i, 1);
    let meld = 3.78 * Math.log(biliUsed) + 11.2 * Math.log(inrUsed) + 9.57 * Math.log(crUsed) + 6.43;
    meld = Math.round(meld);
    meld = Math.max(6, Math.min(40, meld));
    let level: "low" | "moderate" | "high" | "very-high";
    let label: string;
    if (meld < 10) { level = "low"; label = "Низкий риск"; }
    else if (meld < 20) { level = "moderate"; label = "Умеренный"; }
    else if (meld < 30) { level = "high"; label = "Высокий"; }
    else { level = "very-high"; label = "Очень высокий"; }
    return { meld, level, label };
  }, [bilirubin, inr, creatinine, dialysis]);

  const reset = () => { setBilirubin(""); setInr(""); setCreatinine(""); setDialysis(false); };

  return (
    <CalculatorCard
      icon={Droplet}
      title="MELD"
      description="Model for End-stage Liver Disease — тяжесть поражения печени"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Билирубин (мг/дл)</Label>
          <Input type="number" step="0.1" placeholder="напр. 2.5" value={bilirubin} onChange={(e) => setBilirubin(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>МНО (INR)</Label>
          <Input type="number" step="0.1" placeholder="напр. 1.5" value={inr} onChange={(e) => setInr(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Креатинин (мг/дл)</Label>
          <Input type="number" step="0.1" placeholder="напр. 1.2" value={creatinine} onChange={(e) => setCreatinine(e.target.value)} />
        </div>
      </div>
      <CheckboxRow label="Пациент на диализе (≥ 2 сеансов за последнюю неделю)" checked={dialysis} onChange={setDialysis} />

      {result && (
        <div className="space-y-3">
          <ResultBadge level={result.level} label={result.label} score={`${result.meld}`} />
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong>3-месячная выживаемость:</strong> MELD &lt; 9 — 98%; 10–19 — 90%; 20–29 — 70%; 30–39 — 50%; ≥ 40 — 25%.
          </div>
        </div>
      )}
      <ResetButton onClick={reset} />
    </CalculatorCard>
  );
}

// ─── Drug Interaction Checker ─────────────────────────────────────────────
//
// v5.0: ПОТОКОВЫЙ ОНЛАЙН-ПОИСК взаимодействий в базах данных РФ.
// Врач вводит список препаратов (МНН или торговые наименования), движок:
//   1) нормализует бренды → МНН (словарь рынка РФ);
//   2) мгновенно проверяет локальную таблицу;
//   3) ПОТОКОВО проверяет каждую пару онлайн (РЛС rlsnet.ru · Видаль vidal.ru
//      · ГРЛС Минздрава · КР Минздрава) с LLM-извлечением и ссылками на
//      первоисточники.
// Все этапы видны в реальном времени (SSE), алерты приходят по мере проверки.

const COMMON_MEDICATIONS = [
  "метформин", "инсулин", "глибенкламид", "ситаглиптин", "эмпаглифлозин", "семаглутид",
  "эналаприл", "лизиноприл", "рамиприл", "лозартан", "валсартан", "амлодипин",
  "бисопролол", "метопролол", "карведилол", "аторвастатин", "розувастатин",
  "варфарин", "ривароксабан", "апиксабан", "дабигатран", "клопидогрел", "аспирин",
  "тамоксифен", "летрозол", "трастузумаб", "иматиниб", "олапариб",
  "амоксициллин", "азитромицин", "кларитромицин", "цефтриаксон", "ванкомицин", "ципрофлоксацин",
  "флуконазол", "ацикловир", "осельтамивир",
  "парацетамол", "ибупрофен", "диклофенак", "морфин", "трамадол",
  "омепразол", "ондансетрон", "сальбутамол", "будесонид",
  "левотироксин", "преднизолон", "дексаметазон", "метотрексат",
  "сертралин", "флуоксетин", "диазепам", "леветирацетам",
  "фуросемид", "спиронолактон", "дигоксин", "амиодарон",
];

function DrugInteractionChecker() {
  const [medications, setMedications] = React.useState<string[]>([]);
  const [input, setInput] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { state, start, stop, reset } = useDDIStream();

  // Debounced autocomplete suggestions
  React.useEffect(() => {
    if (!input.trim()) {
      setSuggestions([]);
      return;
    }
    const q = input.toLowerCase().trim();
    const matches = COMMON_MEDICATIONS
      .filter((m) => m.toLowerCase().includes(q) && !medications.includes(m))
      .slice(0, 6);
    setSuggestions(matches);
  }, [input, medications]);

  const addMedication = (med: string) => {
    const trimmed = med.trim().toLowerCase();
    if (trimmed && !medications.includes(trimmed)) {
      setMedications([...medications, trimmed]);
    }
    setInput("");
    setSuggestions([]);
    reset();
    inputRef.current?.focus();
  };

  const removeMedication = (med: string) => {
    setMedications(medications.filter((m) => m !== med));
    reset();
  };

  const runCheck = () => {
    if (medications.length < 2) return;
    start(medications);
  };

  return (
    <CalculatorCard
      icon={Pill}
      title="Проверка лекарственных взаимодействий"
      description="Потоковый онлайн-поиск в базах данных РФ: РЛС, Видаль, ГРЛС Минздрава, клинические рекомендации. Поддерживаются МНН и торговые наименования."
    >
      {/* Медикаментозный ввод с автодополнением */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1">
          Препарат (МНН или торговое наименование)
          <InfoTooltip text="Введите международное непатентованное название (МНН) или бренд (например: Глюкофаж, Плавикс, Кордарон) — движок автоматически сопоставит МНН. Дозировка не требуется." />
        </Label>
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Начните вводить название препарата…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && input.trim()) {
                  e.preventDefault();
                  addMedication(input);
                }
              }}
              className="pl-9"
            />
          </div>
          {suggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-lg">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addMedication(s)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent first:rounded-t-lg last:rounded-b-lg"
                >
                  <Plus className="h-3.5 w-3.5 text-primary" />
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Список выбранных препаратов */}
      {medications.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Список препаратов ({medications.length})</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => { setMedications([]); reset(); }}
            >
              <X className="h-3 w-3" />Очистить
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {medications.map((med) => (
              <div
                key={med}
                className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-sm"
              >
                <Pill className="h-3.5 w-3.5 text-primary" />
                <span className="font-medium">{med}</span>
                <button
                  onClick={() => removeMedication(med)}
                  className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Удалить ${med}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Кнопка запуска потоковой проверки */}
      {medications.length >= 2 && (
        <Button
          className="w-full gap-2 bg-medical-gradient text-white hover:opacity-90"
          onClick={runCheck}
          disabled={state.running}
        >
          {state.running ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Проверка ({state.completedPairs}/{state.totalPairs || "?"} пар)…</>
          ) : (
            <><Pill className="h-4 w-4" />Проверить онлайн в базах РФ ({medications.length} препаратов)</>
          )}
        </Button>
      )}

      {/* Потоковая панель прогресса и живых алертов */}
      {(state.running || state.alerts.length > 0 || state.complete || state.summary || state.error) && (
        <DDIStreamPanel state={state} onStop={stop} />
      )}

      {medications.length === 1 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <Info className="mr-1.5 inline h-4 w-4" />
          Добавьте минимум 2 препарата для проверки взаимодействий.
        </div>
      )}
    </CalculatorCard>
  );
}

// ─── Renal Dose Adjustment Calculator ─────────────────────────────────────
//
// Helps doctors adjust medication dosages based on renal function (eGFR/CrCl).
// Includes a database of common medications with their renal dose adjustment
// rules. The doctor selects a medication + enters eGFR → gets the adjusted dose.
//
// This is a decision-support tool, NOT a prescription tool. The doctor must
// verify the recommendation against the current drug label and clinical context.

interface RenalDoseRule {
  drug: string;
  category: string;
  normalDose: string;
  rules: Array<{
    egfrMin: number; // inclusive
    egfrMax: number; // exclusive (use Infinity for no upper bound)
    adjustment: string;
    note?: string;
  }>;
}

const RENAL_DOSE_RULES: RenalDoseRule[] = [
  {
    drug: "Метформин",
    category: "Противодиабетические",
    normalDose: "500–1000 мг 2 раза/сут перорально",
    rules: [
      { egfrMin: 60, egfrMax: Infinity, adjustment: "Обычная доза: 500–1000 мг 2 раза/сут" },
      { egfrMin: 45, egfrMax: 60, adjustment: "Старт 500 мг 1 раз/сут, титровать осторожно" },
      { egfrMin: 30, egfrMax: 45, adjustment: "Противопоказан (риск лактоацидоза)" },
      { egfrMin: 0, egfrMax: 30, adjustment: "АБСОЛЮТНО противопоказан", note: "СКФ < 30 — стоп препарат" },
    ],
  },
  {
    drug: "Дабигатран",
    category: "Антикоагулянты",
    normalDose: "150 мг 2 раза/сут перорально",
    rules: [
      { egfrMin: 50, egfrMax: Infinity, adjustment: "150 мг 2 раза/сут" },
      { egfrMin: 30, egfrMax: 50, adjustment: "110 мг 2 раза/сут" },
      { egfrMin: 15, egfrMax: 30, adjustment: "75 мг 2 раза/сут (с осторожностью)" },
      { egfrMin: 0, egfrMax: 15, adjustment: "Противопоказан" },
    ],
  },
  {
    drug: "Ривароксабан",
    category: "Антикоагулянты",
    normalDose: "20 мг 1 раз/сут перорально",
    rules: [
      { egfrMin: 50, egfrMax: Infinity, adjustment: "20 мг 1 раз/сут" },
      { egfrMin: 30, egfrMax: 50, adjustment: "15 мг 1 раз/сут" },
      { egfrMin: 15, egfrMax: 30, adjustment: "10 мг 1 раз/сут (с осторожностью)" },
      { egfrMin: 0, egfrMax: 15, adjustment: "Противопоказан при ФП" },
    ],
  },
  {
    drug: "Апиксабан",
    category: "Антикоагулянты",
    normalDose: "5 мг 2 раза/сут перорально",
    rules: [
      { egfrMin: 30, egfrMax: Infinity, adjustment: "5 мг 2 раза/сут (или 2.5 мг при ≥2 критериев: возраст≥80, вес≤60, креатинин≥1.5)" },
      { egfrMin: 15, egfrMax: 30, adjustment: "2.5 мг 2 раза/сут" },
      { egfrMin: 0, egfrMax: 15, adjustment: "Противопоказан при СКФ < 15" },
    ],
  },
  {
    drug: "Ванкомицин",
    category: "Антибиотики",
    normalDose: "15–20 мг/кг в/в каждые 8–12 ч",
    rules: [
      { egfrMin: 60, egfrMax: Infinity, adjustment: "15–20 мг/кг в/в каждые 8–12 ч", note: "Контроль trough-уровня 15–20 мкг/мл" },
      { egfrMin: 30, egfrMax: 60, adjustment: "15 мг/кг в/в каждые 24 ч", note: "Контроль trough 15–20 мкг/мл" },
      { egfrMin: 15, egfrMax: 30, adjustment: "10–15 мг/кг в/в каждые 24–48 ч", note: "Обязательный TDM" },
      { egfrMin: 0, egfrMax: 15, adjustment: "10 мг/кг в/в каждые 48–96 ч", note: "После диализа; TDM обязателен" },
    ],
  },
  {
    drug: "Цефтриаксон",
    category: "Антибиотики",
    normalDose: "1–2 г в/в 1 раз/сут",
    rules: [
      { egfrMin: 30, egfrMax: Infinity, adjustment: "1–2 г в/в 1 раз/сут (коррекции не требуется)" },
      { egfrMin: 10, egfrMax: 30, adjustment: "1–2 г в/в 1 раз/сут (макс. 2 г)" },
      { egfrMin: 0, egfrMax: 10, adjustment: "1 г в/в 1 раз/сут" },
    ],
  },
  {
    drug: "Левофлоксацин",
    category: "Антибиотики",
    normalDose: "500–750 мг в/в/перорально 1 раз/сут",
    rules: [
      { egfrMin: 50, egfrMax: Infinity, adjustment: "500–750 мг 1 раз/сут" },
      { egfrMin: 20, egfrMax: 50, adjustment: "500 мг старт, затем 250 мг каждые 24 ч" },
      { egfrMin: 0, egfrMax: 20, adjustment: "500 мг старт, затем 250 мг каждые 48 ч" },
    ],
  },
  {
    drug: "Габапентин",
    category: "Противосудорожные",
    normalDose: "300–1200 мг 3 раза/сут перорально",
    rules: [
      { egfrMin: 60, egfrMax: Infinity, adjustment: "300–1200 мг 3 раза/сут" },
      { egfrMin: 30, egfrMax: 60, adjustment: "200–700 мг 2 раза/сут" },
      { egfrMin: 15, egfrMax: 30, adjustment: "100–400 мг 1–2 раза/сут" },
      { egfrMin: 0, egfrMax: 15, adjustment: "100–300 мг через день после диализа" },
    ],
  },
  {
    drug: "Дигоксин",
    category: "Кардиологические",
    normalDose: "0.125–0.25 мг перорально 1 раз/сут",
    rules: [
      { egfrMin: 50, egfrMax: Infinity, adjustment: "0.125–0.25 мг 1 раз/сут" },
      { egfrMin: 20, egfrMax: 50, adjustment: "0.0625–0.125 мг 1 раз/сут" },
      { egfrMin: 0, egfrMax: 20, adjustment: "0.0625 мг через день", note: "Контроль уровня дигоксина 0.5–0.9 нг/мл" },
    ],
  },
  {
    drug: "Спиронолактон",
    category: "Диуретики",
    normalDose: "25–50 мг перорально 1 раз/сут",
    rules: [
      { egfrMin: 30, egfrMax: Infinity, adjustment: "25–50 мг 1 раз/сут", note: "Контроль калия" },
      { egfrMin: 20, egfrMax: 30, adjustment: "12.5–25 мг 1 раз/сут", note: "Осторожно — риск гиперкалиемии" },
      { egfrMin: 0, egfrMax: 20, adjustment: "Противопоказан (гиперкалиемия)", note: "СТОП при СКФ < 20" },
    ],
  },
  {
    drug: "Аливоциумаб (PCSK9)",
    category: "Липидоснижающие",
    normalDose: "75–150 мг п/к каждые 2 недели",
    rules: [
      { egfrMin: 0, egfrMax: Infinity, adjustment: "Коррекции не требуется — выводится через ретикулоэндотелиальную систему" },
    ],
  },
  {
    drug: "Сертралин",
    category: "Антидепрессанты",
    normalDose: "50–200 мг перорально 1 раз/сут",
    rules: [
      { egfrMin: 0, egfrMax: Infinity, adjustment: "Коррекции не требуется" },
    ],
  },
];

function RenalDoseAdjustmentCalculator() {
  const [selectedDrug, setSelectedDrug] = React.useState<string>("");
  const [egfr, setEgfr] = React.useState("");
  const [showResults, setShowResults] = React.useState(false);

  const drug = RENAL_DOSE_RULES.find((d) => d.drug === selectedDrug);
  const egfrNum = parseFloat(egfr);

  const result = React.useMemo(() => {
    if (!drug || isNaN(egfrNum)) return null;
    const rule = drug.rules.find((r) => egfrNum >= r.egfrMin && egfrNum < r.egfrMax);
    if (!rule) return null;
    // Determine severity
    const isContraindicated = /противопоказан|СТОП/i.test(rule.adjustment);
    const isCaution = /осторожно|с осторожностью/i.test(rule.adjustment);
    const level = isContraindicated ? "very-high" : isCaution ? "moderate" : "low";
    const label = isContraindicated ? "Противопоказан" : isCaution ? "С осторожностью" : "Коррекция дозы";
    return { ...rule, level, label };
  }, [drug, egfrNum]);

  const handleCheck = () => {
    setShowResults(true);
  };

  const reset = () => {
    setSelectedDrug("");
    setEgfr("");
    setShowResults(false);
  };

  // Group drugs by category for the dropdown
  const drugsByCategory = React.useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const d of RENAL_DOSE_RULES) {
      if (!groups[d.category]) groups[d.category] = [];
      groups[d.category].push(d.drug);
    }
    return groups;
  }, []);

  return (
    <CalculatorCard
      icon={Pill}
      title="Коррекция дозы по функции почек"
      description="Подбор дозы препарата в зависимости от СКФ (eGFR)"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            Препарат
            <InfoTooltip text="Выберите препарат из списка. Дозировки основаны на официальных рекомендациях производителей." />
          </Label>
          <Select value={selectedDrug} onValueChange={(v) => { setSelectedDrug(v); setShowResults(false); }}>
            <SelectTrigger><SelectValue placeholder="Выберите препарат…" /></SelectTrigger>
            <SelectContent className="max-h-80">
              {Object.entries(drugsByCategory).map(([cat, drugs]) => (
                <div key={cat}>
                  <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">{cat}</div>
                  {drugs.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1">
            eGFR (мл/мин/1.73м²)
            <InfoTooltip text="Скорость клубочковой фильтрации. Используйте калькулятор eGFR (вкладка Почки) для расчёта." />
          </Label>
          <Input
            type="number"
            placeholder="напр. 45"
            value={egfr}
            onChange={(e) => { setEgfr(e.target.value); setShowResults(false); }}
          />
        </div>
      </div>

      {drug && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium">Стандартная доза:</span>
            <span className="text-muted-foreground">{drug.normalDose}</span>
          </div>
        </div>
      )}

      {drug && egfr && !isNaN(egfrNum) && (
        <Button className="w-full gap-2 bg-medical-gradient text-white hover:opacity-90" onClick={handleCheck}>
          <Activity className="h-4 w-4" />Рассчитать скорректированную дозу
        </Button>
      )}

      {showResults && result && drug && (
        <div className="space-y-3">
          <ResultBadge level={result.level as "low" | "moderate" | "high" | "very-high"} label={result.label} score={`СКФ ${egfrNum}`} />
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-2 flex items-center gap-2">
              <Pill className="h-4 w-4 text-primary" />
              <span className="font-semibold">{drug.drug}</span>
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Рекомендуемая доза: </span>
                <span className="font-medium text-foreground">{result.adjustment}</span>
              </div>
              {result.note && (
                <div className="rounded bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                  <Info className="mr-1 inline h-3 w-3" />
                  {result.note}
                </div>
              )}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong>Дисклеймер:</strong> Рекомендация основана на типовых правилах коррекции дозы. Окончательное решение принимает лечащий врач с учётом клинического контекста, сопутствующей терапии и лабораторных данных.
          </div>
        </div>
      )}

      {showResults && !result && drug && !isNaN(egfrNum) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertOctagon className="mr-1.5 inline h-4 w-4" />
          Не удалось подобрать правило для СКФ={egfrNum}. Проверьте значение.
        </div>
      )}

      <ResetButton onClick={reset} />

      {/* Quick reference table */}
      {!selectedDrug && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Доступные препараты ({RENAL_DOSE_RULES.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {RENAL_DOSE_RULES.map((d) => (
              <Badge key={d.drug} variant="outline" className="cursor-pointer text-xs hover:bg-accent" >
                {d.drug}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </CalculatorCard>
  );
}

// ─── Allergy & Contraindication Checker ───────────────────────────────────
//
// Helps doctors check if a medication is safe for a patient with known
// allergies or conditions. The doctor selects a medication → the tool shows
// known contraindications, cross-reactivity, and alternative drugs.
//
// This is a decision-support tool, NOT a prescription tool.

interface AllergyRule {
  allergen: string;
  category: string;
  crossReactiveDrugs: string[];
  severity: "contraindication" | "caution" | "safe";
  description: string;
  alternatives: string[];
}

const ALLERGY_RULES: AllergyRule[] = [
  {
    allergen: "Пенициллины",
    category: "Антибиотики",
    crossReactiveDrugs: ["амоксициллин", "ампициллин", "пенициллин", "флемоксин", "аугментин", "амоксиклав"],
    severity: "contraindication",
    description: "Перекрёстная реактивность между пенициллинами ~1–10%. Риск анафилаксии при повторном введении.",
    alternatives: ["макролиды (азитромицин, кларитромицин)", "цефалоспорины 3–4 поколения (с осторожностью)", "ванкомицин", "линезолид"],
  },
  {
    allergen: "Сульфаниламиды",
    category: "Антибиотики",
    crossReactiveDrugs: ["сульфаметоксазол", "ко-тримоксазол", "бисептол", "сульфасалазин"],
    severity: "contraindication",
    description: "Перекрёстная реактивность между сульфаниламидами. Также может реагировать с диуретиками (фуросемид, тиазиды).",
    alternatives: ["макролиды", "фторхинолоны", "цефалоспорины", "нитрофурантоин"],
  },
  {
    allergen: "Аспирин (НПВС)",
    category: "Анальгетики",
    crossReactiveDrugs: ["аспирин", "ацетилсалициловая кислота", "ибупрофен", "напроксен", "диклофенак", "кеторолак", "мелоксикам", "нимесулид", "целекоксиб"],
    severity: "contraindication",
    description: "Перекрёстная чувствительность к НПВС (~70–90% при аспириновой астме). Риск бронхоспазма, крапивницы, анафилаксии.",
    alternatives: ["парацетамол (безопасен при аспириновой астме)", "опиоиды (трамадол, морфин)", "селективные ингибиторы ЦОГ-2 (с осторожностью)"],
  },
  {
    allergen: "Йод/контраст",
    category: "Рентгенконтрастные",
    crossReactiveDrugs: ["йодсодержащие контрастные вещества", "повидон-йод", "амиодарон (содержит йод)"],
    severity: "caution",
    description: "Аллергия на йодсодержащий контраст не означает аллергию на другие йодсодержащие препараты. Премедикация глюкокортикоидами + антигистаминными перед контрастом.",
    alternatives: ["гадолиний (МРТ-контраст)", "премедикация: преднизолон 50 мг + дифенгидрамин 50 мг за 13, 7, 1 ч до исследования"],
  },
  {
    allergen: "Латекс",
    category: "Материалы",
    crossReactiveDrugs: ["латексные перчатки", "латексные катетеры", "резиновые жгуты"],
    severity: "caution",
    description: "Перекрёстная реактивность с фруктами (киви, банан, авокадо, каштан) — синдром «латекс-фрукты».",
    alternatives: ["нитриловые перчатки", "виниловые перчатки", "неопреновые изделия"],
  },
  {
    allergen: "Парацетамол",
    category: "Анальгетики",
    crossReactiveDrugs: ["парацетамол", "ацетаминофен", "панадол", "эффералган"],
    severity: "contraindication",
    description: "Редкая, но возможная аллергия (крапивница, анафилаксия). При подтверждённой аллергии — полное исключение.",
    alternatives: ["ибупрофен (если нет аллергии на НПВС)", "напроксен", "опиоиды"],
  },
];

function AllergyContraindicationChecker() {
  const [selectedAllergen, setSelectedAllergen] = React.useState<string>("");

  const rule = ALLERGY_RULES.find((r) => r.allergen === selectedAllergen);

  const severityConfig = {
    contraindication: { label: "Противопоказано", color: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300", icon: AlertOctagon },
    caution: { label: "С осторожностью", color: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: ShieldAlert },
    safe: { label: "Безопасно", color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: ShieldCheck },
  };
  const cfg = rule ? severityConfig[rule.severity] : severityConfig.caution;
  const Icon = cfg.icon;

  return (
    <CalculatorCard
      icon={ShieldAlert}
      title="Проверка аллергий и противопоказаний"
      description="Проверьте безопасность препарата при известных аллергиях пациента"
    >
      <div className="space-y-2">
        <Label className="flex items-center gap-1">
          Известная аллергия / непереносимость
          <InfoTooltip text="Выберите аллерген из списка. Будут показаны перекрёстно-реактивные препараты и безопасные альтернативы." />
        </Label>
        <Select value={selectedAllergen} onValueChange={setSelectedAllergen}>
          <SelectTrigger><SelectValue placeholder="Выберите аллерген…" /></SelectTrigger>
          <SelectContent className="max-h-80">
            {ALLERGY_RULES.map((r) => (
              <SelectItem key={r.allergen} value={r.allergen}>
                {r.allergen} <span className="text-xs text-muted-foreground">— {r.category}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rule && (
        <div className="space-y-3">
          {/* Severity banner */}
          <div className={cn("rounded-lg border p-3", cfg.color)}>
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5" />
              <div>
                <div className="font-semibold">{cfg.label}</div>
                <div className="text-xs opacity-80">{rule.allergen} — {rule.category}</div>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="rounded-lg border bg-card p-3 text-sm">
            <div className="mb-1.5 flex items-center gap-1.5 font-medium">
              <Info className="h-4 w-4 text-primary" />
              Описание
            </div>
            <p className="text-muted-foreground">{rule.description}</p>
          </div>

          {/* Cross-reactive drugs */}
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-300">
              <X className="h-4 w-4" />
              Перекрёстно-реактивные препараты (ИЗБЕГАТЬ)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {rule.crossReactiveDrugs.map((drug, i) => (
                <Badge key={i} variant="outline" className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 text-xs">
                  <Pill className="mr-1 h-3 w-3" />
                  {drug}
                </Badge>
              ))}
            </div>
          </div>

          {/* Alternatives */}
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-4 w-4" />
              Безопасные альтернативы
            </div>
            <div className="space-y-1.5">
              {rule.alternatives.map((alt, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 text-emerald-600">✓</span>
                  <span className="text-foreground">{alt}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!selectedAllergen && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Доступные аллергены ({ALLERGY_RULES.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ALLERGY_RULES.map((r) => (
              <Badge key={r.allergen} variant="outline" className="cursor-pointer text-xs hover:bg-accent">
                {r.allergen}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong>Дисклеймер:</strong> Информация носит справочный характер. При документально подтверждённой аллергии — проконсультируйтесь с аллергологом. Перекрёстная реактивность варьируется индивидуально.
      </div>
    </CalculatorCard>
  );
}

// ─── Vital Signs Monitor ─────────────────────────────────────────────────
//
// A quick vital signs assessment tool. The doctor enters current vital signs
// (BP, HR, temp, SpO2, RR, glucose) and the tool immediately classifies each
// as normal / abnormal / critical, with color-coded badges and clinical
// guidance. This is NOT a continuous monitor — it's a point-in-time snapshot
// for quick triage assessment.

interface VitalSignRule {
  key: string;
  label: string;
  unit: string;
  icon: LucideIcon;
  normal: { min: number; max: number };
  abnormal: { min: number; max: number };
  // outside both ranges = critical
  criticalLow: string;
  criticalHigh: string;
  abnormalLow: string;
  abnormalHigh: string;
  normalText: string;
}

const VITAL_SIGNS_RULES: VitalSignRule[] = [
  {
    key: "sbp",
    label: "Систолическое АД",
    unit: "мм рт.ст.",
    icon: HeartPulse,
    normal: { min: 90, max: 129 },
    abnormal: { min: 80, max: 139 },
    criticalLow: "< 80 — шок, критическая гипотензия",
    criticalHigh: "≥ 180 — гипертонический криз",
    abnormalLow: "80–89 — гипотензия",
    abnormalHigh: "130–179 — артериальная гипертензия",
    normalText: "Нормотензия (90–129)",
  },
  {
    key: "dbp",
    label: "Диастолическое АД",
    unit: "мм рт.ст.",
    icon: HeartPulse,
    normal: { min: 60, max: 79 },
    abnormal: { min: 50, max: 89 },
    criticalLow: "< 50 — критическая гипотензия",
    criticalHigh: "≥ 120 — гипертонический криз",
    abnormalLow: "50–59 — гипотензия",
    abnormalHigh: "80–119 — артериальная гипертензия",
    normalText: "Норма (60–79)",
  },
  {
    key: "hr",
    label: "ЧСС",
    unit: "уд/мин",
    icon: Activity,
    normal: { min: 60, max: 100 },
    abnormal: { min: 40, max: 120 },
    criticalLow: "< 40 — выраженная брадикардия",
    criticalHigh: "> 120 — тахикардия (риск ФП/ЖТ)",
    abnormalLow: "40–59 — брадикардия",
    abnormalHigh: "101–120 — тахикардия",
    normalText: "Нормокардия (60–100)",
  },
  {
    key: "temp",
    label: "Температура",
    unit: "°C",
    icon: TrendingUp,
    normal: { min: 36.0, max: 37.2 },
    abnormal: { min: 35.0, max: 38.5 },
    criticalLow: "< 35.0 — гипотермия",
    criticalHigh: "≥ 39.5 — гипертермия (сепсис?)",
    abnormalLow: "35.0–35.9 — гипотермия",
    abnormalHigh: "37.3–39.4 — лихорадка",
    normalText: "Нормотермия (36.0–37.2)",
  },
  {
    key: "spo2",
    label: "SpO₂",
    unit: "%",
    icon: Droplet,
    normal: { min: 95, max: 100 },
    abnormal: { min: 88, max: 94 },
    criticalLow: "< 88 — тяжёлая гипоксемия (О₂ терапия!)",
    criticalHigh: "—",
    abnormalLow: "88–94 — гипоксемия",
    abnormalHigh: "—",
    normalText: "Нормоксия (95–100%)",
  },
  {
    key: "rr",
    label: "ЧДД",
    unit: "/мин",
    icon: Activity,
    normal: { min: 12, max: 20 },
    abnormal: { min: 8, max: 24 },
    criticalLow: "< 8 — брадипноэ (угнетение дыхания)",
    criticalHigh: "> 25 — тахипноэ (сепсис, ДН)",
    abnormalLow: "8–11 — брадипноэ",
    abnormalHigh: "21–24 — тахипноэ",
    normalText: "Эупноэ (12–20)",
  },
  {
    key: "glucose",
    label: "Глюкоза",
    unit: "ммоль/л",
    icon: Droplet,
    normal: { min: 3.9, max: 6.1 },
    abnormal: { min: 2.8, max: 11.0 },
    criticalLow: "< 2.8 — тяжёлая гипогликемия",
    criticalHigh: "> 11.0 — гипергликемия (кетоацидоз?)",
    abnormalLow: "2.8–3.8 — гипогликемия",
    abnormalHigh: "6.2–11.0 — гипергликемия",
    normalText: "Нормогликемия (3.9–6.1)",
  },
];

function VitalSignsMonitor() {
  const [values, setValues] = React.useState<Record<string, string>>({});

  const assessments = React.useMemo(() => {
    return VITAL_SIGNS_RULES.map((rule) => {
      const valStr = values[rule.key];
      if (!valStr) return { rule, status: "empty" as const };
      const val = parseFloat(valStr);
      if (isNaN(val)) return { rule, status: "empty" as const };
      let status: "normal" | "abnormal" | "critical";
      let guidance = "";
      if (val >= rule.normal.min && val <= rule.normal.max) {
        status = "normal";
        guidance = rule.normalText;
      } else if (val >= rule.abnormal.min && val <= rule.abnormal.max) {
        status = "abnormal";
        if (val < rule.normal.min) guidance = rule.abnormalLow;
        else guidance = rule.abnormalHigh;
      } else {
        status = "critical";
        if (val < rule.abnormal.min) guidance = rule.criticalLow;
        else guidance = rule.criticalHigh;
      }
      return { rule, status, guidance, value: val };
    });
  }, [values]);

  const criticalCount = assessments.filter((a) => a.status === "critical").length;
  const abnormalCount = assessments.filter((a) => a.status === "abnormal").length;
  const normalCount = assessments.filter((a) => a.status === "normal").length;

  const reset = () => setValues({});

  return (
    <CalculatorCard
      icon={HeartPulse}
      title="Монитор витальных функций"
      description="Быстрая оценка витальных показателей с классификацией нормы/патологии"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {VITAL_SIGNS_RULES.map((rule) => {
          const Icon = rule.icon;
          const assessment = assessments.find((a) => a.rule.key === rule.key);
          const status = assessment?.status ?? "empty";
          return (
            <div key={rule.key} className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                {rule.label}
                <span className="text-muted-foreground">({rule.unit})</span>
              </Label>
              <Input
                type="number"
                step={rule.key === "temp" || rule.key === "glucose" ? "0.1" : "1"}
                placeholder="—"
                value={values[rule.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [rule.key]: e.target.value }))}
                className={cn(
                  status === "normal" && "border-emerald-500/40 bg-emerald-500/5",
                  status === "abnormal" && "border-amber-500/40 bg-amber-500/5",
                  status === "critical" && "border-red-500/40 bg-red-500/5",
                )}
              />
              {assessment && assessment.status !== "empty" && (
                <div className={cn(
                  "rounded text-[10px] px-1.5 py-0.5",
                  status === "normal" && "text-emerald-700 dark:text-emerald-300",
                  status === "abnormal" && "text-amber-700 dark:text-amber-300",
                  status === "critical" && "text-red-700 dark:text-red-300 font-semibold",
                )}>
                  {assessment.guidance}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {(criticalCount > 0 || abnormalCount > 0 || normalCount > 0) && (
        <div className={cn(
          "rounded-lg border p-3",
          criticalCount > 0 ? "border-red-500/30 bg-red-500/10" : abnormalCount > 0 ? "border-amber-500/30 bg-amber-500/10" : "border-emerald-500/30 bg-emerald-500/10"
        )}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">Сводка:</span>
            {criticalCount > 0 && (
              <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300">
                <AlertOctagon className="mr-1 h-3 w-3" />
                {criticalCount} критических
              </Badge>
            )}
            {abnormalCount > 0 && (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <ShieldAlert className="mr-1 h-3 w-3" />
                {abnormalCount} отклонений
              </Badge>
            )}
            {normalCount > 0 && (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="mr-1 h-3 w-3" />
                {normalCount} в норме
              </Badge>
            )}
            {criticalCount > 0 && (
              <span className="text-xs text-red-700 dark:text-red-300 font-medium">
                ⚠ Требуется немедленное вмешательство!
              </span>
            )}
          </div>
        </div>
      )}

      <ResetButton onClick={reset} />

      {/* Reference ranges */}
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
          Нормальные значения
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          {VITAL_SIGNS_RULES.map((r) => (
            <div key={r.key} className="flex items-center gap-1">
              <span className="text-muted-foreground">{r.label}:</span>
              <span className="font-medium">{r.normal.min}–{r.normal.max} {r.unit}</span>
            </div>
          ))}
        </div>
      </div>
    </CalculatorCard>
  );
}

// ─── Symptom Checker / Differential Diagnosis Helper ──────────────────────
//
// A simple symptom-based differential diagnosis tool. The doctor selects
// symptoms from a checklist, and the tool shows matching conditions ranked
// by the number of matching symptoms. This is NOT a diagnostic tool — it's
// a reminder/checklist to help doctors consider differential diagnoses.
//
// The symptom-condition matrix is simplified for educational purposes.

interface ConditionEntry {
  name: string;
  icd10: string;
  category: string;
  symptoms: string[]; // keys from SYMPTOM_LIST
  urgency: "emergency" | "urgent" | "routine";
}

const SYMPTOM_LIST = [
  { key: "chest_pain", label: "Боль в грудной клетке" },
  { key: "dyspnea", label: "Одышка" },
  { key: "fever", label: "Лихорадка (>38°C)" },
  { key: "cough", label: "Кашель" },
  { key: "headache", label: "Головная боль" },
  { key: "abd_pain", label: "Боль в животе" },
  { key: "nausea", label: "Тошнота/рвота" },
  { key: "diarrhea", label: "Диарея" },
  { key: "fatigue", label: "Слабость/утомляемость" },
  { key: "weight_loss", label: "Потеря веса" },
  { key: "palpitations", label: "Сердцебиение" },
  { key: "syncope", label: "Обморок" },
  { key: "edema", label: "Отёки" },
  { key: "hematuria", label: "Гематурия" },
  { key: "dysuria", label: "Дизурия" },
  { key: "joint_pain", label: "Боль в суставах" },
  { key: "rash", label: "Сыпь" },
  { key: "confusion", label: "Спутанность сознания" },
  { key: "polyuria", label: "Полиурия" },
  { key: "polydipsia", label: "Полидипсия" },
];

const CONDITIONS: ConditionEntry[] = [
  {
    name: "Острый инфаркт миокарда",
    icd10: "I21",
    category: "Кардиология",
    urgency: "emergency",
    symptoms: ["chest_pain", "dyspnea", "nausea", "fatigue", "palpitations"],
  },
  {
    name: "Внебольничная пневмония",
    icd10: "J18",
    category: "Пульмонология",
    urgency: "urgent",
    symptoms: ["fever", "cough", "dyspnea", "fatigue", "chest_pain"],
  },
  {
    name: "Сахарный диабет 2 типа",
    icd10: "E11",
    category: "Эндокринология",
    urgency: "routine",
    symptoms: ["polyuria", "polydipsia", "fatigue", "weight_loss"],
  },
  {
    name: "Острый пиелонефрит",
    icd10: "N10",
    category: "Нефрология",
    urgency: "urgent",
    symptoms: ["fever", "dysuria", "abd_pain", "nausea", "hematuria"],
  },
  {
    name: "Хроническая сердечная недостаточность",
    icd10: "I50",
    category: "Кардиология",
    urgency: "urgent",
    symptoms: ["dyspnea", "edema", "fatigue", "palpitations"],
  },
  {
    name: "Фибрилляция предсердий",
    icd10: "I48",
    category: "Кардиология",
    urgency: "urgent",
    symptoms: ["palpitations", "dyspnea", "fatigue", "syncope", "chest_pain"],
  },
  {
    name: "Острый аппендицит",
    icd10: "K35",
    category: "Хирургия",
    urgency: "emergency",
    symptoms: ["abd_pain", "nausea", "fever"],
  },
  {
    name: "Инсульт",
    icd10: "I63",
    category: "Неврология",
    urgency: "emergency",
    symptoms: ["confusion", "headache", "syncope"],
  },
  {
    name: "Железодефицитная анемия",
    icd10: "D50",
    category: "Гематология",
    urgency: "routine",
    symptoms: ["fatigue", "dyspnea", "palpitations", "headache"],
  },
  {
    name: "Острая кишечная инфекция",
    icd10: "A09",
    category: "Инфекции",
    urgency: "urgent",
    symptoms: ["diarrhea", "nausea", "fever", "abd_pain"],
  },
  {
    name: "Бронхиальная астма (обострение)",
    icd10: "J45",
    category: "Пульмонология",
    urgency: "urgent",
    symptoms: ["dyspnea", "cough", "chest_pain", "fatigue"],
  },
  {
    name: "Сепсис",
    icd10: "A41",
    category: "Инфекции",
    urgency: "emergency",
    symptoms: ["fever", "confusion", "dyspnea", "fatigue", "tachycardia"],
  },
];

function SymptomChecker() {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const results = React.useMemo(() => {
    if (selected.size === 0) return [];
    return CONDITIONS
      .map((c) => {
        const matches = c.symptoms.filter((s) => selected.has(s));
        const matchScore = matches.length / c.symptoms.length;
        return { ...c, matchCount: matches.length, matchScore, matchedSymptoms: matches };
      })
      .filter((c) => c.matchCount > 0)
      .sort((a, b) => {
        // Sort by match count desc, then by matchScore desc
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
        return b.matchScore - a.matchScore;
      })
      .slice(0, 8);
  }, [selected]);

  const reset = () => setSelected(new Set());

  const urgencyConfig = {
    emergency: { label: "Экстренно", color: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300" },
    urgent: { label: "Срочно", color: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
    routine: { label: "Планово", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  };

  return (
    <CalculatorCard
      icon={Stethoscope}
      title="Дифференциальный диагноз по симптомам"
      description="Выберите симптомы — получите список вероятных состояний (справочно)"
    >
      {/* Symptom checklist */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1">
          Симптомы пациента
          <InfoTooltip text="Отметьте все присутствующие симптомы. Инструмент покажет состояния, которые могут соответствовать этим симптомам." />
        </Label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SYMPTOM_LIST.map((s) => {
            const isSelected = selected.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-all hover:shadow-sm",
                  isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors", isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30")}>
                  {isSelected && <span className="text-xs">✓</span>}
                </div>
                <span className="flex-1 text-xs">{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Выбрано симптомов: <span className="font-bold text-foreground">{selected.size}</span></span>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={reset}>
            <RotateCcw className="h-3.5 w-3.5" />Сбросить
          </Button>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Возможные состояния ({results.length}):</div>
          <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
            {results.map((c, i) => {
              const cfg = urgencyConfig[c.urgency];
              return (
                <div key={i} className={cn("rounded-lg border p-3", cfg.color)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-xs font-bold tabular-nums opacity-60">#{i + 1}</span>
                      <div>
                        <div className="font-semibold text-sm">{c.name}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 font-mono text-[10px] text-sky-700 dark:text-sky-300">
                            {c.icd10}
                          </Badge>
                          <Badge variant="outline" className={cn("text-[10px]", cfg.color)}>
                            {cfg.label}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{c.category}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold tabular-nums">{c.matchCount}/{c.symptoms.length}</div>
                      <div className="text-[10px] text-muted-foreground">{Math.round(c.matchScore * 100)}%</div>
                    </div>
                  </div>
                  {/* Match progress bar */}
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted/50">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        c.matchScore >= 0.7 ? "bg-red-500" : c.matchScore >= 0.4 ? "bg-amber-500" : "bg-sky-500",
                      )}
                      style={{ width: `${c.matchScore * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rounded-lg border bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertOctagon className="mr-1.5 inline h-3.5 w-3.5" />
            <strong>Важно:</strong> Это справочный инструмент для дифференциальной диагностики, а НЕ диагност. Окончательный диагноз ставит врач на основе полного обследования. Высокий процент совпадения не означает наличие заболевания.
          </div>
        </div>
      )}

      {selected.size > 0 && results.length === 0 && (
        <div className="rounded-lg border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
          Не найдено состояний, соответствующих выбранным симптомам.
        </div>
      )}

      {selected.size === 0 && (
        <div className="rounded-lg border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
          <Stethoscope className="mx-auto mb-2 h-8 w-8 opacity-30" />
          Отметьте симптомы выше, чтобы увидеть возможные дифференциальные диагнозы.
        </div>
      )}
    </CalculatorCard>
  );
}

// ─── Emergency Protocols Quick Reference ──────────────────────────────────
//
// A quick-reference card for emergency clinical protocols. NOT interactive —
// it's a reference tool that doctors can quickly consult during emergencies.
// Includes: ACLS cardiac arrest, sepsis bundle, stroke chain, anaphylaxis,
// status asthmaticus, DKA, hypertensive crisis.

interface EmergencyProtocol {
  name: string;
  icon: LucideIcon;
  color: "red" | "orange" | "amber" | "purple";
  timeWindow?: string;
  steps: Array<{ step: string; detail: string; drugs?: string[] }>;
  keyPoints: string[];
}

const EMERGENCY_PROTOCOLS: EmergencyProtocol[] = [
  {
    name: "Остановка кровообращения (ACLS)",
    icon: HeartPulse,
    color: "red",
    steps: [
      { step: "1. BLS", detail: "СЛР 30:2 (компрессии 100–120/мин, глубина 5–6 см). Дефибрилляция ASAP при ФП/ЖТ.", drugs: ["Адреналин 1 мг в/в каждые 3–5 мин", "Амиодарон 300 мг в/в (ЖТ/ФП)"] },
      { step: "2. Ритм", detail: "Шокируемый (ФП/ЖТ) → дефибрилляция 200 Дж бифаз. Не-шокируемый (АСЗ/ЭМД) → адреналин.", },
      { step: "3. Обратимые причины", detail: "5H: Гипоксия, Гиповолемия, Гипо/Гиперкалиемия, Гипотермия, Гипогликемия. 5T: Тампонада, ТЭЛА, Токсины, Напряжённый пневмоторакс, Тромбоз." },
    ],
    keyPoints: ["ROSC → targeted temp 32–36°C × 24ч", "Постреанимационная ЭКГ, тропонин", "Причины: 5H и 5T"],
  },
  {
    name: "Сепсис (1-hour bundle)",
    icon: ShieldAlert,
    color: "orange",
    timeWindow: "1 час",
    steps: [
      { step: "0–15 мин", detail: "Лактат, посев крови ×2, начать антибиотики широкого спектра в/в.", drugs: ["Пиперациллин/тазобактам 4.5 г в/в", "Ванкомицин 15–20 мг/кг в/в", "Меропенем 1 г в/в (при резистентности)"] },
      { step: "15–30 мин", detail: "Кристаллоиды 30 мл/кг болюс (при гипотензии или лактат ≥ 4).", drugs: ["Стерофундин / Рингер 1500–2100 мл в/в"] },
      { step: "30–60 мин", detail: "Вазопрессоры при АД < 65 после болюса. Цель: MAP ≥ 65, лактат ↓.", drugs: ["Норадреналин 0.05–0.5 мкг/кг/мин в/в", "Вазопрессин 0.03 ЕД/мин"] },
    ],
    keyPoints: ["qSOFA: ЧДД≥22, спутанность, АДсист<100", "Цели: MAP≥65, ЦВД 8–12, диурез >0.5 мл/кг/ч", "Септический шок = лактат>2 + вазопрессоры"],
  },
  {
    name: "Инсульт (chain of survival)",
    icon: Brain,
    color: "orange",
    timeWindow: "4.5 часа (тромболизис)",
    steps: [
      { step: "0–10 мин", detail: "FAST/BEFAST, NIHSS, время от последнего известного нормального (LKN).", },
      { step: "10–25 мин", detail: "КТ головного мозга (без контраста), кровь, ЭКГ, глюкоза.", },
      { step: "25–45 мин", detail: "При ишемическом инсульте + NIHSS + окно <4.5ч → тромболизис.", drugs: ["Альтеплаза 0.9 мг/кг в/в (макс 90 мг), 10% болюс за 1 мин, остальное 60 мин"] },
      { step: "45+ мин", detail: "При окклюзии крупной артерии → тромбэктомия (окно до 24ч).", },
    ],
    keyPoints: ["Время = мозг! Каждая минута = 1.9 млн нейронов", "Исключить кровоизлияние (КТ!)", "Контроль АД < 185/110 до тромболизиса"],
  },
  {
    name: "Анафилаксия",
    icon: AlertOctagon,
    color: "red",
    steps: [
      { step: "1. Стоп аллерген", detail: "Прекратить введение препарата/контакт. Уложить пациента, приподнять ноги.", },
      { step: "2. Адреналин", detail: "В/м в среднюю треть бедра (vastus lateralis). При необходимости повтор через 5–15 мин.", drugs: ["Адреналин 0.3–0.5 мг (0.3–0.5 мл 1:1000) в/м"] },
      { step: "3. Оксигенация", detail: "O₂ 10–15 л/мин маска. При бронхоспазме — сальбутамол.", drugs: ["Сальбутамол 2.5–5 мг небулайзерно"] },
      { step: "4. Инфузия", detail: "При гипотензии — кристаллоиды 1–2 л болюс.", drugs: ["Стерофундин 1000 мл в/в"] },
      { step: "5. Антигистаминные", detail: "После стабилизации — H1+H2 блокаторы + кортикостероид.", drugs: ["Дифенгидрамин 50 мг в/в", "Фамотидин 20 мг в/в", "Метилпреднизолон 125 мг в/в"] },
    ],
    keyPoints: ["Адреналин — ПЕРВЫМ, не антигистаминные!", "Повтор адреналина через 5–15 мин при отсутствии эффекта", "Наблюдение 4–6 ч (риск бифазной реакции)"],
  },
  {
    name: "Диабетический кетоацидоз (ДКА)",
    icon: Droplet,
    color: "purple",
    steps: [
      { step: "1. Гидратация", detail: "0.9% NaCl 15–20 мл/кг в первый час, затем титрование по дегидратации.", },
      { step: "2. Инсулин", detail: "В/в инфузия после начала гидратации (не раньше!)", drugs: ["Инсулин 0.1 ЕД/кг болюс, затем 0.1 ЕД/кг/ч в/в инфузия"] },
      { step: "3. Калий", detail: "При K < 3.3 — стоп инсулин, коррекция K. При 3.3–5.2 — добавить K в инфузию.", drugs: ["KCl 20–30 мЭкв/л в инфузию"] },
      { step: "4. Мониторинг", detail: "Глюкоза каждый час, электролиты/КГС каждые 2–4 ч. Цель: снижение глюкозы 3–5 ммоль/л/ч.", },
    ],
    keyPoints: ["pH < 7.3, бикарбонат < 18, кетоны, глюкоза > 11", "Не опускать глюкозу ниже 11 ммоль/л → переключить на 5% декстрозу + инсулин", "Признак разрешения: закрытие анионного интервала"],
  },
  {
    name: "Гипертонический криз",
    icon: Heart,
    color: "amber",
    steps: [
      { step: "Оценка", detail: "Криз = АД > 180/120 + ПОРАЖЕНИЕ ОРГАНОВ (головная боль, боль в груди, неврология, отёк диска, ОПН).", },
      { step: "Снижение АД", detail: "Цель: снижение на 20–25% за 1–2 ч. НЕ до нормы!", drugs: ["Лабеталол 10–20 мг в/в за 1–2 мин, повтор q10мин", "Никардипин 5 мг/ч в/в, титровать q5мин", "Урапидил 12.5–25 мг в/в"] },
    ],
    keyPoints: ["Экстренно при: расслоение аорты, отёк лёгких, эклампсия, инсульт", "НЕ снижать быстро при ишемическом инсульсте (кроме тромболизиса)", "Контроль каждые 15 мин"],
  },
];

function EmergencyProtocols() {
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const colorMap = {
    red: { border: "border-red-500/40", bg: "bg-red-500/5", badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300", icon: "text-red-600" },
    orange: { border: "border-orange-500/40", bg: "bg-orange-500/5", badge: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300", icon: "text-orange-600" },
    amber: { border: "border-amber-500/40", bg: "bg-amber-500/5", badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: "text-amber-600" },
    purple: { border: "border-violet-500/40", bg: "bg-violet-500/5", badge: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300", icon: "text-violet-600" },
  };

  return (
    <CalculatorCard
      icon={AlertOctagon}
      title="Экстренные протоколы"
      description="Быстрый справочник по неотложным состояниям (ACLS, сепсис, инсульт, анафилаксия, ДКА)"
    >
      <div className="space-y-2">
        {EMERGENCY_PROTOCOLS.map((p) => {
          const cfg = colorMap[p.color];
          const Icon = p.icon;
          const isExpanded = expanded === p.name;
          return (
            <div key={p.name} className={cn("rounded-lg border overflow-hidden transition-all", cfg.border, cfg.bg)}>
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : p.name)}
                className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent/30"
              >
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", cfg.badge)}>
                  <Icon className={cn("h-5 w-5", cfg.icon)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm">{p.name}</div>
                  {p.timeWindow && (
                    <div className="text-xs text-muted-foreground">⏱ Окно: {p.timeWindow}</div>
                  )}
                </div>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
              </button>

              {isExpanded && (
                <div className="space-y-3 border-t px-3 pb-3 pt-2">
                  {/* Steps */}
                  <div className="space-y-2">
                    {p.steps.map((s, i) => (
                      <div key={i} className="rounded border bg-card/50 p-2">
                        <div className="mb-1 flex items-center gap-2">
                          <Badge variant="outline" className={cn("text-[10px]", cfg.badge)}>{s.step}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{s.detail}</p>
                        {s.drugs && s.drugs.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {s.drugs.map((d, di) => (
                              <Badge key={di} variant="outline" className="border-primary/20 bg-primary/5 text-[10px]">
                                <Pill className="mr-1 h-2.5 w-2.5" />
                                {d}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Key points */}
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
                    <div className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-300">⚠ Ключевые моменты:</div>
                    <ul className="space-y-0.5">
                      {p.keyPoints.map((kp, i) => (
                        <li key={i} className="flex items-start gap-1 text-xs text-foreground">
                          <span className="mt-0.5 text-amber-600">•</span>
                          {kp}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border bg-red-500/5 p-3 text-xs text-red-800 dark:text-red-300">
        <AlertOctagon className="mr-1.5 inline h-3.5 w-3.5" />
        <strong>ВНИМАНИЕ:</strong> Это справочный материал для обучения и быстрого напоминания. В экстренной ситуации следуйте местным протоколам и алгоритмам вашего учреждения. Все дозы требуют верификации.
      </div>
    </CalculatorCard>
  );
}

// ─── Lab Reference Ranges ────────────────────────────────────────────────
//
// A searchable reference of common laboratory test reference ranges with
// clinical interpretation. The doctor can search for a test by name and
// immediately see the normal range, units, and what abnormal values mean.

interface LabTest {
  name: string;
  category: string;
  unit: string;
  normalRange: string;
  lowMeaning: string;
  highMeaning: string;
  criticalLow?: string;
  criticalHigh?: string;
}

const LAB_TESTS: LabTest[] = [
  // Hematology
  { name: "Гемоглобин (Hb)", category: "Гематология", unit: "г/л", normalRange: "М: 130–170, Ж: 120–150", lowMeaning: "Анемия (кровотечение, дефицит Fe/B12/фолата)", highMeaning: "Полицитемия, дегидратация, ХОБЛ", criticalLow: "< 70 — transfusion", criticalHigh: "> 200 — гипервязкость" },
  { name: "Лейкоциты (WBC)", category: "Гематология", unit: "×10⁹/л", normalRange: "4.0–9.0", lowMeaning: "Лейкопения (вирусная инфекция, цитостатики)", highMeaning: "Лейкоцитоз (бактериальная инфекция, лейкоз)", criticalLow: "< 2.0 — нейтропения", criticalHigh: "> 30.0 — лейкемоидная реакция" },
  { name: "Тромбоциты (PLT)", category: "Гематология", unit: "×10⁹/л", normalRange: "150–400", lowMeaning: "Тромбоцитопения (ДВС, гепарин, ITP)", highMeaning: "Тромбоцитоз (реактивный, миелопролиферативный)", criticalLow: "< 50 — риск кровотечения", criticalHigh: "> 1000 — тромбоз" },
  { name: "СОЭ", category: "Гематология", unit: "мм/ч", normalRange: "М: <15, Ж: <20", lowMeaning: "Полицитемия", highMeaning: "Воспаление, инфекция, опухоль" },
  { name: "МНО (INR)", category: "Коагулология", unit: "—", normalRange: "0.8–1.2 (терапия 2.0–3.0)", lowMeaning: "Гиперкоагуляция", highMeaning: "Гипокоагуляция (передозировка антикоагулянтов)", criticalHigh: "> 5.0 — риск кровотечения" },

  // Biochemistry
  { name: "Глюкоза", category: "Биохимия", unit: "ммоль/л", normalRange: "3.9–6.1 (натощак)", lowMeaning: "Гипогликемия (< 3.0 — симптоматическая)", highMeaning: "Гипергликемия (СД: ≥ 7.0 натощак)", criticalLow: "< 2.2 — кома", criticalHigh: "> 33 — ДКА/ГГС" },
  { name: "Креатинин", category: "Биохимия", unit: "мкмоль/л", normalRange: "М: 70–110, Ж: 50–90", lowMeaning: "Низкая мышечная масса", highMeaning: "Почечная недостаточность (рассчитать eGFR!)" },
  { name: "Мочевина", category: "Биохимия", unit: "ммоль/л", normalRange: "2.8–7.2", lowMeaning: "Печёночная недостаточность, голодание", highMeaning: "Почечная недостаточность, дегидратация, кровотечение ЖКТ" },
  { name: "АЛТ (ALT)", category: "Биохимия", unit: "Ед/л", normalRange: "< 40", lowMeaning: "—", highMeaning: "Гепатоцеллюлярное повреждение (гепатит, лекарства)", criticalHigh: "> 1000 — острый гепатит" },
  { name: "АСТ (AST)", category: "Биохимия", unit: "Ед/л", normalRange: "< 40", lowMeaning: "—", highMeaning: "Печень, сердце (ИМ), мышцы" },
  { name: "Билирубин общий", category: "Биохимия", unit: "мкмоль/л", normalRange: "3.4–20.5", lowMeaning: "—", highMeaning: "Желтуха (гемолиз, печень, холестаз)", criticalHigh: "> 300 — энцефалопатия" },
  { name: "Общий белок", category: "Биохимия", unit: "г/л", normalRange: "65–85", lowMeaning: "Гипопротеинемия (печень, нефроз, голодание)", highMeaning: "Гиперпротеинемия (миелома, дегидратация)" },
  { name: "Альбумин", category: "Биохимия", unit: "г/л", normalRange: "35–50", lowMeaning: "Гипоальбуминемия (печень, нефроз, воспаление)", highMeaning: "Дегидратация" },
  { name: "Калий (K⁺)", category: "Электролиты", unit: "ммоль/л", normalRange: "3.5–5.1", lowMeaning: "Гипокалиемия (диуретики, рвота)", highMeaning: "Гиперкалиемия (ОПН, ACE-i, K-сберегающие)", criticalLow: "< 2.5 — аритмия", criticalHigh: "> 6.5 — остановка сердца" },
  { name: "Натрий (Na⁺)", category: "Электролиты", unit: "ммоль/л", normalRange: "136–145", lowMeaning: "Гипонатриемия (СНДВАД, передозировка воды)", highMeaning: "Гипернатриемия (дегидратация, несахарный Д)", criticalLow: "< 120 — судороги", criticalHigh: "> 160 — кома" },
  { name: "Хлор (Cl⁻)", category: "Электролиты", unit: "ммоль/л", normalRange: "98–107", lowMeaning: "Гипохлоремия (рвота, диуретики)", highMeaning: "Гиперхлоремия (дегидратация, почечный канальцевый ацидоз)" },
  { name: "Кальций общий", category: "Электролиты", unit: "ммоль/л", normalRange: "2.15–2.55", lowMeaning: "Гипокальциемия (гипопаратиреоз, витамин D)", highMeaning: "Гиперкальциемия (гиперпаратиреоз, опухоль)", criticalHigh: "> 3.5 — кома" },
  { name: "Фосфор", category: "Электролиты", unit: "ммоль/л", normalRange: "0.81–1.45", lowMeaning: "Гипофосфатемия (синдром возобновления питания)", highMeaning: "Гиперфосфатемия (ОПН, опухолевый лизис)" },
  { name: "Магний (Mg²⁺)", category: "Электролиты", unit: "ммоль/л", normalRange: "0.75–1.05", lowMeaning: "Гипомагниемия (диуретики, алкоголизм)", highMeaning: "Гипермагниемия (почечная недостаточность)" },

  // Lipids
  { name: "Холестерин общий", category: "Липиды", unit: "ммоль/л", normalRange: "< 5.0", lowMeaning: "—", highMeaning: "Гиперхолестеринемия (атеросклероз)" },
  { name: "ЛПНП", category: "Липиды", unit: "ммоль/л", normalRange: "< 3.0 (цель < 1.4 при ССЗ)", lowMeaning: "—", highMeaning: "Высокий сердечно-сосудистый риск" },
  { name: "ЛПВП", category: "Липиды", unit: "ммоль/л", normalRange: "М: > 1.0, Ж: > 1.2", lowMeaning: "Низкий ЛПВП (повышенный риск ССЗ)", highMeaning: "— (защитный)" },
  { name: "Триглицериды", category: "Липиды", unit: "ммоль/л", normalRange: "< 1.7", lowMeaning: "—", highMeaning: "Гипертриглицеридемия (панкреатит при > 11)" },

  // Cardiac / Inflammation
  { name: "Тропонин I/T", category: "Кардио", unit: "нг/мл", normalRange: "< 0.04", lowMeaning: "—", highMeaning: "Миокардиальное повреждение (ИМ, миокардит)", criticalHigh: "> 0.40 — ОИМ" },
  { name: "BNP / NT-proBNP", category: "Кардио", unit: "пг/мл", normalRange: "BNP < 100, NT-proBNP < 125", lowMeaning: "— (исключает ХСН)", highMeaning: "Сердечная недостаточность (> 400 вероятна ХСН)" },
  { name: "СРБ (CRP)", category: "Воспаление", unit: "мг/л", normalRange: "< 5.0", lowMeaning: "—", highMeaning: "Воспаление/инфекция (бакт. > вирусн.)", criticalHigh: "> 100 — тяжёлая инфекция/сепсис" },
  { name: "Прокальцитонин", category: "Воспаление", unit: "нг/мл", normalRange: "< 0.1", lowMeaning: "—", highMeaning: "Бактериальная инфекция/сепсис (> 0.5)", criticalHigh: "> 2 — сепсис" },
  { name: "Лактат", category: "Воспаление", unit: "ммоль/л", normalRange: "0.5–2.0", lowMeaning: "—", highMeaning: "Гипоперфузия, сепсис, шок", criticalHigh: "> 4 — септический шок" },

  // Endocrine
  { name: "TSH", category: "Эндокринология", unit: "мЕд/л", normalRange: "0.4–4.0", lowMeaning: "Гипертиреоз", highMeaning: "Гипотиреоз" },
  { name: "HbA1c", category: "Эндокринология", unit: "%", normalRange: "< 5.7", lowMeaning: "—", highMeaning: "СД: ≥ 6.5; предиабет: 5.7–6.4" },
  { name: "Кортизол (утро)", category: "Эндокринология", unit: "нмоль/л", normalRange: "138–690", lowMeaning: "Надпочечниковая недостаточность", highMeaning: "Синдром Кушинга" },

  // Coagulation
  { name: "Фибриноген", category: "Коагулология", unit: "г/л", normalRange: "2.0–4.0", lowMeaning: "ДВС, печёночная недостаточность", highMeaning: "Воспаление, беременность, тромбоз" },
  { name: "АЧТВ", category: "Коагулология", unit: "сек", normalRange: "25–35", lowMeaning: "Гиперкоагуляция", highMeaning: "Гепарин, гемофилия, ДВС" },
];

function LabReferenceRanges() {
  const [search, setSearch] = React.useState("");
  const [activeCategory, setActiveCategory] = React.useState<string>("all");

  const categories = React.useMemo(() => {
    const set = new Set<string>();
    LAB_TESTS.forEach((t) => set.add(t.category));
    return Array.from(set);
  }, []);

  const filtered = React.useMemo(() => {
    return LAB_TESTS.filter((t) => {
      if (activeCategory !== "all" && t.category !== activeCategory) return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q);
      }
      return true;
    });
  }, [search, activeCategory]);

  return (
    <CalculatorCard
      icon={FlaskConical}
      title="Лабораторные референсные значения"
      description="Нормальные значения и интерпретация отклонений для основных лабораторных тестов"
    >
      {/* Search + filter */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Поиск анализа…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={activeCategory} onValueChange={setActiveCategory}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все категории</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      <div className="text-xs text-muted-foreground">
        Найдено: <span className="font-bold text-foreground">{filtered.length}</span> из {LAB_TESTS.length}
      </div>

      {/* Lab test cards */}
      <div className="max-h-[600px] space-y-2 overflow-y-auto pr-1">
        {filtered.map((t, i) => (
          <div key={i} className="rounded-lg border p-3 transition-all hover:shadow-md">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{t.name}</span>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">{t.category}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Норма:</span>
                  <span className="font-mono font-medium text-emerald-700 dark:text-emerald-400">{t.normalRange}</span>
                  <span className="text-muted-foreground">{t.unit}</span>
                </div>
              </div>
            </div>
            <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
              <div className="rounded border border-sky-500/20 bg-sky-500/5 p-1.5">
                <span className="font-medium text-sky-700 dark:text-sky-300">↓ Снижен:</span>{" "}
                <span className="text-muted-foreground">{t.lowMeaning}</span>
              </div>
              <div className="rounded border border-amber-500/20 bg-amber-500/5 p-1.5">
                <span className="font-medium text-amber-700 dark:text-amber-300">↑ Повышен:</span>{" "}
                <span className="text-muted-foreground">{t.highMeaning}</span>
              </div>
            </div>
            {(t.criticalLow || t.criticalHigh) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {t.criticalLow && (
                  <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-[10px] text-red-700 dark:text-red-300">
                    <AlertOctagon className="mr-1 h-2.5 w-2.5" />
                    Крит. низко: {t.criticalLow}
                  </Badge>
                )}
                {t.criticalHigh && (
                  <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-[10px] text-red-700 dark:text-red-300">
                    <AlertOctagon className="mr-1 h-2.5 w-2.5" />
                    Крит. высоко: {t.criticalHigh}
                  </Badge>
                )}
              </div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <FlaskConical className="mx-auto mb-2 h-8 w-8 opacity-30" />
            Не найдено анализов по запросу.
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mr-1.5 inline h-3.5 w-3.5" />
        Референсные значения могут отличаться в зависимости от лаборатории и методики. Всегда сверяйтесь с диапазоном, указанным на бланке анализа.
      </div>
    </CalculatorCard>
  );
}
