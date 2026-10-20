/**
 * Packaged Electron image-resize support.
 *
 * worker_threads cannot load scripts from inside app.asar, and Node's ESM loader
 * does not see Electron's asar filesystem patch. Image reads therefore need the
 * worker script, sharp/@img natives, and photon wasm unpacked, and the worker
 * URL rewritten from app.asar to app.asar.unpacked.
 *
 * This file is plain CommonJS so the Electron main bundle can run it as a banner
 * before any dependency captures `worker_threads.Worker`.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { AsyncLocalStorage } = require('async_hooks');
const { fileURLToPath, pathToFileURL } = require('url');

const ASAR_SEGMENT = /app\.asar(?=\/|\\|$)/g;
const IMAGE_RESIZE_FAILURE_TEXT =
  /could not be resized below the inline image size limit|could not be converted to a supported inline image format/i;
const PATCHED_WORKER = '__openCoworkImageResizePatched';
const ERROR_SCOPE_KEY = '__openCoworkImageResizeErrorScope';

function rewriteAppAsarToUnpacked(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return filePath;
  return filePath.replace(ASAR_SEGMENT, 'app.asar.unpacked');
}

function specifierToPath(specifier) {
  if (typeof specifier === 'string') {
    if (specifier.startsWith('file:')) {
      try {
        return fileURLToPath(specifier);
      } catch {
        return specifier;
      }
    }
    return specifier;
  }
  if (specifier instanceof URL) {
    if (specifier.protocol === 'file:') {
      try {
        return fileURLToPath(specifier);
      } catch {
        return specifier.href;
      }
    }
    return specifier.href;
  }
  return String(specifier);
}

function isImageResizeWorkerSpecifier(specifier) {
  return specifierToPath(specifier).includes('image-resize-worker');
}

function resolvePackagedWorkerSpecifier(specifier, fileExists) {
  const exists = typeof fileExists === 'function' ? fileExists : fs.existsSync;
  if (!isImageResizeWorkerSpecifier(specifier)) return specifier;

  const originalPath = specifierToPath(specifier);
  const unpackedPath = rewriteAppAsarToUnpacked(originalPath);
  if (unpackedPath === originalPath || !exists(unpackedPath)) return specifier;

  if (
    specifier instanceof URL ||
    (typeof specifier === 'string' && specifier.startsWith('file:'))
  ) {
    return pathToFileURL(unpackedPath);
  }
  return unpackedPath;
}

function selectPhotonModulePath(resolvedPath, fileExists) {
  const exists = typeof fileExists === 'function' ? fileExists : fs.existsSync;
  if (typeof resolvedPath !== 'string' || resolvedPath.length === 0) return resolvedPath;
  const unpackedPath = rewriteAppAsarToUnpacked(resolvedPath);
  if (unpackedPath !== resolvedPath && exists(unpackedPath)) return unpackedPath;
  return resolvedPath;
}

function photonRequireBases() {
  const bases = [];
  if (typeof __filename === 'string' && __filename.length > 0) bases.push(__filename);
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    bases.push(path.join(process.resourcesPath, 'app.asar', 'package.json'));
  }
  bases.push(path.join(process.cwd(), 'package.json'));
  return bases;
}

function loadPhotonForPackagedApp() {
  let lastError = null;
  for (const base of photonRequireBases()) {
    try {
      const nodeRequire = createRequire(base);
      const resolved = nodeRequire.resolve('@silvia-odwyer/photon-node');
      const target = selectPhotonModulePath(resolved);
      return nodeRequire(target);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to resolve @silvia-odwyer/photon-node');
}

// Errors are collected per read call. The main bundle and the banner can each
// load a copy of this file, so both share one AsyncLocalStorage on globalThis.
function getImageResizeErrorScope() {
  if (!(globalThis[ERROR_SCOPE_KEY] instanceof AsyncLocalStorage)) {
    globalThis[ERROR_SCOPE_KEY] = new AsyncLocalStorage();
  }
  return globalThis[ERROR_SCOPE_KEY];
}

function recordImageResizeError(error) {
  const errors = getImageResizeErrorScope().getStore();
  if (Array.isArray(errors)) errors.push(error);
}

/**
 * Run `fn` with its own error list. Errors reported from `fn`'s async context
 * (including workers it creates) go to this list only, so concurrent reads
 * cannot pick up each other's errors.
 */
function collectImageResizeErrors(fn) {
  const errors = [];
  const result = getImageResizeErrorScope().run(errors, fn);
  return { result, errors };
}

function errorMessage(error) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function reportImageResizeError(error) {
  const hook = globalThis.__openCoworkReportImageResizeError;
  if (typeof hook === 'function') {
    hook(error);
    return;
  }
  recordImageResizeError(error);
  console.error('[ImageResize]', error);
}

function formatImageResizeFailure(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return '';
  return errors
    .map((error) => errorMessage(error).trim())
    .filter(Boolean)
    .map((message) => `Image resize error: ${message}`)
    .join('\n');
}

function isImageResizeFailureText(text) {
  return typeof text === 'string' && IMAGE_RESIZE_FAILURE_TEXT.test(text);
}

function annotateImageReadResult(result, errors) {
  const note = formatImageResizeFailure(errors);
  if (!note) return result;
  if (typeof result === 'string') {
    return isImageResizeFailureText(result) ? `${result}\n${note}` : result;
  }
  if (!result || typeof result !== 'object') return result;

  if (typeof result.content === 'string') {
    if (!isImageResizeFailureText(result.content)) return result;
    return { ...result, content: `${result.content}\n${note}` };
  }

  if (!Array.isArray(result.content)) return result;
  let matched = false;
  const content = result.content.map((part) => {
    if (!part || typeof part !== 'object' || typeof part.text !== 'string') return part;
    if (!isImageResizeFailureText(part.text)) return part;
    matched = true;
    return { ...part, text: `${part.text}\n${note}` };
  });
  if (!matched) return result;
  return { ...result, content };
}

function tapImageResizeWorker(worker) {
  const original = worker.on;
  if (typeof original !== 'function' || original.__openCoworkImageResizeTapped) return;
  // Bind worker failures to the read call that created the worker, not to
  // whichever call is active when the event fires.
  const scope = getImageResizeErrorScope();
  const ownerErrors = scope.getStore();
  const reportForOwner = (error) => scope.run(ownerErrors, () => reportImageResizeError(error));

  // EventEmitter#once delegates to this.on, so wrapping `on` covers once/addListener
  // without reporting the same failure twice.
  function tappedOn(event, listener, ...rest) {
    if ((event === 'error' || event === 'message') && typeof listener === 'function') {
      const wrapped = (payload) => {
        if (event === 'error') {
          reportForOwner(payload);
        } else if (
          payload &&
          typeof payload === 'object' &&
          typeof payload.error === 'string' &&
          payload.error
        ) {
          reportForOwner(new Error(payload.error));
        }
        return listener(payload);
      };
      return original.call(worker, event, wrapped, ...rest);
    }
    return original.call(worker, event, listener, ...rest);
  }

  tappedOn.__openCoworkImageResizeTapped = true;
  worker.on = tappedOn;
}

function installPackagedImageWorkerResolver(workerThreadsModule) {
  const workerThreads = workerThreadsModule || require('node:worker_threads');
  const OriginalWorker = workerThreads.Worker;
  if (typeof OriginalWorker !== 'function' || OriginalWorker[PATCHED_WORKER]) return;

  function PatchedWorker(specifier, options) {
    const resolved = resolvePackagedWorkerSpecifier(specifier);
    const worker =
      arguments.length > 1 ? new OriginalWorker(resolved, options) : new OriginalWorker(resolved);
    if (isImageResizeWorkerSpecifier(specifier) || isImageResizeWorkerSpecifier(resolved)) {
      tapImageResizeWorker(worker);
    }
    return worker;
  }

  Object.setPrototypeOf(PatchedWorker, OriginalWorker);
  PatchedWorker.prototype = OriginalWorker.prototype;
  PatchedWorker[PATCHED_WORKER] = true;
  workerThreads.Worker = PatchedWorker;
}

function ensureImageResizeReporting(report) {
  if (globalThis.__openCoworkImageResizeReportingInstalled) return;
  globalThis.__openCoworkImageResizeReportingInstalled = true;
  globalThis.__openCoworkReportImageResizeError = (error) => {
    recordImageResizeError(error);
    if (typeof report === 'function') report(error);
  };
  globalThis.__openCoworkLoadPhoton = () => loadPhotonForPackagedApp();
  installPackagedImageWorkerResolver();
}

function resetImageResizeReportingState() {
  delete globalThis.__openCoworkImageResizeReportingInstalled;
  delete globalThis.__openCoworkReportImageResizeError;
  delete globalThis.__openCoworkLoadPhoton;
  delete globalThis[ERROR_SCOPE_KEY];
}

function wrapReadToolForImageResizeErrors(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!tool || tool.name !== 'read' || typeof tool.execute !== 'function') return tool;
    const originalExecute = tool.execute.bind(tool);
    return {
      ...tool,
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        // The async wrapper turns a synchronous throw into a rejection handled below.
        const { result: pending, errors } = collectImageResizeErrors(async () =>
          originalExecute(toolCallId, params, signal, onUpdate, ctx)
        );
        try {
          const result = await pending;
          return annotateImageReadResult(result, errors.slice());
        } catch (error) {
          const extra = formatImageResizeFailure(errors.slice());
          if (extra && error instanceof Error && !error.message.includes(extra)) {
            error.message = `${error.message}\n${extra}`;
          }
          throw error;
        }
      },
    };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    annotateImageReadResult,
    collectImageResizeErrors,
    ensureImageResizeReporting,
    formatImageResizeFailure,
    installPackagedImageWorkerResolver,
    isImageResizeFailureText,
    isImageResizeWorkerSpecifier,
    loadPhotonForPackagedApp,
    photonRequireBases,
    reportImageResizeError,
    resetImageResizeReportingState,
    resolvePackagedWorkerSpecifier,
    rewriteAppAsarToUnpacked,
    selectPhotonModulePath,
    wrapReadToolForImageResizeErrors,
  };
}
