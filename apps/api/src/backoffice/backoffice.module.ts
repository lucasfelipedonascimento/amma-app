import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AssociationModule } from '../association/association.module';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';
import {
  BackofficeController,
  MyBlockController,
  PanelMeController,
  PanelReadController,
} from './backoffice.controller';
import { BlocksService } from './blocks.service';
import { BudgetService } from './budget.service';
import { DirectoryService } from './directory.service';
import { MetricsService } from './metrics.service';
import { PanelAccessService, PanelGuard } from './panel.guard';

/** Etapa 10: painel admin — bloqueios com recurso, trilha de auditoria, orçamento aberto e métricas. */
@Module({
  imports: [AssociationModule],
  controllers: [PanelMeController, PanelReadController, MyBlockController, BackofficeController],
  providers: [
    AuditService,
    BlocksService,
    BudgetService,
    DirectoryService,
    MetricsService,
    PanelAccessService,
    PanelGuard,
    // Global: vale para toda rota /admin/*, de qualquer módulo.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class BackofficeModule {}
