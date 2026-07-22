import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Plus, Save, Trash2, Pencil } from 'lucide-react';
import type { ApiConfigSet } from '../types';
import { Button, IconButton, Input, Badge } from './ui';

type PendingConfigSetAction =
  | { type: 'switch'; targetSetId: string };

interface ApiConfigSetManagerProps {
  configSets: ApiConfigSet[];
  activeConfigSetId: string;
  currentConfigSet: ApiConfigSet | null;
  pendingConfigSetAction: PendingConfigSetAction | null;
  pendingConfigSet: ApiConfigSet | null;
  hasUnsavedChanges: boolean;
  isMutatingConfigSet: boolean;
  isSaving: boolean;
  canDeleteCurrentConfigSet: boolean;
  onSwitchSet: (setId: string) => Promise<void> | void;
  onRequestCreateBlankSet: () => Promise<void> | void;
  onSaveCurrentSet: () => Promise<boolean> | Promise<void> | void;
  onRenameSet: (id: string, name: string) => Promise<boolean> | Promise<void> | void;
  onDeleteSet: (id: string) => Promise<boolean> | Promise<void> | void;
  onCancelPendingAction: () => void;
  onSaveAndContinuePendingAction: () => Promise<void> | void;
  onDiscardAndContinuePendingAction: () => Promise<void> | void;
}

export function ApiConfigSetManager(props: ApiConfigSetManagerProps) {
  const { t } = useTranslation();
  const {
    configSets,
    activeConfigSetId,
    currentConfigSet,
    pendingConfigSetAction,
    pendingConfigSet,
    hasUnsavedChanges,
    isMutatingConfigSet,
    isSaving,
    canDeleteCurrentConfigSet,
    onSwitchSet,
    onRequestCreateBlankSet,
    onSaveCurrentSet,
    onRenameSet,
    onDeleteSet,
    onCancelPendingAction,
    onSaveAndContinuePendingAction,
    onDiscardAndContinuePendingAction,
  } = props;

  const [activeLocalDialog, setActiveLocalDialog] = useState<'none' | 'delete'>('none');
  const [renameName, setRenameName] = useState('');
  const [isInlineRenaming, setIsInlineRenaming] = useState(false);

  useEffect(() => {
    setActiveLocalDialog('none');
    setRenameName(currentConfigSet?.name || '');
    setIsInlineRenaming(false);
  }, [activeConfigSetId, currentConfigSet?.name]);

  const pendingActionMessage = t('api.unsavedSwitchPrompt', { name: pendingConfigSet?.name || '-' });
  const hasDialogOpen = activeLocalDialog !== 'none';
  const canRenameCurrentConfigSet = Boolean(currentConfigSet);

  const cancelInlineRename = () => {
    setRenameName(currentConfigSet?.name || '');
    setIsInlineRenaming(false);
  };

  const commitInlineRename = async () => {
    if (!currentConfigSet) {
      setIsInlineRenaming(false);
      return;
    }
    const nextName = renameName.trim();
    if (!nextName || nextName === currentConfigSet.name) {
      setRenameName(currentConfigSet.name);
      setIsInlineRenaming(false);
      return;
    }
    const renamed = await onRenameSet(currentConfigSet.id, nextName);
    if (renamed === false) {
      setRenameName(currentConfigSet.name);
      return;
    }
    setIsInlineRenaming(false);
  };

  return (
    <div className="space-y-3 py-5 border-b border-border-muted px-4">
      <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
        <Layers className="w-4 h-4" />
        {t('api.configSet')}
        {hasUnsavedChanges && <Badge tone="warning">{t('api.unsavedBadge')}</Badge>}
      </label>
      <div className="space-y-2">
        {isInlineRenaming ? (
          <Input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onBlur={() => { void commitInlineRename(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitInlineRename();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelInlineRename();
              }
            }}
            autoFocus
            disabled={isMutatingConfigSet || hasDialogOpen}
            placeholder={t('api.createSetNamePlaceholder')}
          />
        ) : (
          <select
            value={activeConfigSetId}
            onChange={(e) => { void onSwitchSet(e.target.value); }}
            disabled={isMutatingConfigSet || hasDialogOpen}
            className="w-full px-3 py-2.5 rounded-lg bg-background border border-border-muted text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent disabled:opacity-60"
          >
            {configSets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.isSystem ? `${set.name} (${t('api.defaultSetTag')})` : set.name}
              </option>
            ))}
          </select>
        )}
        {isInlineRenaming && (
          <p className="text-[11px] text-text-muted">{t('api.renameInlineHint')}</p>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { void onSaveCurrentSet(); }}
            disabled={isMutatingConfigSet || hasDialogOpen || isInlineRenaming}
          >
            <Save className="w-3.5 h-3.5" />
            {t('common.save')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { void onRequestCreateBlankSet(); }}
            disabled={isMutatingConfigSet || hasDialogOpen || isInlineRenaming}
          >
            <Plus className="w-3.5 h-3.5" />
            {t('api.newSet')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!currentConfigSet) {
                return;
              }
              setRenameName(currentConfigSet.name);
              setIsInlineRenaming(true);
            }}
            disabled={isMutatingConfigSet || !canRenameCurrentConfigSet || hasDialogOpen || isInlineRenaming}
          >
            <Pencil className="w-3.5 h-3.5" />
            {t('api.renameSet')}
          </Button>
          <div className="flex-1" />
          <IconButton
            variant="danger"
            size="sm"
            onClick={() => setActiveLocalDialog('delete')}
            disabled={isMutatingConfigSet || !canDeleteCurrentConfigSet || hasDialogOpen || isInlineRenaming}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </div>
      <p className="text-xs text-text-muted">{t('api.currentSetSavingHint')}</p>

      {activeLocalDialog === 'delete' && currentConfigSet && (
        <div className="space-y-3 rounded-lg border border-error/30 bg-error/10 px-3 py-3">
          <p className="text-xs text-text-primary">
            {t('api.configSetDeleteConfirm', { name: currentConfigSet.name })}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              onClick={() => setActiveLocalDialog('none')}
              disabled={isMutatingConfigSet}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              fullWidth
              onClick={async () => {
                if (!currentConfigSet || !canDeleteCurrentConfigSet) {
                  return;
                }
                const deleted = await onDeleteSet(currentConfigSet.id);
                if (deleted !== false) {
                  setActiveLocalDialog('none');
                }
              }}
              disabled={isMutatingConfigSet}
            >
              {t('api.deleteSet')}
            </Button>
          </div>
        </div>
      )}

      {pendingConfigSetAction && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-3">
          <p className="text-xs text-text-primary">{pendingActionMessage}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Button
              variant="primary"
              size="sm"
              fullWidth
              onClick={() => { void onSaveAndContinuePendingAction(); }}
              disabled={isMutatingConfigSet || isSaving}
            >
              {t('api.saveAndContinue')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              onClick={() => { void onDiscardAndContinuePendingAction(); }}
              disabled={isMutatingConfigSet || isSaving}
            >
              {t('api.discardAndContinue')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              onClick={onCancelPendingAction}
              disabled={isMutatingConfigSet || isSaving}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {hasUnsavedChanges && !pendingConfigSetAction && (
        <p className="text-xs text-warning">{t('api.unsavedCurrentSetHint')}</p>
      )}
    </div>
  );
}
