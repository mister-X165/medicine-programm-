// СППВР — русская плюрализация для пользовательских подписей.
// ============================================================================
// В интерфейсе и в тексте замечаний постоянно встречаются счётные формы:
// «1 гипотеза / 2 гипотезы / 5 гипотез», «3 опции / 5 опций». Склонение
// вынесено в одну функцию, чтобы не плодить «гипотез(ы)» и «опций» в тексте,
// который читает врач.
// ============================================================================

/**
 * Выбирает форму существительного по числу.
 *
 * @param n число
 * @param forms [единственное, 2–4, 5+]
 */
export function pluralRu(
  n: number,
  forms: [one: string, few: string, many: string],
): string {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** «N гипотеза/гипотезы/гипотез» с числом. */
export function hypothesesLabel(n: number): string {
  return `${n} ${pluralRu(n, ["гипотеза", "гипотезы", "гипотез"])}`;
}

/** Родительный падеж: «у N гипотезы/гипотез». */
export function hypothesesGenitive(n: number): string {
  return `${n} ${pluralRu(n, ["гипотезы", "гипотез", "гипотез"])}`;
}

/** «N исследование/исследования/исследований» в родительном падеже. */
export function studiesGenitive(n: number): string {
  return `${n} ${pluralRu(n, ["исследования", "исследований", "исследований"])}`;
}

/** «N опция/опции/опций». */
export function therapyOptionsLabel(n: number): string {
  return `${n} ${pluralRu(n, ["опция", "опции", "опций"])}`;
}

/** «N проход/прохода/проходов». */
export function passesLabel(n: number): string {
  return `${n} ${pluralRu(n, ["проход", "прохода", "проходов"])}`;
}
