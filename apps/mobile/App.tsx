import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { api } from './src/api';
import { ApprovalScreen, DriverStatus } from './src/screens/ApprovalScreen';
import { DocumentsScreen } from './src/screens/DocumentsScreen';
import { DriverApp } from './src/driver/DriverApp';
import { DriverProfileScreen } from './src/screens/DriverProfileScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PhoneScreen } from './src/screens/PhoneScreen';
import { RoleScreen } from './src/screens/RoleScreen';
import { Signup, SignupScreen } from './src/screens/SignupScreen';
import { SessionProvider, useSession } from './src/session';
import { colors } from './src/theme';

// Sem biblioteca de navegação por enquanto: o estado do usuário decide a tela.
function Root() {
  const { loading, me } = useSession();
  const [signup, setSignup] = useState<Signup | null>(null);
  const [status, setStatus] = useState<DriverStatus | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [view, setView] = useState<'approval' | 'documents'>('approval');
  const isDriver = !!me?.roles.includes('MOTORISTA');

  const loadDriver = useCallback(async () => {
    const [s, vehicles] = await Promise.all([
      api<DriverStatus>('/driver/status'),
      api<{ id: string }[]>('/driver/vehicles'),
    ]);
    setStatus(s);
    setVehicleId(vehicles[0]?.id ?? null);
  }, []);

  useEffect(() => {
    if (isDriver) loadDriver().catch(() => setStatus(null));
  }, [isDriver, loadDriver]);

  if (loading)
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.cream }}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  if (!me) return <PhoneScreen />;
  if (me.needsOnboarding)
    return signup ? (
      <RoleScreen signup={signup} onBack={() => setSignup(null)} />
    ) : (
      <SignupScreen onNext={setSignup} />
    );

  if (isDriver) {
    if (!status)
      return (
        <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.cream }}>
          <ActivityIndicator color={colors.red} />
        </View>
      );
    if (!status.profileComplete || !status.hasVehicle)
      return <DriverProfileScreen initialName={me.name ?? ''} onDone={() => loadDriver()} />;
    if (view === 'documents' && vehicleId) {
      const sent = status.documents.map((d) => d.type);
      return (
        <DocumentsScreen
          vehicleId={vehicleId}
          sent={sent}
          onDone={async () => {
            await loadDriver();
            setView('approval');
          }}
        />
      );
    }
    if (status.approval.status !== 'APROVADO') {
      return (
        <ApprovalScreen
          status={status}
          onSendDocs={() => setView('documents')}
          onRefresh={() => loadDriver()}
        />
      );
    }
    return <DriverApp />;
  }
  return <HomeScreen />;
}

export default function App() {
  return (
    <SessionProvider>
      <Root />
      <StatusBar style="dark" />
    </SessionProvider>
  );
}
