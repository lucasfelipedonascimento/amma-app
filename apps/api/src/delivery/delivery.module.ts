import { Module } from '@nestjs/common';
import { createPushSender, PUSH_SENDER, PushService } from '../push/push.service';
import { DriverAppService } from './driver-app.service';
import { createRouteProvider, ROUTE_PROVIDER } from '../routing/route-provider';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../common/redis.service';
import { DispatchController } from '../dispatch/dispatch.controller';
import { DispatchScheduler } from '../dispatch/dispatch.scheduler';
import { DispatchService } from '../dispatch/dispatch.service';
import { DispatchSettingsService } from '../dispatch/dispatch-settings.service';
import { DriverService } from '../driver/driver.service';
import { LedgerService } from '../ledger/ledger.service';
import { PAYMENT_PROVIDER, createPaymentProvider } from '../payments/payment-provider';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
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
  controllers: [
    DeliveryController,
    DriverOpsController,
    AdminOpsController,
    DispatchController,
    PaymentsController,
  ],
  providers: [
    RedisService,
    PositionStore,
    PresenceService,
    RealtimeService,
    RealtimeGateway,
    PricingService,
    LedgerService,
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: createPaymentProvider,
    },
    DispatchSettingsService,
    DispatchService,
    DispatchScheduler,
    DeliveryService,
    DriverService,
    DriverAppService,
    PushService,
    {
      provide: PUSH_SENDER,
      inject: [ConfigService],
      useFactory: createPushSender,
    },
    {
      provide: ROUTE_PROVIDER,
      inject: [ConfigService],
      useFactory: createRouteProvider,
    },
  ],
})
export class DeliveryModule {}
