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
    expect(settingsPanelContent).toContain("task.nextRunAt === null ? '无' : formatTime(task.nextRunAt)");
  });

  it('avoids resetting schedule time when editing without changing runAt', () => {
    expect(settingsPanelContent).toContain('shouldResetScheduleTime');
    expect(settingsPanelContent).toContain('runAt !== originalRunAtInput');
  });

  it('polls schedule list in background', () => {
    expect(settingsPanelContent).toContain("void loadTasks({ silent: true })");
  });

  it('validates future run time and suggests runNow for immediate execution', () => {
    expect(settingsPanelContent).toContain('执行时间必须晚于当前时间；如需立刻执行请使用“立即执行”');
  });

  it('shows model-generated title hints and only regenerates on prompt change', () => {
    expect(settingsPanelContent).toContain('自动标题（用于会话区分）');
    expect(settingsPanelContent).toContain('保存后将自动生成：[定时任务] + 模型摘要');
    expect(settingsPanelContent).toContain('shouldRegenerateTitle');
    expect(settingsPanelContent).toContain('检测到 Prompt 已修改，保存后会重新生成标题。');
    expect(settingsPanelContent).toContain('未修改 Prompt 时将保留现有标题。');
  });

  it('renders schedule rule and last-run details for better task readability', () => {
    expect(settingsPanelContent).toContain('执行策略：{formatScheduleRule(task)}');
    expect(settingsPanelContent).toContain('上次执行：{task.lastRunAt === null ? \'尚未执行\' : formatTime(task.lastRunAt)}');
    expect(settingsPanelContent).toContain('{task.title}');
    expect(settingsPanelContent).toContain('最近会话：{task.lastRunSessionId}');
  });

  it('supports daily and weekly multi-slot schedule editing', () => {
    expect(settingsPanelContent).toContain("const [scheduleMode, setScheduleMode] = useState<ScheduleFormMode>('once')");
    expect(settingsPanelContent).toContain('<ScheduleSelectMenu');
    expect(settingsPanelContent).toContain('<TimeMultiSelectMenu');
    expect(settingsPanelContent).toContain('label="执行模式"');
    expect(settingsPanelContent).toContain('label="执行星期"');
    expect(settingsPanelContent).toContain('label="执行时段"');
    expect(settingsPanelContent).toContain('每天在这些时段自动执行');
    expect(settingsPanelContent).toContain('每周在选中的星期与时段自动执行');
    expect(settingsPanelContent).toContain('系统将自动找到下一档执行时间');
  });

  it('allows editable custom time entries instead of fixed half-hour slots', () => {
    expect(settingsPanelContent).toContain('编辑时段');
    expect(settingsPanelContent).toContain('支持输入任意 `HH:mm`');
    expect(settingsPanelContent).toContain('type="time"');
    expect(settingsPanelContent).toContain('常用建议');
    expect(settingsPanelContent).toContain('function isValidTimeValue(value: string): boolean');
    expect(settingsPanelContent).toContain('const [openUpward, setOpenUpward] = useState(false)');
    expect(settingsPanelContent).toContain('min-w-[92px]');
    expect(settingsPanelContent).toContain('w-[min(22rem,calc(100vw-2rem))]');
    expect(settingsPanelContent).toContain('rounded-full border px-3 py-1.5 text-sm');
  });

  it('formats daily and weekly schedule rules from scheduleConfig', () => {
    expect(settingsPanelContent).toContain("if (task.scheduleConfig?.kind === 'daily')");
    expect(settingsPanelContent).toContain("if (task.scheduleConfig?.kind === 'weekly')");
    expect(settingsPanelContent).toContain('每周 ${weekdays} · ${task.scheduleConfig.times.join(\'、\')}');
  });

  it('shows clear stop semantics hint', () => {
    expect(settingsPanelContent).toContain('停用仅阻止后续自动触发，已开始执行的会话需在会话列表中手动停止');
  });

  it('provides stop-run control for running scheduled sessions', () => {
    expect(settingsPanelContent).toContain('停止执行');
    expect(settingsPanelContent).toContain("type: 'session.stop'");
    expect(settingsPanelContent).toContain('该任务当前没有正在执行的会话');
  });
});
