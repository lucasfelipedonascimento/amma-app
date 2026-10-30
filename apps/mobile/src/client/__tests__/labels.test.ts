import {
  clientStage,
  canClientCancel,
  formatClock,
  isOpen,
  secondsLeft,
  statusText,
} from '../labels';
import { delivery, payment, pixPayment } from '../../testing/clientFixtures';

describe('rótulos do cliente', () => {
  it('Pix pendente mostra "aguardando o pagamento"; pago, busca de motorista', () => {
    expect(statusText({ status: 'CRIADO', payment: pixPayment })).toBe('Aguardando o pagamento');
    expect(statusText({ status: 'CRIADO', payment })).toBe('Buscando motorista');
    expect(statusText({ status: 'COLETADO', payment })).toBe('Item coletado');
  });

  it('etapas do cliente', () => {
    const at = (status: typeof delivery.status) => clientStage({ status, payment });
    expect([at('CRIADO'), at('OFERECIDO'), at('ACEITO'), at('A_CAMINHO_COLETA')]).toEqual([
      0, 0, 1, 1,
    ]);
    expect([at('COLETADO'), at('A_CAMINHO_ENTREGA'), at('ENTREGUE')]).toEqual([2, 2, 4]);
  });

  it('cliente só cancela até o motorista coletar (igual ao servidor)', () => {
    for (const s of ['CRIADO', 'OFERECIDO', 'ACEITO', 'A_CAMINHO_COLETA'] as const)
      expect(canClientCancel(s)).toBe(true);
    for (const s of ['COLETADO', 'A_CAMINHO_ENTREGA', 'ENTREGUE', 'CANCELADO'] as const)
      expect(canClientCancel(s)).toBe(false);
  });

  it('em aberto', () => {
    expect(isOpen('CRIADO')).toBe(true);
    expect(isOpen('ENTREGUE')).toBe(false);
    expect(isOpen('CANCELADO')).toBe(false);
  });

  it('contagem do Pix nunca fica negativa', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(secondsLeft('2026-10-29T12:10:00Z', now)).toBe(600);
    expect(secondsLeft('2026-10-29T11:00:00Z', now)).toBe(0);
    expect(secondsLeft(null, now)).toBe(0);
    expect(formatClock(605)).toBe('10:05');
    expect(formatClock(0)).toBe('00:00');
  });
});
