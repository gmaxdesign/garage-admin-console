import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoginForm } from '@garage/ui';
import { api, writeStoredToken } from '@/lib/api';

export default function Login() {
  const navigate = useNavigate();
  const [options, setOptions] = useState<{ username: boolean; otp: boolean } | null>(null);

  useEffect(() => {
    api
      .get<{ username: boolean; otp: boolean }>('/auth/options')
      .then((r) => setOptions(r.data))
      .catch(() => setOptions({ username: false, otp: false }));
  }, []);

  if (!options) return null;

  return (
    <LoginForm
      logoSrc="/garage-admin-logo.svg"
      logoAlt="Painel S3"
      title="Painel S3 · StockDL"
      description="Entre para gerenciar o armazenamento."
      showUsername={options.username}
      showOtp={options.otp}
      onSubmit={async (credentials) => {
        const response = await api.post<{ token: string }>('/auth/login', credentials);
        writeStoredToken(response.data.token);
        navigate('/');
      }}
    />
  );
}
