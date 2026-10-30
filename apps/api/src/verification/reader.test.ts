import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentReaderUnavailableError,
  HttpDocumentReader,
  createDocumentReader,
  parseAnalysis,
} from './reader';
import { maskExtracted } from './verification.service';

const good = {
  kind: 'CNH',
  engine: 'text-layer',
  readable: true,
  fields: { cpf: '52998224725' },
  checks: [{ code: 'CPF_VALIDO', ok: true }],
  government: [{ scope: 'CPF', provider: 'x', status: 'CONFIRMADO' }],
};

describe('parseAnalysis', () => {
  it('aceita o formato do leitor', () => {
    expect(parseAnalysis(good)).toEqual(good);
  });
  it.each([
    null,
    'texto',
    { ...good, kind: 'RG' },
    { ...good, readable: 'sim' },
    { ...good, fields: null },
    { ...good, checks: [{ code: 1, ok: true }] },
    { ...good, government: [{ scope: 'CPF', provider: 'x', status: 'TALVEZ' }] },
  ])('recusa resposta fora do formato: %j', (body) => {
    expect(() => parseAnalysis(body)).toThrow(DocumentReaderUnavailableError);
  });
});

describe('HttpDocumentReader', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reader = new HttpDocumentReader('http://leitor:8001', 'tok');

  it('envia token e tipo esperado e devolve a análise', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(good)));
    vi.stubGlobal('fetch', fetchMock);
    expect((await reader.analyze(Buffer.from('x'), 'CNH')).kind).toBe('CNH');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://leitor:8001/v1/analyze');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect((init.body as FormData).get('expected')).toBe('CNH');
  });
  it('rede fora, erro HTTP e JSON quebrado viram "indisponível"', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(reader.analyze(Buffer.from('x'), 'CNH')).rejects.toThrow(
      DocumentReaderUnavailableError,
    );
    vi.stubGlobal('fetch', async () => new Response('erro', { status: 500 }));
    await expect(reader.analyze(Buffer.from('x'), 'CNH')).rejects.toThrow(/500/);
    vi.stubGlobal('fetch', async () => new Response('não é json'));
    await expect(reader.analyze(Buffer.from('x'), 'CNH')).rejects.toThrow(
      DocumentReaderUnavailableError,
    );
  });
});

describe('createDocumentReader', () => {
  const cfg = (o: Record<string, string>) => new ConfigService(o);
  it('desligado por padrão', () => {
    expect(createDocumentReader(cfg({}))).toBeNull();
  });
  it('http exige URL; modo desconhecido falha no boot', () => {
    expect(() => createDocumentReader(cfg({ DOC_READER_MODE: 'http' }))).toThrow(/DOC_READER_URL/);
    expect(() => createDocumentReader(cfg({ DOC_READER_MODE: 'ocr' }))).toThrow(/inválido/);
    expect(
      createDocumentReader(cfg({ DOC_READER_MODE: 'http', DOC_READER_URL: 'http://l:1/' })),
    ).toBeInstanceOf(HttpDocumentReader);
  });
});

describe('maskExtracted', () => {
  it('guarda só dados parciais de CPF, registro e RENAVAM', () => {
    const cnh = maskExtracted({
      ...good,
      fields: { name: 'A B', cpf: '52998224725', registration: '02650306461', hasEar: true },
    } as never);
    expect(JSON.stringify(cnh)).not.toMatch(/52998224725|02650306461/);
    const crlv = maskExtracted({
      ...good,
      kind: 'CRLV',
      fields: {
        plate: 'BRA2E15',
        renavam: '00639364375',
        ownerCpf: '52998224725',
        chassis: '9BWZZZ377VT004251',
      },
    } as never);
    expect(JSON.stringify(crlv)).not.toMatch(/00639364375|52998224725|9BWZZZ377VT004251/);
    expect(crlv).toMatchObject({ plate: 'BRA2E15', renavam: '***4375' });
  });
});
