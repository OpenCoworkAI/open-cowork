import { describe, expect, it } from 'vitest';
import {
  localPathFromAppUrlPathname,
  localPathFromFileUrl,
} from '../src/shared/local-file-path';

describe('localPathFromFileUrl', () => {
  it('preserves Windows drive file URLs', () => {
    expect(localPathFromFileUrl('file:///C:/Users/demo/report.docx')).toBe(
      'C:/Users/demo/report.docx'
    );
  });

  it('restores UNC hosts for Windows network share URLs', () => {
    expect(localPathFromFileUrl('file://server/share/demo.txt')).toBe(
      '\\\\server\\share\\demo.txt'
    );
  });

  it('treats file://localhost URLs as local files instead of UNC paths', () => {
    expect(localPathFromFileUrl('file://localhost/Users/demo/report.docx')).toBe(
      '/Users/demo/report.docx'
    );
  });
});

describe('localPathFromAppUrlPathname', () => {
  it('keeps Windows drive pathnames local', () => {
    expect(localPathFromAppUrlPathname('/C:/Users/demo/report.docx')).toBe(
      'C:/Users/demo/report.docx'
    );
  });

  it('converts UNC-style pathnames emitted by app links', () => {
    expect(localPathFromAppUrlPathname('//server/share/demo.txt')).toBe(
      '\\\\server\\share\\demo.txt'
    );
  });

  it('allows additional absolute POSIX roots used by mounted workspaces', () => {
    expect(localPathFromAppUrlPathname('/mnt/c/work/demo.txt')).toBe('/mnt/c/work/demo.txt');
    expect(localPathFromAppUrlPathname('/Volumes/Data/demo.txt')).toBe('/Volumes/Data/demo.txt');
  });
});
