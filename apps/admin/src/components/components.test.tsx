import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const callApi = vi.fn();
vi.mock('@/lib/client-api', () => ({ callApi: (...a: unknown[]) => callApi(...a) }));

import { ActionForm } from './ActionForm';
import { LoginForm } from './LoginForm';
import { Nav } from './Nav';

beforeEach(() => {
  refresh.mockReset();
  callApi.mockReset();
});

describe('ActionForm', () => {
  const props = {
    trigger: 'Bloquear',
    path: '/admin/users/1/block',
    fields: [{ name: 'reason', label: 'Motivo', type: 'textarea', minLength: 10 }],
  } as const;

  it('só abre o formulário ao clicar', async () => {
    render(<ActionForm {...props} />);
    expect(screen.queryByLabelText('Motivo')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    expect(screen.getByLabelText('Motivo')).toBeInTheDocument();
  });

  it('não envia com motivo curto e mostra o erro', async () => {
    render(<ActionForm {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    await userEvent.type(screen.getByLabelText('Motivo'), 'curto');
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/pelo menos 10/);
    expect(callApi).not.toHaveBeenCalled();
  });

  it('envia o corpo, fecha e recarrega a página', async () => {
    callApi.mockResolvedValue({ ok: true, data: {} });
    render(<ActionForm {...props} fixed={{ extra: 1 }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    await userEvent.type(screen.getByLabelText('Motivo'), 'documento falso comprovado');
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(callApi).toHaveBeenCalledWith('POST', '/admin/users/1/block', {
      extra: 1,
      reason: 'documento falso comprovado',
    });
    expect(screen.queryByLabelText('Motivo')).toBeNull();
  });

  it('mostra o erro da API e mantém o formulário', async () => {
    callApi.mockResolvedValue({ ok: false, status: 409, error: 'Esta conta já está bloqueada' });
    render(<ActionForm {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    await userEvent.type(screen.getByLabelText('Motivo'), 'documento falso comprovado');
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta conta já está bloqueada');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ação crítica pede o código por SMS e repete o envio depois de confirmar', async () => {
    callApi
      .mockResolvedValueOnce({ ok: false, status: 403, error: 'x', code: 'REAUTH_REQUIRED' })
      .mockResolvedValueOnce({ ok: true, data: {} });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ devCode: '123456' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<ActionForm {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    await userEvent.type(screen.getByLabelText('Motivo'), 'documento falso comprovado');
    await userEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    expect(await screen.findByText('Confirme que é você')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    await userEvent.type(await screen.findByLabelText(/Código de 6 dígitos/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e executar' }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/reauth/verify',
      expect.objectContaining({ body: JSON.stringify({ code: '123456' }) }),
    );
    expect(callApi).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('ação sem campos pede confirmação', async () => {
    callApi.mockResolvedValue({ ok: true, data: {} });
    render(
      <ActionForm
        trigger="Aprovar"
        path="/x"
        fixed={{ status: 'APROVADO' }}
        confirm="Aprovar este documento?"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(screen.getByText('Aprovar este documento?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(callApi).toHaveBeenCalledWith('POST', '/x', { status: 'APROVADO' }));
  });
});

describe('Nav: menu por papel', () => {
  it('admin vê todas as áreas', () => {
    render(<Nav name="Ana" roles={['ADMIN']} />);
    for (const l of [
      'Painel',
      'Motoristas',
      'Comerciantes',
      'Bloqueios e recursos',
      'Auditoria',
      'Orçamento aberto',
    ])
      expect(screen.getByRole('link', { name: l })).toBeInTheDocument();
  });
  it('sócio só vê transparência', () => {
    render(<Nav name="Beto" roles={['SOCIO']} />);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Painel',
      'Assembleias',
      'Compra coletiva',
      'Orçamento aberto',
    ]);
    expect(screen.getByText(/somente leitura/)).toBeInTheDocument();
  });
});

describe('LoginForm', () => {
  it('pede o código e mostra o de teste', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ devCode: '123456' }), { status: 200 }));
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/Celular/), '83999990000');
    await userEvent.click(screen.getByRole('button', { name: 'Receber código' }));
    expect(await screen.findByText(/o código é 123456/)).toBeInTheDocument();
  });
  it('mostra o motivo quando o telefone não tem acesso', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Este telefone não tem acesso ao painel' }), {
          status: 403,
        }),
      );
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText(/Celular/), '83999990000');
    await userEvent.click(screen.getByRole('button', { name: 'Receber código' }));
    await userEvent.type(await screen.findByLabelText(/Código/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/não tem acesso/);
  });
});
