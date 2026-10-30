/** Em produção a API não sobe com as credenciais padrão de desenvolvimento (docker-compose). */
export function assertProductionConfig(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV !== 'production') return;
  const problems: string[] = [];
  if (!env.DATABASE_URL) problems.push('DATABASE_URL não definida');
  else if (/amma_dev/.test(env.DATABASE_URL))
    problems.push('DATABASE_URL usa a senha padrão de desenvolvimento');
  if (!env.REDIS_URL) problems.push('REDIS_URL não definida');
  if (!env.PUBLIC_BASE_URL?.startsWith('https://'))
    problems.push('PUBLIC_BASE_URL deve ser https://');
  if (env.ROUTE_PROVIDER === 'mapbox' && !(Number(env.ROUTE_DAILY_LIMIT) > 0))
    problems.push('ROUTE_DAILY_LIMIT (teto diário de rotas pagas) deve ser maior que 0 com Mapbox');
  if (env.PAYMENT_PROVIDER && env.PAYMENT_PROVIDER !== 'sandbox' && !env.PAYMENT_WEBHOOK_SECRET)
    problems.push(
      'PAYMENT_WEBHOOK_SECRET não definido (assinatura dos avisos do provedor de pagamento)',
    );
  if (problems.length) throw new Error(`Configuração de produção insegura: ${problems.join('; ')}`);
}
