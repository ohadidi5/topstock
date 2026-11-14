import { NextResponse } from 'next/server';

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';

// In-memory cache for upcoming earnings (6 hours TTL) to ensure ultra-fast responses and conserve rate limits
const earningsCache = new Map<string, { nextEarnings: any; expiresAt: number }>();

async function getNextEarnings(symbol: string) {
  const cached = earningsCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.nextEarnings;
  }

  try {
    const pastDate = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0];
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${pastDate}&to=${futureDate}&symbol=${symbol}&token=${FINNHUB_API_KEY}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];

    const recent = list
      .filter((e: any) => e.date && e.date <= today && (e.epsActual !== null && e.epsActual !== undefined || e.revenueActual !== null && e.revenueActual !== undefined))
      .sort((a: any, b: any) => b.date.localeCompare(a.date))[0];

    const upcoming = list
      .filter((e: any) => e.date && e.date >= today)
      .sort((a: any, b: any) => a.date.localeCompare(b.date))[0];

    // If an earnings report was released in the last 14 days and upcoming is either today or further away, prioritize recent so the red badge shows
    const chosen = (recent && (!upcoming || upcoming.date === today)) ? recent : (upcoming || recent);

    const result = chosen
      ? {
          date: chosen.date,
          hour: chosen.hour || null,
          quarter: chosen.quarter || null,
          year: chosen.year || null,
          hasReported: Boolean(chosen.epsActual !== null && chosen.epsActual !== undefined || chosen.revenueActual !== null && chosen.revenueActual !== undefined),
          isToday: chosen.date === today,
        }
      : null;

    earningsCache.set(symbol, {
      nextEarnings: result,
      expiresAt: Date.now() + 6 * 3600 * 1000,
    });
    return result;
  } catch (err) {
    return null;
  }
}

// In-memory cache for stock dividends (6 hours TTL)
const dividendCache = new Map<string, { dividend: { yieldPercent: number; annualPerShare: number } | null; expiresAt: number }>();

async function getStockDividend(symbol: string) {
  const cached = dividendCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.dividend;
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_API_KEY}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const metric = data?.metric;
    const yieldAnnual = typeof metric?.dividendYieldIndicatedAnnual === 'number' ? metric.dividendYieldIndicatedAnnual : (typeof metric?.['dividendYield5Y'] === 'number' ? metric['dividendYield5Y'] : 0);
    const dpsAnnual = typeof metric?.dividendPerShareAnnual === 'number' ? metric.dividendPerShareAnnual : (typeof metric?.dividendPerShareTTM === 'number' ? metric.dividendPerShareTTM : 0);

    const result = (yieldAnnual > 0 || dpsAnnual > 0)
      ? {
          yieldPercent: yieldAnnual,
          annualPerShare: dpsAnnual,
        }
      : null;

    dividendCache.set(symbol, {
      dividend: result,
      expiresAt: Date.now() + 6 * 3600 * 1000,
    });
    return result;
  } catch (err) {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get('symbols');

  if (!symbols) {
    return NextResponse.json({ quotes: {} });
  }

  const symbolArray = symbols.split(',').map((s) => s.trim()).filter(Boolean);

  try {
    const quotes = await Promise.all(
      symbolArray.map(async (symbol) => {
        try {
          const [quoteRes, earnings, dividend] = await Promise.all([
            fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`, {
              signal: AbortSignal.timeout(5000),
            }).then((r) => (r.ok ? r.json() : null)),
            getNextEarnings(symbol),
            getStockDividend(symbol),
          ]);
          return { symbol, data: quoteRes, earnings, dividend };
        } catch {
          return { symbol, data: null, earnings: null, dividend: null };
        }
      })
    );

    // Format to match what the frontend expects
    const results = quotes.reduce((acc: any, { symbol, data, earnings, dividend }) => {
      if (data && data.c) {
        acc[symbol] = {
          symbol,
          regularMarketPrice: data.c,
          regularMarketChange: data.d,
          regularMarketChangePercent: data.dp,
          nextEarnings: earnings,
          dividend: dividend || null,
        };
      }
      return acc;
    }, {} as Record<string, any>);

    return NextResponse.json({ quotes: results });
  } catch (error) {
    console.error('Quotes error:', error);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}
