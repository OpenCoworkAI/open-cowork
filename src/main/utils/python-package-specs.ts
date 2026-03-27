export const SAFE_PYTHON_PACKAGE_SPEC_PATTERN = /^[a-zA-Z0-9._\-\[\]<>=!,]+$/;

export function isSafePythonPackageSpec(value: string): boolean {
  return SAFE_PYTHON_PACKAGE_SPEC_PATTERN.test(value);
}

export function normalizePythonPackageSpecs(packages: string[]): {
  normalizedPackages: string[];
  rejectedPackages: string[];
} {
  const normalizedPackages = new Set<string>();
  const rejectedPackages = new Set<string>();

  for (const pkg of packages) {
    const trimmed = pkg.trim();
    if (!trimmed) {
      continue;
    }

    if (!isSafePythonPackageSpec(trimmed)) {
      rejectedPackages.add(trimmed);
      continue;
    }

    normalizedPackages.add(trimmed);
  }

  return {
    normalizedPackages: [...normalizedPackages].sort((a, b) => a.localeCompare(b)),
    rejectedPackages: [...rejectedPackages].sort((a, b) => a.localeCompare(b)),
  };
}
