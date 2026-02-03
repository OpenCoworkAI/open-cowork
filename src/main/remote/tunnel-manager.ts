/**
 * Tunnel Manager - Manages ngrok/cloudflare tunnels for remote access
 */

import ngrok from 'ngrok';
import { log, logError } from '../utils/logger';
import { remoteConfigStore } from './remote-config-store';

export interface TunnelStatus {
  connected: boolean;
  url: string | null;
  provider: 'ngrok' | 'cloudflare' | 'none';
  error?: string;
}

// Re-export TunnelConfig from types for consistency
export type { TunnelConfig } from './types';

class TunnelManager {
  private static instance: TunnelManager;
  private currentUrl: string | null = null;
  private isConnected: boolean = false;
  private provider: 'ngrok' | 'cloudflare' | 'none' = 'none';
  private statusCallback: ((status: TunnelStatus) => void) | null = null;

  private constructor() {}

  static getInstance(): TunnelManager {
    if (!TunnelManager.instance) {
      TunnelManager.instance = new TunnelManager();
    }
    return TunnelManager.instance;
  }

  /**
   * Set status callback for real-time updates
   */
  setStatusCallback(callback: (status: TunnelStatus) => void): void {
    this.statusCallback = callback;
  }

  /**
   * Start tunnel with configured provider
   */
  async start(localPort: number): Promise<string | null> {
    const config = remoteConfigStore.getAll();
    const tunnelConfig = config.gateway.tunnel;

    if (!tunnelConfig || !tunnelConfig.enabled) {
      log('[TunnelManager] Tunnel not enabled');
      return null;
    }

    this.provider = tunnelConfig.type as 'ngrok' | 'cloudflare' | 'none';

    try {
      if (tunnelConfig.type === 'ngrok') {
        return await this.startNgrok(localPort, tunnelConfig.ngrok);
      } else if (tunnelConfig.type === 'cloudflare') {
        // Future: implement cloudflare tunnel
        logError('[TunnelManager] Cloudflare tunnel not yet implemented');
        return null;
      }
    } catch (error) {
      logError('[TunnelManager] Failed to start tunnel:', error);
      this.emitStatus({ error: error instanceof Error ? error.message : String(error) });
      return null;
    }

    return null;
  }

  /**
   * Start ngrok tunnel
   */
  private async startNgrok(
    localPort: number,
    config?: { authToken: string; region?: string }
  ): Promise<string | null> {
    if (!config?.authToken) {
      throw new Error('Ngrok authToken is required');
    }

    log('[TunnelManager] Starting ngrok tunnel...');

    try {
      // Set authtoken
      await ngrok.authtoken(config.authToken);

      // Connect
      const url = await ngrok.connect({
        addr: localPort,
        region: (config.region as ngrok.Ngrok.Region) || 'us',
        onStatusChange: (status) => {
          log('[TunnelManager] Ngrok status:', status);
          if (status === 'closed') {
            this.isConnected = false;
            this.currentUrl = null;
            this.emitStatus();
          }
        },
      });

      this.currentUrl = url;
      this.isConnected = true;
      
      log('[TunnelManager] Ngrok tunnel established:', url);
      this.emitStatus();

      return url;
    } catch (error) {
      logError('[TunnelManager] Ngrok error:', error);
      throw error;
    }
  }

  /**
   * Stop tunnel
   */
  async stop(): Promise<void> {
    if (this.provider === 'ngrok' && this.isConnected) {
      log('[TunnelManager] Stopping ngrok tunnel...');
      try {
        await ngrok.disconnect();
        await ngrok.kill();
      } catch (error) {
        logError('[TunnelManager] Error stopping ngrok:', error);
      }
    }

    this.currentUrl = null;
    this.isConnected = false;
    this.provider = 'none';
    this.emitStatus();
  }

  /**
   * Get current status
   */
  getStatus(): TunnelStatus {
    return {
      connected: this.isConnected,
      url: this.currentUrl,
      provider: this.provider,
    };
  }

  /**
   * Get webhook URL for Feishu
   */
  getWebhookUrl(): string | null {
    if (!this.currentUrl) return null;
    return `${this.currentUrl}/webhook/feishu`;
  }

  /**
   * Emit status update
   */
  private emitStatus(extra?: { error?: string }): void {
    if (this.statusCallback) {
      this.statusCallback({
        connected: this.isConnected,
        url: this.currentUrl,
        provider: this.provider,
        ...extra,
      });
    }
  }
}

export const tunnelManager = TunnelManager.getInstance();
