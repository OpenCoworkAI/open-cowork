import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_SUBAGENT_CONFIG, type SubagentConfig } from '../src/shared/subagent-config';

const mocks = vi.hoisted(() => ({ config: {} as SubagentConfig }));
vi.mock('../src/renderer/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ appConfig: { subagent: mocks.config }, setAppConfig: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { agents?: string }) => values?.agents ?? key,
  }),
}));

import { SettingsSubagents } from '../src/renderer/components/settings/SettingsSubagents';

beforeEach(() => {
  mocks.config = structuredClone(DEFAULT_SUBAGENT_CONFIG);
});

describe('subagent settings validation', () => {
  it.each([NaN, 0, 9, 1.5])('marks invalid concurrency %s and disables save', (value) => {
    mocks.config.maxConcurrent = value;
    const html = renderToStaticMarkup(createElement(SettingsSubagents));
    expect(html).toContain('aria-describedby="subagent-concurrency-error"');
    expect(html).toContain('subagentSettings.concurrencyInvalid');
    expect(html).toMatch(/<button disabled=""[^>]*>.*subagentSettings.save<\/button>/s);
    if (Number.isNaN(value)) expect(html).toMatch(/type="number"[^>]*value=""/);
  });

  it.each(['', '   '])('marks empty role instructions %j and disables save', (prompt) => {
    mocks.config.presets[0].prompt = prompt;
    const html = renderToStaticMarkup(createElement(SettingsSubagents));
    expect(html).toContain('aria-describedby="subagent-instructions-error"');
    expect(html).toContain('subagentSettings.instructionsRequired');
    expect(html).toMatch(/<button disabled=""[^>]*>.*subagentSettings.save<\/button>/s);
  });

  it('keeps missing instructions visible for an unselected role', () => {
    mocks.config.presets[1].prompt = '';
    const html = renderToStaticMarkup(createElement(SettingsSubagents));
    expect(html).toMatch(/<p role="alert"[^>]*>researcher<\/p>/);
    expect(html).toMatch(/<button disabled=""[^>]*>.*subagentSettings.save<\/button>/s);
  });

  it.each([1, 8])('allows valid settings at concurrency boundary %s', (value) => {
    mocks.config.maxConcurrent = value;
    const html = renderToStaticMarkup(createElement(SettingsSubagents));
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('disabled=""');
  });
});
