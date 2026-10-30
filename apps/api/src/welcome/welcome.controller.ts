import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { UserRateLimit } from '../common/rate-limit';
import { Reauth } from '../auth/reauth';
import { Roles, RolesGuard } from '../auth/roles';
import { MAX_UPLOAD_BYTES } from '../driver/driver.service';
import { CheckInService } from './checkin.service';
import {
  AdminPointListQuery,
  ApprovePointDto,
  CheckInDto,
  CreatePointDto,
  PointListQuery,
  PointNoteDto,
  PointRatingDto,
  PointReportDto,
  PointViewQuery,
  ReportListQuery,
  ResolveReportDto,
  UpdatePointDto,
} from './dto';
import { ModerationService } from './moderation.service';
import { PointsService, type Viewer } from './points.service';

type Req_ = { user: AuthUser };
const viewer = (req: Req_): Viewer => ({
  id: req.user.id,
  isAdmin: req.user.roles.includes('ADMIN'),
});
const uuid = new ParseUUIDPipe();

/**
 * Pontos de acolhida. Qualquer pessoa logada vê o mapa, cadastra pontos e denuncia;
 * check-in e avaliação do ponto são do MOTORISTA; avaliar o visitante é do anfitrião do ponto.
 * As rotas fixas (`check-ins`, `reports`, `mine`) vêm antes das com `:id`.
 */
@Controller('welcome-points')
@UseGuards(AuthGuard, RolesGuard)
export class WelcomeController {
  constructor(
    private readonly points: PointsService,
    private readonly checkIns: CheckInService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('rules')
  rules() {
    return this.points.rules();
  }

  @Get()
  list(@Req() req: Req_, @Query() q: PointListQuery) {
    return this.points.list(viewer(req), q);
  }

  @Get('mine')
  mine(@Req() req: Req_) {
    return this.points.mine(viewer(req));
  }

  @Get('reports/mine')
  myReports(@Req() req: Req_) {
    return this.moderation.mine(viewer(req));
  }

  @Get('check-ins/active')
  @Roles('MOTORISTA')
  active(@Req() req: Req_) {
    return this.checkIns.active(viewer(req));
  }

  @Get('check-ins/mine')
  @Roles('MOTORISTA')
  history(@Req() req: Req_) {
    return this.checkIns.history(viewer(req));
  }

  @Post('check-ins/:checkInId/end')
  @Roles('MOTORISTA')
  @HttpCode(200)
  end(@Req() req: Req_, @Param('checkInId', uuid) id: string) {
    return this.checkIns.end(viewer(req), id);
  }

  @Post('check-ins/:checkInId/rate')
  @Roles('MOTORISTA')
  ratePoint(@Req() req: Req_, @Param('checkInId', uuid) id: string, @Body() dto: PointRatingDto) {
    return this.checkIns.ratePoint(viewer(req), id, dto);
  }

  @Post('check-ins/:checkInId/rate-visitor')
  rateVisitor(@Req() req: Req_, @Param('checkInId', uuid) id: string, @Body() dto: PointRatingDto) {
    return this.checkIns.rateVisitor(viewer(req), id, dto);
  }

  @Post()
  create(@Req() req: Req_, @Body() dto: CreatePointDto) {
    return this.points.create(viewer(req), dto);
  }

  @Get(':id')
  get(@Req() req: Req_, @Param('id', uuid) id: string, @Query() q: PointViewQuery) {
    return this.points.get(viewer(req), id, q);
  }

  @Patch(':id')
  update(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: UpdatePointDto) {
    return this.points.update(viewer(req), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: Req_, @Param('id', uuid) id: string) {
    await this.points.removeOwn(viewer(req), id);
  }

  @UserRateLimit(20, 3600)
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES + 1 } }))
  addPhoto(
    @Req() req: Req_,
    @Param('id', uuid) id: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    return this.points.addPhoto(viewer(req), id, file);
  }

  @Get(':id/photos/:photoId')
  @Header('Cache-Control', 'private, max-age=300')
  async photo(
    @Req() req: Req_,
    @Param('id', uuid) id: string,
    @Param('photoId', uuid) photoId: string,
  ) {
    const f = await this.points.photoFile(viewer(req), id, photoId);
    return new StreamableFile(f.data, { type: f.mimeType });
  }

  @Delete(':id/photos/:photoId')
  @HttpCode(204)
  async removePhoto(
    @Req() req: Req_,
    @Param('id', uuid) id: string,
    @Param('photoId', uuid) photoId: string,
  ) {
    await this.points.removePhoto(viewer(req), id, photoId);
  }

  @Post(':id/check-in')
  @Roles('MOTORISTA')
  checkIn(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: CheckInDto) {
    return this.checkIns.checkIn(viewer(req), id, dto);
  }

  @Get(':id/visits')
  visits(@Req() req: Req_, @Param('id', uuid) id: string) {
    return this.checkIns.visits(viewer(req), id);
  }

  @Post(':id/reports')
  report(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: PointReportDto) {
    return this.moderation.report(viewer(req), id, dto);
  }
}

/** Painel da associação (só por API): aprovar casas, resolver denúncias e remover pontos. */
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminWelcomeController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('welcome-points')
  list(@Query() q: AdminPointListQuery) {
    return this.moderation.listPoints(q.status);
  }

  @Get('welcome-points/:id')
  get(@Param('id', uuid) id: string) {
    return this.moderation.getPoint(id);
  }

  @Reauth()
  @Post('welcome-points/:id/approve')
  @HttpCode(200)
  approve(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: ApprovePointDto) {
    return this.moderation.approve(viewer(req), id, dto);
  }

  @Reauth()
  @Post('welcome-points/:id/refuse')
  @HttpCode(200)
  refuse(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: PointNoteDto) {
    return this.moderation.refuse(viewer(req), id, dto.note.trim());
  }

  @Reauth()
  @Post('welcome-points/:id/remove')
  @HttpCode(200)
  remove(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: PointNoteDto) {
    return this.moderation.remove(viewer(req), id, dto.note.trim());
  }

  @Reauth()
  @Post('welcome-points/:id/reinstate')
  @HttpCode(200)
  reinstate(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: PointNoteDto) {
    return this.moderation.reinstate(viewer(req), id, dto.note.trim());
  }

  @Get('welcome-reports')
  reports(@Query() q: ReportListQuery) {
    return this.moderation.listReports(q.status);
  }

  @Reauth()
  @Post('welcome-reports/:id/resolve')
  @HttpCode(200)
  resolve(@Req() req: Req_, @Param('id', uuid) id: string, @Body() dto: ResolveReportDto) {
    return this.moderation.resolveReport(viewer(req), id, dto);
  }
}
