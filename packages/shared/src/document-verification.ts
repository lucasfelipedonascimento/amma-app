/**
 * Conferência automática de documentos do motorista (CNH e CRLV).
 *
 * O leitor (serviço Python, `services/doc-reader`) extrai os campos e valida dígitos e bases oficiais.
 * Aqui entra o que só a AMMA sabe: o cadastro do motorista. Cruzamos os dois e geramos uma RECOMENDAÇÃO.
 * Quem decide continua sendo a pessoa do painel, a não ser que a aprovação automática seja ligada
 * (e mesmo assim só com tudo conferido numa base oficial real). Reprovação nunca é automática.
 */

export type VerifiableDocument = 'CNH' | 'DOCUMENTO_VEICULO';
export const VERIFIABLE_DOCUMENTS: readonly VerifiableDocument[] = ['CNH', 'DOCUMENTO_VEICULO'];

export type GovStatus =
  'CONFIRMADO' | 'DIVERGENTE' | 'NAO_ENCONTRADO' | 'INDISPONIVEL' | 'NAO_CONSULTADO';

/** Resposta do leitor (campos em camelCase, datas ISO). Vem de outro serviço: tratada como entrada não confiável. */
export interface ReaderAnalysis {
  kind: 'CNH' | 'CRLV' | 'UNKNOWN';
  engine: string;
  readable: boolean;
  fields: Record<string, string | number | boolean | null | undefined>;
  checks: { code: string; ok: boolean | null; detail?: string }[];
  government: { scope: string; provider: string; status: GovStatus; detail?: string }[];
}

export interface VerificationContext {
  type: VerifiableDocument;
  profile: { cpf: string; fullName: string; birthDate: string }; // cpf só dígitos; data AAAA-MM-DD
  vehicle?: { plate: string; year: number; type: 'MOTO' | 'CARRO' };
}

/** OK = conferiu; ALERTA = não deu para confirmar (olho humano); FALHA = contradiz o cadastro ou é inválido. */
export type FindingLevel = 'OK' | 'ALERTA' | 'FALHA';
export interface Finding {
  code: string;
  label: string;
  level: FindingLevel;
  detail?: string;
}
export type Recommendation = 'APROVAR' | 'REVISAR';
export interface VerificationOutcome {
  recommendation: Recommendation;
  findings: Finding[];
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Mesmo nome apesar de acento, caixa e partículas (DE, DA...): primeiro e último nome iguais e 70% dos nomes em comum. */
export function namesMatch(a: string, b: string): boolean {
  const ta = fold(a).filter((t) => !['DE', 'DA', 'DO', 'DAS', 'DOS', 'E'].includes(t));
  const tb = fold(b).filter((t) => !['DE', 'DA', 'DO', 'DAS', 'DOS', 'E'].includes(t));
  if (ta.length < 2 || tb.length < 2) return false;
  if (ta[0] !== tb[0] || ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const common = ta.filter((t) => tb.includes(t)).length;
  return common / Math.max(ta.length, tb.length) >= 0.7;
}

/** A categoria da CNH permite conduzir o veículo? ACC (ciclomotor) sozinha não serve para moto de entrega. */
export function categoryAllows(category: string, vehicle: 'MOTO' | 'CARRO'): boolean {
  const c = category.toUpperCase();
  if (c === 'ACC') return false;
  return vehicle === 'MOTO' ? c.includes('A') : /[BCDE]/.test(c);
}

const ok = (code: string, label: string, detail?: string): Finding => ({
  code,
  label,
  level: 'OK',
  detail,
});
const warn = (code: string, label: string, detail?: string): Finding => ({
  code,
  label,
  level: 'ALERTA',
  detail,
});
const fail = (code: string, label: string, detail?: string): Finding => ({
  code,
  label,
  level: 'FALHA',
  detail,
});

function flag(c: ReaderAnalysis, code: string): boolean | null | undefined {
  return c.checks.find((x) => x.code === code)?.ok;
}

function governmentFindings(a: ReaderAnalysis): Finding[] {
  if (a.government.length === 0)
    return [warn('BASE_OFICIAL', 'Base oficial', 'Não foi consultada')];
  return a.government.map((g) => {
    const label = `Base oficial (${g.scope})`;
    if (g.provider === 'sandbox')
      return warn('BASE_OFICIAL', label, 'Validação simulada, não vale como conferência');
    if (g.status === 'CONFIRMADO') return ok('BASE_OFICIAL', label);
    if (g.status === 'DIVERGENTE' || g.status === 'NAO_ENCONTRADO')
      return fail(
        'BASE_OFICIAL',
        label,
        g.status === 'DIVERGENTE' ? 'Dados divergentes' : 'Não encontrado',
      );
    return warn(
      'BASE_OFICIAL',
      label,
      g.status === 'INDISPONIVEL' ? 'Base indisponível' : 'Não consultada',
    );
  });
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

export function evaluateVerification(
  a: ReaderAnalysis,
  ctx: VerificationContext,
): VerificationOutcome {
  const findings: Finding[] = [];
  const expectedKind = ctx.type === 'CNH' ? 'CNH' : 'CRLV';
  if (!a.readable) {
    findings.push(
      warn('LEGIVEL', 'Leitura', 'Não foi possível ler o documento (foto ruim ou formato)'),
    );
    return { recommendation: 'REVISAR', findings };
  }
  if (a.kind !== expectedKind) {
    findings.push(
      fail('TIPO', 'Tipo do documento', `Parece ser ${a.kind}, esperado ${expectedKind}`),
    );
    return { recommendation: 'REVISAR', findings };
  }
  const f = a.fields;

  if (ctx.type === 'CNH') {
    const cpf = str(f.cpf)?.replace(/\D/g, '');
    if (!cpf) findings.push(warn('CPF', 'CPF', 'Não lido'));
    else if (flag(a, 'CPF_VALIDO') === false)
      findings.push(fail('CPF', 'CPF', 'Dígitos verificadores inválidos'));
    else if (cpf !== ctx.profile.cpf) findings.push(fail('CPF', 'CPF', 'Diferente do cadastro'));
    else findings.push(ok('CPF', 'CPF'));

    const name = str(f.name);
    if (!name) findings.push(warn('NOME', 'Nome', 'Não lido'));
    else if (!namesMatch(name, ctx.profile.fullName))
      findings.push(fail('NOME', 'Nome', 'Diferente do cadastro'));
    else findings.push(ok('NOME', 'Nome'));

    const birth = str(f.birthDate);
    if (!birth) findings.push(warn('NASCIMENTO', 'Data de nascimento', 'Não lida'));
    else if (birth !== ctx.profile.birthDate)
      findings.push(fail('NASCIMENTO', 'Data de nascimento', 'Diferente do cadastro'));
    else findings.push(ok('NASCIMENTO', 'Data de nascimento'));

    const reg = flag(a, 'REGISTRO_VALIDO');
    findings.push(
      reg === true
        ? ok('REGISTRO', 'Nº de registro')
        : reg === false
          ? fail('REGISTRO', 'Nº de registro', 'Dígitos verificadores inválidos')
          : warn('REGISTRO', 'Nº de registro', 'Não lido'),
    );

    const valid = flag(a, 'CNH_VIGENTE');
    findings.push(
      valid === true
        ? ok('VALIDADE', 'Validade da CNH')
        : valid === false
          ? fail('VALIDADE', 'Validade da CNH', 'Vencida')
          : warn('VALIDADE', 'Validade da CNH', 'Não lida'),
    );

    // Exigência da atividade remunerada: sem EAR na CNH o motorista não pode trabalhar com o app.
    findings.push(
      f.hasEar === true
        ? ok('EAR', 'Exerce atividade remunerada (EAR)')
        : warn('EAR', 'Exerce atividade remunerada (EAR)', 'Observação não encontrada'),
    );

    const cat = str(f.category);
    if (!ctx.vehicle)
      findings.push(warn('CATEGORIA', 'Categoria', 'Sem veículo cadastrado para conferir'));
    else if (!cat) findings.push(warn('CATEGORIA', 'Categoria', 'Não lida'));
    else if (!categoryAllows(cat, ctx.vehicle.type))
      findings.push(
        fail(
          'CATEGORIA',
          'Categoria',
          `${cat} não permite ${ctx.vehicle.type === 'MOTO' ? 'moto' : 'carro'}`,
        ),
      );
    else findings.push(ok('CATEGORIA', 'Categoria'));
  } else {
    const plate = str(f.plate);
    if (!plate) findings.push(warn('PLACA', 'Placa', 'Não lida'));
    else if (!ctx.vehicle) findings.push(warn('PLACA', 'Placa', 'Sem veículo cadastrado'));
    else if (plate !== ctx.vehicle.plate)
      findings.push(fail('PLACA', 'Placa', 'Diferente do veículo cadastrado'));
    else findings.push(ok('PLACA', 'Placa'));

    const ren = flag(a, 'RENAVAM_VALIDO');
    findings.push(
      ren === true
        ? ok('RENAVAM', 'RENAVAM')
        : ren === false
          ? fail('RENAVAM', 'RENAVAM', 'Dígito verificador inválido')
          : warn('RENAVAM', 'RENAVAM', 'Não lido'),
    );

    const yearModel = typeof f.yearModel === 'number' ? f.yearModel : null;
    const yearMade = typeof f.yearManufacture === 'number' ? f.yearManufacture : null;
    if (yearModel === null && yearMade === null)
      findings.push(warn('ANO', 'Ano do veículo', 'Não lido'));
    else if (!ctx.vehicle) findings.push(warn('ANO', 'Ano do veículo', 'Sem veículo cadastrado'));
    else if (ctx.vehicle.year !== yearModel && ctx.vehicle.year !== yearMade)
      findings.push(warn('ANO', 'Ano do veículo', 'Diferente do cadastro'));
    else findings.push(ok('ANO', 'Ano do veículo'));

    const lic = flag(a, 'CRLV_EM_DIA');
    findings.push(
      lic === true
        ? ok('LICENCIAMENTO', 'Licenciamento em dia')
        : lic === false
          ? fail('LICENCIAMENTO', 'Licenciamento em dia', 'Exercício antigo')
          : warn('LICENCIAMENTO', 'Licenciamento em dia', 'Exercício não lido'),
    );

    // Dono diferente é comum (veículo da família, financiado, da associação): só pede olhar humano.
    const owner = str(f.ownerCpf)?.replace(/\D/g, '');
    findings.push(
      !owner
        ? warn('PROPRIETARIO', 'Proprietário', 'CPF do proprietário não lido ou é CNPJ')
        : owner === ctx.profile.cpf
          ? ok('PROPRIETARIO', 'Proprietário')
          : warn('PROPRIETARIO', 'Proprietário', 'Veículo em nome de outra pessoa'),
    );
  }

  findings.push(...governmentFindings(a));
  const recommendation: Recommendation = findings.every((x) => x.level === 'OK')
    ? 'APROVAR'
    : 'REVISAR';
  return { recommendation, findings };
}
