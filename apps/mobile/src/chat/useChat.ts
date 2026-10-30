import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { errorMessage } from '../errors';

export interface ChatMessage {
  id: string;
  deliveryId: string;
  body: string;
  createdAt: string;
  fromMe: boolean;
}

type Subscribe = (fn: (event: string, data: unknown) => void) => () => void;

const POLL_MS = 5000;

/**
 * Conversa de um pedido. Carrega o histórico, recebe mensagens pelo tempo real (`chat.message`) e,
 * sem WebSocket, consulta a cada 5 s. `unread` conta o que o outro lado escreveu desde a última vez
 * que a conversa foi aberta.
 */
export function useChat(deliveryId: string, subscribe: Subscribe, realtimeOpen: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const alive = useRef(true);

  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages((cur) => {
      const byId = new Map(cur.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await api<ChatMessage[]>(`/deliveries/${deliveryId}/messages`);
      if (!alive.current) return;
      merge(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      if (alive.current) setError(errorMessage(e));
    }
  }, [deliveryId, merge]);

  useEffect(() => {
    alive.current = true;
    setMessages([]);
    setSeenAt(null);
    void reload();
    const off = subscribe((event, data) => {
      const d = data as { deliveryId?: string; message?: ChatMessage };
      if (event === 'chat.message' && d.deliveryId === deliveryId && d.message) merge([d.message]);
    });
    return () => {
      alive.current = false;
      off();
    };
  }, [deliveryId, merge, reload, subscribe]);

  useEffect(() => {
    if (realtimeOpen) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [realtimeOpen, reload]);

  const send = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text) return false;
      setSending(true);
      setError(null);
      try {
        const m = await api<ChatMessage>(`/deliveries/${deliveryId}/messages`, {
          body: { body: text },
        });
        merge([m]);
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setSending(false);
      }
    },
    [deliveryId, merge],
  );

  /** Chamado ao abrir (e enquanto aberta): tudo o que chegou até agora conta como lido. */
  const markRead = useCallback(() => {
    const last = messages[messages.length - 1];
    if (last) setSeenAt((cur) => (cur && cur >= last.createdAt ? cur : last.createdAt));
  }, [messages]);

  const unread = messages.filter((m) => !m.fromMe && (!seenAt || m.createdAt > seenAt)).length;

  return { messages, unread, error, sending, send, markRead };
}
