// Módulos nativos que não existem no Jest: trocados por versões mínimas.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-file-system', () => ({ File: jest.fn(), UploadType: { MULTIPART: 'MULTIPART' } }));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3, High: 4 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  getLastKnownPositionAsync: jest.fn(async () => ({
    coords: { latitude: -7.115, longitude: -34.861 },
  })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: -7.115, longitude: -34.861 },
  })),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  geocodeAsync: jest.fn(async () => [{ latitude: -7.115, longitude: -34.861 }]),
  reverseGeocodeAsync: jest.fn(async () => [
    { street: 'Rua das Flores', streetNumber: '10', district: 'Manaíra', city: 'João Pessoa' },
  ]),
}));

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

jest.mock('expo-device', () => ({ isDevice: true }));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abcdefghijklmnop]' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { MAX: 5 },
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));

// O mapa é nativo: nos testes vira uma View que expõe os filhos.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      fitToCoordinates: jest.fn(),
      animateCamera: jest.fn(),
    }));
    return React.createElement(View, { testID: 'map', ...props }, props.children);
  });
  const stub = (name: string) => (props: any) =>
    React.createElement(View, { testID: name, ...props });
  return {
    __esModule: true,
    default: MapView,
    Marker: stub('marker'),
    Polyline: stub('polyline'),
    PROVIDER_GOOGLE: 'google',
  };
});
