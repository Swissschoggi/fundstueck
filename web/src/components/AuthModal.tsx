import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Icon } from './Icon';
import styles from './AuthModal.module.css';

export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fn = mode === 'signin' ? signIn : signUp;
    const { error: err } = await fn(email, password);
    setBusy(false);
    if (err) setError(err);
    else { setDone(true); setTimeout(onClose, 800); }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <Icon name="close" size={20} />
        </button>
        <h2 className={styles.title}>{mode === 'signin' ? 'Sign in' : 'Create account'}</h2>
        {done ? (
          <p className={styles.done}>Welcome!</p>
        ) : (
          <form onSubmit={submit} className={styles.form}>
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
            />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.submit} disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
            <button
              type="button"
              className={styles.switch}
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
            >
              {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}