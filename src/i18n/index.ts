import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { getGuildLanguage, type GuildLanguage } from '../services/guildSettingsService.js';

type Vars = Record<string, string | number>;
type TranslationMap = Record<string, string>;

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadJson(fileName: string): TranslationMap {
  const localPath = join(__dirname, fileName);
  try {
    return JSON.parse(readFileSync(localPath, 'utf8')) as TranslationMap;
  } catch {
    const fallbackPath = join(process.cwd(), 'src', 'i18n', fileName);
    try {
      return JSON.parse(readFileSync(fallbackPath, 'utf8')) as TranslationMap;
    } catch (error) {
      console.warn(`[i18n] Missing translation file: ${fileName}`, error);
      return {};
    }
  }
}

const en = loadJson('en.json');
const pt = loadJson('pt.json');

const resources: Record<GuildLanguage, TranslationMap> = { en, pt };

const DEFAULT_LANGUAGE: GuildLanguage = 'en';

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = vars[key];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

export function tLang(lang: GuildLanguage, key: string, vars?: Vars): string {
  const catalog = resources[lang] ?? resources[DEFAULT_LANGUAGE];
  const fallback = resources[DEFAULT_LANGUAGE];
  const template = catalog[key] ?? fallback[key] ?? key;
  return interpolate(template, vars);
}

export function t(guildId: string | null | undefined, key: string, vars?: Vars): string {
  const lang = getGuildLanguage(guildId);
  return tLang(lang, key, vars);
}

export function getTranslator(guildId: string | null | undefined): (key: string, vars?: Vars) => string {
  const lang = getGuildLanguage(guildId);
  return (key: string, vars?: Vars) => tLang(lang, key, vars);
}

export function getLocalized(key: string, vars?: Vars): Record<string, string> {
  return {
    'en-US': tLang('en', key, vars),
    'pt-BR': tLang('pt', key, vars),
  };
}
