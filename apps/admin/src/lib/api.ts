import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL, AT_COOKIE } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

/** GET autenticado, para páginas de servidor. Sem sessão ou token inválido → tela de entrada. */
export async function apiGet<T>(path: string): Promise<T> {
  const token = (await cookies()).get(AT_COOKIE)?.value;
  if (!token) redirect('/login');
  const res = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 401) redirect('/login');
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Monta uma query ignorando valores vazios. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
