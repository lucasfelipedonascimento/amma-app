import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthGuard, AuthPayload } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: { auth: AuthPayload }) {
    const { id, email, name, roles, quotaAccount } = await this.prisma.user.findUniqueOrThrow({
      where: { id: req.auth.sub },
      include: { quotaAccount: true },
    });
    return { id, email, name, roles, quotaAccount };
  }
}
