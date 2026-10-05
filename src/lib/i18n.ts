// СППВР — Internationalization (i18n) System
// Supports Russian (default) and English
// Lightweight client-side translation system

export type Locale = "ru" | "en";

export interface TranslationStrings {
  [key: string]: string | TranslationStrings;
}

// Import translations
import { ru } from "./translations/ru";
import { en } from "./translations/en";

const translations: Record<Locale, TranslationStrings> = { ru, en };

/**
 * Get a nested value from an object using a dot-notation path
 */
function getNestedValue(obj: TranslationStrings, path: string): string | undefined {
  const keys = path.split(".");
  let current: TranslationStrings | string = obj;

  for (const key of keys) {
    if (typeof current === "string") return undefined;
    current = current[key];
    if (current === undefined) return undefined;
  }

  return typeof current === "string" ? current : undefined;
}

/**
 * Translate a key to the current locale
 * @param key - Dot-notation key, e.g. "app.title"
 * @param locale - Target locale
 * @param params - Optional interpolation parameters, e.g. { count: 5 }
 * @returns Translated string
 */
export function t(key: string, locale: Locale = "ru", params?: Record<string, string | number>): string {
  let value = getNestedValue(translations[locale], key);

  // Fallback to Russian if key not found in target locale
  if (!value && locale !== "ru") {
    value = getNestedValue(translations.ru, key);
  }

  // Return the key itself if no translation found
  if (!value) {
    return key;
  }

  // Interpolate parameters
  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${paramKey}\\}`, "g"), String(paramValue));
    }
  }

  return value;
}

/**
 * Get all available locales
 */
export function getAvailableLocales(): Array<{ code: Locale; name: string; nativeName: string }> {
  return [
    { code: "ru", name: "Russian", nativeName: "Русский" },
    { code: "en", name: "English", nativeName: "English" },
  ];
}

/**
 * Get the translation map for a locale
 */
export function getTranslations(locale: Locale): TranslationStrings {
  return translations[locale];
}
