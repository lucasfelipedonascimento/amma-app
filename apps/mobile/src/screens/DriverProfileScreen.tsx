import { useState } from 'react';
import { Text } from 'react-native';
import { isValidCpf, isValidVehicleYear, normalizePlate } from '@amma/shared';
import { ApiError, api } from '../api';
import { Button, ErrorText, Field, Screen } from '../ui';

/** Dados pessoais + primeiro veículo do motorista. */
export function DriverProfileScreen({
  initialName,
  onDone,
}: {
  initialName: string;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState(initialName);
  const [cpf, setCpf] = useState('');
  const [birth, setBirth] = useState(''); // DD/MM/AAAA
  const [type, setType] = useState<'MOTO' | 'CARRO'>('MOTO');
  const [plate, setPlate] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const m = birth.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return setError('Data de nascimento no formato DD/MM/AAAA');
    if (!isValidCpf(cpf)) return setError('CPF inválido');
    if (!normalizePlate(plate)) return setError('Placa inválida');
    if (!isValidVehicleYear(Number(year))) return setError('Ano do veículo inválido');
    setBusy(true);
    try {
      await api('/driver/profile', {
        method: 'PUT',
        body: { fullName, cpf, birthDate: `${m[3]}-${m[2]}-${m[1]}` },
      });
      await api('/driver/vehicles', { body: { type, plate, model, year: Number(year) } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro inesperado');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Seus dados" subtitle="Precisamos conferir quem você é e qual veículo usa.">
      <Field
        label="Nome completo"
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
      />
      <Field
        label="CPF"
        value={cpf}
        onChangeText={setCpf}
        keyboardType="number-pad"
        placeholder="000.000.000-00"
      />
      <Field
        label="Data de nascimento"
        value={birth}
        onChangeText={setBirth}
        keyboardType="number-pad"
        placeholder="DD/MM/AAAA"
      />
      <Text style={{ fontWeight: '700', marginTop: 8 }}>Veículo</Text>
      <Button
        title={`Tipo: ${type === 'MOTO' ? 'Moto' : 'Carro'} (toque para trocar)`}
        kind="ghost"
        onPress={() => setType(type === 'MOTO' ? 'CARRO' : 'MOTO')}
      />
      <Field
        label="Placa"
        value={plate}
        onChangeText={setPlate}
        autoCapitalize="characters"
        placeholder="ABC1D23"
      />
      <Field label="Modelo" value={model} onChangeText={setModel} placeholder="Honda CG 160" />
      <Field
        label="Ano"
        value={year}
        onChangeText={setYear}
        keyboardType="number-pad"
        maxLength={4}
      />
      <ErrorText message={error} />
      <Button title="Salvar e continuar" loading={busy} onPress={submit} />
    </Screen>
  );
}
