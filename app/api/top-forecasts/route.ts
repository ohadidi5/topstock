import { NextResponse } from 'next/server';

export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';

const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractJson(text: string): any | null {
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    try {
      return JSON.parse(text.slice(objStart, objEnd + 1));
    } catch {}
  }
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    try {
      return { stocks: JSON.parse(text.slice(arrStart, arrEnd + 1)) };
    } catch {}
  }
  return null;
}

function parseNum(v: any): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^0-9.\-]/g, '');
    const p = parseFloat(cleaned);
    if (!isNaN(p) && isFinite(p)) return p;
  }
  return null;
}

export async function GET() {
  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on the server' }, { status: 500 });
  }

  const prompt = `Read the top analyst stock pages from StockAnalysis and TipRanks:
1. https://stockanalysis.com/analysts/top-stocks/
2. https://www.tipranks.com/stocks/top-analyst-stocks

Find the top 8 "Strong Buy" stocks that have the HIGHEST analyst price target upside percentage right now.
For each stock, extract:
- "symbol": stock ticker symbol (e.g. "CGNX", "AFRM", "GEV")
- "name": full company name
- "averagePriceTarget": numeric average analyst price target in USD (e.g. 76.30)
- "pageUpsidePercent": numeric upside percentage shown on the page (e.g. 50.29)
- "analystCount": exact number of analysts found covering the stock (integer, e.g. 10, 16, 22)
- "consensusRating": e.g. "Strong Buy"
- "specializationHe": 1-2 sentences IN HEBREW explaining exactly what this company specializes in, its products/services, and industry (במה החברה מתמחה)
- "analystRationaleHe": 1-2 detailed sentences IN HEBREW explaining specifically why Wall Street analysts expect this stock to surge so much (למה האנליסטים צופים שהיא תעלה כל כך הרבה: צמיחה, רווחיות, ביקוש למוצריה, זרזים עסקיים)

Return ONLY a JSON object (no markdown, no backticks) with this exact structure:
{
  "stocks": [
    {
      "symbol": "TICKER",
      "name": "Company Name",
      "averagePriceTarget": 100.0,
      "pageUpsidePercent": 50.0,
      "analystCount": 12,
      "consensusRating": "Strong Buy",
      "specializationHe": "החברה מתמחה בפיתוח מערכות ראייה ממוחשבת וחיישנים חכמים לאוטומציה תעשייתית...",
      "analystRationaleHe": "האנליסטים צופים עלייה חדה עקב התאוששות שוק האלקטרוניקה, גידול בביקוש לאוטומציה במחסנים וצמיחה צפויה ברווח למניה..."
    }
  ]
}`;

  let lastError = 'Unknown error';

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              tools: [{ url_context: {} }],
              generationConfig: {
                temperature: 0,
                maxOutputTokens: 4096,
              },
            }),
            signal: AbortSignal.timeout(50000),
          }
        );

        const data = await res.json();
        if (!res.ok) {
          lastError = `${model}: ${data?.error?.message || res.status}`;
          if (res.status === 429) break;
          if (res.status === 503 && attempt === 1) {
            await sleep(1500);
            continue;
          }
          break;
        }

        const candidate = data?.candidates?.[0];
        const text = (candidate?.content?.parts || [])
          .filter((p: any) => typeof p.text === 'string')
          .map((p: any) => p.text)
          .join('');

        const parsed = extractJson(text);
        const rawList: any[] = Array.isArray(parsed?.stocks) ? parsed.stocks : [];

        if (rawList.length === 0) {
          lastError = `${model}: Empty stocks list returned`;
          continue;
        }

        // Fetch live current market prices from Finnhub for all candidate stocks in parallel
        const enriched = await Promise.all(
          rawList.map(async (item) => {
            const symbol = String(item.symbol || '').trim().toUpperCase();
            if (!symbol || !/^[A-Z0-9.\-]{1,10}$/.test(symbol)) return null;

            const avgTarget = parseNum(item.averagePriceTarget);
            const pageUpside = parseNum(item.pageUpsidePercent);
            if (!avgTarget || avgTarget <= 0) return null;

            let livePrice: number | null = null;
            try {
              const qRes = await fetch(
                `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`,
                { signal: AbortSignal.timeout(5000) }
              );
              if (qRes.ok) {
                const qData = await qRes.json();
                if (typeof qData?.c === 'number' && qData.c > 0) {
                  livePrice = qData.c;
                }
              }
            } catch {}

            // If Finnhub didn't return a live price, derive approximate price from target and pageUpside
            if (!livePrice && pageUpside !== null && pageUpside > -90) {
              livePrice = Math.round((avgTarget / (1 + pageUpside / 100)) * 100) / 100;
            }

            if (!livePrice || livePrice <= 0) return null;

            const upsidePercent = ((avgTarget - livePrice) / livePrice) * 100;
            const analystCount = parseNum(item.analystCount) || 10;
            const specialization = String(item.specializationHe || item.specialization || '').trim();
            const rationale = String(item.analystRationaleHe || item.reasonHe || 'קונצנזוס קנייה חזקה מצד האנליסטים עם פוטנציאל עלייה גבוה.').trim();

            return {
              symbol,
              name: String(item.name || symbol).trim(),
              currentPrice: livePrice,
              averagePriceTarget: avgTarget,
              upsidePercent: Math.round(upsidePercent * 100) / 100,
              analystCount,
              consensusRating: String(item.consensusRating || 'Strong Buy').trim(),
              specializationHe: specialization,
              analystRationaleHe: rationale,
              reasonHe: rationale,
            };
          })
        );

        const validStocks = enriched
          .filter((s): s is NonNullable<typeof s> => s !== null && s.upsidePercent > 0)
          .sort((a, b) => b.upsidePercent - a.upsidePercent);

        if (validStocks.length === 0) {
          lastError = `${model}: No valid stocks with positive upside`;
          continue;
        }

        return NextResponse.json({
          topStock: validStocks[0],
          stocks: validStocks,
          sources: ['StockAnalysis.com', 'TipRanks'],
          scannedAt: new Date().toISOString(),
          model,
        });
      } catch (err: any) {
        lastError = `${model}: ${err?.message || err}`;
        if (attempt === 1) {
          await sleep(1500);
          continue;
        }
      }
    }
  }

  console.error('Top forecasts scan failed:', lastError);
  return NextResponse.json(
    { error: 'שירות החיפוש חווה עומס רגעי. אנא נסה שוב בעוד מספר שניות.' },
    { status: 503 }
  );
}
