export function redactSensitiveText(text: string): string {
  return text
    .replace(/\bsk-[a-z0-9_-]{16,}\b/gi, '[REDACTED_KEY]')
    .replace(/(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*[:=]\s*[^\s"']+/gi, '$1=[REDACTED_KEY]')
    .replace(/(authorization|x-api-key|api-key|apikey)(\s*[:=]\s*)(bearer\s+)?[^\s"']+/gi, '$1$2[REDACTED_KEY]')
    .replace(/(["']?(?:authorization|x-api-key|api-key|apikey|access_token|token)["']?\s*[:=]\s*["']?)(bearer\s+)?([a-z0-9._\-+/=]{8,})(["']?)/gi, '$1[REDACTED_KEY]$4')
    .replace(/\bbearer\s+[a-z0-9._-]{16,}\b/gi, 'Bearer [REDACTED_KEY]')
    .replace(/([?&](?:api_key|apikey|access_token|token)=)[^&\s]+/gi, '$1[REDACTED_KEY]');
}
