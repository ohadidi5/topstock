import { NextResponse } from 'next/server';

export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

interface StockHolding {
  symbol: string;
  name?: string;
  buyPrice: number;
  currentPrice: number;
  investedAmount: number;
  shares: number;
  currentValue: number;
  targetPrice?: number;
  upsidePercent?: number;
  rating?: string;
  dividendYield?: number;
  portfolioWeightPercent: number;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      portfolio = [],
      depositAmount = 1000,
      currency = 'USD',
      currencyRate = 1,
      currencySymbol = '$',
      strategy = 'balanced', // 'upside' | 'balanced' | 'defensive'
    } = body;

    const amount = Number(depositAmount);
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'נא להזין סכום תקין להשקעה' }, { status: 400 });
    }

    if (!Array.isArray(portfolio) || portfolio.length === 0) {
      return NextResponse.json(
        { error: 'אין מניות בתיק לאיזון וחלוקת כסף חדש' },
        { status: 400 }
      );
    }

    const totalPortfolioValue = portfolio.reduce((sum: number, s: any) => sum + (s.currentValue || s.investedAmount || 0), 0);

    const formattedDeposit = `${amount.toLocaleString('he-IL', { maximumFractionDigits: 0 })} ${currencySymbol}`;

    const strategyNames: Record<string, string> = {
      balanced: 'איזון סיכונים ופיזור חכם (מומלץ)',
      upside: 'מקסום תשואה ואפסייד לפי יעדי אנליסטים',
      defensive: 'הגנתי, יציבות ותזרים דיבידנדים',
    };

    const stocksSummary = portfolio.map((s: StockHolding) => {
      const targetStr = s.targetPrice ? `${s.targetPrice}$` : 'לא הוגדר';
      const upsideStr = s.upsidePercent !== undefined ? `${s.upsidePercent > 0 ? '+' : ''}${s.upsidePercent.toFixed(1)}%` : 'לא זמין';
      const weightStr = `${s.portfolioWeightPercent.toFixed(1)}%`;
      const divStr = s.dividendYield ? `${s.dividendYield.toFixed(1)}%` : '0%';
      return `• מניה: ${s.symbol} (${s.name || s.symbol})
  - מחיר נוכחי: ${s.currentPrice}$
  - שווי נוכחי בתיק: ${(s.currentValue * currencyRate).toFixed(0)} ${currencySymbol} (מהווה ${weightStr} מהתיק)
  - מחיר יעד אנליסטים: ${targetStr} (פוטנציאל עלייה צפוי: ${upsideStr})
  - תשואת דיבידנד: ${divStr}
  - דירוג אנליסטים: ${s.rating || 'קונצנזוס כללי'}`;
    }).join('\n\n');

    const prompt = `אתה מנהל תיקי השקעות בכיר בוול סטריט.
לקוח פנה אליך ומבקש להפקיד סכום חדש של ${formattedDeposit} לתוך תיק המניות הקיים שלו.
האסטרטגיה שנבחרה: "${strategyNames[strategy] || strategyNames.balanced}".

הנה הרכב התיק הקיים של הלקוח:
${stocksSummary}

סך שווי התיק הנוכחי: ${(totalPortfolioValue * currencyRate).toFixed(0)} ${currencySymbol}.

המשימה שלך:
לחלק את מלוא הסכום (${formattedDeposit}) בין המניות המתאימות ביותר בתיק בלבד, באופן מקצועי, מנומק וברור.
דגשים חשובים:
1. סכום החלוקה הכולל בכל המניות שנבחרו חייב להסתכם בדיוק ב-${amount} ${currencySymbol} (או קירוב של 99%-100%).
2. לא חייבים לחלק לכל המניות בתיק. אם מניה מסוימת יקרה מדי, עברה את מחיר היעד, או כבר מהווה משקל גדול מדי בתיק – הסבר מדוע עדיף לדלג עליה כרגע.
3. חשב כמה מניות (sharesToBuy) ניתן לקנות בסכום שהוקצה (מבוסס על מחיר המניה הנוכחי בשער הדולר/מטבע). מניות חלקיות מקובלות.
4. הסבר את הרציונל הכלכלי בעברית רהוטה ופשוטה.

החזר אך ורק אובייקט JSON תקין (ללא markdown codeblock, ללא backticks) לפי המבנה המדויק הבא:
{
  "headline": "כותרת קולעת בת 6-12 מילים המסכמת את תוכנית ההקצאה",
  "strategyRationale": "הסבר מקצועי וברור (3-5 שורות) על ההיגיון הכלכלי מאחורי חלוקת הסכום ${formattedDeposit}",
  "allocations": [
    {
      "symbol": "סימול המניה (למשל MSFT)",
      "allocatedAmount": מספר (סכום במטבע ${currencySymbol}),
      "percentageOfDeposit": מספר (אחוז מסך ההפקדה, למשל 40),
      "sharesToBuy": מספר (כמה מניות לרכוש, למשל 1.5),
      "reason": "משפט-שניים מנומקים מדוע כדאי לחזק מניה זו עכשיו"
    }
  ],
  "skipList": [
    {
      "symbol": "סימול המניה (למשל AAPL)",
      "reason": "מדוע לא הוקצה כסף למניה זו בחלוקה הנוכחית"
    }
  ],
  "bottomLine": "שורה תחתונה והשפעת ההפקדה על חוסן התיק (2-3 שורות)"
}`;

    let parsedResult: any = null;

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
                temperature: 0.3,
                maxOutputTokens: 1400,
              },
            }),
            signal: AbortSignal.timeout(20000),
          }
        );

        if (!res.ok) continue;

        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) continue;

        try {
          parsedResult = JSON.parse(rawText);
        } catch {
          const s = rawText.indexOf('{');
          const e = rawText.lastIndexOf('}');
          if (s >= 0 && e > s) {
            parsedResult = JSON.parse(rawText.slice(s, e + 1));
          }
        }

        if (parsedResult && parsedResult.headline && Array.isArray(parsedResult.allocations) && parsedResult.allocations.length > 0) {
          break;
        }
      } catch (err) {
        console.error(`Gemini rebalance failed with model ${model}:`, err);
      }
    }

    if (!parsedResult || !Array.isArray(parsedResult.allocations)) {
      // Fallback allocation algorithm based on upside or equal distribution
      const validHoldings = portfolio.filter(p => p.currentPrice > 0);
      const topPicks = [...validHoldings]
        .sort((a, b) => (b.upsidePercent || 0) - (a.upsidePercent || 0))
        .slice(0, Math.min(3, validHoldings.length));

      const shareEach = Math.round(amount / (topPicks.length || 1));

      parsedResult = {
        headline: `חלוקת ${formattedDeposit} ממוקדת במניות בעלות האפסייד הגבוה בתיק`,
        strategyRationale: `הסכום חולק בין ${topPicks.length} המניות בעלות פוטנציאל העלייה המרבי ביחס ליעדי האנליסטים, במטרה להגדיל את התשואה הכוללת של התיק.`,
        allocations: topPicks.map((p, idx) => {
          const alloc = idx === topPicks.length - 1 ? amount - shareEach * (topPicks.length - 1) : shareEach;
          const priceInCur = p.currentPrice * currencyRate;
          const shares = priceInCur > 0 ? Math.round((alloc / priceInCur) * 100) / 100 : 0;
          return {
            symbol: p.symbol,
            allocatedAmount: alloc,
            percentageOfDeposit: Math.round((alloc / amount) * 100),
            sharesToBuy: shares,
            reason: `פוטנציאל עלייה צפוי של ${p.upsidePercent !== undefined ? p.upsidePercent.toFixed(1) + '%' : 'משמעותי'} ביחס ליעד האנליסטים.`,
          };
        }),
        skipList: portfolio.filter(p => !topPicks.some(tp => tp.symbol === p.symbol)).map(p => ({
          symbol: p.symbol,
          reason: 'משקל יציב בתיק, עדיפות להזרמת כסף למניות עם פער גדול יותר למחיר היעד.',
        })),
        bottomLine: 'חלוקה זו מרחיבה את הפוזיציות המבטיחות בתיק ושומרת על פיזור יעיל לטווח הארוך.',
      };
    }

    return NextResponse.json({
      success: true,
      data: parsedResult,
      depositAmountFormatted: formattedDeposit,
      currency,
      currencySymbol,
    });
  } catch (error: any) {
    console.error('Smart rebalance route error:', error);
    return NextResponse.json(
      { error: 'אירעה שגיאה בחישוב האיזון מחדש. אנא נסה שוב.' },
      { status: 500 }
    );
  }
}
