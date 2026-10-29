import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Role } from '@amma/shared';
import { Tokens, api, getRefreshToken, loadTokens, saveTokens, setSessionLostHandler } from './api';

export interface Me {
  id: string;
  phone: string | null;
  name: string | null;
  roles: Role[];
  needsOnboarding: boolean;
}

interface SessionValue {
  loading: boolean;
  me: Me | null;
  signIn: (phone: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);
export const useSession = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession fora do SessionProvider');
  return v;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);

  const reload = useCallback(async () => {
    setMe(await api<Me>('/me'));
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => setMe(null));
    (async () => {
      try {
        if (await loadTokens()) await reload();
      } catch {
        setMe(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [reload]);

  const value = useMemo<SessionValue>(
    () => ({
      loading,
      me,
      reload,
      signIn: async (phone, code) => {
        const t = await api<Tokens>('/auth/otp/verify', { body: { phone, code }, auth: false });
        await saveTokens({ accessToken: t.accessToken, refreshToken: t.refreshToken });
        await reload();
      },
      signOut: async () => {
        try {
          const refreshToken = getRefreshToken();
          if (refreshToken) await api('/auth/logout', { body: { refreshToken }, auth: false });
        } finally {
          await saveTokens(null);
          setMe(null);
        }
      },
    }),
    [loading, me, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
