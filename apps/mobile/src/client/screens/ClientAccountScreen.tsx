import { Text } from 'react-native';
import { useSession } from '../../session';
import { colors } from '../../theme';
import { AccountActions } from '../../screens/AccountActions';
import { Heading, Page } from '../../driver/components/layout';

/** Conta de quem pede entregas: dados básicos, sair e excluir a conta (LGPD). */
export function ClientAccountScreen() {
  const { me } = useSession();
  return (
    <Page>
      <Heading>Conta</Heading>
      <Text style={{ color: colors.muted }}>
        {me?.name} · {me?.phone}
      </Text>
      <AccountActions />
    </Page>
  );
}
