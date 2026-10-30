// SÓ PARA DESENVOLVIMENTO: aprova os documentos de um motorista pelo telefone, no lugar do painel admin
// (que ainda não existe). Em produção a revisão é feita por um ADMIN via POST /admin/documents/:id/review.
// Uso: pnpm --filter @amma/api db:approve "(83) 99999-1234"
import { normalizeBrazilPhone } from '@amma/shared';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Não use em produção');
  const phone = normalizeBrazilPhone(process.argv[2] ?? '');
  if (!phone) throw new Error('Informe um celular válido. Ex.: "(83) 99999-1234"');
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) throw new Error(`Nenhum usuário com o telefone ${phone}`);
  const r = await prisma.document.updateMany({
    where: { userId: user.id, status: { not: 'APROVADO' } },
    data: { status: 'APROVADO', rejectionReason: null, reviewedAt: new Date() },
  });
  const types = await prisma.document.findMany({
    where: { userId: user.id },
    select: { type: true },
  });
  console.log(
    `${r.count} documento(s) aprovado(s) para ${phone}. Tipos enviados: ${[...new Set(types.map((t) => t.type))].join(', ') || 'nenhum'}.`,
  );
  const missing = ['CNH', 'DOCUMENTO_VEICULO', 'FOTO'].filter(
    (t) => !types.some((x) => x.type === t),
  );
  if (missing.length) console.log(`Ainda faltam (envie pelo app): ${missing.join(', ')}`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
