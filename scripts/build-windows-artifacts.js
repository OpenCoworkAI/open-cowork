const fs = require('node:fs');
const path = require('node:path');

const LEGACY_CLEANUP_ARTIFACTS = [
  {
    source: path.join('resources', 'windows', 'Open-Cowork-Legacy-Cleanup.cmd'),
    target: 'Open-Cowork-Legacy-Cleanup.cmd',
  },
  {
    source: path.join('resources', 'windows', 'Open-Cowork-Legacy-Cleanup.ps1'),
    target: 'Open-Cowork-Legacy-Cleanup.ps1',
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeLegacyCleanupArtifacts({ projectRoot, outputDir }) {
  ensureDir(outputDir);

  return LEGACY_CLEANUP_ARTIFACTS.map((artifact) => {
    const sourcePath = path.join(projectRoot, artifact.source);
    const targetPath = path.join(outputDir, artifact.target);
    fs.copyFileSync(sourcePath, targetPath);
    return targetPath;
  });
}

module.exports = {
  LEGACY_CLEANUP_ARTIFACTS,
  writeLegacyCleanupArtifacts,
};
