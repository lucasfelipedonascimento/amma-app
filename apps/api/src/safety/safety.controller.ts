import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import {
  EMERGENCY_STATUSES,
  REPORT_STATUSES,
  type EmergencyStatus,
  type ReportStatus,
} from '@amma/shared';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import {
  EmergencyDto,
  EmergencyUpdateDto,
  GenderVerificationDto,
  MunicipalRulesDto,
  ReportDto,
  ReportUpdateDto,
} from '../delivery/dto';
import { MunicipalRulesService } from '../municipal/municipal-rules.service';
import { SAFETY_PAGE } from './share-page';
import { SafetyService } from './safety.service';

type Req_ = { user: AuthUser };

class AlertQuery {
  @IsOptional() @IsIn(EMERGENCY_STATUSES) status?: EmergencyStatus;
}
class ReportQuery {
  @IsOptional() @IsIn(REPORT_STATUSES) status?: ReportStatus;
}

/** Emergência e denúncia: qualquer pessoa logada (passageiro, motorista, comerciante). */
@Controller('safety')
@UseGuards(AuthGuard)
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Post('emergency')
  @HttpCode(200)
  emergency(@Req() req: Req_, @Body() dto: EmergencyDto) {
    return this.safety.emergency(req.user, dto);
  }

  @Post('reports')
  report(@Req() req: Req_, @Body() dto: ReportDto) {
    return this.safety.report(req.user, dto);
  }

  @Get('reports')
  myReports(@Req() req: Req_) {
    return this.safety.myReports(req.user.id);
  }
}

/** Página pública do contato que recebeu o link da viagem. Sem login: o segredo é o token do link. */
@Controller('share')
export class ShareController {
  constructor(private readonly safety: SafetyService) {}

  @Get(':token')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
  )
  page() {
    // A página é igual para todos; os dados vêm de /data (que valida o token).
    return SAFETY_PAGE;
  }

  @Get(':token/data')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  data(@Param('token') token: string) {
    return this.safety.publicShare(token);
  }
}

/** Painel da associação: emergências, denúncias, registro da viagem, verificação e regras municipais. */
@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminSafetyController {
  constructor(
    private readonly safety: SafetyService,
    private readonly municipal: MunicipalRulesService,
  ) {}

  @Get('safety/alerts')
  alerts(@Query() q: AlertQuery) {
    return this.safety.listAlerts(q.status);
  }

  @Patch('safety/alerts/:id')
  updateAlert(
    @Req() req: Req_,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmergencyUpdateDto,
  ) {
    return this.safety.updateAlert(id, req.user.id, dto);
  }

  @Get('safety/reports')
  reports(@Query() q: ReportQuery) {
    return this.safety.adminReports(q.status);
  }

  @Patch('safety/reports/:id')
  updateReport(
    @Req() req: Req_,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportUpdateDto,
  ) {
    return this.safety.updateReport(id, req.user.id, dto);
  }

  /** Abre o registro da viagem. Cada abertura é gravada com o nome de quem abriu. */
  @Get('rides/:id/trip-record')
  record(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.safety.adminRecord(req.user.id, id);
  }

  @Post('drivers/:id/gender-verification')
  @HttpCode(200)
  verifyGender(
    @Req() req: Req_,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenderVerificationDto,
  ) {
    return this.safety.verifyGender(id, req.user.id, dto.verified);
  }

  @Get('municipal-rules')
  rulesHistory() {
    return this.municipal.list();
  }

  @Get('municipal-rules/current')
  rulesCurrent() {
    return this.municipal.current();
  }

  @Post('municipal-rules')
  publishRules(@Req() req: Req_, @Body() dto: MunicipalRulesDto) {
    return this.municipal.publish(
      { ...dto, effectiveFrom: new Date(dto.effectiveFrom) },
      req.user.id,
    );
  }
}
