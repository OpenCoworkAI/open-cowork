export {
  AGGREGATE_BY_OPERATION,
  AGGREGATE_ORDER,
  BATCH_COMMANDS_ARG,
  OBSERVATION_OPERATIONS,
  PHYSICAL_INPUT_OPERATIONS,
  UPSTREAM_CONTRACT_TAG,
  UPSTREAM_TOOL_PREFIX,
  aggregateToolName,
  buildOperationCatalog,
  classifyAggregate,
  classifyRisk,
  collectRequestedPhysicalOperations,
  extractBatchedOperations,
  groupOperationsByAggregate,
  isKnownOperation,
  isObservationOperation,
  isPhysicalInputOperation,
  operationFromUpstreamTool,
  parseDelivery,
  parseDisposition,
  parseEnvelope,
  parseSuccessDisposition,
  requestedOperation,
  resolveEffectiveRisk,
  type AgentDesktopAggregate,
  type AgentDesktopDelivery,
  type AgentDesktopDisposition,
  type AgentDesktopEnvelope,
  type AgentDesktopOperation,
  type AgentDesktopRisk,
} from './agent-desktop-catalog';

export {
  AGENT_DESKTOP_SERVER_NAME,
  AgentDesktopClient,
  type AgentDesktopCallResult,
  type AgentDesktopClientOptions,
} from './agent-desktop-client';

export {
  AGENT_DESKTOP_PATH_ENV,
  agentDesktopExecutableName,
  agentDesktopPlatformDir,
  buildAgentDesktopCandidates,
  resolveAgentDesktopBinary,
  type AgentDesktopBinaryResolution,
  type AgentDesktopPathContext,
} from './agent-desktop-paths';

export {
  buildAgentDesktopTools,
  formatAgentDesktopResult,
  resolveRequestedOperation,
  type AgentDesktopToolsOptions,
} from './agent-desktop-tools';

export {
  AgentDesktopManager,
  type AgentDesktopManagerOptions,
  type AgentDesktopSessionTools,
} from './agent-desktop-manager';

export {
  AGENT_DESKTOP_CORE_SKILL,
  buildAdapterSection,
  buildSkillDocument,
  buildStaticOperationCatalog,
  extractAgentDesktopSkillGuide,
  extractDescription,
  listAgentDesktopSkills,
  materializeAgentDesktopSkills,
  readAgentDesktopVersion,
  selectSkillNames,
  splitFrontmatter,
  type AgentDesktopMaterializedSkill,
  type AgentDesktopSkillExec,
  type AgentDesktopSkillMaterialization,
  type AgentDesktopSkillSummary,
  type MaterializeAgentDesktopSkillsOptions,
} from './agent-desktop-skill';
