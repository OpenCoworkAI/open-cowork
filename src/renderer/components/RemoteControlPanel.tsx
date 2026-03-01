/**
 * Remote Control Settings Panel
 * 远程控制设置面板 - 重新设计的现代化界面
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Power,
  Users,
  MessageSquare,
  Check,
  Trash2,
  Shield,
  Loader2,
  Copy,
  ExternalLink,
  Zap,
  Settings2,
  Smartphone,
  Link2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

interface GatewayStatus {
  running: boolean;
  port?: number;
  publicUrl?: string;
  channels: Array<{ type: string; connected: boolean; error?: string }>;
  activeSessions: number;
  pendingPairings: number;
}

interface PairedUser {
  userId: string;
  userName?: string;
  channelType: string;
  pairedAt: number;
  lastActiveAt: number;
}

interface PairingRequest {
  code: string;
  channelType: string;
  userId: string;
  userName?: string;
  createdAt: number;
  expiresAt: number;
}

interface RemoteConfig {
  gateway: {
    enabled: boolean;
    port: number;
    bind: string;
    defaultWorkingDirectory?: string;
    autoApproveSafeTools?: boolean;
    tunnel?: {
      enabled: boolean;
      type: 'ngrok' | 'cloudflare' | 'frp';
      ngrok?: {
        authToken: string;
        region?: string;
      };
    };
    auth: {
      mode: string;
      token?: string;
      requirePairing?: boolean;
    };
  };
  channels: {
    feishu?: {
      appId: string;
      appSecret: string;
      useWebSocket?: boolean;
      dm: {
        policy: string;
      };
    };
  };
}

interface TunnelStatus {
  connected: boolean;
  url: string | null;
  provider: string;
  error?: string;
}

// 配置步骤
type ConfigStep = 'feishu' | 'connection' | 'advanced';

export function RemoteControlPanel() {
  // @ts-ignore - Reserved for future i18n support
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { t } = useTranslation();
  
  // State
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  // @ts-ignore - Reserved for future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [config, setConfig] = useState<RemoteConfig | null>(null);
  const [pairedUsers, setPairedUsers] = useState<PairedUser[]>([]);
  const [pendingPairings, setPendingPairings] = useState<PairingRequest[]>([]);
  const [isTogglingGateway, setIsTogglingGateway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<ConfigStep>('feishu');
  
  // Form state
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuDmPolicy, setFeishuDmPolicy] = useState('pairing');
  const [gatewayPort, setGatewayPort] = useState(18789);
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState('');
  const [autoApproveSafeTools, setAutoApproveSafeTools] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [useLongConnection, setUseLongConnection] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [ngrokAuthToken, setNgrokAuthToken] = useState('');
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatus | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  
  // Load data
  useEffect(() => {
    loadData();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, []);
  
  async function loadData() {
    if (!isElectron) return;
    setIsLoading(true);
    try {
      const [configResult, statusResult, usersResult, pairingsResult, tunnelStatusResult, webhookUrlResult] = await Promise.all([
        window.electronAPI.remote.getConfig(),
        window.electronAPI.remote.getStatus(),
        window.electronAPI.remote.getPairedUsers(),
        window.electronAPI.remote.getPendingPairings(),
        window.electronAPI.remote.getTunnelStatus(),
        window.electronAPI.remote.getWebhookUrl(),
      ]);
      
      setConfig(configResult);
      setStatus(statusResult);
      setPairedUsers(usersResult);
      setPendingPairings(pairingsResult);
      setTunnelStatus(tunnelStatusResult);
      setWebhookUrl(webhookUrlResult);
      
      if (configResult) {
        setGatewayPort(configResult.gateway?.port || 18789);
        setDefaultWorkingDirectory(configResult.gateway?.defaultWorkingDirectory || '');
        setAutoApproveSafeTools(configResult.gateway?.autoApproveSafeTools !== false);
        setTunnelEnabled(configResult.gateway?.tunnel?.enabled || false);
        setNgrokAuthToken(configResult.gateway?.tunnel?.ngrok?.authToken || '');
        if (configResult.channels?.feishu) {
          setFeishuAppId(configResult.channels.feishu.appId || '');
          setFeishuAppSecret(configResult.channels.feishu.appSecret || '');
          setFeishuDmPolicy(configResult.channels.feishu.dm?.policy || 'pairing');
          setUseLongConnection(configResult.channels.feishu.useWebSocket !== false);
        }
      }
    } catch (err) {
      console.error('Failed to load remote config:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshStatus() {
    if (!isElectron) return;
    try {
      const [statusResult, pairingsResult, tunnelStatusResult, webhookUrlResult] = await Promise.all([
        window.electronAPI.remote.getStatus(),
        window.electronAPI.remote.getPendingPairings(),
        window.electronAPI.remote.getTunnelStatus(),
        window.electronAPI.remote.getWebhookUrl(),
      ]);
      setStatus(statusResult);
      setPendingPairings(pairingsResult);
      setTunnelStatus(tunnelStatusResult);
      setWebhookUrl(webhookUrlResult);
    } catch (err) {
      console.error('Failed to refresh status:', err);
    }
  }

  async function toggleGateway() {
    if (!isElectron || isTogglingGateway) return;
    setIsTogglingGateway(true);
    setError(null);
    try {
      const newEnabled = !status?.running;
      await window.electronAPI.remote.setEnabled(newEnabled);
      await refreshStatus();
      setSuccess(newEnabled ? '远程控制已启动' : '远程控制已停止');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('操作失败');
    } finally {
      setIsTogglingGateway(false);
    }
  }

  async function saveConfig() {
    if (!isElectron) return;
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.remote.updateGatewayConfig({
        port: gatewayPort,
        defaultWorkingDirectory: defaultWorkingDirectory || undefined,
        autoApproveSafeTools,
        tunnel: tunnelEnabled && ngrokAuthToken ? {
          enabled: true,
          type: 'ngrok',
          ngrok: { authToken: ngrokAuthToken, region: 'us' },
        } : { enabled: false, type: 'ngrok' },
      });
      
      if (feishuAppId && feishuAppSecret) {
        await window.electronAPI.remote.updateFeishuConfig({
          type: 'feishu',
          appId: feishuAppId,
          appSecret: feishuAppSecret,
          useWebSocket: useLongConnection,
          dm: { policy: feishuDmPolicy as 'open' | 'pairing' | 'allowlist' },
        });
      }
      
      setSuccess('配置已保存');
      setTimeout(() => setSuccess(null), 3000);
      await loadData();
    } catch (err) {
      setError('保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  async function approvePairing(request: PairingRequest) {
    if (!isElectron) return;
    try {
      await window.electronAPI.remote.approvePairing(request.channelType, request.userId);
      setSuccess('配对已批准');
      setTimeout(() => setSuccess(null), 3000);
      await loadData();
    } catch (err) {
      setError('批准失败');
    }
  }

  async function revokePairing(user: PairedUser) {
    if (!isElectron) return;
    try {
      await window.electronAPI.remote.revokePairing(user.channelType, user.userId);
      setSuccess('用户已移除');
      setTimeout(() => setSuccess(null), 3000);
      await loadData();
    } catch (err) {
      setError('移除失败');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setSuccess('已复制');
    setTimeout(() => setSuccess(null), 2000);
  }

  // 检查配置完成度
  const isFeishuConfigured = !!(feishuAppId && feishuAppSecret);
  const isConnectionConfigured = useLongConnection || (tunnelEnabled && ngrokAuthToken) || tunnelStatus?.connected;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* 通知 */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <span className="text-red-500">{error}</span>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
          <span className="text-green-500">{success}</span>
        </div>
      )}

      {/* 主控制卡片 */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-surface to-surface-hover">
        <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative p-6">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-2xl ${status?.running ? 'bg-green-500/10' : 'bg-surface-active'}`}>
                <Smartphone className={`w-8 h-8 ${status?.running ? 'text-green-500' : 'text-text-muted'}`} />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-text-primary">远程控制</h2>
                <p className="text-sm text-text-secondary mt-0.5">
                  {status?.running ? '正在运行 - 可通过飞书控制' : '未启动'}
                </p>
              </div>
            </div>
            
            <button
              onClick={toggleGateway}
              disabled={isTogglingGateway || !isFeishuConfigured}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all ${
                status?.running
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-accent hover:bg-accent/90 text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isTogglingGateway ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Power className="w-4 h-4" />
              )}
              {status?.running ? '停止服务' : '启动服务'}
            </button>
          </div>
          
          {/* 状态指标 */}
          {status?.running && (
            <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t border-border/50">
              <div className="text-center p-3 rounded-xl bg-surface/50">
                <div className="text-2xl font-bold text-accent">{status.activeSessions}</div>
                <div className="text-xs text-text-muted mt-1">活跃会话</div>
              </div>
              <div className="text-center p-3 rounded-xl bg-surface/50">
                <div className="text-2xl font-bold text-green-500">{pairedUsers.length}</div>
                <div className="text-xs text-text-muted mt-1">已授权用户</div>
              </div>
              <div className="text-center p-3 rounded-xl bg-surface/50">
                <div className="text-2xl font-bold text-yellow-500">{pendingPairings.length}</div>
                <div className="text-xs text-text-muted mt-1">待授权</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 配对请求 */}
      {pendingPairings.length > 0 && (
        <div className="p-5 rounded-2xl border-2 border-yellow-500/30 bg-yellow-500/5">
          <h3 className="font-medium text-yellow-600 dark:text-yellow-400 mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5" />
            待授权的配对请求
          </h3>
          <div className="space-y-3">
            {pendingPairings.map((request) => (
              <div
                key={`${request.channelType}-${request.userId}`}
                className="flex items-center justify-between p-4 bg-surface rounded-xl"
              >
                <div>
                  <div className="font-medium text-text-primary">
                    {request.userName || '未知用户'}
                  </div>
                  <div className="text-sm text-text-secondary mt-1">
                    配对码: <span className="font-mono text-yellow-600 dark:text-yellow-400 font-bold">{request.code}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => approvePairing(request)}
                    className="p-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-colors"
                    title="批准"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 配置步骤导航 */}
      <div className="flex items-center gap-2 p-1 bg-surface rounded-xl">
        {[
          { id: 'feishu', label: '飞书配置', icon: MessageSquare, done: isFeishuConfigured },
          { id: 'connection', label: '连接方式', icon: Link2, done: isConnectionConfigured },
          { id: 'advanced', label: '高级设置', icon: Settings2, done: true },
        ].map((step) => (
          <button
            key={step.id}
            onClick={() => setActiveStep(step.id as ConfigStep)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all ${
              activeStep === step.id
                ? 'bg-accent text-white'
                : 'hover:bg-surface-hover text-text-secondary'
            }`}
          >
            {step.done && activeStep !== step.id ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : (
              <step.icon className="w-4 h-4" />
            )}
            <span className="text-sm font-medium">{step.label}</span>
          </button>
        ))}
      </div>

      {/* 配置内容 */}
      <div className="p-6 rounded-2xl border border-border bg-surface">
        {/* 步骤 1: 飞书配置 */}
        {activeStep === 'feishu' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-text-primary mb-1">飞书机器人配置</h3>
              <p className="text-sm text-text-secondary">
                在飞书开放平台创建应用后，填入凭证信息
              </p>
            </div>
            
            <div className="grid gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  App ID
                </label>
                <input
                  type="text"
                  value={feishuAppId}
                  onChange={(e) => setFeishuAppId(e.target.value)}
                  className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
                  placeholder="cli_xxxxxxxxxxxxxxxx"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  App Secret
                </label>
                <input
                  type="password"
                  value={feishuAppSecret}
                  onChange={(e) => setFeishuAppSecret(e.target.value)}
                  className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all"
                  placeholder="••••••••••••••••"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  私聊授权策略
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'pairing', label: '配对验证', desc: '需要输入配对码' },
                    { value: 'allowlist', label: '白名单', desc: '仅允许指定用户' },
                    { value: 'open', label: '开放', desc: '所有人可用' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setFeishuDmPolicy(option.value)}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${
                        feishuDmPolicy === option.value
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-accent/50'
                      }`}
                    >
                      <div className="font-medium text-text-primary text-sm">{option.label}</div>
                      <div className="text-xs text-text-muted mt-0.5">{option.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            <a
              href="https://open.feishu.cn/app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-accent hover:underline"
            >
              <ExternalLink className="w-4 h-4" />
              打开飞书开放平台
            </a>
          </div>
        )}

        {/* 步骤 2: 连接方式 */}
        {activeStep === 'connection' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-text-primary mb-1">连接方式</h3>
              <p className="text-sm text-text-secondary">
                选择飞书服务器如何与你的电脑通信
              </p>
            </div>
            
            {/* 长连接模式 - 推荐 */}
            <div
              onClick={() => setUseLongConnection(true)}
              className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                useLongConnection
                  ? 'border-green-500 bg-green-500/5'
                  : 'border-border hover:border-green-500/50'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`p-2 rounded-lg ${useLongConnection ? 'bg-green-500/10' : 'bg-surface-active'}`}>
                  <Zap className={`w-6 h-6 ${useLongConnection ? 'text-green-500' : 'text-text-muted'}`} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary">长连接模式</span>
                    <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/10 text-green-500 font-medium">
                      推荐
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary mt-1">
                    应用主动连接飞书服务器，无需公网 IP 或 ngrok
                  </p>
                  <div className="flex items-center gap-4 mt-3 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> 无需公网
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> 开箱即用
                    </span>
                    <span className="flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> 稳定可靠
                    </span>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  useLongConnection ? 'border-green-500 bg-green-500' : 'border-border'
                }`}>
                  {useLongConnection && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
            </div>
            
            {/* Webhook 模式 */}
            <div
              onClick={() => setUseLongConnection(false)}
              className={`p-5 rounded-xl border-2 cursor-pointer transition-all ${
                !useLongConnection
                  ? 'border-accent bg-accent/5'
                  : 'border-border hover:border-accent/50'
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`p-2 rounded-lg ${!useLongConnection ? 'bg-accent/10' : 'bg-surface-active'}`}>
                  <Link2 className={`w-6 h-6 ${!useLongConnection ? 'text-accent' : 'text-text-muted'}`} />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-text-primary">Webhook 模式</div>
                  <p className="text-sm text-text-secondary mt-1">
                    飞书主动推送消息到你的服务器，需要公网可访问的地址
                  </p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  !useLongConnection ? 'border-accent bg-accent' : 'border-border'
                }`}>
                  {!useLongConnection && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
              
              {/* Webhook URL 显示 */}
              {!useLongConnection && (
                <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
                  <div>
                    <label className="block text-xs text-text-muted mb-1">本地 Webhook 地址</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-surface-hover rounded-lg text-sm font-mono text-text-secondary truncate">
                        http://127.0.0.1:{gatewayPort}/webhook/feishu
                      </code>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(`http://127.0.0.1:${gatewayPort}/webhook/feishu`);
                        }}
                        className="p-2 rounded-lg hover:bg-surface-active transition-colors"
                      >
                        <Copy className="w-4 h-4 text-text-muted" />
                      </button>
                    </div>
                  </div>
                  
                  {/* 内置 ngrok */}
                  <div className="p-4 rounded-lg bg-surface-hover">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-text-primary">使用内置 ngrok</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTunnelEnabled(!tunnelEnabled);
                        }}
                        className={`relative w-10 h-5 rounded-full transition-colors ${
                          tunnelEnabled ? 'bg-accent' : 'bg-surface-active'
                        }`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          tunnelEnabled ? 'left-5' : 'left-0.5'
                        }`} />
                      </button>
                    </div>
                    
                    {tunnelEnabled && (
                      <div>
                        <input
                          type="password"
                          value={ngrokAuthToken}
                          onChange={(e) => setNgrokAuthToken(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
                          placeholder="ngrok authtoken"
                        />
                        <p className="text-xs text-text-muted mt-2">
                          从 <a href="https://ngrok.com" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">ngrok.com</a> 免费获取
                        </p>
                      </div>
                    )}
                    
                    {tunnelStatus?.connected && webhookUrl && (
                      <div className="mt-3 p-2 rounded-lg bg-green-500/10">
                        <div className="flex items-center gap-2 text-green-500 text-sm">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>隧道已连接</span>
                        </div>
                        <code className="block mt-1 text-xs font-mono text-text-secondary truncate">
                          {webhookUrl}
                        </code>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            
            {useLongConnection && (
              <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                <p className="text-sm text-blue-600 dark:text-blue-400">
                  <strong>配置提示：</strong>在飞书开放平台 → 事件与回调 → 事件配置 中，将订阅方式改为"使用长连接接收事件"
                </p>
              </div>
            )}
          </div>
        )}

        {/* 步骤 3: 高级设置 */}
        {activeStep === 'advanced' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-text-primary mb-1">高级设置</h3>
              <p className="text-sm text-text-secondary">
                自定义远程控制的行为
              </p>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  默认工作目录
                </label>
                <input
                  type="text"
                  value={defaultWorkingDirectory}
                  onChange={(e) => setDefaultWorkingDirectory(e.target.value)}
                  className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none"
                  placeholder="例如: C:\Users\你的用户名\Projects"
                />
                <p className="text-xs text-text-muted mt-1">
                  AI 执行命令时的默认目录，也可以在消息中用 <code className="px-1 py-0.5 bg-surface-active rounded">[cwd:路径]</code> 临时指定
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  服务端口
                </label>
                <input
                  type="number"
                  value={gatewayPort}
                  onChange={(e) => setGatewayPort(parseInt(e.target.value) || 18789)}
                  className="w-full px-4 py-3 bg-surface-hover border border-border rounded-xl text-text-primary focus:border-accent focus:outline-none"
                  placeholder="18789"
                />
              </div>
              
              <div className="flex items-center justify-between p-4 rounded-xl bg-surface-hover">
                <div>
                  <div className="font-medium text-text-primary text-sm">自动批准安全工具</div>
                  <p className="text-xs text-text-muted mt-0.5">
                    自动允许执行读取文件、浏览器操作等安全工具
                  </p>
                </div>
                <button
                  onClick={() => setAutoApproveSafeTools(!autoApproveSafeTools)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    autoApproveSafeTools ? 'bg-accent' : 'bg-surface-active'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    autoApproveSafeTools ? 'left-5' : 'left-0.5'
                  }`} />
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* 保存按钮 */}
        <div className="flex justify-end mt-6 pt-6 border-t border-border">
          <button
            onClick={saveConfig}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            保存配置
          </button>
        </div>
      </div>

      {/* 已授权用户 */}
      {pairedUsers.length > 0 && (
        <div className="p-6 rounded-2xl border border-border bg-surface">
          <h3 className="font-medium text-text-primary mb-4 flex items-center gap-2">
            <Users className="w-5 h-5" />
            已授权用户 ({pairedUsers.length})
          </h3>
          <div className="space-y-2">
            {pairedUsers.map((user) => (
              <div
                key={`${user.channelType}-${user.userId}`}
                className="flex items-center justify-between p-3 rounded-xl bg-surface-hover"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-accent" />
                  </div>
                  <div>
                    <div className="font-medium text-text-primary text-sm">
                      {user.userName || user.userId.slice(0, 12) + '...'}
                    </div>
                    <div className="text-xs text-text-muted">
                      {new Date(user.lastActiveAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => revokePairing(user)}
                  className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors"
                  title="移除授权"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 快速帮助 */}
      <div className="p-5 rounded-2xl border border-border bg-surface-hover">
        <h4 className="font-medium text-text-primary mb-3">快速入门</h4>
        <ol className="space-y-2 text-sm text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
            <span>在飞书开放平台创建应用，添加"机器人"能力</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
            <span>复制 App ID 和 App Secret 填入上方</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            <span>
              在权限管理中勾选以下权限：
              <code className="px-1 py-0.5 bg-surface rounded ml-1">im:resource</code>、
              <code className="px-1 py-0.5 bg-surface rounded ml-1">im:message</code>、
              <code className="px-1 py-0.5 bg-surface rounded ml-1">im:message:send_as_bot</code>、
              <code className="px-1 py-0.5 bg-surface rounded ml-1">im:message.group_at_msg:readonly</code>、
              <code className="px-1 py-0.5 bg-surface rounded ml-1">im:message.p2p_msg:readonly</code>、
              <code className="px-1 py-0.5 bg-surface rounded ml-1">contact:user.base:readonly</code>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
            <span>在飞书平台的"事件配置"中选择"使用长连接接收事件"</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">5</span>
            <span>订阅 <code className="px-1 py-0.5 bg-surface rounded">im.message.receive_v1</code> 事件</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent/10 text-accent text-xs flex items-center justify-center flex-shrink-0 mt-0.5">6</span>
            <span>发布应用后，点击"启动服务"即可</span>
          </li>
        </ol>
      </div>
    </div>
  );
}
