/**
 * @module main/mcp/gui-operate-runtime-env
 *
 * Propagação da preferência "entregar imagem no GUI Operate" para o processo
 * filho do servidor MCP.
 *
 * ## O defeito que este módulo fecha
 *
 * O `gui-operate-server` já sabia omitir a captura de tela: ele lê
 * `process.env.OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT === '1'` e, nesse caso,
 * devolve apenas os metadados da captura (caminho, região, display) em vez
 * do payload base64. Até agora, **nada no app injetava essa variável** —
 * o knob existia no servidor filho e era inerte no produto.
 *
 * ## Por que existe a preferência
 *
 * Provedores e modelos text-only rejeitam a requisição com `400` quando o
 * payload contém imagem (é o caso abierto no upstream, issue #251). Com a
 * preferência desligada, a ferramenta entrega a descrição textual do que foi
 * capturado em vez de um blob que o modelo não consegue ler.
 *
 * ## Precedência
 *
 * - preferência `false` → injeta `'1'` e **sobrescreve** qualquer valor manual;
 * - preferência `true` (padrão) → **não injeta nada**, preservando um valor
 *   definido manualmente pelo usuário no editor de variáveis de ambiente do
 *   conector. O app nunca *remove* uma configuração explícita do usuário.
 */

/** Nome da variável de ambiente lida pelo `gui-operate-server`. */
export const GUI_OPERATE_DISABLE_IMAGE_OUTPUT_ENV = 'OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT';

/** Valor que a variável precisa ter para a omissão ser ativada. */
export const GUI_OPERATE_DISABLE_IMAGE_OUTPUT_VALUE = '1';

/**
 * Nomes pelos quais o servidor embutido GUI Operate é identificado.
 *
 * O preset cria o conector com o nome `GUI_Operate`; usuários antigos
 * podem ter renamed para `GUI Operate`. Os dois precisam ser reconhecidos.
 */
export const GUI_OPERATE_SERVER_NAMES = ['GUI_Operate', 'GUI Operate'] as const;

/** `true` quando o servidor é o GUI Operate embutido. */
export function isGuiOperateServer(serverName: string): boolean {
  return (GUI_OPERATE_SERVER_NAMES as readonly string[]).includes(serverName);
}

/**
 * Calcula o env a ser injetado no spawn do GUI Operate.
 *
 * Retorna `null` quando nada deve ser alterado — o chamador preserva
 * integralmente o env existente do usuário.
 */
export function buildGuiOperateRuntimeEnv(options: {
  /** Nome do servidor MCP. */
  serverName: string;
  /**
   * Preferência do app. `false` omite a imagem; `true`/`undefined` mantém
   * o comportamento padrão (imagem entregue).
   */
  imageOutputEnabled: boolean | undefined;
}): Record<string, string> | null {
  const { serverName, imageOutputEnabled } = options;

  if (!isGuiOperateServer(serverName)) {
    return null;
  }

  // `true` (ou ausente) = não injeta. Um valor manual do usuário no editor
  // de env do conector é preservado.
  if (imageOutputEnabled !== false) {
    return null;
  }

  return {
    [GUI_OPERATE_DISABLE_IMAGE_OUTPUT_ENV]: GUI_OPERATE_DISABLE_IMAGE_OUTPUT_VALUE,
  };
}
