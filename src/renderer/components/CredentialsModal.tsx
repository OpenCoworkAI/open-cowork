import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Edit3, Key, Mail, Globe, Lock, Eye, EyeOff, Save, AlertCircle } from 'lucide-react';
import { logError } from '../utils/logger';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export interface UserCredential {
  id: string;
  name: string;
  type: 'email' | 'website' | 'api' | 'other';
  service?: string;
  username: string;
  password?: string;  // Only present when editing
  url?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface CredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SERVICE_OPTIONS = [
  { value: 'gmail', label: 'Gmail' },
  { value: 'outlook', label: 'Outlook / Hotmail' },
  { value: 'yahoo', label: 'Yahoo Mail' },
  { value: 'icloud', label: 'iCloud Mail' },
  { value: 'proton', label: 'ProtonMail' },
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'aws', label: 'AWS' },
  { value: 'azure', label: 'Azure' },
  { value: 'other', label: 'Other' },
];

export function CredentialsModal({ isOpen, onClose }: CredentialsModalProps) {
  const [credentials, setCredentials] = useState<UserCredential[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingCredential, setEditingCredential] = useState<UserCredential | null>(null);

  useEffect(() => {
    if (isOpen && isElectron) {
      loadCredentials();
    }
  }, [isOpen]);

  async function loadCredentials() {
    if (!isElectron) return;
    try {
      const loaded = await window.electronAPI.credentials.getAll();
      setCredentials(loaded || []);
      setError('');
    } catch (err) {
      logError('Failed to load credentials:', err);
      setError('Failed to load credentials');
    }
  }

  async function handleSave(credential: Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>) {
    if (!isElectron) return;
    setIsLoading(true);
    setError('');
    try {
      if (editingCredential) {
        await window.electronAPI.credentials.update(editingCredential.id, credential);
      } else {
        await window.electronAPI.credentials.save(credential);
      }
      await loadCredentials();
      setShowForm(false);
      setEditingCredential(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credential');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!isElectron) return;
    if (!confirm('Are you sure you want to delete this credential?')) return;
    
    setIsLoading(true);
    setError('');
    try {
      await window.electronAPI.credentials.delete(id);
      await loadCredentials();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete credential');
    } finally {
      setIsLoading(false);
    }
  }

  function handleEdit(credential: UserCredential) {
    setEditingCredential(credential);
    setShowForm(true);
  }

  function getTypeIcon(type: string) {
    switch (type) {
      case 'email':
        return <Mail className="w-4 h-4" />;
      case 'website':
        return <Globe className="w-4 h-4" />;
      case 'api':
        return <Key className="w-4 h-4" />;
      default:
        return <Lock className="w-4 h-4" />;
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] overflow-hidden border border-border flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
              <Key className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Saved Credentials</h2>
              <p className="text-sm text-text-secondary">Securely stored login information</p>
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
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-error/10 text-error text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Info Banner */}
          <div className="px-4 py-3 rounded-xl bg-blue-500/10 text-blue-600 text-sm">
            <p className="font-medium mb-1">🔐 Securely Encrypted</p>
            <p className="text-xs opacity-80">
              All credentials are encrypted locally. The agent can use these credentials to automatically log in to your accounts.
            </p>
          </div>

          {/* Form */}
          {showForm && (
            <CredentialForm
              credential={editingCredential || undefined}
              onSave={handleSave}
              onCancel={() => {
                setShowForm(false);
                setEditingCredential(null);
              }}
              isLoading={isLoading}
            />
          )}

          {/* Credentials List */}
          {!showForm && (
            <div className="space-y-3">
              {credentials.length === 0 ? (
                <div className="text-center py-12 text-text-muted">
                  <Key className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No saved credentials</p>
                  <p className="text-sm mt-2">Add credentials for the agent to use</p>
                </div>
              ) : (
                credentials.map((cred) => (
                  <div
                    key={cred.id}
                    className="rounded-xl border border-border bg-surface p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          cred.type === 'email' ? 'bg-blue-500/10 text-blue-500' :
                          cred.type === 'website' ? 'bg-green-500/10 text-green-500' :
                          cred.type === 'api' ? 'bg-purple-500/10 text-purple-500' :
                          'bg-gray-500/10 text-gray-500'
                        }`}>
                          {getTypeIcon(cred.type)}
                        </div>
                        <div>
                          <h3 className="font-medium text-text-primary">{cred.name}</h3>
                          <p className="text-sm text-text-secondary">{cred.username}</p>
                          {cred.service && (
                            <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded bg-surface-muted text-text-muted">
                              {SERVICE_OPTIONS.find(s => s.value === cred.service)?.label || cred.service}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(cred)}
                          disabled={isLoading}
                          className="p-2 rounded-lg bg-surface-muted text-text-secondary hover:bg-surface-active transition-colors"
                          title="Edit"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(cred.id)}
                          disabled={isLoading}
                          className="p-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Add Button */}
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-border hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 text-text-secondary hover:text-accent"
            >
              <Plus className="w-5 h-5" />
              Add Credential
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-hover border-t border-border">
          <div className="flex items-center justify-between text-sm text-text-muted">
            <span>
              {credentials.length} credential{credentials.length !== 1 ? 's' : ''} saved
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-surface hover:bg-surface-active transition-colors text-text-primary"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CredentialForm({
  credential,
  onSave,
  onCancel,
  isLoading,
}: {
  credential?: UserCredential;
  onSave: (credential: Omit<UserCredential, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState(credential?.name || '');
  const [type, setType] = useState<UserCredential['type']>(credential?.type || 'email');
  const [service, setService] = useState(credential?.service || '');
  const [username, setUsername] = useState(credential?.username || '');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState(credential?.url || '');
  const [notes, setNotes] = useState(credential?.notes || '');
  const [showPassword, setShowPassword] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    
    if (!name.trim() || !username.trim()) {
      alert('Name and username are required');
      return;
    }

    if (!credential && !password.trim()) {
      alert('Password is required for new credentials');
      return;
    }

    const data: any = {
      name: name.trim(),
      type,
      service: service || undefined,
      username: username.trim(),
      url: url.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    // Only include password if provided (for updates, empty means no change)
    if (password.trim()) {
      data.password = password;
    }

    onSave(data);
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-surface p-4 space-y-4">
      <h3 className="font-medium text-text-primary">
        {credential ? 'Edit Credential' : 'Add New Credential'}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Work Gmail"
            className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as UserCredential['type'])}
            className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="email">Email</option>
            <option value="website">Website</option>
            <option value="api">API Key</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Service</label>
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="">Select a service...</option>
          {SERVICE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Username / Email *</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your.email@example.com"
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">
          Password {credential ? '(leave empty to keep current)' : '*'}
        </label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={credential ? '••••••••' : 'Enter password'}
            className="w-full px-4 py-2 pr-10 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
            required={!credential}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Login URL (optional)</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mail.google.com"
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-primary mb-2">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional notes..."
          rows={2}
          className="w-full px-4 py-2 rounded-lg bg-background border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 py-2 px-4 rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" />
          {isLoading ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="px-4 py-2 rounded-lg bg-surface-muted text-text-secondary hover:bg-surface-active transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
