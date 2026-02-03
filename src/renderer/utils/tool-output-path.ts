type ParsedOutput = {
  path?: string;
  filePath?: string;
};

export function extractFilePathFromToolOutput(toolOutput?: string): string | null {
  if (!toolOutput) {
    return null;
  }

  const trimmed = toolOutput.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as ParsedOutput;
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.filePath === 'string' && parsed.filePath.trim()) {
        return parsed.filePath.trim();
      }
      if (typeof parsed.path === 'string' && parsed.path.trim()) {
        return parsed.path.trim();
      }
    }
  } catch {
    // ignore JSON parse failures
  }

  const match = trimmed.match(/File (?:written|edited):\s*(.+)$/i);
  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}
