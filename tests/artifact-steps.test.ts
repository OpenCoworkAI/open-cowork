import { describe, it, expect } from 'vitest';
import type { TraceStep } from '../src/renderer/types';
import { getArtifactSteps } from '../src/renderer/utils/artifact-steps';

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
});
