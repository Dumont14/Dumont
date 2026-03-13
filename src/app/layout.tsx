// src/app/layout.tsx

import type { Metadata, Viewport } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'AeroBrief — Operational Briefing System',
  description: 'Real-time aviation briefing: METAR, TAF, NOTAMs, field reports and Dumont voice assistant.',
  keywords: ['aviation', 'briefing', 'METAR', 'TAF', 'NOTAM', 'REDEMET', 'AISWEB', 'pilot'],
  authors: [{ name: 'AeroBrief' }],
  robots: 'noindex, nofollow', // operational tool — not for public indexing
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#060a0e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
