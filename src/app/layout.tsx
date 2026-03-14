// src/app/layout.tsx
import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Dumont — Operational Briefing System',
  description: 'Real-time aviation briefing: METAR, TAF, NOTAMs, field reports and Dumont voice assistant.',
  keywords: ['aviation', 'briefing', 'METAR', 'TAF', 'NOTAM', 'REDEMET', 'AISWEB', 'pilot', 'Dumont'],
  authors: [{ name: 'Dumont' }],
  robots: 'noindex, nofollow',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#060a0e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@400;500;600;700&family=Orbitron:wght@400;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
