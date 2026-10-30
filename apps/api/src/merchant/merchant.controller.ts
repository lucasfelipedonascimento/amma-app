import { Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { MerchantDto, ReportQuery } from './dto';
import { MerchantService } from './merchant.service';

/** Cadastro do estabelecimento e relatório do comerciante. Os pedidos usam `POST /deliveries`. */
@Controller('merchant')
@UseGuards(AuthGuard, RolesGuard)
@Roles('COMERCIANTE')
export class MerchantController {
  constructor(private readonly merchants: MerchantService) {}

  @Get()
  get(@Req() req: { user: AuthUser }) {
    return this.merchants.get(req.user.id);
  }

  @Put()
  save(@Req() req: { user: AuthUser }, @Body() dto: MerchantDto) {
    return this.merchants.save(req.user.id, dto);
  }

  @Get('report')
  report(@Req() req: { user: AuthUser }, @Query() q: ReportQuery) {
    return this.merchants.report(req.user.id, q.days);
  }
}
