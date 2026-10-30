import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { CreateRideDto, ListDeliveriesQuery, RideQuoteDto, ShareDto } from '../delivery/dto';
import { SafetyService } from '../safety/safety.service';
import { RidesService } from './rides.service';

type Req_ = { user: AuthUser };

/**
 * Corridas de passageiro, do lado de quem pede. Depois de criada, a corrida é um pedido como os outros:
 * `GET /deliveries/:id`, `/cancel`, `/rating` e `/receipt` funcionam com o mesmo id.
 */
@Controller('rides')
@UseGuards(AuthGuard, RolesGuard)
@Roles('PASSAGEIRO')
export class RidesController {
  private readonly baseUrl: string;

  constructor(
    private readonly rides: RidesService,
    private readonly safety: SafetyService,
    config: ConfigService,
  ) {
    this.baseUrl = (config.get<string>('PUBLIC_BASE_URL') ?? 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
  }

  /** Tipos de veículo liberados, avisos ao passageiro e opções (vêm da configuração municipal). */
  @Get('rules')
  rules() {
    return this.rides.rules();
  }

  @Post('quote')
  @HttpCode(200)
  quote(@Body() dto: RideQuoteDto) {
    return this.rides.quote(dto);
  }

  @Post()
  create(@Req() req: Req_, @Body() dto: CreateRideDto) {
    return this.rides.create(req.user, dto);
  }

  @Get()
  list(@Req() req: Req_, @Query() q: ListDeliveriesQuery) {
    return this.rides.list(req.user.id, q.limit);
  }

  // ---------------------------------------------------------------- segurança

  /** Foto do motorista, para conferir quem chegou. Só durante a corrida. */
  @Get(':id/driver-photo')
  @Header('Cache-Control', 'private, no-store')
  async driverPhoto(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    const p = await this.safety.driverPhoto(req.user, id);
    return new StreamableFile(p.data, { type: p.mimeType });
  }

  @Post(':id/shares')
  async share(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ShareDto) {
    const s = await this.safety.createShare(req.user, id, dto.contactLabel);
    return { ...s, url: `${this.baseUrl}/share/${s.token}` };
  }

  @Get(':id/shares')
  shares(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.safety.listShares(req.user, id);
  }

  @Delete(':id/shares/:shareId')
  @HttpCode(204)
  revoke(
    @Req() req: Req_,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
  ) {
    return this.safety.revokeShare(req.user, id, shareId);
  }

  /** Registro da viagem (linha do tempo e trajeto) — dado do próprio passageiro. */
  @Get(':id/record')
  record(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.safety.myRecord(req.user, id);
  }
}
