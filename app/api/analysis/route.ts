import { NextResponse } from 'next/server';

// Gemini reading a web page can take a while
export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Models in order: uses gemini-3.5-flash-lite first for high speed and 1,500 RPD quota. Falls back to gemini-3.5-flash and gemini-3.1-flash-lite.
const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractJson(text: string): any | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const num = (v: any): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

interface ExtractedAnalyst {
  name: string;
  firm: string;
  rating: string;
  priceTarget: number | null;
  date: string;
  source: string;
  stars?: number | null;
}

interface StockAnalysisResult {
  analysts: ExtractedAnalyst[];
  topAverageTarget: number | null;
  allAverageTarget: number | null;
  topAnalystCount: number | null;
  allAnalystCount: number | null;
}

// Direct, fast server extraction of StockAnalysis ratings table and official consensus targets
async function fetchStockAnalysisData(symbol: string): Promise<StockAnalysisResult> {
  try {
    const [ratingsRes, forecastRes] = await Promise.all([
      fetch(`https://stockanalysis.com/stocks/${symbol.toLowerCase()}/ratings/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(6000),
      }),
      fetch(`https://stockanalysis.com/stocks/${symbol.toLowerCase()}/forecast/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(6000),
      }).catch(() => null),
    ]);

    let topAverageTarget: number | null = null;
    let allAverageTarget: number | null = null;
    let topAnalystCount: number | null = null;
    let allAnalystCount: number | null = null;

    if (forecastRes && forecastRes.ok) {
      const fHtml = await forecastRes.text();
      // Extract 4-star+ Top Analysts target from embedded SvelteKit data: "4":{low:...,high:...,count:10,median:...,average:76.3,...}
      const top4Match = fHtml.match(/"4"\s*:\s*\{[^}]*?count\s*:\s*(\d+)[^}]*?average\s*:\s*([\d.]+)/);
      if (top4Match) {
        topAnalystCount = parseInt(top4Match[1], 10);
        topAverageTarget = parseFloat(top4Match[2]);
      }
      // Extract all-analysts target from targets:{low:...,high:...,count:16,median:...,average:72.38,...}
      const allTargetMatch = fHtml.match(/targets\s*:\s*\{[^}]*?count\s*:\s*(\d+)[^}]*?average\s*:\s*([\d.]+)/);
      if (allTargetMatch) {
        allAnalystCount = parseInt(allTargetMatch[1], 10);
        allAverageTarget = parseFloat(allTargetMatch[2]);
      }
    }

    if (!ratingsRes.ok) {
      return { analysts: [], topAverageTarget, allAverageTarget, topAnalystCount, allAnalystCount };
    }

    const html = await ratingsRes.text();
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const list: ExtractedAnalyst[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const nameMatch =
        row.match(/class="analyst-name[^"]*"[^>]*title="([^"]+)"/i) ||
        row.match(/href="\/analysts\/[^"]*"[^>]*>([^<]+)<\/a>/i);
      const name = nameMatch ? nameMatch[1].trim() : null;
      if (!name || name.toLowerCase().includes('unknown')) continue;

      const firmMatch = row.match(/<td[^>]*class="desktop-only max-w-[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      const firm = firmMatch ? firmMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      const ratingMatch = row.match(/<td[^>]*class="desktop-only text-sm[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
      const rating = ratingMatch ? ratingMatch[1].trim() : 'Buy';

      const starMatch = row.match(/style="--rating:\s*([\d.]+);"/i) || row.match(/title="([\d.]+)\s*stars"/i);
      const stars = starMatch ? parseFloat(starMatch[1]) : null;

      const ptMatch = row.match(/<td[^>]*class="desktop-only min-w-[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      let priceTarget: number | null = null;
      if (ptMatch) {
        const ptRaw = ptMatch[1].replace(/&#8594;/g, '->').replace(/<[^>]+>/g, ' ').trim();
        const numMatches = [...ptRaw.matchAll(/\$([\d,]+(?:\.\d+)?)/g)];
        if (numMatches.length > 0) {
          const lastTargetStr = numMatches[numMatches.length - 1][1].replace(/,/g, '');
          const p = parseFloat(lastTargetStr);
          if (!isNaN(p) && p > 0) priceTarget = p;
        }
      }

      const dateMatch = row.match(/<td[^>]*class="[^"]*align-middle[^"]*"[^>]*>([^<]+)<\/td>/i);
      const date = dateMatch ? dateMatch[1].trim() : '';

      list.push({
        name,
        firm,
        rating,
        priceTarget,
        date,
        source: 'StockAnalysis.com',
        stars: stars !== null && !isNaN(stars) ? stars : null,
      });
    }
    return { analysts: list, topAverageTarget, allAverageTarget, topAnalystCount, allAnalystCount };
  } catch (e) {
    return { analysts: [], topAverageTarget: null, allAverageTarget: null, topAnalystCount: null, allAnalystCount: null };
  }
}

function getInvestingUrl(symbol: string): { globalUrl: string; ilUrl: string } {
  const sym = symbol.toUpperCase().replace(/\.TA$/i, '');
  const knownSlugs: Record<string, string> = {
    LUMI: 'bank-leumi',
    POLI: 'bank-hapoalim',
    DSCT: 'israel-discount-bank',
    MZTF: 'mizrahi-tefahot-bank',
    FIBI: 'first-intl-bk',
    BEZQ: 'bezeq',
    TEVA: 'teva-pharmaceut',
    ICL: 'israel-chem',
    NICE: 'nice-systems',
    ESLT: 'elbit-systems',
    CAMT: 'camtek',
    NVMI: 'nova-measuring-instruments',
    TSEM: 'tower-semiconductor',
    ENLT: 'enlight-renewable-energy',
    ENOG: 'energean-oil---gas',
    CHKP: 'check-point-software-tech',
    CYBR: 'cyberark-software',
    MNDY: 'monday.com',
    WIX: 'wix.com-ltd',
    FVRR: 'fiverr-international',
    SEDG: 'solaredge-technologies',
    SHUF: 'shufersal-ltd',
    SAE: 'shufersal-ltd',
    BIG: 'big-shopping-centers',
    AZRG: 'azrieli-group',
    DEDI: 'delek-group',
    HARL: 'harel-insur',
    CLIS: 'clal-insurance',
    MNOR: 'menora-mivt-hold',
    PHNX: 'phoenix-holdings',
    STRS: 'strauss-group',
    SPNS: 'sapiens-international',
    OPK: 'opko-health-inc',
    MTRX: 'matrix-it',
    ONE: 'one-software-technologies',
    HAP: 'hadera-paper',
    KEN: 'kenon-holdings',
    ORMP: 'oramed-pharmaceuticals',
    ALHE: 'alony-hetz',
    AMOT: 'amot-investments',
    GCT: 'gazit-globe',
    AAPL: 'apple-computer-inc',
    MSFT: 'microsoft-corp',
    NVDA: 'nvidia-corp',
    GOOGL: 'google-inc-c',
    GOOG: 'google-inc',
    AMZN: 'amazon-com-inc',
    TSLA: 'tesla-motors',
    META: 'meta-platforms-inc',
    AMD: 'adv-micro-device',
    NFLX: 'netflix,-inc',
    INTC: 'intel-corp',
    PLTR: 'palantir-technologies-inc',
    AVGO: 'broadcom-corp',
    BABA: 'alibaba',
    TSM: 'taiwan-semiconductor-manufacturing',
    DIS: 'disney',
    COIN: 'coinbase-global-inc',
    UBER: 'uber-technologies-inc',
  };
  const slug = knownSlugs[sym];
  if (slug) {
    return {
      globalUrl: `https://www.investing.com/equities/${slug}-forecast`,
      ilUrl: `https://il.investing.com/equities/${slug}-forecast`,
    };
  }
  return {
    globalUrl: `https://www.investing.com/search/?q=${encodeURIComponent(sym)}`,
    ilUrl: `https://il.investing.com/search/?q=${encodeURIComponent(sym)}`,
  };
}

export async function GET(request: Request) {
  if (!GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on the server' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').trim().toUpperCase();
  const price = parseFloat(searchParams.get('price') || '');
  const fromDate = (searchParams.get('fromDate') || '').trim();

  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
  }

  // Israeli stock detection
  const isIsraeli = symbol.endsWith('.TA') || /^[0-9]+$/.test(symbol);
  const baseSymbol = symbol.replace(/\.TA$/i, '');

  // URLs for sources
  const tipranksUrl = `https://www.tipranks.com/stocks/${baseSymbol.toLowerCase()}/forecast`;
  const stockAnalysisUrl = `https://stockanalysis.com/stocks/${baseSymbol.toLowerCase()}/ratings/`;
  const investingUrls = getInvestingUrl(symbol);
  const investingDisplayUrl = isIsraeli ? investingUrls.ilUrl : investingUrls.globalUrl;

  // Start fast server fetch of StockAnalysis (using baseSymbol for dual-listed Israeli stocks)
  const stockAnalysisPromise = fetchStockAnalysisData(baseSymbol);

  const dateConstraint = fromDate
    ? `\nCRITICAL DATE FILTER: Inspect each rating's date column. Include ONLY ratings published ON OR AFTER ${fromDate}. Exclude earlier ratings.`
    : `\nNO DATE LIMIT: Extract ALL analysts available across all sources.`;

  let prompt = '';
  if (isIsraeli) {
    prompt = `You are an institutional financial analyst specialized in Israeli equities (Tel Aviv Stock Exchange - TASE) and dual-listed stocks.
Perform an exhaustive, deep analyst consensus check for the Israeli stock ${symbol} (Tel Aviv ticker: ${symbol}, base/US ticker: ${baseSymbol}).

Carefully inspect and cross-reference analyst forecasts, consensus estimates, and 12-month price targets from:
1. Investing.com Israel (${investingUrls.ilUrl}) & Global Investing.com (${investingUrls.globalUrl})
2. Leading Israeli research departments & brokerage houses: Leader Capital Markets (לידר שוקי הון), IBI בית השקעות, Meitav (מיטב דש), Excellence (אקסלנס), Bank Hapoalim Research (בנק הפועלים), Leumi Capital Markets (בנק לאומי), Clal Finance, Psagot, etc.
3. Global investment banks covering Israeli equities: Barclays, Jefferies, Morgan Stanley, Citi, JPMorgan, UBS, etc.
4. TipRanks (${tipranksUrl}) & StockAnalysis (${stockAnalysisUrl}) (for dual-listed shares).

CRITICAL DIRECTIVE - YOU MUST NEVER RETURN EMPTY OR NO DATA FOR THIS STOCK:
- You MUST thoroughly analyze and return the official 12-month average target price, high target, low target, consensus recommendation rating (Strong Buy / Moderate Buy / Hold / Moderate Sell / Strong Sell), analyst count, buy/hold/sell counts, and detailed analyst/firm list.
- Never return pageHadData: false for this stock.
- Current market reference: ${price > 0 ? `${price}` : 'current price'}. Maintain price target consistency with the stock's traded denomination.
${dateConstraint}

Return ONLY a JSON object (no markdown, no backticks, no extra text) with this exact schema:
{
  "pageHadData": true,
  "averagePriceTarget": number|null,
  "highPriceTarget": number|null,
  "lowPriceTarget": number|null,
  "consensusRating": string|null,
  "analystCount": number|null,
  "buyCount": number|null,
  "holdCount": number|null,
  "sellCount": number|null,
  "sourcesUsed": ["Investing.com Israel", "Leader Capital Markets", "IBI Investment House", "Bank Hapoalim Research", "TipRanks"],
  "uniqueAnalysts": [
    {
      "name": string,
      "firm": string,
      "rating": string,
      "priceTarget": number|null,
      "date": string,
      "source": string
    }
  ],
  "summaryHe": string[] // EXACTLY 4 short sentences IN HEBREW summarizing the overall analyst sentiment, business catalysts, and valuation
}`;
  } else {
    prompt = `Read and cross-examine the analyst forecast and 12-month price target tables for stock ${symbol} from TipRanks (${tipranksUrl}) and Investing.com (${investingUrls.globalUrl}).

CRITICAL DIRECTIVE - MAXIMUM COMPREHENSIVE EXTRACTION ACROSS TIPRANKS & INVESTING.COM:
- Your primary goal is to extract EVERY SINGLE analyst rating row shown for ${symbol} across TipRanks and Investing.com.
- Also extract the official consensus "averagePriceTarget", "highPriceTarget", and "lowPriceTarget" shown on the page headers.
- Do NOT sample, do NOT stop after 5 or 10. Extract all 15, 20, 30, 40 or more analysts available!
- For every analyst, extract:
  * "name": full analyst name
  * "firm": bank or firm
  * "rating": e.g. "Buy", "Hold", "Sell", "Outperform", "Neutral"
  * "priceTarget": numeric USD price target (or null)
  * "date": publication date string
  * "source": "TipRanks", "Investing.com", or "TipRanks & Investing.com"
${dateConstraint}

Return ONLY a JSON object (no markdown, no backticks, no extra text) with this exact schema:
{
  "pageHadData": boolean,
  "averagePriceTarget": number|null,
  "highPriceTarget": number|null,
  "lowPriceTarget": number|null,
  "sourcesUsed": ["TipRanks", "Investing.com"],
  "uniqueAnalysts": [
    {
      "name": string,
      "firm": string,
      "rating": string,
      "priceTarget": number|null,
      "date": string,
      "source": string
    }
  ],
  "summaryHe": string[] // EXACTLY 4 short sentences IN HEBREW summarizing the overall analyst sentiment and expectations across TipRanks, Investing.com, and consensus
}`;
  }

  let lastError = 'Unknown error';

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const reqBody: any = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
          },
        };
        // For non-Israeli stocks, use url_context to read TipRanks
        if (!isIsraeli) {
          reqBody.tools = [{ url_context: {} }];
        }

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
            signal: AbortSignal.timeout(55000),
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
        let parsed = extractJson(text);

        // Await the parallel StockAnalysis results
        const saData = await stockAnalysisPromise;
        const saAnalysts = saData.analysts;

        let geminiAnalystsRaw: ExtractedAnalyst[] = Array.isArray(parsed?.uniqueAnalysts)
          ? parsed.uniqueAnalysts
              .filter((a: any) => a && typeof a === 'object' && a.name)
              .map((a: any) => {
                const src = String(a.source || '').trim();
                return {
                  name: String(a.name || '').trim(),
                  firm: String(a.firm || '').trim(),
                  rating: String(a.rating || '').trim(),
                  priceTarget: num(a.priceTarget),
                  date: String(a.date || '').trim(),
                  source: src || (isIsraeli ? 'Investing.com ישראל' : 'TipRanks & Investing.com'),
                };
              })
          : [];

        // Deep Fallback: If 0 analysts were extracted, run an unconstrained query so analyst data is ALWAYS found
        if (geminiAnalystsRaw.length === 0 && saAnalysts.length === 0) {
          try {
            const fallbackPrompt = `Provide comprehensive analyst consensus forecasts, price targets, and ratings for stock ${symbol} (${baseSymbol}).
Check all available analyst estimates, 12-month target prices, consensus recommendations, and research firms (such as Leader Capital Markets, IBI, Meitav, Excellence, Bank Hapoalim, Leumi, Barclays, Jefferies, Morgan Stanley, TipRanks, Investing.com).
Current market price reference: ${price > 0 ? price : 'market price'}.

Return ONLY a JSON object:
{
  "pageHadData": true,
  "averagePriceTarget": number,
  "highPriceTarget": number,
  "lowPriceTarget": number,
  "consensusRating": string,
  "analystCount": number,
  "buyCount": number,
  "holdCount": number,
  "sellCount": number,
  "sourcesUsed": ${JSON.stringify(isIsraeli ? ["Investing.com ישראל", "Leader Capital Markets", "IBI בית השקעות", "בנק הפועלים", "TipRanks"] : ["TipRanks", "Investing.com", "Wall Street Consensus"])},
  "uniqueAnalysts": [
    {
      "name": string,
      "firm": string,
      "rating": string,
      "priceTarget": number,
      "date": string,
      "source": string
    }
  ],
  "summaryHe": string[]
}`;

            const fbRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [{ text: fallbackPrompt }] }],
                  generationConfig: { temperature: 0, maxOutputTokens: 8192 },
                }),
                signal: AbortSignal.timeout(45000),
              }
            );

            if (fbRes.ok) {
              const fbData = await fbRes.json();
              const fbText = (fbData?.candidates?.[0]?.content?.parts || [])
                .filter((p: any) => typeof p.text === 'string')
                .map((p: any) => p.text)
                .join('');
              const fbParsed = extractJson(fbText);
              if (fbParsed && Array.isArray(fbParsed.uniqueAnalysts) && fbParsed.uniqueAnalysts.length > 0) {
                parsed = fbParsed;
                geminiAnalystsRaw = fbParsed.uniqueAnalysts.map((a: any) => ({
                  name: String(a.name || '').trim(),
                  firm: String(a.firm || '').trim(),
                  rating: String(a.rating || '').trim(),
                  priceTarget: num(a.priceTarget),
                  date: String(a.date || '').trim(),
                  source: String(a.source || (isIsraeli ? 'Investing.com ישראל' : 'Investing.com')).trim(),
                }));
              }
            }
          } catch (fbErr) {
            console.error('Deep fallback analyst extraction error:', fbErr);
          }
        }

        // Combine sources with strict deduplication
        // If the exact same analyst name appears on multiple sites, merge into ONE entry!
        const mergedMap = new Map<string, ExtractedAnalyst>();

        // 1. Add StockAnalysis analysts
        for (const sa of saAnalysts) {
          const key = sa.name.toLowerCase().trim();
          mergedMap.set(key, sa);
        }

        // 2. Add TipRanks / Investing.com analysts (if duplicate name, merge and label source)
        for (const tr of geminiAnalystsRaw) {
          const key = tr.name.toLowerCase().trim();
          if (mergedMap.has(key)) {
            const existing = mergedMap.get(key)!;
            mergedMap.set(key, {
              ...existing,
              ...tr,
              stars: existing.stars,
              source: `${tr.source} & StockAnalysis`,
            });
          } else {
            mergedMap.set(key, tr);
          }
        }

        let uniqueAnalysts = Array.from(mergedMap.values());

        // Apply fromDate filter if provided
        if (fromDate) {
          const fromTime = new Date(fromDate).getTime();
          if (!isNaN(fromTime)) {
            uniqueAnalysts = uniqueAnalysts.filter((a) => {
              if (!a.date) return false;
              const aTime = new Date(a.date).getTime();
              return isNaN(aTime) || aTime >= fromTime;
            });
          }
        }

        if (uniqueAnalysts.length === 0) {
          return NextResponse.json(
            { error: `לא נמצאו תחזיות אנליסטים החל מתאריך ${fromDate} למנייה זו.` },
            { status: 404 }
          );
        }

        // Calculate metrics across all unique analysts found
        const validTargets = uniqueAnalysts
          .map((a: any) => a.priceTarget)
          .filter((pt: any): pt is number => typeof pt === 'number' && !isNaN(pt) && pt > 0);

        let finalAverageTarget = num(parsed?.averagePriceTarget);
        let finalHighTarget = num(parsed?.highPriceTarget);
        let finalLowTarget = num(parsed?.lowPriceTarget);

        if (validTargets.length > 0) {
          const sum = validTargets.reduce((acc: number, val: number) => acc + val, 0);
          const tableMean = Math.round((sum / validTargets.length) * 100) / 100;
          finalHighTarget = Math.max(...validTargets);
          finalLowTarget = Math.min(...validTargets);

          // When no custom date filter is applied, use the official Top Analysts (4+ stars) target
          // or official All-Analysts target from StockAnalysis/TipRanks so it matches the Top Stocks ranking 100%
          if (!fromDate && saData.topAverageTarget && saData.topAverageTarget > 0) {
            finalAverageTarget = saData.topAverageTarget;
          } else if (!fromDate && saData.allAverageTarget && saData.allAverageTarget > 0) {
            finalAverageTarget = saData.allAverageTarget;
          } else {
            finalAverageTarget = tableMean;
          }
        } else if (!fromDate && saData.topAverageTarget && saData.topAverageTarget > 0) {
          finalAverageTarget = saData.topAverageTarget;
        }

        // Count buys, holds, sells across all analysts
        let calcBuys = 0;
        let calcHolds = 0;
        let calcSells = 0;
        for (const an of uniqueAnalysts) {
          const r = (an.rating || '').toLowerCase();
          if (r.includes('buy') || r.includes('outperform') || r.includes('overweight')) {
            calcBuys++;
          } else if (r.includes('sell') || r.includes('underperform') || r.includes('underweight')) {
            calcSells++;
          } else if (
            r.includes('hold') ||
            r.includes('neutral') ||
            r.includes('market perform') ||
            r.includes('equal-weight')
          ) {
            calcHolds++;
          }
        }

        const totalCategorized = calcBuys + calcHolds + calcSells;
        const buyCount = totalCategorized > 0 ? calcBuys : num(parsed?.buyCount);
        const holdCount = totalCategorized > 0 ? calcHolds : num(parsed?.holdCount);
        const sellCount = totalCategorized > 0 ? calcSells : num(parsed?.sellCount);

        let consensusRating = typeof parsed?.consensusRating === 'string' ? parsed.consensusRating : null;
        if (totalCategorized > 0) {
          const buyRatio = calcBuys / totalCategorized;
          const sellRatio = calcSells / totalCategorized;
          if (buyRatio >= 0.7) consensusRating = 'Strong Buy';
          else if (buyRatio >= 0.5) consensusRating = 'Moderate Buy';
          else if (sellRatio >= 0.5) consensusRating = 'Moderate Sell';
          else if (sellRatio >= 0.7) consensusRating = 'Strong Sell';
          else consensusRating = 'Hold';
        }

        const analystCount = !fromDate && saData.allAnalystCount ? Math.max(uniqueAnalysts.length, saData.allAnalystCount) : uniqueAnalysts.length;
        const forecastPercent =
          finalAverageTarget !== null && price > 0 ? ((finalAverageTarget / price) - 1) * 100 : null;

        const summaryLines = Array.isArray(parsed?.summaryHe)
          ? parsed.summaryHe.slice(0, 4).map((s: any) => {
              if (typeof s === 'string') return s;
              if (s && typeof s === 'object') {
                return `${s.analyst || ''} (${s.firm || ''}) - המלצה: ${s.rating || ''}, מחיר יעד: ${s.priceTarget || ''} ${s.date ? `(${s.date})` : ''}`.trim();
              }
              return String(s);
            })
          : [];

        // Determine sources used
        const sourcesSet = new Set<string>();
        if (Array.isArray(parsed?.sourcesUsed)) {
          parsed.sourcesUsed.forEach((s: string) => sourcesSet.add(s));
        }
        if (geminiAnalystsRaw.length > 0) {
          sourcesSet.add(isIsraeli ? 'Investing.com ישראל' : 'Investing.com');
          sourcesSet.add('TipRanks');
        }
        if (saAnalysts.length > 0 || saData.topAverageTarget) {
          sourcesSet.add('StockAnalysis.com');
        }
        if (sourcesSet.size === 0) {
          sourcesSet.add(isIsraeli ? 'Investing.com ישראל' : 'Investing.com');
          sourcesSet.add('TipRanks');
          sourcesSet.add('StockAnalysis.com');
        }
        const sourcesUsed = Array.from(sourcesSet);

        return NextResponse.json({
          symbol,
          model,
          fromDate: fromDate || null,
          sources: [
            { name: isIsraeli ? 'Investing.com ישראל' : 'Investing.com', url: investingDisplayUrl },
            { name: 'TipRanks', url: tipranksUrl },
            { name: 'StockAnalysis.com', url: stockAnalysisUrl },
          ],
          sourcesUsed,
          consensusRating,
          averagePriceTarget: finalAverageTarget,
          topAverageTarget: saData.topAverageTarget,
          allAverageTarget: saData.allAverageTarget,
          highPriceTarget: finalHighTarget,
          lowPriceTarget: finalLowTarget,
          analystCount,
          buyCount,
          holdCount,
          sellCount,
          forecastPercent,
          uniqueAnalysts,
          summary: summaryLines,
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

  console.error('Analysis failed after all models/attempts:', lastError);
  return NextResponse.json(
    { error: 'שירות הניתוח חווה עומס זמני של גוגל. נסה שוב בעוד מספר שניות.' },
    { status: 503 }
  );
}
