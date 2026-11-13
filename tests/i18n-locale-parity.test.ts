/**
 * Paridade dos catálogos de i18n.
 *
 * O app suporta en / zh / pt-BR. Um catálogo incompleto não quebra o app —
 * o i18next cai para `fallbackLng: 'en'` — mas produz uma **UI bilíngue
 * inconsistente**: metade em português, metade em inglês, sem erro visível.
 * Esse foi exatamente o defeito do catálogo pt-BR (50/996 chaves) com o
 * `convertDetectedLanguage` mapeando qualquer variante `pt*` para `pt-BR`.
 *
 * A guarda é de **paridade de chaves**, não de tradução: qualquer idioma novo
 * ou qualquer chave nova em `en` quebra o build até que o catálogo seja
 * atualizado. Isso impede a regressão silenciosa.
 */
import { describe, it, expect } from 'vitest';
import en from '../src/renderer/i18n/locales/en.json';
import zh from '../src/renderer/i18n/locales/zh.json';
import ptBR from '../src/renderer/i18n/locales/pt-BR.json';

/** Achata o JSON aninhado em um mapa `a.b.c` -> string. */
function flatten(source: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return out;
  }
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of flatten(value, path)) {
        out.set(nestedKey, nestedValue);
      }
    } else {
      out.set(path, typeof value === 'string' ? value : String(value));
    }
  }
  return out;
}

const locales = {
  en: flatten(en),
  zh: flatten(zh),
  'pt-BR': flatten(ptBR),
};

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function placeholdersOf(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();
}

describe('i18n locale parity', () => {
  it('tem as mesmas chaves em todos os idiomas suportados', () => {
    const reference = [...locales.en.keys()].sort();

    for (const [name, catalog] of Object.entries(locales)) {
      const keys = [...catalog.keys()].sort();
      const missing = reference.filter((key) => !catalog.has(key));
      const extra = keys.filter((key) => !locales.en.has(key));

      expect({ locale: name, missing, extra }).toEqual({
        locale: name,
        missing: [],
        extra: [],
      });
    }
  });

  it('não deixa valores vazios onde o inglês tem texto', () => {
    for (const [name, catalog] of Object.entries(locales)) {
      const empty = [...catalog.entries()]
        .filter(([key, value]) => {
          // Um valor vazio só é aceitável quando o inglês também é vazio
          // (ex.: `remote.ngrokHelpSuffix`, que faz par com um prefixo).
          return value.trim() === '' && locales.en.get(key)?.trim() !== '';
        })
        .map(([key]) => key);

      expect({ locale: name, empty }).toEqual({ locale: name, empty: [] });
    }
  });

  it('mantém os mesmos placeholders de interpolação do inglês', () => {
    for (const [name, catalog] of Object.entries(locales)) {
      const mismatched = [...catalog.entries()]
        .filter(([key, value]) => {
          const expected = placeholdersOf(locales.en.get(key) ?? '');
          const actual = placeholdersOf(value);
          return expected.join(',') !== actual.join(',');
        })
        .map(([key, value]) => ({
          key,
          expected: placeholdersOf(locales.en.get(key) ?? ''),
          actual: placeholdersOf(value),
        }));

      expect({ locale: name, mismatched }).toEqual({ locale: name, mismatched: [] });
    }
  });

  it('traduz o catálogo pt-BR em vez de copiar o inglês', () => {
    // Nomes próprios e tokens técnicos onde o valor em pt-BR é
    // intencionalmente igual ao inglês. Cada entrada aqui precisa ser um
    // termo que NÃO se traduz (marca, protocolo, rótulo de API).
    const technicalAllowlist = new Set([
      'settings.experimental', // "Experimental" é a mesma palavra em pt-BR
      'mcp.namePlaceholder', // "Chrome MCP Server" — nome próprio
      'mcp.typeStreamableHttp', // "HTTP (Streamable)" — nome de protocolo
      'remote.slackBotToken', // "Bot User OAuth Token" — nome da credencial Slack
      'remote.verificationToken', // "Verification Token" — nome da credencial Feishu
    ]);

    const untranslated = [...locales['pt-BR'].entries()]
      .filter(([key, value]) => {
        const english = locales.en.get(key) ?? '';
        if (!english.trim() || english.length < 12) return false;
        if (value !== english) return false;
        // Interpolações, URLs e placeholders de comando são idênticos por
        // natureza — não são evidência de chave não traduzida.
        if (value.includes('{{') || /https?:\/\//i.test(value)) return false;
        return !technicalAllowlist.has(key);
      })
      .map(([key]) => key);

    expect(untranslated).toEqual([]);
  });
});
