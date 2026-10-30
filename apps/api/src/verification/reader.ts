import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReaderAnalysis, VerifiableDocument } from '@amma/shared';

/** Leitor fora do ar, lento ou com resposta que não faz sentido. O documento segue para análise manual. */
export class DocumentReaderUnavailableError extends Error {}

/**
 * Leitor de documentos (serviço Python em `services/doc-reader`): extrai os campos da CNH/CRLV e confere
 * dígitos e bases oficiais. A API só o chama por dentro da rede privada, com token.
 */
export interface DocumentReader {
  analyze(file: Buffer, expected: VerifiableDocument): Promise<ReaderAnalysis>;
}

export const DOCUMENT_READER = Symbol('DOCUMENT_READER');

const KINDS = ['CNH', 'CRLV', 'UNKNOWN'];
const GOV = ['CONFIRMADO', 'DIVERGENTE', 'NAO_ENCONTRADO', 'INDISPONIVEL', 'NAO_CONSULTADO'];

/** A resposta vem de outro serviço: confere o formato antes de confiar em qualquer campo. */
export function parseAnalysis(body: unknown): ReaderAnalysis {
  const b = body as Partial<ReaderAnalysis> | null;
  const valid =
    !!b &&
    typeof b === 'object' &&
    KINDS.includes(b.kind as string) &&
    typeof b.readable === 'boolean' &&
    typeof b.engine === 'string' &&
    typeof b.fields === 'object' &&
    b.fields !== null &&
    Array.isArray(b.checks) &&
    b.checks.every(
      (c) => typeof c?.code === 'string' && (c.ok === null || typeof c.ok === 'boolean'),
    ) &&
    Array.isArray(b.government) &&
    b.government.every(
      (g) =>
        typeof g?.scope === 'string' && typeof g?.provider === 'string' && GOV.includes(g.status),
    );
  if (!valid) throw new DocumentReaderUnavailableError('Resposta do leitor em formato inesperado');
  return b as ReaderAnalysis;
}

export class HttpDocumentReader implements DocumentReader {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async analyze(file: Buffer, expected: VerifiableDocument): Promise<ReaderAnalysis> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)]), 'documento');
    form.append('expected', expected);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/analyze`, {
        method: 'POST',
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new DocumentReaderUnavailableError('Leitor de documentos inacessível');
    }
    if (!res.ok) throw new DocumentReaderUnavailableError(`Leitor respondeu ${res.status}`);
    return parseAnalysis(await res.json().catch(() => null));
  }
}

/** `DOC_READER_MODE=off` (padrão): sem leitura automática, tudo vai direto para o painel. */
export function createDocumentReader(config: ConfigService): DocumentReader | null {
  const mode = config.get<string>('DOC_READER_MODE') ?? 'off';
  if (mode === 'off') return null;
  if (mode !== 'http') throw new Error(`DOC_READER_MODE inválido: ${mode} (off | http)`);
  const url = config.get<string>('DOC_READER_URL');
  if (!url) throw new Error('DOC_READER_URL é obrigatório com DOC_READER_MODE=http');
  const token = config.get<string>('DOC_READER_TOKEN') ?? '';
  if (!token) new Logger('DocReader').warn('DOC_READER_TOKEN vazio: chamando o leitor sem token');
  return new HttpDocumentReader(url.replace(/\/+$/, ''), token);
}
