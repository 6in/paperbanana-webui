import { useState } from 'react';
import { GoogleLogin, GoogleOAuthProvider, type CredentialResponse } from '@react-oauth/google';
import { ShieldCheck } from 'lucide-react';

interface AuthUser {
  name: string;
  email: string;
  authenticated_at: string;
}

interface AuthGateProps {
  googleClientId: string;
  backendOrigin: string;
  apiPrefix: string;
  onAuthenticated: (user: AuthUser) => void;
  initialError?: string | null;
}

export function AuthGate({ googleClientId, backendOrigin, apiPrefix, onAuthenticated, initialError }: AuthGateProps) {
  const [error, setError] = useState<string | null>(initialError ?? null);

  const verifyGoogleToken = async (credentialResponse: CredentialResponse) => {
    const idToken = credentialResponse.credential;
    if (!idToken) {
      setError('Google credential is missing.');
      return;
    }
    try {
      const response = await fetch(`${backendOrigin}${apiPrefix}/api/auth/google/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id_token: idToken }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || 'Authentication failed');
      }
      const data = await response.json();
      onAuthenticated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="mb-5 flex items-center gap-2 text-slate-700">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          <h1 className="text-lg font-semibold">Sign in required</h1>
        </div>
        <p className="mb-5 text-sm text-slate-600">
          This environment requires Google authentication before using PaperBanana Web UI.
        </p>
        {googleClientId ? (
          <GoogleOAuthProvider clientId={googleClientId}>
            <GoogleLogin
              onSuccess={verifyGoogleToken}
              onError={() => setError('Google login failed.')}
              useOneTap={false}
            />
          </GoogleOAuthProvider>
        ) : (
          <p className="text-sm text-red-600">GOOGLE_CLIENT_ID is not configured on server.</p>
        )}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
