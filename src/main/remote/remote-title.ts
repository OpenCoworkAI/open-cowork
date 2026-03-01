/**
 * Remote Session Title Builder
 * 为远程会话生成标题
 */

/**
 * Build a title for a remote session from the user's prompt
 * @param prompt - User's prompt/message
 * @returns Session title (max 50 chars)
 */
export function buildRemoteSessionTitle(prompt: string): string {
  // Clean up the prompt
  const cleaned = prompt
    .trim()
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .replace(/[\r\n]+/g, ' ');  // Replace newlines with space
  
  // If prompt is short enough, use it directly
  if (cleaned.length <= 50) {
    return cleaned || 'Remote Session';
  }
  
  // Truncate to first sentence or 50 chars
  const firstSentence = cleaned.match(/^[^.!?]+[.!?]/)?.[0];
  if (firstSentence && firstSentence.length <= 50) {
    return firstSentence;
  }
  
  // Truncate to 47 chars and add ellipsis
  return cleaned.substring(0, 47) + '...';
}
