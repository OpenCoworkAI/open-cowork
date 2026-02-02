/**
 * Remote Manager
 * 远程控制系统管理器，整合 Gateway、Channels 和 MessageRouter
 */

import { EventEmitter } from 'events';
import { log, logError, logWarn } from '../utils/logger';
import { RemoteGateway } from './gateway';
import { MessageRouter } from './message-router';
import { FeishuChannel } from './channels/feishu';
import { remoteConfigStore } from './remote-config-store';
import { tunnelManager, TunnelStatus } from './tunnel-manager';
import type {
  GatewayStatus,
  GatewayConfig,
  FeishuChannelConfig,
  ChannelType,
  RemoteSessionMapping,
  PairedUser,
  PairingRequest,
} from './types';
import type { Message, ContentBlock, ServerEvent, Session } from '../../renderer/types/index';

// Agent executor interface - exported for use in main process
export interface AgentExecutor {
  startSession(title: string, prompt: string, cwd?: string): Promise<Session>;
  continueSession(sessionId: string, prompt: string, content?: ContentBlock[]): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
}

// Question/Permission request from agent
export interface RemoteInteraction {
  type: 'question' | 'permission';
  sessionId: string;      // Actual session ID
  remoteSessionId: string; // Remote session ID (for routing back)
  questionId?: string;
  toolUseId?: string;
  toolName?: string;
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
  input?: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

export class RemoteManager extends EventEmitter {
  private gateway?: RemoteGateway;
  private messageRouter: MessageRouter;
  private agentExecutor?: AgentExecutor;
  private sendToRenderer?: (event: ServerEvent) => void;
  
  // Session state tracking
  private remoteSessionIds: Set<string> = new Set();
  
  // Mapping: actual session ID -> remote session ID
  private sessionIdMapping: Map<string, string> = new Map();
  
  // Mapping: remote session ID -> actual session ID (reverse mapping)
  private reverseSessionIdMapping: Map<string, string> = new Map();
  
  // Mapping: remote session ID -> channel info (for routing responses back)
  private sessionChannelMapping: Map<string, { channelType: ChannelType; channelId: string }> = new Map();
  
  // Pending interactions (questions/permissions) waiting for user response
  private pendingInteractions: Map<string, RemoteInteraction> = new Map();
  
  // Callbacks for resolving pending interactions
  private interactionResolvers: Map<string, (response: string) => void> = new Map();
  
  // Response buffer for collecting messages before sending (to avoid spam)
  private responseBuffers: Map<string, { texts: string[]; lastSent: number; toolSteps: string[] }> = new Map();
  
  // Sent message hashes to avoid duplicates
  private sentMessageHashes: Map<string, Set<string>> = new Map();
  
  // Debounce timers for sending buffered responses
  private sendTimers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor() {
    super();
    this.messageRouter = new MessageRouter();
  }
  
  /**
   * Set agent executor (called from main process)
   */
  setAgentExecutor(executor: AgentExecutor): void {
    this.agentExecutor = executor;
    
    // Set up message router callback
    this.messageRouter.setAgentCallback(
      async (sessionId, prompt, content, workingDirectory, channelType, channelId, onMessage, onPartial) => {
        await this.executeAgent(
          sessionId, 
          prompt, 
          content, 
          workingDirectory, 
          channelType as ChannelType, 
          channelId, 
          onMessage, 
          onPartial
        );
      }
    );
    
    log('[RemoteManager] Agent executor set');
  }
  
  /**
   * Set renderer callback (for UI updates)
   */
  setRendererCallback(callback: (event: ServerEvent) => void): void {
    this.sendToRenderer = callback;
  }
  
  /**
   * Initialize and start remote control
   */
  async start(): Promise<void> {
    const config = remoteConfigStore.getAll();
    
    if (!config.gateway.enabled) {
      log('[RemoteManager] Remote control is disabled');
      return;
    }
    
    log('[RemoteManager] Starting remote control system...');
    
    try {
      // Create gateway
      this.gateway = new RemoteGateway(config.gateway, this.messageRouter);
      
      // Set default working directory
      if (config.gateway.defaultWorkingDirectory) {
        this.messageRouter.setDefaultWorkingDirectory(config.gateway.defaultWorkingDirectory);
        log('[RemoteManager] Default working directory:', config.gateway.defaultWorkingDirectory);
      }
      
      // Set up gateway event handlers
      this.setupGatewayEvents();
      
      // Set up message interceptor for interaction responses
      this.gateway.setMessageInterceptor((message) => {
        return this.handlePotentialInteractionResponse(
          message.channelType,
          message.channelId,
          message.sender.id,
          message.content.text || ''
        );
      });
      
      // Register configured channels
      await this.registerChannels(config);
      
      // Load paired users from config
      this.loadPairedUsers();
      
      // Start gateway
      await this.gateway.start();
      
      // Start tunnel if configured
      const tunnelUrl = await tunnelManager.start(config.gateway.port);
      if (tunnelUrl) {
        log('[RemoteManager] Tunnel URL:', tunnelUrl);
        log('[RemoteManager] Feishu Webhook URL:', `${tunnelUrl}/webhook/feishu`);
      }
      
      log('[RemoteManager] Remote control system started');
      this.emitStatusUpdate();
      
    } catch (error) {
      logError('[RemoteManager] Failed to start remote control:', error);
      throw error;
    }
  }
  
  /**
   * Stop remote control
   */
  async stop(): Promise<void> {
    if (!this.gateway) {
      return;
    }
    
    log('[RemoteManager] Stopping remote control system...');
    
    // Stop tunnel first
    await tunnelManager.stop();
    
    try {
      await this.gateway.stop();
      this.gateway = undefined;
      
      log('[RemoteManager] Remote control system stopped');
      this.emitStatusUpdate();
      
    } catch (error) {
      logError('[RemoteManager] Error stopping remote control:', error);
    }
  }
  
  /**
   * Restart remote control
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
  
  /**
   * Get gateway status
   */
  getStatus(): GatewayStatus & { tunnel?: TunnelStatus } {
    if (!this.gateway) {
      return {
        running: false,
        channels: [],
        activeSessions: 0,
        pendingPairings: 0,
      };
    }
    
    return {
      ...this.gateway.getStatus(),
      tunnel: tunnelManager.getStatus(),
    };
  }
  
  /**
   * Get tunnel status
   */
  getTunnelStatus(): TunnelStatus {
    return tunnelManager.getStatus();
  }
  
  /**
   * Get Feishu webhook URL (from tunnel)
   */
  getFeishuWebhookUrl(): string | null {
    return tunnelManager.getWebhookUrl();
  }
  
  /**
   * Update gateway config
   */
  async updateGatewayConfig(config: Partial<GatewayConfig>): Promise<void> {
    remoteConfigStore.setGatewayConfig(config);
    
    // Restart if running
    if (this.gateway?.running) {
      await this.restart();
    }
  }
  
  /**
   * Update feishu channel config
   */
  async updateFeishuConfig(config: FeishuChannelConfig): Promise<void> {
    remoteConfigStore.setFeishuConfig(config);
    
    // Restart to apply changes
    if (this.gateway?.running) {
      await this.restart();
    }
  }
  
  /**
   * Approve pairing request
   */
  approvePairing(channelType: ChannelType, userId: string): boolean {
    if (!this.gateway) {
      return false;
    }
    
    const success = this.gateway.approvePairing(channelType, userId);
    
    if (success) {
      // Persist to config
      remoteConfigStore.addPairedUser({
        userId,
        channelType,
        pairedAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      
      this.emitStatusUpdate();
    }
    
    return success;
  }
  
  /**
   * Revoke user pairing
   */
  revokePairing(channelType: ChannelType, userId: string): boolean {
    if (!this.gateway) {
      return false;
    }
    
    const success = this.gateway.revokePairing(channelType, userId);
    
    if (success) {
      remoteConfigStore.removePairedUser(channelType, userId);
      this.emitStatusUpdate();
    }
    
    return success;
  }
  
  /**
   * Get paired users
   */
  getPairedUsers(): PairedUser[] {
    return remoteConfigStore.getPairedUsers();
  }
  
  /**
   * Get pending pairing requests
   */
  getPendingPairings(): PairingRequest[] {
    return this.gateway?.getPendingPairings() || [];
  }
  
  /**
   * Get active remote sessions
   */
  getRemoteSessions(): RemoteSessionMapping[] {
    return this.messageRouter.getAllSessionMappings();
  }
  
  /**
   * Clear remote session
   */
  clearRemoteSession(sessionId: string): boolean {
    return this.messageRouter.clearSession(sessionId);
  }
  
  /**
   * Check if a session is a remote session
   */
  isRemoteSession(actualSessionId: string): boolean {
    return this.sessionIdMapping.has(actualSessionId);
  }
  
  /**
   * Get remote session ID from actual session ID
   */
  getRemoteSessionId(actualSessionId: string): string | undefined {
    return this.sessionIdMapping.get(actualSessionId);
  }
  
  /**
   * Handle question request from agent (for remote sessions)
   * Returns true if handled, false if should use normal UI
   */
  async handleQuestionRequest(
    actualSessionId: string,
    questionId: string,
    questions: Array<{
      question: string;
      header?: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>
  ): Promise<string | null> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) {
      return null; // Not a remote session
    }
    
    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) {
      return null;
    }
    
    log('[RemoteManager] Handling question request for remote session:', remoteSessionId);
    
    // Build question message for Feishu
    let messageText = '🤔 **需要你的回答**\n\n';
    
    questions.forEach((q, qIdx) => {
      if (q.header) {
        messageText += `**${q.header}**\n`;
      }
      messageText += `${q.question}\n\n`;
      
      if (q.options && q.options.length > 0) {
        q.options.forEach((opt, optIdx) => {
          messageText += `  ${optIdx + 1}. ${opt.label}`;
          if (opt.description) {
            messageText += ` - ${opt.description}`;
          }
          messageText += '\n';
        });
        messageText += '\n';
        if (q.multiSelect) {
          messageText += `*（可多选，用逗号分隔，如: 1,3）*\n\n`;
        } else {
          messageText += `*（请回复选项数字，如: 1）*\n\n`;
        }
      } else {
        messageText += `*（请直接回复你的答案）*\n\n`;
      }
    });
    
    messageText += `---\n*回复此消息来作答，或发送 "跳过" 跳过问题*`;
    
    // Store pending interaction
    const interaction: RemoteInteraction = {
      type: 'question',
      sessionId: actualSessionId,
      remoteSessionId,
      questionId,
      questions,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes timeout
    };
    this.pendingInteractions.set(questionId, interaction);
    
    // Send to channel
    try {
      await this.gateway.sendResponse({
        channelType: channelInfo.channelType,
        channelId: channelInfo.channelId,
        content: {
          type: 'markdown',
          markdown: messageText,
        },
      });
    } catch (err) {
      logError('[RemoteManager] Failed to send question to channel:', err);
      this.pendingInteractions.delete(questionId);
      return null;
    }
    
    // Wait for user response
    return new Promise((resolve) => {
      this.interactionResolvers.set(questionId, resolve);
      
      // Set timeout
      setTimeout(() => {
        if (this.pendingInteractions.has(questionId)) {
          log('[RemoteManager] Question timeout:', questionId);
          this.pendingInteractions.delete(questionId);
          this.interactionResolvers.delete(questionId);
          resolve('{}'); // Return empty answer on timeout
        }
      }, 5 * 60 * 1000);
    });
  }
  
  /**
   * Handle permission request from agent (for remote sessions)
   * Returns true if handled, false if should use normal UI
   */
  async handlePermissionRequest(
    actualSessionId: string,
    toolUseId: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<{ allow: boolean; remember?: boolean } | null> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) {
      return null; // Not a remote session
    }
    
    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) {
      return null;
    }
    
    log('[RemoteManager] Handling permission request for remote session:', remoteSessionId);
    
    // Check if auto-approve is enabled for safe tools
    const config = remoteConfigStore.getAll();
    if (config.gateway.autoApproveSafeTools) {
      const safeTools = [
        // Read-only tools
        'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch',
        // MCP Chrome tools (for browsing)
        'mcp__Chrome__navigate_page', 'mcp__Chrome__take_screenshot', 'mcp__Chrome__take_snapshot',
        'mcp__Chrome__click', 'mcp__Chrome__fill', 'mcp__Chrome__hover',
        'mcp__Chrome__list_pages', 'mcp__Chrome__select_page', 'mcp__Chrome__new_page',
        'mcp__Chrome__close_page', 'mcp__Chrome__wait_for', 'mcp__Chrome__press_key',
        'mcp__Chrome__evaluate_script', 'mcp__Chrome__get_network_request',
        'mcp__Chrome__list_network_requests', 'mcp__Chrome__list_console_messages',
        // Task tools
        'Task', 'TodoWrite',
      ];
      
      if (safeTools.includes(toolName)) {
        log('[RemoteManager] Auto-approving safe tool:', toolName);
        // Send notification to user
        await this.doSendToChannel(channelInfo, `🔧 自动执行: **${toolName}**`);
        return { allow: true };
      }
    }
    
    // Build permission request message
    let messageText = '⚠️ **需要你的授权**\n\n';
    messageText += `工具: **${toolName}**\n\n`;
    messageText += `参数:\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\`\n\n`;
    messageText += `---\n`;
    messageText += `回复 "允许" 或 "y" 授权\n`;
    messageText += `回复 "拒绝" 或 "n" 拒绝\n`;
    messageText += `回复 "始终允许" 记住此授权`;
    
    // Store pending interaction
    const interaction: RemoteInteraction = {
      type: 'permission',
      sessionId: actualSessionId,
      remoteSessionId,
      toolUseId,
      toolName,
      input,
      createdAt: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes timeout
    };
    this.pendingInteractions.set(toolUseId, interaction);
    
    // Send to channel
    try {
      await this.gateway.sendResponse({
        channelType: channelInfo.channelType,
        channelId: channelInfo.channelId,
        content: {
          type: 'markdown',
          markdown: messageText,
        },
      });
    } catch (err) {
      logError('[RemoteManager] Failed to send permission request to channel:', err);
      this.pendingInteractions.delete(toolUseId);
      return null;
    }
    
    // Wait for user response
    return new Promise((resolve) => {
      this.interactionResolvers.set(toolUseId, (response) => {
        const lowerResponse = response.toLowerCase().trim();
        if (lowerResponse === '允许' || lowerResponse === 'y' || lowerResponse === 'yes' || lowerResponse === '是') {
          resolve({ allow: true });
        } else if (lowerResponse === '始终允许' || lowerResponse === 'always') {
          resolve({ allow: true, remember: true });
        } else {
          resolve({ allow: false });
        }
      });
      
      // Set timeout - auto deny on timeout
      setTimeout(() => {
        if (this.pendingInteractions.has(toolUseId)) {
          log('[RemoteManager] Permission timeout:', toolUseId);
          this.pendingInteractions.delete(toolUseId);
          this.interactionResolvers.delete(toolUseId);
          resolve({ allow: false }); // Deny on timeout
        }
      }, 5 * 60 * 1000);
    });
  }
  
  /**
   * Handle incoming message that might be a response to pending interaction
   * Returns true if the message was consumed as an interaction response
   */
  handlePotentialInteractionResponse(
    channelType: ChannelType,
    channelId: string,
    senderId: string,
    messageText: string
  ): boolean {
    // Find any pending interaction for this user
    for (const [id, interaction] of this.pendingInteractions) {
      const channelInfo = this.sessionChannelMapping.get(interaction.remoteSessionId);
      if (!channelInfo) continue;
      
      if (channelInfo.channelType === channelType && channelInfo.channelId === channelId) {
        log('[RemoteManager] Found pending interaction:', id);
        
        // Remove from pending
        this.pendingInteractions.delete(id);
        
        // Resolve the interaction
        const resolver = this.interactionResolvers.get(id);
        if (resolver) {
          this.interactionResolvers.delete(id);
          
          if (interaction.type === 'question') {
            // Parse question response
            const response = this.parseQuestionResponse(messageText, interaction.questions || []);
            resolver(response);
          } else {
            // Pass through for permission
            resolver(messageText);
          }
        }
        
        return true; // Message consumed
      }
    }
    
    return false; // Not an interaction response
  }
  
  /**
   * Parse question response from user message
   */
  private parseQuestionResponse(
    messageText: string,
    questions: Array<{
      question: string;
      options?: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>
  ): string {
    const answers: Record<number, string[]> = {};
    
    // Handle "跳过" response
    if (messageText.toLowerCase().trim() === '跳过' || messageText.toLowerCase().trim() === 'skip') {
      return '{}';
    }
    
    // Simple parsing: if there are options, try to parse numbers
    questions.forEach((q, qIdx) => {
      if (q.options && q.options.length > 0) {
        // Parse comma-separated numbers like "1,3" or single number like "2"
        const numbers = messageText.match(/\d+/g);
        if (numbers) {
          const selectedLabels = numbers
            .map(n => parseInt(n) - 1) // Convert to 0-indexed
            .filter(idx => idx >= 0 && idx < q.options!.length)
            .map(idx => q.options![idx].label);
          
          if (selectedLabels.length > 0) {
            answers[qIdx] = q.multiSelect ? selectedLabels : [selectedLabels[0]];
          }
        }
      } else {
        // Free text answer
        answers[qIdx] = [messageText.trim()];
      }
    });
    
    return JSON.stringify(answers);
  }
  
  /**
   * Get pending interactions count
   */
  getPendingInteractionsCount(): number {
    return this.pendingInteractions.size;
  }
  
  /**
   * Send agent response back to channel (with buffering to avoid spam)
   */
  async sendResponseToChannel(actualSessionId: string, text: string, immediate: boolean = false): Promise<void> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) {
      log('[RemoteManager] Not a remote session, skipping channel response:', actualSessionId);
      return;
    }
    
    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) {
      logError('[RemoteManager] No channel info for remote session:', remoteSessionId);
      return;
    }
    
    // Check for duplicate
    const hash = this.hashText(text);
    if (!this.sentMessageHashes.has(actualSessionId)) {
      this.sentMessageHashes.set(actualSessionId, new Set());
    }
    const sentHashes = this.sentMessageHashes.get(actualSessionId)!;
    if (sentHashes.has(hash)) {
      log('[RemoteManager] Skipping duplicate message');
      return;
    }
    sentHashes.add(hash);
    
    // For immediate sends (like final result), send directly
    if (immediate) {
      await this.doSendToChannel(channelInfo, text);
      return;
    }
    
    // Buffer the response
    if (!this.responseBuffers.has(actualSessionId)) {
      this.responseBuffers.set(actualSessionId, { texts: [], lastSent: 0, toolSteps: [] });
    }
    const buffer = this.responseBuffers.get(actualSessionId)!;
    buffer.texts.push(text);
    
    // Clear existing timer
    const existingTimer = this.sendTimers.get(actualSessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set debounce timer (send after 2 seconds of no new messages)
    const timer = setTimeout(() => {
      this.flushResponseBuffer(actualSessionId).catch(err => {
        logError('[RemoteManager] Failed to flush buffer:', err);
      });
    }, 2000);
    this.sendTimers.set(actualSessionId, timer);
  }
  
  /**
   * Flush buffered responses and send to channel
   */
  private async flushResponseBuffer(actualSessionId: string): Promise<void> {
    const buffer = this.responseBuffers.get(actualSessionId);
    if (!buffer || buffer.texts.length === 0) return;
    
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) return;
    
    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) return;
    
    // Combine all buffered texts
    const combinedText = buffer.texts.join('\n\n');
    buffer.texts = [];
    buffer.lastSent = Date.now();
    
    // Clear timer
    const timer = this.sendTimers.get(actualSessionId);
    if (timer) {
      clearTimeout(timer);
      this.sendTimers.delete(actualSessionId);
    }
    
    await this.doSendToChannel(channelInfo, combinedText);
  }
  
  /**
   * Actually send message to channel
   */
  private async doSendToChannel(
    channelInfo: { channelType: ChannelType; channelId: string },
    text: string
  ): Promise<void> {
    log('[RemoteManager] Sending to channel:', {
      channelType: channelInfo.channelType,
      textLength: text.length,
    });
    
    try {
      await this.gateway!.sendResponse({
        channelType: channelInfo.channelType,
        channelId: channelInfo.channelId,
        content: {
          type: 'markdown',
          markdown: text,
        },
      });
    } catch (err) {
      logError('[RemoteManager] Failed to send to channel:', err);
    }
  }
  
  /**
   * Simple hash function for deduplication
   */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }
  
  /**
   * Send tool execution progress to channel
   */
  async sendToolProgress(actualSessionId: string, toolName: string, status: 'running' | 'completed' | 'error', output?: string): Promise<void> {
    const remoteSessionId = this.sessionIdMapping.get(actualSessionId);
    if (!remoteSessionId) return;
    
    const channelInfo = this.sessionChannelMapping.get(remoteSessionId);
    if (!channelInfo || !this.gateway) return;
    
    // Only send notifications for interesting tools
    const notifyTools = ['Bash', 'Write', 'Edit', 'WebSearch', 'WebFetch', 'mcp__Chrome__'];
    const shouldNotify = notifyTools.some(t => toolName.includes(t));
    
    if (!shouldNotify) return;
    
    let emoji = '🔧';
    let statusText = '';
    
    switch (status) {
      case 'running':
        emoji = '⏳';
        statusText = `正在执行 **${toolName}**...`;
        break;
      case 'completed':
        emoji = '✅';
        statusText = `**${toolName}** 执行完成`;
        if (output && output.length < 200) {
          statusText += `\n\`\`\`\n${output}\n\`\`\``;
        }
        break;
      case 'error':
        emoji = '❌';
        statusText = `**${toolName}** 执行失败`;
        if (output) {
          statusText += `: ${output.substring(0, 100)}`;
        }
        break;
    }
    
    // Only send running status for long-running tools
    if (status === 'running') {
      // Add to buffer's tool steps
      if (!this.responseBuffers.has(actualSessionId)) {
        this.responseBuffers.set(actualSessionId, { texts: [], lastSent: 0, toolSteps: [] });
      }
      this.responseBuffers.get(actualSessionId)!.toolSteps.push(`${emoji} ${statusText}`);
      return;
    }
    
    // Send completed/error status immediately for important tools
    if (status === 'completed' && toolName.includes('mcp__Chrome__')) {
      // For Chrome MCP, send progress
      await this.doSendToChannel(channelInfo, `${emoji} ${statusText}`);
    }
  }
  
  /**
   * Clear session response buffer (call when session ends)
   * Flushes any pending messages before clearing
   */
  async clearSessionBuffer(actualSessionId: string): Promise<void> {
    // First flush any pending messages
    await this.flushResponseBuffer(actualSessionId);
    
    // Then clear the buffer
    this.responseBuffers.delete(actualSessionId);
    this.sentMessageHashes.delete(actualSessionId);
    const timer = this.sendTimers.get(actualSessionId);
    if (timer) {
      clearTimeout(timer);
      this.sendTimers.delete(actualSessionId);
    }
  }
  
  // ============================================================================
  // Private Methods
  // ============================================================================
  
  /**
   * Set up gateway event handlers
   */
  private setupGatewayEvents(): void {
    if (!this.gateway) return;
    
    this.gateway.on('event', (event) => {
      this.emit('event', event);
    });
    
    this.gateway.on('gateway.pairing_request', (data) => {
      log('[RemoteManager] New pairing request:', data);
      this.emitToRenderer({
        type: 'remote.pairing_request' as any,
        payload: data,
      });
    });
    
    this.gateway.on('gateway.started', () => {
      this.emitStatusUpdate();
    });
    
    this.gateway.on('gateway.stopped', () => {
      this.emitStatusUpdate();
    });
  }
  
  /**
   * Register configured channels
   */
  private async registerChannels(config: any): Promise<void> {
    if (!this.gateway) return;
    
    // Register Feishu channel if configured
    const feishuConfig = config.channels.feishu;
    if (feishuConfig && feishuConfig.appId && feishuConfig.appSecret) {
      const feishuChannel = new FeishuChannel(feishuConfig);
      this.gateway.registerChannel(feishuChannel);
      
      // Set up webhook handler
      this.gateway.on('webhook:feishu', (data: any) => {
        const result = feishuChannel.handleWebhook(data.headers, data.body);
        data.respond(result.status, result.data);
      });
      
      log('[RemoteManager] Feishu channel registered');
    }
    
    // TODO: Register other channels (WeChat, Telegram, DingTalk)
  }
  
  /**
   * Load paired users from config
   */
  private loadPairedUsers(): void {
    const users = remoteConfigStore.getPairedUsers();
    
    for (const user of users) {
      // Re-approve each user in gateway
      // This is a simplified approach - in production you might want to
      // directly set the paired users map
      log('[RemoteManager] Loaded paired user:', user.userId);
    }
  }
  
  /**
   * Execute agent for remote message
   */
  private async executeAgent(
    sessionId: string,
    prompt: string,
    content: ContentBlock[],
    workingDirectory: string | undefined,
    channelType: ChannelType,
    channelId: string,
    onMessage: (message: Message) => void,
    onPartial: (delta: string) => void,
  ): Promise<void> {
    if (!this.agentExecutor) {
      throw new Error('Agent executor not set');
    }
    
    log('[RemoteManager] Executing agent for session:', sessionId);
    log('[RemoteManager] Working directory:', workingDirectory || '(default)');
    
    // Check if this is a new remote session
    const isNewSession = !this.remoteSessionIds.has(sessionId);
    
    if (isNewSession) {
      // Create new session with working directory
      const newSession = await this.agentExecutor.startSession(
        `Remote: ${sessionId}`,
        prompt,
        workingDirectory
      );
      
      // Map remote session ID to actual session ID
      this.remoteSessionIds.add(sessionId);
      
      // Store bidirectional mapping
      this.sessionIdMapping.set(newSession.id, sessionId);
      this.reverseSessionIdMapping.set(sessionId, newSession.id);
      
      // Store channel info for routing responses back
      this.sessionChannelMapping.set(sessionId, { channelType, channelId });
      
      log('[RemoteManager] Created new session:', newSession.id, 'for remote:', sessionId, 'cwd:', workingDirectory);
      log('[RemoteManager] Session mapping stored:', newSession.id, '<->', sessionId);
    } else {
      // Continue existing session - use actual session ID
      const actualSessionId = this.reverseSessionIdMapping.get(sessionId);
      if (!actualSessionId) {
        throw new Error(`No actual session ID found for remote session: ${sessionId}`);
      }
      log('[RemoteManager] Continuing session:', actualSessionId, 'for remote:', sessionId);
      await this.agentExecutor.continueSession(actualSessionId, prompt, content);
    }
    
    // Note: The actual response handling is done through the session manager
    // and agent runner callbacks. This is a simplified implementation.
    // In a full implementation, we would:
    // 1. Hook into the agent runner's streaming output
    // 2. Call onMessage and onPartial as the agent produces output
    // 3. Handle errors and timeouts
  }
  
  /**
   * Emit status update to renderer
   */
  private emitStatusUpdate(): void {
    this.emitToRenderer({
      type: 'remote.status' as any,
      payload: this.getStatus(),
    });
  }
  
  /**
   * Emit event to renderer
   */
  private emitToRenderer(event: ServerEvent): void {
    if (this.sendToRenderer) {
      this.sendToRenderer(event);
    }
    this.emit('renderer-event', event);
  }
}

// Singleton instance
export const remoteManager = new RemoteManager();
