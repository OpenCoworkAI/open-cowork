import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const agentRunnerPath = path.resolve(process.cwd(), 'src/main/claude/agent-runner.ts');
const agentRunnerContent = readFileSync(agentRunnerPath, 'utf8');

describe('agent-runner stream-error abort preserves error trace status', () => {
  it('declares an abortedByStreamError flag in the prompt() scope', () => {
    expect(agentRunnerContent).toContain('let abortedByStreamError = false;');
  });

  it('marks abortedByStreamError immediately before controller.abort()', () => {
    const setIdx = agentRunnerContent.indexOf('abortedByStreamError = true;');
    expect(setIdx).toBeGreaterThan(-1);

    const abortIdx = agentRunnerContent.indexOf('controller.abort();', setIdx);
    expect(abortIdx).toBeGreaterThan(setIdx);

    const between = agentRunnerContent.slice(setIdx, abortIdx);
    const nonTrivialLines = between
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//'));
    expect(nonTrivialLines.length).toBeLessThanOrEqual(2);
  });

  it('aborts on message_update error after resolving a user-facing stream error', () => {
    const branchStart = agentRunnerContent.indexOf("} else if (ame.type === 'error') {");
    expect(branchStart).toBeGreaterThan(-1);
    const branchEnd = agentRunnerContent.indexOf('}', branchStart + 40);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branch = agentRunnerContent.slice(branchStart, branchEnd + 1);

    expect(branch).toContain('resolveAssistantStreamErrorText(ame)');
    expect(branch).toContain('abort: true');
    expect(branch).toContain('includePartialText: true');
  });

  it('the AbortError catch branch checks abortedByStreamError before the user-cancel branch', () => {
    const start = agentRunnerContent.indexOf("error.name === 'AbortError'");
    expect(start).toBeGreaterThan(-1);
    const end = agentRunnerContent.indexOf('} else {', start);
    expect(end).toBeGreaterThan(start);
    const block = agentRunnerContent.slice(start, end + 1000);

    const streamErrorBranchIdx = block.indexOf('abortedByStreamError');
    const userCancelIdx = block.indexOf("title: 'Cancelled'");
    expect(streamErrorBranchIdx).toBeGreaterThan(-1);
    expect(userCancelIdx).toBeGreaterThan(streamErrorBranchIdx);
  });

  it('the stream-error catch branch does not overwrite the trace status with Cancelled', () => {
    const branchStart = agentRunnerContent.indexOf('} else if (abortedByStreamError) {');
    expect(branchStart).toBeGreaterThan(-1);
    const branchEnd = agentRunnerContent.indexOf('} else {', branchStart);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branch = agentRunnerContent.slice(branchStart, branchEnd);

    const codeOnly = branch
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');

    expect(codeOnly).not.toContain('Cancelled');
    expect(codeOnly).not.toContain('sendTraceUpdate');
    expect(branch).toContain('Aborted by stream error');
  });

  it('the post-prompt short-circuit also returns early on swallowed stream-error aborts', () => {
    expect(agentRunnerContent).toContain('if (controller.signal.aborted && abortedByStreamError)');
    expect(agentRunnerContent).toContain(
      'Aborted by stream error (detected after prompt returned)'
    );
  });
});
