import { useTranslation } from 'react-i18next';
import type { LocalWatchConfig } from '../../../shared/schedule/local-watch-task';

export function ScheduleConditionFields({
  value,
  error,
  onChange,
}: {
  value: LocalWatchConfig | null;
  error?: string | null;
  onChange: (value: LocalWatchConfig | null) => void;
}) {
  const { t } = useTranslation();
  const fieldClass = 'w-full px-3 py-2 rounded-lg bg-background border border-border text-sm';
  const timeout =
    value?.checkType === 'command' ? (value.checkConfig.timeoutMs ?? 10000) / 1000 : 10;
  const timeoutValid = Number.isInteger(timeout) && timeout >= 1 && timeout <= 30;
  return (
    <div className="border-t border-border pt-3 space-y-2">
      <label className="block text-sm space-y-1">
        <span>{t('schedule.watchCondition')}</span>
        <select
          aria-label={t('schedule.watchCondition')}
          className={fieldClass}
          value={value?.checkType ?? 'none'}
          onChange={(event) => {
            onChange(
              event.target.value === 'file'
                ? { checkType: 'file', compareMode: 'content', checkConfig: { path: '' } }
                : event.target.value === 'command'
                  ? {
                      checkType: 'command',
                      compareMode: 'output',
                      checkConfig: { command: '', timeoutMs: 10000 },
                    }
                  : null
            );
          }}
        >
          <option value="none">{t('schedule.watchNone')}</option>
          <option value="file">{t('schedule.watchFile')}</option>
          <option value="command">{t('schedule.watchCommand')}</option>
        </select>
      </label>
      {error && <div className="text-xs text-error break-words">{error}</div>}
      {value?.checkType === 'file' && (
        <label className="block text-sm space-y-1">
          <span>{t('schedule.watchPath')}</span>
          <input
            aria-label={t('schedule.watchPath')}
            className={fieldClass}
            value={value.checkConfig.path}
            onChange={(event) => onChange({ ...value, checkConfig: { path: event.target.value } })}
          />
        </label>
      )}
      {value?.checkType === 'command' && (
        <>
          <label className="block text-sm space-y-1">
            <span>{t('schedule.watchShellCommand')}</span>
            <textarea
              aria-label={t('schedule.watchShellCommand')}
              className={fieldClass}
              rows={2}
              value={value.checkConfig.command}
              onChange={(event) =>
                onChange({
                  ...value,
                  checkConfig: { ...value.checkConfig, command: event.target.value },
                })
              }
            />
          </label>
          <label className="block text-sm space-y-1">
            <span>{t('schedule.watchTimeout')}</span>
            <input
              aria-label={t('schedule.watchTimeout')}
              className={fieldClass}
              type="number"
              min={1}
              max={30}
              required
              aria-invalid={!timeoutValid}
              aria-describedby={!timeoutValid ? 'watch-timeout-error' : undefined}
              value={Number.isFinite(timeout) ? timeout : ''}
              onChange={(event) =>
                onChange({
                  ...value,
                  checkConfig: {
                    ...value.checkConfig,
                    timeoutMs: event.target.value === '' ? NaN : Number(event.target.value) * 1000,
                  },
                })
              }
            />
            {!timeoutValid && (
              <span id="watch-timeout-error" role="alert" className="block text-xs text-error">
                {t('schedule.watchTimeoutInvalid')}
              </span>
            )}
          </label>
        </>
      )}
    </div>
  );
}
