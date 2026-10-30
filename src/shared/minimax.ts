export const MINIMAX_TEXT_MODELS = [
  { id: 'MiniMax-M3.1-Flash', name: 'MiniMax-M3.1-Flash' },
  { id: 'MiniMax-M3', name: 'MiniMax-M3' },
];

export function isDirectMiniMaxBaseUrl(baseUrl: string | undefined): boolean {
  try {
    const url = new URL(baseUrl || '');
    return (
      url.protocol === 'https:' && ['api.minimax.io', 'api.minimaxi.com'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
