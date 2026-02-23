/**
 * OpenClaw — The Career Agent
 *
 * OpenClaw is the user's dedicated career co-worker, baked into the
 * Coeadapt platform and available standalone. It grabs opportunities
 * and never lets go.
 *
 * Architecture:
 *   agent/             Core agent runtime (session, routing, pipeline)
 *   skills/            Pluggable skill modules
 *     career-dev/      Career development (plans, resumes, interview prep)
 *     platform-connect/ Coeadapt platform bridge (sync, API access)
 *   environment/       Co-working workspace (artifacts, documents, drafts)
 *   server/            Standalone server entry point (MCP-based)
 *   types/             Shared type definitions
 */

export { OpenClawAgent } from './agent';
export { OpenClawEnvironment } from './environment';
export { CareerDevSkill } from './skills/career-dev';
export { PlatformConnectSkill } from './skills/platform-connect';
export * from './types';
