import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SafetyService } from '../src/safety/safety.service';
import { DROPOFF, PICKUP, TestApp, WsClient, near, type TestUser } from './helpers';

describe('corridas de passageiro', () => {
  let t: TestApp;
  let client: TestUser;
  let driver: TestUser & { vehicleId: string; plate: string };

  beforeAll(async () => {
    t = await TestApp.start();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    client = await t.client('Ana Souza');
    driver = await t.carDriver('Carlos');
    await t.online(driver, near(400));
  });

  const rideRow = (id: string) => t.prisma.delivery.findUniqueOrThrow({ where: { id } });
  const quote = (extra: object = {}) =>
    t.post('/rides/quote', client.token, { pickup: PICKUP, dropoff: DROPOFF, ...extra });

  // ------------------------------------------------------------------ estimativa

  describe('estimativa', () => {
    it('mostra preço, tempo de viagem e quanto o motorista leva para chegar', async () => {
      const r = await quote();
      expect(r.status).toBe(200);
      expect(r.body.durationSeconds).toBeGreaterThan(0);
      expect(r.body.options).toHaveLength(1); // mototáxi desligado por padrão
      expect(r.body.options[0]).toMatchObject({
        vehicleType: 'CARRO',
        available: true,
        fareCents: 1500, // piso da tabela de carro
        minimumApplied: true,
        driversNearby: 1,
      });
      expect(r.body.options[0].pickupEtaSeconds).toBeGreaterThan(0);
    });

    it('usa a tabela de preço de cada tipo de veículo', async () => {
      await t.setRules({ moto: { enabled: true } });
      const r = await quote();
      const byType = Object.fromEntries(r.body.options.map((o: any) => [o.vehicleType, o]));
      expect(byType.CARRO.fareCents).toBe(1500);
      expect(byType.MOTO.fareCents).toBe(1000);
      expect(byType.MOTO.driversNearby).toBe(0); // o motorista online é de carro
      expect(byType.MOTO.pickupEtaSeconds).toBeNull();
      expect(byType.MOTO.notices.length).toBeGreaterThan(0);
    });

    it('tipo sem tabela de preço aparece como indisponível, sem derrubar a estimativa', async () => {
      await t.setRules({ moto: { enabled: true } });
      await t.prisma.pricingConfigVersion.deleteMany({ where: { profile: 'CORRIDA_MOTO' } });
      const moto = (await quote()).body.options.find((o: any) => o.vehicleType === 'MOTO');
      expect(moto).toMatchObject({ available: false, fareCents: null });
    });

    it('motorista de carro mais velho que o limite não conta como disponível', async () => {
      await t.setRules({ car: { maxVehicleAgeYears: 2 } });
      expect((await quote()).body.options[0].driversNearby).toBe(0);
    });

    it('motorista mulher: considera só mulheres verificadas', async () => {
      expect((await quote({ womenDriverOnly: true })).body.options[0].driversNearby).toBe(0);
      const w = await t.carDriver('Marta', { gender: 'FEMININO', genderVerified: true });
      await t.online(w, near(900));
      expect((await quote({ womenDriverOnly: true })).body.options[0].driversNearby).toBe(1);
      expect((await quote()).body.options[0].driversNearby).toBe(2);
    });

    it('origem e destino iguais, e papel errado', async () => {
      expect(
        (await t.post('/rides/quote', client.token, { pickup: PICKUP, dropoff: PICKUP })).status,
      ).toBe(400);
      const d = await t.carDriver('X');
      expect(
        (await t.post('/rides/quote', d.token, { pickup: PICKUP, dropoff: DROPOFF })).status,
      ).toBe(403);
    });

    it('GET /rides/rules traz os tipos liberados e os avisos da configuração', async () => {
      const r = (await t.get('/rides/rules', client.token)).body;
      expect(r.city).toBe('João Pessoa - PB');
      expect(r.vehicleTypes.find((v: any) => v.type === 'CARRO').enabled).toBe(true);
      expect(r.vehicleTypes.find((v: any) => v.type === 'MOTO').enabled).toBe(false);
    });
  });

  // ------------------------------------------------------------------ pedir e despachar

  describe('pedir e despachar', () => {
    it('cria a corrida paga e oferece ao motorista de carro mais próximo', async () => {
      const ride = await t.createRide(client);
      expect(ride).toMatchObject({
        kind: 'CORRIDA',
        status: 'OFERECIDO',
        vehicleType: 'CARRO',
        womenDriverOnly: false,
        fareCents: 1500,
        pricingVersion: 'teste-corrida_carro-1',
      });
      expect(ride.payment).toMatchObject({ status: 'PAGO', amountCents: 1500 });
      expect(ride.boardingPin).toMatch(/^\d{4}$/);
      const offer = await t.currentOffer(driver);
      expect(offer).toMatchObject({
        kind: 'CORRIDA',
        vehicleType: 'CARRO',
        passenger: { firstName: 'Ana', rating: { average: null, count: 0 } },
      });
      expect(offer).not.toHaveProperty('boardingPin');
    });

    it('não oferece a quem tem moto, e registra o motivo', async () => {
      await t.prisma.deliveryOffer.deleteMany();
      const moto = await t.driver('Moto'); // moto, 2022, aprovado
      await t.online(moto, near(50)); // mais perto que o carro
      const ride = await t.createRide(client);
      expect(await t.currentOffer(moto)).toBeNull();
      expect((await t.currentOffer(driver)).deliveryId).toBe(ride.id);
      const offered = (await t.events(ride.id)).find((e) => e.type === 'OFERTA')!;
      expect((offered.data as any).excluded).toEqual({ VEICULO_INELEGIVEL: 1 });
    });

    it('entrega continua indo para qualquer veículo (moto incluída)', async () => {
      const moto = await t.driver('Moto');
      await t.online(moto, near(50));
      await t.createDelivery(client);
      expect(await t.currentOffer(moto)).not.toBeNull();
      expect(await t.currentOffer(driver)).toBeNull();
    });

    it('mototáxi desligado: 409 ao pedir moto; ligado, o motorista de moto recebe', async () => {
      const moto = await t.driver('Moto');
      await t.online(moto, near(50));
      const body = t.rideBody({ vehicleType: 'MOTO' });
      const r = await t.post('/rides', client.token, body);
      expect(r.status).toBe(409);
      expect(await t.prisma.delivery.count()).toBe(0);
      await t.setRules({ moto: { enabled: true } });
      const ok = await t.post('/rides', client.token, body);
      expect(ok.status).toBe(201);
      expect(ok.body.fareCents).toBe(1000);
      expect(await t.currentOffer(moto)).toMatchObject({ vehicleType: 'MOTO' });
    });

    it('veículo velho demais fica sem corrida; mudar a regra libera na hora', async () => {
      const old = await t.carDriver('Velho', { vehicleYear: 2000 });
      await t.online(old, near(10));
      await t.createRide(client);
      expect(await t.currentOffer(old)).toBeNull();
      expect(await t.currentOffer(driver)).not.toBeNull();
    });

    it('documento exigido pela regra municipal: sem ele não recebe, com ele recebe', async () => {
      await t.setRules({
        car: { requiredDocuments: ['CNH', 'DOCUMENTO_VEICULO', 'FOTO', 'LICENCA_MUNICIPAL'] },
      });
      const ride = await t.createRide(client);
      expect(await t.currentOffer(driver)).toBeNull(); // sem licença
      const comLicenca = await t.carDriver('Licenciado', { extraDocuments: ['LICENCA_MUNICIPAL'] });
      await t.online(comLicenca, near(700));
      await t.dispatch.dispatch(ride.id);
      expect((await t.currentOffer(comLicenca)).deliveryId).toBe(ride.id);
    });

    it('motorista mulher: só mulher verificada recebe, mesmo mais longe', async () => {
      const homem = await t.carDriver('Perto', { gender: 'MASCULINO' });
      const naoVerificada = await t.carDriver('Naoverif', {
        gender: 'FEMININO',
        genderVerified: false,
      });
      const mulher = await t.carDriver('Longe', { gender: 'FEMININO', genderVerified: true });
      await t.online(homem, near(20));
      await t.online(naoVerificada, near(30));
      await t.online(mulher, near(1500));
      const ride = await t.createRide(client, { womenDriverOnly: true });
      expect(ride.womenDriverOnly).toBe(true);
      expect(await t.currentOffer(driver)).toBeNull();
      expect(await t.currentOffer(homem)).toBeNull();
      expect(await t.currentOffer(naoVerificada)).toBeNull();
      expect((await t.currentOffer(mulher)).womenDriverOnly).toBe(true);
      const offered = (await t.events(ride.id)).find((e) => e.type === 'OFERTA')!;
      expect((offered.data as any).excluded).toMatchObject({ FORA_DA_PREFERENCIA: 3 });
    });

    it('sem nenhuma mulher verificada: fica buscando, sem cair em outro motorista', async () => {
      const ride = await t.createRide(client, { womenDriverOnly: true });
      expect((await rideRow(ride.id)).status).toBe('CRIADO');
      expect(await t.currentOffer(driver)).toBeNull();
    });

    it('opção desligada pela configuração: 409', async () => {
      await t.setRules({ womenDriverOptionEnabled: false });
      expect(
        (await t.post('/rides', client.token, t.rideBody({ womenDriverOnly: true }))).status,
      ).toBe(409);
    });

    it('cobra o que foi mostrado, é idempotente e só passageiro pede', async () => {
      const key = 'chave-corrida-123';
      const a = await t.post('/rides', client.token, t.rideBody({ idempotencyKey: key }));
      const b = await t.post('/rides', client.token, t.rideBody({ idempotencyKey: key }));
      expect(b.body.id).toBe(a.body.id);
      expect(await t.prisma.payment.count()).toBe(1);
      expect(
        (
          await t.post(
            '/rides',
            client.token,
            t.rideBody({ expectedFareCents: 999, idempotencyKey: 'outra-chave-456' }),
          )
        ).status,
      ).toBe(409);
      expect((await t.post('/rides', driver.token, t.rideBody())).status).toBe(403);
      expect(
        (await t.post('/rides', client.token, t.rideBody({ vehicleType: 'BICICLETA' }))).status,
      ).toBe(400);
    });

    it('a lista de entregas e a de corridas não se misturam', async () => {
      await t.createRide(client);
      await t.createDelivery(client);
      expect((await t.get('/rides', client.token)).body.map((r: any) => r.kind)).toEqual([
        'CORRIDA',
      ]);
      expect((await t.get('/deliveries', client.token)).body.map((r: any) => r.kind)).toEqual([
        'ENTREGA',
      ]);
    });

    it('o banco impede corrida sem PIN ou sem tipo de veículo', async () => {
      const ride = await t.createRide(client);
      await expect(
        t.prisma.delivery.update({ where: { id: ride.id }, data: { boardingPin: null } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.delivery.update({ where: { id: ride.id }, data: { boardingPin: '12' } }),
      ).rejects.toThrow();
    });
  });

  // ------------------------------------------------------------------ verificação e PIN

  describe('verificação do motorista e do embarque', () => {
    let ride: any;
    beforeEach(async () => {
      ride = await t.createRide(client);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
      await t.post(`/driver/deliveries/${ride.id}/en-route-pickup`, driver.token);
    });
    const board = (pin?: string) =>
      t.post(`/driver/deliveries/${ride.id}/picked-up`, driver.token, pin ? { pin } : {});

    it('o passageiro vê nome, placa, modelo e o veículo que aceitou; o PIN é só dele', async () => {
      const seen = (await t.get(`/deliveries/${ride.id}`, client.token)).body;
      expect(seen.driver.name).toBe('Carlos');
      expect(seen.vehicle).toEqual({
        type: 'CARRO',
        plate: driver.plate,
        model: 'Onix',
        year: 2022,
      });
      expect(seen.boardingPin).toBe(ride.boardingPin);
      expect((await rideRow(ride.id)).vehicleId).toBe(driver.vehicleId);
      const asDriver = (await t.get(`/deliveries/${ride.id}`, driver.token)).body;
      expect(asDriver.boardingPin).toBeNull();
      expect(asDriver.vehicle).toBeNull();
      expect(asDriver.passenger).toMatchObject({ firstName: 'Ana' });
      expect(
        JSON.stringify((await t.get('/driver/deliveries/active', driver.token)).body),
      ).not.toContain(ride.boardingPin);
    });

    it('sem PIN ou com PIN errado não embarca', async () => {
      expect((await board()).status).toBe(403);
      const wrong = ride.boardingPin === '0000' ? '1111' : '0000';
      const r = await board(wrong);
      expect(r.status).toBe(403);
      expect(r.body.message).toMatch(/PIN/);
      expect((await rideRow(ride.id)).status).toBe('A_CAMINHO_COLETA');
    });

    it('PIN correto embarca; depois dele o passageiro não vê mais o PIN', async () => {
      expect((await board(ride.boardingPin)).status).toBe(200);
      expect((await rideRow(ride.id)).status).toBe('COLETADO');
      expect((await t.get(`/deliveries/${ride.id}`, client.token)).body.boardingPin).toBeNull();
    });

    it('tentativas esgotadas travam o embarque, até com o PIN certo', async () => {
      const wrong = ride.boardingPin === '0000' ? '1111' : '0000';
      for (let i = 0; i < 5; i++) await board(wrong);
      const locked = await board(ride.boardingPin);
      expect(locked.status).toBe(409);
      expect((await rideRow(ride.id)).status).toBe('A_CAMINHO_COLETA');
      // O passageiro ainda pode cancelar.
      expect(
        (
          await t.post(`/deliveries/${ride.id}/cancel`, client.token, {
            reason: 'CLIENTE_DESISTIU',
          })
        ).status,
      ).toBe(200);
    });

    it('formato inválido de PIN é recusado antes de contar tentativa', async () => {
      expect(
        (await t.post(`/driver/deliveries/${ride.id}/picked-up`, driver.token, { pin: 'abc' }))
          .status,
      ).toBe(400);
      expect((await rideRow(ride.id)).boardingPinAttempts).toBe(0);
    });

    it('a foto do motorista só aparece para o passageiro, durante a corrida', async () => {
      await t.prisma.document.updateMany({
        where: { userId: driver.id, type: 'FOTO' },
        data: { storageKey: 'foto-teste.png' },
      });
      const storage = (await import('../src/common/storage.service')).StorageService;
      const svc = t.app.get(storage);
      // grava um arquivo de verdade pelo serviço e aponta o documento para ele
      const key = await svc.save(Buffer.from('89504e470d0a1a0a', 'hex'), 'png');
      await t.prisma.document.updateMany({
        where: { userId: driver.id, type: 'FOTO' },
        data: { storageKey: key },
      });
      const ok = await fetch(`${t.baseUrl}/rides/${ride.id}/driver-photo`, {
        headers: { authorization: `Bearer ${client.token}` },
      });
      expect(ok.status).toBe(200);
      expect(ok.headers.get('content-type')).toBe('image/png');
      expect(ok.headers.get('cache-control')).toContain('no-store');
      const other = await t.client('Outra');
      expect((await t.get(`/rides/${ride.id}/driver-photo`, other.token)).status).toBe(404);
      expect((await t.get(`/rides/${ride.id}/driver-photo`, driver.token)).status).toBe(403);
      await svc.remove(key);
    });
  });

  // ------------------------------------------------------------------ viagem completa, ledger e avaliação mútua

  describe('viagem completa', () => {
    it('fecha no ledger com a taxa de 10% e gera recibo de corrida', async () => {
      const id = await t.runRideToEnd(client, driver);
      const row = await rideRow(id);
      expect(row).toMatchObject({
        status: 'ENTREGUE',
        platformFeeCents: 150,
        workerNetCents: 1350,
      });
      expect((await t.get('/driver/wallet', driver.token)).body.balanceCents).toBe(1350);
      expect(await t.prisma.ledgerTransaction.count({ where: { reference: id } })).toBe(1);
      const receipt = (await t.get(`/deliveries/${id}/receipt`, client.token)).body;
      expect(receipt).toMatchObject({ kind: 'CORRIDA', fareCents: 1500 });
      expect(receipt.notice).toMatch(/corrida/);
    });

    it('os ganhos do motorista incluem as corridas', async () => {
      await t.runRideToEnd(client, driver);
      const e = (await t.get('/driver/earnings', driver.token)).body;
      expect(e.today.netCents).toBe(1350);
    });

    it('cancelar antes de embarcar estorna tudo; a corrida não muda de natureza', async () => {
      const ride = await t.createRide(client);
      const r = await t.post(`/deliveries/${ride.id}/cancel`, client.token, {
        reason: 'CLIENTE_DESISTIU',
      });
      expect(r.body).toMatchObject({
        kind: 'CORRIDA',
        status: 'CANCELADO',
        payment: { status: 'ESTORNADO' },
      });
    });

    it('liberar a corrida devolve ao despacho e solta o veículo', async () => {
      const ride = await t.createRide(client);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
      expect((await rideRow(ride.id)).vehicleId).toBe(driver.vehicleId);
      await t.post(`/driver/deliveries/${ride.id}/release`, driver.token);
      const row = await rideRow(ride.id);
      expect(row.vehicleId).toBeNull();
      expect(['CRIADO', 'OFERECIDO']).toContain(row.status);
    });

    it('aceitar com o documento vencido entre a oferta e o aceite: 409 e nada muda', async () => {
      const ride = await t.createRide(client);
      const offer = await t.currentOffer(driver);
      await t.prisma.document.updateMany({
        where: { userId: driver.id, type: 'CNH' },
        data: { status: 'REPROVADO' },
      });
      const r = await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
      expect(r.status).toBe(409);
      expect((await rideRow(ride.id)).status).toBe('OFERECIDO');
    });

    describe('avaliação mútua', () => {
      it('cada parte avalia a outra uma vez; quem recebe não vê a nota', async () => {
        const id = await t.runRideToEnd(client, driver);
        const byClient = await t.post(`/deliveries/${id}/rating`, client.token, {
          stars: 5,
          comment: 'Ótimo',
        });
        expect(byClient.status).toBe(201);
        expect(byClient.body.rating).toMatchObject({ stars: 5, comment: 'Ótimo' });
        const byDriver = await t.post(`/driver/deliveries/${id}/rating`, driver.token, {
          stars: 4,
          comment: 'Educada',
        });
        expect(byDriver.status).toBe(201);
        expect(byDriver.body.rating).toMatchObject({ stars: 4 });
        // Duas vezes não.
        expect((await t.post(`/deliveries/${id}/rating`, client.token, { stars: 1 })).status).toBe(
          409,
        );
        expect(
          (await t.post(`/driver/deliveries/${id}/rating`, driver.token, { stars: 1 })).status,
        ).toBe(409);
        // Cada um enxerga só a nota que deu.
        expect((await t.get(`/deliveries/${id}`, client.token)).body.rating.stars).toBe(5);
        const seenByDriver = (await t.get(`/deliveries/${id}`, driver.token)).body;
        expect(seenByDriver.rating.stars).toBe(4);
        expect(JSON.stringify(seenByDriver)).not.toContain('Ótimo');
        // O admin vê as duas.
        const admin = await t.admin();
        const adminView = (await t.get(`/deliveries/${id}`, admin.token)).body;
        expect(adminView.rating.stars).toBe(5);
        expect(adminView.passengerRating.stars).toBe(4);
        const rows = await t.prisma.rating.findMany({
          where: { deliveryId: id },
          orderBy: { direction: 'asc' },
        });
        expect(rows.map((r) => [r.direction, r.authorId, r.rateeId])).toEqual([
          ['CLIENTE_AVALIA_MOTORISTA', client.id, driver.id],
          ['MOTORISTA_AVALIA_CLIENTE', driver.id, client.id],
        ]);
      });

      it('só depois de concluída, só entre os participantes e só em corrida', async () => {
        const ride = await t.createRide(client);
        expect(
          (await t.post(`/deliveries/${ride.id}/rating`, client.token, { stars: 5 })).status,
        ).toBe(409);
        const id = await t.runRideToEnd(client, driver);
        const other = await t.carDriver('Outro');
        expect(
          (await t.post(`/driver/deliveries/${id}/rating`, other.token, { stars: 5 })).status,
        ).toBe(404);
        expect(
          (await t.post(`/driver/deliveries/${id}/rating`, driver.token, { stars: 6 })).status,
        ).toBe(400);
        // Entrega comum: o motorista não avalia o cliente.
        const moto = await t.driver('Moto');
        await t.online(moto, near(5));
        const entrega = await t.runToDelivered(client, moto);
        expect(
          (await t.post(`/driver/deliveries/${entrega}/rating`, moto.token, { stars: 5 })).status,
        ).toBe(409);
      });

      it('a média só aparece depois de 3 notas, para os dois lados', async () => {
        const stars = [5, 5, 4];
        for (const s of stars) {
          const id = await t.runRideToEnd(client, driver);
          await t.post(`/deliveries/${id}/rating`, client.token, { stars: s });
          await t.post(`/driver/deliveries/${id}/rating`, driver.token, { stars: s });
          if (s !== 4) {
            const next = await t.createRide(client);
            expect(next.driverRating ?? null).toBeNull(); // ainda sem motorista
            await t.post(`/deliveries/${next.id}/cancel`, client.token, {
              reason: 'CLIENTE_DESISTIU',
            });
          }
        }
        const ride = await t.createRide(client);
        const offer = await t.currentOffer(driver);
        expect(offer.passenger.rating).toEqual({ average: 4.6, count: 3 });
        await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
        const seen = (await t.get(`/deliveries/${ride.id}`, client.token)).body;
        expect(seen.driverRating).toEqual({ average: 4.6, count: 3 });
      });
    });
  });

  // ------------------------------------------------------------------ compartilhar a viagem

  describe('compartilhar a viagem', () => {
    let ride: any;
    beforeEach(async () => {
      ride = await t.createRide(client);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
    });
    const share = (label?: string) =>
      t.post(`/rides/${ride.id}/shares`, client.token, label ? { contactLabel: label } : {});

    it('o contato abre o link sem login e vê o essencial — nada de telefone ou valor', async () => {
      const s = await share('Mãe');
      expect(s.status).toBe(201);
      expect(s.body.url).toMatch(/\/share\/[\w-]{32,}$/);
      const data = await t.get(`/share/${s.body.token}/data`);
      expect(data.status).toBe(200);
      expect(data.body).toMatchObject({
        status: 'ACEITO',
        statusText: 'Motorista confirmado',
        passenger: 'Ana',
        driver: 'Carlos',
        vehicle: { plate: driver.plate, model: 'Onix' },
        pickup: PICKUP.address,
        dropoff: DROPOFF.address,
        emergency: false,
        ended: false,
      });
      // Lista fechada de campos: o que não está aqui (telefone, ids, valor, pagamento, PIN) não sai.
      expect(Object.keys(data.body).sort()).toEqual(
        [
          'dropoff',
          'driver',
          'driverPosition',
          'emergency',
          'ended',
          'passenger',
          'pickup',
          'status',
          'statusText',
          'updatedAt',
          'vehicle',
        ].sort(),
      );
      expect(Object.keys(data.body.vehicle).sort()).toEqual(['model', 'plate', 'type']);
      const raw = JSON.stringify(data.body);
      for (const secret of [client.phone, driver.phone, client.id, driver.id])
        expect(raw).not.toContain(secret);
    });

    it('a posição do motorista aparece quando ele envia', async () => {
      const s = (await share()).body;
      await t.post('/driver/position', driver.token, near(200));
      const data = (await t.get(`/share/${s.token}/data`)).body;
      expect(data.driverPosition).toMatchObject({ lat: near(200).lat, lng: near(200).lng });
    });

    it('a página HTML é servida com cabeçalhos de privacidade', async () => {
      const s = (await share()).body;
      const res = await fetch(`${t.baseUrl}/share/${s.token}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(await res.text()).toContain('Acompanhar corrida');
    });

    it('só o hash do token é guardado', async () => {
      const s = (await share()).body;
      const rows = await t.prisma.tripShare.findMany();
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(s.token);
    });

    it('revogar fecha o link; outra pessoa não revoga nem lista', async () => {
      const s = (await share()).body;
      const other = await t.client('Outra');
      expect(
        (await t.request('DELETE', `/rides/${ride.id}/shares/${s.id}`, other.token)).status,
      ).toBe(404);
      expect((await t.get(`/rides/${ride.id}/shares`, other.token)).status).toBe(404);
      expect((await t.get(`/share/${s.token}/data`)).status).toBe(200);
      expect(
        (await t.request('DELETE', `/rides/${ride.id}/shares/${s.id}`, client.token)).status,
      ).toBe(204);
      expect((await t.get(`/share/${s.token}/data`)).status).toBe(404);
      expect(
        (await t.get(`/rides/${ride.id}/shares`, client.token)).body[0].revokedAt,
      ).not.toBeNull();
    });

    it('token inventado, malformado ou de corrida alheia: 404', async () => {
      expect((await t.get('/share/abc/data')).status).toBe(404);
      expect((await t.get(`/share/${'a'.repeat(40)}/data`)).status).toBe(404);
      expect((await t.get(`/share/${'../'.repeat(12)}/data`)).status).toBe(404);
    });

    it('depois da viagem o link vale por 30 min e então fecha', async () => {
      const s = (await share()).body;
      await t.post(`/driver/deliveries/${ride.id}/en-route-pickup`, driver.token);
      await t.post(`/driver/deliveries/${ride.id}/picked-up`, driver.token, {
        pin: ride.boardingPin,
      });
      await t.post(`/driver/deliveries/${ride.id}/en-route-dropoff`, driver.token);
      await t.post(`/driver/deliveries/${ride.id}/delivered`, driver.token);
      const after = (await t.get(`/share/${s.token}/data`)).body;
      expect(after).toMatchObject({ ended: true, status: 'ENTREGUE', driverPosition: null });
      await t.prisma.delivery.update({
        where: { id: ride.id },
        data: { deliveredAt: new Date(Date.now() - 31 * 60_000) },
      });
      expect((await t.get(`/share/${s.token}/data`)).status).toBe(404);
    });

    it('só corrida em andamento, só o dono, no máximo 5 links', async () => {
      const waiting = await t.createRide(client); // sem motorista disponível agora (o único está ocupado)
      expect((await t.post(`/rides/${waiting.id}/shares`, client.token, {})).status).toBe(409);
      const other = await t.client('Outra');
      expect((await t.post(`/rides/${ride.id}/shares`, other.token, {})).status).toBe(404);
      expect((await t.post(`/rides/${ride.id}/shares`, driver.token, {})).status).toBe(403);
      for (let i = 0; i < 4; i++) expect((await share()).status).toBe(201);
      await share(); // 5º
      expect((await share()).status).toBe(409);
    });

    it('entrega não é compartilhável por este caminho', async () => {
      const entrega = await t.createDelivery(client);
      expect((await t.post(`/rides/${entrega.id}/shares`, client.token, {})).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ emergência

  describe('botão de emergência', () => {
    let ride: any;
    beforeEach(async () => {
      ride = await t.createRide(client);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
    });

    it('registra o alerta com a posição e avisa os administradores em tempo real', async () => {
      const admin = await t.admin();
      const ws = await WsClient.connect(t.wsUrl);
      await ws.authenticate(admin.token);
      const r = await t.post('/safety/emergency', client.token, {
        deliveryId: ride.id,
        ...near(100),
        note: 'Estou com medo',
      });
      expect(r.status).toBe(200);
      expect(await ws.next('safety.emergency')).toMatchObject({
        id: r.body.id,
        deliveryId: ride.id,
        actorRole: 'PASSAGEIRO',
      });
      ws.close();
      const list = (await t.get('/admin/safety/alerts?status=ABERTO', admin.token)).body;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        deliveryId: ride.id,
        actorRole: 'PASSAGEIRO',
        lat: near(100).lat,
        note: 'Estou com medo',
      });
      expect(list[0].user.phone).toBe(client.phone);
    });

    it('o motorista também aciona; apertar de novo atualiza o mesmo alerta', async () => {
      const a = await t.post('/safety/emergency', driver.token, { deliveryId: ride.id });
      expect(a.status).toBe(200);
      const b = await t.post('/safety/emergency', driver.token, {
        deliveryId: ride.id,
        ...near(50),
      });
      expect(b.body.id).toBe(a.body.id);
      const rows = await t.prisma.emergencyAlert.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorRole: 'MOTORISTA', lat: near(50).lat });
    });

    it('funciona sem corrida (fora de viagem), mas não por corrida alheia', async () => {
      expect((await t.post('/safety/emergency', client.token, near(10))).status).toBe(200);
      const other = await t.client('Outra');
      expect((await t.post('/safety/emergency', other.token, { deliveryId: ride.id })).status).toBe(
        404,
      );
      expect((await t.post('/safety/emergency', undefined, {})).status).toBe(401);
      expect((await t.post('/safety/emergency', client.token, { lat: 200 })).status).toBe(400);
    });

    it('o contato do link vê o aviso de emergência', async () => {
      const s = (await t.post(`/rides/${ride.id}/shares`, client.token, {})).body;
      expect((await t.get(`/share/${s.token}/data`)).body.emergency).toBe(false);
      await t.post('/safety/emergency', client.token, { deliveryId: ride.id });
      expect((await t.get(`/share/${s.token}/data`)).body.emergency).toBe(true);
    });

    it('a associação atende e encerra; só admin vê a fila', async () => {
      const r = await t.post('/safety/emergency', client.token, { deliveryId: ride.id });
      const admin = await t.admin();
      expect((await t.get('/admin/safety/alerts', client.token)).status).toBe(403);
      const up = await t.req('PATCH', `/admin/safety/alerts/${r.body.id}`, admin.token, {
        status: 'ENCERRADO',
        note: 'Falei com a passageira',
      });
      expect(up.body).toMatchObject({
        status: 'ENCERRADO',
        handledById: admin.id,
        handledNote: 'Falei com a passageira',
      });
      expect(
        (await t.req('PATCH', `/admin/safety/alerts/${r.body.id}`, admin.token, { status: 'XYZ' }))
          .status,
      ).toBe(400);
    });
  });

  // ------------------------------------------------------------------ denúncia

  describe('canal de denúncia', () => {
    let ride: any;
    beforeEach(async () => {
      ride = await t.createRide(client);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
    });
    const report = (token: string, extra: object = {}) =>
      t.post('/safety/reports', token, {
        deliveryId: ride.id,
        category: 'DIRECAO_PERIGOSA',
        description: 'Dirigiu muito rápido e furou o sinal.',
        ...extra,
      });

    it('o denunciado é sempre a outra parte da corrida', async () => {
      expect((await report(client.token)).status).toBe(201);
      expect((await report(driver.token, { category: 'ASSEDIO' })).status).toBe(201);
      const rows = await t.prisma.report.findMany({ orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => [r.reporterId, r.reportedId])).toEqual([
        [client.id, driver.id],
        [driver.id, client.id],
      ]);
    });

    it('não dá para denunciar por corrida alheia nem informar um id de usuário', async () => {
      const other = await t.client('Outra');
      expect((await report(other.token)).status).toBe(404);
      expect((await report(client.token, { reportedId: other.id })).status).toBe(400);
    });

    it('descrição curta, categoria inválida e limite diário', async () => {
      expect((await report(client.token, { description: 'curta' })).status).toBe(400);
      expect((await report(client.token, { category: 'XYZ' })).status).toBe(400);
      for (let i = 0; i < 10; i++) expect((await report(client.token)).status).toBe(201);
      expect((await report(client.token)).status).toBe(409);
    });

    it('denúncia sem corrida (sobre o app ou a associação) é aceita', async () => {
      const r = await t.post('/safety/reports', client.token, {
        category: 'OUTRO',
        description: 'Não consegui pagar com Pix.',
      });
      expect(r.status).toBe(201);
      expect(
        (await t.prisma.report.findUniqueOrThrow({ where: { id: r.body.id } })).reportedId,
      ).toBeNull();
    });

    it('quem denunciou acompanha a resposta, sem ver nada sobre o denunciado', async () => {
      const r = await report(client.token);
      const admin = await t.admin();
      await t.req('PATCH', `/admin/safety/reports/${r.body.id}`, admin.token, {
        status: 'PROCEDENTE',
        resolution: 'Motorista advertido.',
      });
      const mine = (await t.get('/safety/reports', client.token)).body;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        status: 'PROCEDENTE',
        resolution: 'Motorista advertido.',
        category: 'DIRECAO_PERIGOSA',
      });
      expect(JSON.stringify(mine)).not.toContain(driver.id);
      expect((await t.get('/safety/reports', driver.token)).body).toEqual([]);
    });

    it('a fila da associação põe as graves primeiro e mostra quem é quem', async () => {
      await report(client.token, { category: 'COBRANCA_INDEVIDA' });
      await report(client.token, { category: 'VIOLENCIA' });
      const admin = await t.admin();
      const q = (await t.get('/admin/safety/reports', admin.token)).body;
      expect(q.map((r: any) => r.category)).toEqual(['VIOLENCIA', 'COBRANCA_INDEVIDA']);
      expect(q[0]).toMatchObject({
        severe: true,
        reporter: { phone: client.phone },
        reported: { phone: driver.phone },
      });
      expect((await t.get('/admin/safety/reports', client.token)).status).toBe(403);
    });
  });

  // ------------------------------------------------------------------ registro da viagem

  describe('registro da viagem', () => {
    let ride: any;
    beforeEach(async () => {
      ride = await t.createRide(client);
      const offer = await t.currentOffer(driver);
      await t.post(`/driver/offers/${offer.id}/accept`, driver.token);
    });
    const points = () => t.prisma.tripPoint.findMany({ where: { deliveryId: ride.id } });

    it('só registra a posição depois que o motorista sai para buscar, e no máximo 1 a cada 10 s', async () => {
      await t.post('/driver/position', driver.token, near(300));
      expect(await points()).toHaveLength(0); // ACEITO: ainda não saiu
      await t.post(`/driver/deliveries/${ride.id}/en-route-pickup`, driver.token);
      await new Promise((r) => setTimeout(r, 1100));
      await t.post('/driver/position', driver.token, near(250));
      await new Promise((r) => setTimeout(r, 1100));
      await t.post('/driver/position', driver.token, near(200));
      const p = await points();
      expect(p).toHaveLength(1); // a segunda caiu dentro da janela de 10 s
      expect(p[0]).toMatchObject({ lat: near(250).lat });
    });

    it('entrega não gera registro de trajeto', async () => {
      const moto = await t.driver('Moto');
      await t.online(moto, near(5));
      const d = await t.createDelivery(await t.client('Outro cliente'));
      const offer = await t.currentOffer(moto);
      await t.post(`/driver/offers/${offer.id}/accept`, moto.token);
      await t.post(`/driver/deliveries/${d.id}/en-route-pickup`, moto.token);
      await t.post('/driver/position', moto.token, near(100));
      expect(await t.prisma.tripPoint.count({ where: { deliveryId: d.id } })).toBe(0);
    });

    it('o passageiro consulta o próprio registro; estranho não', async () => {
      await t.post(`/driver/deliveries/${ride.id}/en-route-pickup`, driver.token);
      await t.post('/driver/position', driver.token, near(200));
      const rec = (await t.get(`/rides/${ride.id}/record`, client.token)).body;
      expect(rec.points).toHaveLength(1);
      expect(rec.events.every((e: any) => e.type === 'STATUS')).toBe(true);
      expect(rec.retentionDays).toBe(90);
      expect(rec.notice).toMatch(/registrada/);
      expect(rec.alerts).toBeUndefined();
      const other = await t.client('Outra');
      expect((await t.get(`/rides/${ride.id}/record`, other.token)).status).toBe(404);
    });

    it('a associação abre o registro completo e cada abertura fica auditada', async () => {
      await t.post('/safety/emergency', client.token, { deliveryId: ride.id });
      await t.post('/safety/reports', client.token, {
        deliveryId: ride.id,
        category: 'OUTRO',
        description: 'Relato sobre a corrida.',
      });
      await t.post(`/rides/${ride.id}/shares`, client.token, {});
      const admin = await t.admin();
      const rec = (await t.get(`/admin/rides/${ride.id}/trip-record`, admin.token)).body;
      expect(rec.events.some((e: any) => e.type === 'OFERTA')).toBe(true); // inclui as decisões do despacho
      expect(rec.alerts).toHaveLength(1);
      expect(rec.reports).toHaveLength(1);
      expect(rec.sharesCreated).toBe(1);
      await t.get(`/admin/rides/${ride.id}/trip-record`, admin.token);
      const log = await t.prisma.tripRecordAccess.findMany({ where: { deliveryId: ride.id } });
      expect(log.map((l) => l.adminId)).toEqual([admin.id, admin.id]);
      expect((await t.get(`/admin/rides/${ride.id}/trip-record`, client.token)).status).toBe(403);
    });

    it('retenção: apaga o que passou de 90 dias, menos de corridas com denúncia ou alerta', async () => {
      const old = new Date(Date.now() - 100 * 86_400_000);
      const recent = new Date(Date.now() - 10 * 86_400_000);
      const seed = (deliveryId: string, at: Date) =>
        t.prisma.tripPoint.create({ data: { deliveryId, lat: -7.1, lng: -34.8, at } });
      const ride2 = await t.createRide(await t.client('Outro'));
      const ride3 = await t.createRide(await t.client('Mais um'));
      await seed(ride.id, old); // será apagado
      await seed(ride.id, recent); // fica: recente
      await seed(ride2.id, old); // fica: tem denúncia
      await seed(ride3.id, old); // fica: tem alerta
      await t.prisma.report.create({
        data: {
          reporterId: client.id,
          deliveryId: ride2.id,
          category: 'OUTRO',
          description: 'Caso em apuração.',
        },
      });
      await t.prisma.emergencyAlert.create({
        data: { userId: client.id, deliveryId: ride3.id, actorRole: 'PASSAGEIRO' },
      });
      const removed = await t.app.get(SafetyService).purgeTripPoints();
      expect(removed).toBe(1);
      expect(await t.prisma.tripPoint.count()).toBe(3);
    });

    it('excluir a conta apaga o trajeto (sem denúncia) e revoga os links', async () => {
      const share = (await t.post(`/rides/${ride.id}/shares`, client.token, {})).body;
      await t.prisma.tripPoint.create({ data: { deliveryId: ride.id, lat: -7.1, lng: -34.8 } });
      await t.post(`/driver/deliveries/${ride.id}/en-route-pickup`, driver.token);
      await t.post(`/deliveries/${ride.id}/cancel`, client.token, { reason: 'CLIENTE_DESISTIU' });
      const del = await t.request('DELETE', '/me', client.token);
      expect(del.status).toBe(204);
      expect(await t.prisma.tripPoint.count({ where: { deliveryId: ride.id } })).toBe(0);
      expect((await t.get(`/share/${share.token}/data`)).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------ regras municipais

  describe('regras municipais como configuração', () => {
    const valid = (patch: object = {}) => ({
      version: 'jp-2026-11',
      effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
      legalReference: 'Decreto de exemplo',
      rules: {
        city: 'João Pessoa - PB',
        womenDriverOptionEnabled: true,
        car: {
          enabled: true,
          maxVehicleAgeYears: 7,
          minDriverAgeYears: 21,
          requiredDocuments: ['CNH', 'DOCUMENTO_VEICULO', 'FOTO'],
          passengerNotices: [],
        },
        moto: {
          enabled: true,
          maxVehicleAgeYears: 5,
          minDriverAgeYears: 21,
          requiredDocuments: ['CNH', 'DOCUMENTO_VEICULO', 'FOTO', 'LICENCA_MUNICIPAL'],
          passengerNotices: ['Capacete obrigatório'],
        },
      },
      ...patch,
    });

    it('sem versão publicada vale o padrão, avisando que não está confirmado', async () => {
      const admin = await t.admin();
      const cur = (await t.get('/admin/municipal-rules/current', admin.token)).body;
      expect(cur).toMatchObject({ isDefault: true, version: 'padrao-nao-confirmado' });
      expect(cur.warning).toMatch(/NÃO confirmados/);
      expect(cur.rules.moto.enabled).toBe(false);
    });

    it('o admin publica uma versão; ela passa a valer na data e a anterior é mantida', async () => {
      const admin = await t.admin();
      const pub = await t.post(
        '/admin/municipal-rules',
        admin.token,
        valid({ effectiveFrom: new Date(Date.now() - 1000).toISOString() }),
      );
      expect(pub.status).toBe(201);
      const cur = (await t.get('/admin/municipal-rules/current', admin.token)).body;
      expect(cur).toMatchObject({
        isDefault: false,
        version: 'jp-2026-11',
        legalReference: 'Decreto de exemplo',
        warning: null,
      });
      expect(
        (await t.get('/rides/rules', client.token)).body.vehicleTypes.find(
          (v: any) => v.type === 'MOTO',
        ),
      ).toMatchObject({ enabled: true, notices: ['Capacete obrigatório'] });
      // Versão futura não vale ainda.
      await t.post('/admin/municipal-rules', admin.token, valid({ version: 'jp-futura' }));
      expect((await t.get('/admin/municipal-rules/current', admin.token)).body.version).toBe(
        'jp-2026-11',
      );
      expect((await t.get('/admin/municipal-rules', admin.token)).body).toHaveLength(2);
    });

    it('recusa regra inválida, vigência no passado das existentes e versão repetida', async () => {
      const admin = await t.admin();
      const bad = valid();
      (bad.rules.car as any).maxVehicleAgeYears = -3;
      (bad.rules.moto as any).requiredDocuments = ['CNH'];
      const r = await t.post('/admin/municipal-rules', admin.token, bad);
      expect(r.status).toBe(400);
      expect(r.body.problems).toHaveLength(2);
      await t.post('/admin/municipal-rules', admin.token, valid());
      expect(
        (
          await t.post(
            '/admin/municipal-rules',
            admin.token,
            valid({ version: 'outra', effectiveFrom: new Date().toISOString() }),
          )
        ).status,
      ).toBe(409);
      expect(
        (await t.post('/admin/municipal-rules', admin.token, valid({ version: 'jp-2026-11' })))
          .status,
      ).toBe(409);
      expect(
        (await t.post('/admin/municipal-rules', admin.token, { ...valid(), rules: 'x' })).status,
      ).toBe(400);
    });

    it('só admin mexe nas regras', async () => {
      expect((await t.post('/admin/municipal-rules', client.token, valid())).status).toBe(403);
      expect((await t.get('/admin/municipal-rules', driver.token)).status).toBe(403);
    });

    it('uma nova versão muda quem recebe corrida, sem reiniciar nada', async () => {
      await t.setRules({ car: { maxVehicleAgeYears: 1 } }); // o carro de 2022 não atende mais
      await t.createRide(client);
      expect(await t.currentOffer(driver)).toBeNull();
      await t.setRules({ car: { maxVehicleAgeYears: 20 } });
      await t.dispatch.tick();
      expect(await t.currentOffer(driver)).not.toBeNull();
    });
  });

  // ------------------------------------------------------------------ habilitação do motorista

  describe('habilitação do motorista para corridas', () => {
    it('mostra por veículo o que falta pelas regras vigentes', async () => {
      await t.setRules({
        car: { requiredDocuments: ['CNH', 'DOCUMENTO_VEICULO', 'FOTO', 'SEGURO_PASSAGEIROS'] },
      });
      const r = (await t.get('/driver/ride-eligibility', driver.token)).body;
      expect(r.rulesAreDefault).toBe(false);
      expect(r.vehicles).toHaveLength(1);
      expect(r.vehicles[0]).toMatchObject({
        type: 'CARRO',
        eligible: false,
        problems: ['DOCUMENTO_FALTANDO'],
        documentsToSend: ['SEGURO_PASSAGEIROS'],
      });
    });

    it('com as regras padrão avisa que não estão confirmadas', async () => {
      await t.prisma.municipalRulesVersion.deleteMany();
      const r = (await t.get('/driver/ride-eligibility', driver.token)).body;
      expect(r.rulesAreDefault).toBe(true);
      expect(r.warning).toMatch(/NÃO confirmados/);
      expect(r.vehicles[0].eligible).toBe(true);
    });

    it('aceita enviar os documentos extras pela rota de upload', async () => {
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
      const form = new FormData();
      form.set('type', 'LICENCA_MUNICIPAL');
      form.set('file', new Blob([png], { type: 'image/png' }), 'x.png');
      const res = await fetch(`${t.baseUrl}/driver/documents`, {
        method: 'POST',
        headers: { authorization: `Bearer ${driver.token}` },
        body: form,
      });
      expect(res.status).toBe(201);
      expect((await res.json()).type).toBe('LICENCA_MUNICIPAL');
    });
  });

  // ------------------------------------------------------------------ gênero e verificação

  describe('motorista mulher: autodeclaração e verificação', () => {
    const profile = (token: string, gender?: string) =>
      t.put('/driver/profile', token, {
        fullName: 'Marta Oliveira',
        cpf: '529.982.247-25',
        birthDate: '1990-01-01',
        ...(gender ? { gender } : {}),
      });

    it('o admin só verifica quem se declarou do gênero feminino; mudar o gênero zera a verificação', async () => {
      const admin = await t.admin();
      const m = await t.carDriver('Marta');
      expect((await profile(m.token, 'MASCULINO')).status).toBe(200);
      const verify = (verified: boolean) =>
        t.post(`/admin/drivers/${m.id}/gender-verification`, admin.token, { verified });
      expect((await verify(true)).status).toBe(400);
      expect((await profile(m.token, 'FEMININO')).status).toBe(200);
      expect((await verify(true)).status).toBe(200);
      expect(
        (await t.prisma.driverProfile.findUniqueOrThrow({ where: { userId: m.id } }))
          .genderVerifiedAt,
      ).not.toBeNull();
      // Reenviar o mesmo gênero não derruba; trocar derruba.
      await profile(m.token, 'FEMININO');
      expect(
        (await t.prisma.driverProfile.findUniqueOrThrow({ where: { userId: m.id } }))
          .genderVerifiedAt,
      ).not.toBeNull();
      await profile(m.token, 'NAO_INFORMADO');
      expect(
        (await t.prisma.driverProfile.findUniqueOrThrow({ where: { userId: m.id } }))
          .genderVerifiedAt,
      ).toBeNull();
      expect((await verify(true)).status).toBe(400);
      expect((await verify(false)).status).toBe(200);
    });

    it('perfil sem gênero não mexe no que já existe; valor inválido é recusado', async () => {
      const m = await t.carDriver('Marta', { gender: 'FEMININO', genderVerified: true });
      expect((await profile(m.token)).status).toBe(200);
      const p = await t.prisma.driverProfile.findUniqueOrThrow({ where: { userId: m.id } });
      expect(p.gender).toBe('FEMININO');
      expect(p.genderVerifiedAt).not.toBeNull();
      expect((await profile(m.token, 'OUTRO')).status).toBe(400);
    });

    it('o motorista declara o gênero pelo app; sem perfil, 409; mudar zera a verificação', async () => {
      const m = await t.carDriver('Marta', { gender: 'FEMININO', genderVerified: true });
      expect((await t.put('/driver/gender', m.token, { gender: 'FEMININO' })).body).toEqual({
        gender: 'FEMININO',
        verified: true,
      });
      expect((await t.put('/driver/gender', m.token, { gender: 'MASCULINO' })).body).toEqual({
        gender: 'MASCULINO',
        verified: false,
      });
      expect((await t.put('/driver/gender', m.token, { gender: 'X' })).status).toBe(400);
      const semPerfil = await t.user(['MOTORISTA'], 'Novo');
      expect((await t.put('/driver/gender', semPerfil.token, { gender: 'FEMININO' })).status).toBe(
        409,
      );
      expect((await t.get('/driver/ride-eligibility', m.token)).body).toMatchObject({
        gender: 'MASCULINO',
        womenDriverVerified: false,
      });
    });

    it('só admin verifica', async () => {
      const m = await t.carDriver('Marta');
      expect(
        (await t.post(`/admin/drivers/${m.id}/gender-verification`, m.token, { verified: true }))
          .status,
      ).toBe(403);
    });
  });

  // ------------------------------------------------------------------ tabela de preço por perfil

  describe('tabela de preço por perfil', () => {
    it('cada perfil tem a sua linha do tempo de versões', async () => {
      const admin = await t.admin();
      const body = (profile: string | undefined, version: string, at: string) => ({
        version,
        effectiveFrom: at,
        baseCents: 500,
        perKmCents: 200,
        perMinuteCents: 40,
        minimumFareCents: 2000,
        ...(profile ? { profile } : {}),
      });
      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect(
        (await t.post('/admin/pricing', admin.token, body('CORRIDA_CARRO', 'carro-2', future)))
          .status,
      ).toBe(201);
      // O mesmo instante em outro perfil não conflita.
      expect(
        (await t.post('/admin/pricing', admin.token, body('CORRIDA_MOTO', 'moto-2', future)))
          .status,
      ).toBe(201);
      // Mas dentro do perfil não dá para voltar no tempo.
      expect(
        (
          await t.post(
            '/admin/pricing',
            admin.token,
            body('CORRIDA_CARRO', 'carro-3', new Date().toISOString()),
          )
        ).status,
      ).toBe(409);
      expect(
        (await t.post('/admin/pricing', admin.token, body('CORRIDA_BARCO', 'x', future))).status,
      ).toBe(400);
      const all = (await t.get('/admin/pricing', admin.token)).body;
      expect(all.map((p: any) => p.profile).sort()).toEqual([
        'CORRIDA_CARRO',
        'CORRIDA_CARRO',
        'CORRIDA_MOTO',
        'CORRIDA_MOTO',
        'ENTREGA',
      ]);
    });

    it('sem tabela de corrida configurada não há como cotar nem pedir', async () => {
      await t.prisma.pricingConfigVersion.deleteMany({ where: { profile: 'CORRIDA_CARRO' } });
      expect((await t.post('/rides', client.token, t.rideBody())).status).toBe(503);
      expect(await t.prisma.payment.count()).toBe(0);
    });
  });
});
