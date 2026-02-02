import { describe, it, expect } from 'vitest';
import { extractFilePathFromToolOutput } from '../src/renderer/utils/tool-output-path';

describe('extractFilePathFromToolOutput', () => {
  it('extracts path from File written output', () => {
    const output = 'File written: /Users/haoqing/Desktop/report.docx';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/report.docx');
  });

  it('extracts path from File edited output', () => {
    const output = 'File edited: /Users/haoqing/Desktop/report.docx';
    expect(extractFilePathFromToolOutput(output)).toBe('/Users/haoqing/Desktop/report.docx');
  });

  it('extracts path from JSON output', () => {
    const output = JSON.stringify({ filePath: '/tmp/demo.txt' });
    expect(extractFilePathFromToolOutput(output)).toBe('/tmp/demo.txt');
  });

  it('returns null for unrelated output', () => {
    expect(extractFilePathFromToolOutput('OK')).toBeNull();
  });
});
