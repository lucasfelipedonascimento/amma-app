'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from '@/lib/client-api';
import { buildBody, type Field, type FormValues } from '@/lib/form';

interface Props {
  /** Texto do botão que abre o formulário. */
  trigger: string;
  /** Título mostrado acima dos campos. */
  title?: string;
  method?: 'POST' | 'PUT' | 'PATCH';
  /** Caminho da API, ex.: `/admin/users/<id>/block`. */
  path: string;
  fields?: readonly Field[];
  /** Valores fixos enviados junto (ex.: status). */
  fixed?: Record<string, unknown>;
  tone?: 'primary' | 'danger' | 'plain';
  /** Texto do botão de envio (padrão: o do gatilho). */
  submit?: string;
  /** Pergunta de confirmação para ações sem campos. */
  confirm?: string;
  /** Mostra o formulário já aberto (para cadastros). */
  open?: boolean;
}

/**
 * Botão que, ao clicar, abre um formulário curto (ou pede confirmação), envia à API pelo proxy e
 * recarrega a página. Serve para todas as ações do painel: aprovar, recusar com motivo, bloquear, cadastrar.
 */
export function ActionForm({
  trigger,
  title,
  method = 'POST',
  path,
  fields = [],
  fixed = {},
  tone = 'primary',
  submit,
  confirm,
  open: initiallyOpen = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [values, setValues] = useState<FormValues>(() =>
    Object.fromEntries(
      fields.map((f) => [f.name, f.defaultValue ?? (f.type === 'checkbox' ? false : '')]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ação crítica sem reautenticação recente: pede o código por SMS e repete o envio.
  const [reauth, setReauth] = useState<null | { sent: boolean; code: string; devCode?: string }>(
    null,
  );

  async function postAuth(step: 'request' | 'verify', body: unknown) {
    const res = await fetch(`/api/auth/reauth/${step}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data: data as { devCode?: string; message?: unknown } };
  }

  async function startReauth() {
    setBusy(true);
    setError(null);
    const r = await postAuth('request', {});
    setBusy(false);
    if (!r.ok) return setError('Não foi possível enviar o código. Tente de novo em instantes.');
    setReauth({ sent: true, code: '', devCode: r.data.devCode });
  }

  async function confirmReauth() {
    if (!reauth) return;
    setBusy(true);
    setError(null);
    const r = await postAuth('verify', { code: reauth.code });
    setBusy(false);
    if (!r.ok) return setError('Código inválido ou expirado.');
    setReauth(null);
    await send();
  }

  async function send() {
    setError(null);
    const built = buildBody(fields, values);
    if (!built.ok) return setError(built.error);
    setBusy(true);
    const r = await callApi(method, path, { ...fixed, ...built.body });
    setBusy(false);
    if (!r.ok) {
      if (r.code === 'REAUTH_REQUIRED') return setReauth({ sent: false, code: '' });
      return setError(r.error);
    }
    setOpen(false);
    setValues(
      Object.fromEntries(
        fields.map((f) => [f.name, f.defaultValue ?? (f.type === 'checkbox' ? false : '')]),
      ),
    );
    router.refresh();
  }

  if (!open)
    return (
      <button type="button" className={`btn ${tone}`} onClick={() => setOpen(true)}>
        {trigger}
      </button>
    );

  if (reauth)
    return (
      <form
        className="action-form"
        onSubmit={(e) => {
          e.preventDefault();
          void (reauth.sent ? confirmReauth() : startReauth());
        }}
      >
        <strong>Confirme que é você</strong>
        <p>Esta é uma ação crítica. Enviamos um código por SMS para o seu celular.</p>
        {reauth.sent && (
          <label>
            <span>Código de 6 dígitos</span>
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={reauth.code}
              onChange={(e) => setReauth({ ...reauth, code: e.target.value.replace(/\D/g, '') })}
            />
            {reauth.devCode && <small>Modo de teste: o código é {reauth.devCode}</small>}
          </label>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="row">
          <button
            type="submit"
            className={`btn ${tone}`}
            disabled={busy || (reauth.sent && reauth.code.length !== 6)}
          >
            {busy ? 'Aguarde…' : reauth.sent ? 'Confirmar e executar' : 'Enviar código'}
          </button>
          <button
            type="button"
            className="btn plain"
            onClick={() => setReauth(null)}
            disabled={busy}
          >
            Cancelar
          </button>
        </div>
      </form>
    );

  return (
    <form
      className="action-form"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {title && <strong>{title}</strong>}
      {fields.length === 0 && <p>{confirm ?? 'Confirmar esta ação?'}</p>}
      {fields.map((f) => (
        <label key={f.name} className={f.type === 'checkbox' ? 'check' : undefined}>
          <span>{f.label}</span>
          {f.type === 'textarea' ? (
            <textarea
              rows={3}
              value={String(values[f.name] ?? '')}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            />
          ) : f.type === 'select' ? (
            <select
              value={String(values[f.name] ?? '')}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            >
              <option value="">Escolha…</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === 'checkbox' ? (
            <input
              type="checkbox"
              checked={values[f.name] === true}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.checked })}
            />
          ) : (
            <input
              type={f.type === 'datetime' ? 'datetime-local' : f.type === 'date' ? 'date' : 'text'}
              inputMode={
                f.type === 'number' ? 'numeric' : f.type === 'money' ? 'decimal' : undefined
              }
              placeholder={f.type === 'money' ? 'R$ 0,00' : undefined}
              value={String(values[f.name] ?? '')}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
            />
          )}
          {f.hint && <small>{f.hint}</small>}
        </label>
      ))}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="submit" className={`btn ${tone}`} disabled={busy}>
          {busy ? 'Enviando…' : (submit ?? trigger)}
        </button>
        <button type="button" className="btn plain" onClick={() => setOpen(false)} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
