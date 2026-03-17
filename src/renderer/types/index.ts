// Session types
export interface Session {
  id: string;
  title: string;
  claudeSessionId?: string;
  openaiThreadId?: string;
  status: SessionStatus;
  cwd?: string;
  mountedPaths: MountedPath[];
  allowedTools: string[];
  memoryEnabled: boolean;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';

export interface MountedPath {
  virtual: string;
  real: string;
}

// Message types
export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: number;
  tokenUsage?: TokenUsage;
  localStatus?: 'queued' | 'cancelled';
  executionTimeMs?: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export type ContentBlock =
  | TextContent
  | ImageContent
  | FileAttachmentContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export interface FileAttachmentContent {
  type: 'file_attachment';
  filename: string;
  relativePath: string; // Path relative to session's .tmp folder
  size: number;
  mimeType?: string;
  inlineDataBase64?: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
  images?: Array<{
    data: string;          // base64 encoded image data
    mimeType: string;      // e.g., 'image/png'
  }>;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

// Trace types for visualization
export interface TraceStep {
  id: string;
  type: TraceStepType;
  status: TraceStepStatus;
  title: string;
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  isError?: boolean;
  timestamp: number;
  duration?: number;
}

export type TraceStepType = 'thinking' | 'text' | 'tool_call' | 'tool_result';
export type TraceStepStatus = 'pending' | 'running' | 'completed' | 'error';

export type ScheduleRepeatUnit = 'minute' | 'hour' | 'day';
export type ScheduleWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DailyScheduleConfig {
  kind: 'daily';
  times: string[];
}

export interface WeeklyScheduleConfig {
  kind: 'weekly';
  weekdays: ScheduleWeekday[];
  times: string[];
}

export type ScheduleConfig = DailyScheduleConfig | WeeklyScheduleConfig;

export interface ScheduleTask {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: ScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleCreateInput {
  title?: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
}

export interface ScheduleUpdateInput {
  title?: string;
  prompt?: string;
  cwd?: string;
  runAt?: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  lastRunAt?: number | null;
  lastRunSessionId?: string | null;
  lastError?: string | null;
}

// Skills types
export interface Skill {
  id: string;
  name: string;
  description?: string;
  type: SkillType;
  enabled: boolean;
  config?: Record<string, unknown>;
  createdAt: number;
}

export type SkillType = 'builtin' | 'mcp' | 'custom';

export type PluginComponentKind = 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp';

export interface PluginComponentCounts {
  skills: number;
  commands: number;
  agents: number;
  hooks: number;
  mcp: number;
}

export interface PluginComponentEnabledState {
  skills: boolean;
  commands: boolean;
  agents: boolean;
  hooks: boolean;
  mcp: boolean;
}

export interface PluginCatalogItemV2 {
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  installable: boolean;
  hasManifest: boolean;
  componentCounts: PluginComponentCounts;
  pluginId?: string;
  installCommand?: string;
  detailUrl?: string;
  catalogSource?: 'claude-marketplace';
}

export interface PluginCatalogItem extends PluginCatalogItemV2 {
  skillCount: number;
  hasSkills: boolean;
}

export interface InstalledPlugin {
  pluginId: string;
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  enabled: boolean;
  sourcePath: string;
  runtimePath: string;
  componentCounts: PluginComponentCounts;
  componentsEnabled: PluginComponentEnabledState;
  installedAt: number;
  updatedAt: number;
}

export interface PluginInstallResultV2 {
  plugin: InstalledPlugin;
  installedSkills: string[];
  warnings: string[];
}

export interface PluginToggleResult {
  success: boolean;
  plugin: InstalledPlugin;
}

export interface PluginInstallResult {
  pluginName: string;
  installedSkills: string[];
  skippedSkills: string[];
  errors: string[];
}

export interface SkillsStorageChangeEvent {
  path: string;
  reason: 'updated' | 'path_changed' | 'fallback' | 'watcher_error';
  message?: string;
}

// Memory types
export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  metadata: MemoryMetadata;
  createdAt: number;
}

export interface MemoryMetadata {
  source: string;
  timestamp: number;
  tags: string[];
}

// Permission types
export interface PermissionRequest {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
}

export type PermissionResult = 'allow' | 'deny' | 'allow_always';

// Sudo password types
export interface SudoPasswordRequest {
  toolUseId: string;
  command: string;
  sessionId: string;
}

// AskUserQuestion display types - kept for rendering historical messages
export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface PermissionRule {
  tool: string;
  pattern?: string;
  action: 'allow' | 'deny' | 'ask';
}

// IPC Event types
export type ClientEvent =
  | { type: 'session.start'; payload: { title: string; prompt: string; cwd?: string; allowedTools?: string[]; content?: ContentBlock[] } }
  | { type: 'session.continue'; payload: { sessionId: string; prompt: string; content?: ContentBlock[] } }
  | { type: 'session.stop'; payload: { sessionId: string } }
  | { type: 'session.delete'; payload: { sessionId: string } }
  | { type: 'session.batchDelete'; payload: { sessionIds: string[] } }
  | { type: 'session.list'; payload: Record<string, never> }
  | { type: 'session.getMessages'; payload: { sessionId: string } }
  | { type: 'session.getTraceSteps'; payload: { sessionId: string } }
  | { type: 'permission.response'; payload: { toolUseId: string; result: PermissionResult } }
  | { type: 'sudo.password.response'; payload: { toolUseId: string; password: string | null } }
  | { type: 'settings.update'; payload: Record<string, unknown> }
  | { type: 'folder.select'; payload: Record<string, never> }
  | { type: 'workdir.get'; payload: Record<string, never> }
  | { type: 'workdir.set'; payload: { path: string; sessionId?: string } }
  | { type: 'workdir.select'; payload: { sessionId?: string; currentPath?: string } };

// Sandbox setup types (app startup)
export type SandboxSetupPhase = 
  | 'checking'      // Checking WSL/Lima availability
  | 'creating'      // Creating Lima instance (macOS only)
  | 'starting'      // Starting Lima instance (macOS only)  
  | 'installing_node'   // Installing Node.js
  | 'installing_python' // Installing Python
  | 'installing_pip'    // Installing pip
  | 'installing_deps'   // Installing skill dependencies (markitdown, pypdf, etc.)
  | 'ready'         // Ready to use
  | 'skipped'       // No sandbox needed (native mode)
  | 'error';        // Setup failed

export interface SandboxSetupProgress {
  phase: SandboxSetupPhase;
  message: string;
  detail?: string;
  progress?: number; // 0-100
  error?: string;
}

// Sandbox sync types (per-session file sync)
export type SandboxSyncPhase =
  | 'starting_agent'  // Starting WSL/Lima agent
  | 'syncing_files'   // Syncing files to sandbox
  | 'syncing_skills'  // Copying skills
  | 'ready'           // Sync complete
  | 'error';          // Sync failed

export interface SandboxSyncStatus {
  sessionId: string;
  phase: SandboxSyncPhase;
  message: string;
  detail?: string;
  fileCount?: number;
  totalSize?: number;
}

export type ServerEvent =
  | { type: 'stream.message'; payload: { sessionId: string; message: Message } }
  | { type: 'stream.partial'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.thinking'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.executionTime'; payload: { sessionId: string; messageId: string; executionTimeMs: number } }
  | { type: 'session.status'; payload: { sessionId: string; status: SessionStatus; error?: string } }
  | { type: 'session.update'; payload: { sessionId: string; updates: Partial<Session> } }
  | { type: 'session.list'; payload: { sessions: Session[] } }
  | { type: 'permission.request'; payload: PermissionRequest }
  | { type: 'permission.dismiss'; payload: { toolUseId: string } }
  | { type: 'sudo.password.request'; payload: SudoPasswordRequest }
  | { type: 'sudo.password.dismiss'; payload: { toolUseId: string } }
  | { type: 'trace.step'; payload: { sessionId: string; step: TraceStep } }
  | { type: 'trace.update'; payload: { sessionId: string; stepId: string; updates: Partial<TraceStep> } }
  | { type: 'folder.selected'; payload: { path: string } }
  | { type: 'config.status'; payload: { isConfigured: boolean; config: AppConfig } }
  | { type: 'sandbox.progress'; payload: SandboxSetupProgress }
  | { type: 'sandbox.sync'; payload: SandboxSyncStatus }
  | { type: 'skills.storageChanged'; payload: SkillsStorageChangeEvent }
  | { type: 'plugins.runtimeApplied'; payload: { sessionId: string; plugins: Array<{ name: string; path: string }> } }
  | { type: 'workdir.changed'; payload: { path: string } }
  | { type: 'session.contextInfo'; payload: { sessionId: string; contextWindow: number } }
  | { type: 'navigate.to'; payload: { page: 'welcome' | 'settings' | 'session'; tab?: string; sessionId?: string } }
  | { type: 'native-theme.changed'; payload: { shouldUseDarkColors: boolean } }
  | { type: 'new-session' }
  | { type: 'navigate'; payload: string }
  | { type: 'scheduled-task.error'; payload: { taskId: string; error: string } }
  | { type: 'error'; payload: { message: string; code?: 'CONFIG_REQUIRED_ACTIVE_SET'; action?: 'open_api_settings' } };

// Settings types
export interface Settings {
  theme: AppTheme;
  apiKey?: string;
  defaultTools: string[];
  permissionRules: PermissionRule[];
  globalSkillsPath: string;
  memoryStrategy: 'auto' | 'manual' | 'rolling';
  maxContextTokens: number;
}

// Tool types
export type ToolName = 'read' | 'write' | 'edit' | 'glob' | 'grep' | 'bash' | 'webFetch' | 'webSearch';

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

// Execution context
export interface ExecutionContext {
  sessionId: string;
  cwd: string;
  mountedPaths: MountedPath[];
  allowedTools: string[];
}

// App Config types
export type ProviderType = 'openrouter' | 'anthropic' | 'custom' | 'openai' | 'gemini' | 'ollama';
export type CustomProtocolType = 'anthropic' | 'openai' | 'gemini';
export type AppTheme = 'dark' | 'light' | 'system';
export type ProviderProfileKey =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'custom:anthropic'
  | 'custom:openai'
  | 'custom:gemini';
export type ConfigSetId = string;

export interface ProviderProfile {
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ApiConfigSet {
  id: ConfigSetId;
  name: string;
  isSystem?: boolean;
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  enableThinking: boolean;
  updatedAt: string;
}

export interface CreateSetPayload {
  name: string;
  mode: 'blank' | 'clone';
  fromSetId?: string;
}

export interface AppConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  customProtocol?: CustomProtocolType;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  activeConfigSetId: ConfigSetId;
  configSets: ApiConfigSet[];
  claudeCodePath?: string;
  defaultWorkdir?: string;
  globalSkillsPath?: string;
  theme?: AppTheme;
  sandboxEnabled?: boolean;
  enableThinking?: boolean;
  isConfigured: boolean;
}

export interface ProviderPreset {
  name: string;
  baseUrl: string;
  models: { id: string; name: string }[];
  keyPlaceholder: string;
  keyHint: string;
}

export interface ProviderPresets {
  openrouter: ProviderPreset;
  anthropic: ProviderPreset;
  custom: ProviderPreset;
  openai: ProviderPreset;
  gemini: ProviderPreset;
  ollama: ProviderPreset;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
}

export interface ApiTestInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
  useLiveRequest?: boolean;
}

export interface ApiTestResult {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  errorType?:
    | 'missing_key'
    | 'missing_base_url'
    | 'unauthorized'
    | 'not_found'
    | 'rate_limited'
    | 'server_error'
    | 'network_error'
    | 'ollama_not_running'
    | 'ollama_loading'
    | 'unknown';
  details?: string;
}

// API Diagnostics types
export type DiagnosticStepName = 'dns' | 'tcp' | 'tls' | 'auth' | 'model';
export type DiagnosticStepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skip';

export interface DiagnosticStep {
  name: DiagnosticStepName;
  status: DiagnosticStepStatus;
  latencyMs?: number;
  error?: string;
  fix?: string;
}

export interface DiagnosticResult {
  steps: DiagnosticStep[];
  overallOk: boolean;
  /** Which step failed first (null if all ok) */
  failedAt?: DiagnosticStepName;
  totalLatencyMs: number;
  /** Present when the run was skipped (e.g. 'concurrent_run') */
  skippedReason?: string;
}

export interface DiagnosticInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
}

export interface LocalServiceInfo {
  type: 'ollama';
  baseUrl: string;
  models?: string[];
}

// MCP types
export interface MCPServerInfo {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  tools?: MCPToolInfo[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  serverId: string;
  serverName: string;
}
