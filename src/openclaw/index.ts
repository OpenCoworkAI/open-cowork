/**
 * Navi — The Career Navigation Agent
 *
 * Navi is the user's dedicated career co-worker, baked into the
 * Coeadapt platform and available standalone. Its signature capability
 * is Skillception — skills for building skills.
 *
 * Architecture:
 *   agent/                Core agent runtime (session, routing, pipeline)
 *   skills/               Pluggable skill modules
 *     career-dev/         Career development (plans, resumes, interview prep)
 *     platform-connect/   Coeadapt platform bridge (sync, API access)
 *     skillception/       Skill tree engine (prerequisites, evidence, unlocks)
 *   environment/          Co-working workspace (artifacts, documents, drafts)
 *   server/               Standalone server entry point (MCP-based)
 *   types/                Shared type definitions
 */

export { NaviAgent, OpenClawAgent } from './agent';
export { OpenClawEnvironment } from './environment';
export { CareerDevSkill } from './skills/career-dev';
export { PlatformConnectSkill } from './skills/platform-connect';
export { SkillceptionSkill } from './skills/skillception';
export * from './types';
