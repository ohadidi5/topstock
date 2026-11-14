import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://topstock2676.vercel.app'),
  title: 'top stock | top stock2676 - מעקב מניות ותחזיות אנליסטים',
  applicationName: 'top stock',
  description: 'top stock2676 (top stock) - אפליקציית מעקב מניות, תיק השקעות בזמן אמת ותחזיות אנליסטים מ-TipRanks ו-StockAnalysis.',
  keywords: [
    'top stock2676',
    'topstock2676',
    'top stock 2676',
    'top stock',
    'מעקב מניות',
    'תיק השקעות',
    'תחזיות אנליסטים',
  ],
  manifest: '/manifest.json',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
    },
  },
  openGraph: {
    title: 'top stock | top stock2676',
    description: 'top stock2676 - מעקב תיק השקעות, מניות בזמן אמת ותחזיות אנליסטים',
    siteName: 'top stock2676',
    url: 'https://topstock2676.vercel.app',
    type: 'website',
    images: [
      {
        url: '/icon-512.png',
        width: 512,
        height: 512,
        alt: 'top stock2676',
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'top stock',
  },
  icons: {
    icon: [
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'top stock2676',
    alternateName: ['top stock', 'topstock2676', 'top stock 2676'],
    url: 'https://topstock2676.vercel.app',
    description: 'top stock2676 - Real-time stock portfolio and analyst forecast tracker',
  };

  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-title" content="top stock" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
