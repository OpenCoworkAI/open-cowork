import { useState, useEffect, useRef } from 'react';
import { X, Key, Server, Cpu, CheckCircle, AlertCircle, Loader2, Edit3, Plug } from 'lucide-react';
import type { AppConfig, ProviderPresets, ApiTestResult } from '../types';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Partial<AppConfig>) => Promise<void>;
  initialConfig?: AppConfig | null;
  isFirstRun?: boolean;
}

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

const FALLBACK_PRESETS: ProviderPresets = {
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    models: [
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'moonshotai/kimi-k2-0905', name: 'Kimi K2' },
      { id: 'z-ai/glm-4.7', name: 'GLM-4.7' },
    ],
    keyPlaceholder: 'sk-or-v1-...',
    keyHint: '从 openrouter.ai/keys 获取',
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: [
      { id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5' },
      { id: 'claude-opus-4-5', name: 'claude-opus-4-5' },
      { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' },
    ],
    keyPlaceholder: 'sk-ant-...',
    keyHint: '从 console.anthropic.com 获取',
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.2', name: 'gpt-5.2' },
      { id: 'gpt-5.2-codex', name: 'gpt-5.2-codex' },
      { id: 'gpt-5.2-mini', name: 'gpt-5.2-mini' },
    ],
    keyPlaceholder: 'sk-...',
    keyHint: '从 platform.openai.com 获取',
  },
  custom: {
    name: '更多模型',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: [
      { id: 'glm-4.7', name: 'GLM-4.7' },
      { id: 'glm-4-plus', name: 'GLM-4-Plus' },
      { id: 'glm-4-air', name: 'GLM-4-Air' },
    ],
    keyPlaceholder: 'sk-xxx',
    keyHint: '输入你的 API Key',
  },
};

const PROVIDER_LABELS: Record<'openrouter' | 'anthropic' | 'openai' | 'custom', string> = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  custom: 'Custom',
};

export function ConfigModal({ isOpen, onClose, onSave, initialConfig, isFirstRun }: ConfigModalProps) {
  const [provider, setProvider] = useState<'openrouter' | 'anthropic' | 'custom' | 'openai'>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [customProtocol, setCustomProtocol] = useState<'anthropic' | 'openai'>('anthropic');
  const [model, setModel] = useState('');
  const [openaiMode, setOpenaiMode] = useState<'responses' | 'chat'>('responses');
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [presets, setPresets] = useState<ProviderPresets | null>(
    isElectron ? null : FALLBACK_PRESETS
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ApiTestResult | null>(null);
  const [useLiveTest, setUseLiveTest] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const skipPresetApplyRef = useRef(false);
  const previousProviderRef = useRef(provider);

  // Load presets and initial config
  useEffect(() => {
    if (!isOpen) return;
    setIsInitialLoad(true);
    if (isElectron) {
      loadPresets();
    } else {
      setPresets(FALLBACK_PRESETS);
    }
  }, [isOpen]);

  // Apply initial config
  useEffect(() => {
    if (initialConfig && presets) {
      skipPresetApplyRef.current = true;
      setProvider(initialConfig.provider);
      setApiKey(initialConfig.apiKey || '');
      setBaseUrl(initialConfig.baseUrl || '');
      setCustomProtocol(initialConfig.customProtocol || 'anthropic');
      setOpenaiMode('responses');

      // Check if model is in preset list or custom
      const preset = presets?.[initialConfig.provider];
      const isPresetModel = preset?.models.some(m => m.id === initialConfig.model);

      if (isPresetModel) {
        setModel(initialConfig.model || '');
        setUseCustomModel(false);
      } else if (initialConfig.model) {
        // Model is not in preset list, use custom model input
        setUseCustomModel(true);
        setCustomModel(initialConfig.model);
      }

      // Mark initial load as complete
      setIsInitialLoad(false);
    }
  }, [initialConfig, presets]);

  useEffect(() => {
    if (!presets || !isInitialLoad || initialConfig) return;
    const preset = presets[provider];
    if (preset) {
      setBaseUrl(preset.baseUrl);
      setUseCustomModel(false);
      setModel(preset.models[0]?.id || '');
    }
    setIsInitialLoad(false);
  }, [presets, isInitialLoad, initialConfig, provider]);

  // Update baseUrl and model when provider changes (but not on initial load)
  useEffect(() => {
    if (presets && !isInitialLoad) {
      if (skipPresetApplyRef.current) {
        skipPresetApplyRef.current = false;
        return;
      }
      const preset = presets[provider];
      if (preset) {
        if (provider === 'custom') {
          if (previousProviderRef.current !== 'custom') {
            setBaseUrl(preset.baseUrl);
          }
        } else {
          setBaseUrl(preset.baseUrl);
        }
        // Reset to preset model when switching providers
        setUseCustomModel(false);
        setModel(preset.models[0]?.id || '');
      }
    }
    previousProviderRef.current = provider;
  }, [provider, presets, isInitialLoad]);

  useEffect(() => {
    if (provider === 'openai' || (provider === 'custom' && customProtocol === 'openai')) {
      setOpenaiMode('responses');
    }
  }, [provider, customProtocol]);

  useEffect(() => {
    setTestResult(null);
  }, [provider, apiKey, baseUrl, customProtocol, model, customModel, useCustomModel]);

  async function loadPresets() {
    try {
      const loadedPresets = await window.electronAPI.config.getPresets();
      setPresets(loadedPresets);
    } catch (err) {
      console.error('Failed to load presets:', err);
      setPresets(FALLBACK_PRESETS);
    }
  }

  async function handleTest() {
    if (!apiKey.trim()) {
      setError('请输入 API Key');
      return;
    }

    const finalModel = useCustomModel ? customModel.trim() : model;
    if (!finalModel) {
      setError('请选择或输入模型名称');
      return;
    }

    setError('');
    setIsTesting(true);
    setTestResult(null);

    try {
      const presetBaseUrl = presets?.[provider]?.baseUrl;
      const resolvedBaseUrl = provider === 'custom'
        ? baseUrl.trim()
        : (presetBaseUrl || baseUrl).trim();

      const result = await window.electronAPI.config.test({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: resolvedBaseUrl || undefined,
        customProtocol,
        model: finalModel,
        useLiveRequest: useLiveTest,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        ok: false,
        errorType: 'unknown',
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSave() {
    if (!apiKey.trim()) {
      setError('请输入 API Key');
      return;
    }

    // Determine which model to use
    const finalModel = useCustomModel ? customModel.trim() : model;
    
    if (!finalModel) {
      setError('请选择或输入模型名称');
      return;
    }

    setError('');
    setIsSaving(true);

    try {
      const presetBaseUrl = presets?.[provider]?.baseUrl;
      const resolvedBaseUrl = provider === 'custom'
        ? baseUrl.trim()
        : (presetBaseUrl || baseUrl).trim();

      const resolvedOpenaiMode =
        provider === 'openai' || (provider === 'custom' && customProtocol === 'openai')
          ? 'responses'
          : openaiMode;

      await onSave({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: resolvedBaseUrl || undefined,
        customProtocol,
        model: finalModel,
        openaiMode: resolvedOpenaiMode,
      });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) return null;

  const currentPreset = presets?.[provider];
  const testErrorMessage = (result: ApiTestResult) => {
    switch (result.errorType) {
      case 'missing_key':
        return '请填写 API Key';
      case 'missing_base_url':
        return '请填写 Base URL';
      case 'unauthorized':
        return 'API Key 无效或无权限';
      case 'not_found':
        return '接口未找到，请检查 Base URL';
      case 'rate_limited':
        return '请求过于频繁或额度不足';
      case 'server_error':
        return '服务端错误，请稍后再试';
      case 'network_error':
        return '网络连接失败，请检查地址或网络';
      default:
        return '连接失败';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent to-accent-hover flex items-center justify-center">
              <Key className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                {isFirstRun ? '欢迎使用 Open Cowork' : 'API 配置'}
              </h2>
              <p className="text-sm text-text-secondary">
                {isFirstRun ? '首次使用需要配置 API' : '修改你的 API 设置'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Server className="w-4 h-4" />
              API 提供商
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['openrouter', 'anthropic', 'openai', 'custom'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    provider === p
                      ? 'bg-accent text-white'
                      : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                  }`}
                >
                  {presets?.[p]?.name || PROVIDER_LABELS[p] || p}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Key className="w-4 h-4" />
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={currentPreset?.keyPlaceholder || '输入你的 API Key'}
              className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
            />
            {currentPreset?.keyHint && (
              <p className="text-xs text-text-muted">{currentPreset.keyHint}</p>
            )}
          </div>

          {/* Custom Protocol */}
          {provider === 'custom' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Server className="w-4 h-4" />
                协议
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'anthropic', label: 'Anthropic' },
                  { id: 'openai', label: 'OpenAI' },
                ] as const).map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setCustomProtocol(mode.id)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      customProtocol === mode.id
                        ? 'bg-accent text-white'
                        : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted">根据协议选择对应的兼容服务</p>
            </div>
          )}

          {/* Base URL - Editable for custom provider */}
          {provider === 'custom' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Server className="w-4 h-4" />
                Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  customProtocol === 'openai'
                    ? 'https://api.openai.com/v1'
                    : (currentPreset?.baseUrl || 'https://api.anthropic.com')
                }
                className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
              />
              <p className="text-xs text-text-muted">
                {customProtocol === 'openai'
                  ? '输入兼容 OpenAI API 的服务地址'
                  : '输入兼容 Anthropic API 的服务地址'}
              </p>
            </div>
          )}

          {/* Model Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Cpu className="w-4 h-4" />
                模型
              </label>
              <button
                type="button"
                onClick={() => setUseCustomModel(!useCustomModel)}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-all ${
                  useCustomModel
                    ? 'bg-accent-muted text-accent'
                    : 'bg-surface-hover text-text-secondary hover:bg-surface-active'
                }`}
              >
                <Edit3 className="w-3 h-3" />
                {useCustomModel ? '使用预设' : '自定义'}
              </button>
            </div>
            {useCustomModel ? (
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder={
                  provider === 'openrouter'
                    ? 'openai/gpt-4o 或其他模型ID'
                    : provider === 'openai' || (provider === 'custom' && customProtocol === 'openai')
                      ? 'gpt-4o'
                      : 'claude-sonnet-4'
                }
                className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all"
              />
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-all appearance-none cursor-pointer"
              >
                {currentPreset?.models.length ? (
                  currentPreset.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))
                ) : (
                  <option value="" disabled>
                    暂无可用模型
                  </option>
                )}
              </select>
            )}
            {useCustomModel && (
              <p className="text-xs text-text-muted">
                输入模型 ID，如 moonshotai/kimi-k2-0905、openai/gpt-4o 等
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 text-success text-sm">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              保存成功！
            </div>
          )}
          {testResult && (
            <div className={`flex gap-2 px-4 py-3 rounded-xl text-sm ${testResult.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
              {testResult.ok ? (
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              )}
              <div className="flex-1">
                <div>
                  {testResult.ok
                    ? `连接成功（${typeof testResult.latencyMs === 'number' ? testResult.latencyMs : '--'}ms）`
                    : testErrorMessage(testResult)}
                </div>
                {!testResult.ok && testResult.details && (
                  <div className="mt-1 text-xs text-text-muted">{testResult.details}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-hover border-t border-border">
          <div className="flex items-start gap-2 text-xs text-text-muted mb-3">
            <input
              type="checkbox"
              id="api-live-test-modal"
              checked={useLiveTest}
              onChange={(e) => setUseLiveTest(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-border text-accent focus:ring-accent"
            />
            <label htmlFor="api-live-test-modal" className="space-y-0.5">
              <div className="text-text-primary">真实请求验证</div>
              <div>会发送一次最小请求，可能消耗少量额度</div>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleTest}
              disabled={isTesting || !apiKey.trim()}
              className="w-full py-3 px-4 rounded-xl border border-border bg-surface text-text-primary font-medium hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  测试中...
                </>
              ) : (
                <>
                  <Plug className="w-4 h-4" />
                  测试连接
                </>
              )}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !apiKey.trim()}
              className="w-full py-3 px-4 rounded-xl bg-accent text-white font-medium hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  {isFirstRun ? '开始使用' : '保存配置'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
