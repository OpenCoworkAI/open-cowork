import { execFile, spawn } from 'child_process';
import https from 'https';
import type { ContainerInfo, PullProgress, CareerBoxConfig } from './types';

function exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}

export class DockerManager {
  /**
   * Check if Docker is available and return version info
   */
  async checkDocker(): Promise<{ available: boolean; version?: string }> {
    try {
      const { stdout } = await exec('docker', ['info', '--format', '{{.ServerVersion}}']);
      return { available: true, version: stdout.trim() };
    } catch {
      return { available: false };
    }
  }

  /**
   * Check if a Docker image exists locally
   */
  async imageExists(image: string): Promise<boolean> {
    try {
      await exec('docker', ['image', 'inspect', image]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pull a Docker image with streaming progress
   */
  pullImage(image: string, onProgress: (progress: PullProgress) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', ['pull', image]);
      let lastPercent = -1;

      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          const progress = this.parsePullProgress(line);
          if (progress.percent !== lastPercent || progress.percent === -1) {
            lastPercent = progress.percent;
            onProgress(progress);
          }
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          onProgress({ status: line.trim(), percent: -1 });
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          onProgress({ status: 'Pull complete', percent: 100 });
          resolve();
        } else {
          reject(new Error(`docker pull exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  private parsePullProgress(line: string): PullProgress {
    // Match: "Downloading [===>    ]  12.5MB/100MB"
    const downloadMatch = line.match(/(\d+(?:\.\d+)?)\s*[MG]B\s*\/\s*(\d+(?:\.\d+)?)\s*[MG]B/);
    if (downloadMatch) {
      const current = parseFloat(downloadMatch[1]);
      const total = parseFloat(downloadMatch[2]);
      // Adjust for unit differences (simple heuristic)
      const percent = total > 0 ? Math.round((current / total) * 100) : -1;
      return { status: line.trim(), progress: `${current}/${total}`, percent };
    }

    // Match percentage patterns like "[==>  ] 45%"
    const pctMatch = line.match(/(\d+)%/);
    if (pctMatch) {
      return { status: line.trim(), percent: parseInt(pctMatch[1], 10) };
    }

    // Detect completion keywords
    if (line.includes('Pull complete') || line.includes('Already exists')) {
      return { status: line.trim(), percent: -1 };
    }

    return { status: line.trim(), percent: -1 };
  }

  /**
   * Get container status by name
   */
  async getContainerStatus(name: string): Promise<ContainerInfo> {
    try {
      const { stdout } = await exec('docker', [
        'inspect',
        '--format',
        '{{.State.Status}}|{{.Id}}|{{.State.StartedAt}}|{{.Config.Image}}',
        name,
      ]);
      const parts = stdout.trim().split('|');
      return {
        name,
        status: parts[0] as ContainerInfo['status'],
        id: parts[1]?.substring(0, 12) || '',
        startedAt: parts[2] || undefined,
        image: parts[3] || '',
      };
    } catch {
      return {
        name,
        id: '',
        status: 'not_found',
        image: '',
      };
    }
  }

  /**
   * Create and start a new CareerBox container
   */
  async createContainer(config: CareerBoxConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const args = [
        'run', '-d',
        '--name', config.containerName,
        '--shm-size=1g',
        `--memory=${config.memoryMb}m`,
        '-p', `${config.port}:3001`,
        '-v', `${config.volumeName}:/config`,
        '-e', 'PUID=1000',
        '-e', 'PGID=1000',
        '-e', 'TZ=Etc/UTC',
        '-e', 'CUSTOM_USER=abc',
        '-e', `PASSWORD=${config.password}`,
        '--restart', 'unless-stopped',
        config.imageName,
      ];

      await exec('docker', args);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.stderr || error.message || 'Failed to create container',
      };
    }
  }

  /**
   * Start a stopped container
   */
  async startContainer(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      await exec('docker', ['start', name]);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.stderr || error.message || 'Failed to start container',
      };
    }
  }

  /**
   * Stop a running container
   */
  async stopContainer(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      await exec('docker', ['stop', name]);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.stderr || error.message || 'Failed to stop container',
      };
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Force remove in case it's running
      await exec('docker', ['rm', '-f', name]);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.stderr || error.message || 'Failed to remove container',
      };
    }
  }

  /**
   * Remove a volume
   */
  async removeVolume(name: string): Promise<{ success: boolean; error?: string }> {
    try {
      await exec('docker', ['volume', 'rm', name]);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.stderr || error.message || 'Failed to remove volume',
      };
    }
  }

  /**
   * Check if the workspace is healthy (responds on HTTPS)
   */
  checkHealth(port: number): Promise<{ healthy: boolean }> {
    return new Promise((resolve) => {
      const req = https.get(
        {
          hostname: 'localhost',
          port,
          path: '/',
          rejectUnauthorized: false,
          timeout: 5000,
        },
        (res) => {
          resolve({ healthy: res.statusCode !== undefined && res.statusCode < 500 });
          res.resume(); // consume response
        },
      );

      req.on('error', () => {
        resolve({ healthy: false });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ healthy: false });
      });
    });
  }

  /**
   * Get Docker disk usage summary
   */
  async getDiskUsage(): Promise<string> {
    try {
      const { stdout } = await exec('docker', ['system', 'df', '--format', '{{.Type}}\t{{.Size}}']);
      return stdout.trim();
    } catch {
      return '';
    }
  }
}

// Singleton instance
export const dockerManager = new DockerManager();
