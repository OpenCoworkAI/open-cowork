import { describe, it, expect } from 'vitest';
import type { TraceStep } from '../src/renderer/types';
import { getArtifactSteps, getArtifactLabel } from '../src/renderer/utils/artifact-steps';

describe('getArtifactSteps', () => {
  it('includes completed Write tool calls as file steps when no artifacts exist', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_write',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolOutput: 'File created successfully at: /tmp/monthly_report_2026.xlsx',
        timestamp: Date.now(),
      },
      {
        id: 'call_bash',
        type: 'tool_call',
        status: 'completed',
        title: 'Bash',
        toolName: 'Bash',
        toolOutput: '-rw-r--r-- 1 user staff 1234 Feb 3 14:14 monthly_report_2026.xlsx',
        timestamp: Date.now(),
      },
    ];

    const { artifactSteps, fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(artifactSteps).toHaveLength(0);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Write');
  });

  it('prefers explicit artifact steps over file steps', () => {
    const steps: TraceStep[] = [
      {
        id: 'artifact_1',
        type: 'tool_result',
        status: 'completed',
        title: 'artifact',
        toolName: 'artifact',
        toolOutput: '{"path":"/tmp/report.xlsx"}',
        timestamp: Date.now(),
      },
      {
        id: 'call_write',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolOutput: 'File created successfully at: /tmp/other.xlsx',
        timestamp: Date.now(),
      },
    ];

    const { artifactSteps, fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(artifactSteps).toHaveLength(1);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toEqual(artifactSteps);
  });

  it('formats label from full path', () => {
    expect(getArtifactLabel('/Users/haoqing/tmp/simple.md')).toBe('simple.md');
  });

  it('uses basename when path exists even if name provided', () => {
    expect(getArtifactLabel('/Users/haoqing/tmp/simple.md', '自定义名称')).toBe('simple.md');
  });

  it('uses name when path is empty', () => {
    expect(getArtifactLabel('', '自定义名称')).toBe('自定义名称');
  });

  it('prefers basename over translated name', () => {
    expect(getArtifactLabel('/Users/haoqing/tmp/simple.pptx', '简单PPT演示文稿')).toBe('simple.pptx');
  });
});
