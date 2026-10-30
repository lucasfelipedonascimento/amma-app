import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerService } from '../ledger/ledger.service';
import { AssemblyService } from './assembly.service';
import { AssociationController, AdminAssociationController } from './association.controller';
import { PartnerWebhookController } from './partner-webhook.controller';
import { AssociationScheduler } from './association.scheduler';
import { AssociationService } from './association.service';
import { GroupPurchaseService } from './group-purchase.service';
import { InsuranceService } from './insurance.service';
import { MembersService } from './members.service';
import { PURCHASE_PARTNER, createPurchasePartner } from './partner';
import { PurchaseRulesService } from './purchase-rules.service';
import { SurplusService } from './surplus.service';

/** Etapa 8: cotas e nível, assembleia, compra coletiva, seguro mútuo e sobras anuais. */
@Module({
  controllers: [AssociationController, AdminAssociationController, PartnerWebhookController],
  exports: [MembersService, AssemblyService, GroupPurchaseService],
  providers: [
    LedgerService,
    MembersService,
    PurchaseRulesService,
    AssociationService,
    AssemblyService,
    GroupPurchaseService,
    InsuranceService,
    SurplusService,
    AssociationScheduler,
    { provide: PURCHASE_PARTNER, inject: [ConfigService], useFactory: createPurchasePartner },
  ],
})
export class AssociationModule {}
