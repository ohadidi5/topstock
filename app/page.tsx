"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  Search, TrendingUp, TrendingDown, Trash2, Activity, Plus, Settings, Sparkles, RefreshCw, Clock,
  LineChart, X, Target, Calendar, Bookmark, Eye,
  User, LogIn, LogOut, KeyRound, CheckCircle2, Menu, Scale, ExternalLink
} from 'lucide-react';

type Currency = 'ILS' | 'USD' | 'EUR';
const CURRENCY_SYMBOLS: Record<Currency, string> = { ILS: '₪', USD: '$', EUR: '€' };
const CURRENCY_LABELS: Record<Currency, string> = { ILS: 'שקל (₪)', USD: 'דולר ($)', EUR: 'אירו (€)' };

interface Stock {
  symbol: string;
  name: string;
  buyPrice: number;
  investedAmount: number;
  currentPrice?: number;
  dailyChange?: number;
  dailyPercentChange?: number;
  targetPrice?: number;
  targetRating?: string;
  targetForecastPercent?: number;
  targetDate?: string;
  buyDate?: string; // ISO date string of when stock was purchased
  nextEarnings?: {
    date: string;
    hour?: string | null;
    quarter?: number | null;
    year?: number | null;
    hasReported?: boolean;
    isToday?: boolean;
  } | null;
  dividend?: {
    yieldPercent: number;
    annualPerShare: number;
  } | null;
}

function formatEarningsCountdown(earnings?: { date: string; hour?: string | null; hasReported?: boolean; isToday?: boolean } | null) {
  if (!earnings?.date) return null;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const earningsDate = new Date(earnings.date + 'T00:00:00');
    const diffTime = earningsDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    const dateFormatted = earningsDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    let timingLabel = '';
    if (earnings.hour === 'amc') timingLabel = ' (אחרי המסחר)';
    else if (earnings.hour === 'bmo') timingLabel = ' (לפני המסחר)';

    // When earnings report is today
    if (diffDays === 0 || earnings.isToday) {
      return { text: `דוחות כספיים היום!${timingLabel}`, isUrgent: true, isRed: true, date: dateFormatted, diffDays: 0 };
    }
    // When earnings report was recently published (has reported or within past 14 days)
    if (earnings.hasReported || (diffDays < 0 && diffDays >= -14)) {
      return { text: `דוח כספי שוחרר! (${dateFormatted})`, isUrgent: true, isRed: true, date: dateFormatted, diffDays };
    }
    if (diffDays < 0) return null;
    if (diffDays === 1) return { text: `דוח כספי מחר!${timingLabel}`, isUrgent: true, isRed: true, date: dateFormatted, diffDays };
    if (diffDays <= 7) return { text: `בעוד ${diffDays} ימים (${dateFormatted})${timingLabel}`, isUrgent: true, isRed: false, date: dateFormatted, diffDays };
    return { text: `בעוד ${diffDays} ימים (${dateFormatted})${timingLabel}`, isUrgent: false, isRed: false, date: dateFormatted, diffDays };
  } catch {
    return null;
  }
}

function mergeWatchlistData(
  listA: any[] = [],
  listB: any[] = [],
  deletedMapA: Record<string, number> = {},
  deletedMapB: Record<string, number> = {}
): { mergedList: any[]; mergedDeleted: Record<string, number> } {
  const mergedDeleted: Record<string, number> = { ...(deletedMapA || {}) };
  if (deletedMapB && typeof deletedMapB === 'object') {
    for (const [sym, ts] of Object.entries(deletedMapB)) {
      mergedDeleted[sym] = Math.max(mergedDeleted[sym] || 0, typeof ts === 'number' ? ts : 0);
    }
  }

  const itemsBySymbol = new Map<string, any>();
  const allItems = [...(Array.isArray(listA) ? listA : []), ...(Array.isArray(listB) ? listB : [])];
  for (const item of allItems) {
    if (!item?.symbol) continue;
    const sym = item.symbol;
    const existingItem = itemsBySymbol.get(sym);
    if (!existingItem) {
      itemsBySymbol.set(sym, item);
    } else {
      const itemAddedAt = typeof item.addedAt === 'string' ? new Date(item.addedAt).getTime() : 0;
      const existingAddedAt = typeof existingItem.addedAt === 'string' ? new Date(existingItem.addedAt).getTime() : 0;
      if (itemAddedAt >= existingAddedAt) {
        itemsBySymbol.set(sym, { ...existingItem, ...item });
      }
    }
  }

  const mergedList: any[] = [];
  for (const [sym, item] of itemsBySymbol.entries()) {
    const deletedTimestamp = mergedDeleted[sym];
    if (deletedTimestamp) {
      const addedTimestamp = typeof item.addedAt === 'string' ? new Date(item.addedAt).getTime() : 0;
      if (addedTimestamp > deletedTimestamp) {
        delete mergedDeleted[sym];
        mergedList.push(item);
      }
    } else {
      mergedList.push(item);
    }
  }

  return { mergedList, mergedDeleted };
}

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [portfolio, setPortfolio] = useState<Stock[]>([]);
  const [selectedStock, setSelectedStock] = useState<any | null>(null);
  const [investedInput, setInvestedInput] = useState('');
  const [buyPriceInput, setBuyPriceInput] = useState('');
  const [stockToAddFunds, setStockToAddFunds] = useState<string | null>(null);
  const [addFundsInput, setAddFundsInput] = useState('');
  const [addFundsPriceInput, setAddFundsPriceInput] = useState('');
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const [selectedStockPrice, setSelectedStockPrice] = useState<number | null>(null);
  const [isFetchingStockPrice, setIsFetchingStockPrice] = useState(false);
  const [stockToDelete, setStockToDelete] = useState<Stock | null>(null);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [rates, setRates] = useState<Record<Currency, number>>({ USD: 1, ILS: 3.7, EUR: 0.92 });
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Cloud Account & Sync state
  const [accountUser, setAccountUser] = useState<{ username: string; password: string } | null>(null);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | null>(null);
  const [authUsernameInput, setAuthUsernameInput] = useState('');
  const [authPasswordInput, setAuthPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const isInitialLoadRef = useRef(true);

  // Watchlist state
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [watchlistToast, setWatchlistToast] = useState<{ message: string; symbol: string } | null>(null);

  const toggleWatchlistStock = (stockItem: { symbol: string; name?: string; shortname?: string; longname?: string }) => {
    const isExisting = watchlist.some(w => w.symbol === stockItem.symbol);
    const now = Date.now();
    let updated: any[];
    let delMap: Record<string, number> = {};
    try {
      delMap = JSON.parse(localStorage.getItem('stockWatchlistDeleted') || '{}');
    } catch (e) {}

    if (isExisting) {
      updated = watchlist.filter(w => w.symbol !== stockItem.symbol);
      delMap[stockItem.symbol] = now;
      setWatchlistToast({ message: `מניית ${stockItem.symbol} הוסרה מרשימת המעקב`, symbol: stockItem.symbol });
    } else {
      delete delMap[stockItem.symbol];
      const newItem = {
        symbol: stockItem.symbol,
        name: stockItem.name || stockItem.shortname || stockItem.longname || stockItem.symbol,
        addedAt: new Date(now).toISOString(),
      };
      updated = [newItem, ...watchlist];
      setWatchlistToast({ message: `מניית ${stockItem.symbol} נוספה לרשימת המעקב!`, symbol: stockItem.symbol });
    }

    setWatchlist(updated);
    try {
      localStorage.setItem('stockWatchlist', JSON.stringify(updated));
      localStorage.setItem('stockWatchlistDeleted', JSON.stringify(delMap));
      localStorage.setItem('stockWatchlistUpdatedAt', String(now));
    } catch (e) {}

    if (accountUser?.username && accountUser?.password) {
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync',
          username: accountUser.username,
          password: accountUser.password,
          watchlist: updated,
          watchlistDeleted: delMap,
          watchlistUpdatedAt: now,
        }),
      }).catch(console.error);
    }
    setTimeout(() => setWatchlistToast(null), 4000);
  };


  // Interactive Stock Price History Chart state
  const [chartStock, setChartStock] = useState<Stock | null>(null);
  const [chartRange, setChartRange] = useState<'1d' | '1w' | '1m' | '1y' | '5y'>('1m');
  const [chartData, setChartData] = useState<any | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartHoverIndex, setChartHoverIndex] = useState<number | null>(null);

  // Analyst analysis (Gemini reading TipRanks + StockAnalysis) – cached per symbol and date filter
  const [analysisSymbol, setAnalysisSymbol] = useState<string | null>(null);
  const [analysisDateFilter, setAnalysisDateFilter] = useState<string>('');
  const [analysisResults, setAnalysisResults] = useState<Record<string, any>>({});
  const [analysisLoading, setAnalysisLoading] = useState<Record<string, boolean>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({});

  // Top Forecast Finder (Gemini scanning TipRanks + StockAnalysis for the highest upside stock)
  const [topForecastModalOpen, setTopForecastModalOpen] = useState(false);
  const [topForecastLoading, setTopForecastLoading] = useState(false);
  const [topForecastError, setTopForecastError] = useState<string | null>(null);
  const [topForecastData, setTopForecastData] = useState<any | null>(null);

  const handleFindTopForecast = async (forceRefresh = false) => {
    setTopForecastModalOpen(true);
    if (!forceRefresh && topForecastData) return;
    if (topForecastLoading) return;

    setTopForecastLoading(true);
    setTopForecastError(null);
    try {
      const res = await fetch('/api/top-forecasts');
      const data = await res.json();
      if (!res.ok || data.error) {
        setTopForecastError(data.error || 'שגיאה בחיפוש המניות עם התחזית הגבוהה ביותר.');
      } else {
        setTopForecastData(data);
      }
    } catch {
      setTopForecastError('שגיאת רשת בחיפוש התחזיות. אנא נסה שוב.');
    } finally {
      setTopForecastLoading(false);
    }
  };

  // Gemini AI Earnings Summary state (4, 10, or 20 lines)
  const [earningsModalStock, setEarningsModalStock] = useState<{ symbol: string; name?: string } | null>(null);
  const [earningsModalLoading, setEarningsModalLoading] = useState(false);
  const [earningsModalError, setEarningsModalError] = useState<string | null>(null);
  const [earningsSummaryData, setEarningsSummaryData] = useState<any | null>(null);
  const [earningsLinesCount, setEarningsLinesCount] = useState<4 | 10 | 20>(4);
  const [earningsCopied, setEarningsCopied] = useState(false);

  const openEarningsSummary = async (stockItem: { symbol: string; name?: string }, forceRefresh = false) => {
    const symbol = stockItem.symbol;
    const name = stockItem.name || symbol;
    setEarningsModalStock({ symbol, name });
    setEarningsModalError(null);
    setEarningsLinesCount(4);

    if (!forceRefresh && earningsSummaryData && earningsSummaryData.symbol === symbol && !earningsSummaryData.epsText?.includes('לא זמין')) {
      return;
    }

    setEarningsModalLoading(true);
    try {
      const res = await fetch(`/api/earnings-summary?symbol=${encodeURIComponent(symbol)}${forceRefresh ? '&refresh=true' : ''}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'שגיאה בקבלת סיכום הדוחות');
      }
      setEarningsSummaryData(data);
    } catch (err: any) {
      setEarningsModalError(err.message || 'שגיאה לא צפויה בטעינת סיכום הדוחות');
    } finally {
      setEarningsModalLoading(false);
    }
  };

  // Tools Drawer (3-lines hamburger menu on top right)
  const [toolsDrawerOpen, setToolsDrawerOpen] = useState(false);

  // Custom AI Stock Finder (איתור מנייה לפי בקשתך)
  const [customFinderModalOpen, setCustomFinderModalOpen] = useState(false);
  const [customFinderQuery, setCustomFinderQuery] = useState('');
  const [customFinderLoading, setCustomFinderLoading] = useState(false);
  const [customFinderError, setCustomFinderError] = useState<string | null>(null);
  const [customFinderResults, setCustomFinderResults] = useState<any | null>(null);
  const [finderRisk, setFinderRisk] = useState<'all' | 'conservative' | 'balanced' | 'aggressive'>('all');
  const [finderBudget, setFinderBudget] = useState<'all' | 'under50' | '50to150' | 'above150'>('all');
  const [finderDividend, setFinderDividend] = useState<'all' | 'dividendOnly'>('all');
  const [finderBeat, setFinderBeat] = useState<'all' | 'beatOnly'>('all');
  const [showComparisonMatrix, setShowComparisonMatrix] = useState(true);
  const [projectionYears, setProjectionYears] = useState<Record<string, number | string>>({});
  const [projectionInvestments, setProjectionInvestments] = useState<Record<string, number | string>>({});

  const [customFinderStatus, setCustomFinderStatus] = useState('');

  const handleRunCustomFinder = async () => {
    if (!customFinderQuery.trim() || customFinderLoading) return;
    setCustomFinderLoading(true);
    setCustomFinderError(null);
    setCustomFinderStatus('Gemini מחפש מניות ומנתח תחזיות…');

    const maxAttempts = 3;
    let lastErrorMsg = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (attempt > 1) {
          setCustomFinderStatus(`מאמת תחזיות מול Google Finance (ניסיון ${attempt} מתוך ${maxAttempts})…`);
        }

        const controller = new AbortController();
        const timeoutDuration = attempt === 1 ? 25000 : 35000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);

        const res = await fetch('/api/ai-stock-finder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: customFinderQuery.trim(),
            filters: {
              risk: finderRisk,
              budget: finderBudget,
              dividend: finderDividend,
              beat: finderBeat,
            },
            portfolio: portfolio.map(s => ({ symbol: s.symbol, name: s.name })),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        let data: any = null;
        try {
          data = await res.json();
        } catch {
          throw new Error('תגובה לא תקינה מהשרת');
        }

        if (!res.ok || data.error) {
          throw new Error(data.error || 'שגיאה באיתור המניות');
        }

        setCustomFinderResults(data);
        setCustomFinderError(null);
        setCustomFinderLoading(false);
        setCustomFinderStatus('');
        return; // Success!
      } catch (err: any) {
        console.warn(`AI Stock Finder attempt ${attempt} failed:`, err?.message || err);
        lastErrorMsg = err?.message || 'שגיאת תקשורת';
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 600));
        }
      }
    }

    const friendlyMsg =
      lastErrorMsg.includes('Load failed') || lastErrorMsg.includes('abort') || lastErrorMsg.includes('network') || lastErrorMsg.includes('תקשורת')
        ? 'החיבור לשרת ארך מעט מהרגיל. אנא לחץ שוב על "חפש 3 מניות עם Gemini".'
        : (lastErrorMsg || 'לא הצלחנו לאתר מניות כרגע. אנא נסה שוב.');

    setCustomFinderError(friendlyMsg);
    setCustomFinderLoading(false);
    setCustomFinderStatus('');
  };

  // One-Click Portfolio Diagnosis (למה התיק שלי ירד / עלה היום?)
  const [diagnosisModalOpen, setDiagnosisModalOpen] = useState(false);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const [diagnosisData, setDiagnosisData] = useState<any | null>(null);

  const handleRunPortfolioDiagnosis = async () => {
    if (portfolio.length === 0) {
      alert('אין מניות בתיק לאבחון ביצועים. הוסף מניות לתיק כדי לקבל ניתוח יומי של Gemini.');
      return;
    }
    setDiagnosisModalOpen(true);
    setDiagnosisLoading(true);
    setDiagnosisError(null);

    try {
      const holdingsPayload = portfolio.map(stock => {
        const shares = stock.buyPrice > 0 ? stock.investedAmount / stock.buyPrice : 0;
        const curPrice = stock.currentPrice || stock.buyPrice;
        const dailyChange = stock.dailyChange || 0;
        const dailyChangePercent = stock.dailyPercentChange || 0;
        const holdingValue = shares * curPrice;
        const todayProfitLossUSD = shares * dailyChange;
        return {
          symbol: stock.symbol,
          name: stock.name || stock.symbol,
          shares,
          currentPrice: curPrice,
          dailyChange,
          dailyChangePercent,
          holdingValue,
          todayProfitLossUSD,
        };
      });

      const res = await fetch('/api/portfolio-diagnosis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdings: holdingsPayload,
          totalTodayChangeUSD,
          totalTodayPercentChange,
          currency,
          currencyRate: rates[currency] || 1,
          currencySymbol: CURRENCY_SYMBOLS[currency] || '$',
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'שגיאה באבחון ביצועי התיק');
      }
      setDiagnosisData(data.data);
    } catch (err: any) {
      setDiagnosisError(err.message || 'שגיאה ברשת באבחון התיק. אנא נסה שוב.');
    } finally {
      setDiagnosisLoading(false);
    }
  };

  // One-Click Smart Rebalance & Capital Allocation (איזון מחדש חכם)
  const [rebalanceModalOpen, setRebalanceModalOpen] = useState(false);
  const [rebalanceDepositAmount, setRebalanceDepositAmount] = useState('5000');
  const [rebalanceStrategy, setRebalanceStrategy] = useState<'balanced' | 'upside' | 'defensive'>('balanced');
  const [rebalanceLoading, setRebalanceLoading] = useState(false);
  const [rebalanceError, setRebalanceError] = useState<string | null>(null);
  const [rebalanceData, setRebalanceData] = useState<any | null>(null);
  const [rebalanceAppliedSuccess, setRebalanceAppliedSuccess] = useState(false);

  const handleRunSmartRebalance = async (customAmt?: string, customStrat?: 'balanced' | 'upside' | 'defensive') => {
    if (portfolio.length === 0) {
      alert('אין מניות בתיק לאיזון. הוסף מניות לתיק כדי לקבל תוכנית חלוקה חכמה של Gemini.');
      return;
    }
    const amtToUse = customAmt !== undefined ? customAmt : rebalanceDepositAmount;
    const stratToUse = customStrat !== undefined ? customStrat : rebalanceStrategy;
    const numAmt = parseFloat(amtToUse);
    if (isNaN(numAmt) || numAmt <= 0) {
      setRebalanceError('נא להזין סכום תקין להפקדה ואיזון.');
      return;
    }

    setRebalanceModalOpen(true);
    setRebalanceLoading(true);
    setRebalanceError(null);
    setRebalanceAppliedSuccess(false);

    try {
      const totalPortVal = portfolio.reduce((sum, s) => {
        const shares = s.buyPrice > 0 ? s.investedAmount / s.buyPrice : 0;
        return sum + (shares * (s.currentPrice || s.buyPrice));
      }, 0);

      const portfolioPayload = portfolio.map(stock => {
        const shares = stock.buyPrice > 0 ? stock.investedAmount / stock.buyPrice : 0;
        const curPrice = stock.currentPrice || stock.buyPrice;
        const curVal = shares * curPrice;
        const weight = totalPortVal > 0 ? (curVal / totalPortVal) * 100 : 0;
        const target = stock.targetPrice || analysisResults[stock.symbol]?.averagePriceTarget;
        let upside: number | undefined = undefined;
        if (target && curPrice > 0) {
          upside = Math.round(((target - curPrice) / curPrice) * 1000) / 10;
        }

        return {
          symbol: stock.symbol,
          name: stock.name || stock.symbol,
          buyPrice: stock.buyPrice,
          currentPrice: curPrice,
          investedAmount: stock.investedAmount,
          shares,
          currentValue: curVal,
          targetPrice: target,
          upsidePercent: upside,
          rating: stock.targetRating || analysisResults[stock.symbol]?.consensusRating,
          dividendYield: stock.dividend?.yieldPercent,
          portfolioWeightPercent: weight,
        };
      });

      const res = await fetch('/api/smart-rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio: portfolioPayload,
          depositAmount: numAmt,
          currency,
          currencyRate: rates[currency] || 1,
          currencySymbol: CURRENCY_SYMBOLS[currency] || '$',
          strategy: stratToUse,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'שגיאה בחישוב האיזון מחדש');
      }
      setRebalanceData(data.data);
    } catch (err: any) {
      setRebalanceError(err.message || 'שגיאת תקשורת בחישוב האיזון. אנא נסה שוב.');
    } finally {
      setRebalanceLoading(false);
    }
  };

  const handleApplyRebalanceToPortfolio = () => {
    if (!rebalanceData || !Array.isArray(rebalanceData.allocations) || rebalanceData.allocations.length === 0) return;

    const currentRate = rates[currency] || 1;
    let updatedPortfolio = [...portfolio];

    rebalanceData.allocations.forEach((alloc: any) => {
      const sym = alloc.symbol;
      const allocatedUserCurrency = alloc.allocatedAmount || 0;
      const allocatedUSD = allocatedUserCurrency / currentRate;

      if (allocatedUSD <= 0) return;

      const idx = updatedPortfolio.findIndex(s => s.symbol === sym);
      if (idx >= 0) {
        const stock = updatedPortfolio[idx];
        const oldShares = stock.buyPrice > 0 ? stock.investedAmount / stock.buyPrice : 0;
        const curPrice = stock.currentPrice || stock.buyPrice;
        const boughtShares = curPrice > 0 ? allocatedUSD / curPrice : 0;
        const newInvested = stock.investedAmount + allocatedUSD;
        const newShares = oldShares + boughtShares;
        const newBuyPrice = newShares > 0 ? newInvested / newShares : stock.buyPrice;

        updatedPortfolio[idx] = {
          ...stock,
          investedAmount: newInvested,
          buyPrice: newBuyPrice,
        };
      }
    });

    setPortfolio(updatedPortfolio);
    setRebalanceAppliedSuccess(true);
  };

  const formatAnalyzedAt = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('he-IL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const hasAnalysisForSymbol = (symbol: string) => {
    return !!(analysisResults[symbol] || Object.keys(analysisResults).some(k => k.startsWith(`${symbol}_`)));
  };

  const runAnalysis = async (
    stock: { symbol: string; currentPrice?: number },
    specificDate?: string,
    forceRefresh = false
  ) => {
    const symbol = stock.symbol;
    setAnalysisSymbol(symbol);
    const dateToUse = specificDate !== undefined ? specificDate : analysisDateFilter;
    const cacheKey = dateToUse ? `${symbol}_${dateToUse}` : symbol;

    if (!forceRefresh && analysisResults[cacheKey]) return;
    if (analysisLoading[symbol]) return;

    setAnalysisLoading(prev => ({ ...prev, [symbol]: true }));
    setAnalysisErrors(prev => ({ ...prev, [symbol]: '' }));
    try {
      let price = stock.currentPrice;
      if (price === undefined) {
        try {
          const qRes = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbol)}`);
          const qData = await qRes.json();
          if (qData?.quotes?.[symbol]?.regularMarketPrice) {
            price = qData.quotes[symbol].regularMarketPrice;
          }
        } catch (e) {
          console.error("Could not fetch current price for analysis:", e);
        }
      }

      const dateParam = dateToUse ? `&fromDate=${encodeURIComponent(dateToUse)}` : '';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch(`/api/analysis?symbol=${encodeURIComponent(symbol)}&price=${price ?? ''}${dateParam}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      let data: any = null;
      try {
        data = await res.json();
      } catch (jsonErr) {
        setAnalysisErrors(prev => ({
          ...prev,
          [symbol]: res.status === 504
            ? 'הבקשה ארכה זמן רב מדי והחיבור נותק. אנא לחץ "בדוק שוב".'
            : `השרת החזיר תשובה לא תקינה (${res.status}). אנא נסה שוב בעוד כמה שניות.`
        }));
        return;
      }

      if (!res.ok || data.error) {
        setAnalysisErrors(prev => ({ ...prev, [symbol]: data.error || 'הניתוח נכשל. נסה שוב.' }));
      } else {
        const enriched = {
          ...data,
          analyzedAt: new Date().toISOString(),
        };
        setAnalysisResults(prev => {
          const updated = { ...prev, [cacheKey]: enriched };
          try {
            localStorage.setItem('stockAnalyses', JSON.stringify(updated));
          } catch (e) {
            console.error("Could not save to localStorage:", e);
          }
          return updated;
        });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setAnalysisErrors(prev => ({ ...prev, [symbol]: 'הבקשה ארכה מעל 60 שניות. אנא לחץ "בדוק שוב".' }));
      } else {
        setAnalysisErrors(prev => ({ ...prev, [symbol]: 'שגיאת רשת. בדוק את החיבור ולחץ "בדוק שוב".' }));
      }
    } finally {
      setAnalysisLoading(prev => ({ ...prev, [symbol]: false }));
    }
  };

  const openAnalysis = (stock: { symbol: string; currentPrice?: number }, forceRefresh = false) => {
    const symbol = stock.symbol;
    setAnalysisSymbol(symbol);

    if (forceRefresh) {
      setAnalysisDateFilter('');
      runAnalysis(stock, '', true);
      return;
    }

    // If an analysis already exists for this exact date filter, display it immediately
    if (analysisDateFilter && analysisResults[`${symbol}_${analysisDateFilter}`]) {
      return;
    }

    // If an unfiltered analysis exists:
    const cached = analysisResults[symbol];
    if (cached) {
      // If it's an old cached analysis without topAverageTarget or both sources, automatically refresh
      if (!Array.isArray(cached.sourcesUsed) || cached.sourcesUsed.length < 2 || cached.topAverageTarget === undefined) {
        setAnalysisDateFilter('');
        runAnalysis(stock, '', true);
        return;
      }
      setAnalysisDateFilter('');
      return;
    }

    // If any date-filtered analysis exists for this stock, switch to that date and display it
    const cachedWithDateKey = Object.keys(analysisResults).find(k => k.startsWith(`${symbol}_`));
    if (cachedWithDateKey) {
      const cachedDate = cachedWithDateKey.substring(symbol.length + 1);
      setAnalysisDateFilter(cachedDate);
      return;
    }

    // Otherwise first-time analysis: run it
    runAnalysis(stock, analysisDateFilter || '', false);
  };

  const handleTogglePinTarget = (
    symbol: string,
    targetPrice: number,
    targetRating?: string,
    targetForecastPercent?: number,
    targetDate?: string
  ) => {
    setPortfolio(prev => {
      const updated = prev.map(s => {
        if (s.symbol === symbol) {
          const isPinned = s.targetPrice === targetPrice;
          return {
            ...s,
            targetPrice: isPinned ? undefined : targetPrice,
            targetRating: isPinned ? undefined : targetRating,
            targetForecastPercent: isPinned ? undefined : targetForecastPercent,
            targetDate: isPinned ? undefined : targetDate,
          };
        }
        return s;
      });
      try {
        localStorage.setItem('stockPortfolio', JSON.stringify(updated));
      } catch (e) {
        console.error("Could not save portfolio to localStorage:", e);
      }
      return updated;
    });
  };

  const openChartModal = (stock: Stock) => {
    setChartStock(stock);
    setChartHoverIndex(null);
    fetchChart(stock.symbol, chartRange);
  };

  const fetchChart = async (symbol: string, range: string) => {
    setChartLoading(true);
    setChartError(null);
    try {
      const res = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setChartError(data.error || 'שגיאה בטעינת נתוני הגרף.');
      } else {
        setChartData(data);
      }
    } catch (e) {
      setChartError('שגיאת תקשורת בטעינת נתוני הגרף.');
    } finally {
      setChartLoading(false);
    }
  };

  const handleRangeSelect = (r: '1d' | '1w' | '1m' | '1y' | '5y') => {
    setChartRange(r);
    setChartHoverIndex(null);
    if (chartStock) {
      fetchChart(chartStock.symbol, r);
    }
  };

  // The top summary dashboard box converts to the user's selected currency (ILS / USD / EUR)
  const summaryRate = rates[currency] || 1;
  const summarySym = CURRENCY_SYMBOLS[currency] || '$';
  const summaryMoney = (usd: number) =>
    `${summarySym}${(usd * summaryRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signedSummaryMoney = (usd: number) =>
    `${usd >= 0 ? '+' : '-'}${summarySym}${Math.abs(usd * summaryRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Individual stock cards, charts, and stock details always stay in native USD ($)
  const rate = 1;
  const sym = '$';
  const money = (usd: number) =>
    `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signedMoney = (usd: number) =>
    `${usd >= 0 ? '+' : '-'}$${Math.abs(usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load from local storage and restore cloud session if logged in
  useEffect(() => {
    let parsedPortfolio: Stock[] = [];
    const saved = localStorage.getItem('stockPortfolio');
    if (saved) {
      try {
        parsedPortfolio = JSON.parse(saved);
        if (Array.isArray(parsedPortfolio)) {
          parsedPortfolio = parsedPortfolio.map(s => {
            if (!s.buyDate) {
              return { ...s, buyDate: '2026-11-05T10:00:00.000Z' };
            }
            return s;
          });
          localStorage.setItem('stockPortfolio', JSON.stringify(parsedPortfolio));
        }
        setPortfolio(parsedPortfolio);
      } catch (e) {}
    }
    const savedCurrency = localStorage.getItem('currency') as Currency | null;
    if (savedCurrency && ['ILS', 'USD', 'EUR'].includes(savedCurrency)) {
      setCurrency(savedCurrency);
    }
    let parsedAnalyses: Record<string, any> = {};
    const savedAnalyses = localStorage.getItem('stockAnalyses');
    if (savedAnalyses) {
      try {
        parsedAnalyses = JSON.parse(savedAnalyses);
        setAnalysisResults(parsedAnalyses);
      } catch (e) {
        console.error("Failed to load saved analyses from localStorage:", e);
      }
    }
    let parsedW: any[] = [];
    const savedWatchlist = localStorage.getItem('stockWatchlist');
    if (savedWatchlist) {
      try {
        const p = JSON.parse(savedWatchlist);
        if (Array.isArray(p)) {
          parsedW = p;
          setWatchlist(p);
        }
      } catch (e) {}
    }
    let localDeleted: Record<string, number> = {};
    const savedDeleted = localStorage.getItem('stockWatchlistDeleted');
    if (savedDeleted) {
      try {
        localDeleted = JSON.parse(savedDeleted) || {};
      } catch (e) {}
    }
    const localWatchlistUpdatedAt = parseInt(localStorage.getItem('stockWatchlistUpdatedAt') || '0', 10);

    // Check if user is logged in to a cloud account
    const savedAuth = localStorage.getItem('nexusUserAccount');
    if (savedAuth) {
      try {
        const parsedAuth = JSON.parse(savedAuth);
        if (parsedAuth?.username && parsedAuth?.password) {
          setAccountUser(parsedAuth);
          // Fetch latest portfolio from cloud on startup
          fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'restore',
              username: parsedAuth.username,
              password: parsedAuth.password,
              portfolio: parsedPortfolio,
              analyses: parsedAnalyses,
              watchlist: parsedW,
              watchlistDeleted: localDeleted,
              watchlistUpdatedAt: localWatchlistUpdatedAt,
            }),
          })
            .then(r => r.json())
            .then(data => {
              if (data?.success) {
                if (Array.isArray(data.portfolio)) {
                  const withBuyDates = data.portfolio.map((s: any) => {
                    if (!s.buyDate) {
                      return { ...s, buyDate: '2026-11-05T10:00:00.000Z' };
                    }
                    return s;
                  });
                  setPortfolio(withBuyDates);
                  localStorage.setItem('stockPortfolio', JSON.stringify(withBuyDates));
                }
                if (data.analyses && typeof data.analyses === 'object') {
                  setAnalysisResults(prev => {
                    const merged = { ...prev, ...data.analyses };
                    localStorage.setItem('stockAnalyses', JSON.stringify(merged));
                    return merged;
                  });
                }
                if (data.currency && ['ILS', 'USD', 'EUR'].includes(data.currency)) {
                  setCurrency(data.currency as Currency);
                  localStorage.setItem('currency', data.currency);
                }
                if (Array.isArray(data.watchlist)) {
                  let currentLocal: any[] = [];
                  try {
                    const stored = localStorage.getItem('stockWatchlist');
                    if (stored) currentLocal = JSON.parse(stored);
                  } catch (e) {}
                  let currentLocalDeleted: Record<string, number> = {};
                  try {
                    const storedD = localStorage.getItem('stockWatchlistDeleted');
                    if (storedD) currentLocalDeleted = JSON.parse(storedD);
                  } catch (e) {}

                  const { mergedList, mergedDeleted } = mergeWatchlistData(
                    currentLocal,
                    data.watchlist,
                    currentLocalDeleted,
                    data.watchlistDeleted || {}
                  );

                  setWatchlist(mergedList);
                  localStorage.setItem('stockWatchlist', JSON.stringify(mergedList));
                  localStorage.setItem('stockWatchlistDeleted', JSON.stringify(mergedDeleted));
                  if (data.watchlistUpdatedAt) {
                    localStorage.setItem('stockWatchlistUpdatedAt', String(data.watchlistUpdatedAt));
                  }
                }
              }
            })
            .catch(err => console.error('Cloud initial fetch error:', err))
            .finally(() => {
              isInitialLoadRef.current = false;
            });
          return;
        }
      } catch (e) {}
    }
    isInitialLoadRef.current = false;

    // Listen for storage events from other tabs or page navigation
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'stockWatchlist' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) setWatchlist(parsed);
        } catch (err) {}
      }
    };
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Fetch exchange rates
  useEffect(() => {
    fetch('/api/rates')
      .then(res => res.json())
      .then(data => { if (data.rates) setRates(data.rates); })
      .catch(err => console.error('Failed to fetch rates:', err));
  }, []);

  // Save to local storage
  useEffect(() => {
    if (portfolio.length > 0) {
      localStorage.setItem('stockPortfolio', JSON.stringify(portfolio));
    }
  }, [portfolio]);

  // Automatically sync changes to cloud when logged in (debounced)
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!accountUser || isInitialLoadRef.current) return;

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(async () => {
      setIsSyncingCloud(true);
      try {
        const localWatchlistUpdatedAt = parseInt(localStorage.getItem('stockWatchlistUpdatedAt') || '0', 10) || Date.now();
        let currentWatchlist = watchlist;
        try {
          const s = localStorage.getItem('stockWatchlist');
          if (s) currentWatchlist = JSON.parse(s);
        } catch (e) {}
        let currentDeleted = {};
        try {
          const d = localStorage.getItem('stockWatchlistDeleted');
          if (d) currentDeleted = JSON.parse(d);
        } catch (e) {}

        await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sync',
            username: accountUser.username,
            password: accountUser.password,
            portfolio,
            watchlist: currentWatchlist,
            watchlistDeleted: currentDeleted,
            watchlistUpdatedAt: localWatchlistUpdatedAt,
            analyses: analysisResults,
            currency,
            allowEmptyPortfolio: portfolio.length === 0,
          }),
        });
      } catch (e) {
        console.error('Auto cloud sync failed:', e);
      } finally {
        setIsSyncingCloud(false);
      }
    }, 1000);

    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [portfolio, watchlist, analysisResults, currency, accountUser]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authModalMode) return;
    setAuthError(null);
    setAuthLoading(true);

    try {
      const localWatchlistUpdatedAt = parseInt(localStorage.getItem('stockWatchlistUpdatedAt') || '0', 10) || Date.now();
      let currentWatchlist = watchlist;
      try {
        const s = localStorage.getItem('stockWatchlist');
        if (s) currentWatchlist = JSON.parse(s);
      } catch (e) {}
      let currentDeleted = {};
      try {
        const d = localStorage.getItem('stockWatchlistDeleted');
        if (d) currentDeleted = JSON.parse(d);
      } catch (e) {}

      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: authModalMode,
          username: authUsernameInput.trim(),
          password: authPasswordInput,
          portfolio,
          watchlist: currentWatchlist,
          watchlistDeleted: currentDeleted,
          watchlistUpdatedAt: localWatchlistUpdatedAt,
          analyses: analysisResults,
          currency,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAuthError(data.error || 'אירעה שגיאה. נסה שוב.');
        return;
      }

      const creds = { username: data.username || authUsernameInput.trim(), password: authPasswordInput };
      setAccountUser(creds);
      localStorage.setItem('nexusUserAccount', JSON.stringify(creds));

      if (authModalMode === 'login') {
        isInitialLoadRef.current = true;
        if (Array.isArray(data.portfolio)) {
          setPortfolio(data.portfolio);
          localStorage.setItem('stockPortfolio', JSON.stringify(data.portfolio));
        }
        if (Array.isArray(data.watchlist)) {
          let currentLocal: any[] = [];
          try {
            const stored = localStorage.getItem('stockWatchlist');
            if (stored) currentLocal = JSON.parse(stored);
          } catch (e) {}
          let currentLocalDeleted: Record<string, number> = {};
          try {
            const storedD = localStorage.getItem('stockWatchlistDeleted');
            if (storedD) currentLocalDeleted = JSON.parse(storedD);
          } catch (e) {}

          const { mergedList, mergedDeleted } = mergeWatchlistData(
            currentLocal,
            data.watchlist,
            currentLocalDeleted,
            data.watchlistDeleted || {}
          );

          setWatchlist(mergedList);
          localStorage.setItem('stockWatchlist', JSON.stringify(mergedList));
          localStorage.setItem('stockWatchlistDeleted', JSON.stringify(mergedDeleted));
          if (data.watchlistUpdatedAt) {
            localStorage.setItem('stockWatchlistUpdatedAt', String(data.watchlistUpdatedAt));
          }
        }
        if (data.analyses && typeof data.analyses === 'object') {
          setAnalysisResults(data.analyses);
          localStorage.setItem('stockAnalyses', JSON.stringify(data.analyses));
        }
        if (data.currency && ['ILS', 'USD', 'EUR'].includes(data.currency)) {
          setCurrency(data.currency as Currency);
          localStorage.setItem('currency', data.currency);
        }
        setTimeout(() => {
          isInitialLoadRef.current = false;
        }, 500);
      }

      setAuthModalMode(null);
      setAuthUsernameInput('');
      setAuthPasswordInput('');
    } catch (err) {
      setAuthError('שגיאת תקשורת מול השרת. נסה שוב.');
    } finally {
      setAuthLoading(false);
    }
  };


  const handleLogout = () => {
    // Cancel any pending auto-sync
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    isInitialLoadRef.current = true;

    // Reset cloud user state and clear local storage
    setAccountUser(null);
    localStorage.removeItem('nexusUserAccount');
    localStorage.removeItem('stockPortfolio');
    localStorage.removeItem('stockAnalyses');

    // Reset state to empty clean slate
    setPortfolio([]);
    setAnalysisResults({});

    setTimeout(() => {
      isInitialLoadRef.current = false;
    }, 100);
  };

  // Fetch real-time prices for portfolio - optimized with silent polling, change-guarding, and background tab sleep
  const portfolioRef = useRef(portfolio);
  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);

  useEffect(() => {
    let isFetching = false;
    let isMounted = true;
    let intervalId: any = null;

    const fetchQuotes = async (isBackground = false) => {
      // Don't poll if page is hidden in background or already fetching
      if (typeof document !== 'undefined' && document.hidden && isBackground) return;
      if (isFetching) return;
      const currentPortfolio = portfolioRef.current;
      if (!currentPortfolio || currentPortfolio.length === 0) return;

      isFetching = true;
      if (!isBackground) setIsLoadingQuotes(true);
      try {
        const symbols = currentPortfolio.map(s => s.symbol).join(',');
        const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`);
        const data = await res.json();
        
        if (isMounted && data && data.quotes) {
          setPortfolio(prev => {
            let hasChanged = false;
            const updated = prev.map(stock => {
              const quote = data.quotes[stock.symbol];
              if (!quote) return stock;

              const newPrice = quote.regularMarketPrice !== undefined && quote.regularMarketPrice !== null
                ? quote.regularMarketPrice
                : stock.currentPrice;
              const newChange = quote.regularMarketChange !== undefined && quote.regularMarketChange !== null
                ? quote.regularMarketChange
                : stock.dailyChange;
              const newPercent = quote.regularMarketChangePercent !== undefined && quote.regularMarketChangePercent !== null
                ? quote.regularMarketChangePercent
                : stock.dailyPercentChange;
              const newEarnings = quote.nextEarnings !== undefined ? quote.nextEarnings : stock.nextEarnings;
              const newDividend = quote.dividend !== undefined ? quote.dividend : stock.dividend;

              if (
                newPrice !== stock.currentPrice ||
                newChange !== stock.dailyChange ||
                newPercent !== stock.dailyPercentChange ||
                newEarnings !== stock.nextEarnings ||
                newDividend !== stock.dividend
              ) {
                hasChanged = true;
                return {
                  ...stock,
                  currentPrice: newPrice,
                  dailyChange: newChange,
                  dailyPercentChange: newPercent,
                  nextEarnings: newEarnings,
                  dividend: newDividend,
                };
              }
              return stock;
            });
            // Only trigger state update and subsequent syncs if quote values actually changed
            return hasChanged ? updated : prev;
          });
        }
      } catch (err) {
        console.error("Failed to fetch quotes:", err);
      } finally {
        isFetching = false;
        if (isMounted && !isBackground) setIsLoadingQuotes(false);
      }
    };

    fetchQuotes(false);

    // Only run periodic background polling when page is visible
    intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        fetchQuotes(true);
      }
    }, 60000);

    // Refresh instantly when user returns to the tab after being away
    let lastResumeFetch = Date.now();
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        // If more than 30s passed since last fetch or return, refresh once cleanly
        const now = Date.now();
        if (now - lastResumeFetch > 30000) {
          lastResumeFetch = now;
          fetchQuotes(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [portfolio.length]); // Re-run when stocks are added/removed

  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setIsSearchFocused(false);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (searchInputRef.current) {
      searchInputRef.current.blur();
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    setIsSearchFocused(true);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (query.trim() === '') {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    // Fast 200ms debounce without pre-timeout state re-renders
    searchDebounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setSearchResults(data.quotes || []);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    }, 200);
  };

  const handleSelectStock = async (stock: any) => {
    setSelectedStock(stock);
    setSearchQuery('');
    setSearchResults([]);
    setInvestedInput('');
    setBuyPriceInput('');
    setSelectedStockPrice(null);
    setIsFetchingStockPrice(true);
    
    try {
      const res = await fetch(`/api/quotes?symbols=${stock.symbol}`);
      const data = await res.json();
      if (data.quotes && data.quotes[stock.symbol]) {
        const price = data.quotes[stock.symbol].regularMarketPrice;
        if (price) {
          setSelectedStockPrice(price);
          setBuyPriceInput(price.toFixed(2));
        }
      }
    } catch (err) {
      console.error("Failed to fetch current price for selected stock:", err);
    } finally {
      setIsFetchingStockPrice(false);
    }
  };

  const handleAddStock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStock || !investedInput || !buyPriceInput) return;

    const newStock: Stock = {
      symbol: selectedStock.symbol,
      name: selectedStock.shortname || selectedStock.longname || selectedStock.symbol,
      buyPrice: parseFloat(buyPriceInput) / rate,
      investedAmount: parseFloat(investedInput) / rate,
      buyDate: new Date().toISOString(),
    };

    setPortfolio(prev => [...prev, newStock]);
    setSelectedStock(null);
  };

  const handleRemoveStock = (symbol: string) => {
    const newPortfolio = portfolio.filter(s => s.symbol !== symbol);
    setPortfolio(newPortfolio);
    if (newPortfolio.length === 0) {
      localStorage.removeItem('stockPortfolio');
    }
    setStockToDelete(null);
  };

  const openAddFunds = (stock: Stock) => {
    setStockToAddFunds(stock.symbol);
    setAddFundsInput('');
    const defaultPrice = stock.currentPrice || stock.buyPrice || 0;
    setAddFundsPriceInput(defaultPrice > 0 ? defaultPrice.toFixed(2) : '');
  };

  const handleAddFundsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockToAddFunds || !addFundsInput) return;
    
    const amountToAdd = parseFloat(addFundsInput) / rate;
    const pricePerShare = parseFloat(addFundsPriceInput);
    if (isNaN(amountToAdd) || amountToAdd <= 0 || isNaN(pricePerShare) || pricePerShare <= 0) return;

    setPortfolio(prev => prev.map(stock => {
      if (stock.symbol === stockToAddFunds) {
        const oldShares = stock.investedAmount / stock.buyPrice;
        const newShares = amountToAdd / pricePerShare;
        const totalShares = oldShares + newShares;
        const newInvested = stock.investedAmount + amountToAdd;
        const newBuyPrice = totalShares > 0 ? newInvested / totalShares : stock.buyPrice;

        return {
          ...stock,
          investedAmount: newInvested,
          buyPrice: newBuyPrice,
          buyDate: stock.buyDate || new Date().toISOString(),
        };
      }
      return stock;
    }));
    
    setStockToAddFunds(null);
    setAddFundsInput('');
    setAddFundsPriceInput('');
  };

  // Calculations (in USD) - memoized so non-portfolio renders are instantaneous
  const {
    totalInvested,
    totalCurrentValue,
    totalProfitLoss,
    totalProfitLossPercent,
    isTotalProfit,
    totalTodayChangeUSD,
    totalTodayPercentChange,
    isTodayProfit
  } = useMemo(() => {
    const invested = portfolio.reduce((sum, stock) => sum + stock.investedAmount, 0);
    const currentValue = portfolio.reduce((sum, stock) => {
      if (!stock.currentPrice) return sum + stock.investedAmount;
      const shares = stock.investedAmount / stock.buyPrice;
      return sum + (shares * stock.currentPrice);
    }, 0);

    const profitLoss = currentValue - invested;
    const profitLossPercent = invested > 0 ? (profitLoss / invested) * 100 : 0;
    const isProfit = profitLoss >= 0;

    const todayChangeUSD = portfolio.reduce((sum, stock) => {
      if (stock.dailyChange === undefined) return sum;
      const shares = stock.investedAmount / stock.buyPrice;
      return sum + (shares * stock.dailyChange);
    }, 0);

    const prevCloseVal = currentValue - todayChangeUSD;
    const todayPct = prevCloseVal > 0
      ? (todayChangeUSD / prevCloseVal) * 100
      : (currentValue > 0 ? (todayChangeUSD / currentValue) * 100 : 0);

    return {
      totalInvested: invested,
      totalCurrentValue: currentValue,
      totalProfitLoss: profitLoss,
      totalProfitLossPercent: profitLossPercent,
      isTotalProfit: isProfit,
      totalTodayChangeUSD: todayChangeUSD,
      totalTodayPercentChange: todayPct,
      isTodayProfit: todayChangeUSD >= 0,
    };
  }, [portfolio]);

  // 25% capital gains tax applies only to profits (a loss is not taxed)
  const TAX_RATE = 0.25;
  const afterTax = (profit: number) => (profit > 0 ? profit * (1 - TAX_RATE) : profit);

  // Projected Target Calculations based on pinned / analyst targets and annual dividends (in USD)
  const portfolioProjectedStats = useMemo(() => {
    let projectedTotalValue = 0;
    let projectedNetProfit = 0;
    let projectedTotalDividends = 0;
    let pinnedStocksCount = 0;

    portfolio.forEach(stock => {
      const targetPrice = stock.targetPrice || analysisResults[stock.symbol]?.averagePriceTarget;
      const shares = stock.investedAmount / stock.buyPrice;
      const curPrice = stock.currentPrice || stock.buyPrice;

      // Annual dividend calculation (after 25% dividend withholding tax)
      let annualDivPerShare = stock.dividend?.annualPerShare;
      if (!annualDivPerShare && stock.dividend?.yieldPercent && curPrice > 0) {
        annualDivPerShare = (curPrice * stock.dividend.yieldPercent) / 100;
      }
      const grossDividend = (annualDivPerShare && annualDivPerShare > 0) ? shares * annualDivPerShare : 0;
      const netDividend = afterTax(grossDividend); // Israeli standard dividend tax is 25%
      projectedTotalDividends += netDividend;

      if (targetPrice && targetPrice > 0) {
        pinnedStocksCount++;
        const targetVal = shares * targetPrice;
        const grossCapitalProfit = targetVal - stock.investedAmount;
        const netCapitalProfit = afterTax(grossCapitalProfit);
        projectedTotalValue += targetVal;
        // Total net profit = net capital gains + net dividend
        projectedNetProfit += (netCapitalProfit + netDividend);
      } else {
        // If no target set yet, assume current market value and current net profit
        const curVal = shares * curPrice;
        const curProfit = curVal - stock.investedAmount;
        projectedTotalValue += curVal;
        projectedNetProfit += (afterTax(curProfit) + netDividend);
      }
    });

    const projectedGrossProfit = projectedTotalValue - totalInvested;
    const projectedGrossPercent = totalInvested > 0 ? (projectedGrossProfit / totalInvested) * 100 : 0;

    return {
      projectedTotalValue,
      projectedNetProfit,
      projectedTotalDividends,
      projectedGrossProfit,
      projectedGrossPercent,
      pinnedStocksCount,
    };
  }, [portfolio, analysisResults, totalInvested]);


  return (
    <div className="container">
      <header className="header" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          {/* Hamburger 3-lines button (סרגל כלים בצד ימין למעלה) */}
          <button
            type="button"
            onClick={() => setToolsDrawerOpen(true)}
            title="סרגל כלים ופעולות AI"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <Menu size={22} />
          </button>

          <img
            src="/icon-192.png"
            alt="top stock"
            style={{ width: '40px', height: '40px', borderRadius: '12px', objectFit: 'cover', boxShadow: '0 4px 18px rgba(59, 130, 246, 0.4)' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1 className="header-title" style={{ margin: 0, fontSize: '1.75rem' }}>top stock</h1>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.15rem 0.55rem', borderRadius: '9999px', background: 'rgba(0, 230, 118, 0.1)', border: '1px solid rgba(0, 230, 118, 0.3)' }}>
                <span className="pulse-dot" />
                <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#00e676', letterSpacing: '0.06em' }}>LIVE</span>
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
            background: 'rgba(255, 255, 255, 0.05)',
            padding: '0.3rem',
            borderRadius: '9999px',
            border: '1px solid var(--border-color)',
            direction: 'ltr',
          }}
        >
          <div
            style={{
              padding: '0.45rem 1rem',
              borderRadius: '9999px',
              fontSize: '0.85rem',
              fontWeight: 700,
              background: 'var(--accent-color)',
              color: '#ffffff',
              boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)',
            }}
          >
            💼 התיק שלי ({portfolio.length})
          </div>
          <Link
            href="/watchlist"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.45rem 1rem',
              borderRadius: '9999px',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: watchlist.length > 0 ? '#fbbf24' : 'var(--text-muted)',
              background: watchlist.length > 0 ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
              textDecoration: 'none',
              transition: 'all 0.2s',
            }}
          >
            <Bookmark size={14} fill={watchlist.length > 0 ? '#fbbf24' : 'none'} />
            <span>רשימת מעקב ({watchlist.length})</span>
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          {/* Cloud Account Login / Register Controls */}
          {accountUser ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.45rem 0.85rem',
                borderRadius: '9999px',
                background: 'rgba(59, 130, 246, 0.14)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: 'var(--text-main)',
              }}
              title="החשבון שלך מסונכרן אוטומטית לענן"
            >
              <CheckCircle2 size={15} color="var(--profit-color)" />
              <span>מחובר: <b>{accountUser.username}</b></span>
              {isSyncingCloud && (
                <RefreshCw size={13} className="animate-spin" style={{ color: 'var(--accent-color)' }} />
              )}
              <button
                type="button"
                onClick={handleLogout}
                title="התנתק מהחשבון במכשיר זה"
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: '#f87171',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '0.2rem 0.5rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  transition: 'all 0.15s ease',
                }}
              >
                <LogOut size={13} />
                <span>התנתקות</span>
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  setAuthModalMode('register');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.5rem 0.9rem',
                  borderRadius: '9999px',
                  background: 'rgba(139, 92, 246, 0.16)',
                  border: '1px solid rgba(139, 92, 246, 0.45)',
                  color: '#c4b5fd',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <KeyRound size={15} />
                <span>קבע קוד משתמש וסיסמה</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  setAuthModalMode('login');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.5rem 0.9rem',
                  borderRadius: '9999px',
                  background: 'rgba(59, 130, 246, 0.16)',
                  border: '1px solid rgba(59, 130, 246, 0.45)',
                  color: '#93c5fd',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <LogIn size={15} />
                <span>התחברות</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => handleFindTopForecast(false)}
            title="Gemini יחפש ב-TipRanks וב-StockAnalysis את המניה עם תחזית העלייה הגבוהה ביותר"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.52rem 0.95rem',
              borderRadius: '9999px',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(245, 158, 11, 0.22))',
              border: '1px solid rgba(16, 185, 129, 0.5)',
              color: '#34d399',
              fontSize: '0.84rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.18)',
              transition: 'all 0.2s',
            }}
          >
            <Sparkles size={16} color="#fbbf24" />
            <span>המניה עם התחזית הכי גבוהה</span>
          </button>

          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setSettingsOpen(o => !o)}
              title="הגדרות"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              cursor: 'pointer',
            }}
          >
            <Settings size={22} />
          </button>
          {settingsOpen && (
            <div
              className="animate-fade-in"
              style={{
                position: 'absolute',
                top: '54px',
                right: 0,
                minWidth: '180px',
                background: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
                borderRadius: '1rem',
                padding: '0.75rem',
                boxShadow: '0 15px 35px rgba(0,0,0,0.5)',
                zIndex: 60,
              }}
            >
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0.5rem 0.5rem', textAlign: 'right' }}>מטבע</div>
              {(Object.keys(CURRENCY_LABELS) as Currency[]).map(c => (
                <button
                  key={c}
                  onClick={() => {
                    setCurrency(c);
                    localStorage.setItem('currency', c);
                    setSettingsOpen(false);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'right',
                    padding: '0.6rem 0.75rem',
                    borderRadius: '0.6rem',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    color: currency === c ? 'white' : 'var(--text-main)',
                    background: currency === c ? 'var(--accent-color)' : 'transparent',
                  }}
                >
                  {CURRENCY_LABELS[c]}
                </button>
              ))}
            </div>
          )}
        </div>
        </div>
      </header>

      {/* Search Bar */}
      <div className="search-container">
        <div className="search-input-wrapper">
          <Search className="search-icon" size={20} />
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder="חפש מניה להוספה (למשל: AAPL, TSLA)..."
            value={searchQuery}
            onChange={handleSearch}
            onFocus={() => setIsSearchFocused(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleClearSearch();
            }}
            style={{ paddingRight: (searchQuery || isSearchFocused || searchResults.length > 0) ? '3rem' : '1rem' }}
          />
          {/* Always show X button when user opened/focused or typed in the search bar */}
          {(searchQuery || isSearchFocused || searchResults.length > 0 || isSearching) && (
            <button
              type="button"
              onClick={handleClearSearch}
              title="סגור ונקה חיפוש (Esc)"
              style={{
                position: 'absolute',
                right: '0.85rem',
                background: 'rgba(255, 255, 255, 0.12)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-main)',
                cursor: 'pointer',
                transition: 'all 0.18s ease',
                zIndex: 10,
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        
        {/* Search Results Dropdown */}
        {(searchResults.length > 0 || isSearching) && (
          <div className="search-results animate-fade-in">
            {/* Top Bar with results info and Close Button */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.65rem 1rem',
                borderBottom: '1px solid var(--border-color)',
                background: 'rgba(0, 0, 0, 0.25)',
              }}
            >
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {isSearching ? 'מחפש מניות…' : `נמצאו ${searchResults.length} תוצאות:`}
              </span>
              <button
                type="button"
                onClick={handleClearSearch}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-muted)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '0.25rem 0.55rem',
                }}
                title="סגור חיפוש"
              >
                <span>סגור</span>
                <X size={13} />
              </button>
            </div>
            {isSearching ? (
              <div style={{ padding: '1rem', textAlign: 'center' }}>
                <div className="loader"></div>
              </div>
            ) : (
              searchResults.map((result, i) => (
                <div 
                  key={i} 
                  className="search-result-item"
                  onClick={() => handleSelectStock(result)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, minWidth: 0 }}>
                    <span className="search-result-symbol">{result.symbol}</span>
                    <span className="search-result-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {result.shortname || result.longname}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexShrink: 0 }}>
                    {/* Watchlist toggle button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlistStock(result);
                      }}
                      title={watchlist.some(w => w.symbol === result.symbol) ? "הסר מרשימת מעקב" : "הוסף לרשימת מעקב"}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.4rem 0.75rem',
                        borderRadius: '8px',
                        border: watchlist.some(w => w.symbol === result.symbol) ? '1px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(255, 255, 255, 0.15)',
                        background: watchlist.some(w => w.symbol === result.symbol) ? 'rgba(245, 158, 11, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                        color: watchlist.some(w => w.symbol === result.symbol) ? '#fbbf24' : 'var(--text-muted)',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                    >
                      <Bookmark size={14} fill={watchlist.some(w => w.symbol === result.symbol) ? "#fbbf24" : "none"} />
                      <span>{watchlist.some(w => w.symbol === result.symbol) ? 'במעקב' : 'הוסף למעקב'}</span>
                    </button>

                    {/* Analysis button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openAnalysis({ symbol: result.symbol });
                      }}
                      title={`ניתוח אנליסטים עבור ${result.symbol}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.4rem 0.8rem',
                        borderRadius: '8px',
                        border: hasAnalysisForSymbol(result.symbol) ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(59, 130, 246, 0.4)',
                        background: hasAnalysisForSymbol(result.symbol) ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                        color: hasAnalysisForSymbol(result.symbol) ? 'var(--profit-color)' : 'var(--accent-color)',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Sparkles size={14} />
                      <span>{hasAnalysisForSymbol(result.symbol) ? 'צפה בניתוח' : 'ניתוח'}</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Summary Dashboard */}
      {portfolio.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.75rem' }}>
          <div
            className="portfolio-summary animate-fade-in"
            style={{
              marginBottom: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
              alignItems: 'stretch',
              background: 'linear-gradient(135deg, rgba(16, 22, 38, 0.85) 0%, rgba(10, 14, 26, 0.95) 100%)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: '1.5rem',
              padding: '2rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6), inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
            }}
          >
            {/* Top Row: Balance Header & Today's Performance */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    שווי תיק נוכחי
                  </span>
                  <span style={{ fontSize: '0.74rem', padding: '0.15rem 0.5rem', borderRadius: '6px', background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', border: '1px solid rgba(59, 130, 246, 0.3)', fontWeight: 700 }}>
                    {currency} ({summarySym})
                  </span>
                </div>
                <h2 style={{ fontSize: '2.9rem', fontWeight: 800, margin: 0, color: '#ffffff', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
                  {summaryMoney(totalCurrentValue)}
                </h2>
              </div>

              {/* Today's Change Badge */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>שינוי יומי בתיק</div>
                <div
                  className={`profit-loss-val ${isTodayProfit ? 'text-profit' : 'text-loss'}`}
                  style={{
                    fontSize: '1.2rem',
                    fontWeight: 800,
                    padding: '0.35rem 0.85rem',
                    borderRadius: '10px',
                    background: isTodayProfit ? 'rgba(0, 230, 118, 0.12)' : 'rgba(255, 56, 92, 0.12)',
                    border: isTodayProfit ? '1px solid rgba(0, 230, 118, 0.35)' : '1px solid rgba(255, 56, 92, 0.35)',
                    boxShadow: isTodayProfit ? '0 0 15px rgba(0, 230, 118, 0.15)' : '0 0 15px rgba(255, 56, 92, 0.15)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                  title="שינוי יומי בתיק לפי שער המטבע הנבחר"
                >
                  {isTodayProfit ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                  <span dir="ltr">{signedSummaryMoney(totalTodayChangeUSD)}</span>
                  <span dir="ltr">({isTodayProfit ? '+' : ''}{totalTodayPercentChange.toFixed(2)}%)</span>
                </div>
              </div>
            </div>

            {/* Middle Row: Financial Metrics Mini-Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.85rem' }}>
              {/* Invested */}
              <div style={{ padding: '0.9rem 1.1rem', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  קרן מושקעת
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.2rem' }}>
                  {summaryMoney(totalInvested)}
                </div>
              </div>

              {/* Total P/L */}
              <div style={{ padding: '0.9rem 1.1rem', borderRadius: '12px', background: isTotalProfit ? 'rgba(0, 230, 118, 0.04)' : 'rgba(255, 56, 92, 0.04)', border: isTotalProfit ? '1px solid rgba(0, 230, 118, 0.18)' : '1px solid rgba(255, 56, 92, 0.18)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  רווח / הפסד כולל
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: isTotalProfit ? 'var(--profit-color)' : 'var(--loss-color)', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span dir="ltr">{signedSummaryMoney(totalProfitLoss)}</span>
                  <span dir="ltr" style={{ fontSize: '0.88rem', fontWeight: 700 }}>
                    ({isTotalProfit ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%)
                  </span>
                </div>
              </div>

              {/* Net After Tax */}
              <div style={{ padding: '0.9rem 1.1rem', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  נטו אחרי מס 25%
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: totalProfitLoss >= 0 ? '#38bdf8' : 'var(--loss-color)', marginTop: '0.2rem' }}>
                  {signedSummaryMoney(afterTax(totalProfitLoss))}
                </div>
              </div>
            </div>

            {/* Bottom Row: AI One-Click Action Chips */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 700 }}>פעולות מהירות בתיק:</span>
              
              <button
                type="button"
                onClick={handleRunPortfolioDiagnosis}
                title="Gemini יסביר לך בלחיצה אחת מה גרם לשינוי בתיק היום"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.48rem 1.1rem',
                  borderRadius: '9999px',
                  background: isTodayProfit
                    ? 'linear-gradient(135deg, rgba(0, 230, 118, 0.18), rgba(59, 130, 246, 0.18))'
                    : 'linear-gradient(135deg, rgba(255, 56, 92, 0.18), rgba(245, 158, 11, 0.18))',
                  border: isTodayProfit
                    ? '1px solid rgba(0, 230, 118, 0.45)'
                    : '1px solid rgba(255, 56, 92, 0.45)',
                  color: isTodayProfit ? '#00e676' : '#ff385c',
                  fontSize: '0.86rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isTodayProfit ? '0 4px 15px rgba(0, 230, 118, 0.15)' : '0 4px 15px rgba(255, 56, 92, 0.15)',
                }}
              >
                <Sparkles size={15} />
                <span>{isTodayProfit ? 'למה התיק שלי עלה היום? 🔍' : 'למה התיק שלי ירד היום? 🔍'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setRebalanceModalOpen(true);
                  setRebalanceError(null);
                }}
                title="רוצה להפקיד סכום חדש? Gemini יחלק אותו בצורה האופטימלית לתיק"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.48rem 1.1rem',
                  borderRadius: '9999px',
                  background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(59, 130, 246, 0.2))',
                  border: '1px solid rgba(139, 92, 246, 0.45)',
                  color: '#c4b5fd',
                  fontSize: '0.86rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: '0 4px 15px rgba(139, 92, 246, 0.15)',
                }}
              >
                <Scale size={15} />
                <span>איזון מחדש חכם (הפקדה) ⚖️</span>
              </button>
            </div>
          </div>

          {/* Aggregated Projected Target Summary Card */}
          {portfolioProjectedStats.pinnedStocksCount > 0 && (
            <div
              className="animate-fade-in"
              style={{
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(59, 130, 246, 0.12))',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                borderRadius: '1.25rem',
                padding: '1.1rem 1.4rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    background: 'rgba(16, 185, 129, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--profit-color)',
                  }}
                >
                  <Target size={22} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                      שקלול תחזיות האנליסטים לתיק
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '9999px',
                        background: 'rgba(16, 185, 129, 0.2)',
                        color: 'var(--profit-color)',
                        fontWeight: 600,
                      }}
                    >
                      {portfolioProjectedStats.pinnedStocksCount} מניות עם יעד
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                    שווי תיק חזוי ביעד: <b style={{ color: 'var(--text-main)' }}>{summaryMoney(portfolioProjectedStats.projectedTotalValue)}</b>
                    {' '}({portfolioProjectedStats.projectedGrossPercent >= 0 ? '+' : ''}{portfolioProjectedStats.projectedGrossPercent.toFixed(1)}%)
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  רווח נקי משוער (כולל דיבידנד ולאחר 25% מס):
                </div>
                <div
                  style={{
                    fontSize: '1.45rem',
                    fontWeight: 800,
                    color: portfolioProjectedStats.projectedNetProfit >= 0 ? 'var(--profit-color)' : 'var(--loss-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '0.35rem',
                    marginTop: '0.15rem',
                  }}
                >
                  <span>{signedSummaryMoney(portfolioProjectedStats.projectedNetProfit)}</span>
                </div>
                {portfolioProjectedStats.projectedTotalDividends > 0 && (
                  <div style={{ fontSize: '0.75rem', color: '#60a5fa', marginTop: '0.2rem' }}>
                    מתוכם דיבידנד נטו: +{summaryMoney(portfolioProjectedStats.projectedTotalDividends)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}


      {/* Stocks Grid */}
      {portfolio.length > 0 ? (
        <div className="stocks-grid">
          {portfolio.map((stock, idx) => {
            const currentPrice = stock.currentPrice || stock.buyPrice;
            const shares = stock.investedAmount / stock.buyPrice;
            const currentValue = shares * currentPrice;
            const pl = currentValue - stock.investedAmount;
            const plPercent = (pl / stock.investedAmount) * 100;
            const isProfit = pl >= 0;

            return (
              <div 
                key={`${stock.symbol}-${idx}`} 
                className={`stock-card animate-fade-in ${isProfit ? 'profit' : 'loss'}`}
                style={{ animationDelay: `${idx * 0.1}s` }}
              >
                <div className="stock-header">
                  <div>
                    <div className="stock-symbol">{stock.symbol}</div>
                    <div className="stock-name">{stock.name}</div>
                    {(() => {
                      const earnings = formatEarningsCountdown(stock.nextEarnings);
                      if (!earnings) return null;
                      const isRed = earnings.isRed;
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEarningsSummary(stock);
                          }}
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '0.25rem 0.65rem',
                            borderRadius: '7px',
                            background: isRed
                              ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(220, 38, 38, 0.15))'
                              : 'rgba(59, 130, 246, 0.12)',
                            border: isRed
                              ? '1px solid rgba(239, 68, 68, 0.55)'
                              : '1px solid rgba(59, 130, 246, 0.25)',
                            color: isRed ? '#fca5a5' : 'var(--accent-color)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            marginTop: '0.35rem',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: isRed ? '0 0 12px rgba(239, 68, 68, 0.25)' : 'none',
                          }}
                          title={`לחץ לסיכום דוחות AI של Gemini ב-4, 10 או 20 שורות (תאריך דוח: ${earnings.date})`}
                        >
                          {isRed ? <Sparkles size={13} style={{ color: '#ef4444' }} /> : <Calendar size={13} />}
                          <span>{earnings.text}</span>
                          <span
                            style={{
                              fontWeight: 800,
                              fontSize: '0.74rem',
                              marginRight: '0.35rem',
                              padding: '0.12rem 0.5rem',
                              borderRadius: '4px',
                              background: isRed ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.22)',
                              border: isRed ? '1px solid rgba(239, 68, 68, 0.65)' : '1px solid rgba(59, 130, 246, 0.5)',
                              color: isRed ? '#ffffff' : '#60a5fa',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              boxShadow: isRed ? '0 0 10px rgba(239, 68, 68, 0.4)' : '0 0 8px rgba(59, 130, 246, 0.25)',
                              letterSpacing: '0.2px',
                            }}
                          >
                            <Sparkles size={11} style={{ color: isRed ? '#fca5a5' : '#93c5fd' }} />
                            <strong style={{ fontWeight: 800 }}>ניתוח AI</strong>
                          </span>
                        </button>
                      );
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      className="delete-btn" 
                      onClick={() => openAddFunds(stock)}
                      title="Add funds"
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.5rem', 
                        background: 'var(--profit-bg)', 
                        color: 'var(--profit-color)', 
                        border: '1px solid rgba(16, 185, 129, 0.2)', 
                        padding: '0.4rem 0.75rem', 
                        borderRadius: '8px', 
                        fontSize: '0.85rem', 
                        fontWeight: 500 
                      }}
                    >
                      <Plus size={16} />
                      <span>הוסף כסף</span>
                    </button>
                    <button 
                      className="delete-btn" 
                      onClick={() => setStockToDelete(stock)}
                      title="מחק מניה מהתיק"
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.5rem', 
                        background: 'var(--loss-bg)', 
                        color: 'var(--loss-color)', 
                        border: '1px solid rgba(239, 68, 68, 0.2)', 
                        padding: '0.4rem 0.75rem', 
                        borderRadius: '8px', 
                        fontSize: '0.85rem', 
                        fontWeight: 500 
                      }}
                    >
                      <Trash2 size={16} />
                      <span>מחק מניה</span>
                    </button>
                  </div>
                </div>

                <div className="stock-price">
                  {stock.currentPrice === undefined ? (
                     <div className="loader" style={{ width: '16px', height: '16px', borderTopColor: 'var(--text-main)', margin: '0 0 0 auto' }}></div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <span>{money(stock.currentPrice)}</span>
                      {stock.dailyChange !== undefined && stock.dailyPercentChange !== undefined && (
                        <span className={`detail-value ${stock.dailyChange >= 0 ? 'text-profit' : 'text-loss'}`} style={{ fontSize: '0.9rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 500 }}>
                          {stock.dailyChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                          {signedMoney(stock.dailyChange)} ({stock.dailyChange >= 0 ? '+' : ''}{stock.dailyPercentChange.toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="stock-details">
                  <div className="detail-item">
                    <span className="detail-label">Invested</span>
                    <span className="detail-value">{money(stock.investedAmount)}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Buy Price</span>
                    <span className="detail-value">{money(stock.buyPrice)}</span>
                  </div>
                  <div className="detail-item profit-loss">
                    <span className="detail-label">Total P/L</span>
                    <span className={`detail-value ${isProfit ? 'text-profit' : 'text-loss'}`}>
                      {signedMoney(pl)} ({plPercent.toFixed(2)}%)
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      אחרי מס 25%: {signedMoney(afterTax(pl))}
                    </span>
                  </div>
                </div>

                {/* Pinned Analyst Forecast Badge */}
                {(() => {
                  const targetPrice = stock.targetPrice || analysisResults[stock.symbol]?.averagePriceTarget;
                  if (!targetPrice || targetPrice <= 0) return null;
                  
                  // If user pinned a forecast percentage, keep it static until user pins another forecast.
                  // Otherwise fall back to cached forecastPercent or calculated upside.
                  const cachedForecast = analysisResults[stock.symbol]?.forecastPercent;
                  const curPrice = stock.currentPrice || stock.buyPrice;
                  const forecastPercent = stock.targetForecastPercent !== undefined
                    ? stock.targetForecastPercent
                    : (cachedForecast !== undefined && cachedForecast !== null ? cachedForecast : ((targetPrice - curPrice) / curPrice) * 100);
                  
                  const isPositive = forecastPercent >= 0;

                  // Target financial calculations for this stock:
                  const shares = stock.investedAmount / stock.buyPrice;
                  const projectedTotalVal = shares * targetPrice;
                  const projectedGrossPl = projectedTotalVal - stock.investedAmount;
                  const projectedNetCapitalPl = afterTax(projectedGrossPl);

                  // Annual dividend (after 25% tax)
                  let annualDivPerShare = stock.dividend?.annualPerShare;
                  if (!annualDivPerShare && stock.dividend?.yieldPercent && curPrice > 0) {
                    annualDivPerShare = (curPrice * stock.dividend.yieldPercent) / 100;
                  }
                  const grossDividend = (annualDivPerShare && annualDivPerShare > 0) ? shares * annualDivPerShare : 0;
                  const netDividend = afterTax(grossDividend);
                  const totalProjectedNetPl = projectedNetCapitalPl + netDividend;

                  return (
                    <div
                      style={{
                        marginTop: '1rem',
                        padding: '0.75rem 0.9rem',
                        borderRadius: '0.85rem',
                        background: isPositive ? 'rgba(16, 185, 129, 0.09)' : 'rgba(239, 68, 68, 0.09)',
                        border: isPositive ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                        fontSize: '0.85rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                      }}
                      title={`תחזית אנליסטים מוצמדת: ${isPositive ? '+' : ''}${forecastPercent.toFixed(1)}% | מחיר יעד: ${money(targetPrice)}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                          <Target size={16} color={isPositive ? 'var(--profit-color)' : 'var(--loss-color)'} />
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span>תחזית אנליסטים:</span>
                              {stock.targetPrice && (
                                <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent-color)' }}>
                                  מוצמדת
                                </span>
                              )}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                              מחיר יעד: {money(targetPrice)}
                              {stock.targetRating ? ` · ${stock.targetRating}` : ''}
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            fontWeight: 800,
                            fontSize: '1.05rem',
                            color: isPositive ? 'var(--profit-color)' : 'var(--loss-color)',
                            direction: 'ltr',
                          }}
                        >
                          {isPositive ? '+' : ''}{forecastPercent.toFixed(1)}%
                        </div>
                      </div>

                      {/* Estimated Net Profit After 25% Tax (Capital Gains + Dividend) */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingTop: '0.45rem',
                          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                          fontSize: '0.8rem',
                        }}
                      >
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>
                            רווח נקי משוער ביעד (אחרי מס 25%):
                          </span>
                          {netDividend > 0 && (
                            <div style={{ fontSize: '0.72rem', color: '#60a5fa', marginTop: '0.1rem' }}>
                              כולל דיבידנד נטו: +{signedSummaryMoney(netDividend)} (תשואה: {stock.dividend?.yieldPercent ? stock.dividend.yieldPercent.toFixed(2) : ((grossDividend / stock.investedAmount) * 100).toFixed(2)}%)
                            </div>
                          )}
                        </div>
                        <span
                          style={{
                            fontWeight: 700,
                            color: totalProjectedNetPl >= 0 ? 'var(--profit-color)' : 'var(--loss-color)',
                            direction: 'ltr',
                            fontSize: '0.9rem',
                          }}
                        >
                          {signedSummaryMoney(totalProjectedNetPl)}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginTop: '1.25rem' }}>
                  <button
                    onClick={() => openChartModal(stock)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.45rem',
                      padding: '0.6rem 0.75rem',
                      borderRadius: '0.75rem',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      background: 'rgba(59, 130, 246, 0.12)',
                      color: 'var(--accent-color)',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    title="הצג גרף היסטוריית מחיר ונקודת קנייה"
                  >
                    <LineChart size={16} />
                    <span>גרף מחיר</span>
                  </button>

                  <button
                    onClick={() => openAnalysis(stock)}
                    disabled={stock.currentPrice === undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.45rem',
                      padding: '0.6rem 0.75rem',
                      borderRadius: '0.75rem',
                      border: hasAnalysisForSymbol(stock.symbol) ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(147, 51, 234, 0.4)',
                      background: hasAnalysisForSymbol(stock.symbol) ? 'rgba(16, 185, 129, 0.12)' : 'rgba(147, 51, 234, 0.12)',
                      color: hasAnalysisForSymbol(stock.symbol) ? 'var(--profit-color)' : '#c084fc',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      cursor: stock.currentPrice === undefined ? 'not-allowed' : 'pointer',
                      opacity: stock.currentPrice === undefined ? 0.5 : 1,
                    }}
                  >
                    <Sparkles size={16} />
                    <span>{hasAnalysisForSymbol(stock.symbol) ? 'ניתוח (שמור)' : 'ניתוח'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center" style={{ marginTop: '4rem', color: 'var(--text-muted)' }}>
          <Activity size={48} style={{ margin: '0 auto', opacity: 0.2 }} />
          <h2 style={{ marginTop: '1rem', fontWeight: 400 }}>Your watchlist is empty</h2>
          <p>Search for a stock above to get started</p>
        </div>
      )}

      {/* Add Stock Modal */}
      {selectedStock && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in">
            <h2 className="modal-title">Add {selectedStock.symbol}</h2>
            <p className="modal-subtitle">{selectedStock.shortname || selectedStock.longname}</p>
            
            <div style={{ textAlign: 'center', marginBottom: '1.5rem', fontSize: '1.25rem', fontWeight: 600 }}>
              {isFetchingStockPrice ? (
                <div className="loader" style={{ margin: '0 auto', width: '20px', height: '20px', borderTopColor: 'var(--text-main)' }}></div>
              ) : (
                selectedStockPrice ? `Current Price: ${money(selectedStockPrice)}` : 'Current Price: N/A'
              )}
            </div>
            
            <form onSubmit={handleAddStock}>
              <div className="form-group">
                <label className="form-label">Amount Invested ({sym})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  className="form-input"
                  placeholder="e.g. 1000"
                  value={investedInput}
                  onChange={e => setInvestedInput(e.target.value)}
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Buy Price ({sym})</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  className="form-input"
                  placeholder="e.g. 150.50"
                  value={buyPriceInput}
                  onChange={e => setBuyPriceInput(e.target.value)}
                />
              </div>
              
              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => setSelectedStock(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isFetchingStockPrice}>
                  Add to Watchlist
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Stock Confirmation Modal */}
      {stockToDelete && (
        <div className="modal-overlay" onClick={() => setStockToDelete(null)}>
          <div
            className="modal-content animate-fade-in"
            onClick={e => e.stopPropagation()}
            style={{ direction: 'rtl', textAlign: 'center', maxWidth: '420px', padding: '2rem 1.5rem' }}
          >
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                color: 'var(--loss-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.25rem',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              <Trash2 size={28} />
            </div>

            <h2 className="modal-title" style={{ fontSize: '1.25rem', marginBottom: '0.6rem', textAlign: 'center' }}>
              האם אתה בטוח שאתה רוצה למחוק מנייה זאת?
            </h2>
            <p className="modal-subtitle" style={{ fontSize: '0.95rem', marginBottom: '1.75rem', textAlign: 'center' }}>
              מניית <b style={{ color: 'var(--text-main)' }}>{stockToDelete.symbol}</b> {stockToDelete.name ? `(${stockToDelete.name})` : ''} תימחק מהתיק שלך לצמיתות.
            </p>

            <div className="modal-actions" style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStockToDelete(null)}
                style={{ flex: 1, padding: '0.75rem', fontWeight: 600 }}
              >
                לא, בטל
              </button>
              <button
                type="button"
                onClick={() => handleRemoveStock(stockToDelete.symbol)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: '10px',
                  background: 'var(--loss-color)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s',
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.35)',
                }}
              >
                כן
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Funds Modal */}
      {stockToAddFunds && (() => {
        const targetStock = portfolio.find(s => s.symbol === stockToAddFunds);
        const currentBuyPrice = targetStock?.buyPrice || 0;
        const currentInvested = targetStock?.investedAmount || 0;
        const currentShares = currentBuyPrice > 0 ? currentInvested / currentBuyPrice : 0;
        
        const addedAmount = parseFloat(addFundsInput) || 0;
        const enteredPrice = parseFloat(addFundsPriceInput) || 0;
        const newShares = (addedAmount > 0 && enteredPrice > 0) ? addedAmount / enteredPrice : 0;
        const totalShares = currentShares + newShares;
        const totalInvested = currentInvested + addedAmount;
        const projectedAvgPrice = totalShares > 0 ? totalInvested / totalShares : currentBuyPrice;

        return (
          <div className="modal-overlay" onClick={() => { setStockToAddFunds(null); setAddFundsInput(''); setAddFundsPriceInput(''); }}>
            <div className="modal-content animate-fade-in" onClick={e => e.stopPropagation()} style={{ direction: 'rtl' }}>
              <h2 className="modal-title" style={{ textAlign: 'right' }}>הוספת כסף למניית {stockToAddFunds}</h2>
              <p className="modal-subtitle" style={{ textAlign: 'right' }}>הזן את סכום ההוספה ואת שער הקנייה לצורך חישוב שער ממוצע משוקלל חדש</p>
              
              <form onSubmit={handleAddFundsSubmit}>
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>סכום להוספה ({sym})</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>השקעה קיימת: {money(currentInvested)}</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="form-input"
                    placeholder="למשל 500"
                    value={addFundsInput}
                    onChange={e => setAddFundsInput(e.target.value)}
                    style={{ direction: 'ltr', textAlign: 'left' }}
                  />
                </div>

                <div className="form-group" style={{ marginTop: '1rem' }}>
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>שער קנייה ליחידה ({sym})</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>שער ממוצע נוכחי: {money(currentBuyPrice)}</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="form-input"
                    placeholder="למשל 180.50"
                    value={addFundsPriceInput}
                    onChange={e => setAddFundsPriceInput(e.target.value)}
                    style={{ direction: 'ltr', textAlign: 'left' }}
                  />
                </div>

                {/* Real-time Weighted Average Preview */}
                {addedAmount > 0 && enteredPrice > 0 && (
                  <div
                    style={{
                      marginTop: '1.25rem',
                      padding: '0.85rem 1rem',
                      borderRadius: '0.85rem',
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(16, 185, 129, 0.12))',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      fontSize: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.45rem',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: 'var(--text-main)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>שער ממוצע חדש לאחר הקנייה:</span>
                      <span style={{ color: 'var(--accent-color)', fontSize: '1rem', direction: 'ltr' }}>
                        {money(projectedAvgPrice)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                      <span>סה״כ מניות: {totalShares.toFixed(3)} (נוספו {newShares.toFixed(3)})</span>
                      <span>סה״כ מושקע: {money(totalInvested)}</span>
                    </div>
                  </div>
                )}
                
                <div className="modal-actions" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary"
                    onClick={() => {
                      setStockToAddFunds(null);
                      setAddFundsInput('');
                      setAddFundsPriceInput('');
                    }}
                  >
                    ביטול
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                    אישור ועדכון שער ממוצע
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Analysis Modal */}
      {analysisSymbol && (
        <div className="modal-overlay" onClick={() => setAnalysisSymbol(null)}>
          <div
            className="modal-content animate-fade-in"
            style={{ maxHeight: '90vh', overflowY: 'auto', direction: 'rtl' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <h2 className="modal-title" style={{ margin: 0 }}>ניתוח אנליסטים – {analysisSymbol}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                  <span className="modal-subtitle" style={{ margin: 0 }}>
                    {analysisSymbol?.endsWith('.TA')
                      ? 'מקור ראשי: Google Finance • מוצלב עם Investing.com ישראל, בנקי השקעות ו-TipRanks'
                      : 'מקור ראשי: Google Finance • מוצלב עם TipRanks, Investing.com ו-StockAnalysis'}
                  </span>
                  {(() => {
                    const cacheKey = analysisDateFilter ? `${analysisSymbol}_${analysisDateFilter}` : analysisSymbol;
                    const a = analysisResults[cacheKey];
                    if (!a?.analyzedAt) return null;
                    return (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        • <Clock size={13} /> עודכן לאחרונה: {formatAnalyzedAt(a.analyzedAt)}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Refresh / Check Again Button */}
              <button
                type="button"
                onClick={() => {
                  if (analysisSymbol) {
                    const currentStock = portfolio.find(s => s.symbol === analysisSymbol);
                    runAnalysis({ symbol: analysisSymbol, currentPrice: currentStock?.currentPrice }, analysisDateFilter, true);
                  }
                }}
                disabled={analysisLoading[analysisSymbol]}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  padding: '0.5rem 0.95rem',
                  borderRadius: '8px',
                  border: '1px solid var(--accent-color)',
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: 'var(--accent-color)',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: analysisLoading[analysisSymbol] ? 'not-allowed' : 'pointer',
                  opacity: analysisLoading[analysisSymbol] ? 0.6 : 1,
                  transition: 'all 0.2s ease',
                }}
                title="בדוק שוב והבא נתונים עדכניים מ-TipRanks, Investing.com ו-StockAnalysis"
              >
                <RefreshCw size={15} className={analysisLoading[analysisSymbol] ? "animate-spin" : ""} />
                <span>{analysisLoading[analysisSymbol] ? 'בודק כעת…' : 'בדוק שוב'}</span>
              </button>
            </div>

            {/* Date filter control */}
            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '0.75rem',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  תחזיות רק החל מתאריך (אופציונלי):
                </span>
                {analysisDateFilter && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: 600 }}>
                    מסונן מ: <span style={{ direction: 'ltr', display: 'inline-block' }}>{analysisDateFilter}</span>
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="date"
                  value={analysisDateFilter}
                  onChange={(e) => setAnalysisDateFilter(e.target.value)}
                  className="form-input"
                  style={{
                    padding: '0.45rem 0.6rem',
                    fontSize: '0.9rem',
                    flex: 1,
                    direction: 'ltr',
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (analysisSymbol) {
                      const currentStock = portfolio.find(s => s.symbol === analysisSymbol);
                      const targetKey = analysisDateFilter ? `${analysisSymbol}_${analysisDateFilter}` : analysisSymbol;
                      if (!analysisResults[targetKey]) {
                        runAnalysis({ symbol: analysisSymbol, currentPrice: currentStock?.currentPrice }, analysisDateFilter, false);
                      }
                    }
                  }}
                  disabled={analysisLoading[analysisSymbol]}
                  style={{
                    padding: '0.45rem 0.9rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--accent-color)',
                    color: 'white',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: analysisLoading[analysisSymbol] ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {analysisResults[analysisDateFilter ? `${analysisSymbol}_${analysisDateFilter}` : analysisSymbol] ? 'הצג שמור' : 'סנן תאריך'}
                </button>
                {analysisDateFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setAnalysisDateFilter('');
                      if (analysisSymbol) {
                        const currentStock = portfolio.find(s => s.symbol === analysisSymbol);
                        if (!analysisResults[analysisSymbol]) {
                          runAnalysis({ symbol: analysisSymbol, currentPrice: currentStock?.currentPrice }, '', false);
                        }
                      }
                    }}
                    disabled={analysisLoading[analysisSymbol]}
                    style={{
                      padding: '0.45rem 0.7rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                    title="הצג את כל התחזיות"
                  >
                    הצג הכל
                  </button>
                )}
              </div>
            </div>

            {analysisLoading[analysisSymbol] && (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div className="loader" style={{ marginBottom: '1rem' }}></div>
                <div style={{ color: 'var(--text-muted)' }}>
                  {analysisDateFilter
                    ? `Gemini קורא את TipRanks ו-Investing.com ומסנן תחזיות מ-${analysisDateFilter}…`
                    : 'Gemini קורא את דפי התחזיות ב-TipRanks וב-Investing.com… זה לוקח כמה שניות'}
                </div>
              </div>
            )}

            {analysisErrors[analysisSymbol] && !analysisLoading[analysisSymbol] && (
              <div style={{ color: 'var(--loss-color)', padding: '1rem', background: 'var(--loss-bg)', borderRadius: '0.75rem' }}>
                {analysisErrors[analysisSymbol]}
              </div>
            )}

            {(() => {
              const cacheKey = analysisDateFilter ? `${analysisSymbol}_${analysisDateFilter}` : analysisSymbol;
              const a = analysisResults[cacheKey];
              if (!a) return null;
              const up = a.forecastPercent !== null && a.forecastPercent >= 0;
              return (
                <div>
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '1.25rem',
                      borderRadius: '1rem',
                      marginBottom: '1.25rem',
                      background: a.forecastPercent === null ? 'var(--bg-secondary)' : up ? 'var(--profit-bg)' : 'var(--loss-bg)',
                    }}
                  >
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      תחזית עלייה ל-12 החודשים הקרובים (מהמחיר הנוכחי)
                    </div>
                    <div
                      style={{
                        fontSize: '2.5rem',
                        fontWeight: 700,
                        direction: 'ltr',
                        color: a.forecastPercent === null ? 'var(--text-main)' : up ? 'var(--profit-color)' : 'var(--loss-color)',
                      }}
                    >
                      {a.forecastPercent === null ? 'N/A' : `${up ? '+' : ''}${a.forecastPercent.toFixed(1)}%`}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {a.averagePriceTarget !== null && (
                        <span>
                          יעד מחיר ממוצע: <b style={{ color: 'var(--text-main)' }}>{money(a.averagePriceTarget)}</b>
                        </span>
                      )}
                      {(() => {
                        const cur = portfolio.find(s => s.symbol === analysisSymbol)?.currentPrice;
                        if (!cur) return null;
                        return (
                          <span>
                            • מחיר נוכחי חי: <b style={{ color: 'var(--text-main)' }}>{money(cur)}</b>
                          </span>
                        );
                      })()}
                    </div>

                    {/* Add / Pin Target to Portfolio Button */}
                    {a.averagePriceTarget !== null && (
                      <div style={{ marginTop: '0.9rem', display: 'flex', justifyContent: 'center' }}>
                        {(() => {
                          const stockInPortfolio = portfolio.find(s => s.symbol === analysisSymbol);
                          if (!stockInPortfolio) {
                            return (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedStock({ symbol: analysisSymbol, shortname: analysisSymbol });
                                  setAnalysisSymbol(null);
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.45rem',
                                  padding: '0.45rem 1rem',
                                  borderRadius: '9999px',
                                  border: '1px solid var(--accent-color)',
                                  background: 'rgba(59, 130, 246, 0.15)',
                                  color: 'var(--accent-color)',
                                  fontSize: '0.85rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                <Plus size={15} />
                                <span>הוסף מניה זו לתיק</span>
                              </button>
                            );
                          }
                          const isPinned = stockInPortfolio.targetPrice === a.averagePriceTarget;
                          const todayStr = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
                          return (
                            <button
                              type="button"
                              onClick={() => handleTogglePinTarget(
                                analysisSymbol,
                                a.averagePriceTarget,
                                a.consensusRating,
                                a.forecastPercent !== null ? a.forecastPercent : undefined,
                                todayStr
                              )}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.45rem',
                                padding: '0.5rem 1.15rem',
                                borderRadius: '9999px',
                                border: isPinned ? '1px solid var(--profit-color)' : '1px solid var(--accent-color)',
                                background: isPinned ? 'rgba(16, 185, 129, 0.18)' : 'rgba(59, 130, 246, 0.18)',
                                color: isPinned ? 'var(--profit-color)' : 'var(--accent-color)',
                                fontSize: '0.9rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                boxShadow: isPinned ? '0 0 15px rgba(16, 185, 129, 0.25)' : 'none',
                                transition: 'all 0.2s ease',
                              }}
                            >
                              <Target size={16} />
                              <span>{isPinned ? '✓ תחזית מוצמדת לתיק (לחץ להסרה)' : '🎯 הצמד תחזית לתיק'}</span>
                            </button>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.5rem', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
                    {a.consensusRating && <div><span style={{ color: 'var(--text-muted)' }}>קונצנזוס: </span><b>{a.consensusRating}</b></div>}
                    {a.analystCount !== null && <div><span style={{ color: 'var(--text-muted)' }}>אנליסטים: </span><b>{a.analystCount}</b></div>}
                    {a.lowPriceTarget !== null && a.highPriceTarget !== null && (
                      <div><span style={{ color: 'var(--text-muted)' }}>טווח יעדים: </span><b>{money(a.lowPriceTarget)} – {money(a.highPriceTarget)}</b></div>
                    )}
                    {a.buyCount !== null && a.holdCount !== null && a.sellCount !== null && (
                      <div><span style={{ color: 'var(--text-muted)' }}>קנייה/החזקה/מכירה: </span><b>{a.buyCount}/{a.holdCount}/{a.sellCount}</b></div>
                    )}
                  </div>

                  {a.summary.length > 0 && (
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>מה האנליסטים אומרים</div>
                      {a.summary.map((line: string, i: number) => (
                        <p key={i} style={{ lineHeight: 1.6, marginBottom: '0.4rem' }}>{line}</p>
                      ))}
                    </div>
                  )}

                  {Array.isArray(a.uniqueAnalysts) && a.uniqueAnalysts.length > 0 && (
                    <div style={{ marginBottom: '1.25rem' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>אנליסטים שנסקרו ({a.uniqueAnalysts.length} ייחודיים):</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--profit-color)', fontWeight: 600 }}>✓ ללא כפילויות משני המקורות</span>
                      </div>
                      <div style={{ maxHeight: '260px', overflowY: 'auto', background: 'var(--bg-secondary)', borderRadius: '0.75rem', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {a.uniqueAnalysts.map((an: any, idx: number) => {
                          const rLower = (an.rating || '').toLowerCase();
                          const rColor = rLower.includes('buy') ? 'var(--profit-color)' : rLower.includes('sell') ? 'var(--loss-color)' : 'var(--text-main)';
                          return (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0', borderBottom: idx < a.uniqueAnalysts.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none', flexWrap: 'wrap', gap: '0.4rem' }}>
                              <div>
                                <span style={{ fontWeight: 600 }}>{an.name}</span>
                                {an.firm && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginRight: '0.4rem' }}>({an.firm})</span>}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ color: rColor, fontWeight: 700 }}>{an.rating}</span>
                                {an.priceTarget !== null && an.priceTarget !== undefined && (
                                  <span style={{ fontWeight: 600, direction: 'ltr' }}>{money(an.priceTarget)}</span>
                                )}
                                {an.date && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', direction: 'ltr' }}>{an.date}</span>}
                                {an.source && (
                                  <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.35rem', borderRadius: '4px', color: 'var(--text-muted)' }}>
                                    {an.source}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    <div>
                      מקורות הנתונים:{' '}
                      <a
                        href={a.sources?.find((s: any) => s.name?.includes('Google'))?.url || (analysisSymbol?.endsWith('.TA') ? `https://www.google.com/finance/quote/${analysisSymbol.replace(/\.TA$/i, '')}:TLV` : `https://www.google.com/finance/quote/${analysisSymbol}`)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: '#60a5fa', fontWeight: 700 }}
                      >
                        Google Finance (ראשי)
                      </a>
                      {' · '}
                      <a href={a.sources?.find((s: any) => s.name?.includes('Investing'))?.url || `https://il.investing.com/search/?q=${encodeURIComponent(analysisSymbol.replace(/\.TA$/i, ''))}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-color)' }}>
                        {analysisSymbol?.endsWith('.TA') ? 'Investing.com ישראל' : 'Investing.com'}
                      </a>
                      {' · '}
                      <a href={`https://www.tipranks.com/stocks/${analysisSymbol.replace(/\.TA$/i, '').toLowerCase()}/forecast`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-color)' }}>
                        TipRanks
                      </a>
                      {' · '}
                      <a href={`https://stockanalysis.com/stocks/${analysisSymbol.replace(/\.TA$/i, '').toLowerCase()}/ratings/`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-color)' }}>
                        StockAnalysis.com
                      </a>
                    </div>
                    <div style={{ color: 'var(--profit-color)', fontWeight: 500 }}>
                      ✓ אנליסט שמופיע ביותר ממקור אחד נספר פעם אחת בלבד (ללא כפילויות).
                    </div>
                    {a.fromDate && (
                      <div style={{ color: 'var(--accent-color)', fontWeight: 600 }}>
                        מסונן: מוצגות רק תחזיות שפורסמו החל מ-{a.fromDate} ואילך
                      </div>
                    )}
                    <div>התחזית היא ממוצע יעדי המחיר של האנליסטים מול המחיר הנוכחי, ואינה ייעוץ השקעות.</div>
                  </div>
                </div>
              );
            })()}

            <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
              <button
                type="button"
                onClick={() => {
                  if (analysisSymbol) {
                    const currentStock = portfolio.find(s => s.symbol === analysisSymbol);
                    runAnalysis({ symbol: analysisSymbol, currentPrice: currentStock?.currentPrice }, analysisDateFilter, true);
                  }
                }}
                disabled={analysisLoading[analysisSymbol]}
                className="btn btn-secondary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  color: 'var(--accent-color)',
                  borderColor: 'rgba(59, 130, 246, 0.4)',
                }}
              >
                <RefreshCw size={15} className={analysisLoading[analysisSymbol] ? "animate-spin" : ""} />
                <span>{analysisLoading[analysisSymbol] ? 'בודק כעת…' : 'בדוק שוב'}</span>
              </button>

              <button type="button" className="btn btn-primary" onClick={() => setAnalysisSymbol(null)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gemini AI Earnings Summary Modal (4, 10, or 20 lines) */}
      {earningsModalStock && (
        <div className="modal-overlay" onClick={() => setEarningsModalStock(null)}>
          <div
            className="modal-content animate-fade-in"
            style={{
              maxHeight: '90vh',
              overflowY: 'auto',
              direction: 'rtl',
              maxWidth: '750px',
              width: '95%',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              boxShadow: '0 20px 45px rgba(0, 0, 0, 0.5), 0 0 30px rgba(239, 68, 68, 0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div
                    style={{
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: '8px',
                      padding: '0.4rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ef4444',
                    }}
                  >
                    <Sparkles size={20} />
                  </div>
                  <h2 className="modal-title" style={{ margin: 0, fontSize: '1.4rem' }}>
                    סיכום דוחות כספיים AI של Gemini
                  </h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {earningsModalStock.symbol}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    ({earningsSummaryData?.companyName || earningsModalStock.name})
                  </span>
                  {earningsSummaryData?.quarter && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '0.15rem 0.5rem',
                        borderRadius: '999px',
                        background: 'rgba(59, 130, 246, 0.15)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        color: 'var(--accent-color)',
                      }}
                    >
                      {earningsSummaryData.quarter}
                    </span>
                  )}
                  {earningsSummaryData?.reportedDate && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      • תאריך דוח: {earningsSummaryData.reportedDate}
                    </span>
                  )}
                </div>
              </div>

              {/* Close Button */}
              <button
                type="button"
                className="close-btn"
                onClick={() => setEarningsModalStock(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '0.45rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Loading State */}
            {earningsModalLoading && (
              <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
                <RefreshCw size={36} className="animate-spin" style={{ color: '#ef4444', margin: '0 auto 1.25rem' }} />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  Gemini קורא ומנתח את הדוחות הכספיים של {earningsModalStock.symbol}…
                </h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '420px', margin: '0 auto' }}>
                  מעבד תוצאות רבעוניות, הכנסות, רווח למניה (EPS), תחזית הנהלה ומסכם ב-4, 10 ו-20 שורות.
                </p>
              </div>
            )}

            {/* Error State */}
            {!earningsModalLoading && earningsModalError && (
              <div
                style={{
                  padding: '1.25rem',
                  borderRadius: '10px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  textAlign: 'center',
                  marginBottom: '1rem',
                }}
              >
                <p style={{ margin: '0 0 0.75rem', fontWeight: 600 }}>{earningsModalError}</p>
                <button
                  type="button"
                  onClick={() => openEarningsSummary(earningsModalStock, true)}
                  className="btn btn-secondary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#ef4444' }}
                >
                  <RefreshCw size={14} /> נסה שוב
                </button>
              </div>
            )}

            {/* Content Display */}
            {!earningsModalLoading && earningsSummaryData && (
              <div>
                {/* Headline Banner */}
                {earningsSummaryData.headline && (
                  <div
                    style={{
                      padding: '0.9rem 1.1rem',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12), rgba(59, 130, 246, 0.12))',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      marginBottom: '1.25rem',
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f87171', marginBottom: '0.25rem' }}>
                      כותרת הדוח
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)', lineHeight: 1.4 }}>
                      {earningsSummaryData.headline}
                    </div>
                  </div>
                )}

                {/* Length Selector Tabs: 4 שורות | 10 שורות | 20 שורות */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                      בחר אורך פירוט:
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 600 }}>
                      מוצגות {earningsLinesCount} שורות
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1fr',
                      gap: '0.5rem',
                      background: 'rgba(0, 0, 0, 0.25)',
                      padding: '0.35rem',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    {([4, 10, 20] as const).map((count) => {
                      const isActive = earningsLinesCount === count;
                      return (
                        <button
                          key={count}
                          type="button"
                          onClick={() => setEarningsLinesCount(count)}
                          style={{
                            padding: '0.65rem 0.5rem',
                            borderRadius: '8px',
                            border: isActive ? '1px solid #ef4444' : '1px solid transparent',
                            background: isActive
                              ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(239, 68, 68, 0.12))'
                              : 'transparent',
                            color: isActive ? '#fff' : 'var(--text-muted)',
                            fontWeight: isActive ? 700 : 500,
                            fontSize: '0.92rem',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '0.2rem',
                          }}
                        >
                          <span style={{ fontSize: '1.05rem', fontWeight: 800 }}>{count} שורות</span>
                          <span style={{ fontSize: '0.72rem', opacity: 0.8 }}>
                            {count === 4 ? 'תמציתי וממוקד' : count === 10 ? 'מורחב ומעמיק' : 'ניתוח עומק מקיף'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Natural Narrative by Gemini (במילים שלו, ללא שלבים טכניים) */}
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.025)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.07)',
                    padding: '1.25rem',
                    marginBottom: '1.5rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.9rem', color: '#f87171', fontWeight: 700, fontSize: '0.88rem' }}>
                    <Sparkles size={15} />
                    <span>מה החברה עשתה בדוחות (במילים של Gemini):</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    {(() => {
                      const lines: string[] =
                        earningsLinesCount === 4
                          ? (earningsSummaryData.summary4 || [])
                          : earningsLinesCount === 10
                          ? (earningsSummaryData.summary10 || earningsSummaryData.summary4 || [])
                          : (earningsSummaryData.summary20 || earningsSummaryData.summary10 || earningsSummaryData.summary4 || []);

                      if (!lines || lines.length === 0) {
                        return <div style={{ color: 'var(--text-muted)' }}>אין נתוני הסבר זמינים</div>;
                      }

                      return lines.slice(0, earningsLinesCount).map((sentence, idx) => (
                        <p
                          key={idx}
                          style={{
                            margin: 0,
                            lineHeight: 1.65,
                            fontSize: '0.96rem',
                            color: 'var(--text-main)',
                            borderRight: '3px solid rgba(239, 68, 68, 0.45)',
                            paddingRight: '0.75rem',
                          }}
                        >
                          {sentence}
                        </p>
                      ));
                    })()}
                  </div>
                </div>

                {/* Key Financial Metrics (בתחתית: רווח למניה, הכנסות, תוצאת דוח, תחזית) */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
                    נתונים פיננסיים מרכזיים מהדוח:
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                      gap: '0.75rem',
                    }}
                  >
                    {/* EPS (רווח למניה) */}
                    {earningsSummaryData.epsText && (
                      <div
                        style={{
                          padding: '0.85rem',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>רווח למניה (EPS)</div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.35 }}>
                          {earningsSummaryData.epsText}
                        </div>
                      </div>
                    )}

                    {/* Revenue (הכנסות) */}
                    {earningsSummaryData.revenueText && (
                      <div
                        style={{
                          padding: '0.85rem',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>הכנסות</div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.35 }}>
                          {earningsSummaryData.revenueText}
                        </div>
                      </div>
                    )}

                    {/* Beat / Miss Result */}
                    <div
                      style={{
                        padding: '0.85rem',
                        borderRadius: '8px',
                        background:
                          earningsSummaryData.beatOrMiss === 'beat'
                            ? 'rgba(16, 185, 129, 0.1)'
                            : earningsSummaryData.beatOrMiss === 'miss'
                            ? 'rgba(239, 68, 68, 0.1)'
                            : 'rgba(234, 179, 8, 0.1)',
                        border: `1px solid ${
                          earningsSummaryData.beatOrMiss === 'beat'
                            ? 'rgba(16, 185, 129, 0.3)'
                            : earningsSummaryData.beatOrMiss === 'miss'
                            ? 'rgba(239, 68, 68, 0.3)'
                            : 'rgba(234, 179, 8, 0.3)'
                        }`,
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>תוצאת הדוח</div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: '0.92rem',
                          color:
                            earningsSummaryData.beatOrMiss === 'beat'
                              ? 'var(--profit-color)'
                              : earningsSummaryData.beatOrMiss === 'miss'
                              ? 'var(--loss-color)'
                              : '#eab308',
                        }}
                      >
                        {earningsSummaryData.beatOrMiss === 'beat'
                          ? '🔥 עקפה את התחזיות (Beat)'
                          : earningsSummaryData.beatOrMiss === 'miss'
                          ? '⚠️ פספסה את התחזיות (Miss)'
                          : '⚖️ תוצאות מעורבות'}
                      </div>
                    </div>

                    {/* Forward Guidance */}
                    {earningsSummaryData.guidanceText && (
                      <div
                        style={{
                          padding: '0.85rem',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>תחזית עתידית (Guidance)</div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.35 }}>
                          {earningsSummaryData.guidanceText}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Line Conclusion */}
                {earningsSummaryData.bottomLine && (
                  <div
                    style={{
                      padding: '1rem 1.15rem',
                      borderRadius: '10px',
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      marginBottom: '1.25rem',
                    }}
                  >
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f87171', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Sparkles size={14} /> שורה תחתונה למשקיע:
                    </div>
                    <div style={{ fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: 1.5, fontWeight: 500 }}>
                      {earningsSummaryData.bottomLine}
                    </div>
                  </div>
                )}

                {/* Modal Footer Actions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {/* Copy Button */}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        const lines: string[] =
                          earningsLinesCount === 4
                            ? (earningsSummaryData.summary4 || [])
                            : earningsLinesCount === 10
                            ? (earningsSummaryData.summary10 || [])
                            : (earningsSummaryData.summary20 || []);
                        const text = `📊 סיכום דוחות כספיים - ${earningsModalStock.symbol} (${earningsSummaryData.quarter || ''})\n${earningsSummaryData.headline || ''}\n\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\nשורה תחתונה:\n${earningsSummaryData.bottomLine || ''}`;
                        navigator.clipboard.writeText(text);
                        setEarningsCopied(true);
                        setTimeout(() => setEarningsCopied(false), 2500);
                      }}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                    >
                      <CheckCircle2 size={15} style={{ color: earningsCopied ? 'var(--profit-color)' : 'inherit' }} />
                      <span>{earningsCopied ? 'הועתק ללוח!' : 'העתק סיכום'}</span>
                    </button>

                    {/* Refresh Button */}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => openEarningsSummary(earningsModalStock, true)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                      title="רענן ניתוח AI"
                    >
                      <RefreshCw size={14} />
                      <span>רענן</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setEarningsModalStock(null)}
                    style={{ minWidth: '90px' }}
                  >
                    סגור
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Side Toolbar Drawer (סרגל כלים שנפתח בלחיצה על 3 הפסים) */}
      <div
        onClick={() => setToolsDrawerOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 120,
          opacity: toolsDrawerOpen ? 1 : 0,
          visibility: toolsDrawerOpen ? 'visible' : 'hidden',
          pointerEvents: toolsDrawerOpen ? 'auto' : 'none',
          transition: 'opacity 0.15s ease, visibility 0.15s ease',
          willChange: 'opacity, visibility',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: '340px',
            maxWidth: '85vw',
            height: '100vh',
            background: 'var(--card-bg, #1e222d)',
            borderLeft: '1px solid var(--border-color)',
            boxShadow: toolsDrawerOpen ? '-10px 0 35px rgba(0, 0, 0, 0.6)' : 'none',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
            direction: 'rtl',
            zIndex: 130,
            overflowY: 'auto',
            transform: toolsDrawerOpen ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)',
            transition: 'transform 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        >
          {/* Drawer Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{ padding: '0.4rem', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-color)' }}>
                <Menu size={20} />
              </div>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>סרגל כלים</h3>
            </div>
            <button
              type="button"
              onClick={() => setToolsDrawerOpen(false)}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '0.4rem',
                cursor: 'pointer',
                color: 'var(--text-muted)',
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Menu Items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {/* אבחון ביצועי התיק היום */}
            <button
              type="button"
              onClick={() => {
                setToolsDrawerOpen(false);
                handleRunPortfolioDiagnosis();
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.85rem',
                padding: '0.95rem 1rem',
                borderRadius: '12px',
                background: isTodayProfit
                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(59, 130, 246, 0.16))'
                  : 'linear-gradient(135deg, rgba(239, 68, 68, 0.16), rgba(245, 158, 11, 0.16))',
                border: isTodayProfit
                  ? '1px solid rgba(16, 185, 129, 0.45)'
                  : '1px solid rgba(239, 68, 68, 0.45)',
                cursor: 'pointer',
                textAlign: 'right',
                color: 'var(--text-main)',
                transition: 'all 0.15s ease',
                boxShadow: isTodayProfit
                  ? '0 4px 14px rgba(16, 185, 129, 0.14)'
                  : '0 4px 14px rgba(239, 68, 68, 0.14)',
              }}
            >
              <div
                style={{
                  padding: '0.45rem',
                  borderRadius: '8px',
                  background: isTodayProfit ? 'rgba(16, 185, 129, 0.22)' : 'rgba(239, 68, 68, 0.22)',
                  color: isTodayProfit ? '#34d399' : '#f87171',
                  marginTop: '2px',
                }}
              >
                {isTodayProfit ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
              </div>
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: '0.96rem',
                    color: isTodayProfit ? '#34d399' : '#f87171',
                    marginBottom: '0.2rem',
                  }}
                >
                  {isTodayProfit ? 'למה התיק שלי עלה היום? (AI)' : 'למה התיק שלי ירד היום? (AI)'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  אבחון מהיר של המניות שהשפיעו על התיק וחדשות וול סטריט בלחיצה אחת
                </div>
              </div>
            </button>

            {/* איזון מחדש חכם (הפקדת כסף) */}
            <button
              type="button"
              onClick={() => {
                setToolsDrawerOpen(false);
                setRebalanceModalOpen(true);
                setRebalanceError(null);
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.85rem',
                padding: '0.95rem 1rem',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.16), rgba(59, 130, 246, 0.16))',
                border: '1px solid rgba(139, 92, 246, 0.45)',
                cursor: 'pointer',
                textAlign: 'right',
                color: 'var(--text-main)',
                transition: 'all 0.15s ease',
                boxShadow: '0 4px 14px rgba(139, 92, 246, 0.14)',
              }}
            >
              <div
                style={{
                  padding: '0.45rem',
                  borderRadius: '8px',
                  background: 'rgba(139, 92, 246, 0.22)',
                  color: '#c4b5fd',
                  marginTop: '2px',
                }}
              >
                <Scale size={18} />
              </div>
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: '0.96rem',
                    color: '#c4b5fd',
                    marginBottom: '0.2rem',
                  }}
                >
                  איזון מחדש חכם (הפקדת כסף)
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  רוצה להשקיע סכום חדש? Gemini יחלק אותו בצורה האופטימלית לתיק
                </div>
              </div>
            </button>

            {/* איתור מנייה לפי בקשתך */}
            <button
              type="button"
              onClick={() => {
                setToolsDrawerOpen(false);
                setCustomFinderModalOpen(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.85rem',
                padding: '1rem',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.18), rgba(139, 92, 246, 0.18))',
                border: '1px solid rgba(59, 130, 246, 0.5)',
                cursor: 'pointer',
                textAlign: 'right',
                color: 'var(--text-main)',
                transition: 'all 0.15s ease',
                boxShadow: '0 4px 15px rgba(59, 130, 246, 0.15)',
              }}
            >
              <div style={{ padding: '0.5rem', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.25)', color: '#60a5fa', marginTop: '2px' }}>
                <Sparkles size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#93c5fd', marginBottom: '0.25rem' }}>
                  איתור מנייה לפי בקשתך
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  תן ל-Gemini פקודה חופשית (כמו מניות טכנולוגיה שמרניות שהפתיעו בדוחות) והוא יאתר עבורך 3 מניות עם תחזיות.
                </div>
              </div>
            </button>

            {/* המניה עם התחזית הכי גבוהה */}
            <button
              type="button"
              onClick={() => {
                setToolsDrawerOpen(false);
                handleFindTopForecast(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.85rem',
                padding: '0.9rem 1rem',
                borderRadius: '12px',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                cursor: 'pointer',
                textAlign: 'right',
                color: 'var(--text-main)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ padding: '0.45rem', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', marginTop: '2px' }}>
                <TrendingUp size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#34d399', marginBottom: '0.2rem' }}>
                  המניה עם התחזית הכי גבוהה
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  סריקת וול סטריט לאיתור המניה עם פוטנציאל העלייה המקסימלי
                </div>
              </div>
            </button>

            {/* רשימת מעקב */}
            <Link
              href="/watchlist"
              onClick={() => setToolsDrawerOpen(false)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.85rem',
                padding: '0.9rem 1rem',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-color)',
                textDecoration: 'none',
                color: 'var(--text-main)',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ padding: '0.45rem', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', marginTop: '2px' }}>
                <Bookmark size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fbbf24', marginBottom: '0.2rem' }}>
                  רשימת מעקב ({watchlist.length})
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  מעקב בזמן אמת אחר מניות מועדפות
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* Custom AI Stock Finder Modal (איתור מנייה לפי בקשתך) */}
      {customFinderModalOpen && (
        <div className="modal-overlay" onClick={() => setCustomFinderModalOpen(false)}>
          <div
            className="modal-content animate-fade-in"
            style={{
              maxHeight: '90vh',
              overflowY: 'auto',
              direction: 'rtl',
              maxWidth: '820px',
              width: '95%',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              boxShadow: '0 20px 45px rgba(0, 0, 0, 0.5), 0 0 35px rgba(59, 130, 246, 0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(139, 92, 246, 0.2))',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      borderRadius: '10px',
                      padding: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-color)',
                    }}
                  >
                    <Sparkles size={22} />
                  </div>
                  <h2 className="modal-title" style={{ margin: 0, fontSize: '1.45rem' }}>
                    איתור מנייה לפי בקשתך (Gemini AI)
                  </h2>
                </div>
                <p style={{ margin: '0.4rem 0 0', color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.4 }}>
                  כתוב ל-Gemini כל פקודה או תיאור של מניות שאתה מחפש, והוא יציג לך בדיוק 3 מניות מתאימות עם תחזיות ויעדי אנליסטים מ-<strong>Google Finance בלבד</strong>.
                </p>
              </div>

              <button
                type="button"
                className="close-btn"
                onClick={() => setCustomFinderModalOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '0.45rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Quick Filters Bar (אפשרות 4: פילטרים מהירים בלחיצת כפתור) */}
            <div
              style={{
                marginBottom: '1.25rem',
                padding: '0.9rem 1rem',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.025)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Settings size={14} style={{ color: '#60a5fa' }} />
                <span>סינון מהיר בלחיצת כפתור (חוסך הקלדה):</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                {/* Risk Filter */}
                <div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>🛡️ רמת סיכון:</div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {[
                      { id: 'all', label: 'הכל' },
                      { id: 'conservative', label: 'שמרני 🛡️' },
                      { id: 'balanced', label: 'מאוזן 📈' },
                      { id: 'aggressive', label: 'אגרסיבי 🚀' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setFinderRisk(item.id as any)}
                        style={{
                          padding: '0.22rem 0.55rem',
                          fontSize: '0.74rem',
                          borderRadius: '6px',
                          border: finderRisk === item.id ? '1px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.1)',
                          background: finderRisk === item.id ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                          color: finderRisk === item.id ? '#93c5fd' : 'var(--text-muted)',
                          cursor: 'pointer',
                          fontWeight: finderRisk === item.id ? 700 : 500,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Budget Filter */}
                <div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>💵 תקציב למניה:</div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {[
                      { id: 'all', label: 'ללא הגבלה' },
                      { id: 'under50', label: 'עד 50$' },
                      { id: '50to150', label: '50$-150$' },
                      { id: 'above150', label: '150$+' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setFinderBudget(item.id as any)}
                        style={{
                          padding: '0.22rem 0.55rem',
                          fontSize: '0.74rem',
                          borderRadius: '6px',
                          border: finderBudget === item.id ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.1)',
                          background: finderBudget === item.id ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                          color: finderBudget === item.id ? 'var(--profit-color)' : 'var(--text-muted)',
                          cursor: 'pointer',
                          fontWeight: finderBudget === item.id ? 700 : 500,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dividend Filter */}
                <div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>💰 חלוקת דיבידנד:</div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {[
                      { id: 'all', label: 'הכל' },
                      { id: 'dividendOnly', label: 'חובה דיבידנד 💰' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setFinderDividend(item.id as any)}
                        style={{
                          padding: '0.22rem 0.55rem',
                          fontSize: '0.74rem',
                          borderRadius: '6px',
                          border: finderDividend === item.id ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.1)',
                          background: finderDividend === item.id ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                          color: finderDividend === item.id ? '#fbbf24' : 'var(--text-muted)',
                          cursor: 'pointer',
                          fontWeight: finderDividend === item.id ? 700 : 500,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Earnings Beat Filter */}
                <div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>🏆 דוחות כספיים:</div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                    {[
                      { id: 'all', label: 'הכל' },
                      { id: 'beatOnly', label: 'הכו תחזיות בלבד 🔥' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setFinderBeat(item.id as any)}
                        style={{
                          padding: '0.22rem 0.55rem',
                          fontSize: '0.74rem',
                          borderRadius: '6px',
                          border: finderBeat === item.id ? '1px solid #ec4899' : '1px solid rgba(255, 255, 255, 0.1)',
                          background: finderBeat === item.id ? 'rgba(236, 72, 153, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                          color: finderBeat === item.id ? '#f472b6' : 'var(--text-muted)',
                          cursor: 'pointer',
                          fontWeight: finderBeat === item.id ? 700 : 500,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Input Prompt Box */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                הפקודה שלך ל-Gemini:
              </label>
              <div style={{ position: 'relative' }}>
                <textarea
                  value={customFinderQuery}
                  onChange={(e) => setCustomFinderQuery(e.target.value)}
                  placeholder="לדוגמה: תמצא לי מנייה טכנולוגית שמרנית שהפתיעו את התחזיות והם צפויים לעלות..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.85rem 1rem',
                    borderRadius: '12px',
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    color: 'var(--text-main)',
                    fontSize: '0.98rem',
                    fontFamily: 'inherit',
                    resize: 'none',
                    lineHeight: 1.5,
                    outline: 'none',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleRunCustomFinder();
                    }
                  }}
                />
              </div>

              {/* Quick suggestions chips */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.65rem' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>רעיונות לפקודות מהירות:</span>
                {[
                  'תמצא לי מנייה טכנולוגית שמרנית שהפתיעו את התחזיות והם צפויים לעלות',
                  'מניות דיבידנד יציבות עם מאזן חזק ותחזית צמיחה',
                  'חברות בינה מלאכותית וסייבר מובילות עם אפסייד גבוה',
                  'מניות בריאות ורפואה סולידיות שרשמו דוחות חזקים',
                ].map((sug, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setCustomFinderQuery(sug);
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '999px',
                      padding: '0.25rem 0.65rem',
                      color: 'var(--text-muted)',
                      fontSize: '0.76rem',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      textAlign: 'right',
                    }}
                  >
                    💡 {sug}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '1.5rem' }}>
              <button
                type="button"
                onClick={handleRunCustomFinder}
                disabled={customFinderLoading || !customFinderQuery.trim()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem 1.75rem',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.98rem',
                  cursor: customFinderLoading || !customFinderQuery.trim() ? 'not-allowed' : 'pointer',
                  opacity: customFinderLoading || !customFinderQuery.trim() ? 0.6 : 1,
                  boxShadow: '0 4px 18px rgba(37, 99, 235, 0.4)',
                  transition: 'all 0.2s',
                }}
              >
                {customFinderLoading ? (
                  <>
                    <RefreshCw size={17} className="animate-spin" />
                    <span>{customFinderStatus || 'Gemini מחפש מניות ומנתח תחזיות…'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={17} />
                    <span>חפש 3 מניות עם Gemini</span>
                  </>
                )}
              </button>
            </div>

            {/* Error Message */}
            {customFinderError && (
              <div
                style={{
                  padding: '1rem',
                  borderRadius: '10px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  marginBottom: '1.25rem',
                  textAlign: 'center',
                }}
              >
                {customFinderError}
              </div>
            )}

            {/* Results Display */}
            {customFinderResults && customFinderResults.stocks && (
              <div>
                {/* Summary Banner */}
                {customFinderResults.summaryHe && (
                  <div
                    style={{
                      padding: '1rem 1.25rem',
                      borderRadius: '12px',
                      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(139, 92, 246, 0.12))',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      marginBottom: '1.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.35rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-color)', fontWeight: 700, fontSize: '0.85rem' }}>
                        <Sparkles size={15} />
                        <span>סיכום הבחירה של Gemini:</span>
                      </div>
                      <span style={{ fontSize: '0.74rem', padding: '0.15rem 0.55rem', borderRadius: '6px', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', fontWeight: 600 }}>
                        תחזיות: Google Finance בלבד
                      </span>
                    </div>
                    <div style={{ fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: 1.55 }}>
                      {customFinderResults.summaryHe}
                    </div>
                  </div>
                )}

                {/* Head-to-Head Comparison Matrix (אפשרות 1: טבלת השוואת ראש-בראש חיה) */}
                <div style={{ marginBottom: '1.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f1f5f9' }}>
                        ⚔️ השוואת ראש-בראש בין 3 המניות
                      </span>
                      <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd', fontWeight: 600 }}>
                        Live Matrix
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowComparisonMatrix(!showComparisonMatrix)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        padding: '0.25rem 0.65rem',
                        color: 'var(--text-muted)',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                      }}
                    >
                      {showComparisonMatrix ? 'הסתר טבלה ▲' : 'הצג טבלת השוואה ▼'}
                    </button>
                  </div>

                  {showComparisonMatrix && (
                    <div
                      style={{
                        width: '100%',
                        borderRadius: '12px',
                        border: '1px solid rgba(255, 255, 255, 0.09)',
                        background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.8) 0%, rgba(30, 41, 59, 0.6) 100%)',
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                      }}
                    >
                      <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.82rem' }}>
                        <thead>
                          <tr style={{ background: 'rgba(255, 255, 255, 0.04)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                            <th style={{ width: '28%', padding: '0.65rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.78rem' }}>מדד השוואה</th>
                            {customFinderResults.stocks.map((st: any) => (
                              <th key={st.symbol} style={{ width: '24%', padding: '0.65rem 0.25rem', fontWeight: 800, textAlign: 'center' }}>
                                <div style={{ fontSize: '0.98rem', color: '#60a5fa', lineHeight: 1.2 }}>{st.symbol}</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                                  {st.name}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {/* Live Price */}
                          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <td style={{ padding: '0.55rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.78rem' }}>מחיר שוק עדכני</td>
                            {customFinderResults.stocks.map((st: any) => (
                              <td key={st.symbol} style={{ padding: '0.55rem 0.25rem', textAlign: 'center', fontWeight: 700, direction: 'ltr', fontSize: '0.84rem' }}>
                                ${st.currentPrice?.toFixed(2)}
                              </td>
                            ))}
                          </tr>

                          {/* Upside Target */}
                          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <td style={{ padding: '0.55rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.78rem' }}>מחיר יעד & אפסייד</td>
                            {customFinderResults.stocks.map((st: any) => (
                              <td key={st.symbol} style={{ padding: '0.55rem 0.25rem', textAlign: 'center' }}>
                                <div style={{ fontWeight: 800, color: 'var(--profit-color)', direction: 'ltr', fontSize: '0.8rem', lineHeight: 1.25 }}>
                                  ${st.targetPrice}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--profit-color)', fontWeight: 700, direction: 'ltr' }}>
                                  (+{st.upsidePercent}%)
                                </div>
                              </td>
                            ))}
                          </tr>

                          {/* Portfolio Fit Score (אפשרות 3) */}
                          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', background: 'rgba(59, 130, 246, 0.04)' }}>
                            <td style={{ padding: '0.55rem 0.5rem', color: '#93c5fd', fontWeight: 700, fontSize: '0.78rem' }}>🎯 התאמה לתיק</td>
                            {customFinderResults.stocks.map((st: any) => (
                              <td key={st.symbol} style={{ padding: '0.55rem 0.25rem', textAlign: 'center' }}>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    padding: '0.15rem 0.45rem',
                                    borderRadius: '999px',
                                    background: 'rgba(59, 130, 246, 0.2)',
                                    border: '1px solid rgba(59, 130, 246, 0.4)',
                                    color: '#60a5fa',
                                    fontWeight: 800,
                                    fontSize: '0.78rem',
                                  }}
                                >
                                  {st.portfolioFitScore || 92}%
                                </span>
                              </td>
                            ))}
                          </tr>

                          {/* P/E Ratio */}
                          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <td style={{ padding: '0.55rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.78rem' }}>מכפיל רווח (P/E)</td>
                            {customFinderResults.stocks.map((st: any) => (
                              <td key={st.symbol} style={{ padding: '0.55rem 0.25rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem' }}>
                                {st.peRatio ? `${st.peRatio}` : 'צמיחה'}
                              </td>
                            ))}
                          </tr>

                          {/* Dividend Yield */}
                          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <td style={{ padding: '0.55rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.78rem' }}>תשואת דיבידנד</td>
                            {customFinderResults.stocks.map((st: any) => (
                              <td key={st.symbol} style={{ padding: '0.55rem 0.25rem', textAlign: 'center', fontWeight: 600, fontSize: '0.8rem' }}>
                                {st.dividendYield > 0 ? (
                                  <span style={{ color: '#fbbf24' }}>{st.dividendYield}% 💰</span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)' }}>0%</span>
                                )}
                              </td>
                            ))}
                          </tr>

                          {/* 52-Week High Distance */}
                          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <td style={{ padding: '0.55rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.78rem' }}>מרחק משיא</td>
                            {customFinderResults.stocks.map((st: any) => (
                              <td key={st.symbol} style={{ padding: '0.55rem 0.25rem', textAlign: 'center', fontSize: '0.76rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {st.distanceFrom52wHigh || 'רגיל'}
                              </td>
                            ))}
                          </tr>

                          {/* Action Row */}
                          <tr>
                            <td style={{ padding: '0.55rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.78rem' }}>הוסף לתיק</td>
                            {customFinderResults.stocks.map((st: any) => {
                              const inPort = portfolio.some((p) => p.symbol.toUpperCase() === st.symbol.toUpperCase());
                              return (
                                <td key={st.symbol} style={{ padding: '0.55rem 0.25rem', textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectStock({ symbol: st.symbol, shortname: st.name })}
                                    style={{
                                      width: '100%',
                                      maxWidth: '90px',
                                      padding: '0.35rem 0.2rem',
                                      borderRadius: '6px',
                                      background: inPort ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                      border: inPort ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(59, 130, 246, 0.4)',
                                      color: inPort ? 'var(--profit-color)' : '#93c5fd',
                                      fontSize: '0.74rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {inPort ? '✓ בתיק' : '+ הוסף'}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 3 Stocks Cards */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {customFinderResults.stocks.map((st: any, idx: number) => {
                    const isWatchlist = watchlist.some((w) => w.symbol === st.symbol);

                    return (
                      <div
                        key={st.symbol}
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '14px',
                          padding: '1.25rem',
                          position: 'relative',
                          transition: 'all 0.2s',
                        }}
                      >
                        {/* Top Stock Bar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                background: 'rgba(59, 130, 246, 0.15)',
                                color: 'var(--accent-color)',
                                fontWeight: 800,
                                fontSize: '0.95rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {idx + 1}
                            </div>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)' }}>
                                  {st.symbol}
                                </span>
                                <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-muted)' }}>
                                  {st.sector}
                                </span>
                              </div>
                              <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                                {st.name}
                              </div>
                            </div>
                          </div>

                          {/* Target Price & Upside */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                            {st.currentPrice && (
                              <div style={{ textAlign: 'left', direction: 'ltr' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>מחיר נוכחי</div>
                                <div style={{ fontSize: '1rem', fontWeight: 700 }}>${st.currentPrice.toFixed(2)}</div>
                              </div>
                            )}

                            <div
                              style={{
                                padding: '0.45rem 0.85rem',
                                borderRadius: '8px',
                                background: 'rgba(16, 185, 129, 0.15)',
                                border: '1px solid rgba(16, 185, 129, 0.4)',
                                textAlign: 'center',
                              }}
                            >
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>יעד אנליסטים (Google Finance בלבד)</div>
                              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--profit-color)', direction: 'ltr' }}>
                                ${st.targetPrice} (+{st.upsidePercent}%)
                              </div>
                            </div>

                            <div
                              style={{
                                padding: '0.45rem 0.75rem',
                                borderRadius: '8px',
                                background: 'rgba(59, 130, 246, 0.12)',
                                border: '1px solid rgba(59, 130, 246, 0.3)',
                                color: 'var(--accent-color)',
                                fontWeight: 700,
                                fontSize: '0.82rem',
                              }}
                            >
                              {st.rating}
                            </div>
                          </div>
                        </div>

                        {/* Personal Portfolio Fit Badge (אפשרות 3: מדד התאמה אישית לתיק שלך) */}
                        <div
                          style={{
                            padding: '0.75rem 0.9rem',
                            borderRadius: '10px',
                            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(16, 185, 129, 0.08))',
                            border: '1px solid rgba(59, 130, 246, 0.25)',
                            marginBottom: '0.85rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.25rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem', color: '#93c5fd', fontWeight: 700 }}>
                              <Target size={15} style={{ color: '#60a5fa' }} />
                              <span>התאמה אישית לתיק שלך:</span>
                            </div>
                            <span
                              style={{
                                padding: '0.15rem 0.55rem',
                                borderRadius: '999px',
                                background: 'rgba(16, 185, 129, 0.2)',
                                border: '1px solid rgba(16, 185, 129, 0.4)',
                                color: 'var(--profit-color)',
                                fontWeight: 800,
                                fontSize: '0.82rem',
                              }}
                            >
                              🎯 {st.portfolioFitScore || 92}% התאמה
                            </span>
                          </div>
                          <div style={{ fontSize: '0.83rem', color: 'var(--text-main)', lineHeight: 1.45 }}>
                            💡 {st.portfolioFitReason || 'מעניקה פיזור ואיזון אופטימלי לנכסים הקיימים בתיק שלך.'}
                          </div>
                        </div>

                        {/* Financial Metrics Chips */}
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
                          <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.35)', color: '#93c5fd' }}>
                            תחזית: <strong style={{ color: '#60a5fa' }}>Google Finance בלבד</strong>
                          </span>
                          {st.historical20Year && (
                            <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.35)', color: 'var(--profit-color)' }}>
                              📊 ממוצע ב-{Math.round(st.historical20Year.years)} השנים האחרונות: <strong style={{ color: '#34d399' }}>{st.historical20Year.cagrPercent >= 0 ? '+' : ''}{st.historical20Year.cagrPercent}% לשנה</strong>
                            </span>
                          )}
                          {st.peRatio && (
                            <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                              📊 מכפיל P/E: <strong style={{ color: 'var(--text-main)' }}>{st.peRatio}</strong>
                            </span>
                          )}
                          <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                            💰 דיבידנד: <strong style={{ color: st.dividendYield > 0 ? '#fbbf24' : 'var(--text-main)' }}>{st.dividendYield > 0 ? `${st.dividendYield}%` : '0%'}</strong>
                          </span>
                          {st.distanceFrom52wHigh && (
                            <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                              📈 שיא 52 שבועות: <strong style={{ color: 'var(--text-main)' }}>{st.distanceFrom52wHigh}</strong>
                            </span>
                          )}
                          {st.marketCap && (
                            <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                              🏢 שווי שוק: <strong style={{ color: 'var(--text-main)' }}>{st.marketCap}</strong>
                            </span>
                          )}
                        </div>

                        {/* Interactive Future Return Calculator (מחשבון תשואה היסטורית לעוד X שנים) */}
                        {st.historical20Year && (
                          <div
                            style={{
                              padding: '0.85rem 1rem',
                              borderRadius: '10px',
                              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(59, 130, 246, 0.08))',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              marginBottom: '0.9rem',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.55rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.86rem', fontWeight: 700, color: '#34d399' }}>
                                <TrendingUp size={16} />
                                <span>מחשבון תשואה לפי ממוצע 20 שנה ({st.historical20Year.cagrPercent >= 0 ? '+' : ''}{st.historical20Year.cagrPercent}% לשנה):</span>
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                ({st.historical20Year.startYear} – {st.historical20Year.endYear})
                              </div>
                            </div>

                            {/* Year & Investment selector buttons */}
                            {(() => {
                              const rawVal = projectionYears[st.symbol];
                              const parsedYears = typeof rawVal === 'number' ? rawVal : (rawVal !== undefined && rawVal !== '' ? parseInt(String(rawVal), 10) : NaN);
                              const effectiveYears = !isNaN(parsedYears) && parsedYears > 0 ? parsedYears : 10;
                              const inputValue = rawVal !== undefined ? rawVal : 10;

                              const rawAmount = projectionInvestments[st.symbol];
                              const parsedAmount = typeof rawAmount === 'number' ? rawAmount : (rawAmount !== undefined && rawAmount !== '' ? parseFloat(String(rawAmount)) : NaN);
                              const effectiveAmount = !isNaN(parsedAmount) && parsedAmount > 0 ? parsedAmount : 10000;
                              const inputAmountValue = rawAmount !== undefined ? rawAmount : 10000;

                              // Year 1 Return: 100% based on Google Finance Analyst 12-Month Target Forecast
                              const year1UpsidePercent = typeof st.upsidePercent === 'number' && !isNaN(st.upsidePercent)
                                ? st.upsidePercent
                                : st.historical20Year.cagrPercent;
                              const year1Multiplier = 1 + (year1UpsidePercent / 100);

                              // Subsequent Years Return: based on 20-Year Historical Annual Average (CAGR)
                              const subsequentYears = Math.max(0, effectiveYears - 1);
                              const cagrRate = st.historical20Year.cagrPercent / 100;
                              const subsequentMultiplier = Math.pow(1 + cagrRate, subsequentYears);

                              // Combined Multiplier: (Year 1 Analyst Forecast) * (Subsequent Years Historical Average)
                              const combinedMultiplier = effectiveYears === 1
                                ? year1Multiplier
                                : (year1Multiplier * subsequentMultiplier);

                              const totalProjReturn = (combinedMultiplier - 1) * 100;
                              const futurePrice = (st.currentPrice || 100) * combinedMultiplier;

                              // Investment calculations in user's selected currency (summarySym)
                              const futurePortfolioValue = effectiveAmount * combinedMultiplier;
                              const profitBeforeTax = futurePortfolioValue - effectiveAmount;
                              const taxRate = 0.25; // 25% מס רווחי הון
                              const taxAmount = profitBeforeTax > 0 ? profitBeforeTax * taxRate : 0;
                              const profitAfterTax = profitBeforeTax > 0 ? profitBeforeTax - taxAmount : profitBeforeTax;

                              return (
                                <div>
                                  {/* Row 1: Years Selection */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>טווח שנים:</span>
                                    {[1, 3, 5, 10, 15, 20].map((yr) => (
                                      <button
                                        key={yr}
                                        type="button"
                                        onClick={() => setProjectionYears(prev => ({ ...prev, [st.symbol]: yr }))}
                                        style={{
                                          padding: '0.22rem 0.55rem',
                                          borderRadius: '6px',
                                          fontSize: '0.76rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                          transition: 'all 0.15s ease',
                                          background: effectiveYears === yr ? 'var(--profit-color)' : 'rgba(255, 255, 255, 0.06)',
                                          border: effectiveYears === yr ? '1px solid var(--profit-color)' : '1px solid var(--border-color)',
                                          color: effectiveYears === yr ? '#000' : 'var(--text-main)',
                                        }}
                                      >
                                        {yr} {yr === 1 ? 'שנה' : 'שנים'}
                                      </button>
                                    ))}
                                    {/* Custom input with full deletion and typing freedom */}
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginLeft: 'auto' }}>
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>מותאם:</span>
                                      <input
                                        type="number"
                                        min={1}
                                        max={100}
                                        placeholder="10"
                                        dir="ltr"
                                        value={inputValue}
                                        onFocus={(e) => {
                                          e.target.select();
                                        }}
                                        onClick={(e) => {
                                          (e.target as HTMLInputElement).select();
                                        }}
                                        onChange={(e) => {
                                          const valStr = e.target.value;
                                          if (valStr === '') {
                                            setProjectionYears(prev => ({ ...prev, [st.symbol]: '' }));
                                            return;
                                          }
                                          const num = parseInt(valStr, 10);
                                          if (!isNaN(num)) {
                                            setProjectionYears(prev => ({ ...prev, [st.symbol]: num }));
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            (e.target as HTMLElement).blur();
                                          }
                                        }}
                                        onBlur={() => {
                                          const current = projectionYears[st.symbol];
                                          if (current === '' || current === undefined || isNaN(Number(current)) || Number(current) <= 0) {
                                            setProjectionYears(prev => ({ ...prev, [st.symbol]: 10 }));
                                          }
                                          if (typeof window !== 'undefined') {
                                            window.scrollTo({ left: 0, behavior: 'smooth' });
                                          }
                                        }}
                                        style={{
                                          width: '54px',
                                          padding: '0.2rem 0.3rem',
                                          borderRadius: '6px',
                                          background: 'rgba(0,0,0,0.35)',
                                          border: '1px solid rgba(255, 255, 255, 0.2)',
                                          color: '#fff',
                                          fontSize: '16px',
                                          fontWeight: 700,
                                          textAlign: 'center',
                                          direction: 'ltr',
                                          unicodeBidi: 'plaintext',
                                        }}
                                      />
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>שנים</span>
                                    </div>
                                  </div>

                                  {/* Row 2: Investment Amount Selection */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.65rem' }}>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>סכום להשקעה ({summarySym}):</span>
                                    {[1000, 5000, 10000, 50000, 100000].map((amt) => (
                                      <button
                                        key={amt}
                                        type="button"
                                        onClick={() => setProjectionInvestments(prev => ({ ...prev, [st.symbol]: amt }))}
                                        style={{
                                          padding: '0.22rem 0.5rem',
                                          borderRadius: '6px',
                                          fontSize: '0.75rem',
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                          transition: 'all 0.15s ease',
                                          background: effectiveAmount === amt ? 'rgba(251, 191, 36, 0.25)' : 'rgba(255, 255, 255, 0.06)',
                                          border: effectiveAmount === amt ? '1px solid #fbbf24' : '1px solid var(--border-color)',
                                          color: effectiveAmount === amt ? '#fbbf24' : 'var(--text-main)',
                                        }}
                                      >
                                        {summarySym}{amt.toLocaleString()}
                                      </button>
                                    ))}
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginLeft: 'auto' }}>
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ידני:</span>
                                      <input
                                        type="number"
                                        min={1}
                                        step={100}
                                        placeholder="10000"
                                        dir="ltr"
                                        value={inputAmountValue}
                                        onFocus={(e) => {
                                          e.target.select();
                                        }}
                                        onClick={(e) => {
                                          (e.target as HTMLInputElement).select();
                                        }}
                                        onChange={(e) => {
                                          const valStr = e.target.value;
                                          if (valStr === '') {
                                            setProjectionInvestments(prev => ({ ...prev, [st.symbol]: '' }));
                                            return;
                                          }
                                          const num = parseFloat(valStr);
                                          if (!isNaN(num)) {
                                            setProjectionInvestments(prev => ({ ...prev, [st.symbol]: num }));
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            (e.target as HTMLElement).blur();
                                          }
                                        }}
                                        onBlur={() => {
                                          const current = projectionInvestments[st.symbol];
                                          if (current === '' || current === undefined || isNaN(Number(current)) || Number(current) <= 0) {
                                            setProjectionInvestments(prev => ({ ...prev, [st.symbol]: 10000 }));
                                          }
                                          if (typeof window !== 'undefined') {
                                            window.scrollTo({ left: 0, behavior: 'smooth' });
                                          }
                                        }}
                                        style={{
                                          width: '82px',
                                          padding: '0.2rem 0.35rem',
                                          borderRadius: '6px',
                                          background: 'rgba(0,0,0,0.35)',
                                          border: '1px solid rgba(255, 255, 255, 0.2)',
                                          color: '#fff',
                                          fontSize: '16px',
                                          fontWeight: 700,
                                          textAlign: 'center',
                                          direction: 'ltr',
                                          unicodeBidi: 'plaintext',
                                        }}
                                      />
                                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{summarySym}</span>
                                    </div>
                                  </div>

                                  {/* Breakdown legend */}
                                  <div style={{ fontSize: '0.74rem', color: '#93c5fd', marginBottom: '0.55rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <span>🎯 שנה 1 (תחזית אנליסטים Google Finance): <strong style={{ color: (st.upsidePercent || 0) >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }}>{(st.upsidePercent || 0) >= 0 ? '+' : ''}{st.upsidePercent}%</strong></span>
                                    {effectiveYears > 1 && (
                                      <span>📈 {effectiveYears - 1} השנים הבאות (ממוצע 20 שנה): <strong style={{ color: '#34d399' }}>{st.historical20Year.cagrPercent >= 0 ? '+' : ''}{st.historical20Year.cagrPercent}% לשנה</strong></span>
                                    )}
                                  </div>

                                  {/* Result display */}
                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                                      gap: '0.5rem',
                                      background: 'rgba(0, 0, 0, 0.25)',
                                      padding: '0.65rem 0.85rem',
                                      borderRadius: '8px',
                                      border: '1px solid rgba(255, 255, 255, 0.05)',
                                    }}
                                  >
                                    <div>
                                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>תשואה מצטברת בעוד {effectiveYears} {effectiveYears === 1 ? 'שנה' : 'שנים'}:</div>
                                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: totalProjReturn >= 0 ? 'var(--profit-color)' : 'var(--loss-color)', direction: 'ltr', textAlign: 'right' }}>
                                        {totalProjReturn >= 0 ? '+' : ''}{totalProjReturn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>מחיר מניה חזוי (מ-{money(st.currentPrice)}):</div>
                                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#60a5fa', direction: 'ltr', textAlign: 'right' }}>
                                        {money(futurePrice)}
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>שווי תיק צפוי ({summarySym}):</div>
                                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fbbf24', direction: 'ltr', textAlign: 'right' }}>
                                        {summarySym}{futurePortfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </div>
                                      <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                                        מהשקעה של {summarySym}{effectiveAmount.toLocaleString()}
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>רווח נקי לפני מס ({summarySym}):</div>
                                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: profitBeforeTax >= 0 ? 'var(--profit-color)' : 'var(--loss-color)', direction: 'ltr', textAlign: 'right' }}>
                                        {profitBeforeTax >= 0 ? '+' : ''}{summarySym}{profitBeforeTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </div>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>רווח נקי אחרי מס (25%):</div>
                                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: profitAfterTax >= 0 ? 'var(--profit-color)' : 'var(--loss-color)', direction: 'ltr', textAlign: 'right' }}>
                                        {profitAfterTax >= 0 ? '+' : ''}{summarySym}{profitAfterTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </div>
                                      {profitBeforeTax > 0 && (
                                        <div style={{ fontSize: '0.67rem', color: '#f87171' }}>
                                          נוכה מס 25%: -{summarySym}{taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* Why Match Details */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem', background: 'rgba(0, 0, 0, 0.2)', padding: '0.85rem', borderRadius: '10px' }}>
                          <div>
                            <span style={{ fontWeight: 700, fontSize: '0.86rem', color: '#93c5fd' }}>
                              למה מתאימה לבקשתך:
                            </span>{' '}
                            <span style={{ fontSize: '0.92rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                              {st.whyMatch}
                            </span>
                          </div>

                          {st.earningsBeat && (
                            <div>
                              <span style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--profit-color)' }}>
                                ביצועי דוחות והפתעות:
                              </span>{' '}
                              <span style={{ fontSize: '0.92rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                                {st.earningsBeat}
                              </span>
                            </div>
                          )}

                          {st.catalyst && (
                            <div>
                              <span style={{ fontWeight: 700, fontSize: '0.86rem', color: '#fbbf24' }}>
                                זרז מרכזי לעלייה:
                              </span>{' '}
                              <span style={{ fontSize: '0.92rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                                {st.catalyst}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Stock Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => toggleWatchlistStock({ symbol: st.symbol, name: st.name })}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.4rem 0.75rem',
                              borderRadius: '6px',
                              background: isWatchlist ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                              border: isWatchlist ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--border-color)',
                              color: isWatchlist ? '#fbbf24' : 'var(--text-main)',
                              fontSize: '0.82rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            <Bookmark size={13} fill={isWatchlist ? '#fbbf24' : 'none'} />
                            <span>{isWatchlist ? 'במעקב ✓' : 'הוסף למעקב'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              handleSelectStock({ symbol: st.symbol, shortname: st.name });
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.4rem 0.75rem',
                              borderRadius: '6px',
                              background: 'rgba(16, 185, 129, 0.12)',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              color: 'var(--profit-color)',
                              fontSize: '0.82rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            <Plus size={13} />
                            <span>הוסף לתיק</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setChartStock({ symbol: st.symbol, name: st.name, buyPrice: st.currentPrice || 100, investedAmount: 0, currentPrice: st.currentPrice });
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.4rem 0.75rem',
                              borderRadius: '6px',
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-main)',
                              fontSize: '0.82rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            <LineChart size={13} />
                            <span>גרף</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              openEarningsSummary({ symbol: st.symbol, name: st.name });
                            }}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.4rem 0.75rem',
                              borderRadius: '6px',
                              background: 'rgba(239, 68, 68, 0.1)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              color: '#f87171',
                              fontSize: '0.82rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            <Sparkles size={13} />
                            <span>סיכום דוחות AI</span>
                          </button>

                          <a
                            href={st.googleFinanceUrl || (st.symbol?.endsWith('.TA') ? `https://www.google.com/finance/quote/${st.symbol.replace(/\.TA$/i, '')}:TLV` : `https://www.google.com/finance/quote/${st.symbol}`)}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.4rem 0.75rem',
                              borderRadius: '6px',
                              background: 'rgba(59, 130, 246, 0.12)',
                              border: '1px solid rgba(59, 130, 246, 0.35)',
                              color: '#60a5fa',
                              fontSize: '0.82rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textDecoration: 'none',
                            }}
                          >
                            <ExternalLink size={13} />
                            <span>Google Finance</span>
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* One-Click Portfolio Diagnosis Modal (למה התיק שלי ירד / עלה היום?) */}
      {diagnosisModalOpen && (
        <div className="modal-overlay" onClick={() => setDiagnosisModalOpen(false)}>
          <div
            className="modal-content animate-fade-in"
            style={{
              maxHeight: '90vh',
              overflowY: 'auto',
              direction: 'rtl',
              maxWidth: '820px',
              width: '95%',
              border: isTodayProfit ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
              boxShadow: isTodayProfit
                ? '0 20px 45px rgba(0, 0, 0, 0.5), 0 0 35px rgba(16, 185, 129, 0.15)'
                : '0 20px 45px rgba(0, 0, 0, 0.5), 0 0 35px rgba(239, 68, 68, 0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div
                    style={{
                      background: isTodayProfit
                        ? 'rgba(16, 185, 129, 0.18)'
                        : 'rgba(239, 68, 68, 0.18)',
                      border: isTodayProfit
                        ? '1px solid rgba(16, 185, 129, 0.4)'
                        : '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: '10px',
                      padding: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isTodayProfit ? 'var(--profit-color)' : 'var(--loss-color)',
                    }}
                  >
                    {isTodayProfit ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
                  </div>
                  <div>
                    <h2 className="modal-title" style={{ margin: 0, fontSize: '1.45rem' }}>
                      {isTodayProfit ? 'אבחון AI: למה התיק עלה היום?' : 'אבחון AI: למה התיק ירד היום?'}
                    </h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <span
                        style={{
                          fontSize: '0.9rem',
                          fontWeight: 700,
                          color: isTodayProfit ? 'var(--profit-color)' : 'var(--loss-color)',
                          direction: 'ltr',
                        }}
                      >
                        {signedSummaryMoney(totalTodayChangeUSD)} ({isTodayProfit ? '+' : ''}{totalTodayPercentChange.toFixed(2)}%)
                      </span>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        • ניתוח נתוני אמת של וול סטריט
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDiagnosisModalOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '0.45rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Loading state */}
            {diagnosisLoading && (
              <div style={{ padding: '3.5rem 1rem', textAlign: 'center' }}>
                <div className="loader" style={{ margin: '0 auto 1.25rem', width: '38px', height: '38px' }}></div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-main)', marginBottom: '0.35rem' }}>
                  Gemini סורק את מניות התיק וחדשות וול סטריט מהיום...
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  מאתר את המניות שהובילו את התנועה ומנתח את הסיבות המרכזיות בשוק
                </div>
              </div>
            )}

            {/* Error state */}
            {!diagnosisLoading && diagnosisError && (
              <div
                style={{
                  padding: '1.25rem',
                  borderRadius: '12px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  color: '#f87171',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>{diagnosisError}</div>
                <button
                  type="button"
                  onClick={handleRunPortfolioDiagnosis}
                  style={{
                    padding: '0.5rem 1.2rem',
                    borderRadius: '8px',
                    background: 'var(--accent-color)',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  נסה שוב
                </button>
              </div>
            )}

            {/* Diagnosis Content */}
            {!diagnosisLoading && diagnosisData && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Headline Banner */}
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '14px',
                    background: isTodayProfit
                      ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(59, 130, 246, 0.14))'
                      : 'linear-gradient(135deg, rgba(239, 68, 68, 0.16), rgba(245, 158, 11, 0.14))',
                    border: isTodayProfit
                      ? '1px solid rgba(16, 185, 129, 0.35)'
                      : '1px solid rgba(239, 68, 68, 0.35)',
                  }}
                >
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>
                    השורה הראשית:
                  </div>
                  <div style={{ fontSize: '1.18rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.35 }}>
                    {diagnosisData.headline}
                  </div>
                </div>

                {/* Executive Summary */}
                <div
                  style={{
                    padding: '1.1rem 1.25rem',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border-color)',
                    lineHeight: 1.6,
                    fontSize: '0.96rem',
                    color: 'var(--text-main)',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--accent-color)', marginBottom: '0.45rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Sparkles size={16} />
                    <span>סיכום האנליסט: מה קרה לתיק שלך היום?</span>
                  </div>
                  {diagnosisData.executiveSummary}
                </div>

                {/* Key Drivers (הקטרים המרכזיים בתיק) */}
                {Array.isArray(diagnosisData.keyDrivers) && diagnosisData.keyDrivers.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '0.65rem', color: 'var(--text-main)' }}>
                      🎯 המניות המשפיעות ביותר על התיק היום:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      {diagnosisData.keyDrivers.map((driver: any, idx: number) => {
                        const isPos = driver.impactType === 'positive';
                        return (
                          <div
                            key={idx}
                            style={{
                              padding: '0.85rem 1rem',
                              borderRadius: '10px',
                              background: isPos ? 'rgba(16, 185, 129, 0.07)' : 'rgba(239, 68, 68, 0.07)',
                              border: isPos ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid rgba(239, 68, 68, 0.25)',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '0.75rem',
                            }}
                          >
                            <span
                              style={{
                                padding: '0.2rem 0.6rem',
                                borderRadius: '6px',
                                background: isPos ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                color: isPos ? '#34d399' : '#f87171',
                                fontWeight: 800,
                                fontSize: '0.88rem',
                                letterSpacing: '0.5px',
                              }}
                            >
                              {driver.symbol}
                            </span>
                            <div style={{ flex: 1, fontSize: '0.88rem', color: 'var(--text-main)', lineHeight: 1.45 }}>
                              {driver.summary}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Market Context */}
                {diagnosisData.marketContext && (
                  <div
                    style={{
                      padding: '1rem 1.15rem',
                      borderRadius: '12px',
                      background: 'rgba(59, 130, 246, 0.06)',
                      border: '1px solid rgba(59, 130, 246, 0.25)',
                      fontSize: '0.9rem',
                      lineHeight: 1.55,
                      color: 'var(--text-main)',
                    }}
                  >
                    <div style={{ fontWeight: 700, color: '#93c5fd', marginBottom: '0.3rem' }}>
                      🌐 מצב השוק הכללי בוול סטריט היום:
                    </div>
                    {diagnosisData.marketContext}
                  </div>
                )}

                {/* Bottom Line / Perspective */}
                {diagnosisData.bottomLine && (
                  <div
                    style={{
                      padding: '1rem 1.15rem',
                      borderRadius: '12px',
                      background: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      fontSize: '0.9rem',
                      lineHeight: 1.55,
                      color: 'var(--text-main)',
                    }}
                  >
                    <div style={{ fontWeight: 800, color: '#fbbf24', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span>💡 שורה תחתונה ופרספקטיבה למשקיע:</span>
                    </div>
                    {diagnosisData.bottomLine}
                  </div>
                )}

                {/* Action footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
                  <button
                    type="button"
                    onClick={handleRunPortfolioDiagnosis}
                    disabled={diagnosisLoading}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.5rem 1rem',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-main)',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <RefreshCw size={14} />
                    <span>רענן אבחון</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDiagnosisModalOpen(false)}
                    style={{
                      padding: '0.5rem 1.5rem',
                      borderRadius: '8px',
                      background: 'var(--accent-color)',
                      border: 'none',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                    }}
                  >
                    סגור
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Smart Rebalance & Capital Allocation Modal (איזון מחדש חכם) */}
      {rebalanceModalOpen && (
        <div className="modal-overlay" onClick={() => setRebalanceModalOpen(false)}>
          <div
            className="modal-content animate-fade-in"
            style={{
              maxHeight: '90vh',
              overflowY: 'auto',
              direction: 'rtl',
              maxWidth: '820px',
              width: '95%',
              border: '1px solid rgba(139, 92, 246, 0.45)',
              boxShadow: '0 20px 45px rgba(0, 0, 0, 0.5), 0 0 35px rgba(139, 92, 246, 0.18)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.22), rgba(59, 130, 246, 0.22))',
                      border: '1px solid rgba(139, 92, 246, 0.4)',
                      borderRadius: '10px',
                      padding: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#c4b5fd',
                    }}
                  >
                    <Scale size={24} />
                  </div>
                  <div>
                    <h2 className="modal-title" style={{ margin: 0, fontSize: '1.45rem' }}>
                      איזון מחדש חכם: חלוקת כסף חדש לתיק
                    </h2>
                    <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      הזן סכום שברצונך להפקיד, ו-Gemini ינתח את נתוני התיק, האפסייד והפיזור ויחלק עבורך את הסכום בצורה אופטימלית
                    </p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setRebalanceModalOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '0.45rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Input Box: Amount & Quick Chips */}
            <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid var(--border-color)', borderRadius: '14px', padding: '1.1rem', marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                כמה כסף ברצונך להפקיד לתיק עכשיו? ({CURRENCY_SYMBOLS[currency] || '$'})
              </label>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={rebalanceDepositAmount}
                  onChange={(e) => setRebalanceDepositAmount(e.target.value)}
                  placeholder="לדוגמה: 5000"
                  style={{
                    flex: 1,
                    padding: '0.75rem 1rem',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-color)',
                    color: 'var(--text-main)',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    direction: 'ltr',
                    textAlign: 'right',
                  }}
                />
                <span style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--accent-color)' }}>
                  {CURRENCY_SYMBOLS[currency] || '$'}
                </span>
              </div>

              {/* Quick Amount Chips */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>סכומים מהירים:</span>
                {[1000, 2500, 5000, 10000, 20000].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setRebalanceDepositAmount(String(val))}
                    style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: '9999px',
                      background: rebalanceDepositAmount === String(val) ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255, 255, 255, 0.06)',
                      border: rebalanceDepositAmount === String(val) ? '1px solid #a78bfa' : '1px solid var(--border-color)',
                      color: rebalanceDepositAmount === String(val) ? '#c4b5fd' : 'var(--text-main)',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {val.toLocaleString()} {CURRENCY_SYMBOLS[currency] || '$'}
                  </button>
                ))}
              </div>
            </div>

            {/* Strategy Selector Tabs */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                בחר אסטרטגיית חלוקה:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.65rem' }}>
                {[
                  { id: 'balanced', label: '⚖️ איזון ופיזור חכם', desc: 'מונע מניות ששוקלות יותר מדי ומאזן את התיק' },
                  { id: 'upside', label: '🚀 מקסום פוטנציאל עלייה', desc: 'מתמקד במניות עם הפער הגדול ביותר למחיר היעד' },
                  { id: 'defensive', label: '🛡️ הגנתי ותזרים', desc: 'עדיפות לחברות יציבות או מחלקות דיבידנד' },
                ].map(s => {
                  const isSelected = rebalanceStrategy === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setRebalanceStrategy(s.id as any)}
                      style={{
                        padding: '0.75rem 0.9rem',
                        borderRadius: '10px',
                        background: isSelected ? 'rgba(139, 92, 246, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                        border: isSelected ? '1px solid #8b5cf6' : '1px solid var(--border-color)',
                        textAlign: 'right',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: '0.92rem', color: isSelected ? '#c4b5fd' : 'var(--text-main)', marginBottom: '0.2rem' }}>
                        {s.label}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                        {s.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Run Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '1.25rem' }}>
              <button
                type="button"
                onClick={() => handleRunSmartRebalance()}
                disabled={rebalanceLoading || !rebalanceDepositAmount}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.55rem',
                  padding: '0.75rem 1.6rem',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #7c3aed, #2563eb)',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 800,
                  fontSize: '0.98rem',
                  cursor: rebalanceLoading ? 'not-allowed' : 'pointer',
                  opacity: rebalanceLoading ? 0.7 : 1,
                  boxShadow: '0 4px 18px rgba(124, 58, 237, 0.4)',
                  transition: 'all 0.2s',
                }}
              >
                {rebalanceLoading ? (
                  <>
                    <RefreshCw size={17} className="animate-spin" />
                    <span>Gemini מחשב חלוקה אופטימלית…</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={17} />
                    <span>חשב חלוקה חכמה עם Gemini</span>
                  </>
                )}
              </button>
            </div>

            {/* Error Message */}
            {rebalanceError && (
              <div
                style={{
                  padding: '1rem',
                  borderRadius: '10px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  marginBottom: '1.25rem',
                  textAlign: 'center',
                }}
              >
                {rebalanceError}
              </div>
            )}

            {/* Success Notification after applying */}
            {rebalanceAppliedSuccess && (
              <div
                style={{
                  padding: '1rem',
                  borderRadius: '10px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: '#34d399',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                }}
              >
                <CheckCircle2 size={20} />
                <span>ההפקדה חולקה ועודכנה בהצלחה בתיק המניות שלך!</span>
              </div>
            )}

            {/* Allocation Results */}
            {rebalanceData && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Headline */}
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(59, 130, 246, 0.18))',
                    border: '1px solid rgba(139, 92, 246, 0.35)',
                  }}
                >
                  <div style={{ fontSize: '0.82rem', color: '#c4b5fd', fontWeight: 600, marginBottom: '0.25rem' }}>
                    תוכנית החלוקה המומלצת:
                  </div>
                  <div style={{ fontSize: '1.18rem', fontWeight: 800, color: 'var(--text-main)', lineHeight: 1.35 }}>
                    {rebalanceData.headline}
                  </div>
                </div>

                {/* Strategy Rationale */}
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.94rem',
                    lineHeight: 1.6,
                    color: 'var(--text-main)',
                  }}
                >
                  <div style={{ fontWeight: 800, color: '#a78bfa', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Sparkles size={16} />
                    <span>ההיגיון הכלכלי מאחורי החלוקה:</span>
                  </div>
                  {rebalanceData.strategyRationale}
                </div>

                {/* Stock Allocation Cards */}
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '0.65rem', color: 'var(--text-main)' }}>
                    📊 חלוקת הכסף בין המניות בתיק:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {rebalanceData.allocations.map((alloc: any, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          padding: '1rem 1.15rem',
                          borderRadius: '12px',
                          background: 'rgba(139, 92, 246, 0.08)',
                          border: '1px solid rgba(139, 92, 246, 0.28)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.6rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <span
                              style={{
                                padding: '0.25rem 0.65rem',
                                borderRadius: '8px',
                                background: 'rgba(139, 92, 246, 0.25)',
                                color: '#c4b5fd',
                                fontWeight: 800,
                                fontSize: '0.98rem',
                              }}
                            >
                              {alloc.symbol}
                            </span>
                            <span style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                              ({alloc.percentageOfDeposit}% מההפקדה)
                            </span>
                          </div>

                          <div style={{ textAlign: 'left', direction: 'ltr' }}>
                            <span style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--profit-color)' }}>
                              {(alloc.allocatedAmount).toLocaleString()} {CURRENCY_SYMBOLS[currency] || '$'}
                            </span>
                            {alloc.sharesToBuy > 0 && (
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginRight: '0.45rem' }}>
                                (~{alloc.sharesToBuy} מניות)
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ fontSize: '0.88rem', color: 'var(--text-main)', lineHeight: 1.45 }}>
                          {alloc.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Skip List */}
                {Array.isArray(rebalanceData.skipList) && rebalanceData.skipList.length > 0 && (
                  <div
                    style={{
                      padding: '0.9rem 1.1rem',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>
                      מניות שדולגו בחלוקה זו (ומדוע):
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {rebalanceData.skipList.map((skip: any, idx: number) => (
                        <div key={idx} style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          <b style={{ color: 'var(--text-main)' }}>{skip.symbol}:</b> {skip.reason}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bottom line */}
                {rebalanceData.bottomLine && (
                  <div
                    style={{
                      padding: '1rem 1.15rem',
                      borderRadius: '12px',
                      background: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      fontSize: '0.9rem',
                      lineHeight: 1.55,
                      color: 'var(--text-main)',
                    }}
                  >
                    <div style={{ fontWeight: 800, color: 'var(--profit-color)', marginBottom: '0.25rem' }}>
                      💡 שורה תחתונה:
                    </div>
                    {rebalanceData.bottomLine}
                  </div>
                )}

                {/* Action Buttons */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={handleApplyRebalanceToPortfolio}
                    disabled={rebalanceAppliedSuccess}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.65rem 1.5rem',
                      borderRadius: '10px',
                      background: rebalanceAppliedSuccess ? 'rgba(16, 185, 129, 0.2)' : 'linear-gradient(135deg, #10b981, #059669)',
                      border: rebalanceAppliedSuccess ? '1px solid rgba(16, 185, 129, 0.4)' : 'none',
                      color: rebalanceAppliedSuccess ? '#34d399' : '#ffffff',
                      fontWeight: 800,
                      fontSize: '0.92rem',
                      cursor: rebalanceAppliedSuccess ? 'default' : 'pointer',
                      boxShadow: rebalanceAppliedSuccess ? 'none' : '0 4px 15px rgba(16, 185, 129, 0.3)',
                    }}
                  >
                    <CheckCircle2 size={18} />
                    <span>{rebalanceAppliedSuccess ? 'ההפקדה כבר הוחלה על התיק ✓' : 'החל הפקדה זו על התיק שלי 📥'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRebalanceModalOpen(false)}
                    style={{
                      padding: '0.5rem 1.4rem',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-main)',
                      fontWeight: 700,
                      fontSize: '0.88rem',
                      cursor: 'pointer',
                    }}
                  >
                    סגור
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stock Price History Chart Modal */}
      {chartStock && (
        <div className="modal-overlay" onClick={() => setChartStock(null)}>
          <div
            className="chart-modal-content animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'relative' }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <h2 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>{chartStock.symbol}</h2>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>{chartStock.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.35rem' }}>
                  <span style={{ fontSize: '1.35rem', fontWeight: 700 }}>
                    {money(chartStock.currentPrice || chartStock.buyPrice)}
                  </span>
                  {chartStock.dailyPercentChange !== undefined && (
                    <span
                      style={{
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        color: (chartStock.dailyChange || 0) >= 0 ? 'var(--profit-color)' : 'var(--loss-color)',
                        direction: 'ltr',
                      }}
                    >
                      {(chartStock.dailyChange || 0) >= 0 ? '+' : ''}
                      {chartStock.dailyPercentChange.toFixed(2)}% היום
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setChartStock(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Timeframe Selector */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '0.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {(['1d', '1w', '1m', '1y', '5y'] as const).map((r) => {
                  const labels: Record<string, string> = {
                    '1d': 'יום',
                    '1w': 'שבוע',
                    '1m': 'חודש',
                    '1y': 'שנה',
                    '5y': '5 שנים',
                  };
                  return (
                    <button
                      key={r}
                      onClick={() => handleRangeSelect(r)}
                      className={`timeframe-btn ${chartRange === r ? 'active' : ''}`}
                    >
                      {labels[r]}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{ width: '12px', height: '2px', background: 'var(--accent-color)', display: 'inline-block' }}></span>
                  מחיר מניה
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span style={{ width: '14px', height: '2px', background: '#3b82f6', borderTop: '2px dashed #3b82f6', display: 'inline-block' }}></span>
                  מחיר קנייה ({money(chartStock.buyPrice)})
                </span>
              </div>
            </div>

            {/* Chart Area */}
            {chartLoading ? (
              <div style={{ height: '260px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                <div className="loader" style={{ width: '28px', height: '28px' }}></div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>טוען נתוני היסטוריית מחיר…</span>
              </div>
            ) : chartError ? (
              <div style={{ height: '260px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: 'var(--loss-color)', textAlign: 'center' }}>
                <p>{chartError}</p>
                <button
                  onClick={() => fetchChart(chartStock.symbol, chartRange)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                >
                  נסה שוב
                </button>
              </div>
            ) : chartData && chartData.points && chartData.points.length > 1 ? (
              (() => {
                const rawPoints = Array.isArray(chartData.points) ? chartData.points : [];
                const points = rawPoints
                  .map((p: any) => {
                    const val = typeof p.price === 'number' && !isNaN(p.price) ? p.price : (typeof p.close === 'number' && !isNaN(p.close) ? p.close : null);
                    let timeStr = typeof p.time === 'string' ? p.time : '';
                    if (!timeStr && (p.timestamp || typeof p.time === 'number')) {
                      const d = new Date(p.timestamp || p.time);
                      timeStr = chartRange === '1d' ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
                    }
                    return {
                      time: timeStr,
                      timestamp: p.timestamp || (typeof p.time === 'number' ? p.time : 0),
                      price: val,
                    };
                  })
                  .filter((p: any) => p.price !== null && !isNaN(p.price)) as Array<{ time: string; timestamp: number; price: number }>;

                if (points.length < 2) {
                  return (
                    <div style={{ height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                      אין מספיק נתונים היסטוריים להצגת גרף למניה זו.
                    </div>
                  );
                }

                const prices = points.map(p => p.price);
                const buyPrice = chartStock.buyPrice;

                // Determine min & max price, including buyPrice so the line is visible
                const minRaw = Math.min(...prices, buyPrice);
                const maxRaw = Math.max(...prices, buyPrice);
                const spread = maxRaw - minRaw || 1;
                const minPrice = minRaw - spread * 0.08;
                const maxPrice = maxRaw + spread * 0.08;
                const priceRange = maxPrice - minPrice || 1;

                const svgWidth = 640;
                const svgHeight = 250;
                const padLeft = 10;
                const padRight = 10;
                const padTop = 15;
                const padBottom = 25;
                const plotW = svgWidth - padLeft - padRight;
                const plotH = svgHeight - padTop - padBottom;

                const getX = (i: number) => padLeft + (i / (points.length - 1)) * plotW;
                const getY = (price: number) => padTop + ((maxPrice - price) / priceRange) * plotH;

                // Path data
                const coords = points.map((p, i) => ({ x: getX(i), y: getY(p.price) }));
                const lineD = coords.reduce((acc, c, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)},${c.y.toFixed(1)}`, '');
                const areaD = `${lineD} L ${coords[coords.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)} L ${coords[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

                const buyY = getY(buyPrice);
                const isBuyInPlot = buyY >= padTop && buyY <= padTop + plotH;

                // Calculate where the buy price line should start on the X axis based on buyDate
                let buyStartX = padLeft;
                const buyTimestamp = chartStock.buyDate ? new Date(chartStock.buyDate).getTime() : null;
                if (buyTimestamp && !isNaN(buyTimestamp) && points.length > 1) {
                  const firstTs = points[0].timestamp;
                  const lastTs = points[points.length - 1].timestamp;

                  if (buyTimestamp >= lastTs) {
                    // Bought at the very end or today
                    buyStartX = padLeft + plotW - 10;
                  } else if (buyTimestamp > firstTs) {
                    // Find the closest point index or interpolate X
                    const foundIndex = points.findIndex(p => p.timestamp >= buyTimestamp);
                    if (foundIndex > 0) {
                      const prevPt = points[foundIndex - 1];
                      const nextPt = points[foundIndex];
                      const fraction = nextPt.timestamp > prevPt.timestamp 
                        ? (buyTimestamp - prevPt.timestamp) / (nextPt.timestamp - prevPt.timestamp)
                        : 0;
                      const prevX = getX(foundIndex - 1);
                      const nextX = getX(foundIndex);
                      buyStartX = prevX + fraction * (nextX - prevX);
                    } else if (foundIndex === 0) {
                      buyStartX = padLeft;
                    }
                  } else {
                    // Bought before the visible chart range - start line from left edge
                    buyStartX = padLeft;
                  }
                }

                // Period performance
                const firstPrice = points[0].price;
                const lastPrice = points[points.length - 1].price;
                const periodChange = lastPrice - firstPrice;
                const periodPercent = firstPrice > 0 ? (periodChange / firstPrice) * 100 : 0;
                const isPeriodPositive = periodChange >= 0;
                const lineColor = isPeriodPositive ? 'var(--profit-color)' : 'var(--loss-color)';
                const gradId = `chartGrad_${chartStock.symbol}_${chartRange}`;

                // Active hover point
                const activeIndex = chartHoverIndex !== null && chartHoverIndex >= 0 && chartHoverIndex < points.length ? chartHoverIndex : null;
                const activePoint = activeIndex !== null ? points[activeIndex] : null;
                const activeCoord = activeIndex !== null ? coords[activeIndex] : null;

                const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const clickX = e.clientX - rect.left;
                  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                  const index = Math.round(ratio * (points.length - 1));
                  setChartHoverIndex(index);
                };

                return (
                  <div>
                    {/* Hover Tooltip Readout Bar */}
                    <div style={{ height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', padding: '0 0.5rem' }}>
                      {activePoint && activeCoord ? (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--text-muted)' }}>{activePoint.time}</span>
                            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{money(activePoint.price)}</span>
                            {(() => {
                              const diffVsBuy = activePoint.price - buyPrice;
                              const diffVsBuyPct = (diffVsBuy / buyPrice) * 100;
                              const isProf = diffVsBuy >= 0;
                              return (
                                <span style={{ color: isProf ? 'var(--profit-color)' : 'var(--loss-color)', fontWeight: 600, fontSize: '0.8rem', direction: 'ltr' }}>
                                  ({isProf ? '+' : ''}{diffVsBuyPct.toFixed(2)}% מול קנייה)
                                </span>
                              );
                            })()}
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>החלק על הגרף לבדיקת נקודות</span>
                        </>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>שינוי בתקופה:</span>
                          <span style={{ color: lineColor, fontWeight: 700, direction: 'ltr' }}>
                            {isPeriodPositive ? '+' : ''}{periodPercent.toFixed(2)}% ({signedMoney(periodChange)})
                          </span>
                        </div>
                      )}
                    </div>

                    {/* SVG Chart */}
                    <div style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
                      <svg
                        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={() => setChartHoverIndex(null)}
                        onTouchMove={(e) => {
                          const touch = e.touches[0];
                          if (touch) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const clickX = touch.clientX - rect.left;
                            const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                            const index = Math.round(ratio * (points.length - 1));
                            setChartHoverIndex(index);
                          }
                        }}
                      >
                        <defs>
                          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={isPeriodPositive ? '#10b981' : '#ef4444'} stopOpacity="0.35" />
                            <stop offset="100%" stopColor={isPeriodPositive ? '#10b981' : '#ef4444'} stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* Background subtle grid lines */}
                        {[0.25, 0.5, 0.75].map((pct, i) => {
                          const y = padTop + pct * plotH;
                          return (
                            <line
                              key={i}
                              x1={padLeft}
                              y1={y}
                              x2={padLeft + plotW}
                              y2={y}
                              stroke="rgba(255, 255, 255, 0.05)"
                              strokeWidth="1"
                            />
                          );
                        })}

                        {/* Area Fill */}
                        <path d={areaD} fill={`url(#${gradId})`} />

                        {/* Price Line */}
                        <path
                          d={lineD}
                          fill="none"
                          stroke={lineColor}
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />

                        {/* Buy Price Dashed Line - starts strictly at buyStartX */}
                        {isBuyInPlot && (
                          <g>
                            <line
                              x1={buyStartX}
                              y1={buyY}
                              x2={padLeft + plotW}
                              y2={buyY}
                              stroke="#3b82f6"
                              strokeWidth="1.8"
                              strokeDasharray="5 5"
                              strokeOpacity="0.9"
                            />
                            {/* Dot marker at the buy date point */}
                            <circle
                              cx={buyStartX}
                              cy={buyY}
                              r="4.5"
                              fill="#3b82f6"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                            />
                          </g>
                        )}

                        {/* Active hover crosshair & dot */}
                        {activeCoord && activePoint && (
                          <g>
                            <line
                              x1={activeCoord.x}
                              y1={padTop}
                              x2={activeCoord.x}
                              y2={padTop + plotH}
                              stroke="rgba(255, 255, 255, 0.35)"
                              strokeWidth="1"
                              strokeDasharray="3 3"
                            />
                            <circle
                              cx={activeCoord.x}
                              cy={activeCoord.y}
                              r="5"
                              fill={lineColor}
                              stroke="#ffffff"
                              strokeWidth="2"
                            />
                          </g>
                        )}

                        {/* Date axis labels */}
                        <text x={padLeft} y={svgHeight - 6} fill="var(--text-muted)" fontSize="10">
                          {points[0].time}
                        </text>
                        <text x={padLeft + plotW / 2} y={svgHeight - 6} fill="var(--text-muted)" fontSize="10" textAnchor="middle">
                          {points[Math.floor(points.length / 2)].time}
                        </text>
                        <text x={padLeft + plotW} y={svgHeight - 6} fill="var(--text-muted)" fontSize="10" textAnchor="end">
                          {points[points.length - 1].time}
                        </text>
                      </svg>
                    </div>

                    {/* Stats summary tiles below chart */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginTop: '1.25rem' }}>
                      <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--border-color)' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>מחיר קנייה שלך</div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '0.2rem', color: '#60a5fa' }}>{money(buyPrice)}</div>
                      </div>

                      <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--border-color)' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>מחיר אחרון</div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '0.2rem' }}>{money(lastPrice)}</div>
                      </div>

                      {(() => {
                        const shares = chartStock.investedAmount / chartStock.buyPrice;
                        const currentVal = shares * (chartStock.currentPrice || lastPrice);
                        const totalPl = currentVal - chartStock.investedAmount;
                        const plPct = (totalPl / chartStock.investedAmount) * 100;
                        const isProf = totalPl >= 0;
                        return (
                          <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--border-color)' }}>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>רווח/הפסד שלך</div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 700, marginTop: '0.2rem', color: isProf ? 'var(--profit-color)' : 'var(--loss-color)', direction: 'ltr' }}>
                              {isProf ? '+' : ''}{plPct.toFixed(2)}% ({signedMoney(totalPl)})
                            </div>
                          </div>
                        );
                      })()}

                      <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--border-color)' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>טווח בתקופה</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginTop: '0.3rem', direction: 'ltr' }}>
                          {money(Math.min(...prices))} - {money(Math.max(...prices))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div style={{ height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                אין מספיק נתונים היסטוריים להצגת גרף למניה זו.
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setChartStock(null)}
                style={{ minWidth: '100px' }}
              >
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cloud Account Auth Modal (Register / Login) */}
      {authModalMode && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!authLoading) {
              setAuthModalMode(null);
              setAuthError(null);
            }
          }}
        >
          <div
            className="modal-content animate-fade-in"
            onClick={e => e.stopPropagation()}
            style={{ direction: 'rtl', maxWidth: '420px' }}
          >
            {/* Mode Tabs */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.4rem',
                background: 'var(--bg-secondary)',
                padding: '0.3rem',
                borderRadius: '0.75rem',
                marginBottom: '1.25rem',
                border: '1px solid var(--border-color)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setAuthModalMode('register');
                  setAuthError(null);
                }}
                style={{
                  padding: '0.5rem',
                  borderRadius: '0.55rem',
                  border: 'none',
                  background: authModalMode === 'register' ? 'var(--accent-color)' : 'transparent',
                  color: authModalMode === 'register' ? 'white' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                קבע קוד משתמש וסיסמה
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthModalMode('login');
                  setAuthError(null);
                }}
                style={{
                  padding: '0.5rem',
                  borderRadius: '0.55rem',
                  border: 'none',
                  background: authModalMode === 'login' ? 'var(--accent-color)' : 'transparent',
                  color: authModalMode === 'login' ? 'white' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                התחברות לחשבון קיים
              </button>
            </div>

            <h2 className="modal-title" style={{ textAlign: 'right', fontSize: '1.35rem', marginBottom: '0.35rem' }}>
              {authModalMode === 'register' ? 'קביעת קוד משתמש וסיסמה' : 'התחברות לחשבון שלך'}
            </h2>
            <p className="modal-subtitle" style={{ textAlign: 'right', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              {authModalMode === 'register'
                ? 'בחר קוד משתמש וסיסמה. התיק והתחזיות שלך יישמרו בענן ותוכל להיכנס מכל טלפון או מחשב.'
                : 'הזן את קוד המשתמש והסיסמה שקבעת כדי לטעון את התיק האישי שלך למכשיר זה.'}
            </p>

            {authError && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#f87171',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '0.65rem',
                  fontSize: '0.85rem',
                  marginBottom: '1rem',
                  textAlign: 'right',
                }}
              >
                {authError}
              </div>
            )}

            <form onSubmit={handleAuthSubmit}>
              <div className="form-group">
                <label className="form-label" style={{ textAlign: 'right', display: 'block' }}>
                  קוד משתמש / שם משתמש
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  className="form-input"
                  placeholder="למשל: ohad123"
                  value={authUsernameInput}
                  onChange={e => setAuthUsernameInput(e.target.value)}
                  style={{ direction: 'ltr', textAlign: 'left' }}
                />
              </div>

              <div className="form-group" style={{ marginTop: '1rem' }}>
                <label className="form-label" style={{ textAlign: 'right', display: 'block' }}>
                  סיסמה
                </label>
                <input
                  type="password"
                  required
                  minLength={3}
                  className="form-input"
                  placeholder="הזן סיסמה..."
                  value={authPasswordInput}
                  onChange={e => setAuthPasswordInput(e.target.value)}
                  style={{ direction: 'ltr', textAlign: 'left' }}
                />
              </div>

              <div className="modal-actions" style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={authLoading}
                  onClick={() => {
                    setAuthModalMode(null);
                    setAuthError(null);
                  }}
                >
                  ביטול
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={authLoading}
                  style={{ flex: 1 }}
                >
                  {authLoading
                    ? 'מתחבר לענן...'
                    : authModalMode === 'register'
                    ? 'שמור חשבון וסנכרן לענן'
                    : 'התחבר וטען את התיק שלי'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Top Forecast Finder Modal */}
      {topForecastModalOpen && (
        <div className="modal-overlay" onClick={() => setTopForecastModalOpen(false)}>
          <div
            className="modal-content animate-fade-in"
            style={{ maxHeight: '90vh', overflowY: 'auto', direction: 'rtl', maxWidth: '640px' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1.15rem', flexWrap: 'wrap' }}>
              <div>
                <h2 className="modal-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Sparkles size={22} color="#fbbf24" />
                  <span>המניה עם התחזית הכי גבוהה</span>
                </h2>
                <p className="modal-subtitle" style={{ margin: '0.3rem 0 0', fontSize: '0.84rem' }}>
                  סריקת AI חיה ב-TipRanks ו-StockAnalysis.com (לפי אחוז עלייה צפוי מהמחיר הנוכחי)
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleFindTopForecast(true)}
                disabled={topForecastLoading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid var(--accent-color)',
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: 'var(--accent-color)',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: topForecastLoading ? 'not-allowed' : 'pointer',
                  opacity: topForecastLoading ? 0.6 : 1,
                }}
              >
                <RefreshCw size={14} className={topForecastLoading ? 'animate-spin' : ''} />
                <span>{topForecastLoading ? 'סורק כעת...' : 'חפש שוב'}</span>
              </button>
            </div>

            {topForecastLoading && (
              <div style={{ textAlign: 'center', padding: '2.25rem 1rem' }}>
                <div className="loader" style={{ margin: '0 auto 1rem' }}></div>
                <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.35rem' }}>
                  Gemini מחפש כעת ב-TipRanks וב-StockAnalysis...
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  בודק לאיזו מניה יש את תחזית האנליסטים הגבוהה ביותר מול המחיר החי שלה כרגע
                </div>
              </div>
            )}

            {topForecastError && !topForecastLoading && (
              <div
                style={{
                  background: 'var(--loss-bg)',
                  color: 'var(--loss-color)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  padding: '1rem',
                  borderRadius: '0.75rem',
                  textAlign: 'center',
                  marginBottom: '1rem',
                }}
              >
                {topForecastError}
              </div>
            )}

            {!topForecastLoading && topForecastData?.topStock && (() => {
              const top = topForecastData.topStock;
              const others: any[] = Array.isArray(topForecastData.stocks) ? topForecastData.stocks.slice(1) : [];

              return (
                <div>
                  {/* #1 Winner Highlight Card */}
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(245, 158, 11, 0.12))',
                      border: '2px solid rgba(16, 185, 129, 0.5)',
                      borderRadius: '1.1rem',
                      padding: '1.35rem',
                      marginBottom: '1.35rem',
                      boxShadow: '0 8px 28px rgba(16, 185, 129, 0.15)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <span
                        style={{
                          background: 'rgba(245, 158, 11, 0.22)',
                          border: '1px solid rgba(245, 158, 11, 0.5)',
                          color: '#fbbf24',
                          fontSize: '0.78rem',
                          fontWeight: 800,
                          padding: '0.2rem 0.65rem',
                          borderRadius: '9999px',
                        }}
                      >
                        🏆 מקום #1 – התחזית הגבוהה ביותר
                      </span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--profit-color)', fontWeight: 700 }}>
                        {top.consensusRating} ({top.analystCount} אנליסטים)
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
                      <div>
                        <div style={{ fontSize: '1.75rem', fontWeight: 800, letterSpacing: '0.02em', color: 'var(--text-main)' }}>
                          {top.symbol}
                        </div>
                        <div style={{ fontSize: '0.95rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                          {top.name}
                        </div>
                      </div>

                      <div style={{ textAlign: 'left', direction: 'ltr' }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'right', direction: 'rtl' }}>
                          צפי עלייה מהמחיר הנוכחי:
                        </div>
                        <div
                          style={{
                            fontSize: '2.35rem',
                            fontWeight: 900,
                            color: 'var(--profit-color)',
                            lineHeight: 1.1,
                          }}
                        >
                          +{top.upsidePercent.toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: '1.25rem',
                        flexWrap: 'wrap',
                        marginTop: '0.9rem',
                        paddingTop: '0.75rem',
                        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                        fontSize: '0.88rem',
                      }}
                    >
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>מחיר נוכחי חי: </span>
                        <b style={{ direction: 'ltr', display: 'inline-block' }}>{money(top.currentPrice)}</b>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>מחיר יעד ממוצע: </span>
                        <b style={{ color: 'var(--profit-color)', direction: 'ltr', display: 'inline-block' }}>
                          {money(top.averagePriceTarget)}
                        </b>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>אנליסטים שנמצאו: </span>
                        <b style={{ color: 'var(--accent-color)' }}>{top.analystCount} אנליסטים מדרגים</b>
                      </div>
                    </div>

                    {/* Company Specialization */}
                    {top.specializationHe && (
                      <div
                        style={{
                          marginTop: '0.85rem',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '0.65rem',
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          fontSize: '0.86rem',
                          lineHeight: 1.55,
                        }}
                      >
                        <span style={{ color: '#60a5fa', fontWeight: 700, marginLeft: '0.35rem' }}>
                          🏢 במה החברה מתמחה:
                        </span>
                        <span style={{ color: 'var(--text-main)' }}>{top.specializationHe}</span>
                      </div>
                    )}

                    {/* Why Analysts Forecast It To Surge */}
                    {(top.analystRationaleHe || top.reasonHe) && (
                      <div
                        style={{
                          marginTop: '0.6rem',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '0.65rem',
                          background: 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                          fontSize: '0.86rem',
                          lineHeight: 1.55,
                        }}
                      >
                        <span style={{ color: 'var(--profit-color)', fontWeight: 700, marginLeft: '0.35rem' }}>
                          📈 למה האנליסטים צופים עלייה חדה:
                        </span>
                        <span style={{ color: 'var(--text-main)' }}>
                          {top.analystRationaleHe || top.reasonHe}
                        </span>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.65rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setTopForecastModalOpen(false);
                          openAnalysis({ symbol: top.symbol, currentPrice: top.currentPrice }, true);
                        }}
                        style={{
                          flex: 1,
                          padding: '0.55rem 0.9rem',
                          borderRadius: '0.65rem',
                          border: '1px solid rgba(147, 51, 234, 0.45)',
                          background: 'rgba(147, 51, 234, 0.16)',
                          color: '#d8b4fe',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                        }}
                      >
                        🔍 פתח ניתוח אנליסטים מלא
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTopForecastModalOpen(false);
                          handleSelectStock({ symbol: top.symbol, shortname: top.name });
                        }}
                        style={{
                          flex: 1,
                          padding: '0.55rem 0.9rem',
                          borderRadius: '0.65rem',
                          border: '1px solid rgba(16, 185, 129, 0.45)',
                          background: 'rgba(16, 185, 129, 0.18)',
                          color: '#34d399',
                          fontWeight: 700,
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                        }}
                      >
                        + הוסף מניה לתיק שלי
                      </button>
                    </div>
                  </div>

                  {/* Additional High-Upside Stocks */}
                  {others.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
                        מניות בולטות נוספות עם תחזיות עלייה גבוהות:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                        {others.map((st: any, i: number) => (
                          <div
                            key={st.symbol}
                            style={{
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '0.8rem',
                              padding: '0.75rem 0.95rem',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '0.6rem',
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>
                                  #{i + 2}
                                </span>
                                <span style={{ fontWeight: 800, fontSize: '1rem' }}>{st.symbol}</span>
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{st.name}</span>
                              </div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                                מחיר כעת: <b style={{ color: 'var(--text-main)' }}>{money(st.currentPrice)}</b> · יעד:{' '}
                                <b style={{ color: 'var(--profit-color)' }}>{money(st.averagePriceTarget)}</b> ·{' '}
                                <b style={{ color: 'var(--accent-color)' }}>{st.analystCount} אנליסטים שנמצאו</b>
                              </div>
                              {(st.specializationHe || st.analystRationaleHe) && (
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.35rem', lineHeight: 1.45, maxWidth: '520px' }}>
                                  {st.specializationHe && (
                                    <div>
                                      <b style={{ color: '#60a5fa' }}>התמחות: </b>{st.specializationHe}
                                    </div>
                                  )}
                                  {st.analystRationaleHe && (
                                    <div style={{ marginTop: '0.15rem' }}>
                                      <b style={{ color: 'var(--profit-color)' }}>למה צפויה לעלות: </b>{st.analystRationaleHe}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span
                                style={{
                                  fontWeight: 800,
                                  fontSize: '1.1rem',
                                  color: 'var(--profit-color)',
                                  direction: 'ltr',
                                }}
                              >
                                +{st.upsidePercent.toFixed(1)}%
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setTopForecastModalOpen(false);
                                  openAnalysis({ symbol: st.symbol, currentPrice: st.currentPrice }, true);
                                }}
                                style={{
                                  padding: '0.32rem 0.6rem',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(147, 51, 234, 0.4)',
                                  background: 'rgba(147, 51, 234, 0.14)',
                                  color: '#d8b4fe',
                                  fontSize: '0.78rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                ניתוח
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setTopForecastModalOpen(false);
                                  handleSelectStock({ symbol: st.symbol, shortname: st.name });
                                }}
                                style={{
                                  padding: '0.32rem 0.65rem',
                                  borderRadius: '6px',
                                  border: '1px solid rgba(59, 130, 246, 0.4)',
                                  background: 'rgba(59, 130, 246, 0.14)',
                                  color: 'var(--accent-color)',
                                  fontSize: '0.78rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                + הוסף
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="modal-actions" style={{ marginTop: '1.35rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setTopForecastModalOpen(false)}
              >
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      <footer
        style={{
          marginTop: '3.5rem',
          paddingTop: '1.25rem',
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          textAlign: 'center',
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
          opacity: 0.65,
        }}
      >
        top stock · <strong>top stock2676</strong> — מעקב מניות ותחזיות אנליסטים בזמן אמת
      </footer>

      {/* Watchlist Toast Notification */}
      {watchlistToast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(10px)',
            border: '1px solid #fbbf24',
            borderRadius: '12px',
            padding: '0.85rem 1.4rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.85rem',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
            color: '#ffffff',
            fontSize: '0.9rem',
            direction: 'rtl',
          }}
        >
          <Bookmark size={18} color="#fbbf24" fill="#fbbf24" />
          <span>{watchlistToast.message}</span>
          <Link
            href="/watchlist"
            style={{
              background: 'rgba(245, 158, 11, 0.2)',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              color: '#fbbf24',
              borderRadius: '8px',
              padding: '0.35rem 0.75rem',
              fontSize: '0.82rem',
              fontWeight: 700,
              textDecoration: 'none',
              marginRight: '0.5rem',
            }}
          >
            לדף המעקב 👁️
          </Link>
        </div>
      )}
    </div>
  );
}
