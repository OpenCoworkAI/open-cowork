/**
 * UI 组件常量配置
 * 用于统一管理界面组件的阈值、限制等魔法数字
 */

/**
 * MessageCard 组件相关常量
 */
export const MESSAGE_CARD = {
  /** ToolResultBlock 折叠阈值 - 字符数 */
  TOOL_RESULT_COLLAPSE_CHARS: 800,
  
  /** ToolResultBlock 折叠阈值 - 行数 */
  TOOL_RESULT_COLLAPSE_LINES: 15,
  
  /** ToolResultBlock 预览显示行数 */
  TOOL_RESULT_PREVIEW_LINES: 3,
  
  /** ToolResultBlock 预览显示字符数 */
  TOOL_RESULT_PREVIEW_CHARS: 200,
} as const;

/**
 * CodeBlock 组件相关常量
 */
export const CODE_BLOCK = {
  /** 代码复制成功提示持续时间（毫秒） */
  COPY_SUCCESS_DURATION: 2000,
} as const;

