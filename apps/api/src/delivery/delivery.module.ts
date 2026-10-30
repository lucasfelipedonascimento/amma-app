import { Module } from '@nestjs/common';
import { createPushSender, PUSH_SENDER, PushService } from '../push/push.service';
import { DriverAppService } from './driver-app.service';
import { createRouteProvider, ROUTE_PROVIDER } from '../routing/route-provider';
import { ConfigService } from '@nestjs/config';
import { DispatchController } from '../dispatch/dispatch.controller';
import { DispatchScheduler } from '../dispatch/dispatch.scheduler';
import { DispatchService } from '../dispatch/dispatch.service';
import { DispatchSettingsService } from '../dispatch/dispatch-settings.service';
import { DriverService } from '../driver/driver.service';
import { LedgerService } from '../ledger/ledger.service';
import { MunicipalRulesService } from '../municipal/municipal-rules.service';
import { PAYMENT_PROVIDER, createPaymentProvider } from '../payments/payment-provider';
import { PaymentsController } from '../payments/payments.controller';
import { PaymentsService } from '../payments/payments.service';
import { PositionStore } from '../presence/position-store';
import { PresenceService } from '../presence/presence.service';
import { PricingService } from '../pricing/pricing.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { RealtimeService } from '../realtime/realtime.service';
import { RidesController } from '../rides/rides.controller';
import { RidesService } from '../rides/rides.service';
import { RatingsService } from '../safety/ratings.service';
import {
  AdminSafetyController,
  SafetyController,
  ShareController,
} from '../safety/safety.controller';
import { SafetyService } from '../safety/safety.service';
import { StorageService } from '../common/storage.service';
import { AdminOpsController } from './admin-ops.controller';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DriverOpsController } from './driver-ops.controller';
import { SimulatorController } from './simulator.controller';

/** Entregas, corridas de passageiro, despacho, presença do motorista, tempo real, ledger e segurança (Etapas 4 a 7). */
@Module({
  exports: [PositionStore],
  controllers: [
    DeliveryController,
    DriverOpsController,
    AdminOpsController,
    SimulatorController,
    DispatchController,
    PaymentsController,
    RidesController,
    SafetyController,
    ShareController,
    AdminSafetyController,
  ],
  providers: [
    PositionStore,
    PresenceService,
    RealtimeService,
    RealtimeGateway,
    PricingService,
    LedgerService,
    MunicipalRulesService,
    RatingsService,
    SafetyService,
    RidesService,
    StorageService,
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
