import type { SyncLanguage } from './types';
import { messages, messageTemplates } from './locales/en';

export const languageOf = (language?: SyncLanguage): SyncLanguage => language === 'en' ? 'en' : 'zh';
export const noteLabel = (language?: SyncLanguage): string => languageOf(language) === 'en' ? 'notes' : '笔记';
export const localeOf = (language?: SyncLanguage): string => languageOf(language) === 'en' ? 'en-US' : 'zh-CN';
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = messageTemplates.map(([source, target]) => {
  const keys: string[] = [];
  const parts = source.split(/(\{[a-z]+\})/g);
  const pattern = new RegExp('^' + parts.map(part => {
    if (!/^\{[a-z]+\}$/.test(part)) return escapePattern(part);
    keys.push(part.slice(1, -1)); return '([\\s\\S]*)';
  }).join('') + '$');
  return { pattern, keys, target };
});

/** Translate plugin messages only. Captured titles, paths and values remain literal. */
export function translate(text: string, language?: SyncLanguage): string {
  if (languageOf(language) === 'zh') return text;
  if (Object.hasOwn(messages, text)) return messages[text];
  for (const { pattern, keys, target } of templates) {
    const match = pattern.exec(text); if (!match) continue;
    const values = Object.fromEntries(keys.map((key, index) => [key, key === 'error' ? translate(match[index + 1], language) : match[index + 1]]));
    return target.replace(/\{([a-z]+)\}/g, (_, key: string) => values[key]);
  }
  // Host/OS errors may already be English. Do not rewrite unknown content.
  return text;
}
