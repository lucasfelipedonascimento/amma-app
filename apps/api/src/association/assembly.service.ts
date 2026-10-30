import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  applyRuleChange,
  decideProposal,
  requiredVotes,
  tally,
  validateVotingWindow,
  type VoteChoice,
} from '@amma/shared';
import { Prisma, type Proposal } from '@prisma/client';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../prisma.service';
import { CreateProposalDto } from './dto';
import { MembersService } from './members.service';
import { PurchaseRulesService } from './purchase-rules.service';

/**
 * Assembleia. 1 sócio = 1 voto; o voto pode mudar até o fechamento; o fechamento é feito uma
 * única vez (trava de linha) e depois proposta, votos e histórico não mudam mais (gatilhos no banco).
 * Enquanto a votação está aberta ninguém vê a contagem, para não influenciar quem ainda vai votar.
 */
@Injectable()
export class AssemblyService {
  private readonly logger = new Logger('Assembleia');

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly rules: PurchaseRulesService,
  ) {}

  async createProposal(adminId: string, dto: CreateProposalDto) {
    const opensAt = new Date();
    const closesAt = new Date(dto.closesAt);
    const windowError = validateVotingWindow(opensAt, closesAt);
    if (windowError) throw new BadRequestException(windowError);
    if (dto.kind === 'GERAL' && dto.ruleChange)
      throw new BadRequestException(
        'Só proposta de regra da compra coletiva leva alteração de regra',
      );
    if (dto.kind === 'REGRA_COMPRA_COLETIVA') {
      try {
        applyRuleChange(await this.rules.current(), dto.ruleChange);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }
    const eligibleCount = (await this.members.listMembers()).size;
    const p = await this.prisma.proposal.create({
      data: {
        kind: dto.kind,
        title: dto.title.trim(),
        description: dto.description.trim(),
        ruleChange: (dto.ruleChange as Prisma.InputJsonValue | undefined) ?? undefined,
        quorumPercent: dto.quorumPercent ?? 0,
        eligibleCount,
        opensAt,
        closesAt,
        createdById: adminId,
      },
    });
    return this.view(p, undefined);
  }

  async list(userId: string, filter?: 'abertas' | 'encerradas') {
    await this.closeDue();
    const rows = await this.prisma.proposal.findMany({
      where: filter ? { status: filter === 'abertas' ? 'ABERTA' : { not: 'ABERTA' } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const mine = await this.myVotes(
      userId,
      rows.map((r) => r.id),
    );
    return Promise.all(rows.map((p) => this.view(p, mine.get(p.id))));
  }

  async get(userId: string, id: string) {
    await this.finalizeIfDue(id);
    const p = await this.prisma.proposal.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Proposta não encontrada');
    const mine = await this.myVotes(userId, [id]);
    return this.view(p, mine.get(id));
  }

  /** Vota ou muda o voto. Repetir a mesma escolha não gera nova linha no histórico. */
  async vote(
    userId: string,
    proposalId: string,
    choice: VoteChoice,
    retried = false,
  ): Promise<unknown> {
    await this.finalizeIfDue(proposalId);
    if (!(await this.members.isMember(userId)))
      throw new ForbiddenException('Só sócios (com ao menos 1 cota) podem votar');
    try {
      await this.prisma.$transaction(async (tx) => {
        // Trava a proposta enquanto o voto grava: o fechamento espera este voto terminar, e um
        // fechamento que já aconteceu faz esta consulta não achar nada.
        const open = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Proposal" WHERE id = ${proposalId} AND status = 'ABERTA' AND "closesAt" > now() FOR SHARE`;
        if (open.length === 0) {
          const exists = await tx.proposal.count({ where: { id: proposalId } });
          if (!exists) throw new NotFoundException('Proposta não encontrada');
          throw new ConflictException('A votação desta proposta já foi encerrada');
        }
        const current = await tx.vote.findUnique({
          where: { proposalId_voterId: { proposalId, voterId: userId } },
        });
        if (current?.choice === choice) return;
        if (current)
          await tx.vote.update({
            where: { id: current.id },
            data: { choice, updatedAt: new Date() },
          });
        else await tx.vote.create({ data: { proposalId, voterId: userId, choice } });
        await tx.voteRecord.create({
          data: { proposalId, voterId: userId, choice, action: current ? 'MUDOU' : 'VOTOU' },
        });
      });
    } catch (e) {
      // Dois primeiros votos do mesmo sócio ao mesmo tempo: o segundo vira "mudança".
      if ((e as { code?: string }).code === 'P2002' && !retried)
        return this.vote(userId, proposalId, choice, true);
      throw e;
    }
    return this.get(userId, proposalId);
  }

  /** Histórico do próprio sócio nesta proposta (votos e mudanças). Nunca mostra o de outros. */
  async myHistory(userId: string, proposalId: string) {
    const rows = await this.prisma.voteRecord.findMany({
      where: { proposalId, voterId: userId },
      orderBy: { createdAt: 'asc' },
      select: { choice: true, action: true, createdAt: true },
    });
    return rows;
  }

  /** Fecha todas as propostas vencidas. Chamado pelo agendador e antes de listar. */
  async closeDue(): Promise<number> {
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Proposal" WHERE status = 'ABERTA' AND "closesAt" <= now()`;
    let n = 0;
    for (const { id } of due) if (await this.finalize(id)) n++;
    return n;
  }

  private async finalizeIfDue(id: string) {
    await this.finalize(id);
  }

  /** Apuração. Só uma execução vence (FOR UPDATE + status ABERTA); as demais veem a proposta já fechada. */
  async finalize(id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Proposal" WHERE id = ${id} AND status = 'ABERTA' AND "closesAt" <= now() FOR UPDATE`;
      if (due.length === 0) return false;
      const p = await tx.proposal.findUniqueOrThrow({ where: { id } });
      const votes = await tx.vote.findMany({
        where: { proposalId: id },
        orderBy: { voterId: 'asc' },
      });
      const t = tally(votes.map((v) => v.choice));
      const status = decideProposal(t, p.eligibleCount, p.quorumPercent);
      const ballotDigest = sha256(votes.map((v) => `${v.voterId}:${v.choice}`).join('\n'));
      let appliedRulesVersion: string | null = null;
      if (status === 'APROVADA' && p.kind === 'REGRA_COMPRA_COLETIVA') {
        try {
          const next = applyRuleChange(await this.rules.current(tx), p.ruleChange);
          appliedRulesVersion = (
            await tx.purchaseRulesVersion.create({
              data: { rules: next as unknown as Prisma.InputJsonValue, proposalId: id },
            })
          ).id;
        } catch (e) {
          // A regra ficou inválida depois de outra aprovada antes (ex.: os dois pesos zerados):
          // a proposta fica APROVADA no histórico, mas a regra não é aplicada.
          this.logger.warn(
            `Proposta ${id} aprovada, mas a regra não foi aplicada: ${(e as Error).message}`,
          );
        }
      }
      await tx.proposal.update({
        where: { id },
        data: {
          status,
          closedAt: new Date(),
          yesCount: t.yes,
          noCount: t.no,
          abstainCount: t.abstain,
          ballotDigest,
          appliedRulesVersion,
        },
      });
      return true;
    });
  }

  private async myVotes(userId: string, ids: string[]) {
    const rows = await this.prisma.vote.findMany({
      where: { voterId: userId, proposalId: { in: ids } },
      select: { proposalId: true, choice: true },
    });
    return new Map(rows.map((r) => [r.proposalId, r.choice]));
  }

  private async view(p: Proposal, myVote: VoteChoice | undefined) {
    const closed = p.status !== 'ABERTA';
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      description: p.description,
      ruleChange: p.ruleChange,
      status: p.status,
      opensAt: p.opensAt,
      closesAt: p.closesAt,
      quorumPercent: p.quorumPercent,
      eligibleCount: p.eligibleCount,
      requiredVotes: requiredVotes(p.eligibleCount, p.quorumPercent),
      myVote: myVote ?? null,
      // Contagem só depois do fechamento.
      result: closed
        ? {
            yes: p.yesCount,
            no: p.noCount,
            abstain: p.abstainCount,
            total: (p.yesCount ?? 0) + (p.noCount ?? 0) + (p.abstainCount ?? 0),
            closedAt: p.closedAt,
            ballotDigest: p.ballotDigest,
            appliedRulesVersion: p.appliedRulesVersion,
          }
        : null,
    };
  }
}
