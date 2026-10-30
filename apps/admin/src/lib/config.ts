/** Endereço da API (só no servidor do painel; o navegador nunca fala direto com ela). */
export const API_URL = process.env.ADMIN_API_URL ?? 'http://localhost:3000';

export const AT_COOKIE = 'amma_at';
export const RT_COOKIE = 'amma_rt';
/** O token de acesso da API dura 15 min; o de renovação dura 30 dias, mas no painel valem 7. */
export const AT_MAX_AGE = 15 * 60;
export const RT_MAX_AGE = 7 * 24 * 60 * 60;

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});
