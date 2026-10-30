import { describe, expect, it } from 'vitest';
import {
  ACTIVE_DRIVER_STATUSES,
  CANCEL_REASONS,
  DELIVERY_STATUSES,
  canCancel,
  canTransitionDelivery,
  isTerminalDelivery,
  transitionDelivery,
} from './delivery-state';

describe('máquina de estados da entrega', () => {
  it('caminho feliz', () => {
    const path = [
      'CRIADO',
      'OFERECIDO',
      'ACEITO',
      'A_CAMINHO_COLETA',
      'COLETADO',
      'A_CAMINHO_ENTREGA',
      'ENTREGUE',
    ] as const;
    for (let i = 0; i < path.length - 1; i++)
      expect(transitionDelivery(path[i], path[i + 1])).toBe(path[i + 1]);
  });

  it('oferta recusada/expirada e desistência do motorista voltam para CRIADO', () => {
    expect(canTransitionDelivery('OFERECIDO', 'CRIADO')).toBe(true);
    expect(canTransitionDelivery('ACEITO', 'CRIADO')).toBe(true);
    expect(canTransitionDelivery('A_CAMINHO_COLETA', 'CRIADO')).toBe(true);
  });

  it('depois de coletado não volta para CRIADO', () => {
    expect(canTransitionDelivery('COLETADO', 'CRIADO')).toBe(false);
    expect(canTransitionDelivery('A_CAMINHO_ENTREGA', 'CRIADO')).toBe(false);
  });

  it('não pula etapas nem anda para trás', () => {
    expect(() => transitionDelivery('CRIADO', 'ACEITO')).toThrow();
    expect(() => transitionDelivery('ACEITO', 'COLETADO')).toThrow();
    expect(() => transitionDelivery('COLETADO', 'ACEITO')).toThrow();
    expect(() => transitionDelivery('A_CAMINHO_ENTREGA', 'ENTREGUE')).not.toThrow();
  });

  it('ENTREGUE e CANCELADO são finais', () => {
    for (const s of DELIVERY_STATUSES)
      for (const to of DELIVERY_STATUSES) {
        if (s === 'ENTREGUE' || s === 'CANCELADO') expect(canTransitionDelivery(s, to)).toBe(false);
      }
    expect(isTerminalDelivery('ENTREGUE')).toBe(true);
    expect(isTerminalDelivery('CRIADO')).toBe(false);
  });

  it('estados com motorista responsável', () => {
    expect(ACTIVE_DRIVER_STATUSES).toEqual([
      'ACEITO',
      'A_CAMINHO_COLETA',
      'COLETADO',
      'A_CAMINHO_ENTREGA',
    ]);
  });
});

describe('regras de cancelamento', () => {
  it('cliente cancela só até a coleta', () => {
    expect(canCancel('CRIADO', 'CLIENTE_DESISTIU', 'CLIENTE')).toBe(true);
    expect(canCancel('A_CAMINHO_COLETA', 'CLIENTE_DESISTIU', 'CLIENTE')).toBe(true);
    expect(canCancel('COLETADO', 'CLIENTE_DESISTIU', 'CLIENTE')).toBe(false);
  });

  it('o ator precisa corresponder ao motivo', () => {
    expect(canCancel('CRIADO', 'CLIENTE_DESISTIU', 'MOTORISTA')).toBe(false);
    expect(canCancel('CRIADO', 'SEM_MOTORISTA', 'CLIENTE')).toBe(false);
    expect(canCancel('CRIADO', 'SEM_MOTORISTA', 'SISTEMA')).toBe(true);
  });

  it('motorista: coleta impossível antes de coletar; entrega impossível depois', () => {
    expect(canCancel('A_CAMINHO_COLETA', 'COLETA_IMPOSSIVEL', 'MOTORISTA')).toBe(true);
    expect(canCancel('COLETADO', 'COLETA_IMPOSSIVEL', 'MOTORISTA')).toBe(false);
    expect(canCancel('COLETADO', 'ENTREGA_IMPOSSIVEL', 'MOTORISTA')).toBe(true);
    expect(canCancel('ACEITO', 'ENTREGA_IMPOSSIVEL', 'MOTORISTA')).toBe(false);
  });

  it('ninguém cancela estado final; admin cancela qualquer não final', () => {
    for (const r of CANCEL_REASONS) {
      expect(canCancel('ENTREGUE', r, 'ADMIN')).toBe(false);
      expect(canCancel('CANCELADO', r, 'ADMIN')).toBe(false);
    }
    expect(canCancel('A_CAMINHO_ENTREGA', 'ADMIN_CANCELOU', 'ADMIN')).toBe(true);
  });

  it('todo cancelamento permitido é uma transição válida', () => {
    for (const r of CANCEL_REASONS)
      for (const s of DELIVERY_STATUSES) {
        for (const actor of ['CLIENTE', 'MOTORISTA', 'SISTEMA', 'ADMIN'] as const)
          if (canCancel(s, r, actor)) expect(canTransitionDelivery(s, 'CANCELADO')).toBe(true);
      }
  });
});
