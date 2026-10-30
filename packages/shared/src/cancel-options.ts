import type { DeliveryStatus } from './delivery-state';
import type { DeliveryKind } from './ride';
/** Um motivo que a pessoa escolhe ao cancelar (os mais comuns em apps de corrida/entrega). */
export interface CancelOption {
  key: string;
  label: string;
}

/** Motivos do cliente/passageiro. Os dois últimos de "motorista" só fazem sentido com motorista a caminho. */
const CLIENT_OPTIONS = [
  { key: 'MUDEI_DE_IDEIA', label: 'Mudei de ideia' },
  { key: 'PEDI_POR_ENGANO', label: 'Pedi por engano' },
  { key: 'ENDERECO_ERRADO', label: 'Coloquei o endereço errado' },
  { key: 'DEMORA_MOTORISTA', label: 'O motorista está demorando', needsDriver: true },
  { key: 'MOTORISTA_PEDIU', label: 'O motorista pediu para cancelar', needsDriver: true },
  { key: 'OUTRO_MEIO', label: 'Encontrei outro meio de transporte' },
  { key: 'OUTRO', label: 'Outro motivo' },
] as const;

export const clientCancelOptions = (status: DeliveryStatus): CancelOption[] => {
  const hasDriver = status === 'ACEITO' || status === 'A_CAMINHO_COLETA';
  return CLIENT_OPTIONS.filter((o) => hasDriver || !('needsDriver' in o)).map(({ key, label }) => ({
    key,
    label,
  }));
};

/** O que acontece quando o motorista escolhe o motivo. */
export type DriverCancelEffect = 'RELEASE' | 'CANCEL';
export interface DriverCancelOption extends CancelOption {
  /** RELEASE: o pedido volta para a fila (sem punição). CANCEL: o pedido é cancelado e o cliente estornado. */
  effect: DriverCancelEffect;
}

interface DriverOptionDef {
  key: string;
  label: string;
  /** Rótulo alternativo na corrida de passageiro. */
  ride?: string;
  /** Efeito antes de coletar (ACEITO/A_CAMINHO_COLETA). Ausente = não aparece antes da coleta. */
  before?: DriverCancelEffect;
  /** Aparece depois de coletar (a única saída é cancelar). */
  after?: boolean;
  only?: DeliveryKind;
}

const DRIVER_OPTIONS: readonly DriverOptionDef[] = [
  { key: 'PROBLEMA_VEICULO', label: 'Problema com o veículo', before: 'RELEASE', after: true },
  { key: 'EMERGENCIA_PESSOAL', label: 'Emergência pessoal', before: 'RELEASE', after: true },
  { key: 'MUITO_LONGE', label: 'Coleta muito longe ou trânsito parado', before: 'RELEASE' },
  { key: 'ACEITEI_SEM_QUERER', label: 'Aceitei sem querer', before: 'RELEASE' },
  {
    key: 'CLIENTE_NAO_APARECEU',
    label: 'Cliente não apareceu ou não atende',
    ride: 'Passageiro não apareceu ou não atende',
    before: 'CANCEL',
  },
  {
    key: 'CLIENTE_PEDIU_CANCELAR',
    label: 'Cliente pediu para cancelar',
    ride: 'Passageiro pediu para cancelar',
    before: 'CANCEL',
    after: true,
  },
  {
    key: 'ENDERECO_INCORRETO',
    label: 'Endereço incorreto ou de acesso impossível',
    before: 'CANCEL',
    after: true,
  },
  {
    key: 'ITEM_NAO_PRONTO',
    label: 'Item não estava pronto para coleta',
    before: 'CANCEL',
    only: 'ENTREGA',
  },
  {
    key: 'DESTINATARIO_AUSENTE',
    label: 'Destinatário ausente',
    after: true,
    only: 'ENTREGA',
  },
  {
    key: 'PASSAGEIRO_DESISTIU',
    label: 'Passageiro desistiu da viagem',
    after: true,
    only: 'CORRIDA',
  },
  {
    key: 'SITUACAO_INSEGURA',
    label: 'Situação insegura',
    before: 'CANCEL',
    after: true,
  },
];

/**
 * Motivos que o motorista pode escolher agora, com o efeito de cada um.
 * Segue CANCEL_RULES: depois de ACEITO só dá para liberar o pedido; cancelar (coleta impossível)
 * exige estar a caminho da coleta; depois de coletar, só "entrega impossível".
 */
export function driverCancelOptions(
  status: DeliveryStatus,
  kind: DeliveryKind = 'ENTREGA',
): DriverCancelOption[] {
  const beforePickup = status === 'ACEITO' || status === 'A_CAMINHO_COLETA';
  const afterPickup = status === 'COLETADO' || status === 'A_CAMINHO_ENTREGA';
  const out: DriverCancelOption[] = [];
  for (const o of DRIVER_OPTIONS) {
    if (o.only && o.only !== kind) continue;
    const label = kind === 'CORRIDA' && o.ride ? o.ride : o.label;
    if (beforePickup && o.before) {
      // Cancelar (coleta impossível) só vale a caminho da coleta; em ACEITO só liberar.
      if (o.before === 'RELEASE' || status === 'A_CAMINHO_COLETA')
        out.push({ key: o.key, label, effect: o.before });
    } else if (afterPickup && o.after) out.push({ key: o.key, label, effect: 'CANCEL' });
  }
  // "Outro motivo" segue a ação mais branda: liberar antes da coleta, cancelar depois.
  out.push({ key: 'OUTRO', label: 'Outro motivo', effect: beforePickup ? 'RELEASE' : 'CANCEL' });
  return out;
}

/** Todas as chaves aceitas pela API (a lista por ator é conferida no serviço). */
export const CLIENT_CANCEL_KEYS: readonly string[] = CLIENT_OPTIONS.map((o) => o.key);
export const DRIVER_CANCEL_KEYS: readonly string[] = [...DRIVER_OPTIONS.map((o) => o.key), 'OUTRO'];
export const CANCEL_CATEGORY_KEYS: readonly string[] = [
  ...new Set([...CLIENT_CANCEL_KEYS, ...DRIVER_CANCEL_KEYS]),
];

/** Texto legível de uma chave de motivo (para o painel e para o cliente). */
export const CANCEL_CATEGORY_LABEL: Record<string, string> = Object.fromEntries([
  ...CLIENT_OPTIONS.map((o) => [o.key, o.label]),
  ...DRIVER_OPTIONS.map((o) => [o.key, o.label]),
]);
