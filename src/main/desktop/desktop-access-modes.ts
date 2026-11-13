/**
 * Registro canônico dos modos de acesso ao desktop (computer use semântico).
 *
 * ## Por que este módulo existe
 *
 * O modo `'native'` faz parte do **contrato** do modo de acesso, mas **não** é
 * um modo selecionável: ele é reservado para a camada FFI, que é a **Fase 5**.
 *
 * Isso cria uma assimetria que precisa ser **declarada em um único lugar**:
 *
 * - o **tipo** e o **validador** aceitam `'native'` — o valor é válido no
 *   contrato e por isso precisa ser normalizado e persistido sem erro;
 * - a **UI não produz** `'native'` — ela renderiza a opção como indisponível;
 * - o **runtime trata** `'native'` como "sem tools semânticas" (fail-closed).
 *
 * Sem este registro, essa regra vive espalhada em comentários — e um
 *developer pode "implementar" o modo `native` achando que ele funciona, ou
 * pior: aceitar que a UI "oferece" um modo que não tem implementação.
 *
 * ## Contrato do modo `native`
 *
 * - **Fase**: 5 (FFI / camada nativa).
 * - **Estado**: reservado, **não implementado**. Não há loader FFI, não há
 *   bindings, não há `ad_abi_version` validado em runtime.
 * - **Gate de reavaliação**: a Fase 5 só é reavaliada se a métrica de
 *   latência do transporte stdio passar do orçamento — hoje o p95 medido é
 *   ~45 ms contra um gate de < 400 ms, e a árvore UIA custa 140–180 ms por
 *   chamada. A FFI foi **adiada** por não trazer ganho de latência, apenas
 *   custo de ABI/build.
 * - **Pré-requisitos técnicos quando entrar** (contrato do upstream
 *   `vercel-labs/agent-desktop`): build com `--profile release-ffi` (o profile
 *   `release` usa `panic=abort` e quebra os traps `catch_unwind`), platform
 *   helper ao lado da lib, e a feature `stub-adapter` para CI.
 *
 * ## Fail-closed
 *
 * Enquanto a FFI não existe, `native` **não pode** expor nenhuma tool. O
 * runtime trata `native` exatamente como `off` — inclusive **parando** o
 * processo filho MCP, para que o agente não mantenha acesso ao desktop.
 *
 * @see DESKTOP_ACCESS_MODE_NATIVE_RESERVED
 * @see src/main/agent/agent-runner.ts (`buildAgentDesktopCustomTools`)
 * @see src/renderer/components/settings/SettingsDesktop.tsx
 */

/**
 * Modos de acesso ao desktop suportados pelo **contrato**.
 *
 * `native` está listado porque faz parte do contrato, mas é **reservado**
 * (ver {@link DESKTOP_ACCESS_MODE_NATIVE_RESERVED}).
 */
export const DESKTOP_ACCESS_MODES = ['off', 'mcp', 'mcp+skill', 'native'] as const;

/** Modo de acesso ao desktop — espelha `DesktopAccessMode` do config-store. */
export type DesktopAccessMode = (typeof DESKTOP_ACCESS_MODES)[number];

/**
 * Metadados do registro de reserva do modo `native`.
 *
 * Este é o **único** lugar do código onde a reserva é declarada. Qualquer
 * outro arquivo que precise falar sobre a reserva deve referenciar este
 * registro, e não reescrever a regra.
 */
export const DESKTOP_ACCESS_MODE_NATIVE_RESERVED = {
  /** Modo reservado. */
  mode: 'native',
  /** Fase do roadmap em que o modo será implementado. */
  phase: 5,
  /** A camada alvo quando implementado. */
  target: 'FFI',
  /**
   * O modo está implementado? Enquanto `false`, o runtime o trata como
   * equivalente a `off` (fail-closed) e a UI não o oferece.
   */
  implemented: false,
  /**
   * Motivo pelo qual a FFI foi adiada — registrado para que a decisão não se
   * perca: o overhead do transporte MCP (~45 ms p95) é desprezível frente ao
   * custo da árvore de acessibilidade (140–180 ms por chamada).
   */
  deferralReason:
    'FFI adiada: o overhead do transporte stdio (~45 ms p95) é desprezível frente ao custo da árvore de acessibilidade (140–180 ms por chamada); a FFI só entraria se o p95 do stdio ultrapassasse o gate de 400 ms.',
  /**
   * Pré-requisitos técnicos para a implementação, quando a Fase 5 for
   * reavaliada. Derivados do contrato do upstream `agent-desktop`.
   */
  prerequisites: [
    'build com `--profile release-ffi` (o profile `release` usa panic=abort e quebra os traps catch_unwind)',
    'platform helper distribuído ao lado da lib nativa',
    'feature `stub-adapter` habilitada na CI',
    'validação de `ad_abi_version` em runtime',
  ],
  /**
   * Métrica que decide a reavaliação da Fase 5.
   */
  reevaluationGate:
    'Reavaliar a Fase 5 se o p95 do transporte stdio ultrapassar 400 ms, ou se a árvore de acessibilidade cair abaixo de 100 ms por call.',
} as const;

/**
 * O modo `native` está implementado nesta build?
 *
 * Fonte única de verdade para o runtime: enquanto `false`, `native` é
 * fail-closed (sem tools) e a UI não deve oferecer a opção.
 */
export function isDesktopAccessModeNativeImplemented(): boolean {
  return DESKTOP_ACCESS_MODE_NATIVE_RESERVED.implemented;
}

/**
 * Modos que a **UI** pode oferecer como selecionáveis.
 *
 * `native` fica de fora enquanto a FFI não existe. Mantém a lista derivada do
 * registro, para que a reserva não precise ser replicada em dois lugares.
 */
export function getSelectableDesktopAccessModes(): DesktopAccessMode[] {
  return DESKTOP_ACCESS_MODES.filter(
    (mode) =>
      mode !== DESKTOP_ACCESS_MODE_NATIVE_RESERVED.mode ||
      isDesktopAccessModeNativeImplemented()
  );
}

/**
 * O modo `native` é selecionável nesta build?
 *
 * A UI usa isto para decidir entre renderizar a opção como botão ativo ou
 * como item desabilitado com aviso.
 */
export function isDesktopAccessModeNativeSelectable(): boolean {
  return isDesktopAccessModeNativeImplemented();
}

/**
 * O valor é um modo de acesso ao desktop válido no contrato?
 *
 * `native` é aceito (é um valor do contrato, e arquivos de config podem já
 * conter esse valor), mas isso **não** significa que ele seja selecionável
 * na UI nem implementado no runtime — ver
 * {@link isDesktopAccessModeNativeSelectable}.
 *
 * O config-store usa este predicado como validador único do campo, para que
 * a lista de modos válidos não precise ser replicada em dois lugares.
 */
export function isDesktopAccessModeValue(value: unknown): value is DesktopAccessMode {
  return (
    typeof value === 'string' &&
    (DESKTOP_ACCESS_MODES as readonly string[]).includes(value)
  );
}
