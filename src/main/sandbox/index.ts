/**
 * Sandbox Module - Main entry point
 * 
 * Exports all sandbox-related functionality.
 */

// Types
export * from './types';

// Core adapters
export { SandboxAdapter, getSandboxAdapter, initializeSandbox, shutdownSandbox } from './sandbox-adapter';
export type { SandboxMode, SandboxAdapterConfig } from './sandbox-adapter';

// Platform-specific executors
export { WSLBridge, pathConverter } from './wsl-bridge';
export { LimaBridge, limaPathConverter } from './lima-bridge';
export { NativeExecutor } from './native-executor';

// Path resolver (existing)
export { PathResolver } from './path-resolver';

// Sandbox isolation (new)
export { SandboxSync } from './sandbox-sync';
export type { SyncSession, SyncResult } from './sandbox-sync';
export { PathGuard } from './path-guard';
export type { ValidationResult } from './path-guard';
