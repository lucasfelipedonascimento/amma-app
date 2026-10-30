import { Text } from 'react-native';
import { useSession } from '../../session';
import { colors } from '../../theme';
import { Button, ErrorText } from '../../ui';
import { AccountActions } from '../../screens/AccountActions';
import { Card, Heading, Page } from '../components/layout';
import { useDriver } from '../DriverProvider';

/** Conta do motorista: consentimento de localização (revogável), sair e excluir conta. */
export function AccountScreen() {
  const { me } = useSession();
  const d = useDriver();
  return (
    <Page>
      <Heading>Conta</Heading>
      <Text style={{ color: colors.muted }}>
        {me?.name} · {me?.phone}
      </Text>
      <Card>
        <Text style={{ fontWeight: '800', color: colors.black }}>Localização</Text>
        <Text style={{ color: colors.muted }}>
          {d.consented
            ? 'Você autorizou usar a localização enquanto está online.'
            : 'Você ainda não autorizou o uso da localização.'}
        </Text>
        {d.consented ? (
          <Button
            title="Revogar autorização"
            kind="ghost"
            onPress={() => void d.revokeConsent()}
            loading={d.busy}
            disabled={!!d.active}
          />
        ) : null}
        {d.active ? (
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Termine a entrega em andamento para revogar.
          </Text>
        ) : null}
        <ErrorText message={d.actionError} />
      </Card>
      <AccountActions beforeSignOut={d.prepareSignOut} />
    </Page>
  );
}
