import Store from 'electron-store';
import { app } from 'electron';
import os from 'node:os';
import path from 'node:path';
import type { InstalledPlugin } from '../../renderer/types';

interface PluginRegistrySchema {
  plugins: InstalledPlugin[];
}

class PluginRegistryStore {
  private readonly store: Store<PluginRegistrySchema>;

  constructor() {
    const storeCwd = this.resolveStoreCwd();
    this.store = new Store<PluginRegistrySchema>({
      name: 'plugin-registry',
      cwd: storeCwd,
      // 在非 Electron 进程中提供兜底项目名，避免初始化失败。
      projectName: 'open-cowork',
      defaults: {
        plugins: [],
      },
    });
  }

  private resolveStoreCwd(): string {
    try {
      if (typeof app?.getPath === 'function') {
        return app.getPath('userData');
      }
    } catch {
      // 测试或非 Electron 场景走兜底目录。
    }
    return path.join(os.tmpdir(), 'open-cowork');
  }

  list(): InstalledPlugin[] {
    return this.store
      .get('plugins', [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(pluginId: string): InstalledPlugin | undefined {
    return this.store.get('plugins', []).find((plugin) => plugin.pluginId === pluginId);
  }

  save(plugin: InstalledPlugin): InstalledPlugin {
    const plugins = this.store.get('plugins', []);
    const index = plugins.findIndex((item) => item.pluginId === plugin.pluginId);
    if (index >= 0) {
      plugins[index] = plugin;
    } else {
      plugins.push(plugin);
    }
    this.store.set('plugins', plugins);
    return plugin;
  }

  delete(pluginId: string): boolean {
    const plugins = this.store.get('plugins', []);
    const filtered = plugins.filter((item) => item.pluginId !== pluginId);
    if (filtered.length === plugins.length) {
      return false;
    }
    this.store.set('plugins', filtered);
    return true;
  }
}

export const pluginRegistryStore = new PluginRegistryStore();
