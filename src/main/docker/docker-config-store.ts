import Store from 'electron-store';
import type { CareerBoxConfig } from './types';

const DEFAULT_CONFIG: CareerBoxConfig = {
  containerName: 'coeadapt-workspace',
  imageName: 'coeadapt/career-box:latest',
  volumeName: 'coeadapt-data',
  port: 3001,
  memoryMb: 2048,
  password: 'coeadapt',
};

const store = new Store<{ careerbox: CareerBoxConfig }>({
  name: 'careerbox-config',
  projectName: 'open-cowork',
  defaults: {
    careerbox: DEFAULT_CONFIG,
  },
});

export const dockerConfigStore = {
  getAll(): CareerBoxConfig {
    return store.get('careerbox');
  },

  get<K extends keyof CareerBoxConfig>(key: K): CareerBoxConfig[K] {
    return store.get(`careerbox.${key}` as any);
  },

  update(updates: Partial<CareerBoxConfig>): CareerBoxConfig {
    const current = store.get('careerbox');
    const merged = { ...current, ...updates };
    store.set('careerbox', merged);
    return merged;
  },

  reset(): CareerBoxConfig {
    store.set('careerbox', DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  },
};
