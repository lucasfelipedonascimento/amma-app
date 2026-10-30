import { DOCUMENT_TYPES, type DocumentInfo, type DocumentType } from './driver-approval';
import type { RideVehicleType } from './ride';

/**
 * REGRAS MUNICIPAIS DO TRANSPORTE DE PASSAGEIROS — são CONFIGURAÇÃO, não código.
 *
 * Idade máxima do veículo, documentos exigidos e a própria existência do mototáxi dependem da
 * legislação de João Pessoa, que muda e que a associação precisa confirmar. Por isso:
 *  - nada aqui é tratado como lei: os valores de `DEFAULT_MUNICIPAL_RULES` são PADRÕES NÃO
 *    CONFIRMADOS, usados só enquanto o admin não publicar uma versão (POST /admin/municipal-rules);
 *  - cada alteração vira uma nova versão (como a tabela de preço) e a anterior nunca é editada.
 */
export interface VehicleCategoryRules {
  /** Se a categoria pode receber corridas. Mototáxi nasce DESLIGADO até a associação confirmar a lei. */
  enabled: boolean;
  /** Idade máxima do veículo em anos (ano atual − ano de fabricação). */
  maxVehicleAgeYears: number;
  /** Idade mínima do motorista para corridas de passageiro. */
  minDriverAgeYears: number;
  /** Documentos que precisam estar APROVADOS (último envio de cada tipo) para a categoria. */
  requiredDocuments: DocumentType[];
  /** Avisos mostrados ao passageiro ao pedir (ex.: capacete). */
  passengerNotices: string[];
}

export interface MunicipalRules {
  city: string;
  car: VehicleCategoryRules;
  moto: VehicleCategoryRules;
  /** Liga a opção "motorista mulher" no pedido. */
  womenDriverOptionEnabled: boolean;
}

export const DEFAULT_MUNICIPAL_RULES: MunicipalRules = {
  city: 'João Pessoa - PB',
  car: {
    enabled: true,
    maxVehicleAgeYears: 10,
    minDriverAgeYears: 21,
    requiredDocuments: ['CNH', 'DOCUMENTO_VEICULO', 'FOTO'],
    passengerNotices: [],
  },
  moto: {
    enabled: false,
    maxVehicleAgeYears: 8,
    minDriverAgeYears: 21,
    requiredDocuments: ['CNH', 'DOCUMENTO_VEICULO', 'FOTO'],
    passengerNotices: ['Use o capacete que o motorista oferece. O passageiro vai sozinho na moto.'],
  },
  womenDriverOptionEnabled: true,
};

export const DEFAULT_RULES_WARNING =
  'Valores padrão NÃO confirmados: a associação precisa publicar as regras vigentes em João Pessoa.';

const AGE_LIMITS = [0, 40] as const;
const DRIVER_AGE_LIMITS = [18, 80] as const;

/** Lista de problemas (vazia = válida). */
export function validateMunicipalRules(r: MunicipalRules): string[] {
  const errors: string[] = [];
  if (!r.city?.trim()) errors.push('city é obrigatório');
  for (const key of ['car', 'moto'] as const) {
    const c = r[key];
    if (!c || typeof c.enabled !== 'boolean') {
      errors.push(`${key}.enabled deve ser verdadeiro ou falso`);
      continue;
    }
    if (
      !Number.isInteger(c.maxVehicleAgeYears) ||
      c.maxVehicleAgeYears < AGE_LIMITS[0] ||
      c.maxVehicleAgeYears > AGE_LIMITS[1]
    )
      errors.push(
        `${key}.maxVehicleAgeYears deve ser um inteiro entre ${AGE_LIMITS[0]} e ${AGE_LIMITS[1]}`,
      );
    if (
      !Number.isInteger(c.minDriverAgeYears) ||
      c.minDriverAgeYears < DRIVER_AGE_LIMITS[0] ||
      c.minDriverAgeYears > DRIVER_AGE_LIMITS[1]
    )
      errors.push(
        `${key}.minDriverAgeYears deve ser um inteiro entre ${DRIVER_AGE_LIMITS[0]} e ${DRIVER_AGE_LIMITS[1]}`,
      );
    if (
      !Array.isArray(c.requiredDocuments) ||
      c.requiredDocuments.some((d) => !DOCUMENT_TYPES.includes(d))
    )
      errors.push(`${key}.requiredDocuments tem tipo de documento desconhecido`);
    // Sem CNH/documento do veículo/foto a aprovação geral já não passa; exigir só extras seria um erro de digitação.
    else if (
      !['CNH', 'DOCUMENTO_VEICULO', 'FOTO'].every((d) =>
        c.requiredDocuments.includes(d as DocumentType),
      )
    )
      errors.push(`${key}.requiredDocuments deve incluir CNH, DOCUMENTO_VEICULO e FOTO`);
    if (
      !Array.isArray(c.passengerNotices) ||
      c.passengerNotices.some((n) => typeof n !== 'string' || n.length > 200)
    )
      errors.push(`${key}.passengerNotices deve ser uma lista de textos de até 200 caracteres`);
  }
  if (typeof r.womenDriverOptionEnabled !== 'boolean')
    errors.push('womenDriverOptionEnabled deve ser verdadeiro ou falso');
  return errors;
}

export const categoryRules = (r: MunicipalRules, type: RideVehicleType): VehicleCategoryRules =>
  type === 'MOTO' ? r.moto : r.car;

// ---------- Elegibilidade ----------

export const ELIGIBILITY_PROBLEMS = {
  CATEGORIA_DESLIGADA: 'Este tipo de corrida não está liberado em João Pessoa no momento.',
  VEICULO_TIPO_DIFERENTE: 'O veículo cadastrado não é deste tipo.',
  VEICULO_MUITO_VELHO: 'O veículo passa da idade máxima permitida.',
  MOTORISTA_MUITO_NOVO: 'O motorista não tem a idade mínima exigida.',
  DOCUMENTO_FALTANDO: 'Falta enviar um documento exigido.',
  DOCUMENTO_REPROVADO: 'Um documento exigido foi reprovado.',
  DOCUMENTO_PENDENTE: 'Um documento exigido ainda está em análise.',
} as const;
export type EligibilityProblem = keyof typeof ELIGIBILITY_PROBLEMS;

export interface EligibilityInput {
  vehicle: { type: RideVehicleType; year: number };
  /** Documentos do motorista; o de veículo deve ser só os do veículo avaliado. */
  documents: readonly DocumentInfo[];
  birthDate: string; // AAAA-MM-DD
}

export interface Eligibility {
  eligible: boolean;
  problems: EligibilityProblem[];
  /** Tipos de documento que o motorista ainda precisa enviar ou reenviar. */
  documentsToSend: DocumentType[];
}

/** Anos completos entre duas datas (data de nascimento → hoje). */
export function yearsBetween(isoDate: string, now: Date): number {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  let years = now.getUTCFullYear() - d.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate());
  if (beforeBirthday) years--;
  return years;
}

/** Idade do veículo: ano atual − ano de fabricação (um carro 2020 tem 6 anos em 2026). */
export const vehicleAgeYears = (year: number, now: Date) => now.getUTCFullYear() - year;

/** Aplica as regras vigentes a um motorista + veículo, para o tipo de corrida do veículo. */
export function evaluateRideEligibility(
  rules: MunicipalRules,
  input: EligibilityInput,
  now = new Date(),
): Eligibility {
  const cat = categoryRules(rules, input.vehicle.type);
  const problems = new Set<EligibilityProblem>();
  const toSend = new Set<DocumentType>();
  if (!cat.enabled) problems.add('CATEGORIA_DESLIGADA');
  if (vehicleAgeYears(input.vehicle.year, now) > cat.maxVehicleAgeYears)
    problems.add('VEICULO_MUITO_VELHO');
  if (yearsBetween(input.birthDate, now) < cat.minDriverAgeYears)
    problems.add('MOTORISTA_MUITO_NOVO');

  const latest = new Map<DocumentType, DocumentInfo>();
  for (const d of input.documents) {
    const cur = latest.get(d.type);
    if (!cur || Date.parse(d.createdAt) > Date.parse(cur.createdAt)) latest.set(d.type, d);
  }
  for (const type of cat.requiredDocuments) {
    const doc = latest.get(type);
    if (!doc) {
      problems.add('DOCUMENTO_FALTANDO');
      toSend.add(type);
    } else if (doc.status === 'REPROVADO') {
      problems.add('DOCUMENTO_REPROVADO');
      toSend.add(type);
    } else if (doc.status === 'PENDENTE') problems.add('DOCUMENTO_PENDENTE');
  }
  return { eligible: problems.size === 0, problems: [...problems], documentsToSend: [...toSend] };
}

/** Mulher verificada pela associação: autodeclaração + conferência do admin. */
export const GENDERS = ['FEMININO', 'MASCULINO', 'NAO_INFORMADO'] as const;
export type Gender = (typeof GENDERS)[number];
export const isVerifiedWoman = (
  gender: Gender | null | undefined,
  verifiedAt: Date | string | null | undefined,
) => gender === 'FEMININO' && !!verifiedAt;
