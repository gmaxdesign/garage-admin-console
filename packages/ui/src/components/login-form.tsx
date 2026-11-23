import { useState, type FormEvent, type ReactNode } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Input } from './input';
import { Label } from './label';

export interface LoginCredentials {
  username?: string;
  password: string;
  otp?: string;
}

export interface LoginFormProps {
  /** Logo shown in the header badge (each product passes its own asset). */
  logoSrc: string;
  logoAlt: string;
  title: string;
  description: string;
  /**
   * Performs the actual login: request + token persistence + post-auth
   * navigation. Throwing surfaces an error in the form; a 401/403 response is
   * rendered as "Incorrect password".
   */
  onSubmit: (credentials: LoginCredentials) => Promise<void>;
  /** Show a username field (server has ADMIN_USERNAME set). */
  showUsername?: boolean;
  /** Show a 6-digit authenticator code field (server has ADMIN_TOTP_SECRET set). */
  showOtp?: boolean;
  /** Footer override; defaults to the shared Source Code · AGPL-3.0 line. */
  footer?: ReactNode;
}

const DEFAULT_FOOTER = (
  <p className="relative mt-6 text-center text-xs text-muted-foreground">
    <a
      href="https://github.com/eyebrowkang/garage-admin-console"
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-foreground transition-colors"
    >
      Código-fonte
    </a>
    <span className="mx-1.5">·</span>
    Licença AGPL-3.0
  </p>
);

/**
 * Shared login screen for both products. The visual language is identical;
 * each app supplies its branding and an `onSubmit` that owns the request and
 * navigation (React Router navigate, an auth-state flag, etc.).
 */
export function LoginForm({
  logoSrc,
  logoAlt,
  title,
  description,
  onSubmit,
  showUsername = false,
  showOtp = false,
  footer = DEFAULT_FOOTER,
}: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        username: showUsername ? username : undefined,
        password,
        otp: showOtp ? otp : undefined,
      });
    } catch (err) {
      const resp = (err as { response?: { status?: number; data?: { retryAfterSeconds?: number } } })
        ?.response;
      const status = resp?.status;
      if (status === 429) {
        const mins = Math.max(1, Math.ceil((resp?.data?.retryAfterSeconds ?? 900) / 60));
        setError(`Muitas tentativas erradas. Tente de novo em ${mins} min.`);
      } else if (status === 401 || status === 403) {
        setError(
          showOtp || showUsername
            ? 'Usuário, senha ou código incorretos.'
            : 'Senha incorreta.',
        );
      } else {
        setError('Não foi possível entrar. Tente novamente.');
      }
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  const disabled =
    busy ||
    !password.trim() ||
    (showUsername && !username.trim()) ||
    (showOtp && !/^\d{6}$/.test(otp.trim()));

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.16),transparent_55%)]" />

      <Card className="relative w-full max-w-md border-primary/25 shadow-lg">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <img src={logoSrc} alt={logoAlt} className="h-10 w-10" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {showUsername && (
              <div className="space-y-2">
                <Label htmlFor="username">Usuário</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Seu usuário"
                  className="h-11"
                  autoFocus
                  disabled={busy}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Sua senha"
                className="h-11"
                autoFocus={!showUsername}
                disabled={busy}
              />
            </div>
            {showOtp && (
              <div className="space-y-2">
                <Label htmlFor="otp">Código do autenticador</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="h-11 tracking-[0.4em] text-center font-mono text-lg"
                  disabled={busy}
                />
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <LockKeyhole className="h-4 w-4" />
                <AlertTitle>Falha no login</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="h-11 w-full" disabled={disabled}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                'Entrar'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {footer}
    </div>
  );
}
