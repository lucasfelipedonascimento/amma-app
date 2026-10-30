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
  opts: { vehicle?: 'MOTO' | 'CARRO'; woman?: boolean } = {},
) {
  const u = await user(phone, name, ['MOTORISTA']);
  await prisma.driverProfile.upsert({
    where: { userId: u.id },
    update: {},
    create: {
      userId: u.id,
      fullName: name,
      cpf,
      birthDate: new Date('1990-05-20T00:00:00Z'),
      // Exemplo da opção "motorista mulher": autodeclarada e já conferida.
      ...(opts.woman ? { gender: 'FEMININO' as const, genderVerifiedAt: new Date() } : {}),
    },
  });
  const v = await prisma.vehicle.upsert({
    where: { userId_plate: { userId: u.id, plate } },
    update: {},
    create: {
      userId: u.id,
      type: opts.vehicle ?? 'MOTO',
      plate,
      model: opts.vehicle === 'CARRO' ? 'Chevrolet Onix' : 'Honda CG 160',
      year: 2022,
    },
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

// Tabelas de EXEMPLO das corridas de passageiro (uma por tipo de veículo). Os valores reais são da associação.
async function ridePricing() {
  for (const [profile, base, perKm, perMinute, minimum] of [
    ['CORRIDA_CARRO', 400, 180, 35, 900],
    ['CORRIDA_MOTO', 250, 120, 25, 600],
  ] as const)
    await prisma.pricingConfigVersion.upsert({
      where: { version: `dev-${profile.toLowerCase()}` },
      update: {},
      create: {
        version: `dev-${profile.toLowerCase()}`,
        profile,
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        baseCents: base,
        perKmCents: perKm,
        perMinuteCents: perMinute,
        minimumFareCents: minimum,
      },
    });
}

// Associação (Etapa 8), só para ver as telas: dois sócios com cotas, um grupo de compra e uma proposta aberta.
// Os dados reais (cotas) nascem das corridas; aqui as cotas entram direto no ledger, uma vez só.
async function association() {
  for (const [phone, quotas] of [
    ['+5583999990003', 12],
    ['+5583999990007', 35],
  ] as const) {
    const u = await prisma.user.findUniqueOrThrow({ where: { phone } });
    const reference = `seed-cotas-${u.id}`;
    if (await prisma.ledgerTransaction.findFirst({ where: { kind: 'RIDE_SETTLEMENT', reference } }))
      continue;
    await prisma.ledgerTransaction.create({
      data: {
        kind: 'RIDE_SETTLEMENT',
        reference,
        postings: {
          create: [
            { account: 'PARTNER_RECEIVABLE', direction: 'DEBIT', amountCents: quotas * 500 },
            { account: `WORKER_QUOTAS:${u.id}`, direction: 'CREDIT', amountCents: quotas * 500 },
          ],
        },
      },
    });
  }
  const admin = await prisma.user.findUniqueOrThrow({ where: { phone: '+5583999990001' } });
  if (!(await prisma.purchaseGroup.findFirst({ where: { name: 'Motos 2027 (exemplo)' } })))
    await prisma.purchaseGroup.create({
      data: {
        name: 'Motos 2027 (exemplo)',
        description: 'Grupo de exemplo. O valor e as regras reais são da associação e do parceiro.',
        vehicleType: 'MOTO',
        targetCents: 20_000_00,
        createdById: admin.id,
      },
    });
  if (!(await prisma.proposal.findFirst({ where: { title: 'Proposta de exemplo' } }))) {
    const opensAt = new Date();
    await prisma.proposal.create({
      data: {
        kind: 'GERAL',
        title: 'Proposta de exemplo',
        description: 'Votação de exemplo para testar o app. Cada sócio tem um voto.',
        opensAt,
        closesAt: new Date(opensAt.getTime() + 7 * 86_400_000),
        eligibleCount: 2,
        createdById: admin.id,
      },
    });
  }
}

/** Pontos de acolhida de exemplo em João Pessoa (o id fixo deixa repetir o seed sem duplicar). */
async function welcomePoints() {
  const merchant = await prisma.user.findUniqueOrThrow({ where: { phone: '+5583999990006' } });
  const passenger = await prisma.user.findUniqueOrThrow({ where: { phone: '+5583999990002' } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { phone: '+5583999990001' } });
  const always = { always: true, slots: [] };
  const weekdays = {
    always: false,
    slots: [{ days: [1, 2, 3, 4, 5, 6], open: '07:00', close: '19:00' }],
  };
  const checklist = {
    RESPONSAVEL_MAIOR: true,
    AREA_SEPARADA: true,
    BANHEIRO_ACESSIVEL: true,
    ENTRADA_ILUMINADA: true,
    SEM_COBRANCA: true,
    CODIGO_DE_CONDUTA: true,
  };
  const points = [
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      ownerId: admin.id,
      type: 'ESPACO_PUBLICO' as const,
      status: 'ATIVO' as const,
      name: 'Praça de Tambaú',
      address: 'Av. Almirante Tamandaré, Tambaú',
      neighborhood: 'Tambaú',
      lat: -7.1183,
      lng: -34.8236,
      hours: always,
      amenities: ['AGUA' as const, 'BANHEIRO' as const, 'DESCANSO' as const],
      capacity: 20,
    },
    {
      id: '00000000-0000-4000-8000-0000000000a2',
      ownerId: merchant.id,
      type: 'COMERCIO' as const,
      status: 'ATIVO' as const,
      name: 'Padaria Boa Hora',
      address: 'Rua Rodrigues de Aquino, 120',
      neighborhood: 'Centro',
      lat: -7.1195,
      lng: -34.8814,
      hours: weekdays,
      amenities: [
        'AGUA' as const,
        'BANHEIRO' as const,
        'CARREGADOR' as const,
        'ALIMENTACAO' as const,
      ],
      capacity: 6,
    },
    {
      id: '00000000-0000-4000-8000-0000000000a3',
      ownerId: passenger.id,
      type: 'CASA_PARCEIRA' as const,
      status: 'ATIVO' as const,
      name: 'Casa da Dona Maria',
      address: 'Rua das Acácias, 45',
      neighborhood: 'Manaíra',
      lat: -7.0996,
      lng: -34.8338,
      hours: weekdays,
      amenities: ['AGUA' as const, 'BANHEIRO' as const, 'CARREGADOR' as const, 'DESCANSO' as const],
      capacity: 3,
      checklist,
    },
    {
      id: '00000000-0000-4000-8000-0000000000a4',
      ownerId: passenger.id,
      type: 'CASA_PARCEIRA' as const,
      status: 'EM_ANALISE' as const,
      name: 'Casa do Seu João (em análise)',
      address: 'Rua dos Coqueiros, 12',
      neighborhood: 'Bessa',
      lat: -7.0722,
      lng: -34.8269,
      hours: always,
      amenities: ['AGUA' as const, 'BANHEIRO' as const],
      capacity: 2,
      checklist,
    },
  ];
  for (const p of points) {
    await prisma.welcomePoint.upsert({
      where: { id: p.id },
      update: {},
      create: {
        ...p,
        events: { create: { actorId: p.ownerId, toStatus: p.status, note: 'Exemplo do seed' } },
      },
    });
  }
}

async function main() {
  await pricing();
  await ridePricing();
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
  // Motorista de carro (corrida de passageiro) e mulher verificada. As regras municipais NÃO são
  // semeadas: vale o padrão não confirmado (carro liberado, mototáxi desligado) até o admin publicar.
  await driver(
    '+5583999990007',
    'Motorista Carro',
    '39053344705',
    'JKL2M34',
    [
      ['CNH', 'APROVADO'],
      ['DOCUMENTO_VEICULO', 'APROVADO'],
      ['FOTO', 'APROVADO'],
    ],
    { vehicle: 'CARRO', woman: true },
  );
  await association();
  await welcomePoints();
  console.log(
    'Seed concluído. Telefones: admin ...0001, passageira ...0002, aprovado (moto) ...0003, pendente ...0004, reprovado ...0005, comerciante ...0006, motorista de carro (mulher verificada) ...0007. Sócios de exemplo (com cotas): ...0003 e ...0007. Pontos de acolhida de exemplo: praça, padaria, casa aprovada e casa em análise (da passageira ...0002)',
  );
}

main().finally(() => prisma.$disconnect());
