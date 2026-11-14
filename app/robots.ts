import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: [
      'https://topstock2676.vercel.app/sitemap.xml',
      'https://stock-tracker-five-khaki.vercel.app/sitemap.xml',
    ],
  };
}
