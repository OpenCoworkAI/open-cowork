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

  it('restores UNC hosts for Windows network share URLs on win32', () => {
    expect(localPathFromFileUrl('file://server/share/demo.txt', 'win32')).toBe(
      '\\\\server\\share\\demo.txt'
    );
  });

  it('returns forward-slash network path on non-Windows for UNC URLs', () => {
    expect(localPathFromFileUrl('file://server/share/demo.txt', 'darwin')).toBe(
      '//server/share/demo.txt'
    );
    expect(localPathFromFileUrl('file://server/share/demo.txt', 'linux')).toBe(
      '//server/share/demo.txt'
    );
  });

  it('treats file://localhost URLs as local files instead of UNC paths', () => {
    expect(localPathFromFileUrl('file://localhost/Users/demo/report.docx')).toBe(
      '/Users/demo/report.docx'
    );
  });

  it('returns null for empty or non-file URLs', () => {
    expect(localPathFromFileUrl('')).toBeNull();
    expect(localPathFromFileUrl('https://example.com')).toBeNull();
  });

  it('handles percent-encoded characters', () => {
    expect(localPathFromFileUrl('file:///home/user/my%20file.txt')).toBe(
      '/home/user/my file.txt'
    );
  });
});

describe('localPathFromAppUrlPathname', () => {
  it('keeps Windows drive pathnames local', () => {
    expect(localPathFromAppUrlPathname('/C:/Users/demo/report.docx')).toBe(
      'C:/Users/demo/report.docx'
    );
  });

  it('converts UNC-style pathnames to backslash on win32', () => {
    expect(localPathFromAppUrlPathname('//server/share/demo.txt', 'win32')).toBe(
      '\\\\server\\share\\demo.txt'
    );
  });

  it('keeps UNC-style pathnames as forward-slash on non-Windows', () => {
    expect(localPathFromAppUrlPathname('//server/share/demo.txt', 'darwin')).toBe(
      '//server/share/demo.txt'
    );
    expect(localPathFromAppUrlPathname('//server/share/demo.txt', 'linux')).toBe(
      '//server/share/demo.txt'
    );
  });

  it('allows additional absolute POSIX roots used by mounted workspaces', () => {
    expect(localPathFromAppUrlPathname('/mnt/c/work/demo.txt')).toBe('/mnt/c/work/demo.txt');
    expect(localPathFromAppUrlPathname('/Volumes/Data/demo.txt')).toBe('/Volumes/Data/demo.txt');
  });

  it('returns null for empty or unrecognized pathnames', () => {
    expect(localPathFromAppUrlPathname('')).toBeNull();
    expect(localPathFromAppUrlPathname('/random/unknown')).toBeNull();
  });
});
