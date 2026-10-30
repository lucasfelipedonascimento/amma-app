import { ActionForm } from '@/components/ActionForm';
import { Card, PageTitle } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireSection } from '@/lib/session';

const KIND = {
  name: 'kind',
  label: 'Tipo',
  type: 'select',
  options: [
    { value: 'ENTREGA', label: 'Entrega' },
    { value: 'CORRIDA', label: 'Corrida de passageiro' },
  ],
} as const;
const LAT = {
  name: 'lat',
  label: 'Latitude do celular',
  type: 'text',
  hint: 'Ex.: -7.1195. No Google Maps, toque e segure no ponto onde o celular está.',
} as const;
const LNG = {
  name: 'lng',
  label: 'Longitude do celular',
  type: 'text',
  hint: 'Ex.: -34.8450',
} as const;
const DISTANCE = {
  name: 'distanceMeters',
  label: 'Distância até o destino (m)',
  type: 'number',
  min: 100,
  max: 20000,
  required: false,
  hint: 'Vazio = 2000 m.',
} as const;
const VEHICLE = {
  name: 'vehicleType',
  label: 'Veículo (só corrida)',
  type: 'select',
  required: false,
  options: [
    { value: 'CARRO', label: 'Carro' },
    { value: 'MOTO', label: 'Moto' },
  ],
} as const;

/** TEMPORÁRIO: cria pedidos de teste para o app do motorista no celular. */
export default async function Simulador() {
  await requireSection('simulador');
  const { enabled } = await apiGet<{ enabled: boolean }>('/admin/simulator');

  return (
    <>
      <PageTitle title="Simulador de corridas e entregas">
        Ferramenta temporária de teste. Cria um pedido em nome da passageira de exemplo, pago no
        provedor simulado, e dispara o despacho para motoristas online perto da posição informada.
      </PageTitle>
      <Card title="Enviar pedido de teste">
        {enabled ? (
          <>
            <p className="muted">
              A coleta fica ~300 m ao norte da posição e o destino mais adiante, também ao norte. O
              motorista precisa estar online, com posição recente e a menos de 3 km.
            </p>
            <ActionForm
              open
              trigger="Enviar pedido"
              path="/admin/simulator/orders"
              fields={[KIND, LAT, LNG, DISTANCE, VEHICLE]}
            />
          </>
        ) : (
          <p className="muted">
            Desligado neste ambiente (produção ou provedor de pagamento real).
          </p>
        )}
      </Card>
    </>
  );
}
