import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Complementa o app.json com o que vem de variáveis de ambiente (nunca commitar chaves):
 * - GOOGLE_MAPS_API_KEY: mapa no Android (e no iOS, se usar o provider do Google);
 * - EAS_PROJECT_ID: necessário para o token de push (rode `eas init` para obter);
 * - GOOGLE_SERVICES_JSON: caminho do google-services.json do Firebase (push no Android).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY } },
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile,
  },
  ios: {
    ...config.ios,
    config: { googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY },
  },
  extra: {
    ...config.extra,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? config.extra?.eas?.projectId },
  },
});
