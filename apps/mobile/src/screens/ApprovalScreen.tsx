import { Text, View } from 'react-native';
import type { ApprovalStatus, DocumentType } from '@amma/shared';
import { colors } from '../theme';
import { Button, Screen } from '../ui';

export interface DriverStatus {
  approval: { status: ApprovalStatus; missing: DocumentType[]; rejected: DocumentType[] };
  profileComplete: boolean;
  hasVehicle: boolean;
  vehicleId?: string;
  documents: {
    id: string;
    type: DocumentType;
    status: ApprovalStatus;
    rejectionReason: string | null;
  }[];
}

const TEXT: Record<ApprovalStatus, { title: string; msg: string; color: string }> = {
  PENDENTE: {
    title: 'Em análise',
    msg: 'Recebemos seus dados. Avisaremos quando a análise terminar.',
    color: colors.warn,
  },
  APROVADO: {
    title: 'Aprovado ✓',
    msg: 'Tudo certo! Você já pode atender corridas e entregas.',
    color: colors.ok,
  },
  REPROVADO: {
    title: 'Precisa de correção',
    msg: 'Algum documento foi reprovado. Veja o motivo e envie novamente.',
    color: colors.red,
  },
};
const NAME: Record<DocumentType, string> = {
  CNH: 'CNH',
  DOCUMENTO_VEICULO: 'Documento do veículo',
  FOTO: 'Foto',
};

/** Estado da aprovação do motorista (PENDENTE / APROVADO / REPROVADO). */
export function ApprovalScreen({
  status,
  onSendDocs,
  onRefresh,
}: {
  status: DriverStatus;
  onSendDocs: () => void;
  onRefresh: () => void;
}) {
  const t = TEXT[status.approval.status];
  return (
    <Screen title="Aprovação do cadastro">
      <View
        style={{
          backgroundColor: colors.white,
          borderRadius: 12,
          padding: 16,
          borderLeftWidth: 6,
          borderLeftColor: t.color,
          gap: 4,
        }}
      >
        <Text style={{ fontWeight: '800', fontSize: 20, color: t.color }}>{t.title}</Text>
        <Text style={{ color: colors.black }}>{t.msg}</Text>
      </View>
      {status.approval.missing.length > 0 ? (
        <Text style={{ color: colors.warn }}>
          Faltam: {status.approval.missing.map((m) => NAME[m]).join(', ')}
        </Text>
      ) : null}
      {status.documents
        .filter((d) => status.approval.rejected.includes(d.type) && d.status === 'REPROVADO')
        .map((d) => (
          <Text key={d.id} style={{ color: colors.red }}>
            {NAME[d.type]} reprovado: {d.rejectionReason ?? 'sem motivo informado'}
          </Text>
        ))}
      {status.approval.status !== 'APROVADO' ? (
        <Button title="Enviar / reenviar documentos" onPress={onSendDocs} />
      ) : null}
      <Button title="Atualizar" kind="ghost" onPress={onRefresh} />
    </Screen>
  );
}
