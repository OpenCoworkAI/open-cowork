/**
 * AuthorizedUsersSection — list of paired users with revoke option
 */

import { useTranslation } from 'react-i18next';
import { Users, Trash2 } from 'lucide-react';
import { formatAppDate } from '../../utils/i18n-format';
import type { PairedUser } from './types';
import { IconButton } from '../ui';

interface Props {
  pairedUsers: PairedUser[];
  onRevoke: (user: PairedUser) => void;
}

export function AuthorizedUsersSection({ pairedUsers, onRevoke }: Props) {
  const { t } = useTranslation();

  if (pairedUsers.length === 0) return null;

  return (
    <div className="p-6 rounded-4xl border border-border-subtle bg-background/60">
      <h3 className="font-medium text-text-primary mb-4 flex items-center gap-2">
        <Users className="w-5 h-5" />
        {t('remote.authorizedUsersTitle', { count: pairedUsers.length })}
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
                <div className="text-xs text-text-muted">{formatAppDate(user.lastActiveAt)}</div>
              </div>
            </div>
            <IconButton
              variant="danger"
              size="sm"
              onClick={() => onRevoke(user)}
              title={t('remote.revokeAccess')}
            >
              <Trash2 className="w-4 h-4" />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}
