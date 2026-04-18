import { dialog, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { settingsStore } from '../stores/settings-store';

export class ProjectService {
  async createProject(): Promise<string | null> {
    const defaultWorkspace = settingsStore.get('defaultWorkspace') as string | undefined;
    const defaultPath = defaultWorkspace || app.getPath('documents');

    const result = await dialog.showOpenDialog({
      title: 'Create New Project',
      defaultPath: defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Select Folder'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  }

  async createProjectWithName(projectName: string): Promise<string | null> {
    const defaultWorkspace = settingsStore.get('defaultWorkspace') as string | undefined;
    
    if (!defaultWorkspace) {
      return this.createProject();
    }

    const projectPath = path.join(defaultWorkspace, projectName);
    await fs.mkdir(projectPath, { recursive: true });
    return projectPath;
  }
}

export const projectService = new ProjectService();
