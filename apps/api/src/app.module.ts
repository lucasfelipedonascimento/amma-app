import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { AdminController } from './admin/admin.controller';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { DeliveryModule } from './delivery/delivery.module';
import { DriverController } from './driver/driver.controller';
import { DriverService } from './driver/driver.service';
import { LegalController } from './legal/legal.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    AuthModule,
    DeliveryModule,
  ],
  controllers: [
    AppController,
    AccountController,
    DriverController,
    AdminController,
    LegalController,
  ],
  providers: [AccountService, DriverService],
})
export class AppModule {}
