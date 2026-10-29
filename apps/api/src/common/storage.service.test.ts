import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { afterAll, describe, expect, it } from 'vitest';
import { StorageService } from './storage.service';

describe('StorageService', () => {
  let dir = '';
  afterAll(() => rm(dir, { recursive: true, force: true }));
  const make = async () => {
    dir = await mkdtemp(join(tmpdir(), 'amma-'));
    return new StorageService({ get: () => dir } as unknown as ConfigService);
  };

  it('salva, lê e remove', async () => {
    const s = await make();
    const key = await s.save(Buffer.from('abc'), 'pdf');
    expect(key).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect((await s.read(key)).toString()).toBe('abc');
    await s.remove(key);
    await expect(s.read(key)).rejects.toThrow();
  });
  it('bloqueia path traversal', async () => {
    const s = await make();
    await expect(s.read('../../etc/passwd')).rejects.toThrow('Chave inválida');
    await expect(s.remove('a/b')).rejects.toThrow('Chave inválida');
  });
});
