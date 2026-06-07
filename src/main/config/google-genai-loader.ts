/**
 * Load {@link GoogleGenAI} from the installed Node package at runtime.
 *
 * Electron main must not bundle @google/genai into the pi-ai mega-chunk (breaks
 * `client.models.get`). Vite marks the package as external; this loader uses
 * createRequire so the CJS build resolves `dist/node/index.cjs`.
 */
import { createRequire } from 'node:module';
type GoogleGenAIModule = typeof import('@google/genai');

const nodeRequire = createRequire(import.meta.url);

let GoogleGenAIClass: (typeof import('@google/genai'))['GoogleGenAI'] | undefined;

/**
 * Returns the GoogleGenAI constructor from node_modules (never from a Vite chunk).
 */
export function loadGoogleGenAI(): GoogleGenAIModule['GoogleGenAI'] {
  if (GoogleGenAIClass) {
    return GoogleGenAIClass;
  }

  const mod = nodeRequire('@google/genai') as GoogleGenAIModule & { default?: GoogleGenAIModule };
  const ctor =
    mod.GoogleGenAI ??
    (mod.default && 'GoogleGenAI' in mod.default ? mod.default.GoogleGenAI : undefined);

  if (!ctor) {
    throw new Error('@google/genai: GoogleGenAI export not found (check node_modules install)');
  }

  GoogleGenAIClass = ctor;
  return GoogleGenAIClass;
}

export type GoogleGenAIClient = InstanceType<GoogleGenAIModule['GoogleGenAI']>;

export function createGoogleGenAIClient(
  options: ConstructorParameters<GoogleGenAIModule['GoogleGenAI']>[0]
): GoogleGenAIClient {
  const GoogleGenAI = loadGoogleGenAI();
  return new GoogleGenAI(options);
}
