import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { PanelRole } from '@amma/shared';
import { AllowBlocked, AuthGuard, AuthUser } from '../auth/auth.guard';
import { Reauth } from '../auth/reauth';
import { Roles, RolesGuard } from '../auth/roles';
import { AssemblyService } from '../association/assembly.service';
import { GroupPurchaseService } from '../association/group-purchase.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from './audit.service';
import { BlocksService } from './blocks.service';
import { BudgetService } from './budget.service';
import {
  AppealDecisionDto,
  AppealDto,
  AuditQueryDto,
  BlockListQuery,
  BudgetEntryDto,
  MerchantReviewDto,
  OverviewQuery,
  ProposalFilterQuery,
  ReasonDto,
  StatusQuery,
  UserSearchQuery,
  YearQuery,
} from './dto';
import { DirectoryService } from './directory.service';
import { MetricsService } from './metrics.service';
import { PanelAccess, PanelAccessService, PanelGuard } from './panel.guard';

type Req_ = { user: AuthUser; panelRoles?: PanelRole[] };
const uuid = new ParseUUIDPipe();

/** Quem sou eu no painel (qualquer pessoa logada pergunta; só quem tem papel de painel entra). */
@Controller('panel')
export class PanelMeController {
  constructor(
    private readonly access: PanelAccessService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: Req_) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: req.user.id } });
    return { id: u.id, name: u.name, panelRoles: await this.access.rolesOf(req.user) };
  }
}

/**
 * Leitura aberta a sócios (somente leitura) e admins: assembleias e resultados, fila da compra coletiva
 * e orçamento. Reaproveita os mesmos serviços do app; sócio só vê o primeiro nome de outros sócios.
 */
@Controller('panel')
@UseGuards(AuthGuard, PanelGuard)
@PanelAccess('ADMIN', 'SOCIO')
export class PanelReadController {
  constructor(
    private readonly assembly: AssemblyService,
    private readonly groups: GroupPurchaseService,
    private readonly budget: BudgetService,
  ) {}

  @Get('assembly/proposals')
  proposals(@Req() req: Req_, @Query() q: ProposalFilterQuery) {
    return this.assembly.list(req.user.id, q.filter);
  }

  @Get('assembly/proposals/:id')
  proposal(@Req() req: Req_, @Param('id', uuid) id: string) {
    return this.assembly.get(req.user.id, id);
  }

  @Get('purchase-groups')
  groupList(@Req() req: Req_) {
    return this.groups.list(req.user.id);
  }

  @Get('purchase-groups/:id')
  group(@Req() req: Req_, @Param('id', uuid) id: string) {
    return this.groups.detail(req.user.id, id);
  }

  @Get('budget')
  year(@Req() req: Req_, @Query() q: YearQuery) {
    return this.budget.year(
      q.year ?? new Date().getUTCFullYear(),
      !!req.panelRoles?.includes('ADMIN'),
    );
  }
}

/** A própria pessoa bloqueada: ver o motivo e recorrer. Única área que a conta bloqueada ainda usa. */
@Controller('me/block')
@UseGuards(AuthGuard)
@AllowBlocked()
export class MyBlockController {
  constructor(private readonly blocks: BlocksService) {}

  @Get()
  mine(@Req() req: Req_) {
    return this.blocks.mine(req.user.id);
  }

  @Post('appeal')
  @HttpCode(200)
  appeal(@Req() req: Req_, @Body() dto: AppealDto) {
    return this.blocks.appeal(req.user.id, dto.text);
  }
}

/** Painel da associação: tudo que só o ADMIN faz. Toda escrita aqui entra na trilha (AuditInterceptor). */
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class BackofficeController {
  constructor(
    private readonly directory: DirectoryService,
    private readonly blocks: BlocksService,
    private readonly metrics: MetricsService,
    private readonly audit: AuditService,
    private readonly budget: BudgetService,
  ) {}

  @Get('overview')
  overview(@Query() q: OverviewQuery) {
    return this.metrics.overview(q.days ?? 30);
  }

  @Get('drivers')
  drivers(@Query() q: StatusQuery) {
    return this.directory.drivers(q.status, q.q);
  }

  @Get('merchants')
  merchants(@Query() q: StatusQuery) {
    return this.directory.merchants(q.status);
  }

  @Reauth()
  @Post('merchants/:id/review')
  @HttpCode(200)
  reviewMerchant(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: MerchantReviewDto) {
    return this.directory.reviewMerchant(req.user.id, id, dto.status, dto.reason);
  }

  @Get('users')
  users(@Query() q: UserSearchQuery) {
    return this.directory.users(q.q, q.blocked === undefined ? undefined : q.blocked === 'true');
  }

  @Reauth()
  @Post('users/:id/block')
  block(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.blocks.block(req.user.id, id, dto.reason);
  }

  @Get('blocks')
  blockList(@Query() q: BlockListQuery) {
    return this.blocks.list(q.status, q.userId);
  }

  @Reauth()
  @Post('blocks/:id/revoke')
  @HttpCode(200)
  revoke(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.blocks.revoke(req.user.id, id, dto.reason);
  }

  @Reauth()
  @Post('blocks/:id/appeal-decision')
  @HttpCode(200)
  decideAppeal(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: AppealDecisionDto) {
    return this.blocks.decideAppeal(req.user.id, id, dto.decision, dto.reason);
  }

  @Get('audit')
  auditList(@Query() q: AuditQueryDto) {
    return this.audit.list({
      actorId: q.actorId,
      action: q.action,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      before: q.before,
      limit: q.limit ?? 50,
    });
  }

  @Get('audit/actions')
  auditActions() {
    return this.audit.actions();
  }

  @Reauth()
  @Post('budget/entries')
  createEntry(@Req() req: Req_, @Body() dto: BudgetEntryDto) {
    return this.budget.create(req.user.id, dto);
  }

  @Reauth()
  @Post('budget/entries/:id/reverse')
  @HttpCode(200)
  reverseEntry(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: ReasonDto) {
    return this.budget.reverse(req.user.id, id, dto.reason);
  }
}
