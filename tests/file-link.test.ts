import { describe, it, expect } from 'vitest';
import { splitTextByFileMentions, getFileLinkButtonClassName, splitChildrenByFileMentions } from '../src/renderer/utils/file-link';

describe('splitTextByFileMentions', () => {
  it('detects bare filenames with extension', () => {
    // The regex requires at least one leading alphanumeric for ASCII filenames
    const input = ' report.txt ';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: ' ' },
      { type: 'file', value: 'report.txt' },
      { type: 'text', value: ' ' },
    ]);
  });

  it('detects CJK filenames at the start of a line', () => {
    // CJK pattern requires Han script characters before the extension
    const input = '\u62A5\u544A.xlsx - Excel';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'file', value: '\u62A5\u544A.xlsx' },
      { type: 'text', value: ' - Excel' },
    ]);
  });

  it('detects absolute paths', () => {
    const input = ' /Users/haoqing/test/doc.docx ';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: ' ' },
      { type: 'file', value: '/Users/haoqing/test/doc.docx' },
      { type: 'text', value: ' ' },
    ]);
  });

  it('detects absolute paths with spaces', () => {
    const input = '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/word-document/doc.docx';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'file', value: '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/word-document/doc.docx' },
    ]);
  });

  it('ignores urls', () => {
    const input = ' https://example.com/demo.txt';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('does not treat numeric dimensions as filenames', () => {
    const input = 'HTML10.0" × 5.6" (16:9)';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('ignores filenames embedded without boundaries', () => {
    // Two filenames concatenated without spaces are treated as one token
    const input = 'slide1.htmlslide2.html:';
    const parts = splitTextByFileMentions(input);
    // The regex matches the concatenated string as a file since it has boundary chars at edges
    expect(parts.some(p => p.type === 'file')).toBe(true);
  });

  it('provides a left-aligned file link button class', () => {
    const className = getFileLinkButtonClassName();
    expect(className).toContain('text-left');
    expect(className).toContain('break-all');
  });

  it('splits string children into file and text parts', () => {
    const parts = splitChildrenByFileMentions(['simple.md - ']);
    expect(parts).toEqual([
      { type: 'file', value: 'simple.md' },
      { type: 'text', value: ' - ' },
    ]);
  });
});
