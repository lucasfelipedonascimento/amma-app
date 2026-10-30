import type { DeliveryKind, DeliveryStatus } from '@amma/shared';

/** Etapas que o motorista percorre, na ordem. `reaches` é o estado em que o pedido fica ao concluir a etapa. */
export const DELIVERY_STEPS = [
  {
    reaches: 'A_CAMINHO_COLETA',
    label: 'Indo à coleta',
    action: 'Ir para a coleta',
    path: 'en-route-pickup',
  },
  { reaches: 'COLETADO', label: 'Coletado', action: 'Confirmar coleta', path: 'picked-up' },
  {
    reaches: 'A_CAMINHO_ENTREGA',
    label: 'Indo à entrega',
    action: 'Seguir para a entrega',
    path: 'en-route-dropoff',
  },
  { reaches: 'ENTREGUE', label: 'Entregue', action: 'Confirmar entrega', path: 'delivered' },
] as const satisfies readonly {
  reaches: DeliveryStatus;
  label: string;
  action: string;
  path: string;
}[];

/** As mesmas 4 etapas e rotas, com os textos de uma corrida de passageiro. */
export const RIDE_STEPS = [
  {
    reaches: 'A_CAMINHO_COLETA',
    label: 'Buscando o passageiro',
    action: 'Ir buscar o passageiro',
    path: 'en-route-pickup',
  },
  { reaches: 'COLETADO', label: 'A bordo', action: 'Confirmar embarque', path: 'picked-up' },
  {
    reaches: 'A_CAMINHO_ENTREGA',
    label: 'Em viagem',
    action: 'Iniciar a viagem',
    path: 'en-route-dropoff',
  },
  { reaches: 'ENTREGUE', label: 'Concluída', action: 'Concluir a viagem', path: 'delivered' },
] as const satisfies readonly {
  reaches: DeliveryStatus;
  label: string;
  action: string;
  path: string;
}[];

export const stepsFor = (kind: DeliveryKind | undefined) =>
  kind === 'CORRIDA' ? RIDE_STEPS : DELIVERY_STEPS;

export type StepPath = (typeof DELIVERY_STEPS)[number]['path'];

/** Quantas etapas já foram concluídas (ACEITO = 0, ENTREGUE = 4). */
export function completedSteps(status: DeliveryStatus): number {
  const i = DELIVERY_STEPS.findIndex((s) => s.reaches === status);
  return i + 1; // estados fora da lista (ACEITO etc.) dão 0
}

/** Próxima etapa a executar, ou null se o pedido terminou/não está em andamento. */
export function nextStep(status: DeliveryStatus, kind?: DeliveryKind) {
  const done = completedSteps(status);
  const inProgress = ['ACEITO', 'A_CAMINHO_COLETA', 'COLETADO', 'A_CAMINHO_ENTREGA'].includes(
    status,
  );
  return inProgress ? (stepsFor(kind)[done] ?? null) : null;
}

/** Até a coleta o motorista ainda pode desistir sem punição; depois de coletar, não. */
export const canRelease = (status: DeliveryStatus) =>
  status === 'ACEITO' || status === 'A_CAMINHO_COLETA';
