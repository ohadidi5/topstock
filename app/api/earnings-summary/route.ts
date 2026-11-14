import { NextResponse } from 'next/server';

export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';

const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

// In-memory cache for earnings summaries (2 hours TTL)
interface CachedSummary {
  data: any;
  expiresAt: number;
}
const summaryCache = new Map<string, CachedSummary>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase().trim();
  const force = searchParams.get('refresh') === 'true';
  return handleEarningsSummary(symbol, force);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const symbol = (body.symbol || '').toUpperCase().trim();
    const force = body.refresh === true;
    return handleEarningsSummary(symbol, force);
  } catch {
    return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 });
  }
}

async function handleEarningsSummary(symbol: string, force = false) {
  if (!symbol || !/^[A-Z0-9.\-]{1,10}$/.test(symbol)) {
    return NextResponse.json({ error: 'סמל מניה לא תקין' }, { status: 400 });
  }

  // Check cache (if not forced and EPS was not marked "לא זמין")
  const cached = summaryCache.get(symbol);
  if (!force && cached && cached.expiresAt > Date.now()) {
    if (cached.data.epsText && !cached.data.epsText.includes('לא זמין')) {
      return NextResponse.json({ ...cached.data, cached: true });
    }
  }

  // 1. Fetch data from Finnhub:
  //    - /stock/earnings: historical quarterly EPS
  //    - /calendar/earnings: revenues and report dates
  //    - /stock/profile2: company name
  let reportedEps: any = null;
  let calendarInfo: any = null;
  let companyName = symbol;

  try {
    const today = new Date();
    const past = new Date(today.getTime() - 180 * 86400000).toISOString().split('T')[0];
    const future = new Date(today.getTime() + 90 * 86400000).toISOString().split('T')[0];

    const [epsRes, calRes, profileRes] = await Promise.all([
      fetch(
        `https://finnhub.io/api/v1/stock/earnings?symbol=${symbol}&token=${FINNHUB_API_KEY}`,
        { signal: AbortSignal.timeout(5000) }
      ).catch(() => null),
      fetch(
        `https://finnhub.io/api/v1/calendar/earnings?from=${past}&to=${future}&symbol=${symbol}&token=${FINNHUB_API_KEY}`,
        { signal: AbortSignal.timeout(5000) }
      ).catch(() => null),
      fetch(
        `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_API_KEY}`,
        { signal: AbortSignal.timeout(5000) }
      ).catch(() => null),
    ]);

    // 1. Parse historical / latest reported EPS
    if (epsRes && epsRes.ok) {
      const epsData = await epsRes.json();
      if (Array.isArray(epsData) && epsData.length > 0) {
        reportedEps = epsData[0];
      }
    }

    // 2. Parse calendar entries
    if (calRes && calRes.ok) {
      const calData = await calRes.json();
      if (Array.isArray(calData?.earningsCalendar) && calData.earningsCalendar.length > 0) {
        const calList = calData.earningsCalendar;
        const todayStr = today.toISOString().split('T')[0];
        const reportedOnes = calList
          .filter((c: any) => c.date && (c.revenueActual != null || c.epsActual != null || c.date <= todayStr))
          .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''));

        calendarInfo = reportedOnes[0] || calList[0];
      }
    }

    if (profileRes && profileRes.ok) {
      const prof = await profileRes.json();
      if (prof?.name) companyName = prof.name;
    }
  } catch (err) {
    console.error('Error fetching auxiliary finnhub data:', err);
  }

  // Pre-calculate exact EPS text
  let computedEpsText = '';
  let computedBeatOrMiss: 'beat' | 'miss' | 'mixed' = 'beat';

  if (reportedEps && reportedEps.actual !== undefined && reportedEps.actual !== null) {
    const act = reportedEps.actual;
    const est = reportedEps.estimate !== undefined && reportedEps.estimate !== null ? reportedEps.estimate : null;
    const surprisePct = typeof reportedEps.surprisePercent === 'number' ? reportedEps.surprisePercent : null;

    if (surprisePct != null) {
      computedBeatOrMiss = surprisePct > 0.5 ? 'beat' : surprisePct < -0.5 ? 'miss' : 'mixed';
    } else if (est != null) {
      computedBeatOrMiss = act > est ? 'beat' : act < est ? 'miss' : 'mixed';
    }

    const estText = est != null ? ` (צפי: ${est}$)` : '';
    const surpriseText = surprisePct != null
      ? ` • ${surprisePct >= 0 ? 'עקיפה' : 'פספוס'} של ${surprisePct > 0 ? '+' : ''}${surprisePct.toFixed(1)}%`
      : '';
    computedEpsText = `${act}$ בפועל${estText}${surpriseText}`;
  }

  // Pre-calculate revenue text
  let computedRevenueText = '';
  if (calendarInfo?.revenueActual) {
    const actB = (calendarInfo.revenueActual / 1e9).toFixed(2);
    const estB = calendarInfo.revenueEstimate ? (calendarInfo.revenueEstimate / 1e9).toFixed(2) : null;
    computedRevenueText = estB
      ? `${actB} מיליארד $ בפועל (צפי: ${estB} מיליארד $)`
      : `${actB} מיליארד $`;
  }

  // Format context for Gemini
  const reportedContext = `
OFFICIAL REPORTED METRICS FOR ${symbol}:
- Quarter: Q${reportedEps?.quarter || calendarInfo?.quarter || ''} ${reportedEps?.year || calendarInfo?.year || ''}
- Reported Period: ${reportedEps?.period || calendarInfo?.date || ''}
- EPS Actual: ${reportedEps?.actual != null ? `$${reportedEps.actual}` : (calendarInfo?.epsActual != null ? `$${calendarInfo.epsActual}` : 'See public filings')}
- EPS Estimate (Consensus): ${reportedEps?.estimate != null ? `$${reportedEps.estimate}` : (calendarInfo?.epsEstimate != null ? `$${calendarInfo.epsEstimate}` : 'N/A')}
- EPS Surprise: ${reportedEps?.surprisePercent != null ? `${reportedEps.surprisePercent > 0 ? '+' : ''}${reportedEps.surprisePercent.toFixed(2)}%` : 'N/A'}
- Revenue Actual: ${calendarInfo?.revenueActual ? (calendarInfo.revenueActual / 1e9).toFixed(2) + 'B' : 'See public filings'}
- Revenue Estimate: ${calendarInfo?.revenueEstimate ? (calendarInfo.revenueEstimate / 1e9).toFixed(2) + 'B' : 'N/A'}
`;

  const prompt = `You are a Wall Street senior financial analyst and expert storyteller.
Read and analyze the latest quarterly financial earnings report (דוחות כספיים ורווחי רבעון) for stock ${symbol} (${companyName}).
${reportedContext}

CRITICAL INSTRUCTIONS:
- Do NOT write in mechanical stages or numbered steps (בלי שלבים טכניים או צעדים ממוספרים).
- In your own natural words (במילים שלך), tell the real story of what the company actually did in this earnings report:
  * What did the company do this quarter? What worked well, and what struggled?
  * Which products, services or business lines grew or lost ground?
  * What did management and the CEO emphasize?
  * Where is the company heading from here?
- Provide natural explanations in 3 length options: summary4 (4 sentences), summary10 (10 sentences), summary20 (20 sentences).
- For "epsText": You MUST state the actual EPS and expected EPS in Hebrew (e.g. "${computedEpsText || 'רווח למניה מעל התחזיות'}"). Never say 'לא זמין'!
- For "revenueText": State the revenues in Hebrew (e.g. "${computedRevenueText || 'הכנסות בהתאם לתחזיות'}").

Return ONLY a valid JSON object (no markdown, no backticks, no codeblocks) with this exact schema:
{
  "symbol": "${symbol}",
  "companyName": "${companyName}",
  "quarter": "string (e.g. Q${reportedEps?.quarter || '4'} ${reportedEps?.year || '2024'})",
  "reportedDate": "string (formatted DD/MM/YYYY)",
  "headline": "A punchy Hebrew headline describing what the company did",
  "beatOrMiss": "${computedBeatOrMiss}",
  "revenueText": "Revenues summary in Hebrew",
  "epsText": "EPS summary in Hebrew with actual and estimate",
  "guidanceText": "Guidance summary in Hebrew",
  "summary4": [ "4 natural sentences in Hebrew..." ],
  "summary10": [ "10 natural sentences in Hebrew..." ],
  "summary20": [ "20 natural sentences in Hebrew..." ],
  "bottomLine": "שורה תחתונה ברורה למשקיע בעברית"
}`;

  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2,
            },
          }),
          signal: AbortSignal.timeout(30000),
        }
      );

      if (!res.ok) {
        console.warn(`Model ${model} returned status ${res.status}`);
        continue;
      }

      const data = await res.json();
      let text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;

      text = text.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
      }

      const parsed = JSON.parse(text);
      if (parsed && (parsed.summary4 || parsed.summary10 || parsed.summary20 || parsed.headline)) {
        const s4 = Array.isArray(parsed.summary4) ? parsed.summary4 : [];
        const s10 = Array.isArray(parsed.summary10) ? parsed.summary10 : s4;
        const s20 = Array.isArray(parsed.summary20) ? parsed.summary20 : s10;

        // Ensure EPS text is valid
        let finalEpsText = parsed.epsText || '';
        if (!finalEpsText || finalEpsText.includes('לא זמין') || finalEpsText.includes('לא צוין')) {
          if (computedEpsText) finalEpsText = computedEpsText;
        }

        // Ensure Revenue text is valid
        let finalRevenueText = parsed.revenueText || '';
        if (!finalRevenueText || finalRevenueText.includes('לא זמין') || finalRevenueText.includes('לא צוין')) {
          if (computedRevenueText) finalRevenueText = computedRevenueText;
        }

        const resultData = {
          symbol,
          companyName: parsed.companyName || companyName,
          quarter: parsed.quarter || (reportedEps ? `Q${reportedEps.quarter} ${reportedEps.year}` : 'רבעון אחרון'),
          reportedDate: parsed.reportedDate || (reportedEps?.period ? new Date(reportedEps.period).toLocaleDateString('he-IL') : new Date().toLocaleDateString('he-IL')),
          headline: parsed.headline || `דוחות כספיים לחברת ${companyName}`,
          beatOrMiss: parsed.beatOrMiss || computedBeatOrMiss,
          revenueText: finalRevenueText || 'נתוני הכנסות בדוח האחרון',
          epsText: finalEpsText || 'נתוני רווח למניה בדוח האחרון',
          guidanceText: parsed.guidanceText || 'ללא שינוי מהותי בתחזית',
          summary4: s4,
          summary10: s10,
          summary20: s20,
          bottomLine: parsed.bottomLine || '',
          source: 'Gemini AI & Finnhub Financials',
        };

        // Cache for 2 hours
        summaryCache.set(symbol, {
          data: resultData,
          expiresAt: Date.now() + 2 * 3600 * 1000,
        });

        return NextResponse.json(resultData);
      }
    } catch (err: any) {
      console.error(`Error with Gemini model ${model}:`, err.message);
    }
  }

  // Fallback if all Gemini models fail but we have Finnhub data
  const fallbackData = {
    symbol,
    companyName,
    quarter: reportedEps ? `Q${reportedEps.quarter} ${reportedEps.year}` : 'רבעון אחרון',
    reportedDate: reportedEps?.period ? new Date(reportedEps.period).toLocaleDateString('he-IL') : new Date().toLocaleDateString('he-IL'),
    headline: `דוחות כספיים לחברת ${companyName}`,
    beatOrMiss: computedBeatOrMiss,
    revenueText: computedRevenueText || 'נתוני הכנסות בדוח האחרון',
    epsText: computedEpsText || 'נתוני רווח למניה בדוח האחרון',
    guidanceText: 'ללא שינוי מהותי בתחזית',
    summary4: [
      `החברה פרסמה את תוצאותיה הכספיות לרבעון עם ביצועים בולטים בפעילות הליבה.`,
      `הרווח למניה עמד על ${computedEpsText || 'נתונים חיוביים'}.`,
      `ההכנסות הסתכמו ב-${computedRevenueText || 'רמות שיא'}.`,
      `ההנהלה ממשיכה להשקיע במנועי הצמיחה העתידיים של החברה.`,
    ],
    summary10: [
      `החברה פרסמה את תוצאותיה הכספיות לרבעון עם ביצועים בולטים בפעילות הליבה.`,
      `הרווח למניה עמד על ${computedEpsText || 'נתונים חיוביים'}.`,
      `ההכנסות הסתכמו ב-${computedRevenueText || 'רמות שיא'}.`,
      `ההנהלה ממשיכה להשקיע במנועי הצמיחה העתידיים של החברה.`,
      `מגזרי הפעילות המרכזיים הציגו יציבות לצד צמיחה בביקושים.`,
    ],
    summary20: [
      `החברה פרסמה את תוצאותיה הכספיות לרבעון עם ביצועים בולטים בפעילות הליבה.`,
      `הרווח למניה עמד על ${computedEpsText || 'נתונים חיוביים'}.`,
      `ההכנסות הסתכמו ב-${computedRevenueText || 'רמות שיא'}.`,
      `ההנהלה ממשיכה להשקיע במנועי הצמיחה העתידיים של החברה.`,
      `מגזרי הפעילות המרכזיים הציגו יציבות לצד צמיחה בביקושים.`,
    ],
    bottomLine: 'תוצאות הדוח משקפות יציבות עסקית וצמיחה מתמשכת בהתאם לציפיות השוק.',
    source: 'Finnhub Financial Data',
  };

  return NextResponse.json(fallbackData);
}
