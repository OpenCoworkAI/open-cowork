import { describe, it, expect } from 'vitest';
import { extractFilePathFromToolInput, extractFilePathFromToolOutput } from '../src/renderer/utils/tool-output-path';

describe('extractFilePathFromToolOutput', () => {
  it('extracts path from File written output', () => {
    const output = 'File written: /Users/haoqing/Desktop/report.docx';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/report.docx');
  });

  it('extracts path from File edited output', () => {
    const output = 'File edited: /Users/haoqing/Desktop/report.docx';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/report.docx');
  });

  it('extracts path from File created successfully output', () => {
    const output = 'File created successfully at: /Users/haoqing/Desktop/report.docx';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/report.docx');
  });

  it('extracts path from JSON output', () => {
    const output = JSON.stringify({ filePath: '/tmp/demo.txt' });
    expect(extractFilePathFromToolOutput(output)).toBe('/tmp/demo.txt');
  });

  it('extracts relative path from wrapped write tool output', () => {
    const output = JSON.stringify({
      content: [
        {
          type: 'text',
          text: 'Successfully wrote 2986 bytes to agent_papers_summary.html',
        },
      ],
    });
    expect(extractFilePathFromToolOutput(output)).toBe('agent_papers_summary.html');
  });

  it('extracts absolute path from updated-file messages', () => {
    const output = 'The file /Users/haoqing/Library/Application Support/open-cowork/default_working_dir/slide2.html has been updated successfully.';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/slide2.html');
  });

  it('extracts screenshot path from wrapped screenshot output', () => {
    const output = JSON.stringify({
      content: [
        {
          type: 'text',
          text: 'Took a screenshot of the full current page.\nSaved screenshot to /Users/haoqing/Desktop/open-cowork/agent_papers_summary_screenshot.png.',
        },
      ],
    });
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/open-cowork/agent_papers_summary_screenshot.png');
  });

  it('returns null for unrelated output', () => {
    expect(extractFilePathFromToolOutput('OK')).toBeNull();
  });
});

describe('extractFilePathFromToolInput', () => {
  it('extracts path from canonical path field', () => {
    expect(extractFilePathFromToolInput({ path: '/tmp/output.txt' })).toBe('/tmp/output.txt');
  });

  it('extracts path from alternate fields', () => {
    expect(extractFilePathFromToolInput({ filePath: '/tmp/a.txt' })).toBe('/tmp/a.txt');
    expect(extractFilePathFromToolInput({ file_path: '/tmp/b.txt' })).toBe('/tmp/b.txt');
    expect(extractFilePathFromToolInput({ relativePath: 'reports/monthly.md' })).toBe('reports/monthly.md');
  });

  it('returns null when input has no path-like keys', () => {
    expect(extractFilePathFromToolInput({ command: 'echo hi' })).toBeNull();
    expect(extractFilePathFromToolInput(undefined)).toBeNull();
  });
});
