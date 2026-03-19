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

  it('uses toolInput path when toolOutput does not include a path', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_write_input_only',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolInput: { path: '/tmp/from-input-only.txt', content: 'hello' },
        toolOutput: 'File created',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
  });

  it('uses wrapped write tool output from runtime traces', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_write_wrapped',
        type: 'tool_call',
        status: 'completed',
        title: 'write',
        toolName: 'write',
        toolOutput: JSON.stringify({
          content: [
            {
              type: 'text',
              text: 'Successfully wrote 2986 bytes to agent_papers_summary.html',
            },
          ],
        }),
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('write');
  });

  it('includes completed Edit tool calls as file steps when no artifacts exist', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_edit',
        type: 'tool_call',
        status: 'completed',
        title: 'Edit',
        toolName: 'Edit',
        toolInput: { path: '/tmp/notes.md', old_string: 'old', new_string: 'new' },
        toolOutput: 'File edited: /tmp/notes.md',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Edit');
  });

  it('filters out file steps without any resolvable file path', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_write_no_path',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolOutput: 'File created successfully',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(0);
    expect(displayArtifactSteps).toHaveLength(0);
  });

  it('deduplicates repeated updates for the same file path', () => {
    const steps: TraceStep[] = [
      {
        id: 'write_1',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolOutput: 'File created successfully at: /tmp/repeated.txt',
        timestamp: Date.now(),
      },
      {
        id: 'write_2',
        type: 'tool_call',
        status: 'completed',
        title: 'Write',
        toolName: 'Write',
        toolInput: { path: '/tmp/repeated.txt', content: 'updated' },
        toolOutput: 'Updated',
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
  });

  it('prefers concrete file operations over explicit artifact summaries', () => {
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
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Write');
  });

  it('shows completed edit steps even when artifact summaries also exist', () => {
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
        id: 'call_edit',
        type: 'tool_call',
        status: 'completed',
        title: 'Edit',
        toolName: 'Edit',
        toolInput: { path: '/tmp/notes.md', old_string: 'old', new_string: 'new' },
        toolOutput: 'File edited: /tmp/notes.md',
        timestamp: Date.now(),
      },
    ];

    const { artifactSteps, fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(artifactSteps).toHaveLength(1);
    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Edit');
  });

  it('ignores explicit artifact summaries when a write step already covers the same path', () => {
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
        toolInput: { path: '/tmp/report.xlsx', content: 'hello' },
        toolOutput: 'File written: /tmp/report.xlsx',
        timestamp: Date.now(),
      },
    ];

    const { displayArtifactSteps } = getArtifactSteps(steps);

    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('Write');
  });

  it('includes screenshot tools when they return a concrete output path', () => {
    const steps: TraceStep[] = [
      {
        id: 'shot_1',
        type: 'tool_result',
        status: 'completed',
        title: 'screenshot',
        toolName: 'screenshot',
        toolOutput: JSON.stringify({ path: '/tmp/screenshot_1.png', size: 12345 }),
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(fileSteps).toHaveLength(1);
    expect(displayArtifactSteps).toHaveLength(1);
    expect(displayArtifactSteps[0].toolName).toBe('screenshot');
  });

  it('does not show artifact summaries by themselves in the artifacts panel list', () => {
    const steps: TraceStep[] = [
      {
        id: 'artifact_only',
        type: 'tool_result',
        status: 'completed',
        title: 'artifact',
        toolName: 'artifact',
        toolOutput: '{"path":"/tmp/report.xlsx"}',
        timestamp: Date.now(),
      },
    ];

    const { artifactSteps, fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    expect(artifactSteps).toHaveLength(1);
    expect(fileSteps).toHaveLength(0);
    expect(displayArtifactSteps).toHaveLength(0);
  });

  it('excludes Bash tool from file steps (relies on recent-files fallback)', () => {
    const steps: TraceStep[] = [
      {
        id: 'call_bash_create',
        type: 'tool_call',
        status: 'completed',
        title: 'Bash',
        toolName: 'Bash',
        toolOutput: 'File created successfully at: /tmp/generated.docx',
        timestamp: Date.now(),
      },
      {
        id: 'call_bash_python',
        type: 'tool_call',
        status: 'completed',
        title: 'Bash',
        toolName: 'bash',
        toolOutput: JSON.stringify({
          content: [{ type: 'text', text: 'Successfully wrote 2986 bytes to /tmp/report.html' }],
        }),
        timestamp: Date.now(),
      },
    ];

    const { fileSteps, displayArtifactSteps } = getArtifactSteps(steps);

    // Bash outputs are unpredictable — file display relies on recent-files scan
    expect(fileSteps).toHaveLength(0);
    expect(displayArtifactSteps).toHaveLength(0);
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
