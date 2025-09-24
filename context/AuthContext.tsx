import { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/services/supabaseClient';

export type AuthUser = {
  id: string;
  email?: string;
};

type AuthContextType = {
    user: AuthUser | null;
    loading: boolean;
    // keep these if you still want password flows
    signInWithEmail: (email: string, password: string) => Promise<void>;
    signUpWithEmail: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    ensureValidUser: () => Promise<AuthUser | null>;
    // NEW:
    sendEmailOtp: (email: string, shouldCreateUser?: boolean) => Promise<void>;
    verifyEmailOtp: (email: string, code: string) => Promise<void>;
  };
const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) setUser({ id: session.user.id, email: session.user.email ?? undefined });
      setLoading(false);
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email ?? undefined });
      } else {
        setUser(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      if (nextAppState === 'active') {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) setUser({ id: session.user.id, email: session.user.email ?? undefined });
      }
    });

    return () => subscription.remove();
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUpWithEmail = async (email: string, password: string, fullName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: undefined,
        data: fullName ? { full_name: fullName, name: fullName } : {},
      },
    });
    if (error) throw error;
    if (data.session?.user) setUser({ id: data.session.user.id, email: data.session.user.email ?? undefined });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const sendEmailOtp = async (email: string, shouldCreateUser = true) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser }, // true = signup-or-login in one call
    });
    if (error) throw error;
  };
  
  const verifyEmailOtp = async (email: string, code: string) => {
    const { data: { session }, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email', // verifies the 6-digit email OTP
    });
    if (error) throw error;
    if (session?.user) {
      const u = { id: session.user.id, email: session.user.email ?? undefined };
      setUser(u);
      await ensureUserRow(u);
    }
  };

  const ensureUserRow = async (_user: AuthUser) => {
    // No-op: using built-in auth.users only. We don't maintain a public users table.
    return;
  };

  const ensureValidUser = async (): Promise<AuthUser | null> => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.user) {
      setUser(null);
      return null;
    }

    const u = { id: session.user.id, email: session.user.email ?? undefined };
    setUser(u);
    return u;
  };

  return (
    <AuthContext.Provider
    value={{
        user,
        loading,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        ensureValidUser,
        sendEmailOtp,
        verifyEmailOtp,
    }}
    >
        {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};


