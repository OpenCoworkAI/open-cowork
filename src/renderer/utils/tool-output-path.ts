type ParsedOutput = {
  path?: string;
  filePath?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

type ParsedInput = {
  path?: string;
  filePath?: string;
  file_path?: string;
  relativePath?: string;
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
      if (Array.isArray(parsed.content)) {
        const textContent = parsed.content
          .map((item) => (item && typeof item.text === 'string' ? item.text : ''))
          .filter(Boolean)
          .join('\n');
        const nestedPath = extractFilePathFromText(textContent);
        if (nestedPath) {
          return nestedPath;
        }
      }
    }
  } catch {
    // ignore JSON parse failures
  }

  return extractFilePathFromText(trimmed);
}

export function extractFilePathFromToolInput(
  toolInput?: Record<string, unknown>
): string | null {
  if (!toolInput || typeof toolInput !== 'object') {
    return null;
  }

  const input = toolInput as ParsedInput;
  const candidates = [input.path, input.filePath, input.file_path, input.relativePath];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function extractFilePathFromText(text: string): string | null {
  const match = text.match(/File (?:written|edited):\s*(.+)$/i)
    || text.match(/File created successfully at:?\s*(.+)$/i)
    || text.match(/Successfully wrote \d+ bytes to ([^\r\n]+)/i)
    || text.match(/The file (.+?) has been updated(?: successfully)?(?:\.|$)/i)
    || text.match(/Saved screenshot to ([^\r\n]+)/i);
  if (!match || !match[1]) {
    return null;
  }

  return sanitizeMatchedPath(match[1]);
}

function sanitizeMatchedPath(value: string): string {
  return value.trim().replace(/[.,;:!?]+$/, '');
}
