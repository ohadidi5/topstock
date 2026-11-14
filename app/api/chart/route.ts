import { NextResponse } from 'next/server';
import dns from 'dns';

// Ensure IPv4 is prioritized to prevent Node.js connect timeout on Yahoo Finance endpoints
try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {
  // Ignore in environments where not supported
}

const RANGE_INTERVAL_MAP: Record<string, { range: string; interval: string }> = {
  '1d': { range: '1d', interval: '5m' },
  '1w': { range: '5d', interval: '15m' },
  '5d': { range: '5d', interval: '15m' },
  '1m': { range: '1mo', interval: '1d' },
  '1mo': { range: '1mo', interval: '1d' },
  '1y': { range: '1y', interval: '1d' },
  '5y': { range: '5y', interval: '1wk' },
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawSymbol = (searchParams.get('symbol') || '').trim().toUpperCase();
  const rawRange = (searchParams.get('range') || '1m').trim().toLowerCase();

  if (!/^[A-Z0-9.\-]{1,10}$/.test(rawSymbol)) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
  }

  const config = RANGE_INTERVAL_MAP[rawRange] || RANGE_INTERVAL_MAP['1m'];
  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(rawSymbol)}?range=${config.range}&interval=${config.interval}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(rawSymbol)}?range=${config.range}&interval=${config.interval}`
  ];

  let chartResult: any = null;
  let lastError: any = null;

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const resData = data?.chart?.result?.[0];
      if (resData && Array.isArray(resData.timestamp) && resData.timestamp.length > 0) {
        chartResult = resData;
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!chartResult) {
    return NextResponse.json(
      { error: 'לא הצלחנו להביא נתוני גרף עבור מניה זו כרגע.' },
      { status: 502 }
    );
  }

  const timestamps: number[] = chartResult.timestamp || [];
  const closes: (number | null)[] = chartResult.indicators?.quote?.[0]?.close || [];
  const meta = chartResult.meta || {};

  const points: { time: number; price: number }[] = [];
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  for (let i = 0; i < timestamps.length; i++) {
    const p = closes[i];
    if (typeof p === 'number' && !isNaN(p) && isFinite(p)) {
      const priceVal = Math.round(p * 100) / 100;
      const ts = timestamps[i] * 1000;
      const d = new Date(ts);
      let timeLabel = '';
      if (rawRange === '1d') {
        timeLabel = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      } else if (rawRange === '1w' || rawRange === '5d') {
        timeLabel = `${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
      } else if (rawRange === '1m' || rawRange === '1mo') {
        timeLabel = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
      } else {
        timeLabel = d.toLocaleDateString('he-IL', { month: '2-digit', year: '2-digit' });
      }

      points.push({
        time: timeLabel,
        timestamp: ts,
        price: priceVal,
        close: priceVal,
      } as any);

      if (priceVal < minPrice) minPrice = priceVal;
      if (priceVal > maxPrice) maxPrice = priceVal;
    }
  }

  if (points.length === 0) {
    return NextResponse.json({ error: 'אין מספיק נתוני היסטוריה עבור מניה זו.' }, { status: 404 });
  }

  const firstPrice = points[0].price;
  const lastPrice = points[points.length - 1].price;
  const periodChange = Math.round((lastPrice - firstPrice) * 100) / 100;
  const periodChangePercent = firstPrice > 0 ? Math.round(((lastPrice - firstPrice) / firstPrice) * 10000) / 100 : 0;

  return NextResponse.json({
    symbol: rawSymbol,
    range: rawRange,
    currency: meta.currency || 'USD',
    previousClose: meta.chartPreviousClose || firstPrice,
    currentPrice: meta.regularMarketPrice || lastPrice,
    firstPrice,
    lastPrice,
    periodChange,
    periodChangePercent,
    minPrice: isFinite(minPrice) ? minPrice : lastPrice,
    maxPrice: isFinite(maxPrice) ? maxPrice : lastPrice,
    points,
  });
}
