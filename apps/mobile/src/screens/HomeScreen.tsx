import { Text } from 'react-native';
import { useSession } from '../session';
import { colors } from '../theme';
import { Screen } from '../ui';
import { AccountActions } from './AccountActions';

/** Tela inicial de quem não é motorista (passageiro/comerciante): por ora, só conta. */
export function HomeScreen() {
  const { me } = useSession();
  return (
    <Screen
      title={`Olá, ${me?.name ?? ''}`}
      subtitle="Corridas e entregas chegam nas próximas etapas."
    >
      <Text style={{ color: colors.muted }}>Perfis: {me?.roles.join(', ')}</Text>
      <AccountActions />
    </Screen>
  );
}
