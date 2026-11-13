/**
 * Injeção de env no spawn do GUI Operate (M6).
 *
 * O `gui-operate-server` já suportava omitir a captura de tela via
 * `OPEN_COWORK_DISABLE_IMAGE_TOOL_OUTPUT=1`, mas nada no app injetava a
 * variável — o knob era inerte. Este teste cobre a ponte:
 *
 * 1. `buildGuiOperateRuntimeEnv` decide o que injetar por (nome, preferência);
 * 2. a preferência `false` injeta `'1'` e sobrescreve valor manual;
 * 3. a preferência `true`/ausente **não** injeta nada (preserva env manual);
 * 4. servidores que não são o GUI Operate nunca são tocados.
 *
 * O módulo é puro (sem Electron) justamente para poder ser testado aqui.
 */
import { describe, it, expect } from 'vitest';
import {
  buildGuiOperateRuntimeEnv,
  isGuiOperateServer,
  GUI_OPERATE_DISABLE_IMAGE_OUTPUT_ENV,
  GUI_OPERATE_SERVER_NAMES,
} from '../src/main/mcp/gui-operate-runtime-env';

describe('isGuiOperateServer', () => {
  it('reconhece os nomes canônicos do servidor embutido', () => {
    for (const name of GUI_OPERATE_SERVER_NAMES) {
      expect(isGuiOperateServer(name)).toBe(true);
    }
  });

  it('recusa servidores quaisquer (case-sensitive)', () => {
    expect(isGuiOperateServer('gui_operate')).toBe(false);
    expect(isGuiOperateServer('Chrome DevTools')).toBe(false);
    expect(isGuiOperateServer('')).toBe(false);
  });
});

describe('buildGuiOperateRuntimeEnv', () => {
  it('injeta 1 quando a preferência desativa a entrega de imagem', () => {
    for (const name of GUI_OPERATE_SERVER_NAMES) {
      expect(
        buildGuiOperateRuntimeEnv({ serverName: name, imageOutputEnabled: false })
      ).toEqual({ [GUI_OPERATE_DISABLE_IMAGE_OUTPUT_ENV]: '1' });
    }
  });

  it('não injeta nada quando a preferência mantém a entrega (padrão)', () => {
    for (const name of GUI_OPERATE_SERVER_NAMES) {
      expect(buildGuiOperateRuntimeEnv({ serverName: name, imageOutputEnabled: true })).toBeNull();
      // `undefined` = preferência nunca salva (config antiga) → comportamento
      // padrão, sem injeção.
      expect(buildGuiOperateRuntimeEnv({ serverName: name, imageOutputEnabled: undefined })).toBeNull();
    }
  });

  it('não toca em servidores que não são o GUI Operate', () => {
    expect(
      buildGuiOperateRuntimeEnv({ serverName: 'Chrome DevTools', imageOutputEnabled: false })
    ).toBeNull();
    expect(
      buildGuiOperateRuntimeEnv({ serverName: 'Filesystem', imageOutputEnabled: true })
    ).toBeNull();
  });

  it('sobrescreve um valor manual quando a preferência desativa', () => {
    // A precedence é decidida no chamador ({ ...config.env, ...injected }):
    // a chave gerada deve ser exatamente a que o servidor filho lê, e o
    // spread precisa colocar `injected` por último.
    const manual = { [GUI_OPERATE_DISABLE_IMAGE_OUTPUT_ENV]: '0' };
    const injected = buildGuiOperateRuntimeEnv({
      serverName: 'GUI_Operate',
      imageOutputEnabled: false,
    })!;
    const finalEnv = { ...manual, ...injected };
    expect(finalEnv[GUI_OPERATE_DISABLE_IMAGE_OUTPUT_ENV]).toBe('1');
  });

  it('preserva um valor manual quando a preferência não desativa', () => {
    // Com a preferência ativa (ou ausente), o módulo devolve null e o
    // chamador não deve mexer no env — o workaround manual do usuário
    // continua valendo.
    const injected = buildGuiOperateRuntimeEnv({
      serverName: 'GUI_Operate',
      imageOutputEnabled: true,
    });
    expect(injected).toBeNull();
  });
});
