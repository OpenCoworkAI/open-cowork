import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const settingsPanelPath = path.resolve(process.cwd(), 'src/renderer/components/SettingsPanel.tsx');
const settingsPanelContent = readFileSync(settingsPanelPath, 'utf8');

describe('SettingsPanel schedule tab entry', () => {
  it('renders schedule tab id', () => {
    expect(settingsPanelContent).toContain("id: 'schedule' as TabId");
  });

  it('uses schedule i18n keys', () => {
    expect(settingsPanelContent).toContain("t('settings.schedule'");
    expect(settingsPanelContent).toContain("t('settings.scheduleDesc'");
  });

  it('handles null nextRunAt explicitly', () => {
    expect(settingsPanelContent).toContain('task.nextRunAt === null');
    expect(settingsPanelContent).toContain("t('schedule.nextRunNone')");
    expect(settingsPanelContent).toContain("t('schedule.nextRun', { value: formatTime(task.nextRunAt) })");
  });

  it('avoids resetting schedule time when editing without changing runAt', () => {
    expect(settingsPanelContent).toContain('shouldResetScheduleTime');
    expect(settingsPanelContent).toContain('runAt !== originalRunAtInput');
  });

  it('polls schedule list in background', () => {
    expect(settingsPanelContent).toContain("void loadTasks({ silent: true })");
  });

  it('validates future run time and suggests runNow for immediate execution', () => {
    expect(settingsPanelContent).toContain("setError({ key: 'schedule.futureTimeRequired' })");
  });

  it('shows model-generated title hints and only regenerates on prompt change', () => {
    expect(settingsPanelContent).toContain("t('schedule.autoTitleLabel')");
    expect(settingsPanelContent).toContain('previewTitle');
    expect(settingsPanelContent).toContain('shouldRegenerateTitle');
    expect(settingsPanelContent).toContain("t('schedule.autoTitleChangedHint')");
    expect(settingsPanelContent).toContain("t('schedule.autoTitleUnchangedHint')");
  });

  it('renders schedule rule and last-run details for better task readability', () => {
    expect(settingsPanelContent).toContain("t('schedule.strategy', {");
    expect(settingsPanelContent).toContain('formatScheduleRule(task, t, weekdayOptions)');
    expect(settingsPanelContent).toContain("t('schedule.lastRunNever')");
    expect(settingsPanelContent).toContain("t('schedule.lastRun', { value: formatTime(task.lastRunAt) })");
    expect(settingsPanelContent).toContain('{task.title}');
    expect(settingsPanelContent).toContain("t('schedule.recentSession', { value: task.lastRunSessionId })");
  });

  it('supports daily and weekly multi-slot schedule editing', () => {
    expect(settingsPanelContent).toContain("const [scheduleMode, setScheduleMode] = useState<ScheduleFormMode>('once')");
    expect(settingsPanelContent).toContain('<ScheduleSelectMenu');
    expect(settingsPanelContent).toContain('<TimeMultiSelectMenu');
    expect(settingsPanelContent).toContain("label={t('schedule.mode')}");
    expect(settingsPanelContent).toContain("label={t('schedule.weekday')}");
    expect(settingsPanelContent).toContain("label={t('schedule.times')}");
    expect(settingsPanelContent).toContain("t('schedule.previewAutoFind'");
  });

  it('allows editable custom time entries instead of fixed half-hour slots', () => {
    expect(settingsPanelContent).toContain("t('schedule.pickerEditTimes')");
    expect(settingsPanelContent).toContain("t('schedule.pickerAnyHHmm')");
    expect(settingsPanelContent).toContain('type="time"');
    expect(settingsPanelContent).toContain("t('schedule.pickerSuggestions')");
    expect(settingsPanelContent).toContain('function isValidTimeValue(value: string): boolean');
    expect(settingsPanelContent).toContain('const [openUpward, setOpenUpward] = useState(false)');
    expect(settingsPanelContent).toContain('min-w-[92px]');
    expect(settingsPanelContent).toContain('w-[min(22rem,calc(100vw-2rem))]');
    expect(settingsPanelContent).toContain('rounded-full border px-3 py-1.5 text-sm');
  });

  it('formats daily and weekly schedule rules from scheduleConfig', () => {
    expect(settingsPanelContent).toContain("if (task.scheduleConfig?.kind === 'daily')");
    expect(settingsPanelContent).toContain("if (task.scheduleConfig?.kind === 'weekly')");
    expect(settingsPanelContent).toContain("t('schedule.ruleWeekly'");
  });

  it('shows clear stop semantics hint', () => {
    expect(settingsPanelContent).toContain("title={");
    expect(settingsPanelContent).toContain("t('schedule.stopExecution')");
  });

  it('provides stop-run control for running scheduled sessions', () => {
    expect(settingsPanelContent).toContain("type: 'session.stop'");
    expect(settingsPanelContent).toContain("t('schedule.stopRunTitleActive')");
    expect(settingsPanelContent).toContain("t('schedule.stopRunTitleIdle')");
    expect(settingsPanelContent).toContain("setError({ key: 'schedule.noSessionToStop' })");
  });

  it('saves cwd in create and update payloads so backend validation can reject unsupported paths early', () => {
    expect(settingsPanelContent).toContain("cwd: cwd.trim() || workingDir || ''");
    expect(settingsPanelContent).toContain('const updated = await window.electronAPI.schedule.update(editingId, payload);');
    expect(settingsPanelContent).toContain('await window.electronAPI.schedule.create(payload);');
  });
});
