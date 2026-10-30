import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ReaderAnalysis, VerifiableDocument } from '@amma/shared';
import { DOCUMENT_READER, DocumentReaderUnavailableError } from '../src/verification/reader';
import { TestApp } from './helpers';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

/** Leitor falso: devolve o que o teste mandar, sem rede nem Python. */
class FakeReader {
  next: ReaderAnalysis | Error = {
    kind: 'UNKNOWN',
    engine: 'none',
    readable: false,
    fields: {},
    checks: [],
    government: [],
  };
  calls: VerifiableDocument[] = [];
  async analyze(_file: Buffer, expected: VerifiableDocument) {
    this.calls.push(expected);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

const gov = (provider = 'serpro', status = 'CONFIRMADO') =>
  [{ scope: 'CNH', provider, status }] as ReaderAnalysis['government'];

describe('leitura automática de documentos', () => {
  let t: TestApp;
  const reader = new FakeReader();
  beforeAll(async () => {
    process.env.DOC_AUTO_APPROVE = 'true';
    t = await TestApp.start((b) => b.overrideProvider(DOCUMENT_READER).useValue(reader));
  });
  afterAll(async () => {
    delete process.env.DOC_AUTO_APPROVE;
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    reader.calls = [];
  });

  const upload = (token: string, type: string, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.set('type', type);
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    form.set('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'x.png');
    return fetch(`${t.baseUrl}/driver/documents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  };
  const waitVerification = async (documentId: string) => {
    for (let i = 0; i < 60; i++) {
      const v = await t.prisma.documentVerification.findUnique({ where: { documentId } });
      if (v) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('verificação não gravada');
  };

  /** Motorista com cadastro conhecido (CPF, nome, nascimento) e sem documentos. */
  const newDriver = async () => {
    const d = await t.driver('João', { approved: false });
    await t.prisma.document.deleteMany({ where: { userId: d.id } });
    await t.prisma.driverProfile.update({
      where: { userId: d.id },
      data: {
        cpf: '52998224725',
        fullName: 'João da Silva Santos',
        birthDate: new Date('1990-02-01T00:00:00Z'),
      },
    });
    return d;
  };
  const cnhOk = (over: Partial<ReaderAnalysis> = {}): ReaderAnalysis => ({
    kind: 'CNH',
    engine: 'text-layer',
    readable: true,
    fields: {
      name: 'JOAO DA SILVA SANTOS',
      cpf: '52998224725',
      birthDate: '1990-02-01',
      registration: '02650306461',
      category: 'AB',
      validUntil: '2035-05-10',
      hasEar: true,
    },
    checks: [
      { code: 'CPF_VALIDO', ok: true },
      { code: 'REGISTRO_VALIDO', ok: true },
      { code: 'CNH_VIGENTE', ok: true },
    ],
    government: gov(),
    ...over,
  });

  it('CNH conferida em base real e igual ao cadastro: aprova sozinho e mascara os dados', async () => {
    const d = await newDriver();
    reader.next = cnhOk();
    const res = await upload(d.token, 'CNH');
    expect(res.status).toBe(201);
    const doc = await res.json();
    const v = await waitVerification(doc.id);
    expect(v.recommendation).toBe('APROVAR');
    expect(v.autoApproved).toBe(true);
    expect((await t.prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe(
      'APROVADO',
    );
    // LGPD: nada de CPF ou registro inteiros no que foi guardado.
    const stored = JSON.stringify(v.extracted);
    expect(stored).not.toContain('52998224725');
    expect(stored).not.toContain('02650306461');
    expect(v.extracted).toMatchObject({ cpf: '***.982.247-**', registration: '***6461' });
  });

  it('CPF da CNH diferente do cadastro: fica PENDENTE com falha explicada, nunca reprova sozinho', async () => {
    const d = await newDriver();
    reader.next = cnhOk({ fields: { ...cnhOk().fields, cpf: '11144477735' } });
    const doc = await (await upload(d.token, 'CNH')).json();
    const v = await waitVerification(doc.id);
    expect(v.recommendation).toBe('REVISAR');
    expect(v.autoApproved).toBe(false);
    expect(v.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CPF', level: 'FALHA' })]),
    );
    expect((await t.prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe(
      'PENDENTE',
    );
  });

  it('base oficial simulada ou indisponível nunca aprova sozinho', async () => {
    for (const g of [gov('sandbox'), gov('serpro', 'INDISPONIVEL')]) {
      await t.reset(); // CPF é único: cada volta começa com o banco limpo
      const d = await newDriver();
      reader.next = cnhOk({ government: g });
      const doc = await (await upload(d.token, 'CNH')).json();
      const v = await waitVerification(doc.id);
      expect(v.recommendation).toBe('REVISAR');
      expect(v.autoApproved).toBe(false);
    }
  });

  it('leitor fora do ar: o envio funciona e o documento segue para análise manual', async () => {
    const d = await newDriver();
    reader.next = new DocumentReaderUnavailableError('fora do ar');
    const res = await upload(d.token, 'CNH');
    expect(res.status).toBe(201);
    const v = await waitVerification((await res.json()).id);
    expect(v.status).toBe('INDISPONIVEL');
    expect(v.recommendation).toBeNull();
    expect(
      (await t.prisma.document.findUniqueOrThrow({ where: { id: v.documentId } })).status,
    ).toBe('PENDENTE');
  });

  it('foto do rosto não passa pelo leitor', async () => {
    const d = await newDriver();
    const res = await upload(d.token, 'FOTO');
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(reader.calls).toEqual([]);
    expect(await t.prisma.documentVerification.count()).toBe(0);
  });

  it('um envio novo não é sobrescrito pela aprovação de um envio antigo', async () => {
    const d = await newDriver();
    reader.next = cnhOk();
    const old = await t.prisma.document.create({
      data: {
        userId: d.id,
        type: 'CNH',
        storageKey: 'a',
        mimeType: 'image/png',
        sizeBytes: 1,
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await t.prisma.document.create({
      data: { userId: d.id, type: 'CNH', storageKey: 'b', mimeType: 'image/png', sizeBytes: 1 },
    });
    const admin = await t.admin();
    const r = await t.post(`/admin/documents/${old.id}/verify`, admin.token, {});
    expect(r.status).toBe(200);
    expect(r.body.autoApproved).toBe(false);
    expect((await t.prisma.document.findUniqueOrThrow({ where: { id: old.id } })).status).toBe(
      'PENDENTE',
    );
  });

  it('painel vê a leitura na lista e pode refazê-la; só admin', async () => {
    const d = await newDriver();
    reader.next = cnhOk({ government: gov('serpro', 'INDISPONIVEL') });
    const doc = await (await upload(d.token, 'CNH')).json();
    await waitVerification(doc.id);
    const admin = await t.admin();
    const list = await t.get('/admin/documents', admin.token);
    expect(list.body[0].verification.recommendation).toBe('REVISAR');
    expect(list.body[0].verification).not.toHaveProperty('documentId');

    reader.next = cnhOk();
    const again = await t.post(`/admin/documents/${doc.id}/verify`, admin.token, {});
    expect(again.body.recommendation).toBe('APROVAR');
    expect((await t.post(`/admin/documents/${doc.id}/verify`, d.token, {})).status).toBe(403);
  });
});
