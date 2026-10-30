import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { UserRateLimit } from '../common/rate-limit';
import { Roles, RolesGuard } from '../auth/roles';
import { DriverProfileDto, GenderDto, UploadDocumentDto, VehicleDto } from './dto';
import { DriverService, MAX_UPLOAD_BYTES } from './driver.service';

@Controller('driver')
@UseGuards(AuthGuard, RolesGuard)
@Roles('MOTORISTA')
export class DriverController {
  constructor(private readonly driver: DriverService) {}

  @Put('profile')
  saveProfile(@Req() req: { user: AuthUser }, @Body() dto: DriverProfileDto) {
    return this.driver.saveProfile(req.user.id, dto);
  }

  /** Autodeclaração de gênero (para a opção "motorista mulher"); a associação confere depois. */
  @Put('gender')
  setGender(@Req() req: { user: AuthUser }, @Body() dto: GenderDto) {
    return this.driver.setGender(req.user.id, dto.gender);
  }

  @Post('vehicles')
  addVehicle(@Req() req: { user: AuthUser }, @Body() dto: VehicleDto) {
    return this.driver.addVehicle(req.user.id, dto);
  }

  @Get('vehicles')
  vehicles(@Req() req: { user: AuthUser }) {
    return this.driver.listVehicles(req.user.id);
  }

  @UserRateLimit(20, 3600)
  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(
    @Req() req: { user: AuthUser },
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.driver.uploadDocument(req.user.id, dto, file);
  }

  @Get('status')
  status(@Req() req: { user: AuthUser }) {
    return this.driver.status(req.user.id);
  }
}
