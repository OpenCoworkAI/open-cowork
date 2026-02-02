import { describe, it, expect } from 'vitest';
import { splitTextByFileMentions, getFileLinkButtonClassName } from '../src/renderer/utils/file-link';

describe('splitTextByFileMentions', () => {
  it('detects bare filenames with extension', () => {
    const input = '打开 示例文档.txt 查看';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: '打开 ' },
      { type: 'file', value: '示例文档.txt' },
      { type: 'text', value: ' 查看' },
    ]);
  });

  it('detects absolute paths', () => {
    const input = '路径 /Users/haoqing/test/报告.docx 已生成';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: '路径 ' },
      { type: 'file', value: '/Users/haoqing/test/报告.docx' },
      { type: 'text', value: ' 已生成' },
    ]);
  });

  it('detects absolute paths with spaces', () => {
    const input = '文档已保存为：/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/word-document/示例文档.docx';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'text', value: '文档已保存为：' },
      { type: 'file', value: '/Users/haoqing/Library/Application Support/open-cowork/default_working_dir/word-document/示例文档.docx' },
    ]);
  });

  it('ignores urls', () => {
    const input = '查看 https://example.com/demo.txt';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('provides a left-aligned file link button class', () => {
    const className = getFileLinkButtonClassName();
    expect(className).toContain('text-left');
    expect(className).toContain('break-all');
  });
});
