/**
 * REGRAS PÚBLICAS DE DESPACHO. Tudo aqui é puro e testado; a API só busca os dados e aplica.
 * Cada decisão gravada no registro do pedido usa um dos códigos de DISPATCH_REASONS.
 */

export interface DispatchConfig {
  /** Raio máximo (metros, em linha reta) entre o motorista e o ponto de coleta. */
  radiusMeters: number;
  /** Quanto tempo o motorista tem para responder a uma oferta. */
  offerTtlSeconds: number;
  /** Tempo máximo procurando motorista; depois o pedido é cancelado (SEM_MOTORISTA). */
  maxSearchSeconds: number;
  /** Posição mais velha que isso é considerada desatualizada. */
  maxPositionAgeSeconds: number;
}

export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  radiusMeters: 3000,
  offerTtlSeconds: 30,
  maxSearchSeconds: 300,
  maxPositionAgeSeconds: 60,
};

const LIMITS: Record<keyof DispatchConfig, readonly [number, number]> = {
  radiusMeters: [200, 20_000],
  offerTtlSeconds: [5, 120],
  maxSearchSeconds: [30, 1800],
  maxPositionAgeSeconds: [10, 300],
};

/** Devolve a lista de problemas (vazia = válida). */
export function validateDispatchConfig(c: DispatchConfig): string[] {
  const errors: string[] = [];
  for (const key of Object.keys(LIMITS) as (keyof DispatchConfig)[]) {
    const [min, max] = LIMITS[key];
    const v = c[key];
    if (!Number.isInteger(v) || v < min || v > max)
      errors.push(`${key} deve ser um inteiro entre ${min} e ${max}`);
  }
  if (c.offerTtlSeconds > c.maxSearchSeconds)
    errors.push('offerTtlSeconds não pode ser maior que maxSearchSeconds');
  return errors;
}

/** Códigos de motivo gravados no registro de decisões. */
export const DISPATCH_REASONS = {
  // Escolha
  OFERTA_MAIS_PROXIMO: 'Oferta enviada ao motorista elegível mais próximo do ponto de coleta.',
  // Respostas do motorista / tempo
  ACEITOU: 'O motorista aceitou a oferta.',
  RECUSOU: 'O motorista recusou a oferta. Recusar não gera punição de nenhum tipo.',
  EXPIROU: 'O motorista não respondeu dentro do prazo. Não é tratado como recusa punível.',
  DESISTIU: 'O motorista aceitou, mas liberou o pedido antes de coletar.',
  FICOU_OFFLINE: 'O motorista ficou offline com uma oferta pendente. Não conta como recusa.',
  // Sem escolha
  SEM_CANDIDATOS: 'Nenhum motorista elegível no momento.',
  JANELA_ESGOTADA: 'Tempo máximo de busca esgotado; pedido cancelado.',
  // Motivos de um motorista ter sido descartado (contados no registro da oferta)
  FORA_DO_RAIO: 'Fora do raio de despacho.',
  POSICAO_ANTIGA: 'Última posição conhecida é antiga demais.',
  NAO_APROVADO: 'Cadastro/documentos não aprovados.',
  OCUPADO: 'Já tem uma entrega em andamento ou uma oferta pendente.',
  JA_TENTADO: 'Já recebeu oferta deste pedido (recusou, expirou ou desistiu).',
} as const;
export type DispatchReason = keyof typeof DISPATCH_REASONS;

/** As regras em texto, na ordem em que são aplicadas (publicadas em GET /dispatch/rules). */
export const DISPATCH_RULES: readonly string[] = [
  'Só recebem oferta motoristas ONLINE, com cadastro aprovado e posição recente.',
  'Motorista com entrega em andamento ou oferta pendente não recebe outra oferta.',
  'Só entram motoristas dentro do raio configurado, medido em linha reta até o ponto de coleta.',
  'A oferta vai para UM motorista por vez: o mais próximo. Empate de distância (em metros) vai para quem está online há mais tempo.',
  'O motorista tem um prazo configurável para responder. Sem resposta, a oferta expira e vai para o próximo.',
  'Motorista que já recebeu oferta daquele pedido (recusou, expirou ou desistiu) não recebe de novo o mesmo pedido.',
  'Recusar ou deixar expirar NÃO pune: não altera ranking, não gera contagem negativa nem bloqueio, e o motorista segue elegível para os próximos pedidos.',
  'Se ninguém aceitar dentro do tempo máximo de busca, o pedido é cancelado com o motivo SEM_MOTORISTA.',
  'Toda decisão (oferta, aceite, recusa, expiração, falta de candidatos) é registrada com um código de motivo.',
];

/** Motivos opcionais que o motorista pode informar ao recusar (só estatística; não afetam nada). */
export const DECLINE_REASONS = [
  'LONGE_DEMAIS',
  'VALOR_BAIXO',
  'VEICULO_INADEQUADO',
  'OUTRO',
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export interface DispatchCandidate {
  driverId: string;
  /** Distância em linha reta até a coleta, em metros. */
  distanceMeters: number;
  /** Idade da última posição, em segundos. */
  positionAgeSeconds: number;
  approved: boolean;
  /** Entrega em andamento ou oferta pendente. */
  busy: boolean;
  /** Já recebeu oferta deste pedido. */
  alreadyTried: boolean;
  /** ISO 8601 UTC: desde quando está online (desempate). */
  onlineSince: string;
}

export interface DispatchChoice {
  chosen: DispatchCandidate | null;
  /** Quantos candidatos foram descartados, por motivo (o 1º motivo que se aplica). */
  excluded: Partial<Record<DispatchReason, number>>;
  /** Quantos eram elegíveis (inclui o escolhido). */
  eligible: number;
}

/** Aplica as regras públicas e escolhe o motorista mais próximo. */
export function chooseCandidate(
  candidates: readonly DispatchCandidate[],
  config: DispatchConfig,
): DispatchChoice {
  const excluded: Partial<Record<DispatchReason, number>> = {};
  const eligible: DispatchCandidate[] = [];
  for (const c of candidates) {
    const reason: DispatchReason | null =
      c.distanceMeters > config.radiusMeters
        ? 'FORA_DO_RAIO'
        : c.positionAgeSeconds > config.maxPositionAgeSeconds
          ? 'POSICAO_ANTIGA'
          : !c.approved
            ? 'NAO_APROVADO'
            : c.busy
              ? 'OCUPADO'
              : c.alreadyTried
                ? 'JA_TENTADO'
                : null;
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    else eligible.push(c);
  }
  eligible.sort(
    (a, b) =>
      a.distanceMeters - b.distanceMeters ||
      Date.parse(a.onlineSince) - Date.parse(b.onlineSince) ||
      a.driverId.localeCompare(b.driverId),
  );
  return { chosen: eligible[0] ?? null, excluded, eligible: eligible.length };
}
