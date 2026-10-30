import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

/** true quando o aparelho está sem internet (NetInfo ainda não respondeu = assume que há). */
export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(
    () =>
      NetInfo.addEventListener((s) =>
        setOffline(s.isConnected === false || s.isInternetReachable === false),
      ),
    [],
  );
  return offline;
}
