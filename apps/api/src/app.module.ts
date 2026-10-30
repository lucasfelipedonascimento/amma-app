import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { ExportService } from './account/export.service';
import { AdminController } from './admin/admin.controller';
import { AppController } from './app.controller';
import { AssociationModule } from './association/association.module';
import { AuthModule } from './auth/auth.module';
import { BackofficeModule } from './backoffice/backoffice.module';
import { DeliveryModule } from './delivery/delivery.module';
import { DriverController } from './driver/driver.controller';
import { DriverService } from './driver/driver.service';
import { LegalController } from './legal/legal.controller';
import { MerchantController } from './merchant/merchant.controller';
import { MerchantService } from './merchant/merchant.service';
import { WelcomeModule } from './welcome/welcome.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    AuthModule,
    DeliveryModule,
    AssociationModule,
    WelcomeModule,
    BackofficeModule,
  ],
  controllers: [
    AppController,
    AccountController,
    DriverController,
    AdminController,
    LegalController,
    MerchantController,
  ],
  providers: [AccountService, ExportService, DriverService, MerchantService],
})
export class AppModule {}
