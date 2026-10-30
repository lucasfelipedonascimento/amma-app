import { Module } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';
import { CheckInService } from './checkin.service';
import { ModerationService } from './moderation.service';
import { PointsService } from './points.service';
import { AdminWelcomeController, WelcomeController } from './welcome.controller';

/** Etapa 9: pontos de acolhida (mapa, check-in, avaliação dos dois lados, casa parceira e denúncias). */
@Module({
  controllers: [WelcomeController, AdminWelcomeController],
  providers: [LedgerService, PointsService, CheckInService, ModerationService],
})
export class WelcomeModule {}
