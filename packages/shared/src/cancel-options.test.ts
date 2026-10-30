import { describe, expect, it } from 'vitest';
import { canCancel } from './delivery-state';
import { CANCEL_CATEGORY_KEYS, clientCancelOptions, driverCancelOptions } from './cancel-options';

describe('motivos de cancelamento', () => {
  it('cliente só vê motivos do motorista quando há motorista', () => {
    expect(clientCancelOptions('CRIADO').map((o) => o.key)).not.toContain('DEMORA_MOTORISTA');
    expect(clientCancelOptions('A_CAMINHO_COLETA').map((o) => o.key)).toContain('DEMORA_MOTORISTA');
  });

  it('em ACEITO o motorista só pode liberar o pedido', () => {
    const o = driverCancelOptions('ACEITO');
    expect(o.length).toBeGreaterThan(1);
    expect(o.every((x) => x.effect === 'RELEASE')).toBe(true);
  });

  it('a caminho da coleta há liberar e cancelar; cancelar respeita CANCEL_RULES', () => {
    const o = driverCancelOptions('A_CAMINHO_COLETA');
    expect(o.some((x) => x.effect === 'RELEASE')).toBe(true);
    expect(o.some((x) => x.effect === 'CANCEL')).toBe(true);
    expect(canCancel('A_CAMINHO_COLETA', 'COLETA_IMPOSSIVEL', 'MOTORISTA')).toBe(true);
  });

  it('depois de coletar só cancela', () => {
    for (const s of ['COLETADO', 'A_CAMINHO_ENTREGA'] as const) {
      const o = driverCancelOptions(s, 'CORRIDA');
      expect(o.every((x) => x.effect === 'CANCEL')).toBe(true);
      expect(o.map((x) => x.key)).toContain('PASSAGEIRO_DESISTIU');
      expect(o.map((x) => x.key)).not.toContain('DESTINATARIO_AUSENTE');
    }
  });

  it('toda opção oferecida é aceita pela API', () => {
    for (const s of ['ACEITO', 'A_CAMINHO_COLETA', 'COLETADO', 'A_CAMINHO_ENTREGA'] as const)
      for (const o of driverCancelOptions(s)) expect(CANCEL_CATEGORY_KEYS).toContain(o.key);
  });
});
