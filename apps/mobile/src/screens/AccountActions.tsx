import { useState } from 'react';
import { Alert } from 'react-native';
import { ApiError, api, saveTokens } from '../api';
import { useSession } from '../session';
import { Button, ErrorText } from '../ui';

/** Sair e excluir conta (LGPD). `beforeSignOut` limpa o que o perfil precisa (ex.: ficar offline). */
export function AccountActions({ beforeSignOut }: { beforeSignOut?: () => Promise<void> }) {
  const { signOut } = useSession();
  const [error, setError] = useState<string | null>(null);

  const leave = async () => {
    await beforeSignOut?.().catch(() => {});
    await signOut().catch(() => saveTokens(null));
  };

  const remove = () =>
    Alert.alert(
      'Excluir conta',
      'Seus dados pessoais e documentos serão apagados. Isso não pode ser desfeito.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              await api('/me', { method: 'DELETE' });
              await signOut().catch(() => saveTokens(null));
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Erro inesperado');
            }
          },
        },
      ],
    );

  return (
    <>
      <ErrorText message={error} />
      <Button title="Sair" kind="ghost" onPress={leave} />
      <Button title="Excluir minha conta" kind="danger" onPress={remove} />
    </>
  );
}
