import { normalizePythonPackageSpecs } from '../utils/python-package-specs';

interface InstallPythonPackagesWithCacheOptions {
  packages: string[];
  sourceLabel?: string;
  installedPackages: Set<string>;
  logPrefix: string;
  log: (message: string) => void;
  logWarn?: (message: string) => void;
  installPackage: (pkg: string) => Promise<void>;
}

export async function installPythonPackagesWithCache({
  packages,
  sourceLabel = 'skills',
  installedPackages,
  logPrefix,
  log,
  logWarn = log,
  installPackage,
}: InstallPythonPackagesWithCacheOptions): Promise<void> {
  const { normalizedPackages, rejectedPackages } = normalizePythonPackageSpecs(packages);

  if (rejectedPackages.length > 0) {
    logWarn(
      `${logPrefix} Skipping invalid Python package spec(s) from ${sourceLabel}: ${rejectedPackages.join(', ')}`
    );
  }

  if (normalizedPackages.length === 0) {
    return;
  }

  const missingPackages = normalizedPackages.filter((pkg) => !installedPackages.has(pkg));
  if (missingPackages.length === 0) {
    log(`${logPrefix} Python packages already installed for ${sourceLabel}`);
    return;
  }

  log(`${logPrefix} Installing Python packages for ${sourceLabel}: ${missingPackages.join(', ')}`);

  const failedPackages: string[] = [];
  for (const pkg of missingPackages) {
    try {
      await installPackage(pkg);
      installedPackages.add(pkg);
    } catch (error) {
      failedPackages.push(pkg);
      logWarn(
        `${logPrefix} Failed to install Python package "${pkg}" for ${sourceLabel}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (failedPackages.length === 0) {
    log(`${logPrefix} Python packages installed successfully for ${sourceLabel}`);
    return;
  }

  logWarn(
    `${logPrefix} Python package install completed with failures for ${sourceLabel}: ${failedPackages.join(', ')}`
  );
}
