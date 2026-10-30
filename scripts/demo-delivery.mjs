// Cria um pedido de entrega DE TESTE perto de uma coordenada, como a passageira de exemplo do seed.
// Serve para testar o app do motorista em um celular real sem precisar do app do cliente.
//
// Uso: node scripts/demo-delivery.mjs <LATITUDE> <LONGITUDE> [URL_DA_API]
//   ex.: node scripts/demo-delivery.mjs -7.1195 -34.8450 http://192.168.0.10:3000
// A coleta fica ~300 m ao norte do ponto informado e a entrega ~2 km ao norte (use a posição do celular).
// Só funciona com OTP_MODE=simulated (o código vem na resposta), PAYMENT_PROVIDER=sandbox e o seed aplicado.
// Paga com o cartão de teste aprovado (4242…), que só existe no provedor simulado.

const [lat, lng, api = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'] =
  process.argv.slice(2);
const la = Number(lat);
const ln = Number(lng);
if (!Number.isFinite(la) || !Number.isFinite(ln)) {
  console.error('Uso: node scripts/demo-delivery.mjs <LATITUDE> <LONGITUDE> [URL_DA_API]');
  process.exit(1);
}

const PHONE = '+5583999990002'; // Passageira Exemplo (seed)
const METERS_PER_DEG = 111_000;

async function call(path, body, token) {
  const res = await fetch(api + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const otp = await call('/auth/otp/request', { phone: PHONE });
if (!otp.devCode) throw new Error('A API não devolveu devCode: OTP_MODE precisa ser "simulated".');
const { accessToken } = await call('/auth/otp/verify', { phone: PHONE, code: otp.devCode });

const delivery = await call(
  '/deliveries',
  {
    pickup: {
      lat: la + 300 / METERS_PER_DEG,
      lng: ln,
      address: 'Coleta de teste (~300 m ao norte)',
    },
    dropoff: {
      lat: la + 2000 / METERS_PER_DEG,
      lng: ln,
      address: 'Entrega de teste (~2 km ao norte)',
    },
    notes: 'Pedido de teste',
    payment: { method: 'CARTAO', cardToken: 'sbx_ok_4242_visa' },
  },
  accessToken,
);

console.log(
  `Pedido ${delivery.id} criado: ${delivery.status}, R$ ${(delivery.fareCents / 100).toFixed(2)}.`,
);
if (delivery.status === 'CRIADO')
  console.log('Ainda sem oferta: o motorista está online, com posição recente e a menos de 3 km?');
