import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AuthGuard, AuthUser } from '../auth/auth.guard';
import { Reauth } from '../auth/reauth';
import { Roles, RolesGuard } from '../auth/roles';
import { StorageService } from '../common/storage.service';
import { PrismaService } from '../prisma.service';

class ReviewDto {
  @IsIn(['APROVADO', 'REPROVADO']) status!: 'APROVADO' | 'REPROVADO';
  @IsOptional() @IsString() reason?: string;
}

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get('documents')
  list(@Query('status') status: string = 'PENDENTE') {
    if (!['PENDENTE', 'APROVADO', 'REPROVADO'].includes(status))
      throw new BadRequestException('status inválido');
    return this.prisma.document.findMany({
      where: { status: status as 'PENDENTE' | 'APROVADO' | 'REPROVADO' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
        userId: true,
        vehicleId: true,
        user: { select: { name: true, phone: true } },
      },
    });
  }

  // Documento pessoal: sempre baixado (nunca aberto na página), isolado e sem cache.
  @Get('documents/:id/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Disposition', 'attachment; filename="documento"')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  async file(@Param('id', ParseUUIDPipe) id: string) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException();
    return new StreamableFile(await this.storage.read(doc.storageKey), { type: doc.mimeType });
  }

  @Reauth()
  @Post('documents/:id/review')
  @HttpCode(200)
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
    @Req() req: { user: AuthUser },
  ) {
    if (dto.status === 'REPROVADO' && !dto.reason?.trim())
      throw new BadRequestException('Informe o motivo da reprovação');
    const updated = await this.prisma.document.updateMany({
      where: { id },
      data: {
        status: dto.status,
        rejectionReason: dto.status === 'REPROVADO' ? dto.reason!.trim() : null,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
    });
    if (updated.count === 0) throw new NotFoundException();
    return { id, status: dto.status };
  }
}
