import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getDeviceId } from '../lib/device';

interface User { id: string; email: string; createdAt: string }

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const body = await res.json();
      setUser(body?.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const signIn = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, device: getDeviceId() }),
    });
    const body = await res.json();
    if (!res.ok) return { error: body?.error?.message ?? 'Login failed' };
    setUser(body.user);
    window.dispatchEvent(new CustomEvent('fundstueck:adapters-changed'));
    return { error: null };
  };

  const signUp = async (email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, device: getDeviceId() }),
    });
    const body = await res.json();
    if (!res.ok) return { error: body?.error?.message ?? 'Registration failed' };
    setUser(body.user);
    window.dispatchEvent(new CustomEvent('fundstueck:adapters-changed'));
    return { error: null };
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    window.dispatchEvent(new CustomEvent('fundstueck:adapters-changed'));
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
