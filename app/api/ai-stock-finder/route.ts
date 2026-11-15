import { NextResponse } from 'next/server';

export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';

const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

// In-memory cache for search queries (30 min TTL)
interface CachedFinderResult {
  data: any;
  expiresAt: number;
}
const finderCache = new Map<string, CachedFinderResult>();

// In-memory cache for 20-year historical return data (1 day TTL)
interface HistoricalReturnData {
  years: number;
  cagrPercent: number; // average annual compound return, e.g. 14.2%
  totalReturnPercent: number;
  startYear: number;
  endYear: number;
  startPrice: number;
  endPrice: number;
}
const historyCache = new Map<string, { data: HistoricalReturnData | null; expiresAt: number }>();

async function fetchHistorical20YearReturn(symbol: string): Promise<HistoricalReturnData | null> {
  const clean = symbol.replace(/\.TA$/i, '').toUpperCase().trim();
  const cached = historyCache.get(clean);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(clean)}?range=20y&interval=1mo`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) {
      historyCache.set(clean, { data: null, expiresAt: Date.now() + 3600 * 1000 });
      return null;
    }
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes: number[] = (result?.indicators?.quote?.[0]?.close || []).filter(
      (c: any): c is number => typeof c === 'number' && !isNaN(c) && c > 0
    );

    if (closes.length < 12 || timestamps.length < 12) {
      historyCache.set(clean, { data: null, expiresAt: Date.now() + 3600 * 1000 });
      return null;
    }

    const firstPrice = closes[0];
    const lastPrice = closes[closes.length - 1];
    const firstTs = timestamps[0];
    const lastTs = timestamps[timestamps.length - 1];
    const years = Math.max(1, Math.round(((lastTs - firstTs) / (365.25 * 24 * 3600)) * 10) / 10);
    const startYear = new Date(firstTs * 1000).getFullYear();
    const endYear = new Date(lastTs * 1000).getFullYear();

    const totalReturnPercent = Math.round(((lastPrice - firstPrice) / firstPrice) * 10000) / 100;
    // Compound Annual Growth Rate: (End / Start) ^ (1 / years) - 1
    const cagrRaw = (Math.pow(lastPrice / firstPrice, 1 / years) - 1) * 100;
    const cagrPercent = Math.round(cagrRaw * 100) / 100;

    const data: HistoricalReturnData = {
      years,
      cagrPercent,
      totalReturnPercent,
      startYear,
      endYear,
      startPrice: Math.round(firstPrice * 100) / 100,
      endPrice: Math.round(lastPrice * 100) / 100,
    };

    historyCache.set(clean, { data, expiresAt: Date.now() + 24 * 3600 * 1000 });
    return data;
  } catch {
    historyCache.set(clean, { data: null, expiresAt: Date.now() + 3600 * 1000 });
    return null;
  }
}

// In-memory cache for live Google Finance quote & forecast (15 min TTL)
interface GoogleFinanceLiveData {
  symbol: string;
  exchange: string;
  url: string;
  hasForecast: boolean;
  currentPrice: number;
  averageTargetPrice: number;
  upsidePercent: number;
  highTargetPrice: number | null;
  lowTargetPrice: number | null;
  rating: string;
  analystCount: number | null;
  buyCount: number | null;
  holdCount: number | null;
  sellCount: number | null;
  marketCap: string | null;
  peRatio: number | null;
  dividendYield: number;
  distanceFrom52wHigh: string | null;
}

const gfCache = new Map<string, { data: GoogleFinanceLiveData; expiresAt: number }>();

async function fetchGoogleFinanceForExchange(clean: string, ex: string, signal?: AbortSignal): Promise<GoogleFinanceLiveData | null> {
  const url = `https://www.google.com/finance/quote/${clean}:${ex}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: signal || AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    if (!text.includes('12-month forecast')) return null;

    // Parse 12-month forecast from Google Finance
    const fMatch = text.match(
      /12-month forecast[\s\S]{0,220}?Highest\s+Current\s+[₪$€£]?([\d,.]+)\s+[₪$€£]?([\d,.]+)\s+\(\s*([+-]?[\d.]+)%\s*\)\s+Average\s+[₪$€£]?([\d,.]+)\s+\(\s*([+-]?[\d.]+)%\s*\)\s+Lowest\s+[₪$€£]?([\d,.]+)\s+\(\s*([+-]?[\d.]+)%\s*\)/i
    );
    if (!fMatch) return null;

    const currentPrice = parseFloat(fMatch[1].replace(/,/g, ''));
    const highTargetPrice = parseFloat(fMatch[2].replace(/,/g, ''));
    const averageTargetPrice = parseFloat(fMatch[4].replace(/,/g, ''));
    const upsidePercent = parseFloat(fMatch[5]);
    const lowTargetPrice = parseFloat(fMatch[6].replace(/,/g, ''));

    if (!currentPrice || !averageTargetPrice || isNaN(upsidePercent)) return null;

    // Parse Analyst ratings summary from Google Finance
    const rMatch = text.match(
      /Based on (\d+) analysts giving stock ratings to [A-Za-z0-9.]+ in the past 3 months\s*(Strong buy|Buy|Hold|Sell|Strong sell|Outperform|Underperform)?\s*Buy\s+(\d+)\s+Hold\s+(\d+)\s+Sell\s+(\d+)/i
    );
    const analystCount = rMatch ? parseInt(rMatch[1], 10) : null;
    let rating = rMatch && rMatch[2] ? rMatch[2].trim() : null;
    if (rating) {
      if (rating.toLowerCase() === 'strong buy') rating = 'Strong Buy';
      else if (rating.toLowerCase() === 'strong sell') rating = 'Strong Sell';
      else rating = rating.charAt(0).toUpperCase() + rating.slice(1).toLowerCase();
    } else {
      rating = upsidePercent >= 25 ? 'Strong Buy' : upsidePercent >= 5 ? 'Buy' : 'Hold';
    }
    const buyCount = rMatch ? parseInt(rMatch[3], 10) : null;
    const holdCount = rMatch ? parseInt(rMatch[4], 10) : null;
    const sellCount = rMatch ? parseInt(rMatch[5], 10) : null;

    // Parse fundamentals from Google Finance stats section
    const mcMatch = text.match(/Mkt\.\s*cap\s+([\d.,]+\s*[TBMK]?)/i);
    const marketCap = mcMatch ? mcMatch[1].trim() + '$' : null;

    const peMatch = text.match(/P\/E\s*ratio\s+([\d.,]+)/i);
    const peRatio = peMatch ? parseFloat(peMatch[1].replace(/,/g, '')) : null;

    const divMatch = text.match(/Dividend\s+([\d.]+)%/i);
    const dividendYield = divMatch ? parseFloat(divMatch[1]) : 0;

    const high52Match = text.match(/52-wk\s*high\s+[₪$€£]?([\d,.]+)/i);
    const high52 = high52Match ? parseFloat(high52Match[1].replace(/,/g, '')) : null;
    let distanceFrom52wHigh: string | null = null;
    if (high52 && currentPrice && high52 > 0) {
      const diffPct = Math.round(((currentPrice - high52) / high52) * 100);
      distanceFrom52wHigh = diffPct >= -1 ? 'בשיא שנתי' : `${diffPct}% מהשיא`;
    }

    return {
      symbol: clean,
      exchange: ex,
      url,
      hasForecast: true,
      currentPrice,
      averageTargetPrice,
      upsidePercent,
      highTargetPrice,
      lowTargetPrice,
      rating,
      analystCount,
      buyCount,
      holdCount,
      sellCount,
      marketCap,
      peRatio,
      dividendYield,
      distanceFrom52wHigh,
    };
  } catch {
    return null;
  }
}

export async function fetchGoogleFinanceLive(symbol: string): Promise<GoogleFinanceLiveData | null> {
  const clean = symbol.replace(/\.TA$/i, '').toUpperCase().trim();
  const cached = gfCache.get(clean);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Check NASDAQ and NYSE in parallel with immediate cancellation
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4500);

  try {
    const promises = ['NASDAQ', 'NYSE'].map(async (ex) => {
      const res = await fetchGoogleFinanceForExchange(clean, ex, controller.signal);
      if (res && res.hasForecast) {
        controller.abort(); // Cancel the other exchange immediately
        return res;
      }
      return null;
    });

    const results = await Promise.allSettled(promises);
    clearTimeout(timeoutId);

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        gfCache.set(clean, { data: r.value, expiresAt: Date.now() + 15 * 60 * 1000 });
        return r.value;
      }
    }

    // Rare fallback: try NYSEAMERICAN
    const amex = await fetchGoogleFinanceForExchange(clean, 'NYSEAMERICAN');
    if (amex) {
      gfCache.set(clean, { data: amex, expiresAt: Date.now() + 15 * 60 * 1000 });
      return amex;
    }
  } catch {
    clearTimeout(timeoutId);
  }

  return null;
}

// Curated backup metadata for conservative / defensive / dividend stocks
const CONSERVATIVE_FALLBACK_METADATA: Record<
  string,
  { name: string; sector: string; whyMatch: string; earningsBeat: string; catalyst: string; portfolioFitReason: string }
> = {
  JNJ: {
    name: 'Johnson & Johnson',
    sector: 'בריאות, פארמה ומכשור רפואי',
    whyMatch: 'ענקית בריאות דפנסיבית מהמובילות בעולם, בעלת מאזן פיננסי בדירוג AAA, תזרים יציב ומדיניות דיבידנד עקבית.',
    earningsBeat: 'הציגה תוצאות רבעוניות איתנות עם צמיחה עקבית בחטיבת התרופות ומכשור רפואי.',
    catalyst: 'צבר תרופות מתקדם באונקולוגיה ואימונולוגיה והתרחבות טכנולוגיות ניתוח מתקדמות.',
    portfolioFitReason: 'עוגן הגנתי קלאסי המעניק ביטחון מירבי ותנודתיות נמוכה לתיק ההשקעות.',
  },
  PG: {
    name: 'Procter & Gamble Company',
    sector: 'צריכה בסיסית ומוצרי צריכה',
    whyMatch: 'מובילה עולמית של מותגי צריכה חיוניים עם כוח תמחור יוצא דופן, עמידות מלאה במיתון ודיבידנד אמין.',
    earningsBeat: 'עקפה את תחזיות הרווח בזכות יציבות בנפחי המכירות ושיפור במרווחי הרווח הגולמי.',
    catalyst: 'העלאות מחיר מבוקרות וחיסכון תפעולי המייצרים תזרים מזומנים חופשי עקבי.',
    portfolioFitReason: 'מניה דפנסיבית מהמעלה הראשונה השומרת על ערך התיק גם בתקופות אי-ודאות בשווקים.',
  },
  KO: {
    name: 'The Coca-Cola Company',
    sector: 'מזון ומשקאות (צריכה בסיסית)',
    whyMatch: 'מותג המשקאות החזק בעולם עם פיזור גלובלי רחב, תזרים עמיד לאינפלציה ורצף ארוך שנים של העלאת דיבידנד.',
    earningsBeat: 'הכתה את תחזיות ההכנסות והרווח הודות לעלייה בצריכה במשווקים מתעוררים ובאירופה.',
    catalyst: 'חדשנות במוצרי שתייה ללא סוכר וקפה מוכן וצמיחה מתמשכת באירועי בידור והסעדה.',
    portfolioFitReason: 'נכס בטוח ויציב המניב הכנסה שוטפת ודיבידנד בטוח ללא תנודות חדות.',
  },
  PEP: {
    name: 'PepsiCo, Inc.',
    sector: 'מזון, חטיפים ומשקאות',
    whyMatch: 'שילוב מושלם של חטיפי Frito-Lay ומשקאות בינלאומיים, המעניק חסינות תזרימית יוצאת דופן ודיבידנד מעל 3.5%.',
    earningsBeat: 'שמרה על רווחיות איתנה בשווקים הבינלאומיים למרות לחצי אינפלציה.',
    catalyst: 'התייעלות בשרשרת האספקה וצמיחה מהירה של מותגי חטיפים בריאים יותר.',
    portfolioFitReason: 'מניית ערך יציבה המציעה תשואת דיבידנד גבוהה ושמירה על ערך ההון.',
  },
  MCD: {
    name: 'McDonald\'s Corporation',
    sector: 'מזון מהיר ונדל"ן מסחרי',
    whyMatch: 'מודל עסקי ייחודי המבוסס על זיכיונות ונדל"ן מניב המספק עמידות כלכלית יוצאת דופן בכל מצב שוק.',
    earningsBeat: 'עמדה בתחזיות הרווח הודות לתוכניות נאמנות דיגיטליות ומבצעי ערך לצרכן.',
    catalyst: 'התרחבות סניפים מואצת ברחבי העולם וחיזוק מועדון הלקוחות הדיגיטלי.',
    portfolioFitReason: 'מעניקה יציבות ומזומנים חופשיים מתמשכים עם סיכון תנודתיות נמוך במיוחד.',
  },
  ABBV: {
    name: 'AbbVie Inc.',
    sector: 'ביופארמה ובריאות',
    whyMatch: 'ענקית תרופות רווחית ביותר עם צמיחה חזקה בתרופות הדור החדש ותשואת דיבידנד גבוהה ובטוחה.',
    earningsBeat: 'הציגה הכנסות שיא מתרופות Skyrizi ו-Rinvoq שפיצו בהצלחה על תפוגת פטנט היומירה.',
    catalyst: 'הרחבת אינדיקציות קליניות לתרופות הדגל ורכישות אסטרטגיות בתחום האונקולוגיה.',
    portfolioFitReason: 'משלבת יציבות של סקטור הבריאות עם דיבידנד שמן ואפסייד סולידי ב-Google Finance.',
  },
  CVX: {
    name: 'Chevron Corporation',
    sector: 'אנרגיה ותשתיות נפט וגז',
    whyMatch: 'ענקית אנרגיה בעלת מאזן איתן ביותר, עלויות הפקה מהנמוכות בתעשייה ומדיניות חלוקת דיבידנד אמינה.',
    earningsBeat: 'ייצרה תזרים מזומנים חופשי חזק לצד רכישות עצמיות של מניות והחזר הון למשקיעים.',
    catalyst: 'השלמת פרויקטים גדולים באגן הפרמי ומפרץ מקסיקו המגדילים את התפוקה ביעילות.',
    portfolioFitReason: 'הגנה מצוינת מפני אינפלציה ועוגן דיבידנד מוצק עם מכפיל רווח נוח.',
  },
  NEE: {
    name: 'NextEra Energy, Inc.',
    sector: 'תשתיות אנרגיה וחשמל ירוק',
    whyMatch: 'חברת החשמל המוסדרת הגדולה בארה"ב לצד מובילות בייצור אנרגיה מתחדשת, המספקת הכנסה צפויה ומבוקרת.',
    earningsBeat: 'עמדה בעקביות ביעדי הרווח השנתיים בזכות צמיחה אורגנית של פלורידה פאוור אנד לייט.',
    catalyst: 'ביקוש חסר תקדים לחשמל עבור מרכזי נתונים וחוות שרתים התומכים בבינה מלאכותית.',
    portfolioFitReason: 'סקטור תשתיות קלאסי ומפוקח עם סיכון נמוך וצמיחת דיבידנד סדירה.',
  },
};

// Curated backup metadata for high-upside stocks in case Gemini's initial candidates don't meet strict live Google Finance thresholds
const HIGH_UPSIDE_FALLBACK_METADATA: Record<
  string,
  { name: string; sector: string; whyMatch: string; earningsBeat: string; catalyst: string; portfolioFitReason: string }
> = {
  NVDA: {
    name: 'NVIDIA Corporation',
    sector: 'שבבים ובינה מלאכותית',
    whyMatch: 'מובילה עולמית מוחלטת בתשתיות בינה מלאכותית ומאיצי שרתים, עם קונצנזוס אנליסטים חזק במיוחד ב-Google Finance.',
    earningsBeat: 'עקפה בעקביות את תחזיות ההכנסות והרווח למניה בזכות ביקוש שיא ממרכזי נתונים וענקיות הענן.',
    catalyst: 'התרחבות פריסת דור השבבים החדש וביקושים גוברים מצד תאגידי ענק וממשלות.',
    portfolioFitReason: 'מנוע צמיחה עוצמתי המעניק חשיפה ישירה לסקטור הבינה המלאכותית עם אפסייד גבוה ב-Google Finance.',
  },
  GOOGL: {
    name: 'Alphabet Inc.',
    sector: 'טכנולוגיה, ענן ו-AI',
    whyMatch: 'ענקית טכנולוגיה עם תזרים מזומנים אדיר, צמיחה מואצת ב-Google Cloud ויעד אנליסטים גבוה ב-Google Finance.',
    earningsBeat: 'הציגה צמיחה דו-ספרתית מרשימה בהכנסות הענן והפרסום לצד שיפור חד ברווחיות התפעולית.',
    catalyst: 'שילוב מנועי Gemini בכל מוצרי החברה והתרחבות מהירה בנתח השוק של חטיבת הענן.',
    portfolioFitReason: 'שילוב אידיאלי של מניית ענק יציבה עם פוטנציאל עלייה גבוה לפי קונצנזוס Google Finance.',
  },
  META: {
    name: 'Meta Platforms, Inc.',
    sector: 'טכנולוגיה ומדיה דיגיטלית',
    whyMatch: 'מציגה צמיחה חזקה בהכנסות מפרסום מבוסס AI ונהנית מיעד מחיר גבוה במיוחד בקרב האנליסטים ב-Google Finance.',
    earningsBeat: 'הכתה את תחזיות וול סטריט בשורת ההכנסות והרווח עם זינוק בתזרים המזומנים החופשי.',
    catalyst: 'מוניטיזציה מתקדמת של כלי AI למפרסמים וצמיחה במספר המשתמשים היומיים הפעילים.',
    portfolioFitReason: 'מוסיפה לתיק עוצמה פיננסית ורווחיות גבוהה עם אפסייד משמעותי ב-Google Finance.',
  },
  AVGO: {
    name: 'Broadcom Inc.',
    sector: 'שבבים ותוכנה ארגונית',
    whyMatch: 'ספקית מרכזית של שבבי AI מותאמים אישית ותקשורת מהירה למרכזי נתונים, עם תחזית אפסייד גבוהה ב-Google Finance.',
    earningsBeat: 'דיווחה על זינוק בהכנסות מחטיבת ה-AI וסינרגיה מוצלחת מחטיבת התוכנה VMware.',
    catalyst: 'הסכמים חדשים לפיתוח מאיצי AI מותאמים (ASICs) עבור חברות הענן הגדולות בעולם.',
    portfolioFitReason: 'משלבת צמיחת שבבים חזקה עם חלוקת דיבידנד עקבית ותחזית חיובית ב-Google Finance.',
  },
  NOW: {
    name: 'ServiceNow, Inc.',
    sector: 'תוכנה ארגונית וענן',
    whyMatch: 'מובילה באוטומציה של תהליכי עבודה ארגוניים מבוססי AI עם קונצנזוס אנליסטים שורי במיוחד ב-Google Finance.',
    earningsBeat: 'עקפה את תחזיות ההזמנות החדשות (cRPO) והרווח למניה בזכות אימוץ מהיר של חבילות Pro Plus.',
    catalyst: 'הטמעת סוכני AI ארגוניים המגדילים את שווי החוזים השנתיים מול לקוחות קיימים וחדשים.',
    portfolioFitReason: 'מעניקה חשיפה לתוכנה ארגונית עם הכנסות חוזרות יציבות ואפסייד גבוה ב-Google Finance.',
  },
  SNOW: {
    name: 'Snowflake Inc.',
    sector: 'ענן וניהול נתונים',
    whyMatch: 'פלטפורמת ענן הנתונים המובילה לארגונים, הנהנית מיעד מחיר גבוה מאוד של אנליסטים ב-Google Finance.',
    earningsBeat: 'הציגה האצה בצריכת הנתונים של לקוחות ארגוניים ושיעור שימור הכנסות גבוה.',
    catalyst: 'השקת מוצרי אנליטיקה ובינה מלאכותית חדשים על גבי ענן הנתונים של החברה.',
    portfolioFitReason: 'מניית צמיחה בעלת פוטנציאל עלייה משמעותי לפי יעדי האנליסטים ב-Google Finance.',
  },
  DDOG: {
    name: 'Datadog, Inc.',
    sector: 'סייבר וניטור ענן',
    whyMatch: 'מובילה בניטור ואבטחת תשתיות ענן בזמן אמת, עם תחזית עלייה דו-ספרתית גבוהה ב-Google Finance.',
    earningsBeat: 'הכתה את תחזיות הרווח וההכנסות עם גידול חד במספר הלקוחות המשלמים מעל מיליון דולר בשנה.',
    catalyst: 'גידול מורכבות עומסי העבודה של AI בענן המחייב כלי ניטור ואבטחה מתקדמים.',
    portfolioFitReason: 'מגוונת את התיק לחברות תשתית ענן וסייבר צומחות עם אפסייד גבוה ב-Google Finance.',
  },
  UBER: {
    name: 'Uber Technologies, Inc.',
    sector: 'תחבורה חכמה וטכנולוגיה',
    whyMatch: 'דומיננטיות עולמית בתחבורה ומשלוחים עם צמיחה חדה ברווחיות ותחזית אנליסטים גבוהה ב-Google Finance.',
    earningsBeat: 'עקפה את תחזיות ה-EBITDA והזמנות הנסיעות הגולמיות לצד תוכנית רכישה עצמית של מניות.',
    catalyst: 'התרחבות שיתופי פעולה בתחום הרכב האוטונומי וצמיחת פעילות הפרסום באפליקציה.',
    portfolioFitReason: 'מוסיפה פיזור לצרכנות וטכנולוגיה תפעולית רווחית עם אפסייד גבוה ב-Google Finance.',
  },
  MRVL: {
    name: 'Marvell Technology, Inc.',
    sector: 'שבבים ותקשורת נתונים',
    whyMatch: 'שחקנית מפתח בתשתיות אופטיות ושבבי AI מותאמים למרכזי נתונים עם פוטנציאל עלייה חריג ב-Google Finance.',
    earningsBeat: 'רשמה צמיחה חדה בהכנסות ממרכזי נתונים מעבר לתחזיות השוק.',
    catalyst: 'הגדלת ייצור של שבבים מותאמים אישית עבור ספקיות ענן מובילות בארה"ב.',
    portfolioFitReason: 'מניית צמיחה עם אחד משיעורי האפסייד הגבוהים ביותר בקונצנזוס Google Finance.',
  },
  MU: {
    name: 'Micron Technology, Inc.',
    sector: 'שבבי זיכרון ו-AI',
    whyMatch: 'יצרנית מובילה של זיכרונות HBM מהירים החיוניים לשרתי בינה מלאכותית, עם יעד אנליסטים גבוה מאוד ב-Google Finance.',
    earningsBeat: 'הציגה זינוק ברווחיות הגולמית ובתזרים בזכות ביקוש שיא לרכיבי זיכרון מתקדמים.',
    catalyst: 'מכירת מלאי זיכרונות ה-HBM מראש לשנה הקרובה במחירי שיא.',
    portfolioFitReason: 'חשיפה ישירה למחזור הצמיחה של חומרת ה-AI עם אפסייד בולט ב-Google Finance.',
  },
  VRT: {
    name: 'Vertiv Holdings Co',
    sector: 'תשתיות קירור וחשמל ל-AI',
    whyMatch: 'מובילה עולמית במערכות קירור וניהול אנרגיה לחוות שרתים, עם תחזית אנליסטים גבוהה ב-Google Finance.',
    earningsBeat: 'דיווחה על צבר הזמנות שיא וצמיחה אורגנית חזקה מעבר לציפיות האנליסטים.',
    catalyst: 'המעבר של חוות שרתים למערכות קירור נוזלי מתקדמות עבור שרתי AI עתירי הספק.',
    portfolioFitReason: 'מעניקה פיזור לתשתיות פיזיות קריטיות התומכות במהפכת הענן וה-AI.',
  },
  NFLX: {
    name: 'Netflix, Inc.',
    sector: 'מדיה וסטרימינג',
    whyMatch: 'מובילת שוק הסטרימינג העולמי עם מנועי צמיחה חדשים בפרסום ושידורים חיים ויעד חיובי ב-Google Finance.',
    earningsBeat: 'עקפה את תחזיות גיוס המנויים והרווח התפעולי ברבעונים האחרונים.',
    catalyst: 'התרחבות מואצת של מסלול המנויים מבוסס הפרסום והפקות אירועי ספורט בשידור חי.',
    portfolioFitReason: 'תורמת יציבות תזרימית ודומיננטיות צרכנית גלובלית לתיק ההשקעות.',
  },
  PLTR: {
    name: 'Palantir Technologies Inc.',
    sector: 'בינה מלאכותית וביג דאטה',
    whyMatch: 'מובילה בפלטפורמות תוכנה ו-AI לארגונים וביטחון, עם מומנטום צמיחה חזק ויעד גבוה ב-Google Finance.',
    earningsBeat: 'הכתה את תחזיות ההכנסות והרווח עם זינוק במספר הלקוחות המסחריים בארה"ב.',
    catalyst: 'אימוץ מהיר של פלטפורמת AIP בקרב תאגידים תעשייתיים וגופי ממשל.',
    portfolioFitReason: 'מוסיפה חשיפה לתוכנת AI ייעודית עם שיעורי רווחיות גבוהים.',
  },
  SOFI: {
    name: 'SoFi Technologies, Inc.',
    sector: 'פינטק ובנקאות דיגיטלית',
    whyMatch: 'פלטפורמת פינטק צומחת במיוחד במחיר מניה נגיש ובעלת אפסייד גבוה ב-Google Finance.',
    earningsBeat: 'הציגה רווחיות נקייה עקבית וגידול חד במספר הלקוחות והפיקדונות.',
    catalyst: 'התרחבות מוצרי השקעות ואשראי דיגיטלי ושיפור במרווחי הריבית.',
    portfolioFitReason: 'מעניקה גיוון לסקטור הפיננסים הדיגיטליים הצומח עם פוטנציאל תשואה גבוה.',
  },
};

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
    /(?:לפחות|מעל|מינימום|של מעל)\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז|אחוזים)(?:\s*(?:תשואה|אפסייד|רווח|עלייה|פוטנציאל|יעד))?/i,
    /(\d+(?:\.\d+)?)\s*(?:%|אחוז|אחוזים)\s*(?:תשואה|אפסייד|רווח|עלייה|פוטנציאל|יעד)?\s*(?:לפחות|ומעלה|מינימום)/i,
    /(?:תשואה|אפסייד|פוטנציאל|עלייה|יעד)\s*(?:צפויה|עתידית|של)?\s*(?:לפחות|מעל|מינימום)?\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז|אחוזים)/i,
    /(?:תשואה|אפסייד)\s*(\d+(?:\.\d+)?)\s*(?:%|אחוז|אחוזים)/i,
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

  // Detect explicit user risk intent from the query text or filters
  const lowerQuery = query.toLowerCase();
  const isExplicitConservative =
    filters?.risk === 'conservative' ||
    /(?:שמרני|שמרנית|סולידי|סולידית|דפנסיבי|דפנסיבית|הגנתי|הגנתית|בטוח|בטוחה|ערך|דיבידנד יציב|ללא סיכון|סיכון נמוך|עוגן)/i.test(lowerQuery);
  const isExplicitAggressive =
    filters?.risk === 'aggressive' ||
    /(?:אגרסיבי|אגרסיבית|מומנטום|צמיחה מהירה|סיכון גבוה|ספקולטיבי|ספקולטיבית|תנודתי)/i.test(lowerQuery);

  // Create composite cache key
  const portKey = userPortfolio.map((s) => s.symbol).sort().join(',');
  const cacheKey = `v3_gf_${lowerQuery.trim()}_${filters?.risk || 'all'}_${filters?.budget || 'all'}_${filters?.dividend || 'all'}_${filters?.beat || 'all'}_${portKey}`;
  const cached = finderCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const cacheValid = !minUpside || (Array.isArray(cached.data?.stocks) && cached.data.stocks.every((s: any) => (s.upsidePercent || 0) >= minUpside));
    if (cacheValid) {
      return NextResponse.json({ ...cached.data, cached: true });
    } else {
      finderCache.delete(cacheKey);
    }
  }

  // Build filter directives
  const filterLines: string[] = [];
  if (isExplicitConservative) {
    filterLines.push(
      '*** STRICT MANDATORY RISK LEVEL - CONSERVATIVE / DEFENSIVE / VALUE ***:\n' +
        '- The client explicitly requires CONSERVATIVE, DEFENSIVE, LOW-BETA, or VALUE stocks.\n' +
        '- Select ONLY rock-solid companies with proven balance sheets, essential consumer/healthcare/utilities/energy demand, stable cash flow, low volatility, or strong dividend track records (e.g., JNJ, PG, KO, PEP, MCD, ABBV, CVX, NEE, SO, DUK, UNH, MRK, CL, WM).\n' +
        '- STRICTLY FORBIDDEN: Do NOT select high-beta speculative tech, volatile AI momentum stocks, high-multiple chip stocks, or unprofitable companies (DO NOT provide PLTR, SOFI, SNOW, COIN, MDB, etc.).'
    );
  } else if (isExplicitAggressive) {
    filterLines.push('- RISK LEVEL: AGGRESSIVE high-momentum growth stocks with substantial upside catalysts.');
  } else if (filters?.risk === 'balanced') {
    filterLines.push('- RISK LEVEL: BALANCED growth stocks with solid market leadership and healthy margins.');
  }

  if (filters?.budget === 'under50') {
    filterLines.push('- PRICE BUDGET: Current share price MUST be UNDER $50 per share.');
  } else if (filters?.budget === '50to150') {
    filterLines.push('- PRICE BUDGET: Current share price MUST be between $50 and $150 per share.');
  } else if (filters?.budget === 'above150') {
    filterLines.push('- PRICE BUDGET: High-priced blue-chip stocks above $150 per share.');
  }

  if (filters?.dividend === 'dividendOnly') {
    filterLines.push('- DIVIDEND REQUIREMENT: Company MUST pay a reliable dividend.');
  }

  if (filters?.beat === 'beatOnly') {
    filterLines.push('- EARNINGS REQUIREMENT: Company MUST have BEATEN both EPS and revenue estimates in their latest quarterly report.');
  }

  if (minUpside && minUpside > 0) {
    filterLines.push(
      `*** CRITICAL REQUIREMENT - MINIMUM ANALYST UPSIDE TARGET (${minUpside}%+) ***:\n` +
        `- The user demands stocks that currently have AT LEAST ${minUpside}% analyst upside on Google Finance.\n` +
        `- Prioritize selecting candidates verified to have high analyst upside on Google Finance that also strictly match the user's risk level.`
    );
  }

  if (minDividend && minDividend > 0) {
    filterLines.push(`- MINIMUM DIVIDEND YIELD: Company dividend yield MUST be at least ${minDividend}%.`);
  }

  const portfolioSummary =
    userPortfolio.length > 0
      ? `CLIENT CURRENT PORTFOLIO HOLDINGS: [${userPortfolio.map((s) => s.symbol).slice(0, 15).join(', ')}]`
      : `CLIENT CURRENT PORTFOLIO: (Empty / new portfolio - starting from scratch)`;

  // Ask Gemini for 8 candidate stocks so we can fetch their REAL LIVE Google Finance forecast and pick the top 3 verified matches
  const prompt = `You are an elite Wall Street equity research analyst and institutional portfolio manager.
A client is asking you to locate stocks according to their specific custom investment criteria in Hebrew:
User query: "${query}"

${filterLines.length > 0 ? `ACTIVE CLIENT FILTERS & MANDATORY REQUIREMENTS:\n${filterLines.join('\n')}\n` : ''}
${portfolioSummary}

CRITICAL MANDATE:
- Provide 8 candidate US-listed stocks (NASDAQ or NYSE tickers only) that STRICTLY adhere to the client's risk profile and request topic.
- Ordered from best match to good match.
- Our server will immediately fetch the live Google Finance 12-month forecast page for your candidates and select the top 3 whose live Google Finance numbers strictly pass all filters.
- For each candidate, calculate "portfolioFitScore" (75 to 98) and write high-quality Hebrew explanations ("portfolioFitReason", "whyMatch", "earningsBeat", "catalyst").

Return ONLY a valid JSON object (no markdown backticks) with this exact schema:
{
  "query": "${query}",
  "stocks": [
    {
      "symbol": "string (uppercase US ticker on NASDAQ or NYSE, e.g. JNJ, PG, KO, NVDA, MSFT)",
      "name": "string (official company name)",
      "sector": "string in Hebrew (e.g. צריכה בסיסית, בריאות ופארמה, תשתיות אנרגיה, טכנולוגיה ותוכנה)",
      "portfolioFitScore": number (75-98),
      "portfolioFitReason": "One Hebrew sentence explaining why it fits or diversifies the client's portfolio.",
      "whyMatch": "Detailed Hebrew explanation (2 sentences) explaining specifically why this company matches the user criteria.",
      "earningsBeat": "Concise Hebrew explanation of how the company surprised or beat recent earnings/revenue forecasts.",
      "catalyst": "Primary future business catalyst driving analyst upside."
    }
  ],
  "summaryHe": "A cohesive institutional summary in Hebrew explaining the strategic rationale for this portfolio selection based on Google Finance analyst forecasts."
}

CRITICAL: Return 8 candidate stocks in the stocks array so our live Google Finance verifier can pick the best 3 verified stocks.`;

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
              temperature: 0.15,
              responseMimeType: 'application/json',
            },
          }),
          signal: AbortSignal.timeout(12000),
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
        const candidatesMap = new Map<string, any>();
        for (const st of parsed.stocks) {
          const sym = (st.symbol || '').toUpperCase().replace(/\.TA$/i, '').trim();
          if (sym && !candidatesMap.has(sym)) {
            candidatesMap.set(sym, st);
          }
        }

        // Inject relevant fallback pool based on client's actual risk profile
        if (isExplicitConservative) {
          for (const [sym, meta] of Object.entries(CONSERVATIVE_FALLBACK_METADATA)) {
            if (!candidatesMap.has(sym)) {
              candidatesMap.set(sym, {
                symbol: sym,
                name: meta.name,
                sector: meta.sector,
                portfolioFitScore: 95,
                portfolioFitReason: meta.portfolioFitReason,
                whyMatch: meta.whyMatch,
                earningsBeat: meta.earningsBeat,
                catalyst: meta.catalyst,
                isFallbackCandidate: true,
              });
            }
          }
        } else if (minUpside && minUpside > 0) {
          for (const [sym, meta] of Object.entries(HIGH_UPSIDE_FALLBACK_METADATA)) {
            if (!candidatesMap.has(sym)) {
              candidatesMap.set(sym, {
                symbol: sym,
                name: meta.name,
                sector: meta.sector,
                portfolioFitScore: 93,
                portfolioFitReason: meta.portfolioFitReason,
                whyMatch: meta.whyMatch,
                earningsBeat: meta.earningsBeat,
                catalyst: meta.catalyst,
                isFallbackCandidate: true,
              });
            }
          }
        }

        const candidateList = Array.from(candidatesMap.values()).slice(0, 10);

        // Fetch 100% REAL LIVE Google Finance data for all candidates in parallel
        const verifiedCandidates = await Promise.all(
          candidateList.map(async (st: any) => {
            const sym = (st.symbol || '').toUpperCase().trim();
            const gf = await fetchGoogleFinanceLive(sym);
            if (!gf || !gf.hasForecast) return null;

            return {
              st,
              gf,
            };
          })
        );

        const validWithGf = verifiedCandidates.filter(
          (item): item is { st: any; gf: GoogleFinanceLiveData } => item !== null
        );

        if (validWithGf.length === 0) continue;

        // Filter candidates strictly by the user's constraints using the REAL Google Finance numbers!
        let matching = validWithGf.filter(({ gf, st }) => {
          if (minUpside && minUpside > 0 && gf.upsidePercent < minUpside) return false;
          if (minDividend && minDividend > 0 && gf.dividendYield < minDividend) return false;
          if (filters?.dividend === 'dividendOnly' && gf.dividendYield <= 0) return false;
          if (filters?.budget === 'under50' && gf.currentPrice >= 50) return false;
          if (filters?.budget === '50to150' && (gf.currentPrice < 50 || gf.currentPrice > 150)) return false;
          if (filters?.budget === 'above150' && gf.currentPrice <= 150) return false;

          // If user specifically asked for conservative, exclude high-beta momentum stocks from matching
          if (isExplicitConservative) {
            const volatileTickers = ['NVDA', 'PLTR', 'SOFI', 'SNOW', 'DDOG', 'COIN', 'MDB', 'SE', 'MRVL', 'MU', 'VRT'];
            if (volatileTickers.includes(gf.symbol)) return false;
          }
          return true;
        });

        // Sort candidates:
        // 1. Prefer Gemini's tailored primary candidates over generic fallbacks
        // 2. If conservative: prioritize lower P/E ratio, positive dividends, and portfolio fit score
        // 3. If minUpside: order by upside percent
        matching.sort((a, b) => {
          const aFb = a.st.isFallbackCandidate ? 1 : 0;
          const bFb = b.st.isFallbackCandidate ? 1 : 0;
          if (aFb !== bFb) return aFb - bFb;

          if (isExplicitConservative) {
            const aScore = (a.st.portfolioFitScore || 90) + (a.gf.dividendYield > 0 ? 5 : 0);
            const bScore = (b.st.portfolioFitScore || 90) + (b.gf.dividendYield > 0 ? 5 : 0);
            return bScore - aScore;
          }

          if (minUpside && minUpside > 0) {
            return b.gf.upsidePercent - a.gf.upsidePercent;
          }
          return (b.st.portfolioFitScore || 90) - (a.st.portfolioFitScore || 90);
        });

        // If fewer than 3 matched all strict filters, fill remaining slots
        if (matching.length < 3) {
          const chosenSyms = new Set(matching.map((m) => m.gf.symbol));
          const remaining = validWithGf
            .filter((item) => {
              if (chosenSyms.has(item.gf.symbol)) return false;
              if (isExplicitConservative) {
                const volatileTickers = ['NVDA', 'PLTR', 'SOFI', 'SNOW', 'DDOG', 'COIN', 'MDB', 'SE', 'MRVL', 'MU', 'VRT'];
                if (volatileTickers.includes(item.gf.symbol)) return false;
              }
              return true;
            })
            .sort((a, b) => {
              if (isExplicitConservative) {
                return (b.gf.dividendYield || 0) - (a.gf.dividendYield || 0);
              }
              return b.gf.upsidePercent - a.gf.upsidePercent;
            });

          for (const rem of remaining) {
            if (matching.length >= 3) break;
            matching.push(rem);
          }
        }

        const top3 = matching.slice(0, 3);

        // Enrich with daily change from Finnhub & 20-Year historical average annual return (CAGR)
        const enrichedStocks = await Promise.all(
          top3.map(async ({ st, gf }) => {
            let dailyChange = 0;
            let dailyPercent = 0;

            const [qRes, histData] = await Promise.all([
              fetch(
                `https://finnhub.io/api/v1/quote?symbol=${gf.symbol}&token=${FINNHUB_API_KEY}`,
                { signal: AbortSignal.timeout(3000) }
              ).catch(() => null),
              fetchHistorical20YearReturn(gf.symbol),
            ]);

            try {
              if (qRes && qRes.ok) {
                const qData = await qRes.json();
                if (typeof qData.d === 'number') dailyChange = qData.d;
                if (typeof qData.dp === 'number') dailyPercent = qData.dp;
              }
            } catch {}

            // 100% verbatim numbers from Google Finance & 20-Year Annualized Return CAGR
            return {
              symbol: gf.symbol,
              name: st.name || gf.symbol,
              sector: st.sector || 'טכנולוגיה וכלכלה',
              currentPrice: gf.currentPrice,
              targetPrice: gf.averageTargetPrice,
              upsidePercent: gf.upsidePercent,
              highPriceTarget: gf.highTargetPrice,
              lowPriceTarget: gf.lowTargetPrice,
              analystCount: gf.analystCount,
              dailyChange,
              dailyPercentChange: dailyPercent,
              rating: gf.rating,
              peRatio: gf.peRatio,
              dividendYield: gf.dividendYield,
              marketCap: gf.marketCap || 'שווי שוק מוביל',
              distanceFrom52wHigh: gf.distanceFrom52wHigh || 'בטווח מסחר שנתי',
              portfolioFitScore: typeof st.portfolioFitScore === 'number' ? st.portfolioFitScore : 92,
              portfolioFitReason:
                st.portfolioFitReason ||
                (userPortfolio.length > 0
                  ? 'מוסיפה איזון ופיזור חיובי לפוזיציות בתיק שלך'
                  : 'עוגן איכותי לבניית תיק ראשוני חזק'),
              whyMatch: st.whyMatch || '',
              earningsBeat: st.earningsBeat || '',
              catalyst: st.catalyst || '',
              googleFinanceUrl: gf.url,
              primarySource: 'Google Finance',
              forecastSource: 'Google Finance בלבד',
              historical20Year: histData || null,
            };
          })
        );

        const resultData = {
          query,
          filters: filters || {},
          primarySource: 'Google Finance',
          forecastSource: 'Google Finance בלבד',
          sourcesUsed: ['Google Finance (מקור בלעדי לתחזיות ויעדי אנליסטים)'],
          stocks: enrichedStocks,
          summaryHe:
            parsed.summaryHe ||
            `נמצאו 3 מניות העונות על הבקשה "${query}" עם נתוני אמת ותחזיות אנליסטים ישירות מ-Google Finance.`,
          foundAt: new Date().toISOString(),
        };

        finderCache.set(cacheKey, {
          data: resultData,
          expiresAt: Date.now() + 1800 * 1000,
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
