import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { SELF_SERVICE_ROLES, type SelfServiceRole } from '@amma/shared';
import { ApiError, api } from '../api';
import { useSession } from '../session';
import { colors } from '../theme';
import { Button, ErrorText, Screen } from '../ui';
import type { Signup } from './SignupScreen';

const LABEL: Record<SelfServiceRole, { title: string; desc: string }> = {
  PASSAGEIRO: { title: 'Passageiro / cliente', desc: 'Peço corridas e entregas.' },
  MOTORISTA: { title: 'Motorista / entregador', desc: 'Faço corridas e entregas (moto ou carro).' },
  COMERCIANTE: { title: 'Comerciante', desc: 'Tenho um comércio e peço entregas.' },
};

/** Escolha de papel(éis). Ao confirmar, envia o cadastro + consentimento ao servidor. */
export function RoleScreen({ signup, onBack }: { signup: Signup; onBack: () => void }) {
  const { reload } = useSession();
  const [roles, setRoles] = useState<SelfServiceRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (r: SelfServiceRole) =>
    setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/me/onboarding', {
        body: {
          name: signup.name,
          roles,
          acceptPrivacyPolicy: true,
          policyVersion: signup.policyVersion,
        },
      });
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro inesperado');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Como você vai usar a AMMA?" subtitle="Você pode escolher mais de um.">
      {SELF_SERVICE_ROLES.map((r) => {
        const on = roles.includes(r);
        return (
          <Pressable
            key={r}
            onPress={() => toggle(r)}
            style={{
              backgroundColor: colors.white,
              borderRadius: 12,
              padding: 16,
              borderWidth: 2,
              borderColor: on ? colors.red : colors.border,
            }}
          >
            <Text style={{ fontWeight: '700', fontSize: 17, color: colors.black }}>
              {LABEL[r].title}
            </Text>
            <Text style={{ color: colors.muted }}>{LABEL[r].desc}</Text>
          </Pressable>
        );
      })}
      <ErrorText message={error} />
      <Button
        title="Concluir cadastro"
        loading={busy}
        disabled={roles.length === 0}
        onPress={submit}
      />
      <Button title="Voltar" kind="ghost" onPress={onBack} />
    </Screen>
  );
}
