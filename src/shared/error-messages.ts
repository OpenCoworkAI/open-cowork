export const ERROR_CODES = {
  // General errors
  SESSION_NOT_INITIALIZED: 'SESSION_NOT_INITIALIZED',
  INVALID_PATH: 'INVALID_PATH',
  PATH_OUTSIDE_WORKSPACE: 'PATH_OUTSIDE_WORKSPACE',
  PATH_TRAVERSAL_BLOCKED: 'PATH_TRAVERSAL_BLOCKED',
  DANGEROUS_COMMAND_BLOCKED: 'DANGEROUS_COMMAND_BLOCKED',

  // Network errors
  URL_REQUIRED: 'URL_REQUIRED',
  INVALID_URL: 'INVALID_URL',
  ONLY_HTTPS_SUPPORTED: 'ONLY_HTTPS_SUPPORTED',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',

  // Config errors
  CONFIG_SET_NAME_REQUIRED: 'CONFIG_SET_NAME_REQUIRED',
  CONFIG_SET_NOT_FOUND: 'CONFIG_SET_NOT_FOUND',
  CONFIG_SET_CLONE_SOURCE_NOT_FOUND: 'CONFIG_SET_CLONE_SOURCE_NOT_FOUND',
  CONFIG_SET_LIMIT_REACHED: 'CONFIG_SET_LIMIT_REACHED',
  SYSTEM_CONFIG_SET_CANNOT_BE_DELETED: 'SYSTEM_CONFIG_SET_CANNOT_BE_DELETED',
  AT_LEAST_ONE_CONFIG_SET_MUST_BE_KEPT: 'AT_LEAST_ONE_CONFIG_SET_MUST_BE_KEPT',

  // Skills errors
  SKILLS_DIRECTORY_PATH_EMPTY: 'SKILLS_DIRECTORY_PATH_EMPTY',
  TARGET_PATH_NOT_DIRECTORY: 'TARGET_PATH_NOT_DIRECTORY',
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  CANNOT_DELETE_BUILTIN_SKILLS: 'CANNOT_DELETE_BUILTIN_SKILLS',
  PLUGIN_HAS_NO_INSTALLABLE_SKILLS: 'PLUGIN_HAS_NO_INSTALLABLE_SKILLS',
  PLUGIN_DIRECTORY_NOT_EXISTS: 'PLUGIN_DIRECTORY_NOT_EXISTS',

  // Schedule errors
  CANNOT_ENABLE_OVERDUE_TASK: 'CANNOT_ENABLE_OVERDUE_TASK',
  TASK_ALREADY_EXECUTING: 'TASK_ALREADY_EXECUTING',

  // Sandbox errors
  WSL_NOT_AVAILABLE: 'WSL_NOT_AVAILABLE',
  WSL_AGENT_NOT_RUNNING: 'WSL_AGENT_NOT_RUNNING',
  SANDBOX_NOT_INITIALIZED: 'SANDBOX_NOT_INITIALIZED',
  WORKSPACE_NOT_CONFIGURED: 'WORKSPACE_NOT_CONFIGURED',

  // MCP errors
  BUNDLED_NPX_UNAVAILABLE: 'BUNDLED_NPX_UNAVAILABLE',

  // Remote errors
  AGENT_EXECUTOR_NOT_SET: 'AGENT_EXECUTOR_NOT_SET',
  REMOTE_CHANNEL_NOT_CONNECTED: 'REMOTE_CHANNEL_NOT_CONNECTED',

  // Permission errors
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_API_KEY: 'INVALID_API_KEY',

  // Tool errors (add as needed)
  TOOL_NO_MOUNTED_WORKSPACE: 'TOOL_NO_MOUNTED_WORKSPACE',
  TOOL_PATH_OUTSIDE_WORKSPACE: 'TOOL_PATH_OUTSIDE_WORKSPACE',
  TOOL_FILE_NOT_FOUND: 'TOOL_FILE_NOT_FOUND',
  TOOL_DIR_NOT_FOUND: 'TOOL_DIR_NOT_FOUND',
  TOOL_INVALID_URL: 'TOOL_INVALID_URL',
  TOOL_URL_REQUIRED: 'TOOL_URL_REQUIRED',
  TOOL_ONLY_HTTPS: 'TOOL_ONLY_HTTPS',
  TOOL_REQUEST_TIMEOUT: 'TOOL_REQUEST_TIMEOUT',
  TOOL_QUERY_REQUIRED: 'TOOL_QUERY_REQUIRED',
  TOOL_SEARCH_FAILED: 'TOOL_SEARCH_FAILED',
  TOOL_EDIT_FAILED: 'TOOL_EDIT_FAILED',
  TOOL_GLOB_FAILED: 'TOOL_GLOB_FAILED',
  TOOL_GREP_FAILED: 'TOOL_GREP_FAILED',
  TOOL_UNKNOWN_TOOL: 'TOOL_UNKNOWN_TOOL',
  TOOL_OLD_STRING_NOT_FOUND: 'TOOL_OLD_STRING_NOT_FOUND',
  TOOL_NO_MOUNTED_DIRECTORIES: 'TOOL_NO_MOUNTED_DIRECTORIES',
  TOOL_PATTERN_TOO_LONG: 'TOOL_PATTERN_TOO_LONG',
  TOOL_INVALID_REGEX: 'TOOL_INVALID_REGEX',
  TOOL_SEARCH_PATTERN_INVALID: 'TOOL_SEARCH_PATTERN_INVALID',
  TOOL_COMMAND_BLOCKED: 'TOOL_COMMAND_BLOCKED',

  // API/Network errors
  TOOL_FIRST_RESPONSE_TIMEOUT: 'TOOL_FIRST_RESPONSE_TIMEOUT',
  TOOL_TRY_AGAIN_OR_CHECK: 'TOOL_TRY_AGAIN_OR_CHECK',
  TOOL_EMPTY_RESULT: 'TOOL_EMPTY_RESULT',
  TOOL_BAD_REQUEST_400: 'TOOL_BAD_REQUEST_400',
  TOOL_AUTH_FAILED: 'TOOL_AUTH_FAILED',
  TOOL_RATE_LIMITED_429: 'TOOL_RATE_LIMITED_429',
  TOOL_UPSTREAM_ERROR: 'TOOL_UPSTREAM_ERROR',
  TOOL_CONNECTION_INTERRUPTED: 'TOOL_CONNECTION_INTERRUPTED',

  // MCP errors
  MCP_BUNDLED_NODE_NOT_FOUND: 'MCP_BUNDLED_NODE_NOT_FOUND',
  MCP_BUNDLED_NPX_UNAVAILABLE: 'MCP_BUNDLED_NPX_UNAVAILABLE',
  MCP_BUNDLED_NPX_NOT_FOUND: 'MCP_BUNDLED_NPX_NOT_FOUND',
  MCP_CHROME_NOT_READY: 'MCP_CHROME_NOT_READY',
  MCP_CHROME_DEBUG_PORT_FAILED: 'MCP_CHROME_DEBUG_PORT_FAILED',
  MCP_STDIO_REQUIRES_COMMAND: 'MCP_STDIO_REQUIRES_COMMAND',
  MCP_SSE_REQUIRES_URL: 'MCP_SSE_REQUIRES_URL',
  MCP_SSE_MALFORMED_URL: 'MCP_SSE_MALFORMED_URL',
  MCP_HTTP_REQUIRES_URL: 'MCP_HTTP_REQUIRES_URL',
  MCP_UNSUPPORTED_TRANSPORT: 'MCP_UNSUPPORTED_TRANSPORT',
  MCP_TOOL_NOT_FOUND: 'MCP_TOOL_NOT_FOUND',
  MCP_SERVER_NOT_CONNECTED: 'MCP_SERVER_NOT_CONNECTED',

  // Remote errors
  REMOTE_AGENT_EXECUTOR_NOT_SET: 'REMOTE_AGENT_EXECUTOR_NOT_SET',
  REMOTE_NO_SESSION_ID: 'REMOTE_NO_SESSION_ID',
  REMOTE_RELATIVE_CWD_REQUIRES_BASE: 'REMOTE_RELATIVE_CWD_REQUIRES_BASE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorMessage {
  code: ErrorCode;
  messageEn: string;
  messageZh: string;
}

export const ERROR_MESSAGES: Record<ErrorCode, ErrorMessage> = {
  SESSION_NOT_INITIALIZED: {
    code: ERROR_CODES.SESSION_NOT_INITIALIZED,
    messageEn: 'Session manager not initialized',
    messageZh: '会话管理器未初始化',
  },
  INVALID_PATH: {
    code: ERROR_CODES.INVALID_PATH,
    messageEn: 'Invalid or unauthorized path',
    messageZh: '无效或未授权的路径',
  },
  PATH_OUTSIDE_WORKSPACE: {
    code: ERROR_CODES.PATH_OUTSIDE_WORKSPACE,
    messageEn: 'Path is outside the mounted workspace',
    messageZh: '路径超出挂载的工作区',
  },
  PATH_TRAVERSAL_BLOCKED: {
    code: ERROR_CODES.PATH_TRAVERSAL_BLOCKED,
    messageEn: 'Path traversal (..) is not allowed',
    messageZh: '不允许路径遍历 (..)',
  },
  DANGEROUS_COMMAND_BLOCKED: {
    code: ERROR_CODES.DANGEROUS_COMMAND_BLOCKED,
    messageEn: 'Potentially dangerous command blocked',
    messageZh: '潜在的危险命令被阻止',
  },
  URL_REQUIRED: {
    code: ERROR_CODES.URL_REQUIRED,
    messageEn: 'URL is required',
    messageZh: 'URL 是必需的',
  },
  INVALID_URL: {
    code: ERROR_CODES.INVALID_URL,
    messageEn: 'Invalid URL',
    messageZh: '无效的 URL',
  },
  ONLY_HTTPS_SUPPORTED: {
    code: ERROR_CODES.ONLY_HTTPS_SUPPORTED,
    messageEn: 'Only https URLs are supported',
    messageZh: '仅支持 https URL',
  },
  REQUEST_TIMEOUT: {
    code: ERROR_CODES.REQUEST_TIMEOUT,
    messageEn: 'Request timeout. Please check your network connection and try again.',
    messageZh: '请求超时。请检查网络连接后重试。',
  },
  NETWORK_ERROR: {
    code: ERROR_CODES.NETWORK_ERROR,
    messageEn: 'Network error. Please check your connection.',
    messageZh: '网络错误。请检查您的连接。',
  },
  CONFIG_SET_NAME_REQUIRED: {
    code: ERROR_CODES.CONFIG_SET_NAME_REQUIRED,
    messageEn: 'Config set name is required',
    messageZh: '配置方案名称不能为空',
  },
  CONFIG_SET_NOT_FOUND: {
    code: ERROR_CODES.CONFIG_SET_NOT_FOUND,
    messageEn: 'Config set not found',
    messageZh: '未找到配置方案',
  },
  CONFIG_SET_CLONE_SOURCE_NOT_FOUND: {
    code: ERROR_CODES.CONFIG_SET_CLONE_SOURCE_NOT_FOUND,
    messageEn: 'Config set clone source not found',
    messageZh: '未找到可复制的配置方案',
  },
  SYSTEM_CONFIG_SET_CANNOT_BE_DELETED: {
    code: ERROR_CODES.SYSTEM_CONFIG_SET_CANNOT_BE_DELETED,
    messageEn: 'The default config set cannot be deleted',
    messageZh: '默认方案不可删除',
  },
  AT_LEAST_ONE_CONFIG_SET_MUST_BE_KEPT: {
    code: ERROR_CODES.AT_LEAST_ONE_CONFIG_SET_MUST_BE_KEPT,
    messageEn: 'Keep at least one config set',
    messageZh: '至少需要保留一个配置方案',
  },
  CONFIG_SET_LIMIT_REACHED: {
    code: ERROR_CODES.CONFIG_SET_LIMIT_REACHED,
    messageEn: 'Config set limit reached',
    messageZh: '配置方案数量已达上限',
  },
  SKILLS_DIRECTORY_PATH_EMPTY: {
    code: ERROR_CODES.SKILLS_DIRECTORY_PATH_EMPTY,
    messageEn: 'Skills directory path cannot be empty',
    messageZh: '技能目录路径不能为空',
  },
  TARGET_PATH_NOT_DIRECTORY: {
    code: ERROR_CODES.TARGET_PATH_NOT_DIRECTORY,
    messageEn: 'Target path is not a directory',
    messageZh: '目标路径不是目录',
  },
  SKILL_NOT_FOUND: {
    code: ERROR_CODES.SKILL_NOT_FOUND,
    messageEn: 'Skill not found',
    messageZh: '未找到技能',
  },
  CANNOT_DELETE_BUILTIN_SKILLS: {
    code: ERROR_CODES.CANNOT_DELETE_BUILTIN_SKILLS,
    messageEn: 'Cannot delete built-in skills',
    messageZh: '无法删除内置技能',
  },
  PLUGIN_HAS_NO_INSTALLABLE_SKILLS: {
    code: ERROR_CODES.PLUGIN_HAS_NO_INSTALLABLE_SKILLS,
    messageEn: 'This plugin has no installable skills',
    messageZh: '此插件没有可安装的技能',
  },
  PLUGIN_DIRECTORY_NOT_EXISTS: {
    code: ERROR_CODES.PLUGIN_DIRECTORY_NOT_EXISTS,
    messageEn: 'Plugin directory does not exist',
    messageZh: '插件目录不存在',
  },
  CANNOT_ENABLE_OVERDUE_TASK: {
    code: ERROR_CODES.CANNOT_ENABLE_OVERDUE_TASK,
    messageEn: 'Cannot enable: one-time task is overdue. Edit the schedule first.',
    messageZh: '无法启用：一次性任务已过期。请先编辑计划。',
  },
  TASK_ALREADY_EXECUTING: {
    code: ERROR_CODES.TASK_ALREADY_EXECUTING,
    messageEn: 'Task is already executing',
    messageZh: '任务已在执行中',
  },
  WSL_NOT_AVAILABLE: {
    code: ERROR_CODES.WSL_NOT_AVAILABLE,
    messageEn: 'WSL2 is not available on this system',
    messageZh: 'WSL2 在此系统上不可用',
  },
  WSL_AGENT_NOT_RUNNING: {
    code: ERROR_CODES.WSL_AGENT_NOT_RUNNING,
    messageEn: 'WSL agent not running',
    messageZh: 'WSL 代理未运行',
  },
  SANDBOX_NOT_INITIALIZED: {
    code: ERROR_CODES.SANDBOX_NOT_INITIALIZED,
    messageEn: 'Sandbox not initialized',
    messageZh: '沙盒未初始化',
  },
  WORKSPACE_NOT_CONFIGURED: {
    code: ERROR_CODES.WORKSPACE_NOT_CONFIGURED,
    messageEn: 'Workspace not configured',
    messageZh: '工作区未配置',
  },
  BUNDLED_NPX_UNAVAILABLE: {
    code: ERROR_CODES.BUNDLED_NPX_UNAVAILABLE,
    messageEn: 'Bundled npx is unavailable.',
    messageZh: '内置 npx 不可用。',
  },
  AGENT_EXECUTOR_NOT_SET: {
    code: ERROR_CODES.AGENT_EXECUTOR_NOT_SET,
    messageEn: 'Agent executor not set',
    messageZh: '代理执行器未设置',
  },
  REMOTE_CHANNEL_NOT_CONNECTED: {
    code: ERROR_CODES.REMOTE_CHANNEL_NOT_CONNECTED,
    messageEn: 'Channel not connected',
    messageZh: '渠道未连接',
  },
  PERMISSION_DENIED: {
    code: ERROR_CODES.PERMISSION_DENIED,
    messageEn: 'Permission denied',
    messageZh: '权限被拒绝',
  },
  AUTHENTICATION_FAILED: {
    code: ERROR_CODES.AUTHENTICATION_FAILED,
    messageEn: 'Authentication failed',
    messageZh: '认证失败',
  },
  RATE_LIMITED: {
    code: ERROR_CODES.RATE_LIMITED,
    messageEn: 'Rate limited. Please try again later.',
    messageZh: '请求受限。请稍后重试。',
  },
  INVALID_API_KEY: {
    code: ERROR_CODES.INVALID_API_KEY,
    messageEn: 'Invalid API key',
    messageZh: '无效的 API 密钥',
  },

  // Tool errors
  TOOL_NO_MOUNTED_WORKSPACE: {
    code: ERROR_CODES.TOOL_NO_MOUNTED_WORKSPACE,
    messageEn: 'No mounted workspace for this session',
    messageZh: '此会话没有挂载的工作区',
  },
  TOOL_PATH_OUTSIDE_WORKSPACE: {
    code: ERROR_CODES.TOOL_PATH_OUTSIDE_WORKSPACE,
    messageEn: 'Path is outside the mounted workspace',
    messageZh: '路径超出挂载的工作区',
  },
  TOOL_FILE_NOT_FOUND: {
    code: ERROR_CODES.TOOL_FILE_NOT_FOUND,
    messageEn: 'File not found',
    messageZh: '未找到文件',
  },
  TOOL_DIR_NOT_FOUND: {
    code: ERROR_CODES.TOOL_DIR_NOT_FOUND,
    messageEn: 'Directory not found',
    messageZh: '未找到目录',
  },
  TOOL_INVALID_URL: {
    code: ERROR_CODES.TOOL_INVALID_URL,
    messageEn: 'Invalid URL',
    messageZh: '无效的 URL',
  },
  TOOL_URL_REQUIRED: {
    code: ERROR_CODES.TOOL_URL_REQUIRED,
    messageEn: 'URL is required',
    messageZh: 'URL 是必需的',
  },
  TOOL_ONLY_HTTPS: {
    code: ERROR_CODES.TOOL_ONLY_HTTPS,
    messageEn: 'Only https URLs are supported',
    messageZh: '仅支持 https URL',
  },
  TOOL_REQUEST_TIMEOUT: {
    code: ERROR_CODES.TOOL_REQUEST_TIMEOUT,
    messageEn: 'Request timeout. Please check your network connection and try again.',
    messageZh: '请求超时。请检查网络连接后重试。',
  },
  TOOL_QUERY_REQUIRED: {
    code: ERROR_CODES.TOOL_QUERY_REQUIRED,
    messageEn: 'Query is required',
    messageZh: '查询是必需的',
  },
  TOOL_SEARCH_FAILED: {
    code: ERROR_CODES.TOOL_SEARCH_FAILED,
    messageEn: 'Search failed',
    messageZh: '搜索失败',
  },
  TOOL_EDIT_FAILED: {
    code: ERROR_CODES.TOOL_EDIT_FAILED,
    messageEn: 'Edit failed',
    messageZh: '编辑失败',
  },
  TOOL_GLOB_FAILED: {
    code: ERROR_CODES.TOOL_GLOB_FAILED,
    messageEn: 'Glob failed',
    messageZh: 'Glob 失败',
  },
  TOOL_GREP_FAILED: {
    code: ERROR_CODES.TOOL_GREP_FAILED,
    messageEn: 'Grep failed',
    messageZh: 'Grep 失败',
  },
  TOOL_UNKNOWN_TOOL: {
    code: ERROR_CODES.TOOL_UNKNOWN_TOOL,
    messageEn: 'Unknown tool',
    messageZh: '未知工具',
  },
  TOOL_OLD_STRING_NOT_FOUND: {
    code: ERROR_CODES.TOOL_OLD_STRING_NOT_FOUND,
    messageEn: 'Old string not found in file',
    messageZh: '文件中未找到旧字符串',
  },
  TOOL_NO_MOUNTED_DIRECTORIES: {
    code: ERROR_CODES.TOOL_NO_MOUNTED_DIRECTORIES,
    messageEn: 'No mounted directories',
    messageZh: '没有挂载的目录',
  },
  TOOL_PATTERN_TOO_LONG: {
    code: ERROR_CODES.TOOL_PATTERN_TOO_LONG,
    messageEn: 'Pattern too long (max 1000 characters)',
    messageZh: '模式过长（最多 1000 个字符）',
  },
  TOOL_INVALID_REGEX: {
    code: ERROR_CODES.TOOL_INVALID_REGEX,
    messageEn: 'Invalid regex pattern',
    messageZh: '无效的正则表达式',
  },
  TOOL_SEARCH_PATTERN_INVALID: {
    code: ERROR_CODES.TOOL_SEARCH_PATTERN_INVALID,
    messageEn: 'Search pattern must be relative and cannot start with / or ..',
    messageZh: '搜索模式必须是相对路径，不能以 / 或 .. 开头',
  },
  TOOL_COMMAND_BLOCKED: {
    code: ERROR_CODES.TOOL_COMMAND_BLOCKED,
    messageEn: 'Command blocked: potentially dangerous operation',
    messageZh: '命令被阻止：潜在的危险操作',
  },

  // API/Network errors
  TOOL_FIRST_RESPONSE_TIMEOUT: {
    code: ERROR_CODES.TOOL_FIRST_RESPONSE_TIMEOUT,
    messageEn: 'Model response timeout: No response from upstream for a long time.',
    messageZh: '模型响应超时：上游长时间未响应。',
  },
  TOOL_TRY_AGAIN_OR_CHECK: {
    code: ERROR_CODES.TOOL_TRY_AGAIN_OR_CHECK,
    messageEn: 'Please try again later or check the current model/gateway load.',
    messageZh: '请稍后重试或检查当前模型/网关负载。',
  },
  TOOL_EMPTY_RESULT: {
    code: ERROR_CODES.TOOL_EMPTY_RESULT,
    messageEn:
      'The model returned an empty success result. There may be a compatibility issue with the current model or gateway.',
    messageZh: '模型返回了空的成功结果。可能存在兼容性问题。',
  },
  TOOL_BAD_REQUEST_400: {
    code: ERROR_CODES.TOOL_BAD_REQUEST_400,
    messageEn:
      'Request rejected by upstream (400). This may be due to model/protocol configuration incompatibility.',
    messageZh: '上游拒绝请求 (400)。可能是模型/协议配置不兼容。',
  },
  TOOL_AUTH_FAILED: {
    code: ERROR_CODES.TOOL_AUTH_FAILED,
    messageEn:
      'Authentication failed. Please check if the API Key is correct, expired, or lacks access.',
    messageZh: '认证失败。请检查 API 密钥是否正确、已过期或缺乏访问权限。',
  },
  TOOL_RATE_LIMITED_429: {
    code: ERROR_CODES.TOOL_RATE_LIMITED_429,
    messageEn:
      'Rate limited (429). The current model or API endpoint has reached its request frequency limit.',
    messageZh: '请求受限 (429)。当前模型或 API 端点已达到请求频率限制。',
  },
  TOOL_UPSTREAM_ERROR: {
    code: ERROR_CODES.TOOL_UPSTREAM_ERROR,
    messageEn:
      'Upstream service error. The model service may be overloaded or experiencing temporary issues.',
    messageZh: '上游服务错误。模型服务可能过载或暂时存在问题。',
  },
  TOOL_CONNECTION_INTERRUPTED: {
    code: ERROR_CODES.TOOL_CONNECTION_INTERRUPTED,
    messageEn: 'Network connection interrupted. This may be due to unstable proxy/gateway.',
    messageZh: '网络连接中断。这可能是由于不稳定的代理/网关。',
  },

  // MCP errors
  MCP_BUNDLED_NODE_NOT_FOUND: {
    code: ERROR_CODES.MCP_BUNDLED_NODE_NOT_FOUND,
    messageEn:
      'Bundled Node.js not found. Please reinstall the application. The application requires bundled Node.js to run MCP servers.',
    messageZh: '未找到内置 Node.js。请重新安装应用程序。运行 MCP 服务器需要内置 Node.js。',
  },
  MCP_BUNDLED_NPX_UNAVAILABLE: {
    code: ERROR_CODES.MCP_BUNDLED_NPX_UNAVAILABLE,
    messageEn: 'Bundled npx is unavailable.',
    messageZh: '内置 npx 不可用。',
  },
  MCP_BUNDLED_NPX_NOT_FOUND: {
    code: ERROR_CODES.MCP_BUNDLED_NPX_NOT_FOUND,
    messageEn: 'Could not find npx in PATH.',
    messageZh: '无法在 PATH 中找到 npx。',
  },
  MCP_CHROME_NOT_READY: {
    code: ERROR_CODES.MCP_CHROME_NOT_READY,
    messageEn:
      'Chrome is not ready. Cannot perform this operation: debug port did not become ready.',
    messageZh: 'Chrome 未就绪。无法执行此操作：调试端口未就绪。',
  },
  MCP_CHROME_DEBUG_PORT_FAILED: {
    code: ERROR_CODES.MCP_CHROME_DEBUG_PORT_FAILED,
    messageEn:
      'Chrome is not ready. Cannot perform this operation: MCP connection verification failed after multiple attempts.',
    messageZh: 'Chrome 未就绪。无法执行此操作：MCP 连接验证多次失败。',
  },
  MCP_STDIO_REQUIRES_COMMAND: {
    code: ERROR_CODES.MCP_STDIO_REQUIRES_COMMAND,
    messageEn: 'STDIO server requires a command',
    messageZh: 'STDIO 服务器需要命令',
  },
  MCP_SSE_REQUIRES_URL: {
    code: ERROR_CODES.MCP_SSE_REQUIRES_URL,
    messageEn: 'SSE server requires a URL',
    messageZh: 'SSE 服务器需要 URL',
  },
  MCP_SSE_MALFORMED_URL: {
    code: ERROR_CODES.MCP_SSE_MALFORMED_URL,
    messageEn: 'SSE server has a malformed URL',
    messageZh: 'SSE 服务器 URL 格式错误',
  },
  MCP_HTTP_REQUIRES_URL: {
    code: ERROR_CODES.MCP_HTTP_REQUIRES_URL,
    messageEn: 'Streamable HTTP server requires a URL',
    messageZh: 'Streamable HTTP 服务器需要 URL',
  },
  MCP_UNSUPPORTED_TRANSPORT: {
    code: ERROR_CODES.MCP_UNSUPPORTED_TRANSPORT,
    messageEn: 'Unsupported transport type',
    messageZh: '不支持的传输类型',
  },
  MCP_TOOL_NOT_FOUND: {
    code: ERROR_CODES.MCP_TOOL_NOT_FOUND,
    messageEn: 'MCP tool not found',
    messageZh: '未找到 MCP 工具',
  },
  MCP_SERVER_NOT_CONNECTED: {
    code: ERROR_CODES.MCP_SERVER_NOT_CONNECTED,
    messageEn: 'MCP server not connected',
    messageZh: 'MCP 服务器未连接',
  },

  // Remote errors
  REMOTE_AGENT_EXECUTOR_NOT_SET: {
    code: ERROR_CODES.REMOTE_AGENT_EXECUTOR_NOT_SET,
    messageEn: 'Agent executor not set',
    messageZh: '代理执行器未设置',
  },
  REMOTE_NO_SESSION_ID: {
    code: ERROR_CODES.REMOTE_NO_SESSION_ID,
    messageEn: 'No actual session ID found for remote session',
    messageZh: '未找到远程会话的实际会话 ID',
  },
  REMOTE_RELATIVE_CWD_REQUIRES_BASE: {
    code: ERROR_CODES.REMOTE_RELATIVE_CWD_REQUIRES_BASE,
    messageEn: 'Relative working directory requires an existing base directory',
    messageZh: '相对工作目录需要存在基础目录',
  },
};

export function getErrorMessage(code: ErrorCode, language: 'en' | 'zh' = 'en'): string {
  const error = ERROR_MESSAGES[code];
  if (!error) {
    console.warn(`[ErrorMessages] Unknown error code: ${code}`);
    return code;
  }
  return language === 'zh' ? error.messageZh : error.messageEn;
}

export function createError(code: ErrorCode, language: 'en' | 'zh' = 'en'): Error {
  return new Error(getErrorMessage(code, language));
}

// Get current language - will be set by main process
let getCurrentLanguageFn: (() => 'en' | 'zh') | null = null;

export function setGetCurrentLanguageFn(fn: () => 'en' | 'zh'): void {
  getCurrentLanguageFn = fn;
}

export function getCurrentLanguage(): 'en' | 'zh' {
  if (getCurrentLanguageFn) {
    return getCurrentLanguageFn();
  }
  return 'en';
}

export function getLocalizedErrorMessage(code: ErrorCode): string {
  return getErrorMessage(code, getCurrentLanguage());
}
