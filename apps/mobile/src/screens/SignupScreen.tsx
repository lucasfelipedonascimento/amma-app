import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ApiError, api } from '../api';
import { colors } from '../theme';
import { Button, ErrorText, Field, Screen } from '../ui';

export interface Signup {
  name: string;
  policyVersion: string;
}

/** Cadastro: nome + consentimento LGPD (leitura da política e aceite explícito). */
export function SignupScreen({ onNext }: { onNext: (s: Signup) => void }) {
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<{ version: string; text: string } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ version: string; text: string }>('/legal/privacy-policy', { auth: false })
      .then(setPolicy)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Não foi possível carregar a política'),
      );
  }, []);

  return (
    <Screen title="Criar conta" subtitle="Só pedimos o necessário para a AMMA funcionar.">
      <Field label="Seu nome" value={name} onChangeText={setName} autoCapitalize="words" />
      <Text style={{ fontWeight: '600', color: colors.black }}>Política de privacidade</Text>
      <View
        style={{
          backgroundColor: colors.white,
          borderRadius: 10,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ color: colors.black }}>{policy?.text ?? 'Carregando…'}</Text>
      </View>
      <Pressable
        onPress={() => setAccepted(!accepted)}
        style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: colors.red,
            backgroundColor: accepted ? colors.red : 'transparent',
          }}
        />
        <Text style={{ flex: 1, color: colors.black }}>Li e aceito a política de privacidade.</Text>
      </Pressable>
      <ErrorText message={error} />
      <Button
        title="Continuar"
        disabled={name.trim().length < 2 || !accepted || !policy}
        onPress={() => policy && onNext({ name: name.trim(), policyVersion: policy.version })}
      />
    </Screen>
  );
}
