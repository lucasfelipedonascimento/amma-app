import { useState } from 'react';
import { normalizeBrazilPhone } from '@amma/shared';
import { ApiError, api } from '../api';
import { useSession } from '../session';
import { Button, ErrorText, Field, Screen } from '../ui';

/** Login por telefone com código (OTP). Em desenvolvimento o servidor devolve o código. */
export function PhoneScreen() {
  const { signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro inesperado');
    } finally {
      setBusy(false);
    }
  };

  const request = () =>
    run(async () => {
      if (!normalizeBrazilPhone(phone))
        throw new ApiError(0, 'Digite um celular com DDD. Ex.: (83) 99999-1234');
      const r = await api<{ devCode?: string }>('/auth/otp/request', {
        body: { phone },
        auth: false,
      });
      setDevCode(r.devCode ?? null);
      setSent(true);
    });

  return (
    <Screen
      title="Entrar"
      subtitle={
        sent
          ? 'Digite o código de 6 dígitos que enviamos por SMS.'
          : 'Informe seu celular para receber um código.'
      }
    >
      <Field
        label="Celular"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="(83) 99999-1234"
        editable={!sent}
      />
      {sent ? (
        <>
          {devCode ? <ErrorText message={`[DESENVOLVIMENTO] código: ${devCode}`} /> : null}
          <Field
            label="Código"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
          />
          <ErrorText message={error} />
          <Button
            title="Entrar"
            loading={busy}
            disabled={code.length !== 6}
            onPress={() => run(() => signIn(phone, code))}
          />
          <Button
            title="Usar outro número"
            kind="ghost"
            onPress={() => {
              setSent(false);
              setCode('');
              setError(null);
            }}
          />
        </>
      ) : (
        <>
          <ErrorText message={error} />
          <Button title="Enviar código" loading={busy} onPress={request} />
        </>
      )}
    </Screen>
  );
}
