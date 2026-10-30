import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DOCUMENT_LABEL,
  ELIGIBILITY_PROBLEMS,
  GENDERS,
  RIDE_VEHICLE_LABEL,
  type DocumentType,
  type Gender,
} from '@amma/shared';
import { api } from '../../api';
import { errorMessage } from '../../errors';
import { DocumentsScreen } from '../../screens/DocumentsScreen';
import { colors } from '../../theme';
import { Button, ErrorText } from '../../ui';
import { Card } from './layout';
import type { RideEligibility } from '../types';

const GENDER_LABEL: Record<Gender, string> = {
  FEMININO: 'Feminino',
  MASCULINO: 'Masculino',
  NAO_INFORMADO: 'Prefiro não informar',
};

/**
 * Corridas de passageiro: o que as regras municipais vigentes pedem de cada veículo, o que falta e o
 * envio dos documentos extras. Também a autodeclaração de gênero da opção "motorista mulher".
 */
export function RideEligibilityCard() {
  const [data, setData] = useState<RideEligibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<{ vehicleId: string; types: DocumentType[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<RideEligibility>('/driver/ride-eligibility'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const declare = async (gender: Gender) => {
    setBusy(true);
    setError(null);
    try {
      await api('/driver/gender', { method: 'PUT', body: { gender } });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (sending)
    return (
      <DocumentsScreen
        vehicleId={sending.vehicleId}
        sent={[]}
        types={sending.types}
        doneLabel="Voltar"
        onDone={() => {
          setSending(null);
          void load();
        }}
      />
    );

  return (
    <Card>
      <Text style={s.title}>Corridas de passageiro</Text>
      {!data ? (
        <Text style={s.muted}>{error ?? 'Carregando…'}</Text>
      ) : (
        <>
          {data.warning ? <Text style={s.warn}>{data.warning}</Text> : null}
          {data.vehicles.length === 0 ? (
            <Text style={s.muted}>Cadastre um veículo para receber corridas.</Text>
          ) : null}
          {data.vehicles.map((v) => (
            <View key={v.id} style={s.vehicle} testID={`ride-vehicle-${v.plate}`}>
              <Text style={s.bold}>
                {RIDE_VEHICLE_LABEL[v.type]} · {v.model} {v.year} · {v.plate}
              </Text>
              {v.eligible ? (
                <Text style={{ color: colors.ok }}>Habilitado para corridas</Text>
              ) : (
                <>
                  {v.problems.map((p) => (
                    <Text key={p} style={s.muted}>
                      • {ELIGIBILITY_PROBLEMS[p]}
                    </Text>
                  ))}
                  {v.documentsToSend.length > 0 ? (
                    <Button
                      title={`Enviar: ${v.documentsToSend
                        .map((t) => DOCUMENT_LABEL[t as DocumentType])
                        .join(', ')}`}
                      kind="ghost"
                      onPress={() =>
                        setSending({ vehicleId: v.id, types: v.documentsToSend as DocumentType[] })
                      }
                    />
                  ) : null}
                </>
              )}
            </View>
          ))}

          <Text style={s.bold}>Opção “motorista mulher”</Text>
          <Text style={s.muted}>
            Se você se declarar do gênero feminino e a associação conferir, passa a receber pedidos
            de passageiros que preferem motorista mulher.
          </Text>
          <View style={s.row}>
            {GENDERS.map((g) => (
              <Pressable
                key={g}
                onPress={() => void declare(g)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityState={{ selected: data.gender === g }}
                style={[s.chip, data.gender === g && s.chipOn]}
              >
                <Text style={[s.chipText, data.gender === g && { color: colors.white }]}>
                  {GENDER_LABEL[g]}
                </Text>
              </Pressable>
            ))}
          </View>
          {data.gender === 'FEMININO' ? (
            <Text style={{ color: data.womenDriverVerified ? colors.ok : colors.warn }}>
              {data.womenDriverVerified
                ? 'Conferido pela associação ✓'
                : 'Aguardando a conferência da associação.'}
            </Text>
          ) : null}
        </>
      )}
      <ErrorText message={data ? error : null} />
    </Card>
  );
}

const s = StyleSheet.create({
  title: { color: colors.black, fontWeight: '800', fontSize: 16 },
  bold: { color: colors.black, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 14 },
  warn: { color: colors.warn, fontSize: 13 },
  vehicle: { gap: 4, paddingVertical: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.red, borderColor: colors.red },
  chipText: { color: colors.black, fontSize: 13 },
});
