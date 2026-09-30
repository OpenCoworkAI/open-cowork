import { describe, expect, it } from 'vitest';

import en from '../../renderer/i18n/locales/en.json';
import zh from '../../renderer/i18n/locales/zh.json';
import es from '../../renderer/i18n/locales/es.json';
import fr from '../../renderer/i18n/locales/fr.json';
import de from '../../renderer/i18n/locales/de.json';
import itLocale from '../../renderer/i18n/locales/it.json';
import uk from '../../renderer/i18n/locales/uk.json';
import pl from '../../renderer/i18n/locales/pl.json';
import sv from '../../renderer/i18n/locales/sv.json';
import no from '../../renderer/i18n/locales/no.json';
import nl from '../../renderer/i18n/locales/nl.json';
import ro from '../../renderer/i18n/locales/ro.json';

type JsonObject = Record<string, unknown>;

/** Collect the dotted paths of every leaf value in a locale object. */
function flattenKeys(obj: JsonObject, prefix = '', out: string[] = []): string[] {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenKeys(value as JsonObject, path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

const enKeys = new Set(flattenKeys(en as unknown as JsonObject));

// en.json is the source of truth; every other locale must match it exactly so
// no UI string silently goes untranslated (or a stale key lingers) after edits.
const locales: Record<string, JsonObject> = {
  zh: zh as unknown as JsonObject,
  es: es as unknown as JsonObject,
  fr: fr as unknown as JsonObject,
  de: de as unknown as JsonObject,
  it: itLocale as unknown as JsonObject,
  uk: uk as unknown as JsonObject,
  pl: pl as unknown as JsonObject,
  sv: sv as unknown as JsonObject,
  no: no as unknown as JsonObject,
  nl: nl as unknown as JsonObject,
  ro: ro as unknown as JsonObject,
};

describe('locale key parity', () => {
  for (const [code, data] of Object.entries(locales)) {
    it(`${code}.json has exactly the same keys as en.json`, () => {
      const keys = new Set(flattenKeys(data));
      const missing = [...enKeys].filter((key) => !keys.has(key));
      const extra = [...keys].filter((key) => !enKeys.has(key));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });
  }
});
