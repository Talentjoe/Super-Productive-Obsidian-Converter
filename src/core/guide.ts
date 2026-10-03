import guide from '../../docs/AI-GUIDE.md?raw';
import englishGuide from '../../docs/AI-GUIDE.en.md?raw';
import type { SyncLanguage } from '../types';
export const getGuide = (language?: SyncLanguage): string => language === 'en' ? englishGuide : guide;
export { guide };
