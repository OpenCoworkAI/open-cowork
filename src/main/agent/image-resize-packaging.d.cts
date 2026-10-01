export function rewriteAppAsarToUnpacked(filePath: string): string;

export function resolvePackagedWorkerSpecifier(
  specifier: string | URL,
  fileExists?: (filePath: string) => boolean
): string | URL;

export function selectPhotonModulePath(
  resolvedPath: string,
  fileExists?: (filePath: string) => boolean
): string;

export function photonRequireBases(): string[];

export function isImageResizeFailureText(text: string): boolean;

export function formatImageResizeFailure(errors: readonly unknown[]): string;

export function annotateImageReadResult<T>(result: T, errors: readonly unknown[]): T;

export function collectImageResizeErrors<T>(fn: () => T): { result: T; errors: unknown[] };

export function reportImageResizeError(error: unknown): void;

export function installPackagedImageWorkerResolver(workerThreadsModule?: {
  Worker?: unknown;
}): void;

export function ensureImageResizeReporting(report: (error: unknown) => void): void;

export function resetImageResizeReportingState(): void;

export type ImageResizeAwareTool = {
  name?: string;
  execute?(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown
  ): Promise<unknown>;
};

export function wrapReadToolForImageResizeErrors<T extends ImageResizeAwareTool>(tools: T[]): T[];
