/** Segurança: denúncias, alertas de emergência e registro da viagem. */

export const REPORT_CATEGORIES = [
  'ASSEDIO',
  'VIOLENCIA',
  'DISCRIMINACAO',
  'DIRECAO_PERIGOSA',
  'MOTORISTA_DIFERENTE',
  'VEICULO_DIFERENTE',
  'COBRANCA_INDEVIDA',
  'OUTRO',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_CATEGORY_LABEL: Record<ReportCategory, string> = {
  ASSEDIO: 'Assédio',
  VIOLENCIA: 'Violência ou ameaça',
  DISCRIMINACAO: 'Discriminação',
  DIRECAO_PERIGOSA: 'Direção perigosa',
  MOTORISTA_DIFERENTE: 'O motorista não era quem estava no app',
  VEICULO_DIFERENTE: 'O veículo não era o do app',
  COBRANCA_INDEVIDA: 'Cobrança indevida',
  OUTRO: 'Outro assunto',
};

/** Categorias que o admin deve ver primeiro (fila ordenada por gravidade). */
export const SEVERE_REPORT_CATEGORIES: readonly ReportCategory[] = [
  'VIOLENCIA',
  'ASSEDIO',
  'MOTORISTA_DIFERENTE',
  'VEICULO_DIFERENTE',
];
export const isSevereReport = (c: ReportCategory) => SEVERE_REPORT_CATEGORIES.includes(c);

export const REPORT_STATUSES = [
  'ABERTA',
  'EM_ANALISE',
  'PROCEDENTE',
  'IMPROCEDENTE',
  'ARQUIVADA',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_DESCRIPTION_MIN = 10;
export const REPORT_DESCRIPTION_MAX = 1000;
/** Contra abuso do canal: denúncias por pessoa por dia. */
export const REPORTS_PER_DAY_LIMIT = 10;

export const EMERGENCY_STATUSES = ['ABERTO', 'EM_ATENDIMENTO', 'ENCERRADO'] as const;
export type EmergencyStatus = (typeof EMERGENCY_STATUSES)[number];
/** Apertar o botão de novo dentro desta janela atualiza o alerta aberto em vez de criar outro. */
export const EMERGENCY_DEDUP_SECONDS = 120;

/** Registro da viagem (posições durante a corrida). */
export const TRIP_POINT_MIN_INTERVAL_SECONDS = 10;
export const TRIP_RECORD_RETENTION_DAYS = 90;

/** Pontos antigos são apagados, exceto de corridas com denúncia ou alerta (guarda para apuração). */
export function tripRecordExpiry(now: Date, retentionDays = TRIP_RECORD_RETENTION_DAYS): Date {
  return new Date(now.getTime() - retentionDays * 86_400_000);
}

export const TRIP_RECORD_NOTICE =
  'Por segurança, a posição do veículo é registrada durante a corrida e guardada por 90 dias. ' +
  'Só a associação, em caso de denúncia ou emergência, pode consultar.';
