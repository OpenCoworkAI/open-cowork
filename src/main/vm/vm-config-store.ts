import Store from 'electron-store';
import type { VMConfig, VMResourceConfig, VMStoreSchema } from './types';

const DEFAULT_RESOURCES: VMResourceConfig = {
  cpuCount: 2,
  memoryMb: 4096,
  diskSizeGb: 25,
  displayMode: 'separate_window',
  vramMb: 128,
  enableEFI: true,
};

const store = new Store<VMStoreSchema>({
  name: 'vm-config',
  projectName: 'coeadapt' as any,
  defaults: {
    vms: [],
    defaultResources: DEFAULT_RESOURCES,
  },
} as any);

export const vmConfigStore = {
  /** Get all VM configs */
  getVMs(): VMConfig[] {
    return store.get('vms');
  },

  /** Get a single VM config by id */
  getVM(id: string): VMConfig | undefined {
    return store.get('vms').find(vm => vm.id === id);
  },

  /** Add a new VM config */
  addVM(vm: VMConfig): void {
    const vms = store.get('vms');
    vms.push(vm);
    store.set('vms', vms);
  },

  /** Update an existing VM config */
  updateVM(id: string, updates: Partial<VMConfig>): VMConfig | undefined {
    const vms = store.get('vms');
    const index = vms.findIndex(vm => vm.id === id);
    if (index === -1) return undefined;
    vms[index] = { ...vms[index], ...updates, updatedAt: new Date().toISOString() };
    store.set('vms', vms);
    return vms[index];
  },

  /** Remove a VM config */
  removeVM(id: string): boolean {
    const vms = store.get('vms');
    const filtered = vms.filter(vm => vm.id !== id);
    if (filtered.length === vms.length) return false;
    store.set('vms', filtered);
    return true;
  },

  /** Get default resource config */
  getDefaultResources(): VMResourceConfig {
    return store.get('defaultResources');
  },

  /** Update default resource config */
  setDefaultResources(resources: Partial<VMResourceConfig>): VMResourceConfig {
    const current = store.get('defaultResources');
    const merged = { ...current, ...resources };
    store.set('defaultResources', merged);
    return merged;
  },

  /** Get image cache path override */
  getImageCachePath(): string | undefined {
    return store.get('imageCachePath');
  },

  /** Set image cache path override */
  setImageCachePath(p: string): void {
    store.set('imageCachePath', p);
  },
};
