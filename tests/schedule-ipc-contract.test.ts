import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootPath = process.cwd();
const rendererTypes = readFileSync(path.join(rootPath, 'src/renderer/types/index.ts'), 'utf8');
const preloadSource = readFileSync(path.join(rootPath, 'src/preload/index.ts'), 'utf8');
const mainSource = readFileSync(path.join(rootPath, 'src/main/index.ts'), 'utf8');
const componentPath = path.join(rootPath, 'src/renderer/components');
const componentSource = readdirSync(componentPath, { recursive: true })
  .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
  .map((entry) => readFileSync(path.join(componentPath, entry), 'utf8'))
  .join('\n');

describe('schedule IPC WatchTask contract', () => {
  it('uses the shared WatchTask types for editable inputs and normalized task outputs', () => {
    expect(rendererTypes).toContain(
      "import type { HttpWatchConfig, HttpWatchConfigInput } from '../../shared/schedule/watch-task';"
    );
    expect(rendererTypes).toContain('watchConfig: HttpWatchConfig | null;');
    expect(rendererTypes).toContain('lastState: string | null;');
    expect(rendererTypes).toContain('lastCheckedAt: number | null;');
    expect(rendererTypes).toContain('consecutiveUnchanged: number;');
    expect(rendererTypes).toContain('readonly watchConfigError: string | null;');
    expect(rendererTypes.match(/watchConfig\?: HttpWatchConfigInput \| null;/g)).toHaveLength(2);
  });

  it('keeps the established schedule IPC bridge channels and method signatures', () => {
    const scheduleChannels = Array.from(
      preloadSource.matchAll(/ipcRenderer\.invoke\('(schedule\.[^']+)'/g),
      (match) => match[1] ?? ''
    );

    expect(scheduleChannels).toEqual([
      'schedule.list',
      'schedule.create',
      'schedule.update',
      'schedule.delete',
      'schedule.toggle',
      'schedule.runNow',
    ]);
    expect(preloadSource).toContain(
      'create: (payload: ScheduleCreateInput): Promise<ScheduleTask>'
    );
    expect(preloadSource).toContain(
      'update: (id: string, updates: ScheduleUpdateInput): Promise<ScheduleTask | null>'
    );
  });

  it('keeps WatchTask fields out of renderer components', () => {
    expect(componentSource).not.toMatch(
      /\b(watchConfig|lastState|lastCheckedAt|consecutiveUnchanged|watchConfigError)\b/
    );
  });

  it('wires the HTTP condition checker into headless and GUI managers', () => {
    expect(mainSource).toContain(
      "import { HttpConditionChecker } from './schedule/http-condition-checker';"
    );
    expect(mainSource).toContain('const checkHttpCondition =');
    expect(mainSource.match(/checkCondition: checkHttpCondition/g)).toHaveLength(2);
  });
});
