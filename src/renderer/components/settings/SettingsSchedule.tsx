import { useState, useEffect, useCallback, useRef } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle, ChevronDown, Plus, X, Check } from 'lucide-react';
import type {
  ScheduleConfig,
  ScheduleTask,
  ScheduleRepeatUnit,
  ScheduleWeekday,
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from '../../types';
import { useAppStore } from '../../store';
import { formatAppDateTime, joinAppList } from '../../utils/i18n-format';
import { renderLocalizedBannerMessage, getWeekdayOptions, getScheduleModeOptions } from './shared';
import type { LocalizedBanner, ScheduleFormMode } from './shared';
import {
  isLocalWatchConditionComplete,
  isLocalWatchTimeoutValid,
  localizeWatchConfigError,
  type LocalWatchConfig,
} from '../../../shared/schedule/local-watch-task';
import { watchConfigForTaskUpdate } from '../../../shared/schedule/watch-config-update';
import { ScheduleConditionFields } from './ScheduleConditionFields';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const SCHEDULE_TIME_SUGGESTIONS = [
  '06:00',
  '07:30',
  '08:00',
  '09:00',
  '10:30',
  '12:00',
  '14:00',
  '15:30',
  '18:00',
  '19:30',
  '21:00',
  '22:30',
];

export function SettingsSchedule({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();
  const workingDir = useAppStore((state) => state.workingDir);
  const sessions = useAppStore((state) => state.sessions);
  const [tasks, setTasks] = useState<ScheduleTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTaskSnapshot, setEditingTaskSnapshot] = useState<ScheduleTask | null>(null);
  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState('');
  const [runAt, setRunAt] = useState('');
  const [scheduleMode, setScheduleMode] = useState<ScheduleFormMode>('once');
  const [selectedTimes, setSelectedTimes] = useState<string[]>(['08:00']);
  const [selectedWeekdays, setSelectedWeekdays] = useState<ScheduleWeekday[]>([1]);
  const [enabled, setEnabled] = useState(true);
  const [repeatEvery, setRepeatEvery] = useState(1);
  const [repeatUnit, setRepeatUnit] = useState<ScheduleRepeatUnit>('day');
  const [watchConfig, setWatchConfig] = useState<LocalWatchConfig | null>(null);
  const [watchConditionEdited, setWatchConditionEdited] = useState(false);
  const timeoutValid = isLocalWatchTimeoutValid(watchConfig);
  const conditionComplete = isLocalWatchConditionComplete(watchConfig);
  const weekdayOptions = getWeekdayOptions(t);
  const scheduleModeOptions = getScheduleModeOptions(t, scheduleMode, Boolean(watchConfig));
  const promptChangedWhileEditing = Boolean(
    editingTaskSnapshot && prompt.trim() !== editingTaskSnapshot.prompt.trim()
  );
  const scheduleConfig = buildScheduleConfigFromForm(scheduleMode, selectedTimes, selectedWeekdays);
  const schedulePreview = buildSchedulePreview(scheduleMode, runAt, scheduleConfig, t);
  const selectedWeekdayLabels = joinAppList(
    selectedWeekdays
      .map(
        (weekday) =>
          weekdayOptions.find((option) => option.value === weekday)?.label ??
          t('schedule.unknownWeekday')
      )
      .filter(Boolean)
  );
  const selectedTimeLabels = joinAppList(selectedTimes);
  const previewTitle = editingId
    ? promptChangedWhileEditing
      ? t('schedule.autoTitleEditingChanged')
      : editingTaskSnapshot?.title || t('schedule.autoTitleEditingUnchanged')
    : t('schedule.autoTitleCreating');

  useEffect(() => {
    const defaultRunAt = Date.now() + 5 * 60 * 1000;
    setRunAt(toLocalDateTimeInput(defaultRunAt));
  }, []);

  useEffect(() => {
    if (!cwd) {
      setCwd(workingDir || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workingDir]);

  const loadTasks = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!isElectron) return;
    const silent = options.silent === true;
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const rows = await window.electronAPI.schedule.list();
      setTasks(rows);
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? { text: err.message } : { key: 'schedule.loadFailed' });
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isElectron || !isActive) return;
    void loadTasks();
  }, [isActive, loadTasks]);

  useEffect(() => {
    if (!isElectron || !isActive) return;
    const interval = setInterval(() => {
      void loadTasks({ silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [isActive, loadTasks]);

  async function submitTask() {
    if (!isElectron) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError({ key: 'schedule.promptRequired' });
      return;
    }
    if (scheduleMode === 'daily' && (!scheduleConfig || scheduleConfig.times.length === 0)) {
      setError({ key: 'schedule.dailyTimesRequired' });
      return;
    }
    if (scheduleMode === 'weekly') {
      if (
        !scheduleConfig ||
        scheduleConfig.kind !== 'weekly' ||
        scheduleConfig.times.length === 0
      ) {
        setError({ key: 'schedule.weeklyTimesRequired' });
        return;
      }
      if (scheduleConfig.weekdays.length === 0) {
        setError({ key: 'schedule.weekdayRequired' });
        return;
      }
    }
    const usesDateTimeInput = scheduleMode === 'once' || scheduleMode === 'legacy-interval';
    const runAtValue: number | null = usesDateTimeInput
      ? new Date(runAt).getTime()
      : computeNextScheduledRun(scheduleConfig, Date.now());
    if (runAtValue === null || !Number.isFinite(runAtValue)) {
      setError({
        key: usesDateTimeInput ? 'schedule.invalidTime' : 'schedule.nextRunCalculationFailed',
      });
      return;
    }
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (editingId) {
        const originalRunAtInput = editingTaskSnapshot
          ? toLocalDateTimeInput(editingTaskSnapshot.nextRunAt ?? editingTaskSnapshot.runAt)
          : null;
        const nextScheduleSignature = buildScheduleSignatureFromForm(
          scheduleMode,
          runAt,
          selectedTimes,
          selectedWeekdays,
          repeatEvery,
          repeatUnit
        );
        const originalScheduleSignature = editingTaskSnapshot
          ? buildScheduleSignatureFromTask(editingTaskSnapshot)
          : null;
        const shouldRegenerateTitle =
          !editingTaskSnapshot || trimmedPrompt !== editingTaskSnapshot.prompt.trim();
        const shouldResetScheduleTime =
          !editingTaskSnapshot ||
          nextScheduleSignature !== originalScheduleSignature ||
          runAt !== originalRunAtInput ||
          (enabled && editingTaskSnapshot.nextRunAt === null);
        if (shouldResetScheduleTime && runAtValue <= Date.now()) {
          setError({ key: 'schedule.futureTimeRequired' });
          return;
        }
        const nextWatchConfig = watchConfigForTaskUpdate(
          editingTaskSnapshot?.watchConfigError,
          watchConditionEdited,
          watchConfig
        );
        const payload: ScheduleUpdateInput = {
          ...(nextWatchConfig !== undefined ? { watchConfig: nextWatchConfig } : {}),
          cwd: cwd.trim() || workingDir || '',
          enabled,
          scheduleConfig,
          repeatEvery: scheduleMode === 'legacy-interval' ? repeatEvery : null,
          repeatUnit: scheduleMode === 'legacy-interval' ? repeatUnit : null,
        };
        if (shouldRegenerateTitle) {
          payload.prompt = trimmedPrompt;
        }
        if (shouldResetScheduleTime) {
          payload.runAt = runAtValue;
          payload.nextRunAt = runAtValue;
        }
        const updated = await window.electronAPI.schedule.update(editingId, payload);
        if (!updated) {
          throw new Error(t('schedule.taskMissing'));
        }
        setSuccess({ key: 'schedule.updated' });
      } else {
        if (runAtValue <= Date.now()) {
          setError({ key: 'schedule.futureTimeRequired' });
          return;
        }
        const payload: ScheduleCreateInput = {
          watchConfig,
          prompt: trimmedPrompt,
          cwd: cwd.trim() || workingDir || '',
          runAt: runAtValue,
          nextRunAt: runAtValue,
          scheduleConfig,
          enabled,
          repeatEvery: scheduleMode === 'legacy-interval' ? repeatEvery : null,
          repeatUnit: scheduleMode === 'legacy-interval' ? repeatUnit : null,
        };
        await window.electronAPI.schedule.create(payload);
        setSuccess({ key: 'schedule.created' });
      }
      clearForm();
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'schedule.saveFailed' });
    } finally {
      setIsLoading(false);
    }
  }

  async function toggleTask(task: ScheduleTask) {
    if (!isElectron) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await window.electronAPI.schedule.toggle(task.id, !task.enabled);
      if (!updated) {
        throw new Error(t('schedule.taskMissing'));
      }
      setSuccess({ key: updated.enabled ? 'schedule.taskEnabled' : 'schedule.taskDisabled' });
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'schedule.toggleFailed' });
    } finally {
      setIsLoading(false);
    }
  }

  async function runNow(task: ScheduleTask) {
    if (!isElectron) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await window.electronAPI.schedule.runNow(task.id);
      if (!updated) {
        throw new Error(t('schedule.taskMissing'));
      }
      setSuccess({
        key: {
          baseline: 'schedule.watchBaselineSaved',
          unchanged: 'schedule.watchUnchanged',
          triggered: 'schedule.watchTriggered',
          skipped: 'schedule.watchSkipped',
          started: 'schedule.runNowSuccess',
        }[updated.outcome],
      });
      await loadTasks();
    } catch (err) {
      setError(
        err instanceof Error
          ? { text: localizeWatchConfigError(err.message, t) }
          : { key: 'schedule.runNowFailed' }
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function stopTaskRun(task: ScheduleTask) {
    if (!isElectron) return;
    const sessionId = task.lastRunSessionId;
    if (!sessionId) {
      setError({ key: 'schedule.noSessionToStop' });
      return;
    }
    const targetSession = sessions.find((session) => session.id === sessionId);
    if (!targetSession || targetSession.status !== 'running') {
      setError({ key: 'schedule.sessionNotRunning' });
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      window.electronAPI.send({
        type: 'session.stop',
        payload: { sessionId },
      });
      setSuccess({ key: 'schedule.stopSent' });
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'schedule.stopFailed' });
      setIsLoading(false);
      return;
    }

    await loadTasks({ silent: true });
    setIsLoading(false);
  }

  async function deleteTask(task: ScheduleTask) {
    if (!isElectron) return;
    if (!window.confirm(t('schedule.deleteConfirm', { title: task.title }))) return;
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await window.electronAPI.schedule.delete(task.id);
      if (editingId === task.id) {
        clearForm();
      }
      setSuccess({ key: 'schedule.deleted' });
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? { text: err.message } : { key: 'schedule.deleteFailed' });
      setIsLoading(false);
    }
  }

  function editTask(task: ScheduleTask) {
    setEditingId(task.id);
    setEditingTaskSnapshot(task);
    setPrompt(task.prompt);
    setCwd(task.cwd);
    setRunAt(toLocalDateTimeInput(task.nextRunAt ?? task.runAt));
    setEnabled(task.enabled);
    setScheduleMode(detectScheduleMode(task));
    setSelectedTimes(task.scheduleConfig?.times ?? ['08:00']);
    setSelectedWeekdays(
      task.scheduleConfig?.kind === 'weekly' ? task.scheduleConfig.weekdays : [1]
    );
    setRepeatEvery(task.repeatEvery ?? 1);
    setRepeatUnit(task.repeatUnit ?? 'day');
    setWatchConfig(task.watchConfig ?? null);
    setWatchConditionEdited(false);
    setError(null);
    setSuccess(null);
  }

  function clearForm() {
    const defaultRunAt = Date.now() + 5 * 60 * 1000;
    setEditingId(null);
    setEditingTaskSnapshot(null);
    setPrompt('');
    setCwd(workingDir || '');
    setRunAt(toLocalDateTimeInput(defaultRunAt));
    setScheduleMode('once');
    setSelectedTimes(['08:00']);
    setSelectedWeekdays([1]);
    setEnabled(true);
    setRepeatEvery(1);
    setRepeatUnit('day');
    setWatchConfig(null);
    setWatchConditionEdited(false);
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-error/10 text-error text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {renderLocalizedBannerMessage(error, t)}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-success/10 text-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {renderLocalizedBannerMessage(success, t)}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <h4 className="text-sm font-medium text-text-primary">
          {editingId ? t('schedule.editTitle') : t('schedule.createTitle')}
        </h4>
        <div className="rounded-lg border border-border bg-background px-3 py-2">
          <div className="text-xs text-text-muted mb-1">{t('schedule.autoTitleLabel')}</div>
          <div className="text-sm text-text-primary break-all">{previewTitle}</div>
          {editingId && (
            <div className="text-xs text-text-muted mt-2">
              {promptChangedWhileEditing
                ? t('schedule.autoTitleChangedHint')
                : t('schedule.autoTitleUnchangedHint')}
            </div>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('schedule.promptPlaceholder')}
          rows={3}
          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
        />
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder={t('schedule.cwdPlaceholder')}
          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm"
        />
        <ScheduleConditionFields
          value={watchConfig}
          error={
            watchConditionEdited
              ? null
              : editingTaskSnapshot?.watchConfigError
                ? localizeWatchConfigError(editingTaskSnapshot.watchConfigError, t)
                : null
          }
          onChange={(value) => {
            setWatchConditionEdited(true);
            setWatchConfig(value);
            if (value && scheduleMode === 'once') {
              setScheduleMode('legacy-interval');
              setRepeatEvery(1);
              setRepeatUnit('minute');
            }
          }}
        />
        <div className="rounded-lg border border-border bg-background p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-text-primary">
                {t('schedule.executionTime')}
              </div>
              <div className="text-xs text-text-muted">{t('schedule.executionTimeHint')}</div>
            </div>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              {t('schedule.enabled')}
            </label>
          </div>
          <div
            className={`grid gap-2 ${scheduleMode === 'weekly' ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
          >
            <ScheduleSelectMenu
              label={t('schedule.mode')}
              options={scheduleModeOptions}
              value={scheduleMode}
              onChange={(value) => setScheduleMode(value as ScheduleFormMode)}
            />
            {scheduleMode === 'weekly' && (
              <ScheduleSelectMenu
                label={t('schedule.weekday')}
                options={weekdayOptions}
                values={selectedWeekdays}
                placeholder={t('schedule.weekdayPlaceholder')}
                summary={selectedWeekdayLabels}
                onToggle={(value) => {
                  setSelectedWeekdays((current) =>
                    toggleWeekdayValue(current, value as ScheduleWeekday)
                  );
                }}
              />
            )}
            {(scheduleMode === 'daily' || scheduleMode === 'weekly') && (
              <TimeMultiSelectMenu
                label={t('schedule.times')}
                values={selectedTimes}
                placeholder={t('schedule.timePlaceholder')}
                summary={selectedTimeLabels}
                onAdd={(value) => setSelectedTimes((current) => toggleTimeValue(current, value))}
                onRemove={(value) => setSelectedTimes((current) => toggleTimeValue(current, value))}
              />
            )}
          </div>
          {scheduleMode === 'legacy-interval' && !watchConfig && (
            <div className="rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning">
              {t('schedule.legacyIntervalNotice')}
            </div>
          )}
          {(scheduleMode === 'once' || scheduleMode === 'legacy-interval') && (
            <div className="space-y-2">
              <div className="text-xs text-text-muted">
                {scheduleMode === 'once'
                  ? t('schedule.onceTimeLabel')
                  : t('schedule.legacyStartTimeLabel')}
              </div>
              <input
                type="datetime-local"
                value={runAt}
                onChange={(e) => setRunAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm"
              />
            </div>
          )}
          {scheduleMode === 'legacy-interval' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={1}
                value={repeatEvery}
                onChange={(e) => setRepeatEvery(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm"
              />
              <select
                value={repeatUnit}
                onChange={(e) => setRepeatUnit(e.target.value as ScheduleRepeatUnit)}
                className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm"
              >
                <option value="minute">{t('schedule.repeatUnitMinute')}</option>
                <option value="hour">{t('schedule.repeatUnitHour')}</option>
                <option value="day">{t('schedule.repeatUnitDay')}</option>
              </select>
            </div>
          )}
          {scheduleMode === 'daily' && (
            <div className="text-xs text-text-muted">{t('schedule.dailyHint')}</div>
          )}
          {scheduleMode === 'weekly' && (
            <div className="text-xs text-text-muted">{t('schedule.weeklyHint')}</div>
          )}
          <div className="text-xs text-text-muted">{schedulePreview}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={submitTask}
            disabled={isLoading || !timeoutValid || !conditionComplete}
            className="px-3 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-50"
          >
            {editingId ? t('schedule.saveChanges') : t('schedule.createTask')}
          </button>
          {editingId && (
            <button
              onClick={clearForm}
              disabled={isLoading}
              className="px-3 py-2 rounded-lg bg-surface-hover text-text-secondary text-sm disabled:opacity-50"
            >
              {t('schedule.cancelEdit')}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-text-muted">{t('schedule.listHint')}</div>
        {tasks.length === 0 ? (
          <div className="text-sm text-text-muted text-center py-6 border border-dashed border-border rounded-lg">
            {t('schedule.empty')}
          </div>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="rounded-lg border border-border bg-surface p-3 space-y-2">
              {(() => {
                const lastRunSession = task.lastRunSessionId
                  ? (sessions.find((session) => session.id === task.lastRunSessionId) ?? null)
                  : null;
                const isTaskRunning = lastRunSession?.status === 'running';
                const lastRunStatusLabel = lastRunSession
                  ? isTaskRunning
                    ? t('schedule.statusRunning')
                    : t('schedule.statusFinished')
                  : task.lastRunSessionId
                    ? t('schedule.statusUnknown')
                    : t('schedule.statusNone');
                return (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-text-primary truncate">
                          {task.title}
                        </div>
                        <div className="text-xs text-text-muted truncate">{task.prompt}</div>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded ${task.enabled ? 'bg-success/10 text-success' : 'bg-surface-hover text-text-muted'}`}
                      >
                        {task.enabled ? t('schedule.taskEnabled') : t('schedule.taskDisabled')}
                      </span>
                    </div>
                    <div className="text-xs text-text-muted">
                      {task.nextRunAt === null
                        ? t('schedule.nextRunNone')
                        : t('schedule.nextRun', { value: formatTime(task.nextRunAt) })}
                    </div>
                    <div className="text-xs text-text-muted">
                      {t('schedule.strategy', {
                        value: formatScheduleRule(task, t, weekdayOptions),
                      })}
                    </div>
                    <div className="text-xs text-text-muted">
                      {task.lastRunAt === null
                        ? t('schedule.lastRunNever')
                        : t('schedule.lastRun', { value: formatTime(task.lastRunAt) })}
                    </div>
                    {task.lastRunSessionId && (
                      <div className="text-xs text-text-muted break-all">
                        {t('schedule.recentSession', { value: task.lastRunSessionId })}
                      </div>
                    )}
                    {task.watchConfig && (
                      <div className="text-xs text-text-muted break-words">
                        {t(
                          task.watchConfig.checkType === 'file'
                            ? 'schedule.watchFile'
                            : 'schedule.watchCommand'
                        )}
                        :{' '}
                        {task.watchConfig.checkType === 'file'
                          ? task.watchConfig.checkConfig.path
                          : task.watchConfig.checkConfig.command}
                        <div>
                          {task.lastCheckedAt == null
                            ? t('schedule.watchPending')
                            : t('schedule.watchChecked', {
                                time: formatTime(task.lastCheckedAt),
                                count: task.consecutiveUnchanged ?? 0,
                              })}
                        </div>
                      </div>
                    )}
                    {task.watchConfigError && (
                      <div className="text-xs text-error break-words">
                        {localizeWatchConfigError(task.watchConfigError, t)}
                      </div>
                    )}
                    <div className="text-xs text-text-muted">
                      {t('schedule.sessionStatus', { value: lastRunStatusLabel })}
                    </div>
                    <div className="text-xs text-text-muted truncate" title={task.cwd}>
                      {t('schedule.cwd', { value: task.cwd })}
                    </div>
                    {task.lastError && (
                      <div className="text-xs text-error break-all">
                        {t('schedule.lastError', {
                          value: localizeWatchConfigError(task.lastError, t),
                        })}
                      </div>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => toggleTask(task)}
                        disabled={isLoading}
                        className="px-2 py-1 rounded bg-surface-hover text-xs text-text-secondary disabled:opacity-50"
                      >
                        {task.enabled ? t('schedule.disable') : t('schedule.enable')}
                      </button>
                      <button
                        onClick={() => runNow(task)}
                        disabled={isLoading}
                        className="px-2 py-1 rounded bg-surface-hover text-xs text-text-secondary disabled:opacity-50"
                      >
                        {t(task.watchConfig ? 'schedule.watchCheckNow' : 'schedule.runNow')}
                      </button>
                      <button
                        onClick={() => stopTaskRun(task)}
                        disabled={isLoading || !isTaskRunning}
                        title={
                          isTaskRunning
                            ? t('schedule.stopRunTitleActive')
                            : t('schedule.stopRunTitleIdle')
                        }
                        className={`px-2 py-1 rounded text-xs disabled:opacity-50 ${
                          isTaskRunning
                            ? 'bg-warning/10 text-warning'
                            : 'bg-surface-hover text-text-muted'
                        }`}
                      >
                        {t('schedule.stopExecution')}
                      </button>
                      <button
                        onClick={() => editTask(task)}
                        disabled={isLoading}
                        className="px-2 py-1 rounded bg-surface-hover text-xs text-text-secondary disabled:opacity-50"
                      >
                        {t('schedule.edit')}
                      </button>
                      <button
                        onClick={() => deleteTask(task)}
                        disabled={isLoading}
                        className="px-2 py-1 rounded bg-error/10 text-xs text-error disabled:opacity-50"
                      >
                        {t('schedule.delete')}
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ==================== Schedule Helpers ====================

function toLocalDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatTime(timestamp: number): string {
  return formatAppDateTime(timestamp);
}

function formatScheduleRule(
  task: ScheduleTask,
  t: TFunction,
  weekdayOptions: Array<{ value: ScheduleWeekday; label: string }>
): string {
  if (task.scheduleConfig?.kind === 'daily') {
    return t('schedule.ruleDaily', { times: joinAppList(task.scheduleConfig.times) });
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    const weekdays = task.scheduleConfig.weekdays.map(
      (weekday) =>
        weekdayOptions.find((option) => option.value === weekday)?.label ??
        t('schedule.unknownWeekday')
    );
    return t('schedule.ruleWeekly', {
      weekdays: joinAppList(weekdays),
      times: joinAppList(task.scheduleConfig.times),
    });
  }
  if (!task.repeatEvery || !task.repeatUnit) {
    return t('schedule.ruleOnce');
  }
  if (task.repeatUnit === 'minute') {
    return t('schedule.repeatEveryMinute', { count: task.repeatEvery });
  }
  if (task.repeatUnit === 'hour') {
    return t('schedule.repeatEveryHour', { count: task.repeatEvery });
  }
  return t('schedule.repeatEveryDay', { count: task.repeatEvery });
}

function detectScheduleMode(task: ScheduleTask): ScheduleFormMode {
  if (task.scheduleConfig?.kind === 'daily') {
    return 'daily';
  }
  if (task.scheduleConfig?.kind === 'weekly') {
    return 'weekly';
  }
  if (task.repeatEvery && task.repeatUnit) {
    return 'legacy-interval';
  }
  return 'once';
}

function buildScheduleConfigFromForm(
  mode: ScheduleFormMode,
  times: string[],
  weekdays: ScheduleWeekday[]
): ScheduleConfig | null {
  const normalizedTimes = Array.from(new Set(times)).sort();
  if (mode === 'daily' && normalizedTimes.length > 0) {
    return { kind: 'daily', times: normalizedTimes };
  }
  if (mode === 'weekly' && normalizedTimes.length > 0 && weekdays.length > 0) {
    return {
      kind: 'weekly',
      weekdays: Array.from(new Set(weekdays)).sort((left, right) => left - right),
      times: normalizedTimes,
    };
  }
  return null;
}

function buildScheduleSignatureFromTask(task: ScheduleTask): string {
  if (task.scheduleConfig) {
    return JSON.stringify(task.scheduleConfig);
  }
  if (task.repeatEvery && task.repeatUnit) {
    return JSON.stringify({
      mode: 'legacy-interval',
      runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
      repeatEvery: task.repeatEvery,
      repeatUnit: task.repeatUnit,
    });
  }
  return JSON.stringify({
    mode: 'once',
    runAt: toLocalDateTimeInput(task.nextRunAt ?? task.runAt),
  });
}

function buildScheduleSignatureFromForm(
  mode: ScheduleFormMode,
  runAt: string,
  times: string[],
  weekdays: ScheduleWeekday[],
  repeatEvery: number,
  repeatUnit: ScheduleRepeatUnit
): string {
  if (mode === 'daily' || mode === 'weekly') {
    return JSON.stringify(buildScheduleConfigFromForm(mode, times, weekdays));
  }
  if (mode === 'legacy-interval') {
    return JSON.stringify({ mode, runAt, repeatEvery, repeatUnit });
  }
  return JSON.stringify({ mode, runAt });
}

function buildSchedulePreview(
  mode: ScheduleFormMode,
  runAt: string,
  scheduleConfig: ScheduleConfig | null,
  t: TFunction
): string {
  if (mode === 'once' || mode === 'legacy-interval') {
    const timestamp = new Date(runAt).getTime();
    return Number.isFinite(timestamp)
      ? t('schedule.previewNextRun', { value: formatTime(timestamp) })
      : t('schedule.previewSelectValidTime');
  }
  const nextRunAt = computeNextScheduledRun(scheduleConfig, Date.now());
  return nextRunAt === null
    ? t('schedule.previewSelectAtLeastOne')
    : t('schedule.previewAutoFind', { value: formatTime(nextRunAt) });
}

function computeNextScheduledRun(
  scheduleConfig: ScheduleConfig | null,
  now: number
): number | null {
  if (!scheduleConfig || scheduleConfig.times.length === 0) {
    return null;
  }
  const allowedWeekdays =
    scheduleConfig.kind === 'weekly' ? new Set(scheduleConfig.weekdays) : null;
  const nowDate = new Date(now);

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDate = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate() + dayOffset,
      0,
      0,
      0,
      0
    );
    if (allowedWeekdays && !allowedWeekdays.has(candidateDate.getDay() as ScheduleWeekday)) {
      continue;
    }
    for (const time of scheduleConfig.times) {
      const [hour, minute] = time.split(':').map(Number);
      const candidate = new Date(
        candidateDate.getFullYear(),
        candidateDate.getMonth(),
        candidateDate.getDate(),
        hour,
        minute,
        0,
        0
      ).getTime();
      if (candidate > now) {
        return candidate;
      }
    }
  }

  return null;
}

function toggleTimeValue(current: string[], target: string): string[] {
  if (!isValidTimeValue(target)) {
    return current;
  }
  const next = current.includes(target)
    ? current.filter((value) => value !== target)
    : [...current, target];
  return next.sort();
}

function toggleWeekdayValue(
  current: ScheduleWeekday[],
  target: ScheduleWeekday
): ScheduleWeekday[] {
  const next = current.includes(target)
    ? current.filter((value) => value !== target)
    : [...current, target];
  return next.sort((left, right) => left - right);
}

function isValidTimeValue(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

// ==================== Schedule UI Sub-components ====================

function ScheduleSelectMenu(props: {
  label: string;
  options: Array<{ value: string | number; label: string }>;
  value?: string | number;
  values?: Array<string | number>;
  placeholder?: string;
  summary?: string;
  onChange?: (value: string | number) => void;
  onToggle?: (value: string | number) => void;
}) {
  const { t } = useTranslation();
  const {
    label,
    options,
    value,
    values = [],
    placeholder = t('schedule.timePlaceholder'),
    summary,
    onChange,
    onToggle,
  } = props;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isMulti = typeof onToggle === 'function';
  const buttonText =
    summary ||
    (isMulti
      ? values.length > 0
        ? joinAppList(
            values
              .map((item) => options.find((option) => option.value === item)?.label ?? String(item))
              .filter(Boolean)
          )
        : placeholder
      : (options.find((option) => option.value === value)?.label ?? placeholder));

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="mb-1 text-xs text-text-muted">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
          open
            ? 'border-accent bg-surface text-text-primary'
            : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'
        }`}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-elevated">
          {options.map((option) => {
            const selected = isMulti ? values.includes(option.value) : option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  if (isMulti) {
                    onToggle?.(option.value);
                    return;
                  }
                  onChange?.(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  selected
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
              >
                <span>{option.label}</span>
                {selected && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimeMultiSelectMenu(props: {
  label: string;
  values: string[];
  placeholder?: string;
  summary?: string;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const { t } = useTranslation();
  const {
    label,
    values,
    placeholder = t('schedule.timePlaceholder'),
    summary,
    onAdd,
    onRemove,
  } = props;
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [draftTime, setDraftTime] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonText = summary || (values.length > 0 ? joinAppList(values) : placeholder);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function updatePlacement() {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const estimatedPanelHeight = 420;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUpward(spaceBelow < estimatedPanelHeight && spaceAbove > spaceBelow);
    }

    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open]);

  function addDraftTime() {
    if (!isValidTimeValue(draftTime)) {
      return;
    }
    onAdd(draftTime);
    setDraftTime('');
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="mb-1 text-xs text-text-muted">{label}</div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
          open
            ? 'border-accent bg-surface text-text-primary'
            : 'border-border bg-surface text-text-secondary hover:bg-surface-hover'
        }`}
      >
        <span className="truncate">{buttonText}</span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          className={`absolute right-0 z-20 w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border/80 bg-surface p-3 shadow-[0_24px_60px_rgba(0,0,0,0.14)] ${
            openUpward ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'
          }`}
        >
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {t('schedule.pickerEditTimes')}
                  </div>
                  <div className="text-xs text-text-muted">{t('schedule.pickerAnyHHmm')}</div>
                </div>
                {values.length > 0 && (
                  <div className="text-xs text-text-muted">
                    {t('schedule.pickerSelectedCount', { count: values.length })}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  step={60}
                  value={draftTime}
                  onChange={(event) => setDraftTime(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary"
                />
                <button
                  type="button"
                  onClick={addDraftTime}
                  disabled={!isValidTimeValue(draftTime)}
                  className="inline-flex min-w-[92px] flex-shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  {t('schedule.pickerAdd')}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs text-text-muted">{t('schedule.pickerSelectedTimes')}</div>
              {values.length > 0 ? (
                <div className="flex flex-wrap gap-2 rounded-lg bg-background p-2">
                  {values.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => onRemove(time)}
                      className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-surface px-3 py-1 text-sm text-accent shadow-sm"
                    >
                      <span>{time}</span>
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-background px-3 py-2 text-xs text-text-muted">
                  {t('schedule.pickerNone')}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-xs text-text-muted">{t('schedule.pickerSuggestions')}</div>
              <div className="flex flex-wrap gap-2">
                {SCHEDULE_TIME_SUGGESTIONS.map((time) => {
                  const selected = values.includes(time);
                  return (
                    <button
                      key={time}
                      type="button"
                      onClick={() => {
                        if (selected) {
                          onRemove(time);
                          return;
                        }
                        onAdd(time);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        selected
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-background text-text-secondary hover:bg-surface-hover'
                      }`}
                    >
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
