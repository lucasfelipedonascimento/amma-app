import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { TEST_DB_NAME, adminDatabaseUrl, testDatabaseUrl } from './env';

/** Cria o banco `amma_test` (se faltar) e aplica as migrações, uma vez por execução. */
export default async function setup() {
  const admin = new PrismaClient({ datasourceUrl: adminDatabaseUrl() });
  try {
    const rows = await admin.$queryRaw<
      unknown[]
    >`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB_NAME}`;
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.$disconnect();
  }
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
}
