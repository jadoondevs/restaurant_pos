import { useState, type FormEvent } from 'react';
import { ChefHat, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Misc';

export function Login() {
  const { login, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Shown after a successful login when mustChangePassword is true.
  const [showPasswordWarning, setShowPasswordWarning] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      // login() sets the user in context; if mustChangePassword is true,
      // show a non-blocking warning. The user can dismiss it and continue.
      // (Forced password change is out of scope for Milestone 1.)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  // After login the AuthContext user is set; App.tsx will render the app.
  // We show the warning here only if the component is still mounted
  // (i.e. the user just logged in and mustChangePassword is true).
  // In practice App.tsx re-renders immediately, so this is a brief flash.
  // The warning is also shown in the Navbar for logged-in users.
  const mustChange = user?.mustChangePassword ?? showPasswordWarning;

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="rounded-xl bg-brand-600 p-3 text-white">
            <ChefHat size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Restaurant POS</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Sign in to continue</p>
        </div>

        {mustChange && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              Your password is set to the default. Please change it in Settings → Security.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading ? <Spinner className="h-5 w-5" /> : 'Sign In'}
          </Button>
        </form>
      </div>
    </div>
  );
}
