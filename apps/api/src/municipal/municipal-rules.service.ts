import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  DEFAULT_MUNICIPAL_RULES,
  DEFAULT_RULES_WARNING,
  evaluateRideEligibility,
  validateMunicipalRules,
  type DocumentInfo,
  type Eligibility,
  type MunicipalRules,
  type RideVehicleType,
} from '@amma/shared';
import { PrismaService } from '../prisma.service';

export interface Rulebook {
  version: string;
  rules: MunicipalRules;
  /** true = padrão do código, não publicado pela associação. */
  isDefault: boolean;
  legalReference: string | null;
  warning: string | null;
}

/**
 * Regras municipais do transporte de passageiros, lidas do banco (versionadas). Sem versão publicada
 * vale o padrão do `shared`, sempre marcado como NÃO confirmado.
 */
@Injectable()
export class MunicipalRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async current(at = new Date()): Promise<Rulebook> {
    const row = await this.prisma.municipalRulesVersion.findFirst({
      where: { effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row)
      return {
        version: 'padrao-nao-confirmado',
        rules: DEFAULT_MUNICIPAL_RULES,
        isDefault: true,
        legalReference: null,
        warning: DEFAULT_RULES_WARNING,
      };
    return {
      version: row.version,
      rules: row.rules as unknown as MunicipalRules,
      isDefault: false,
      legalReference: row.legalReference,
      warning: null,
    };
  }

  list() {
    return this.prisma.municipalRulesVersion.findMany({ orderBy: { effectiveFrom: 'desc' } });
  }

  /** Nova versão: validada, e só com vigência posterior à última (o passado não se reescreve). */
  async publish(
    input: { version: string; effectiveFrom: Date; rules: unknown; legalReference?: string },
    adminId: string,
  ) {
    const rules = input.rules as MunicipalRules;
    const problems = validateMunicipalRules(rules);
    if (problems.length > 0)
      throw new BadRequestException({ message: 'Regras inválidas', problems });
    const latest = await this.prisma.municipalRulesVersion.findFirst({
      orderBy: { effectiveFrom: 'desc' },
    });
    if (latest && input.effectiveFrom <= latest.effectiveFrom)
      throw new ConflictException('effectiveFrom deve ser posterior ao da última versão');
    try {
      return await this.prisma.municipalRulesVersion.create({
        data: {
          version: input.version,
          effectiveFrom: input.effectiveFrom,
          rules: rules as unknown as object,
          legalReference: input.legalReference?.trim() || null,
          createdById: adminId,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new ConflictException('Já existe uma versão com este identificador');
      throw e;
    }
  }

  /**
   * Veículos do motorista que podem receber corrida do tipo pedido, com a avaliação de cada um.
   * `documents` do veículo = os do motorista que não são de outro veículo.
   */
  async evaluateDriver(
    driverIds: string[],
    rules: MunicipalRules,
    now = new Date(),
  ): Promise<
    Map<string, { vehicleId: string; type: RideVehicleType; eligibility: Eligibility }[]>
  > {
    const out = new Map<
      string,
      { vehicleId: string; type: RideVehicleType; eligibility: Eligibility }[]
    >();
    if (driverIds.length === 0) return out;
    const [vehicles, docs, profiles] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: { userId: { in: driverIds } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.document.findMany({
        where: { userId: { in: driverIds } },
        select: { userId: true, vehicleId: true, type: true, status: true, createdAt: true },
      }),
      this.prisma.driverProfile.findMany({
        where: { userId: { in: driverIds } },
        select: { userId: true, birthDate: true },
      }),
    ]);
    const birth = new Map(profiles.map((p) => [p.userId, p.birthDate.toISOString().slice(0, 10)]));
    for (const v of vehicles) {
      const b = birth.get(v.userId);
      if (!b) continue;
      const documents: DocumentInfo[] = docs
        // Documento do veículo vale só se for DESTE veículo; os demais tipos são do motorista.
        .filter(
          (d) => d.userId === v.userId && (d.type !== 'DOCUMENTO_VEICULO' || d.vehicleId === v.id),
        )
        .map((d) => ({ type: d.type, status: d.status, createdAt: d.createdAt.toISOString() }));
      const eligibility = evaluateRideEligibility(
        rules,
        { vehicle: { type: v.type, year: v.year }, documents, birthDate: b },
        now,
      );
      const list = out.get(v.userId) ?? [];
      list.push({ vehicleId: v.id, type: v.type, eligibility });
      out.set(v.userId, list);
    }
    return out;
  }
}
