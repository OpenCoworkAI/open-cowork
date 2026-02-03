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

  it('detects Chinese filenames at the start of a line', () => {
    const input = '简单销售报告.xlsx - 生成的Excel文件';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([
      { type: 'file', value: '简单销售报告.xlsx' },
      { type: 'text', value: ' - 生成的Excel文件' },
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

  it('does not treat numeric dimensions as filenames', () => {
    const input = 'HTML尺寸应该是10.0" × 5.6" (16:9比例)。';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('ignores filenames embedded in Chinese sentences without boundaries', () => {
    const input = '我看到已经有一个slide1.html文件了。让我创建其他幻灯片文件。先创建slide2.html:';
    const parts = splitTextByFileMentions(input);
    expect(parts).toEqual([{ type: 'text', value: input }]);
  });

  it('provides a left-aligned file link button class', () => {
    const className = getFileLinkButtonClassName();
    expect(className).toContain('text-left');
    expect(className).toContain('break-all');
  });
});
