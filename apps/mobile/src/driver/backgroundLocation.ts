import * as TaskManager from 'expo-task-manager';
import type { LocationObject } from 'expo-location';
import { api, getAccessToken, loadTokens } from '../api';
import { stopBackgroundTask, LOCATION_TASK } from './location';
import { hasPositionListeners, publishPosition } from './positionBus';

/**
 * Tarefa de localização do sistema. PRECISA ser definida no escopo do módulo e importada em
 * `index.ts`, porque o Android/iOS podem acordá-la com o app fechado, antes de qualquer tela existir.
 *
 * - Com o app vivo (há tela escutando): repassa a posição e a tela envia pelo WebSocket.
 * - Sem tela (processo recriado só para isto): envia direto pelo REST. Se o servidor disser que o
 *   motorista não está mais online, a tarefa se desliga sozinha.
 */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const last = (data as { locations?: LocationObject[] }).locations?.at(-1);
  if (!last) return;
  const point = { lat: last.coords.latitude, lng: last.coords.longitude };
  if (hasPositionListeners()) return publishPosition(point);
  try {
    if (!getAccessToken()) await loadTokens();
    if (!getAccessToken()) return stopBackgroundTask();
    const r = await api<{ accepted: boolean }>('/driver/position', { body: point });
    if (!r.accepted) await stopBackgroundTask();
  } catch {
    /* sem rede agora: a próxima leitura tenta de novo */
  }
});
