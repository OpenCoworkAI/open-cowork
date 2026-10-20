import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  annotateImageReadResult,
  collectImageResizeErrors,
  formatImageResizeFailure,
  installPackagedImageWorkerResolver,
  reportImageResizeError,
  resetImageResizeReportingState,
  resolvePackagedWorkerSpecifier,
  rewriteAppAsarToUnpacked,
  selectPhotonModulePath,
  wrapReadToolForImageResizeErrors,
} from '../../main/agent/image-resize-packaging';

const WINDOWS_PACKED =
  'C:\\Users\\me\\AppData\\Local\\Programs\\Open Cowork\\resources\\app.asar\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\utils\\image-resize-worker.js';

afterEach(() => {
  resetImageResizeReportingState();
});

describe('rewriteAppAsarToUnpacked', () => {
  it('rewrites a Windows asar path and leaves an unpacked path unchanged', () => {
    const unpacked = WINDOWS_PACKED.replace('app.asar', 'app.asar.unpacked');
    expect(rewriteAppAsarToUnpacked(WINDOWS_PACKED)).toBe(unpacked);
    expect(rewriteAppAsarToUnpacked(unpacked)).toBe(unpacked);
  });

  it('does not rewrite names that merely start with app.asar', () => {
    expect(rewriteAppAsarToUnpacked('/tmp/app.asarbad/image-resize-worker.js')).toBe(
      '/tmp/app.asarbad/image-resize-worker.js'
    );
  });
});

describe('resolvePackagedWorkerSpecifier', () => {
  it('points a packaged worker URL at app.asar.unpacked when that file exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-resize-worker-'));
    const packedPath = path.join(
      root,
      'app.asar',
      'node_modules',
      'pkg',
      'dist',
      'utils',
      'image-resize-worker.js'
    );
    const unpackedPath = rewriteAppAsarToUnpacked(packedPath);
    fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
    fs.writeFileSync(unpackedPath, 'worker');

    const resolved = resolvePackagedWorkerSpecifier(pathToFileURL(packedPath));
    expect(resolved).toBeInstanceOf(URL);
    expect(fileURLToPath(resolved as URL)).toBe(unpackedPath);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps the original specifier when the unpacked worker is missing', () => {
    const specifier = pathToFileURL('/tmp/resources/app.asar/image-resize-worker.js');
    expect(resolvePackagedWorkerSpecifier(specifier, () => false)).toBe(specifier);
  });

  it('leaves dev paths and non-image workers alone', () => {
    expect(resolvePackagedWorkerSpecifier('./image-resize-worker.js', () => true)).toBe(
      './image-resize-worker.js'
    );
    const other = pathToFileURL('/tmp/resources/app.asar/node_modules/other-worker.js');
    expect(resolvePackagedWorkerSpecifier(other, () => true)).toBe(other);
  });

  it('rewrites a Windows path string when the caller says the unpacked file exists', () => {
    const unpacked = rewriteAppAsarToUnpacked(WINDOWS_PACKED);
    expect(
      resolvePackagedWorkerSpecifier(WINDOWS_PACKED, (filePath) => filePath === unpacked)
    ).toBe(unpacked);
  });
});

describe('selectPhotonModulePath', () => {
  it('prefers the unpacked photon module when it exists', () => {
    const packed =
      'C:\\Program Files\\Open Cowork\\resources\\app.asar\\node_modules\\@silvia-odwyer\\photon-node\\photon_rs.js';
    const unpacked = rewriteAppAsarToUnpacked(packed);
    expect(selectPhotonModulePath(packed, (filePath) => filePath === unpacked)).toBe(unpacked);
    expect(selectPhotonModulePath(packed, () => false)).toBe(packed);
    expect(selectPhotonModulePath(unpacked, () => true)).toBe(unpacked);
  });
});

describe('image resize failure reporting', () => {
  it('formats the underlying error for the tool caller', () => {
    expect(formatImageResizeFailure([new Error('Cannot find module image-resize-worker.js')])).toBe(
      'Image resize error: Cannot find module image-resize-worker.js'
    );
  });

  it('appends the real error to the generic resize failure and logs it', async () => {
    const tools = wrapReadToolForImageResizeErrors([
      {
        name: 'read',
        async execute(
          _toolCallId: string,
          _params: unknown,
          _signal: AbortSignal | undefined,
          _onUpdate: unknown,
          _ctx: unknown
        ) {
          reportImageResizeError(new Error('ERR_DLOPEN_FAILED: sharp.node'));
          return {
            content: [
              {
                type: 'text',
                text: 'Read image file [image/jpeg]\n[Image omitted: could not be resized below the inline image size limit.]',
              },
            ],
          };
        },
      },
      {
        name: 'bash',
        async execute(
          _toolCallId: string,
          _params: unknown,
          _signal: AbortSignal | undefined,
          _onUpdate: unknown,
          _ctx: unknown
        ) {
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      },
    ]);

    const result = (await tools[0].execute(
      'call-1',
      { path: 'a.jpg' },
      undefined,
      undefined,
      {}
    )) as {
      content: Array<{ text: string }>;
    };

    expect(result.content[0].text).toContain(
      'could not be resized below the inline image size limit'
    );
    expect(result.content[0].text).toContain('Image resize error: ERR_DLOPEN_FAILED: sharp.node');
    const bashResult = await tools[1].execute('call-2', {}, undefined, undefined, {});
    expect(bashResult).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('keeps a successful image result when resize only logged a recovered failure', async () => {
    const tools = wrapReadToolForImageResizeErrors([
      {
        name: 'read',
        async execute(
          _toolCallId: string,
          _params: unknown,
          _signal: AbortSignal | undefined,
          _onUpdate: unknown,
          _ctx: unknown
        ) {
          reportImageResizeError(new Error('worker failed open'));
          return {
            content: [
              { type: 'text', text: 'Read image file [image/png]' },
              { type: 'image', data: 'aaaa', mimeType: 'image/png' },
            ],
          };
        },
      },
    ]);

    const result = await tools[0].execute('call', {}, undefined, undefined, {});
    expect(result).toEqual({
      content: [
        { type: 'text', text: 'Read image file [image/png]' },
        { type: 'image', data: 'aaaa', mimeType: 'image/png' },
      ],
    });
  });

  it('surfaces a thrown worker error on the tool error', async () => {
    const tools = wrapReadToolForImageResizeErrors([
      {
        name: 'read',
        async execute(
          _toolCallId: string,
          _params: unknown,
          _signal: AbortSignal | undefined,
          _onUpdate: unknown,
          _ctx: unknown
        ) {
          reportImageResizeError(new Error('worker exited with code 1'));
          throw new Error('read failed');
        },
      },
    ]);

    await expect(tools[0].execute('call', {}, undefined, undefined, {})).rejects.toThrow(
      /read failed[\s\S]*Image resize error: worker exited with code 1/
    );
  });
});

describe('per-call image resize error collection', () => {
  const FAILURE_TEXT = '[Image omitted: could not be resized below the inline image size limit.]';

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it('attaches each error to the concurrent read that reported it', async () => {
    const firstMayReport = deferred();
    const secondReported = deferred();
    const tools = wrapReadToolForImageResizeErrors([
      {
        name: 'read',
        async execute(
          _toolCallId: string,
          params: unknown,
          _signal: AbortSignal | undefined,
          _onUpdate: unknown,
          _ctx: unknown
        ) {
          const file = (params as { path: string }).path;
          if (file === 'a.jpg') {
            await firstMayReport.promise;
            reportImageResizeError(new Error('error from a.jpg'));
          } else {
            reportImageResizeError(new Error('error from b.jpg'));
            secondReported.resolve();
            await new Promise((r) => setTimeout(r, 5));
          }
          return { content: [{ type: 'text', text: `${file}\n${FAILURE_TEXT}` }] };
        },
      },
    ]);

    const first = tools[0].execute('call-a', { path: 'a.jpg' }, undefined, undefined, {});
    const second = tools[0].execute('call-b', { path: 'b.jpg' }, undefined, undefined, {});
    await secondReported.promise;
    firstMayReport.resolve();

    const [a, b] = (await Promise.all([first, second])) as Array<{
      content: Array<{ text: string }>;
    }>;
    expect(a.content[0].text).toContain('Image resize error: error from a.jpg');
    expect(a.content[0].text).not.toContain('b.jpg');
    expect(b.content[0].text).toContain('Image resize error: error from b.jpg');
    expect(b.content[0].text).not.toContain('a.jpg');
  });

  it('does not carry an error reported outside a read into the next read', async () => {
    reportImageResizeError(new Error('stray error'));
    const tools = wrapReadToolForImageResizeErrors([
      {
        name: 'read',
        async execute(
          _toolCallId: string,
          _params: unknown,
          _signal: AbortSignal | undefined,
          _onUpdate: unknown,
          _ctx: unknown
        ) {
          return { content: [{ type: 'text', text: FAILURE_TEXT }] };
        },
      },
    ]);
    const result = (await tools[0].execute('call', {}, undefined, undefined, {})) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0].text).toBe(FAILURE_TEXT);
  });

  it('collects errors only inside its own scope', async () => {
    const outer = collectImageResizeErrors(async () => {
      const inner = collectImageResizeErrors(() => {
        reportImageResizeError(new Error('inner'));
      });
      await Promise.resolve();
      reportImageResizeError(new Error('outer'));
      return inner.errors;
    });
    const innerErrors = await outer.result;
    expect(innerErrors.map((e) => (e as Error).message)).toEqual(['inner']);
    expect(outer.errors.map((e) => (e as Error).message)).toEqual(['outer']);
  });
});

describe('installPackagedImageWorkerResolver', () => {
  it('loads the unpacked worker script and records worker failures', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-resize-install-'));
    const packedPath = path.join(root, 'app.asar', 'image-resize-worker.js');
    const unpackedPath = path.join(root, 'app.asar.unpacked', 'image-resize-worker.js');
    fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
    fs.writeFileSync(unpackedPath, 'worker');

    class FakeWorker {
      specifier: string | URL;
      events: Record<string, (payload: unknown) => void> = {};

      constructor(specifier: string | URL) {
        this.specifier = specifier;
      }

      on(event: string, listener: (payload: unknown) => void) {
        this.events[event] = listener;
        return this;
      }

      once(event: string, listener: (payload: unknown) => void) {
        return this.on(event, listener);
      }
    }

    const workerThreads = { Worker: FakeWorker };
    installPackagedImageWorkerResolver(workerThreads);

    const owner = collectImageResizeErrors(
      () => new workerThreads.Worker(pathToFileURL(packedPath))
    );
    const worker = owner.result;
    expect(fileURLToPath(worker.specifier)).toBe(unpackedPath);

    // Events fire after the creating call returned and while another call is
    // active; they still belong to the call that created the worker.
    const other = collectImageResizeErrors(() => {
      worker.once('error', () => undefined);
      worker.events.error(new Error('Cannot find module'));
      worker.once('message', () => undefined);
      worker.events.message({ error: 'Failed to load @silvia-odwyer/photon-node' });
    });

    expect(owner.errors.map((error) => (error as Error).message)).toEqual([
      'Cannot find module',
      'Failed to load @silvia-odwyer/photon-node',
    ]);
    expect(other.errors).toEqual([]);

    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('packaging config', () => {
  it('unpacks the image worker, sharp, @img, and photon', () => {
    const builder = fs.readFileSync(path.resolve(process.cwd(), 'electron-builder.yml'), 'utf8');
    expect(builder).toContain("'**/image-resize-worker*.js'");
    expect(builder).toContain("'**/node_modules/sharp/**/*'");
    expect(builder).toContain("'**/node_modules/@img/**/*'");
    expect(builder).toContain("'**/node_modules/@silvia-odwyer/**/*'");
    expect(builder).toContain('node_modules/sharp/**/*');
    expect(builder).toContain('node_modules/@silvia-odwyer/**/*');
  });

  it('installs the worker resolver before the main bundle evaluates', () => {
    const viteConfig = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('image-resize-packaging.cjs');
    expect(viteConfig).toContain('installPackagedImageWorkerResolver()');
    expect(viteConfig).toContain('banner: imageResizeWorkerBanner');
  });

  it('annotates an image read result without mutating the original', () => {
    const original = {
      content: [
        {
          type: 'text',
          text: '[Image omitted: could not be resized below the inline image size limit.]',
        },
      ],
    };
    const annotated = annotateImageReadResult(original, [new Error('import() failed inside asar')]);
    expect(annotated).not.toBe(original);
    expect(original.content[0].text).not.toContain('import() failed');
    expect(annotated.content[0].text).toContain('Image resize error: import() failed inside asar');
  });
});
