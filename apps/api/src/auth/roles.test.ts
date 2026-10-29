import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { RolesGuard } from './roles';

const ctx = (user: unknown) =>
  ({
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;
const guard = (required?: string[]) =>
  new RolesGuard({ getAllAndOverride: () => required } as unknown as Reflector);

describe('RolesGuard', () => {
  it('libera quando não há @Roles', () =>
    expect(guard(undefined).canActivate(ctx({ roles: [] }))).toBe(true));
  it('libera quem tem o papel', () =>
    expect(guard(['MOTORISTA']).canActivate(ctx({ roles: ['PASSAGEIRO', 'MOTORISTA'] }))).toBe(
      true,
    ));
  it('libera se tiver qualquer um dos papéis exigidos', () =>
    expect(guard(['ADMIN', 'MOTORISTA']).canActivate(ctx({ roles: ['MOTORISTA'] }))).toBe(true));
  it('nega quem não tem o papel', () =>
    expect(() => guard(['ADMIN']).canActivate(ctx({ roles: ['MOTORISTA'] }))).toThrow(
      ForbiddenException,
    ));
  it('nega quando não há usuário na requisição', () =>
    expect(() => guard(['ADMIN']).canActivate(ctx(undefined))).toThrow(ForbiddenException));
});
