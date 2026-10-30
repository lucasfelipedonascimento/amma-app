import { Module } from '@nestjs/common';
import { createRouteProvider, ROUTE_PROVIDER } from '../routing/route-provider';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../common/redis.service';
import { DispatchController } from '../dispatch/dispatch.controller';
import { DispatchScheduler } from '../dispatch/dispatch.scheduler';
import { DispatchService } from '../dispatch/dispatch.service';
import { DispatchSettingsService } from '../dispatch/dispatch-settings.service';
import { DriverService } from '../driver/driver.service';
import { LedgerService } from '../ledger/ledger.service';
import { PositionStore } from '../presence/position-store';
import { PresenceService } from '../presence/presence.service';
import { PricingService } from '../pricing/pricing.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RealtimeService } from '../realtime/realtime.service';
import { AdminOpsController } from './admin-ops.controller';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DriverOpsController } from './driver-ops.controller';

/** Entregas, despacho, presença do motorista, tempo real e ledger (Etapa 4). */
@Module({
  exports: [PositionStore],
  controllers: [DeliveryController, DriverOpsController, AdminOpsController, DispatchController],
  providers: [
    RedisService,
    PositionStore,
    PresenceService,
    RealtimeService,
    RealtimeGateway,
    PricingService,
    LedgerService,
    DispatchSettingsService,
    DispatchService,
    DispatchScheduler,
    DeliveryService,
    DriverService,
    {
      provide: ROUTE_PROVIDER,
      inject: [ConfigService],
      useFactory: createRouteProvider,
    },
  ],
})
export class DeliveryModule {}
