/**
 * Consentimento de localização do motorista (LGPD). A tela do app e o registro na API usam
 * esta mesma versão: se o texto mudar, suba a versão e o motorista é perguntado de novo.
 */
export const LOCATION_CONSENT_VERSION = '2026-10-29';

export const LOCATION_CONSENT_POINTS = [
  {
    title: 'Quando usamos',
    text: 'Só enquanto você está ONLINE. Ficou offline, paramos de ler e apagamos sua última posição.',
  },
  {
    title: 'Para quê',
    text: 'Para enviar pedidos perto de você e mostrar ao cliente onde você está durante a entrega.',
  },
  {
    title: 'Com o app fechado',
    text: 'Se você permitir "o tempo todo", seguimos recebendo pedidos mesmo com a tela apagada ou o app em segundo plano. O Android mostra um aviso fixo enquanto isso acontece.',
  },
  {
    title: 'O que NÃO fazemos',
    text: 'Não guardamos o trajeto que você faz, só a última posição. Não vendemos nem compartilhamos sua localização.',
  },
  {
    title: 'Você decide',
    text: 'Pode desligar a qualquer momento ficando offline ou nas Configurações do celular. Você também pode revogar este consentimento no app.',
  },
] as const;
