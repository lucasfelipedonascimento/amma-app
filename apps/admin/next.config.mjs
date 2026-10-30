/** @type {import('next').NextConfig} */
const nextConfig = {
  // O painel nunca fala com o navegador do usuário fora de /api (proxy autenticado): sem CORS na API.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
    ];
  },
};
export default nextConfig;
