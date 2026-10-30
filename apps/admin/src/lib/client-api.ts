import { apiErrorMessage } from './form';

export type CallResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; status: number };

/** Chamada do navegador à API, pelo proxy do painel (o token fica no cookie httpOnly). */
export async function callApi<T = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<CallResult<T>> {
  try {
    const res = await fetch(`/api/proxy${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      if (res.status === 401) window.location.href = '/login';
      return { ok: false, status: res.status, error: apiErrorMessage(data, res.status) };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: 'Sem conexão com o servidor. Tente de novo.' };
  }
}
