/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin-allow-popups' // Cambiado para permitir ventanas emergentes
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'unsafe-none' // Relajado para permitir recursos externos
          }
        ],
      },
    ];
  },
  // Otras configuraciones...
};

export default nextConfig;
