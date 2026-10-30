'use client';

export function LogoutButton() {
  return (
    <button
      type="button"
      className="btn plain"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      }}
    >
      Sair
    </button>
  );
}
