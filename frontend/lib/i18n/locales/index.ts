/**
 * Barrel for all locale translation files.
 *
 * When adding a new language:
 *   1. Add the entry to lib/i18n/supported-languages.ts
 *   2. Create the locale JSON file (e.g. fr.json)
 *   3. Add an import + entry here
 *
 * config.ts iterates this object to build the i18next resources map,
 * so no further changes are needed there.
 */
import enUS from './en-US.json';

import type { Language } from '../supported-languages';

export const locales: Record<Language, unknown> = {
  'en-US': enUS,
};
