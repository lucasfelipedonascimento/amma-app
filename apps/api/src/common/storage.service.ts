import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Armazenamento de documentos. Em desenvolvimento grava em disco (UPLOAD_DIR).
 * Em produção troque por um bucket privado (S3 etc.) mantendo esta interface.
 */
@Injectable()
export class StorageService {
  private readonly dir: string;

  constructor(config: ConfigService) {
    this.dir = resolve(config.get<string>('UPLOAD_DIR') ?? './uploads');
  }

  async save(data: Buffer, extension: string): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const key = `${randomUUID()}.${extension}`; // nome gerado: nunca usa o nome enviado pelo cliente
    await writeFile(join(this.dir, key), data, { mode: 0o600 });
    return key;
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  private path(key: string): string {
    // Defesa contra path traversal: a chave deve ser só um nome de arquivo.
    if (key !== key.replace(/[\\/]/g, '') || key.includes('..')) throw new Error('Chave inválida');
    return join(this.dir, key);
  }
}
