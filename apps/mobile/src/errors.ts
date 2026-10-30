import { ApiError } from './api';

/** Texto amigável para qualquer erro que chegue à tela. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error && e.message ? e.message : 'Algo deu errado. Tente novamente.';
}

/** Erro de rede (o `api` usa status 0 quando nem chegou ao servidor). */
export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;
