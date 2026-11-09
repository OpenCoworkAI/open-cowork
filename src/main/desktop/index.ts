export {
  AGGREGATE_ORDER,
  UPSTREAM_TOOL_PREFIX,
  aggregateToolName,
  buildOperationCatalog,
  classifyAggregate,
  classifyRisk,
  extractBatchedOperations,
  groupOperationsByAggregate,
  operationFromUpstreamTool,
  parseDelivery,
  parseDisposition,
  parseEnvelope,
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
