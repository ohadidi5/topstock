import { NextResponse } from 'next/server';

export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

interface StockHolding {
  symbol: string;
  name?: string;
  shares: number;
  currentPrice: number;
  dailyChange: number;
  dailyChangePercent: number;
  holdingValue: number;
  todayProfitLossUSD: number;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      holdings,
      totalTodayChangeUSD = 0,
      totalTodayPercentChange = 0,
      currency = 'USD',
      currencyRate = 1,
      currencySymbol = '$',
    } = body;

    if (!Array.isArray(holdings) || holdings.length === 0) {
      return NextResponse.json(
        { error: 'אין מניות בתיק לניתוח ביצועים יומיים' },
        { status: 400 }
      );
    }

    // Sort holdings by absolute daily dollar impact (biggest movers first)
    const sortedHoldings: StockHolding[] = [...holdings].sort(
      (a, b) => Math.abs(b.todayProfitLossUSD || 0) - Math.abs(a.todayProfitLossUSD || 0)
    );

    const isPositiveDay = totalTodayChangeUSD >= 0;
    const formattedTotalToday = `${isPositiveDay ? '+' : ''}${(totalTodayChangeUSD * currencyRate).toLocaleString('he-IL', { maximumFractionDigits: 2 })} ${currencySymbol}`;
    const formattedPercent = `${isPositiveDay ? '+' : ''}${totalTodayPercentChange.toFixed(2)}%`;

    const holdingsSummaryList = sortedHoldings.slice(0, 8).map(h => {
      const pChange = h.dailyChangePercent >= 0 ? `+${h.dailyChangePercent.toFixed(2)}%` : `${h.dailyChangePercent.toFixed(2)}%`;
      const valToday = (h.todayProfitLossUSD * currencyRate).toFixed(0);
      const sign = h.todayProfitLossUSD >= 0 ? '+' : '';
      return `• ${h.symbol} (${h.name || h.symbol}): שינוי של ${pChange}, תרומה יומית לתיק: ${sign}${valToday} ${currencySymbol} (שווי פוזיציה: ${(h.holdingValue * currencyRate).toFixed(0)} ${currencySymbol})`;
    }).join('\n');

    const prompt = `אתה מנהל השקעות ראשי ואנליסט וול סטריט בכיר עבור לקוח פרטי.
הלקוח פתח את אפליקציית ניהול התיק שלו ולוחץ על כפתור: "${isPositiveDay ? 'למה התיק שלי עלה היום?' : 'למה התיק שלי ירד היום?'}".

הנה נתוני האמת של התיק שלו היום:
- שינוי יומי כולל בתיק: ${formattedTotalToday} (${formattedPercent})
- המניות המרכזיות בתיק והתנועה שלהן היום:
${holdingsSummaryList}

המשימה שלך:
להסביר למשקיע במילים פשוטות, רהוטות, מרגיעות ומקצועיות בדיוק מה קרה היום לתיק שלו.
אל תדבר בסיסמאות רובוטיות ("שלב 1, שלב 2"). דבר כמו אנליסט אנושי מנוסה שמדבר ישירות ללקוח.

חשוב להתייחס ל:
1. איזה מניות ספציפיות בתיק שלו היו הקטר המרכזי שמשך למעלה/למטה.
2. מה קרה היום בשוק (וול סטריט, מדדי S&P 500 / נאסד"ק, סקטור הטכנולוגיה, ריבית, חדשות מאקרו, או חדשות ודוחות ספציפיים בחברות האלה).
3. שורה תחתונה ברורה ופרספקטיבה (האם מדובר בתנודתיות יומית טבעית, מימוש רווחים, מגמה רחבה, או משהו שדורש תשומת לב).

החזר אך ורק אובייקט JSON תקין (ללא markdown codeblock, ללא backticks) לפי המבנה המדויק הבא:
{
  "headline": "כותרת קולעת בת 5-10 מילים המסכמת את מה שקרה היום",
  "direction": "${isPositiveDay ? 'profit' : 'loss'}",
  "executiveSummary": "פסקה מסכמת וברורה (3-5 שורות) המסבירה בגובה העיניים מדוע התיק זז כך היום",
  "keyDrivers": [
    {
      "symbol": "סימול המניה (למשל NVDA)",
      "impactType": "positive" או "negative",
      "summary": "הסבר תמציתי במשפט אחד-שניים מדוע מניה זו עלתה/ירדה היום ומה הייתה השפעתה"
    }
  ],
  "marketContext": "סקירה קצרה (2-3 שורות) על רוח השוק הכללית היום בוול סטריט (מדדים, סקטורים, מאקרו)",
  "bottomLine": "שורה תחתונה והמלצת ראייה למשקיע (2-3 שורות של פרספקטיבה מקצועית ורגועה)"
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
                maxOutputTokens: 1200,
              },
            }),
            signal: AbortSignal.timeout(18000),
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

        if (parsedResult && parsedResult.headline && parsedResult.executiveSummary) {
          break;
        }
      } catch (err) {
        console.error(`Gemini diagnosis failed with model ${model}:`, err);
      }
    }

    if (!parsedResult) {
      // Fallback response based on data
      const topMover = sortedHoldings[0];
      const fallbackHeadline = isPositiveDay
        ? `עליות יומיות בתיק בהובלת ${topMover ? topMover.symbol : 'השוק'}`
        : `ירידות יומיות מתונות בתיק בהשפעת ${topMover ? topMover.symbol : 'השוק'}`;

      parsedResult = {
        headline: fallbackHeadline,
        direction: isPositiveDay ? 'profit' : 'loss',
        executiveSummary: isPositiveDay
          ? `התיק שלך רושם היום עלייה כוללת של ${formattedTotalToday} (${formattedPercent}). העלייה נובעת בעיקר מחוזקה במניות המובילות בתיק וסנטימנט שוק חיובי בוול סטריט.`
          : `התיק שלך ירד היום ב-${formattedTotalToday} (${formattedPercent}). הירידה מרוכזת בעיקר במניות המרכזיות ומשקפת תנודתיות שגרתית במסחר בוול סטריט.`,
        keyDrivers: sortedHoldings.slice(0, 3).map(h => ({
          symbol: h.symbol,
          impactType: h.todayProfitLossUSD >= 0 ? 'positive' : 'negative',
          summary: `${h.symbol} זזה היום ב-${h.dailyChangePercent >= 0 ? '+' : ''}${h.dailyChangePercent.toFixed(2)}% והשפיעה ב-${h.todayProfitLossUSD >= 0 ? '+' : ''}${(h.todayProfitLossUSD * currencyRate).toFixed(0)} ${currencySymbol} על התיק.`
        })),
        marketContext: 'מדדי וול סטריט המרכזיים מתאפיינים במסחר תנודתי סביב נתוני מאקרו וציפיות הריבית, לצד תנועות בסקטור הטכנולוגיה.',
        bottomLine: 'תנודתיות יומית היא חלק טבעי בהשקעות במניות. התיק מורכב מחברות מובילות והדגש הוא על מחיר היעד של האנליסטים לטווח הבינוני והארוך.'
      };
    }

    return NextResponse.json({
      success: true,
      data: parsedResult,
      totalTodayChangeFormatted: formattedTotalToday,
      totalTodayPercentFormatted: formattedPercent,
      isPositiveDay,
    });
  } catch (error: any) {
    console.error('Portfolio diagnosis route error:', error);
    return NextResponse.json(
      { error: 'אירעה שגיאה באבחון ביצועי התיק. נסה שוב בעוד מספר רגעים.' },
      { status: 500 }
    );
  }
}
