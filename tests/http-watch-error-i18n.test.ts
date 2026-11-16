import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import en from '../src/renderer/i18n/locales/en.json';
import zh from '../src/renderer/i18n/locales/zh.json';
import { HTTP_WATCH_ERROR_TRANSLATIONS } from '../src/shared/schedule/http-watch-errors';
import { localizeWatchConfigError } from '../src/shared/schedule/local-watch-task';
import { normalizeWatchConfig } from '../src/shared/schedule/watch-task';
import {
  HttpConditionCheckError,
  HTTP_CONDITION_CHECK_ERROR_CODES,
} from '../src/main/schedule/http-condition-checker';

async function translator(language: 'en' | 'zh') {
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    fallbackLng: false,
    resources: { en: { translation: en }, zh: { translation: zh } },
  });
  return (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
}

describe('HTTP watch error localization', () => {
  it.each([
    ['not-a-url', '请输入有效的 HTTP 或 HTTPS 地址。'],
    ['ftp://example.com/status', '监测地址必须使用 HTTP 或 HTTPS 协议。'],
  ])(
    'localizes the actual URL validation failure for %s through the IPC wrapper',
    async (url, expected) => {
      let message = '';
      try {
        normalizeWatchConfig({ checkType: 'http', compareMode: 'status', checkConfig: { url } });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe('');
      expect(
        localizeWatchConfigError(
          `Error invoking remote method 'schedule.create': Error: ${message}`,
          await translator('zh')
        )
      ).toBe(expected);
      expect(
        localizeWatchConfigError(
          `Error invoking remote method 'schedule.create': WatchConfigValidationError: ${message}`,
          await translator('zh')
        )
      ).toBe(expected);
    }
  );

  it.each([
    ['timeout', 'HTTP 条件检查超时。'],
    ['response_body_too_large', 'HTTP 响应正文超过了 1 MiB 的限制。'],
    ['redirect_protocol_unsupported', '已拒绝 HTTP 重定向：目标地址未使用 HTTP 或 HTTPS 协议。'],
  ] as const)('localizes the checker failure %s shown in lastError', async (code, expected) => {
    const message = new HttpConditionCheckError(code).message;
    expect(localizeWatchConfigError(message, await translator('zh'))).toBe(expected);
  });

  it('defines both locale strings for every mapped validation and check error', async () => {
    const english = await translator('en');
    const chinese = await translator('zh');
    for (const [message, key] of Object.entries(HTTP_WATCH_ERROR_TRANSLATIONS)) {
      expect(english(key)).not.toBe(key);
      expect(chinese(key)).not.toBe(key);
      expect(chinese(key)).toMatch(/[\u4e00-\u9fff]/);
      expect(localizeWatchConfigError(message, english)).toBe(english(key));
      expect(localizeWatchConfigError(message, chinese)).toBe(chinese(key));
    }
    for (const code of Object.values(HTTP_CONDITION_CHECK_ERROR_CODES)) {
      const message = new HttpConditionCheckError(code).message;
      expect(localizeWatchConfigError(message, chinese)).not.toBe(message);
    }
  });

  it('leaves unknown errors intact so useful diagnostics are retained', async () => {
    expect(
      localizeWatchConfigError('Unrecognized task execution error.', await translator('zh'))
    ).toBe('Unrecognized task execution error.');
  });
});
