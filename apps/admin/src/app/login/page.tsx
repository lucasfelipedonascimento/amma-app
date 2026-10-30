import { LoginForm } from '@/components/LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  return (
    <main>
      <LoginForm
        notice={
          erro === 'sem-acesso'
            ? 'Este telefone não tem acesso ao painel (só administradores e sócios).'
            : undefined
        }
      />
    </main>
  );
}
