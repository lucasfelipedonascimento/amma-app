import { haversineMeters, type GeoPoint } from './geo';

/**
 * Pontos de acolhida: lugares onde o trabalhador de rua descansa (água, banheiro, carregador).
 * Regras puras: tipos, horário, check-in, benefício do anfitrião e quando um ponto sai do ar.
 */
export const POINT_TYPES = ['ESPACO_PUBLICO', 'CASA_PARCEIRA', 'COMERCIO'] as const;
export type PointType = (typeof POINT_TYPES)[number];

/** EM_ANALISE só existe para casa parceira (espera o admin). SUSPENSO = fora do mapa até o admin decidir. */
export const POINT_STATUSES = ['EM_ANALISE', 'ATIVO', 'SUSPENSO', 'RECUSADO', 'REMOVIDO'] as const;
export type PointStatus = (typeof POINT_STATUSES)[number];

export const AMENITIES = [
  'AGUA',
  'BANHEIRO',
  'CARREGADOR',
  'DESCANSO',
  'WIFI',
  'ALIMENTACAO',
  'ESTACIONAMENTO',
] as const;
export type Amenity = (typeof AMENITIES)[number];

export const POINT_CAPACITY_MAX = 50;

/** Casa e comércio têm um anfitrião (quem cadastrou); espaço público não. */
export const hasHost = (type: PointType): boolean => type !== 'ESPACO_PUBLICO';

/** Só a casa parceira passa por checklist de segurança e aprovação do admin antes de aparecer. */
export const needsApproval = (type: PointType): boolean => type === 'CASA_PARCEIRA';

export const initialPointStatus = (type: PointType): PointStatus =>
  needsApproval(type) ? 'EM_ANALISE' : 'ATIVO';

// ------------------------------------------------------------------ horário

export interface HoursSlot {
  /** 0 = domingo … 6 = sábado. */
  days: number[];
  /** "HH:MM", horário de João Pessoa. Se `close` for menor que `open`, vira a meia-noite. */
  open: string;
  close: string;
}
export interface OpeningHours {
  always: boolean;
  slots: HoursSlot[];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** João Pessoa não tem horário de verão: UTC−3 o ano todo. */
const OFFSET_MINUTES = -180;

/** Mensagem do primeiro problema do horário, ou null se está válido. */
export function validateHours(h: unknown): string | null {
  if (typeof h !== 'object' || h === null) return 'Informe o horário de funcionamento';
  const { always, slots } = h as Partial<OpeningHours>;
  if (typeof always !== 'boolean' || !Array.isArray(slots)) return 'Horário em formato inválido';
  if (always) return slots.length === 0 ? null : '24 horas não leva faixas de horário';
  if (slots.length === 0 || slots.length > 14) return 'Informe de 1 a 14 faixas de horário';
  for (const s of slots as HoursSlot[]) {
    if (!s || !Array.isArray(s.days) || s.days.length === 0) return 'Cada faixa precisa de dias';
    if (new Set(s.days).size !== s.days.length) return 'Dia repetido na mesma faixa';
    if (s.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Dia da semana inválido';
    if (typeof s.open !== 'string' || !HHMM.test(s.open)) return 'Abertura inválida (use HH:MM)';
    if (typeof s.close !== 'string' || !HHMM.test(s.close))
      return 'Fechamento inválido (use HH:MM)';
    if (s.open === s.close) return 'Abertura e fechamento não podem ser iguais';
  }
  return null;
}

/** O ponto está aberto neste instante? (horário de João Pessoa; faixas que viram a noite contam.) */
export function isOpenAt(hours: OpeningHours, at: Date): boolean {
  if (hours.always) return true;
  const local = new Date(at.getTime() + OFFSET_MINUTES * 60_000);
  const day = local.getUTCDay();
  const prevDay = (day + 6) % 7;
  const now = local.getUTCHours() * 60 + local.getUTCMinutes();
  return hours.slots.some((s) => {
    const open = minutesOf(s.open);
    const close = minutesOf(s.close);
    if (open < close) return s.days.includes(day) && now >= open && now < close;
    // Vira a noite: a parte de hoje (depois da abertura) e o resto da faixa de ontem (antes do fechamento).
    return (s.days.includes(day) && now >= open) || (s.days.includes(prevDay) && now < close);
  });
}

// ------------------------------------------------------------------ casa parceira

/** Checklist de segurança que o anfitrião da casa confirma item a item. Todos são obrigatórios. */
export const HOUSE_CHECKLIST = [
  { key: 'RESPONSAVEL_MAIOR', text: 'Sou maior de 18 anos e responsável pelo local.' },
  { key: 'AREA_SEPARADA', text: 'O espaço de descanso fica separado das áreas íntimas da casa.' },
  { key: 'BANHEIRO_ACESSIVEL', text: 'O banheiro pode ser usado sem passar pelos quartos.' },
  { key: 'ENTRADA_ILUMINADA', text: 'A entrada tem boa iluminação e é visível da rua.' },
  { key: 'SEM_COBRANCA', text: 'Não vou cobrar nem exigir nada em troca da acolhida.' },
  {
    key: 'CODIGO_DE_CONDUTA',
    text: 'Aceito tratar todos com respeito e que a AMMA apure denúncias.',
  },
] as const;
export type HouseChecklistKey = (typeof HOUSE_CHECKLIST)[number]['key'];
export type HouseChecklist = Record<HouseChecklistKey, boolean>;

/** Itens do checklist que ficaram sem confirmação (vazio = completo). */
export function missingChecklistItems(c: unknown): HouseChecklistKey[] {
  const given = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
  return HOUSE_CHECKLIST.filter((i) => given[i.key] !== true).map((i) => i.key);
}

/** O admin só aprova depois de conferir quem é o anfitrião e o local (visita, foto ou documento). */
export const APPROVAL_CHECKS = ['identityChecked', 'placeChecked'] as const;

// ------------------------------------------------------------------ check-in

/** Distância máxima entre o aparelho e o ponto para valer o check-in (a posição da casa é aproximada). */
export const CHECKIN_RADIUS_METERS = 200;
/** O check-in fecha sozinho depois disso, sem benefício. */
export const CHECKIN_MAX_MINUTES = 240;
/** Estadia mínima para a visita contar (e gerar benefício). */
export const CHECKIN_MIN_MINUTES = 5;
/** Intervalo mínimo entre duas visitas da mesma pessoa ao mesmo ponto. */
export const CHECKIN_COOLDOWN_MINUTES = 360;

export const withinCheckinRadius = (device: GeoPoint, point: GeoPoint): boolean =>
  haversineMeters(device, point) <= CHECKIN_RADIUS_METERS;

// ------------------------------------------------------------------ benefício

export const HOST_BENEFIT_KINDS = ['CREDITO', 'DESCONTO'] as const;
export type HostBenefitKind = (typeof HOST_BENEFIT_KINDS)[number];
/** Por visita concluída. Valor de exemplo — a associação define. */
export const HOST_BENEFIT_PER_VISIT_CENTS = 100;
/** Teto por ponto em cada mês (fuso de João Pessoa). */
export const HOST_BENEFIT_MONTHLY_CAP_CENTS = 3000;

/** Só a casa parceira rende benefício (comércio já ganha o movimento; espaço público não tem anfitrião). */
export const earnsHostBenefit = (type: PointType): boolean => type === 'CASA_PARCEIRA';

/** Quanto a visita rende, respeitando o teto do mês. */
export function hostBenefitCents(earnedThisMonthCents: number): number {
  const room = HOST_BENEFIT_MONTHLY_CAP_CENTS - Math.max(0, earnedThisMonthCents);
  return Math.max(0, Math.min(HOST_BENEFIT_PER_VISIT_CENTS, room));
}

/** Início do mês corrente em João Pessoa, como instante UTC. */
export function startOfMonthJoaoPessoa(now: Date): Date {
  const local = new Date(now.getTime() + OFFSET_MINUTES * 60_000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - OFFSET_MINUTES * 60_000,
  );
}

// ------------------------------------------------------------------ avaliação e denúncia

/** Quem avalia quem: o visitante avalia o ponto; o anfitrião avalia o visitante (só onde há anfitrião). */
export const POINT_RATING_DIRECTIONS = [
  'VISITANTE_AVALIA_PONTO',
  'ANFITRIAO_AVALIA_VISITANTE',
] as const;
export type PointRatingDirection = (typeof POINT_RATING_DIRECTIONS)[number];

export const POINT_REPORT_CATEGORIES = [
  'SEGURANCA',
  'ASSEDIO',
  'COBRANCA_INDEVIDA',
  'LOCAL_INEXISTENTE',
  'ESTRUTURA_DIFERENTE',
  'OUTRO',
] as const;
export type PointReportCategory = (typeof POINT_REPORT_CATEGORIES)[number];
/** Uma denúncia grave já tira o ponto do mapa até o admin decidir. */
export const POINT_SEVERE_REPORT_CATEGORIES: readonly PointReportCategory[] = [
  'SEGURANCA',
  'ASSEDIO',
];
/** ABERTA espera o admin; PROCEDENTE = o admin concordou; IMPROCEDENTE = arquivada. */
export const POINT_REPORT_STATUSES = ['ABERTA', 'PROCEDENTE', 'IMPROCEDENTE'] as const;
export type PointReportStatus = (typeof POINT_REPORT_STATUSES)[number];
export const POINT_REPORT_TEXT_MAX = 1000;

/** Notas de 1 a 5 só são julgadas a partir de tantas avaliações; abaixo disso a média engana. */
export const MIN_RATINGS_TO_JUDGE = 5;
/** Média (exata) abaixo disto, com notas suficientes, suspende o ponto. */
export const SUSPEND_BELOW_AVERAGE = 2;
/** Denunciantes diferentes com denúncia aberta que suspendem o ponto. */
export const SUSPEND_AT_OPEN_REPORTS = 3;

export type SuspendReason = 'NOTA_BAIXA' | 'DENUNCIAS' | 'DENUNCIA_GRAVE';

/** O ponto deve sair do mapa à espera da decisão do admin? Devolve o motivo ou null. */
export function suspensionReason(input: {
  stars: readonly number[];
  openReports: readonly { reporterId: string; category: PointReportCategory }[];
}): SuspendReason | null {
  if (input.openReports.some((r) => POINT_SEVERE_REPORT_CATEGORIES.includes(r.category)))
    return 'DENUNCIA_GRAVE';
  if (new Set(input.openReports.map((r) => r.reporterId)).size >= SUSPEND_AT_OPEN_REPORTS)
    return 'DENUNCIAS';
  const { stars } = input;
  if (stars.length >= MIN_RATINGS_TO_JUDGE) {
    const mean = stars.reduce((a, b) => a + b, 0) / stars.length;
    if (mean < SUSPEND_BELOW_AVERAGE) return 'NOTA_BAIXA';
  }
  return null;
}

export const SUSPEND_REASON_TEXT: Record<SuspendReason, string> = {
  NOTA_BAIXA: 'Nota média baixa nas avaliações',
  DENUNCIAS: 'Várias denúncias abertas',
  DENUNCIA_GRAVE: 'Denúncia grave aberta',
};

// ------------------------------------------------------------------ privacidade da casa

/** ~110 m: o mapa mostra a casa de alguém só de forma aproximada até o check-in. */
export function approximatePoint(p: GeoPoint): GeoPoint {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { lat: r(p.lat), lng: r(p.lng) };
}

// ------------------------------------------------------------------ filtros do mapa

export interface PointFilter {
  types?: readonly PointType[];
  amenities?: readonly Amenity[];
  openNow?: boolean;
  /** Média mínima (só vale para pontos que já têm média). */
  minRating?: number;
}

export interface FilterablePoint {
  type: PointType;
  amenities: readonly Amenity[];
  hours: OpeningHours;
  /** null = sem média ainda (poucas avaliações). */
  average: number | null;
}

/** Aplica os filtros do mapa. Ponto sem média ainda passa no filtro de nota: falta dado, não é ruim. */
export function matchesFilter(p: FilterablePoint, f: PointFilter, now: Date): boolean {
  if (f.types?.length && !f.types.includes(p.type)) return false;
  if (f.amenities?.length && !f.amenities.every((a) => p.amenities.includes(a))) return false;
  if (f.openNow && !isOpenAt(p.hours, now)) return false;
  if (f.minRating !== undefined && p.average !== null && p.average < f.minRating) return false;
  return true;
}
