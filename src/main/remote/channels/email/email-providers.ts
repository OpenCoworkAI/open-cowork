/**
 * Email provider presets
 *
 * Connection defaults for common market mail services so users only need to
 * enter their address + app password. 'custom' is resolved from the user's
 * own imap/smtp settings instead of this table.
 */

import type { EmailChannelConfig, EmailProvider, EmailServerEndpoint } from '../../types';

export interface EmailProviderPreset {
  /** Human-friendly label for UI. */
  label: string;
  imap: EmailServerEndpoint;
  smtp: EmailServerEndpoint;
  /**
   * Whether this provider requires an app-specific password (i.e. the normal
   * account password will not work with IMAP/SMTP). Surfaced in the UI/docs.
   */
  requiresAppPassword: boolean;
  /** Link to the provider's app-password / IMAP settings page. */
  helpUrl?: string;
}

/**
 * Preset table. Ports follow each provider's documented defaults:
 *  - IMAP over implicit TLS on 993
 *  - SMTP over implicit TLS on 465, or STARTTLS on 587 where that is the
 *    provider's recommended submission port.
 */
export const EMAIL_PROVIDER_PRESETS: Record<
  Exclude<EmailProvider, 'custom'>,
  EmailProviderPreset
> = {
  gmail: {
    label: 'Gmail / Google Workspace',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    requiresAppPassword: true,
    helpUrl: 'https://support.google.com/accounts/answer/185833',
  },
  outlook: {
    label: 'Outlook / Microsoft 365',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    requiresAppPassword: true,
    helpUrl: 'https://support.microsoft.com/account-billing/5896164f-1c2b-4d99-90e6-58b90bda9c48',
  },
  yahoo: {
    label: 'Yahoo Mail',
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    requiresAppPassword: true,
    helpUrl: 'https://help.yahoo.com/kb/SLN15241.html',
  },
  icloud: {
    label: 'iCloud Mail',
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    requiresAppPassword: true,
    helpUrl: 'https://support.apple.com/en-us/102654',
  },
  gmx: {
    label: 'GMX',
    imap: { host: 'imap.gmx.net', port: 993, secure: true },
    smtp: { host: 'mail.gmx.net', port: 465, secure: true },
    requiresAppPassword: false,
    helpUrl: 'https://hilfe.gmx.net/pop-imap/imap/index.html',
  },
  webde: {
    label: 'WEB.DE',
    imap: { host: 'imap.web.de', port: 993, secure: true },
    smtp: { host: 'smtp.web.de', port: 587, secure: false },
    requiresAppPassword: false,
    helpUrl: 'https://hilfe.web.de/pop-imap/imap/index.html',
  },
  zoho: {
    label: 'Zoho Mail',
    imap: { host: 'imap.zoho.com', port: 993, secure: true },
    smtp: { host: 'smtp.zoho.com', port: 465, secure: true },
    requiresAppPassword: true,
    helpUrl: 'https://www.zoho.com/mail/help/imap-access.html',
  },
};

/**
 * Resolve the effective IMAP endpoint for a config, applying the provider
 * preset when the config does not override it. Throws for 'custom' without
 * an explicit imap block.
 */
export function resolveImapEndpoint(config: EmailChannelConfig): EmailServerEndpoint {
  if (config.imap) return config.imap;
  if (config.provider !== 'custom') {
    return EMAIL_PROVIDER_PRESETS[config.provider].imap;
  }
  throw new Error('IMAP host/port are required for a custom email provider');
}

/**
 * Resolve the effective SMTP endpoint for a config, applying the provider
 * preset when the config does not override it. Throws for 'custom' without
 * an explicit smtp block.
 */
export function resolveSmtpEndpoint(config: EmailChannelConfig): EmailServerEndpoint {
  if (config.smtp) return config.smtp;
  if (config.provider !== 'custom') {
    return EMAIL_PROVIDER_PRESETS[config.provider].smtp;
  }
  throw new Error('SMTP host/port are required for a custom email provider');
}
