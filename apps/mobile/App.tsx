import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { BRAND } from '@amma/shared';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>AMMA</Text>
      <Text style={styles.subtitle}>Associação dos Motoboys e Motoristas de Aplicativo</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BRAND.black,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: BRAND.red, fontSize: 48, fontWeight: '800' },
  subtitle: { color: BRAND.cream, fontSize: 16, textAlign: 'center', marginTop: 8 },
});
