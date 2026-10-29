import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { ApiError, api, saveTokens } from '../api';
import { useSession } from '../session';
import { colors } from '../theme';
import { Button, ErrorText, Screen } from '../ui';

/** Tela inicial provisória + sair e excluir conta (LGPD). */
export function HomeScreen() {
  const { me, signOut } = useSession();
  const [error, setError] = useState<string | null>(null);

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
    <Screen
      title={`Olá, ${me?.name ?? ''}`}
      subtitle="Corridas e entregas chegam nas próximas etapas."
    >
      <Text style={{ color: colors.muted }}>Perfis: {me?.roles.join(', ')}</Text>
      <ErrorText message={error} />
      <Button title="Sair" kind="ghost" onPress={() => signOut()} />
      <Button title="Excluir minha conta" kind="danger" onPress={remove} />
    </Screen>
  );
}
