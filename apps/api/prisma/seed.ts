// Dados de EXEMPLO para desenvolvimento (telefones e CPFs fictícios). Idempotente: pode rodar várias vezes.
// Uso: pnpm --filter @amma/api db:seed   (login: peça o código OTP; em modo simulado ele aparece na resposta)
import { PrismaClient, type ApprovalStatus, type DocumentType, type Role } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const prisma = new PrismaClient();
const uploadDir = resolve(process.env.UPLOAD_DIR ?? './uploads');
// PNG 1x1 mínimo, só para os documentos de exemplo existirem em disco.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function user(phone: string, name: string, roles: Role[]) {
  const u = await prisma.user.upsert({
    where: { phone },
    update: { name, roles },
    create: { phone, name, roles, quotaAccount: { create: {} } },
  });
  await prisma.consent.deleteMany({ where: { userId: u.id } });
  await prisma.consent.create({
    data: { userId: u.id, type: 'POLITICA_PRIVACIDADE', version: '0.1-placeholder' },
  });
  return u;
}

async function driver(
  phone: string,
  name: string,
  cpf: string,
  plate: string,
  docs: [DocumentType, ApprovalStatus, string?][],
) {
  const u = await user(phone, name, ['MOTORISTA']);
  await prisma.driverProfile.upsert({
    where: { userId: u.id },
    update: {},
    create: { userId: u.id, fullName: name, cpf, birthDate: new Date('1990-05-20T00:00:00Z') },
  });
  const v = await prisma.vehicle.upsert({
    where: { userId_plate: { userId: u.id, plate } },
    update: {},
    create: { userId: u.id, type: 'MOTO', plate, model: 'Honda CG 160', year: 2022 },
  });
  await prisma.document.deleteMany({ where: { userId: u.id } });
  mkdirSync(uploadDir, { recursive: true });
  for (const [type, status, reason] of docs) {
    const storageKey = `seed-${u.id}-${type}.png`;
    writeFileSync(join(uploadDir, storageKey), PNG);
    await prisma.document.create({
      data: {
        userId: u.id,
        type,
        status,
        rejectionReason: reason,
        storageKey,
        mimeType: 'image/png',
        sizeBytes: PNG.length,
        vehicleId: type === 'DOCUMENTO_VEICULO' ? v.id : undefined,
      },
    });
  }
}

// Tabela de preço de EXEMPLO (valores inventados só para desenvolvimento). Os reais são
// definidos pela associação em POST /admin/pricing.
async function pricing() {
  await prisma.pricingConfigVersion.upsert({
    where: { version: 'dev-exemplo' },
    update: {},
    create: {
      version: 'dev-exemplo',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      baseCents: 300,
      perKmCents: 150,
      perMinuteCents: 30,
      minimumFareCents: 700,
    },
  });
}

async function main() {
  await pricing();
  await user('+5583999990001', 'Admin Exemplo', ['ADMIN']);
  await user('+5583999990002', 'Passageira Exemplo', ['PASSAGEIRO']);
  await user('+5583999990006', 'Comerciante Exemplo', ['COMERCIANTE']);
  await driver('+5583999990003', 'Motorista Aprovado', '52998224725', 'ABC1D23', [
    ['CNH', 'APROVADO'],
    ['DOCUMENTO_VEICULO', 'APROVADO'],
    ['FOTO', 'APROVADO'],
  ]);
  await driver('+5583999990004', 'Motorista Pendente', '11144477735', 'DEF4567', [
    ['CNH', 'PENDENTE'],
    ['FOTO', 'PENDENTE'],
  ]);
  await driver('+5583999990005', 'Motorista Reprovado', '12345678909', 'GHI8J90', [
    ['CNH', 'REPROVADO', 'Foto da CNH ilegível'],
    ['DOCUMENTO_VEICULO', 'APROVADO'],
    ['FOTO', 'APROVADO'],
  ]);
  console.log(
    'Seed concluído. Telefones: admin ...0001, passageira ...0002, aprovado ...0003, pendente ...0004, reprovado ...0005, comerciante ...0006',
  );
}

main().finally(() => prisma.$disconnect());
