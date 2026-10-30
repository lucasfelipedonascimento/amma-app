import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Roles, RolesGuard } from '../auth/roles';
import { DispatchService } from '../dispatch/dispatch.service';
import { DriverService } from '../driver/driver.service';
import { LedgerService } from '../ledger/ledger.service';
import { PresenceService } from '../presence/presence.service';
import { AssociationRateDto, DeclineDto, LatLngDto } from './dto';
import { DeliveryService, type DriverStep } from './delivery.service';

type Req_ = { user: AuthUser };

/** Rotas do motorista para trabalhar: presença, ofertas, andamento da entrega e carteira. */
@Controller('driver')
@UseGuards(AuthGuard, RolesGuard)
@Roles('MOTORISTA')
export class DriverOpsController {
  constructor(
    private readonly presence: PresenceService,
    private readonly dispatch: DispatchService,
    private readonly deliveries: DeliveryService,
    private readonly ledger: LedgerService,
    private readonly driver: DriverService,
  ) {}

  @Get('presence')
  presenceStatus(@Req() req: Req_) {
    return this.presence.status(req.user.id);
  }

  @Post('presence/online')
  @HttpCode(200)
  online(@Req() req: Req_, @Body() dto: LatLngDto) {
    return this.presence.goOnline(req.user.id, dto);
  }

  @Post('presence/offline')
  @HttpCode(200)
  async offline(@Req() req: Req_) {
    await this.presence.goOffline(req.user.id);
    // Oferta pendente passa ao próximo, sem punição.
    await this.dispatch.dropPendingOffers(req.user.id);
    return this.presence.status(req.user.id);
  }

  @Get('offers/current')
  currentOffer(@Req() req: Req_) {
    return this.dispatch.currentOffer(req.user.id);
  }

  @Post('offers/:id/accept')
  @HttpCode(200)
  async accept(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.dispatch.accept(req.user.id, id);
    return this.deliveries.get(req.user, d.id);
  }

  @Post('offers/:id/decline')
  @HttpCode(204)
  decline(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclineDto) {
    return this.dispatch.decline(req.user.id, id, dto.reason);
  }

  @Get('deliveries/active')
  active(@Req() req: Req_) {
    return this.deliveries.activeFor(req.user.id);
  }

  @Post('deliveries/:id/en-route-pickup')
  @HttpCode(200)
  enRoutePickup(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.step(req, id, 'A_CAMINHO_COLETA');
  }

  @Post('deliveries/:id/picked-up')
  @HttpCode(200)
  pickedUp(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.step(req, id, 'COLETADO');
  }

  @Post('deliveries/:id/en-route-dropoff')
  @HttpCode(200)
  enRouteDropoff(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.step(req, id, 'A_CAMINHO_ENTREGA');
  }

  @Post('deliveries/:id/delivered')
  @HttpCode(200)
  delivered(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.step(req, id, 'ENTREGUE');
  }

  @Post('deliveries/:id/release')
  @HttpCode(204)
  release(@Req() req: Req_, @Param('id', ParseUUIDPipe) id: string) {
    return this.dispatch.release(req.user.id, id);
  }

  @Get('wallet')
  wallet(@Req() req: Req_) {
    return this.ledger.wallet(req.user.id);
  }

  @Put('association-rate')
  associationRate(@Req() req: Req_, @Body() dto: AssociationRateDto) {
    return this.driver.setAssociationRate(req.user.id, dto.rate);
  }

  private step(req: Req_, id: string, to: DriverStep) {
    return this.deliveries.advance(req.user.id, id, to);
  }
}
