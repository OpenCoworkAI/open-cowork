/**
 * VM Module - Main entry point
 *
 * Exports the VM progress tracking system and computer use controller
 * for integration with the Open Claw career agent.
 *
 * Usage:
 *   import { CareerAgentBridge, VMProgressTracker, ComputerUseController } from './vm';
 */

// Types
export * from './types';

// Core services
export { VMProgressTracker } from './vm-progress-tracker';
export type { ProgressTrackerConfig, VMProgressEvent, ProgressUpdateCallback } from './vm-progress-tracker';

export { ComputerUseController } from './computer-use-controller';
export type { ComputerUseConfig } from './computer-use-controller';

export { CareerAgentBridge } from './career-agent-bridge';
export type { CareerAgentBridgeConfig, BridgeStatus } from './career-agent-bridge';
