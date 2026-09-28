import { execFile } from 'child_process';
import { promisify } from 'util';
import { platform } from 'os';

const execFileAsync = promisify(execFile);

const OEM_CODE_PAGE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage';

// Windows console codepage => WHATWG TextDecoder label.
// Single-byte western codepages are included for completeness, but in practice
// their output is ASCII (which is already valid UTF-8), so decoding is a no-op.
const CODEPAGE_TO_DECODER_LABEL: Record<number, string> = {
  874: 'windows-874',
  866: 'ibm866',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
  54936: 'gb18030',
};

let cachedCodePage: number | null | undefined;

async function readOemCodePageFromRegistry(): Promise<number | null> {
  const { stdout } = await execFileAsync(
    'reg',
    ['query', OEM_CODE_PAGE_KEY, '/v', 'OEMCP'],
    { timeout: 5000, windowsHide: true }
  );
  const match = /OEMCP\s+REG_SZ\s+(\d+)/i.exec(stdout);
  return match ? Number(match[1]) : null;
}

async function readCodePageFromChcp(): Promise<number | null> {
  const { stdout } = await execFileAsync('cmd.exe', ['/d', '/c', 'chcp'], {
    timeout: 5000,
    windowsHide: true,
  });
  const match = /(\d+)/.exec(stdout);
  return match ? Number(match[1]) : null;
}

/**
 * Detect the current Windows OEM codepage. On non-Windows hosts (or when
 * detection fails) this returns null.
 *
 * `reg query` reads the system OEM codepage directly from the registry and
 * does not require an attached console, unlike `chcp`.
 */
export async function getWindowsConsoleCodePage(): Promise<number | null> {
  if (cachedCodePage !== undefined) {
    return cachedCodePage;
  }
  if (platform() !== 'win32') {
    cachedCodePage = null;
    return cachedCodePage;
  }

  let codePage: number | null = null;
  try {
    codePage = await readOemCodePageFromRegistry();
  } catch {
    // Registry read failed; fall back to chcp below.
  }
  if (codePage === null) {
    try {
      codePage = await readCodePageFromChcp();
    } catch {
      // Unable to determine the codepage; skip normalization.
    }
  }

  cachedCodePage = codePage;
  return codePage;
}

/**
 * A normalizer that re-encodes a non-UTF-8 codepage byte stream into UTF-8.
 * It is streaming-safe: multi-byte characters split across chunks are
 * accumulated by the underlying TextDecoder.
 */
export type OutputNormalizer = (chunk: Buffer) => Buffer;

/**
 * A normalizer adaptively converts a non-UTF-8 codepage byte stream into
 * UTF-8 by inspecting the bytes themselves instead of naming the producing
 * shell.
 *
 * The returned closure is stateful (it buffers undecided tail bytes and
 * remembers once it has switched to the OEM codepage), so it must be bound to
 * a single logical byte stream. Callers that capture two streams — e.g.
 * stdout and stderr — must create one instance per stream from the same
 * code-page read.
 *
 * A trailing incomplete multi-byte sequence at the end of stream is
 * intentionally not flushed: its encoding cannot be determined, and it only
 * occurs when output is cut mid-character, in which case the surrounding
 * output is corrupt anyway.
 */

interface Utf8Classification {
  /** Index of the first byte of an invalid UTF-8 sequence, or -1. */
  invalidAt: number;
  /** Index where a valid-but-truncated sequence starts at the buffer end, or -1. */
  incompleteAt: number;
}

function hasContinuationByte(b: number): boolean {
  return (b & 0xc0) === 0x80;
}

/**
 * Classify a byte buffer against strict UTF-8 rules. A strict classifier is
 * required because a lenient one would accept GBK/Shift-JIS bytes as UTF-8
 * (the original source of the mojibake) and because truncated lead bytes must
 * not be mistaken for invalid data.
 */
function classifyUtf8(buf: Buffer): Utf8Classification {
  const n = buf.length;
  let i = 0;
  while (i < n) {
    const b = buf[i];
    if (b < 0x80) {
      i++;
      continue;
    }

    let len: number;
    if (b >= 0xc2 && b <= 0xdf) {
      len = 2;
    } else if (b === 0xe0 || b === 0xed) {
      len = 3;
    } else if (b >= 0xe1 && b <= 0xef) {
      len = 3;
    } else if (b >= 0xf0 && b <= 0xf4) {
      len = 4;
    } else {
      // 0x80-0xc1 (stray continuation/overlong lead) or 0xf5-0xff.
      return { invalidAt: i, incompleteAt: -1 };
    }

    const available = n - i;
    if (available < len) {
      // Valid lead byte but the sequence is truncated at the buffer end.
      // Validate whatever continuation bytes are present.
      for (let j = 1; j < available; j++) {
        if (!hasContinuationByte(buf[i + j])) {
          return { invalidAt: i + j, incompleteAt: -1 };
        }
      }
      if (available >= 2) {
        const second = buf[i + 1];
        if (b === 0xe0 && second < 0xa0) {
          return { invalidAt: i + 1, incompleteAt: -1 };
        }
        if (b === 0xed && second > 0x9f) {
          return { invalidAt: i + 1, incompleteAt: -1 };
        }
        if (b === 0xf0 && second < 0x90) {
          return { invalidAt: i + 1, incompleteAt: -1 };
        }
        if (b === 0xf4 && second > 0x8f) {
          return { invalidAt: i + 1, incompleteAt: -1 };
        }
      }
      return { invalidAt: -1, incompleteAt: i };
    }

    for (let j = 1; j < len; j++) {
      if (!hasContinuationByte(buf[i + j])) {
        return { invalidAt: i + j, incompleteAt: -1 };
      }
    }
    if (b === 0xe0 && buf[i + 1] < 0xa0) {
      return { invalidAt: i + 1, incompleteAt: -1 };
    }
    if (b === 0xed && buf[i + 1] > 0x9f) {
      return { invalidAt: i + 1, incompleteAt: -1 };
    }
    if (b === 0xf0 && buf[i + 1] < 0x90) {
      return { invalidAt: i + 1, incompleteAt: -1 };
    }
    if (b === 0xf4 && buf[i + 1] > 0x8f) {
      return { invalidAt: i + 1, incompleteAt: -1 };
    }

    i += len;
  }
  return { invalidAt: -1, incompleteAt: -1 };
}

/**
 * Create an output normalizer for a Windows console codepage, or null when no
 * conversion is needed/possible.
 *
 * Instead of naming the producing shell, it inspects the byte stream itself:
 * as long as the stream is valid UTF-8 (ASCII included) it is passed through
 * untouched, so shells that already emit UTF-8 are never mis-decoded. Only
 * when invalid UTF-8 bytes appear does it switch to decoding the rest from the
 * OEM codepage. This adapts to arbitrary shells/consumers without an
 * enumeration of shell names.
 */
export function createWindowsOutputNormalizer(codePage: number | null): OutputNormalizer | null {
  if (codePage === null || codePage === 65001) {
    return null;
  }
  const label = CODEPAGE_TO_DECODER_LABEL[codePage];
  if (!label) {
    return null;
  }

  let oemDecoder: TextDecoder;
  try {
    oemDecoder = new TextDecoder(label, { fatal: false });
  } catch {
    // Encoding not supported by this ICU build; leave bytes untouched.
    return null;
  }

  let pending: Buffer = Buffer.alloc(0);
  let inOemMode = false;

  return (chunk: Buffer): Buffer => {
    if (inOemMode) {
      return Buffer.from(oemDecoder.decode(chunk, { stream: true }), 'utf-8');
    }

    const combined = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
    const scan = classifyUtf8(combined);

    if (scan.invalidAt !== -1) {
      // Invalid UTF-8 seen: the stream is not UTF-8. Everything up to the
      // invalid byte is flushed through the OEM decoder (re-buffered bytes),
      // then the rest, after which all further output is OEM-decoded.
      inOemMode = true;
      const prefix = combined.subarray(0, scan.invalidAt);
      const tail = combined.subarray(scan.invalidAt);
      const text =
        oemDecoder.decode(prefix, { stream: true }) +
        oemDecoder.decode(tail, { stream: true });
      pending = Buffer.alloc(0);
      return Buffer.from(text, 'utf-8');
    }

    if (scan.incompleteAt !== -1) {
      // Valid UTF-8 up to a truncated sequence at the end of the chunk; hold
      // only the undecided tail and pass the confirmed prefix through.
      const prefix = combined.subarray(0, scan.incompleteAt);
      pending = combined.subarray(scan.incompleteAt);
      return prefix.length > 0 ? Buffer.from(prefix) : Buffer.alloc(0);
    }

    // Entire chunk is valid UTF-8; pass through without any conversion.
    pending = Buffer.alloc(0);
    return combined;
  };
}
