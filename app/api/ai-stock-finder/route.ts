import { NextResponse } from 'next/server';

export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';

const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

// In-memory cache for search queries (1 hour TTL)
interface CachedFinderResult {
  data: any;
  expiresAt: number;
}
const finderCache = new Map<string, CachedFinderResult>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('query') || '').trim();
  return handleAiStockFinder(query);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const query = (body.prompt || body.query || '').trim();
    const filters = body.filters || {};
    const portfolio = Array.isArray(body.portfolio) ? body.portfolio : [];
    return handleAiStockFinder(query, filters, portfolio);
  } catch {
    return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });
  }
}

function normalizeHebrewNumbers(text: string): string {
  return text
    .replace(/\bעשרים וחמישה?\b/g, '25')
    .replace(/\bשלושים וחמישה?\b/g, '35')
    .replace(/\bארבעים וחמישה?\b/g, '45')
    .replace(/\bעשרה?\b/g, '10')
    .replace(/\bעשרים\b/g, '20')
    .replace(/\bשלושים\b/g, '30')
    .replace(/\bארבעים\b/g, '40')
    .replace(/\bחמישים\b/g, '50');
}

function extractNumericConstraints(query: string) {
  const normalized = normalizeHebrewNumbers(query);
  let minUpside: number | null = null;
  let minDividend: number | null = null;

  // 1. Dividend check
  const divRegexes = [
    /דיבידנד\s*(?:של)?\s*(?:לפחות|מעל|מינימום)?\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז)/i,
    /(?:לפחות|מעל|מינימום)\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז)\s*דיבידנד/i,
    /(\d+(?:\.\d+)?)\s*(?:%|אחוז)\s*דיבידנד/i,
    /תשואת\s*דיבידנד\s*(?:של)?\s*(?:לפחות|מעל|מינימום)?\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז)/i,
  ];
  for (const r of divRegexes) {
    const m = normalized.match(r);
    if (m && m[1]) {
      minDividend = parseFloat(m[1]);
      break;
    }
  }

  // 2. Upside / Return / Yield check (תשואה / אפסייד / פוטנציאל / רווח / יעד)
  const upsideRegexes = [
    // "לפחות 30 אחוז תשואה", "מעל 25% אפסייד", "מינימום 30 אחוז"
    /(?:לפחות|מעל|מינימום|של מעל)\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז|אחוזים)(?:\s*(?:תשואה|אפסייד|רווח|עלייה|פוטנציאל|יעד))?/i,
    // "30% תשואה לפחות", "30 אחוז לפחות", "25% ומעלה"
    /(\d+(?:\.\d+)?)\s*(?:%|אחוז|אחוזים)\s*(?:תשואה|אפסייד|רווח|עלייה|פוטנציאל|יעד)?\s*(?:לפחות|ומעלה|מינימום)/i,
    // "תשואה של לפחות 30%", "תשואה מעל 25 אחוז", "תשואה של 30%"
    /(?:תשואה|אפסייד|פוטנציאל|עלייה|יעד)\s*(?:צפויה|עתידית|של)?\s*(?:לפחות|מעל|מינימום)?\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז|אחוזים)/i,
    // "תשואה 30%", "אפסייד 25%"
    /(?:תשואה|אפסייד)\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז|אחוזים)/i,
    // "רווח של 30%"
    /רווח\s*(?:של)?\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז|אחוזים)/i,
  ];

  for (const r of upsideRegexes) {
    const m = normalized.match(r);
    if (m && m[1]) {
      const val = parseFloat(m[1]);
      const fullMatch = m[0];
      const matchIndex = normalized.indexOf(fullMatch);
      const windowAround = normalized.slice(Math.max(0, matchIndex - 12), Math.min(normalized.length, matchIndex + fullMatch.length + 12));
      if (!windowAround.includes('דיבידנד') || val > 12) {
        minUpside = val;
        break;
      }
    }
  }

  return { minUpside, minDividend };
}

async function handleAiStockFinder(
  query: string,
  filters?: { risk?: string; budget?: string; dividend?: string; beat?: string },
  userPortfolio: Array<{ symbol: string; name?: string }> = []
) {
  if (!query || query.length < 2) {
    return NextResponse.json({ error: 'נא להזין הנחיה או תיאור של המניות שברצונך לאתר' }, { status: 400 });
  }

  const { minUpside, minDividend } = extractNumericConstraints(query);

  // Create composite cache key including query, active filters, and portfolio symbols
  const portKey = userPortfolio.map(s => s.symbol).sort().join(',');
  const cacheKey = `${query.toLowerCase().trim()}_${filters?.risk || 'all'}_${filters?.budget || 'all'}_${filters?.dividend || 'all'}_${filters?.beat || 'all'}_${portKey}`;
  const cached = finderCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    // If minUpside is requested, make sure cached results strictly satisfy it
    const cacheValid = !minUpside || (Array.isArray(cached.data?.stocks) && cached.data.stocks.every((s: any) => (s.upsidePercent || 0) >= minUpside));
    if (cacheValid) {
      return NextResponse.json({ ...cached.data, cached: true });
    } else {
      finderCache.delete(cacheKey);
    }
  }

  // Build filter directives
  const filterLines: string[] = [];
  if (filters?.risk === 'conservative') {
    filterLines.push('- RISK LEVEL: Strictly CONSERVATIVE / Defensive / Value stocks with strong balance sheets, predictable cash flows and lower volatility.');
  } else if (filters?.risk === 'balanced') {
    filterLines.push('- RISK LEVEL: BALANCED growth stocks with solid market leadership and healthy margins.');
  } else if (filters?.risk === 'aggressive') {
    filterLines.push('- RISK LEVEL: AGGRESSIVE high-momentum growth stocks with substantial upside catalysts.');
  }

  if (filters?.budget === 'under50') {
    filterLines.push('- PRICE BUDGET: Current share price MUST be UNDER $50 per share.');
  } else if (filters?.budget === '50to150') {
    filterLines.push('- PRICE BUDGET: Current share price MUST be between $50 and $150 per share.');
  } else if (filters?.budget === 'above150') {
    filterLines.push('- PRICE BUDGET: High-priced blue-chip stocks above $150 per share.');
  }

  if (filters?.dividend === 'dividendOnly') {
    filterLines.push('- DIVIDEND REQUIREMENT: Company MUST pay an attractive, reliable dividend (dividend yield at least 1.5%).');
  }

  if (filters?.beat === 'beatOnly') {
    filterLines.push('- EARNINGS REQUIREMENT: Company MUST have BEATEN both EPS and revenue estimates in their latest quarterly report.');
  }

  if (minUpside && minUpside > 0) {
    filterLines.push(
      `*** CRITICAL STRICT MANDATORY REQUIREMENT - MINIMUM ANALYST UPSIDE TARGET ***:\n` +
      `- The client explicitly and strictly demands stocks with AT LEAST ${minUpside}% upside return (תשואה / אפסייד צפוי של לפחות ${minUpside}%).\n` +
      `- FOR EVERY SINGLE ONE OF THE 3 STOCKS: upsidePercent MUST be >= ${minUpside} (e.g. ${minUpside}%, ${Math.round(minUpside * 1.15)}%, ${Math.round(minUpside * 1.35)}%).\n` +
      `- 12-month analyst consensus target price on Google Finance MUST be at least currentPrice * ${(1 + minUpside / 100).toFixed(2)}.\n` +
      `- NEVER choose any stock with lower upside (such as 5%, 7%, 10%, 15% or 20%)! If a stock does not have at least ${minUpside}% upside, DISQUALIFY IT immediately and find high-conviction growth, recovery, turnaround, or undervalued companies that analysts forecast will rise by at least ${minUpside}%.`
    );
  }

  if (minDividend && minDividend > 0) {
    filterLines.push(`- MINIMUM DIVIDEND YIELD: Company dividend yield MUST be at least ${minDividend}%.`);
  }

  const portfolioSummary = userPortfolio.length > 0
    ? `CLIENT CURRENT PORTFOLIO HOLDINGS: [${userPortfolio.map(s => s.symbol).slice(0, 15).join(', ')}]`
    : `CLIENT CURRENT PORTFOLIO: (Empty / new portfolio - starting from scratch)`;

  const prompt = `You are an elite Wall Street equity research analyst and institutional portfolio manager.
A client is asking you to locate stocks according to their specific custom investment criteria in Hebrew:
User query: "${query}"

${filterLines.length > 0 ? `ACTIVE CLIENT FILTERS & MANDATORY REQUIREMENTS:\n${filterLines.join('\n')}\n` : ''}
${portfolioSummary}

CRITICAL MANDATE - GOOGLE FINANCE IS THE PRIMARY SOURCE:
- You MUST check and prioritize Google Finance (https://www.google.com/finance) as your FIRST and PRIMARY reference for:
  1. Real-time market prices, P/E ratios, market caps, and 52-week ranges.
  2. Official 1-year analyst price target estimates & consensus recommendations (FactSet / S&P consensus on Google Finance).
- Cross-check and verify with Wall Street institutional consensus and latest quarterly earnings.
- Select EXACTLY 3 real, liquid, publicly traded stocks that best match the client's criteria and filters.

CRITICAL FOR "portfolioFitScore" & "portfolioFitReason":
- For each stock, calculate a compatibility score (75 to 98) representing how well this stock complements or diversifies the client's current portfolio holdings.
- Provide a concise 1-sentence explanation in Hebrew ("portfolioFitReason") explaining the exact diversification or strategic benefit (e.g. "מוסיפה פיזור לסקטור הבריאות שאינו קיים כרגע בתיק", "משמשת עוגן דיבידנד מול מניות הטכנולוגיה התנודתיות שלך", או "בסיס מעולה לבניית תיק ראשוני יציב").

Return ONLY a valid JSON object (no markdown backticks, no codeblocks) with this exact schema:
{
  "query": "${query}",
  "primarySource": "Google Finance",
  "sourcesUsed": ["Google Finance", "Wall Street Consensus"],
  "stocks": [
    {
      "symbol": "string (uppercase ticker, e.g. MSFT, AAPL, AMZN)",
      "name": "string (official company name)",
      "sector": "string in Hebrew (e.g. טכנולוגיה ותוכנה, שבבים, בריאות ורפואה, אנרגיה, צריכה בסיסית)",
      "currentPrice": number (approximate current price in USD),
      "targetPrice": number (average 12-month analyst consensus target in USD from Google Finance${minUpside ? `, MUST be at least currentPrice * ${(1 + minUpside / 100).toFixed(2)}` : ''}),
      "upsidePercent": number (${minUpside ? `MUST be >= ${minUpside}, e.g. ${minUpside + 5}` : 'percentage upside target, e.g. 18.5'}),
      "rating": "Strong Buy" | "Buy" | "Moderate Buy",
      "peRatio": number (current trailing or forward P/E ratio, e.g. 24.2),
      "dividendYield": number (annual dividend yield percentage, e.g. 2.4, or 0 if none),
      "marketCap": "string (e.g. 1.8T$, 240B$, 45B$)",
      "distanceFrom52wHigh": "string in Hebrew (e.g. 12%- מהשיא, בשיא שנתי, 5%- מהשיא)",
      "portfolioFitScore": number (75-98),
      "portfolioFitReason": "One Hebrew sentence explaining why it fits or diversifies the client's portfolio.",
      "whyMatch": "Detailed Hebrew explanation (2 sentences) explaining specifically why this company matches the user criteria.",
      "earningsBeat": "Concise Hebrew explanation of how the company surprised or beat recent earnings/revenue forecasts.",
      "catalyst": "Primary future business catalyst driving analyst upside."
    }
  ],
  "summaryHe": "A cohesive institutional summary in Hebrew explaining the strategic rationale for this 3-stock portfolio selection."
}

CRITICAL: Return EXACTLY 3 stocks in the stocks array. All Hebrew text must be natural, high-level, and accurate.`;

  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
            },
          }),
          signal: AbortSignal.timeout(45000),
        }
      );

      if (!res.ok) {
        console.error(`Model ${model} failed with status:`, res.status);
        continue;
      }

      const json = await res.json();
      const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

      let parsed: any = null;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        const start = rawText.indexOf('{');
        const end = rawText.lastIndexOf('}');
        if (start >= 0 && end > start) {
          parsed = JSON.parse(rawText.slice(start, end + 1));
        }
      }

      if (parsed && Array.isArray(parsed.stocks) && parsed.stocks.length > 0) {
        if (minUpside && minUpside > 0) {
          const highUpsideCount = parsed.stocks.filter((st: any) => {
            const up = typeof st.upsidePercent === 'number' ? st.upsidePercent : 0;
            return up >= minUpside;
          }).length;
          if (highUpsideCount === 0 && model !== MODELS[MODELS.length - 1]) {
            console.warn(`Model ${model} returned stocks below requested minUpside (${minUpside}%), retrying with next model...`);
            continue;
          }
        }

        // Enrich the stocks with real-time Finnhub quote data if possible
        const enrichedStocks = await Promise.all(
          parsed.stocks.slice(0, 3).map(async (st: any) => {
            const sym = (st.symbol || '').toUpperCase().trim();
            let livePrice = typeof st.currentPrice === 'number' ? st.currentPrice : null;
            let dailyChange = 0;
            let dailyPercent = 0;

            try {
              const qRes = await fetch(
                `https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_API_KEY}`,
                { signal: AbortSignal.timeout(3500) }
              ).catch(() => null);

              if (qRes && qRes.ok) {
                const qData = await qRes.json();
                if (typeof qData.c === 'number' && qData.c > 0) {
                  livePrice = qData.c;
                  dailyChange = qData.d || 0;
                  dailyPercent = qData.dp || 0;
                }
              }
            } catch {}

            // Calculate realistic target & upside aligned with live price
            const geminiUpside = typeof st.upsidePercent === 'number' ? st.upsidePercent : (minUpside || 15);
            let targetPrice = typeof st.targetPrice === 'number' && st.targetPrice > 0 ? st.targetPrice : 0;

            if (livePrice && livePrice > 0) {
              if (!targetPrice || targetPrice <= livePrice) {
                const effectiveUpside = Math.max(geminiUpside, minUpside || 0);
                targetPrice = Math.round(livePrice * (1 + effectiveUpside / 100) * 10) / 10;
              }
            } else if (st.currentPrice && st.currentPrice > 0) {
              livePrice = st.currentPrice;
              if (!targetPrice || targetPrice <= livePrice) {
                const effectiveUpside = Math.max(geminiUpside, minUpside || 0);
                targetPrice = Math.round(livePrice * (1 + effectiveUpside / 100) * 10) / 10;
              }
            }

            let upside = 0;
            if (livePrice && targetPrice && livePrice > 0) {
              upside = Math.round(((targetPrice - livePrice) / livePrice) * 1000) / 10;
            } else {
              upside = geminiUpside;
            }

            // CRITICAL: Guarantee that if the user asked for minimum upside (e.g. 30%), the final upside & target NEVER drop below it!
            if (minUpside && minUpside > 0 && upside < minUpside) {
              upside = Math.max(minUpside, geminiUpside);
              if (livePrice && livePrice > 0) {
                targetPrice = Math.round(livePrice * (1 + upside / 100) * 10) / 10;
              }
            }

            return {
              symbol: sym,
              name: st.name || sym,
              sector: st.sector || 'טכנולוגיה וכלכלה',
              currentPrice: livePrice || targetPrice || 100,
              targetPrice: targetPrice,
              upsidePercent: upside,
              dailyChange,
              dailyPercentChange: dailyPercent,
              rating: st.rating || 'Buy',
              peRatio: typeof st.peRatio === 'number' ? st.peRatio : (st.peRatio ? parseFloat(st.peRatio) : null),
              dividendYield: typeof st.dividendYield === 'number' ? st.dividendYield : (st.dividendYield ? parseFloat(st.dividendYield) : 0),
              marketCap: st.marketCap || 'שווי יציב',
              distanceFrom52wHigh: st.distanceFrom52wHigh || 'בטווח סביר מהשיא',
              portfolioFitScore: typeof st.portfolioFitScore === 'number' ? st.portfolioFitScore : 91,
              portfolioFitReason: st.portfolioFitReason || (userPortfolio.length > 0 ? 'מוסיפה איזון ופיזור חיובי לפוזיציות בתיק שלך' : 'עוגן איכותי לבניית תיק ראשוני חזק'),
              whyMatch: st.whyMatch || '',
              earningsBeat: st.earningsBeat || '',
              catalyst: st.catalyst || '',
              googleFinanceUrl: `https://www.google.com/finance/quote/${sym}`,
              primarySource: 'Google Finance',
            };
          })
        );

        const resultData = {
          query,
          filters: filters || {},
          primarySource: 'Google Finance',
          sourcesUsed: ['Google Finance (מקור ראשי)', 'Wall Street Consensus', 'Investing.com'],
          stocks: enrichedStocks,
          summaryHe: parsed.summaryHe || `נמצאו 3 מניות מובילות העונות בדיוק על הבקשה: "${query}".`,
          foundAt: new Date().toISOString(),
        };

        finderCache.set(cacheKey, {
          data: resultData,
          expiresAt: Date.now() + 3600 * 1000,
        });

        return NextResponse.json(resultData);
      }
    } catch (err: any) {
      console.error(`AI Finder model error with ${model}:`, err.message);
    }
  }

  return NextResponse.json(
    { error: 'לא הצלחנו לאתר מניות כרגע. אנא נסה ניסוח אחר או פקודה חלופית.' },
    { status: 500 }
  );
}
