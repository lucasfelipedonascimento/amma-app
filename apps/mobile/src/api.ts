import { File, UploadType } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

// Emulador Android: http://10.0.2.2:3000. Celular físico: IP do computador na rede (ex.: http://192.168.0.10:3000).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** Endereço do WebSocket de tempo real (mesmo servidor da API). */
export const WS_URL = `${API_URL.replace(/^http/, 'ws')}/ws`;

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const KEY = 'amma.tokens';
let tokens: Tokens | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: () => void = () => {};

export const getAccessToken = () => tokens?.accessToken ?? null;

export const getRefreshToken = () => tokens?.refreshToken ?? null;

export const setSessionLostHandler = (fn: () => void) => (onSessionLost = fn);

export async function loadTokens(): Promise<Tokens | null> {
  const saved = await SecureStore.getItemAsync(KEY);
  tokens = saved ? (JSON.parse(saved) as Tokens) : null;
  return tokens;
}

export async function saveTokens(t: Tokens | null) {
  tokens = t;
  if (t) await SecureStore.setItemAsync(KEY, JSON.stringify(t));
  else await SecureStore.deleteItemAsync(KEY);
}

// Uma só renovação por vez (várias chamadas com token vencido não gastam o mesmo refresh).
function refreshTokens(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      if (!tokens) return false;
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!res.ok) return false;
      await saveTokens((await res.json()) as Tokens);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function messageOf(body: unknown, fallback: string): string {
  const m = (body as { message?: string | string[] } | null)?.message;
  return Array.isArray(m) ? m.join('\n') : (m ?? fallback);
}

interface Options {
  method?: string;
  body?: unknown;
  form?: FormData;
  auth?: boolean;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { method = opts.body || opts.form ? 'POST' : 'GET', auth = true } = opts;
  const send = () => {
    const headers: Record<string, string> = {};
    if (opts.body) headers['content-type'] = 'application/json';
    if (auth && tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
    return fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    });
  };
  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && auth && tokens) {
      if (await refreshTokens()) res = await send();
      else {
        await saveTokens(null);
        onSessionLost();
      }
    }
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, messageOf(data, 'Algo deu errado. Tente novamente.'));
  return data as T;
}

/**
 * Envia um arquivo do celular (multipart). Usa o upload nativo do expo-file-system em vez de
 * fetch + FormData: o fetch do React Native falha com "Network request failed" ao anexar fotos
 * vindas da galeria/câmera em várias versões do Android.
 */
export async function uploadFile<T = unknown>(
  path: string,
  file: { uri: string; mimeType?: string },
  fields: Record<string, string> = {},
): Promise<T> {
  const send = () =>
    new File(file.uri).upload(`${API_URL}${path}`, {
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: file.mimeType ?? 'image/jpeg',
      parameters: fields,
      headers: tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {},
    });
  let res: Awaited<ReturnType<typeof send>>;
  try {
    res = await send();
    if (res.status === 401 && tokens) {
      if (await refreshTokens()) res = await send();
      else {
        await saveTokens(null);
        onSessionLost();
      }
    }
  } catch (e) {
    // Mostra o motivo real (arquivo ilegível x rede) em vez de culpar sempre a internet.
    throw new ApiError(
      0,
      `Falha ao enviar o arquivo: ${e instanceof Error ? e.message : 'erro desconhecido'}`,
    );
  }
  let data: unknown = null;
  try {
    data = res.body ? JSON.parse(res.body) : null;
  } catch {
    /* corpo que não é JSON: segue só com o status */
  }
  if (res.status < 200 || res.status >= 300)
    throw new ApiError(res.status, messageOf(data, 'Algo deu errado. Tente novamente.'));
  return data as T;
}
