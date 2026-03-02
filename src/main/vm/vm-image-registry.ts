/**
 * VM Image Registry - OS image catalog and download management
 */

import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { log } from '../utils/logger';
import { vmConfigStore } from './vm-config-store';
import type { OSImage, ImageDownloadProgress } from './types';

// ── Built-in catalog ────────────────────────────────────────────────

const BUILT_IN_CATALOG: OSImage[] = [
  {
    id: 'ubuntu-24.04-desktop-x64',
    name: 'Ubuntu 24.04 LTS',
    distro: 'ubuntu',
    version: '24.04.2',
    arch: 'x64',
    downloadUrl: 'https://releases.ubuntu.com/24.04.2/ubuntu-24.04.2-desktop-amd64.iso',
    fileSize: 6_100_000_000,
    category: 'linux',
    minDiskGb: 25,
    minMemoryMb: 4096,
    vboxOsType: 'Ubuntu_64',
  },
  {
    id: 'linuxmint-22-x64',
    name: 'Linux Mint 22',
    distro: 'linuxmint',
    version: '22',
    arch: 'x64',
    downloadUrl: 'https://mirrors.kernel.org/linuxmint/stable/22/linuxmint-22-cinnamon-64bit.iso',
    fileSize: 2_800_000_000,
    category: 'linux',
    minDiskGb: 20,
    minMemoryMb: 2048,
    vboxOsType: 'Ubuntu_64',
  },
];

// ── Image Registry ──────────────────────────────────────────────────

export class VMImageRegistry {
  private imageCacheDir: string;
  private activeDownload: { imageId: string; abort: () => void } | null = null;
  private customImages: Map<string, { image: OSImage; filePath: string }> = new Map();

  constructor() {
    const override = vmConfigStore.getImageCachePath();
    this.imageCacheDir = override || path.join(app.getPath('userData'), 'vm-images');
    if (!fs.existsSync(this.imageCacheDir)) {
      fs.mkdirSync(this.imageCacheDir, { recursive: true });
    }
    log('[ImageRegistry] Cache dir:', this.imageCacheDir);
  }

  /** Get catalog filtered by host architecture (includes custom imports) */
  getAvailableCatalog(): OSImage[] {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const builtIn = BUILT_IN_CATALOG.filter(img => img.arch === arch);
    const custom = [...this.customImages.values()].map(c => c.image);
    return [...builtIn, ...custom];
  }

  /** Get images that are already downloaded */
  getDownloadedImages(): OSImage[] {
    return this.getAvailableCatalog().filter(img => this.isDownloaded(img.id));
  }

  /** Check if an image is downloaded */
  isDownloaded(imageId: string): boolean {
    const p = this.getImagePath(imageId);
    return p !== null && fs.existsSync(p);
  }

  /** Get local file path for a downloaded image, or null */
  getImagePath(imageId: string): string | null {
    // Check custom imports first
    const custom = this.customImages.get(imageId);
    if (custom) {
      return fs.existsSync(custom.filePath) ? custom.filePath : null;
    }

    const image = BUILT_IN_CATALOG.find(i => i.id === imageId);
    if (!image) return null;

    const ext = path.extname(new URL(image.downloadUrl).pathname) || '.iso';
    const filePath = path.join(this.imageCacheDir, `${imageId}${ext}`);
    return fs.existsSync(filePath) ? filePath : null;
  }

  /** Get the target file path for an image (whether downloaded or not) */
  private getTargetPath(image: OSImage): string {
    const ext = path.extname(new URL(image.downloadUrl).pathname) || '.iso';
    return path.join(this.imageCacheDir, `${image.id}${ext}`);
  }

  /** Register a user-imported ISO */
  importISO(filePath: string, name: string): OSImage {
    const id = `custom-${Date.now()}`;
    const stats = fs.statSync(filePath);
    const targetPath = path.join(this.imageCacheDir, `${id}.iso`);

    // Copy into cache
    fs.copyFileSync(filePath, targetPath);

    const image: OSImage = {
      id,
      name,
      distro: 'custom',
      version: 'custom',
      arch: process.arch === 'arm64' ? 'arm64' : 'x64',
      downloadUrl: '',
      fileSize: stats.size,
      category: 'other',
      minDiskGb: 20,
      minMemoryMb: 2048,
      vboxOsType: 'Linux_64',
    };

    this.customImages.set(id, { image, filePath: targetPath });

    return image;
  }

  /** Download an image with progress callback */
  async downloadImage(
    imageId: string,
    onProgress: (p: ImageDownloadProgress) => void,
  ): Promise<string> {
    const image = BUILT_IN_CATALOG.find(i => i.id === imageId);
    if (!image) throw new Error(`Image not found: ${imageId}`);

    const targetPath = this.getTargetPath(image);

    // Already downloaded?
    if (fs.existsSync(targetPath)) {
      const stats = fs.statSync(targetPath);
      if (stats.size > 0) {
        onProgress({
          imageId, status: 'complete',
          bytesDownloaded: stats.size, totalBytes: stats.size, percent: 100,
        });
        return targetPath;
      }
    }

    log('[ImageRegistry] Downloading', image.name, 'to', targetPath);

    return new Promise<string>((resolve, reject) => {
      const tmpPath = targetPath + '.part';
      const file = fs.createWriteStream(tmpPath);
      let aborted = false;
      let activeResponse: import('http').IncomingMessage | null = null;

      const abort = () => {
        aborted = true;
        if (activeResponse) { activeResponse.destroy(); }
        file.destroy();
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      };

      this.activeDownload = { imageId, abort };

      const doRequest = (url: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          abort();
          reject(new Error('Too many redirects'));
          return;
        }

        const proto = url.startsWith('https') ? https : http;
        proto.get(url, (res) => {
          activeResponse = res;

          // Follow redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            activeResponse = null;
            doRequest(res.headers.location, redirectCount + 1);
            return;
          }

          if (res.statusCode !== 200) {
            abort();
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10) || image.fileSize;
          let bytesDownloaded = 0;
          let lastReportedPercent = -1;

          res.on('data', (chunk: Buffer) => {
            if (aborted) return;
            bytesDownloaded += chunk.length;
            const percent = totalBytes > 0 ? Math.floor((bytesDownloaded / totalBytes) * 100) : 0;

            // Report every 1%
            if (percent !== lastReportedPercent) {
              lastReportedPercent = percent;
              onProgress({
                imageId, status: 'downloading',
                bytesDownloaded, totalBytes, percent,
              });
            }
          });

          res.pipe(file);

          file.on('finish', () => {
            if (aborted) return;
            file.close(() => {
              // Rename .part to final
              fs.renameSync(tmpPath, targetPath);
              log('[ImageRegistry] Download complete:', targetPath);

              this.activeDownload = null;
              onProgress({
                imageId, status: 'complete',
                bytesDownloaded, totalBytes, percent: 100,
              });
              resolve(targetPath);
            });
          });

          res.on('error', (err) => {
            abort();
            this.activeDownload = null;
            onProgress({
              imageId, status: 'error',
              bytesDownloaded, totalBytes, percent: 0,
              error: err.message,
            });
            reject(err);
          });
        }).on('error', (err) => {
          abort();
          this.activeDownload = null;
          reject(err);
        });
      };

      doRequest(image.downloadUrl);
    });
  }

  /** Cancel an active download */
  cancelDownload(): void {
    if (this.activeDownload) {
      log('[ImageRegistry] Cancelling download:', this.activeDownload.imageId);
      this.activeDownload.abort();
      this.activeDownload = null;
    }
  }

  /** Delete a cached image */
  deleteImage(imageId: string): boolean {
    const image = BUILT_IN_CATALOG.find(i => i.id === imageId);
    if (!image) return false;

    const targetPath = this.getTargetPath(image);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      log('[ImageRegistry] Deleted cached image:', targetPath);
      return true;
    }
    return false;
  }

  /** Get cache directory size in bytes */
  getCacheSizeBytes(): number {
    let total = 0;
    if (!fs.existsSync(this.imageCacheDir)) return 0;
    for (const file of fs.readdirSync(this.imageCacheDir)) {
      const stat = fs.statSync(path.join(this.imageCacheDir, file));
      if (stat.isFile()) total += stat.size;
    }
    return total;
  }
}
