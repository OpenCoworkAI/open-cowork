import { useState, useEffect } from 'react';
import { X, Key, Server, Cpu, CheckCircle, AlertCircle, Loader2, Edit3 } from 'lucide-react';
import type { AppConfig, ProviderPresets } from '../types';

interface ConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: Partial<AppConfig>) => Promise<void>;
  initialConfig?: AppConfig | null;
  isFirstRun?: boolean;
}

// Check if running in Electron
const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function ConfigModal({ isOpen, onClose, onSave, initialConfig, isFirstRun }: ConfigModalProps) {
  const [provider, setProvider] = useState<'openrouter' | 'anthropic' | 'custom'>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [presets, setPresets] = useState<ProviderPresets | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Load presets and initial config
  useEffect(() => {
    if (isOpen && isElectron) {
      loadPresets();
    }
  }, [isOpen]);

  // Apply initial config
  useEffect(() => {
    if (initialConfig) {
      setProvider(initialConfig.provider);
      setApiKey(initialConfig.apiKey || '');
      setBaseUrl(initialConfig.baseUrl || '');
      
      // Check if model is in preset list or custom
      const preset = presets?.[initialConfig.provider];
      const isPresetModel = preset?.models.some(m => m.id === initialConfig.model);
      
      if (isPresetModel || initialConfig.provider === 'custom') {
        setModel(initialConfig.model || '');
        setUseCustomModel(false);
      } else if (initialConfig.model) {
        // Model is not in preset list, use custom model input
        setUseCustomModel(true);
        setCustomModel(initialConfig.model);
      }
    }
  }, [initialConfig, presets]);

  // Update baseUrl and model when provider changes
  useEffect(() => {
    if (presets && provider !== 'custom') {
      const preset = presets[provider];
      setBaseUrl(preset.baseUrl);
      if (!model || !preset.models.find(m => m.id === model)) {
        setModel(preset.models[0]?.id || '');
      }
    }
  }, [provider, presets]);

  async function loadPresets() {
    try {
      const loadedPresets = await window.electronAPI.config.getPresets();
      setPresets(loadedPresets);
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  }

  async function handleSave() {
    if (!apiKey.trim()) {
      setError('请输入 API Key');
      return;
    }

    // Determine which model to use
    const finalModel = (useCustomModel && provider !== 'custom') ? customModel.trim() : model;
    
    if (!finalModel) {
      setError('请选择或输入模型名称');
      return;
    }

    setError('');
    setIsSaving(true);

    try {
      await onSave({
        provider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        model: finalModel,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[#faf9f6] rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border border-[#e8e6e1]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e6e1]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <Key className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#1a1a1a]">
                {isFirstRun ? '欢迎使用 Open Cowork' : 'API 配置'}
              </h2>
              <p className="text-sm text-[#666]">
                {isFirstRun ? '首次使用需要配置 API' : '修改你的 API 设置'}
              </p>
            </div>
          </div>
          {!isFirstRun && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[#e8e6e1] transition-colors"
            >
              <X className="w-5 h-5 text-[#666]" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-[#1a1a1a]">
              <Server className="w-4 h-4" />
              API 提供商
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['openrouter', 'anthropic', 'custom'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    provider === p
                      ? 'bg-[#1a1a1a] text-white'
                      : 'bg-[#f0eeea] text-[#666] hover:bg-[#e8e6e1]'
                  }`}
                >
                  {presets?.[p]?.name || p}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-[#1a1a1a]">
              <Key className="w-4 h-4" />
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={currentPreset?.keyPlaceholder || '输入你的 API Key'}
              className="w-full px-4 py-3 rounded-xl bg-white border border-[#e8e6e1] text-[#1a1a1a] placeholder-[#999] focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
            />
            {currentPreset?.keyHint && (
              <p className="text-xs text-[#888]">{currentPreset.keyHint}</p>
            )}
          </div>

          {/* Base URL (for custom) */}
          {provider === 'custom' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-[#1a1a1a]">
                <Server className="w-4 h-4" />
                API Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com"
                className="w-full px-4 py-3 rounded-xl bg-white border border-[#e8e6e1] text-[#1a1a1a] placeholder-[#999] focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
              />
            </div>
          )}

          {/* Model Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm font-medium text-[#1a1a1a]">
                <Cpu className="w-4 h-4" />
                模型
              </label>
              {provider !== 'custom' && (
                <button
                  type="button"
                  onClick={() => setUseCustomModel(!useCustomModel)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-all ${
                    useCustomModel 
                      ? 'bg-amber-100 text-amber-700' 
                      : 'bg-[#f0eeea] text-[#666] hover:bg-[#e8e6e1]'
                  }`}
                >
                  <Edit3 className="w-3 h-3" />
                  {useCustomModel ? '使用预设' : '自定义'}
                </button>
              )}
            </div>
            {provider === 'custom' || useCustomModel ? (
              <input
                type="text"
                value={provider === 'custom' ? model : customModel}
                onChange={(e) => provider === 'custom' ? setModel(e.target.value) : setCustomModel(e.target.value)}
                placeholder={provider === 'openrouter' ? 'openai/gpt-4o 或其他模型ID' : 'claude-sonnet-4'}
                className="w-full px-4 py-3 rounded-xl bg-white border border-[#e8e6e1] text-[#1a1a1a] placeholder-[#999] focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
              />
            ) : (
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-white border border-[#e8e6e1] text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all appearance-none cursor-pointer"
              >
                {currentPreset?.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            {useCustomModel && provider !== 'custom' && (
              <p className="text-xs text-[#888]">
                输入模型 ID，如 z-ai/glm-4.7、openai/gpt-4o 等
              </p>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-50 text-green-600 text-sm">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              保存成功！
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#f5f3ee] border-t border-[#e8e6e1]">
          <button
            onClick={handleSave}
            disabled={isSaving || !apiKey.trim()}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white font-medium hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
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
  );
}


