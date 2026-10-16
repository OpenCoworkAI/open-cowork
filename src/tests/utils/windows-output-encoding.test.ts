import { describe, expect, it } from 'vitest';
import {
  createWindowsOutputNormalizer,
  getWindowsConsoleCodePage,
} from '../../main/utils/windows-output-encoding';

function decodeAll(normalize: (chunk: Buffer) => Buffer, chunks: number[][]): string {
  return chunks
    .map((bytes) => Buffer.from(bytes))
    .map(normalize)
    .map((buffer) => buffer.toString('utf-8'))
    .join('');
}

describe('createWindowsOutputNormalizer', () => {
  it('decodes GBK (CP936) bytes into UTF-8', () => {
    const normalize = createWindowsOutputNormalizer(936);
    expect(normalize).not.toBeNull();
    // GBK bytes for 你好
    expect(normalize!(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])).toString('utf-8')).toBe('你好');
  });

  it('handles multi-byte characters split across chunk boundaries', () => {
    const normalize = createWindowsOutputNormalizer(936)!;
    expect(decodeAll(normalize, [[0xc4], [0xe3, 0xba], [0xc3]])).toBe('你好');
    expect(decodeAll(normalize, [[0xc4, 0xe3], [0xba, 0xc3]])).toBe('你好');
    expect(decodeAll(normalize, [[0xc4], [0xe3], [0xba], [0xc3]])).toBe('你好');
  });

  it('decodes other multi-byte codepages', () => {
    const sjis = createWindowsOutputNormalizer(932)!;
    expect(sjis(Buffer.from([0x82, 0xa0])).toString('utf-8')).toBe('あ');

    const big5 = createWindowsOutputNormalizer(950)!;
    expect(big5(Buffer.from([0xa4, 0xa4])).toString('utf-8')).toBe('中');

    const eucKr = createWindowsOutputNormalizer(949)!;
    expect(eucKr(Buffer.from([0xc7, 0xd1])).toString('utf-8')).toBe('한');
  });

  it('passes ASCII bytes through untouched', () => {
    const normalize = createWindowsOutputNormalizer(936)!;
    const input = Buffer.from('echo hello', 'ascii');
    expect(normalize(input).equals(input)).toBe(true);
    expect(decodeAll(normalize, [[0x65, 0x63, 0x68, 0x6f], [0x20, 0x68, 0x65, 0x6c, 0x6c, 0x6f]])).toBe(
      'echo hello'
    );
  });

  it('passes valid UTF-8 through untouched, including across chunks', () => {
    const normalize = createWindowsOutputNormalizer(936)!;
    const utf8 = Buffer.from('你好', 'utf-8');
    expect(normalize(utf8).equals(utf8)).toBe(true);
    expect(decodeAll(normalize, [[0xe4, 0xbd], [0xa0, 0xe5], [0xa5, 0xbd]])).toBe('你好');
  });

  it('keeps a confirmed UTF-8 prefix and converts only the trailing OEM bytes', () => {
    const normalize = createWindowsOutputNormalizer(936)!;
    // '好' as UTF-8, then GBK bytes for 你
    expect(decodeAll(normalize, [[0xe5, 0xa5, 0xbd], [0xc4, 0xe3]])).toBe('好你');
  });

  it('switches to the OEM codepage once invalid UTF-8 appears', () => {
    const normalize = createWindowsOutputNormalizer(936)!;
    // ASCII prefix + GBK 你好 in a single chunk
    expect(decodeAll(normalize, [[0x6f, 0x6b, 0x20, 0xc4, 0xe3, 0xba, 0xc3]])).toBe('ok 你好');
  });

  it('keeps per-stream instances isolated', () => {
    const stdoutNormalizer = createWindowsOutputNormalizer(936)!;
    const stderrNormalizer = createWindowsOutputNormalizer(936)!;
    // stdout holds back a truncated GBK lead byte in its internal buffer.
    stdoutNormalizer(Buffer.from([0xc4]));
    // stderr sees a complete byte stream unaffected by stdout's pending state.
    expect(stderrNormalizer(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])).toString('utf-8')).toBe('你好');
    // stdout completes and still decodes correctly.
    expect(stdoutNormalizer(Buffer.from([0xe3, 0xba, 0xc3])).toString('utf-8')).toBe('你好');
  });

  it('returns null when no conversion is needed or possible', () => {
    expect(createWindowsOutputNormalizer(65001)).toBeNull();
    expect(createWindowsOutputNormalizer(null)).toBeNull();
    expect(createWindowsOutputNormalizer(999)).toBeNull();
  });
});

describe('getWindowsConsoleCodePage', () => {
  it('detects a code page on Windows and no-ops elsewhere', async () => {
    const result = await getWindowsConsoleCodePage();
    if (process.platform === 'win32') {
      expect(result === null || typeof result === 'number').toBe(true);
    } else {
      expect(result).toBeNull();
    }
  });
});
