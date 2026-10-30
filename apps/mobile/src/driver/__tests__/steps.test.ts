import { canRelease, completedSteps, nextStep } from '../steps';

describe('etapas da entrega', () => {
  it('conta as etapas concluídas por estado', () => {
    expect(completedSteps('ACEITO')).toBe(0);
    expect(completedSteps('A_CAMINHO_COLETA')).toBe(1);
    expect(completedSteps('COLETADO')).toBe(2);
    expect(completedSteps('A_CAMINHO_ENTREGA')).toBe(3);
    expect(completedSteps('ENTREGUE')).toBe(4);
  });

  it('a próxima ação segue a ordem e bate com as rotas da API', () => {
    expect(nextStep('ACEITO')?.path).toBe('en-route-pickup');
    expect(nextStep('A_CAMINHO_COLETA')?.path).toBe('picked-up');
    expect(nextStep('COLETADO')?.path).toBe('en-route-dropoff');
    expect(nextStep('A_CAMINHO_ENTREGA')?.path).toBe('delivered');
  });

  it('sem próxima ação quando terminou ou não está em andamento', () => {
    expect(nextStep('ENTREGUE')).toBeNull();
    expect(nextStep('CANCELADO')).toBeNull();
    expect(nextStep('CRIADO')).toBeNull();
  });

  it('só pode liberar o pedido antes de coletar', () => {
    expect(canRelease('ACEITO')).toBe(true);
    expect(canRelease('A_CAMINHO_COLETA')).toBe(true);
    expect(canRelease('COLETADO')).toBe(false);
    expect(canRelease('A_CAMINHO_ENTREGA')).toBe(false);
  });
});
