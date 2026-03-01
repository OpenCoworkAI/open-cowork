import { describe, it, expect } from 'vitest';
import { extractArtifactsFromText, buildArtifactTraceSteps } from '../src/main/utils/artifact-parser';

describe('artifact parser', () => {
  it('extracts a single artifact and removes block from text', () => {
    const input = 'Hello\n```artifact\n{"path":"/workspace/out.pptx","name":"deck"}\n```\nDone';
    const result = extractArtifactsFromText(input);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toEqual({ path: '/workspace/out.pptx', name: 'deck' });
    expect(result.cleanText).toBe('Hello\n\nDone');
  });

  it('supports multiple artifacts in one block', () => {
    const input = 'Start\n```artifact\n[{"path":"/workspace/a.txt"},{"path":"/workspace/b.txt","type":"text"}]\n```\nEnd';
    const result = extractArtifactsFromText(input);
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[1]).toEqual({ path: '/workspace/b.txt', type: 'text' });
    expect(result.cleanText).toBe('Start\n\nEnd');
  });

  it('ignores invalid JSON blocks', () => {
    const input = 'A\n```artifact\n{bad json}\n```\nB';
    const result = extractArtifactsFromText(input);
    expect(result.artifacts).toHaveLength(0);
    expect(result.cleanText).toBe('A\n\nB');
  });

  it('skips entries without path', () => {
    const input = 'X\n```artifact\n[{"name":"nope"},{"path":"/workspace/ok.md"}]\n```\nY';
    const result = extractArtifactsFromText(input);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toEqual({ path: '/workspace/ok.md' });
    expect(result.cleanText).toBe('X\n\nY');
  });

  it('builds artifact trace steps', () => {
    const steps = buildArtifactTraceSteps(
      [{ path: '/workspace/out.pptx', name: 'deck' }],
      () => 123,
      () => 'id-1'
    );
    expect(steps).toEqual([
      {
        id: 'id-1',
        type: 'tool_result',
        status: 'completed',
        title: 'artifact',
        toolName: 'artifact',
        toolOutput: JSON.stringify({ path: '/workspace/out.pptx', name: 'deck' }),
        timestamp: 123,
      },
    ]);
  });
});
