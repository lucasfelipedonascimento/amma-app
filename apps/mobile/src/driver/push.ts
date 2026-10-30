import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { BRAND } from '@amma/shared';
import { api } from '../api';

/** Mesmo id que a API manda em `channelId` (OFFER_CHANNEL_ID). */
export const OFFER_CHANNEL = 'offers';

// Com o app aberto o pedido já aparece na tela: não duplicamos com um aviso do sistema.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type PushResult =
  | { status: 'ok'; token: string }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

/** Pede permissão, obtém o token do Expo e registra na API. Chame depois que o motorista ficar online. */
export async function registerForPush(): Promise<PushResult> {
  if (!Device.isDevice)
    return { status: 'unavailable', reason: 'Notificações só funcionam em celular de verdade.' };
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId)
    return {
      status: 'unavailable',
      reason: 'App sem projectId do EAS (rode "eas init"). Veja docs/MOBILE.md.',
    };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(OFFER_CHANNEL, {
      name: 'Novos pedidos',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 300, 200, 300],
      lightColor: BRAND.red,
      sound: 'default',
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { status: 'denied' };

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api('/driver/push-token', {
      method: 'PUT',
      body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
    return { status: 'ok', token };
  } catch (e) {
    return {
      status: 'unavailable',
      reason: e instanceof Error ? e.message : 'Não foi possível registrar as notificações.',
    };
  }
}

/** Remove o aparelho dos avisos (logout/revogação). Falhas são ignoradas: o servidor limpa tokens mortos. */
export async function unregisterPush(token: string | null): Promise<void> {
  if (!token) return;
  await api('/driver/push-token', {
    method: 'DELETE',
    body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
  }).catch(() => {});
}
