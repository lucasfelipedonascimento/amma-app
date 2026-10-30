'use client';

import { useState } from 'react';

type Step = 'phone' | 'code';

export function LoginForm({ notice }: { notice?: string }) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const m = (data as { message?: unknown }).message;
        setError(
          Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : 'Não foi possível entrar.',
        );
        return null;
      }
      return data as Record<string, unknown>;
    } catch {
      setError('Sem conexão com o servidor.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    const data = await post('/api/auth/request', { phone });
    if (!data) return;
    setDevCode(typeof data.devCode === 'string' ? data.devCode : null);
    setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (await post('/api/auth/verify', { phone, code })) window.location.href = '/';
  }

  return (
    <form className="login" onSubmit={step === 'phone' ? requestCode : verify}>
      <h1>Painel AMMA</h1>
      <p className="muted">Entre com o celular cadastrado. Você recebe um código por SMS.</p>
      {step === 'phone' ? (
        <label>
          Celular (com DDD)
          <input
            autoFocus
            inputMode="tel"
            autoComplete="tel"
            placeholder="(83) 99999-0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      ) : (
        <label>
          Código de 6 dígitos
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          {devCode && <small>Modo de teste: o código é {devCode}</small>}
        </label>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        className="btn primary"
        disabled={busy || (step === 'phone' ? !phone.trim() : code.length !== 6)}
      >
        {busy ? 'Aguarde…' : step === 'phone' ? 'Receber código' : 'Entrar'}
      </button>
      {step === 'code' && (
        <button type="button" className="btn plain" onClick={() => setStep('phone')}>
          Trocar o celular
        </button>
      )}
    </form>
  );
}
