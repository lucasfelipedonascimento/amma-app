import { ConflictException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma.service';

type FakeUser = { id: string; email: string; passwordHash: string; [k: string]: unknown };

// Prisma e JWT falsos em memória: testamos só a regra do serviço.
function setup() {
  const users: FakeUser[] = [];
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        users.find((u) => u.email === where.email) ?? null,
      create: async ({ data }: { data: Omit<FakeUser, 'id'> }) => {
        const u = { id: `u${users.length + 1}`, ...data } as FakeUser;
        users.push(u);
        return u;
      },
    },
  };
  const jwt = { signAsync: async (p: { sub: string }) => `token-for-${p.sub}` };
  return {
    users,
    service: new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService),
  };
}

const dto = {
  email: ' Ana@Example.com ',
  password: 'senha-forte-1',
  name: 'Ana',
  roles: ['WORKER' as const],
};

describe('AuthService', () => {
  it('cadastra com e-mail normalizado, senha com hash e conta de cotas', async () => {
    const { service, users } = setup();
    const res = await service.register(dto);
    expect(res.accessToken).toBe('token-for-u1');
    expect(res.user.email).toBe('ana@example.com');
    expect(users[0].passwordHash).not.toBe(dto.password);
    expect(await bcrypt.compare(dto.password, users[0].passwordHash)).toBe(true);
    expect(users[0].quotaAccount).toEqual({ create: {} });
    expect(res.user).not.toHaveProperty('passwordHash');
  });

  it('rejeita e-mail duplicado', async () => {
    const { service } = setup();
    await service.register(dto);
    await expect(service.register(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('faz login com senha correta e rejeita a errada', async () => {
    const { service } = setup();
    await service.register(dto);
    expect(
      (await service.login({ email: 'ANA@example.com', password: dto.password })).accessToken,
    ).toBe('token-for-u1');
    await expect(
      service.login({ email: 'ana@example.com', password: 'errada' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login({ email: 'x@y.com', password: 'qualquer' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
