export const DOCUMENT_TYPES = [
  'CNH',
  'DOCUMENTO_VEICULO',
  'FOTO',
  // Opcionais: só valem se as regras municipais de corrida de passageiro os exigirem (ver municipal-rules.ts).
  'ANTECEDENTES',
  'LICENCA_MUNICIPAL',
  'SEGURO_PASSAGEIROS',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
/** Aprovação geral do motorista (entregas): só estes três contam. */
export const BASE_REQUIRED_DOCUMENTS = [
  'CNH',
  'DOCUMENTO_VEICULO',
  'FOTO',
] as const satisfies readonly DocumentType[];

export const DOCUMENT_LABEL: Record<DocumentType, string> = {
  CNH: 'CNH',
  DOCUMENTO_VEICULO: 'Documento do veículo (CRLV)',
  FOTO: 'Foto do rosto',
  ANTECEDENTES: 'Certidão de antecedentes criminais',
  LICENCA_MUNICIPAL: 'Licença municipal',
  SEGURO_PASSAGEIROS: 'Seguro de passageiros',
};
export const APPROVAL_STATUSES = ['PENDENTE', 'APROVADO', 'REPROVADO'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export interface DocumentInfo {
  type: DocumentType;
  status: ApprovalStatus;
  /** ISO 8601; o envio mais recente de cada tipo é o que vale. */
  createdAt: string;
}

export interface DriverApproval {
  status: ApprovalStatus;
  /** Tipos de documento que ainda não foram enviados. */
  missing: DocumentType[];
  /** Tipos cujo último envio foi reprovado (precisam ser reenviados). */
  rejected: DocumentType[];
}

/**
 * Situação geral do motorista, a partir do ÚLTIMO envio de cada tipo obrigatório:
 * - REPROVADO: algum último envio foi reprovado;
 * - APROVADO: todos os tipos enviados e aprovados;
 * - PENDENTE: caso contrário (faltando envio ou aguardando análise).
 */
export function driverApproval(documents: readonly DocumentInfo[]): DriverApproval {
  const latest = new Map<DocumentType, DocumentInfo>();
  for (const d of documents) {
    const cur = latest.get(d.type);
    if (!cur || Date.parse(d.createdAt) > Date.parse(cur.createdAt)) latest.set(d.type, d);
  }
  const missing = BASE_REQUIRED_DOCUMENTS.filter((t) => !latest.has(t));
  const rejected = BASE_REQUIRED_DOCUMENTS.filter((t) => latest.get(t)?.status === 'REPROVADO');
  if (rejected.length > 0) return { status: 'REPROVADO', missing, rejected };
  const allApproved =
    missing.length === 0 &&
    BASE_REQUIRED_DOCUMENTS.every((t) => latest.get(t)?.status === 'APROVADO');
  return { status: allApproved ? 'APROVADO' : 'PENDENTE', missing, rejected };
}
