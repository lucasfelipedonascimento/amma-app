import { CHECKIN_MAX_MINUTES } from '@amma/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/**
 * Fecha, sem benefício, os check-ins que passaram do tempo máximo. Feito na hora de ler/entrar,
 * então não precisa de rotina: o fechamento fica registrado no instante em que o prazo acabou.
 */
export async function closeExpiredCheckIns(db: PrismaService | Prisma.TransactionClient) {
  await db.$executeRaw`
    UPDATE "CheckIn"
    SET "endedAt" = "startedAt" + make_interval(mins => ${CHECKIN_MAX_MINUTES}::int)
    WHERE "endedAt" IS NULL
      AND "startedAt" < now() - make_interval(mins => ${CHECKIN_MAX_MINUTES}::int)`;
}
