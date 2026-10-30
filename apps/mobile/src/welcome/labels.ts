import {
  HOUSE_CHECKLIST,
  type Amenity,
  type OpeningHours,
  type PointReportCategory,
  type PointReportStatus,
  type PointStatus,
  type PointType,
} from '@amma/shared';

export const TYPE_LABEL: Record<PointType, string> = {
  ESPACO_PUBLICO: 'Espaço público',
  CASA_PARCEIRA: 'Casa parceira',
  COMERCIO: 'Comércio',
};

export const AMENITY_LABEL: Record<Amenity, string> = {
  AGUA: 'Água',
  BANHEIRO: 'Banheiro',
  CARREGADOR: 'Carregador',
  DESCANSO: 'Descanso',
  WIFI: 'Wi-Fi',
  ALIMENTACAO: 'Comida',
  ESTACIONAMENTO: 'Estacionamento',
};

export const STATUS_LABEL: Record<PointStatus, string> = {
  EM_ANALISE: 'Em análise',
  ATIVO: 'No mapa',
  SUSPENSO: 'Suspenso',
  RECUSADO: 'Recusado',
  REMOVIDO: 'Removido',
};

export const REPORT_LABEL: Record<PointReportCategory, string> = {
  SEGURANCA: 'Não me senti seguro',
  ASSEDIO: 'Assédio',
  COBRANCA_INDEVIDA: 'Cobrança indevida',
  LOCAL_INEXISTENTE: 'Local não existe',
  ESTRUTURA_DIFERENTE: 'Estrutura diferente do anunciado',
  OUTRO: 'Outro motivo',
};

export const REPORT_STATUS_LABEL: Record<PointReportStatus, string> = {
  ABERTA: 'Em análise',
  PROCEDENTE: 'Procedente',
  IMPROCEDENTE: 'Arquivada',
};

export const CHECKLIST_TEXT = Object.fromEntries(HOUSE_CHECKLIST.map((i) => [i.key, i.text]));

/** Horários prontos do cadastro (horário de funcionamento personalizado ainda não existe no app). */
export const HOURS_PRESETS: { key: string; label: string; hours: OpeningHours }[] = [
  { key: '24h', label: '24 horas', hours: { always: true, slots: [] } },
  {
    key: 'seg-sex',
    label: 'Seg a sex, 8h–18h',
    hours: { always: false, slots: [{ days: [1, 2, 3, 4, 5], open: '08:00', close: '18:00' }] },
  },
  {
    key: 'seg-sab',
    label: 'Seg a sáb, 7h–19h',
    hours: { always: false, slots: [{ days: [1, 2, 3, 4, 5, 6], open: '07:00', close: '19:00' }] },
  },
  {
    key: 'todos',
    label: 'Todos os dias, 6h–22h',
    hours: {
      always: false,
      slots: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '06:00', close: '22:00' }],
    },
  },
];

const DAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "24 horas" ou "seg–sex 08:00–18:00; sáb 08:00–12:00". */
export function describeHours(h: OpeningHours): string {
  if (h.always) return '24 horas';
  return h.slots
    .map((s) => {
      const days = [...s.days].sort((a, b) => a - b);
      const range =
        days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1]! + 1)
          ? `${DAY[days[0]!]}–${DAY[days[days.length - 1]!]}`
          : days.map((d) => DAY[d]).join(', ');
      return `${range} ${s.open}–${s.close}`;
    })
    .join('; ');
}

export function formatKm(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters / 10) * 10} m`
    : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
