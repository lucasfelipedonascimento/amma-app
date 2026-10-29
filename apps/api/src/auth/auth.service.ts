import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma.service';
import { LoginDto, RegisterDto } from './dto';

const BCRYPT_COST = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('E-mail já cadastrado');
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        roles: [...new Set(dto.roles)],
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_COST),
        // Todo cadastro começa com conta de cotas zerada (saldo contábil).
        quotaAccount: { create: {} },
      },
    });
    return this.session(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    // Mesma mensagem para e-mail inexistente e senha errada (não revela quais e-mails existem).
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }
    return this.session(user);
  }

  private async session(user: { id: string; email: string; name: string; roles: string[] }) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, roles: user.roles });
    return {
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, roles: user.roles },
    };
  }
}
