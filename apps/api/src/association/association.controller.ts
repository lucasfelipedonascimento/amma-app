import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { MAX_UPLOAD_BYTES } from '../driver/driver.service';
import { AssemblyService } from './assembly.service';
import { AssociationService } from './association.service';
import {
  ClaimDecisionDto,
  ClaimListQuery,
  ContributionDto,
  CreateClaimDto,
  CreateGroupDto,
  CreateProposalDto,
  ProposalListQuery,
  SurplusCloseDto,
  SurplusSimulateDto,
  VoteDto,
} from './dto';
import { GroupPurchaseService } from './group-purchase.service';
import { InsuranceService } from './insurance.service';
import { PurchaseRulesService } from './purchase-rules.service';
import { SurplusService } from './surplus.service';

type Req_ = { user: AuthUser };

/** Área do sócio (motorista/entregador): resumo, assembleia, compra coletiva, seguro e sobras. */
@Controller()
@UseGuards(AuthGuard, RolesGuard)
@Roles('MOTORISTA')
export class AssociationController {
  constructor(
    private readonly association: AssociationService,
    private readonly assembly: AssemblyService,
    private readonly groups: GroupPurchaseService,
    private readonly insurance: InsuranceService,
    private readonly surplus: SurplusService,
  ) {}

  @Get('association/me')
  me(@Req() req: Req_) {
    return this.association.me(req.user.id);
  }

  @Get('association/surplus')
  mySurplus(@Req() req: Req_) {
    return this.surplus.mine(req.user.id);
  }

  // ---------------------------------------------------------------- assembleia

  @Get('assembly/proposals')
  proposals(@Req() req: Req_, @Query() q: ProposalListQuery) {
    return this.assembly.list(req.user.id, q.filter);
  }

  @Get('assembly/proposals/:id')
  proposal(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.assembly.get(req.user.id, id);
  }

  @Put('assembly/proposals/:id/vote')
  vote(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoteDto) {
    return this.assembly.vote(req.user.id, id, dto.choice);
  }

  @Get('assembly/proposals/:id/my-votes')
  myVotes(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.assembly.myHistory(req.user.id, id);
  }

  // ---------------------------------------------------------------- compra coletiva

  @Get('purchase-groups')
  groupList(@Req() req: Req_) {
    return this.groups.list(req.user.id);
  }

  @Get('purchase-groups/:id')
  group(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.detail(req.user.id, id);
  }

  @Post('purchase-groups/:id/join')
  @HttpCode(200)
  join(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.join(req.user.id, id);
  }

  @Post('purchase-groups/:id/leave')
  @HttpCode(200)
  leave(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.leave(req.user.id, id);
  }

  @Post('purchase-groups/:id/contributions')
  contribute(
    @Req() req: Req_,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ContributionDto,
  ) {
    return this.groups.contribute(req.user.id, id, dto);
  }

  @Get('purchase-groups/:id/contributions')
  contributions(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.myContributions(req.user.id, id);
  }

  // ---------------------------------------------------------------- seguro mútuo

  @Post('insurance/claims')
  createClaim(@Req() req: Req_, @Body() dto: CreateClaimDto) {
    return this.insurance.create(req.user.id, dto);
  }

  @Get('insurance/claims')
  claims(@Req() req: Req_) {
    return this.insurance.listMine(req.user.id);
  }

  @Get('insurance/claims/:id')
  claim(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.insurance.getMine(req.user.id, id);
  }

  @Post('insurance/claims/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  attach(
    @Req() req: Req_,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.insurance.attach(req.user.id, id, file);
  }

  @Get('insurance/claims/:id/attachments/:attachmentId')
  @Header('Cache-Control', 'private, no-store')
  async attachment(
    @Req() req: Req_,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    const f = await this.insurance.attachmentFile(req.user.id, id, attachmentId);
    return new StreamableFile(f.data, { type: f.mimeType });
  }

  @Post('insurance/claims/:id/cancel')
  @HttpCode(200)
  cancelClaim(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.insurance.cancel(req.user.id, id);
  }
}

/** Administração da associação (por API; ainda não há painel web). */
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminAssociationController {
  constructor(
    private readonly assembly: AssemblyService,
    private readonly groups: GroupPurchaseService,
    private readonly insurance: InsuranceService,
    private readonly surplus: SurplusService,
    private readonly rules: PurchaseRulesService,
  ) {}

  @Post('assembly/proposals')
  createProposal(@Req() req: Req_, @Body() dto: CreateProposalDto) {
    return this.assembly.createProposal(req.user.id, dto);
  }

  @Get('assembly/proposals')
  proposals(@Req() req: Req_, @Query() q: ProposalListQuery) {
    return this.assembly.list(req.user.id, q.filter);
  }

  @Get('purchase-rules')
  purchaseRules() {
    return this.rules.history();
  }

  @Post('purchase-groups')
  createGroup(@Req() req: Req_, @Body() dto: CreateGroupDto) {
    return this.groups.createGroup(req.user.id, dto);
  }

  @Post('purchase-groups/:id/award')
  @HttpCode(200)
  award(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.groups.award(req.user.id, id);
  }

  @Post('purchase-groups/:id/close')
  @HttpCode(200)
  closeGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.groups.closeGroup(id);
  }

  @Get('insurance/claims')
  claims(@Query() q: ClaimListQuery) {
    return this.insurance.listAll(q.status);
  }

  @Get('insurance/claims/:id')
  claim(@Param('id', ParseUUIDPipe) id: string) {
    return this.insurance.getAny(id);
  }

  @Get('insurance/claims/:id/attachments/:attachmentId')
  @Header('Cache-Control', 'private, no-store')
  async attachment(
    @Req() req: Req_,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    const f = await this.insurance.attachmentFile(req.user.id, id, attachmentId, true);
    return new StreamableFile(f.data, { type: f.mimeType });
  }

  @Post('insurance/claims/:id/review')
  @HttpCode(200)
  review(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.insurance.startReview(req.user.id, id);
  }

  @Post('insurance/claims/:id/decision')
  @HttpCode(200)
  decide(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClaimDecisionDto) {
    return this.insurance.decide(req.user.id, id, dto);
  }

  @Post('surplus/simulate')
  @HttpCode(200)
  simulate(@Body() dto: SurplusSimulateDto) {
    return this.surplus.simulate(dto);
  }

  @Post('surplus/close')
  @HttpCode(200)
  closeSurplus(@Req() req: Req_, @Body() dto: SurplusCloseDto) {
    return this.surplus.close(req.user.id, dto);
  }

  @Get('surplus/runs')
  runs() {
    return this.surplus.runs();
  }
}
