#!/usr/bin/env node

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

async function writeReleaseChecksums(directory, target, env = process.env) {
  if (!/^[a-z0-9-]+$/.test(target)) {
    throw new Error('A release target such as win-x64 or mac-arm64 is required');
  }
  const artifacts = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:exe|dmg|zip)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (artifacts.length === 0) throw new Error(`No release installers found in ${directory}`);

  const checksums = [];
  for (const filename of artifacts) {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(path.join(directory, filename)))
      hash.update(chunk);
    const sha256 = hash.digest('hex');
    fs.writeFileSync(
      path.join(directory, `${filename}.sha256`),
      `${sha256}  ${filename}\n`,
      'utf8'
    );
    checksums.push({ filename, sha256, size: fs.statSync(path.join(directory, filename)).size });
  }

  // Each build job has a distinct filename so parallel architecture uploads do
  // not overwrite one another. Record only public workflow metadata.
  const provenance = {
    target,
    repository: env.GITHUB_REPOSITORY || null,
    commit: env.GITHUB_SHA || null,
    ref: env.GITHUB_REF || null,
    workflow: env.GITHUB_WORKFLOW_REF || null,
    runUrl:
      env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
    artifacts: checksums,
  };
  fs.writeFileSync(
    path.join(directory, `build-provenance-${target}.json`),
    `${JSON.stringify(provenance, null, 2)}\n`,
    'utf8'
  );
  return checksums;
}

module.exports = { writeReleaseChecksums };

if (require.main === module) {
  writeReleaseChecksums(process.argv[2] || 'release', process.argv[3] || '')
    .then((artifacts) =>
      console.log(`Wrote SHA256 checksums for ${artifacts.length} release artifacts`)
    )
    .catch((error) => {
      console.error(`Release checksum generation failed: ${error.message}`);
      process.exitCode = 1;
    });
}
