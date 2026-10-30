import { INestApplication, ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { Test } from '@nestjs/testing';
import { DEFAULT_MUNICIPAL_RULES, type MunicipalRules } from '@amma/shared';
import { PrismaClient } from '@prisma/client';
import WebSocket from 'ws';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/dispatch/dispatch.service';
import { ReauthService } from '../src/auth/reauth';
import { RedisService } from '../src/common/redis.service';

// Pontos de João Pessoa. 0,001° de latitude ≈ 111 m.
export const PICKUP = { lat: -7.115, lng: -34.861, address: 'Rua da Coleta, 100' };
export const DROPOFF = { lat: -7.095, lng: -34.861, address: 'Rua da Entrega, 200' };
/** Cartão de teste aprovado (token do provedor sandbox). */
export const CARD_OK = { method: 'CARTAO', cardToken: 'sbx_ok_4242_visa' } as const;
export const near = (meters: number) => ({ lat: PICKUP.lat + meters / 111_000, lng: PICKUP.lng });

export interface Res<T = any> {
  status: number;
  body: T;
}

export interface TestUser {
  id: string;
  token: string;
  phone: string;
}

export class TestApp {
  readonly prisma = new PrismaClient();
  private phoneSeq = 0;
  private rulesSeq = 0;
  private quotaSeq = 0;

  private constructor(
    readonly app: INestApplication,
    readonly baseUrl: string,
    readonly wsUrl: string,
  ) {}

  static async start() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as { port: number };
    return new TestApp(app, `http://127.0.0.1:${port}`, `ws://127.0.0.1:${port}/ws`);
  }

  get dispatch() {
    return this.app.get(DispatchService);
  }

  async close() {
    await this.app.close();
    await this.prisma.$disconnect();
  }

  /** Banco e Redis de teste limpos + tabela de preço de teste. */
  async reset() {
    const tables = await this.prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    await this.app.get(RedisService).flushdb();
    // Piso alto de propósito: toda entrega de teste custa exatamente R$ 11,00.
    await this.prisma.pricingConfigVersion.create({
      data: {
        version: 'teste-1',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        baseCents: 300,
        perKmCents: 150,
        perMinuteCents: 30,
        minimumFareCents: 1100,
      },
    });
    // Corridas de passageiro: pisos diferentes por tipo de veículo, para o teste saber qual tabela foi usada.
    for (const [profile, minimumFareCents] of [
      ['CORRIDA_CARRO', 1500],
      ['CORRIDA_MOTO', 1000],
    ] as const)
      await this.prisma.pricingConfigVersion.create({
        data: {
          version: `teste-${profile.toLowerCase()}-1`,
          profile,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          baseCents: 300,
          perKmCents: 150,
          perMinuteCents: 30,
          minimumFareCents,
        },
      });
  }

  /** Publica uma versão das regras municipais já em vigor, sobre o padrão do código. */
  async setRules(patch: {
    car?: Partial<MunicipalRules['car']>;
    moto?: Partial<MunicipalRules['moto']>;
    womenDriverOptionEnabled?: boolean;
  }) {
    const rules: MunicipalRules = {
      ...DEFAULT_MUNICIPAL_RULES,
      womenDriverOptionEnabled:
        patch.womenDriverOptionEnabled ?? DEFAULT_MUNICIPAL_RULES.womenDriverOptionEnabled,
      car: { ...DEFAULT_MUNICIPAL_RULES.car, ...patch.car },
      moto: { ...DEFAULT_MUNICIPAL_RULES.moto, ...patch.moto },
    };
    const n = ++this.rulesSeq;
    await this.prisma.municipalRulesVersion.create({
      data: {
        version: `teste-regras-${n}`,
        effectiveFrom: new Date(Date.now() - 3_600_000 + n),
        rules: rules as unknown as object,
      },
    });
  }

  async req(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  get = (path: string, token?: string) => this.req('GET', path, token);
  post = (path: string, token?: string, body?: unknown) =>
    this.req('POST', path, token, body ?? {});
  request = (method: string, path: string, token?: string) => this.req(method, path, token);
  put = (path: string, token?: string, body?: unknown) => this.req('PUT', path, token, body);
  patch = (path: string, token?: string, body?: unknown) => this.req('PATCH', path, token, body);
  del = (path: string, token?: string) => this.req('DELETE', path, token);

  /** Login real por OTP simulado; depois define os papéis direto no banco. */
  async user(roles: ('PASSAGEIRO' | 'MOTORISTA' | 'COMERCIANTE' | 'ADMIN')[], name = 'Teste') {
    const phone = `+55839999${String(++this.phoneSeq).padStart(5, '0')}`;
    const otp = await this.post('/auth/otp/request', undefined, { phone });
    const session = await this.post('/auth/otp/verify', undefined, {
      phone,
      code: otp.body.devCode,
    });
    const me = await this.get('/me', session.body.accessToken);
    await this.prisma.user.update({ where: { id: me.body.id }, data: { roles, name } });
    return { id: me.body.id as string, token: session.body.accessToken as string, phone };
  }

  client(name = 'Cliente') {
    return this.user(['PASSAGEIRO'], name);
  }

  /** Admin já reautenticado (ações críticas exigem código por SMS recente: veja `reauth`). */
  async admin() {
    const u = await this.user(['ADMIN'], 'Admin');
    await this.reauth(u.id);
    return u;
  }

  /** Admin SEM reautenticação, para testar o bloqueio das ações críticas. */
  adminStale() {
    return this.user(['ADMIN'], 'Admin');
  }

  /** Simula o resultado de POST /auth/reauth/verify. */
  reauth(userId: string) {
    return this.app.get(ReauthService).grant(userId);
  }

  /** Motorista com perfil, veículo e os 3 documentos aprovados. */
  async driver(
    name = 'Motorista',
    opts: {
      approved?: boolean;
      associationRate?: number;
      vehicleType?: 'MOTO' | 'CARRO';
      vehicleYear?: number;
      gender?: 'FEMININO' | 'MASCULINO' | 'NAO_INFORMADO';
      genderVerified?: boolean;
      extraDocuments?: ('ANTECEDENTES' | 'LICENCA_MUNICIPAL' | 'SEGURO_PASSAGEIROS')[];
    } = {},
  ) {
    const u = await this.user(['MOTORISTA'], name);
    const n = this.phoneSeq;
    await this.prisma.driverProfile.create({
      data: {
        userId: u.id,
        fullName: name + ' Silva',
        cpf: String(10000000000 + n),
        birthDate: new Date('1990-01-01T00:00:00Z'),
        associationRate: opts.associationRate ?? 0,
        gender: opts.gender,
        genderVerifiedAt: opts.genderVerified ? new Date() : null,
      },
    });
    const vehicleType = opts.vehicleType ?? 'MOTO';
    const vehicle = await this.prisma.vehicle.create({
      data: {
        userId: u.id,
        type: vehicleType,
        plate: `ABC${1000 + n}`,
        model: vehicleType === 'MOTO' ? 'CG 160' : 'Onix',
        year: opts.vehicleYear ?? 2022,
      },
    });
    const status = opts.approved === false ? 'PENDENTE' : 'APROVADO';
    for (const type of [
      'CNH',
      'DOCUMENTO_VEICULO',
      'FOTO',
      ...(opts.extraDocuments ?? []),
    ] as const)
      await this.prisma.document.create({
        data: {
          userId: u.id,
          type,
          status,
          storageKey: `teste-${u.id}-${type}`,
          mimeType: 'image/png',
          sizeBytes: 1,
          vehicleId: type === 'DOCUMENTO_VEICULO' ? vehicle.id : undefined,
        },
      });
    return { ...u, vehicleId: vehicle.id, plate: `ABC${1000 + n}` };
  }

  /**
   * Dá cotas pelo próprio ledger (taxa de associação creditada na conta de cotas), como uma corrida faria.
   * `at` permite recuar a data (ex.: cotas que o sócio já tinha no fim de um ano passado).
   */
  async giveQuotas(userId: string, quotas: number, at = new Date()) {
    if (quotas <= 0) return;
    const cents = quotas * 500;
    await this.prisma.ledgerTransaction.create({
      data: {
        kind: 'RIDE_SETTLEMENT',
        reference: `teste-cotas-${userId}-${++this.quotaSeq}`,
        createdAt: at,
        postings: {
          create: [
            { account: 'PARTNER_RECEIVABLE', direction: 'DEBIT', amountCents: cents },
            { account: `WORKER_QUOTAS:${userId}`, direction: 'CREDIT', amountCents: cents },
          ],
        },
      },
    });
  }

  /** Sócio: motorista aprovado com `quotas` cotas no ledger. */
  async member(name = 'Sócio', quotas = 5, opts: Parameters<TestApp['driver']>[1] = {}) {
    const d = await this.driver(name, opts);
    await this.giveQuotas(d.id, quotas);
    return d;
  }

  /** Motorista de carro, aprovado, pronto para corridas. */
  carDriver(name = 'Motorista', opts: Parameters<TestApp['driver']>[1] = {}) {
    return this.driver(name, { ...opts, vehicleType: 'CARRO' });
  }

  async online(driver: TestUser, at: { lat: number; lng: number }) {
    const r = await this.post('/driver/presence/online', driver.token, at);
    if (r.status !== 200) throw new Error(`online falhou: ${r.status} ${JSON.stringify(r.body)}`);
  }

  async createDelivery(client: TestUser) {
    const r = await this.post('/deliveries', client.token, {
      pickup: PICKUP,
      dropoff: DROPOFF,
      payment: CARD_OK,
    });
    if (r.status !== 201) throw new Error(`criar falhou: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  rideBody(extra: object = {}) {
    return { pickup: PICKUP, dropoff: DROPOFF, vehicleType: 'CARRO', payment: CARD_OK, ...extra };
  }

  async createRide(client: TestUser, extra: object = {}) {
    const r = await this.post('/rides', client.token, this.rideBody(extra));
    if (r.status !== 201) throw new Error(`corrida falhou: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  /** Cria a corrida, o motorista aceita, embarca com o PIN e conclui. Devolve o id. */
  async runRideToEnd(client: TestUser, driver: TestUser) {
    const ride = await this.createRide(client);
    const offer = await this.currentOffer(driver);
    await this.post(`/driver/offers/${offer.id}/accept`, driver.token);
    await this.post(`/driver/deliveries/${ride.id}/en-route-pickup`, driver.token);
    await this.post(`/driver/deliveries/${ride.id}/picked-up`, driver.token, {
      pin: ride.boardingPin,
    });
    await this.post(`/driver/deliveries/${ride.id}/en-route-dropoff`, driver.token);
    await this.atDropoff(driver);
    await this.post(`/driver/deliveries/${ride.id}/delivered`, driver.token);
    return ride.id as string;
  }

  /** O aparelho do motorista informa a posição no destino (a conclusão exige estar a até 300 m). */
  async atDropoff(driver: TestUser) {
    const r = await this.post('/driver/position', driver.token, {
      lat: DROPOFF.lat,
      lng: DROPOFF.lng,
    });
    if (r.status !== 200 && r.status !== 201)
      throw new Error(`posição falhou: ${r.status} ${JSON.stringify(r.body)}`);
  }

  async currentOffer(driver: TestUser) {
    return (await this.get('/driver/offers/current', driver.token)).body;
  }

  /** Cria o pedido e leva até ENTREGUE com o motorista indicado (que deve ser o escolhido). */
  async runToDelivered(client: TestUser, driver: TestUser) {
    const d = await this.createDelivery(client);
    const offer = await this.currentOffer(driver);
    await this.post(`/driver/offers/${offer.id}/accept`, driver.token);
    for (const step of ['en-route-pickup', 'picked-up', 'en-route-dropoff', 'delivered']) {
      if (step === 'delivered') await this.atDropoff(driver);
      await this.post(`/driver/deliveries/${d.id}/${step}`, driver.token);
    }
    return d.id as string;
  }

  events(deliveryId: string) {
    return this.prisma.deliveryEvent.findMany({
      where: { deliveryId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Faz a oferta pendente de um motorista "vencer" sem esperar o relógio. */
  async expireOffers() {
    await this.prisma.deliveryOffer.updateMany({
      where: { status: 'PENDENTE' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
  }
}

// ---------------------------------------------------------------- WebSocket

export class WsClient {
  private queue: { event: string; data: any }[] = [];
  private waiters: (() => void)[] = [];
  closed: Promise<number>;

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      this.queue.push(JSON.parse(raw.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
    this.closed = new Promise((resolve) => socket.on('close', (code) => resolve(code)));
  }

  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new WsClient(socket);
  }

  send(event: string, data?: unknown) {
    this.socket.send(JSON.stringify({ event, data }));
  }

  /** Próxima mensagem com este evento (descarta as anteriores de outros eventos). */
  async next(event: string, timeoutMs = 3000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.queue.findIndex((m) => m.event === event);
      if (i >= 0) return this.queue.splice(i, 1)[0].data;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Timeout esperando evento "${event}"`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  async authenticate(token: string) {
    this.send('auth', { token });
    return this.next('auth.ok');
  }

  close() {
    this.socket.close();
  }
}
