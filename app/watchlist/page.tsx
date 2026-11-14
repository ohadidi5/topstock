"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Bookmark, Trash2, LineChart, Sparkles, Search, TrendingUp, TrendingDown,
  Eye, RefreshCw, Plus, X, ArrowRight, ShieldCheck, CheckCircle2, ChevronRight
} from 'lucide-react';

interface WatchlistStock {
  symbol: string;
  name: string;
  currentPrice?: number;
  dailyChange?: number;
  dailyPercentChange?: number;
  targetPrice?: number;
  targetRating?: string;
  targetForecastPercent?: number;
  targetDate?: string;
  addedAt?: string;
}

interface Stock {
  symbol: string;
  name: string;
  buyPrice: number;
  investedAmount: number;
  currentPrice?: number;
  dailyChange?: number;
  dailyPercentChange?: number;
  buyDate?: string;
}

type Currency = 'USD' | 'ILS' | 'EUR';

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<WatchlistStock[]>([]);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1, ILS: 3.7, EUR: 0.92 });
  const [isLoadingQuotes, setIsLoadingQuotes] = useState(false);
  const [accountUser, setAccountUser] = useState<{ username: string; password?: string } | null>(null);

  // Search in Watchlist Page
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Buy / Add to Portfolio Modal
  const [stockToBuy, setStockToBuy] = useState<WatchlistStock | null>(null);
  const [investedInput, setInvestedInput] = useState('');
  const [buyPriceInput, setBuyPriceInput] = useState('');

  // Interactive Chart Modal state
  const [chartStock, setChartStock] = useState<WatchlistStock | null>(null);
  const [chartRange, setChartRange] = useState<'1d' | '1w' | '1m' | '1y' | '5y'>('1m');
  const [chartData, setChartData] = useState<any | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartHoverIndex, setChartHoverIndex] = useState<number | null>(null);

  // Analysis modal state
  const [analysisSymbol, setAnalysisSymbol] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<Record<string, any>>({});
  const [analysisLoading, setAnalysisLoading] = useState<Record<string, boolean>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>({});

  // Currency rate
  const rate = rates[currency] || 1;
  const currencySymbol = currency === 'ILS' ? '₪' : currency === 'EUR' ? '€' : '$';

  const money = (usdVal: number | undefined | null) => {
    if (usdVal === undefined || usdVal === null || isNaN(usdVal)) return '—';
    const val = usdVal * rate;
    return `${currencySymbol}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const signedMoney = (usdVal: number | undefined | null) => {
    if (usdVal === undefined || usdVal === null || isNaN(usdVal)) return '—';
    const val = usdVal * rate;
    const sign = val >= 0 ? '+' : '';
    return `${sign}${currencySymbol}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Merge helper for watchlist CRDT consistency
  const mergeWatchlistData = (
    listA: WatchlistStock[] = [],
    listB: WatchlistStock[] = [],
    deletedMapA: Record<string, number> = {},
    deletedMapB: Record<string, number> = {}
  ): { mergedList: WatchlistStock[]; mergedDeleted: Record<string, number> } => {
    const mergedDeleted: Record<string, number> = { ...(deletedMapA || {}) };
    if (deletedMapB && typeof deletedMapB === 'object') {
      for (const [sym, ts] of Object.entries(deletedMapB)) {
        mergedDeleted[sym] = Math.max(mergedDeleted[sym] || 0, typeof ts === 'number' ? ts : 0);
      }
    }

    const itemsBySymbol = new Map<string, WatchlistStock>();
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

    const mergedList: WatchlistStock[] = [];
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
  };

  // 1. Initial Load
  useEffect(() => {
    let localWatchlist: WatchlistStock[] = [];
    const savedWatchlist = localStorage.getItem('stockWatchlist');
    if (savedWatchlist) {
      try {
        const parsed = JSON.parse(savedWatchlist);
        if (Array.isArray(parsed)) {
          localWatchlist = parsed;
          setWatchlist(parsed);
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

    const savedCurrency = localStorage.getItem('currency') as Currency | null;
    if (savedCurrency && ['ILS', 'USD', 'EUR'].includes(savedCurrency)) {
      setCurrency(savedCurrency);
    }

    const savedAnalyses = localStorage.getItem('stockAnalyses');
    if (savedAnalyses) {
      try {
        setAnalysisResults(JSON.parse(savedAnalyses));
      } catch (e) {}
    }

    const savedAuth = localStorage.getItem('nexusUserAccount');
    if (savedAuth) {
      try {
        const parsedAuth = JSON.parse(savedAuth);
        if (parsedAuth?.username && parsedAuth?.password) {
          setAccountUser(parsedAuth);
          const localUpdatedAt = parseInt(localStorage.getItem('stockWatchlistUpdatedAt') || '0', 10);
          // Restore from cloud
          fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'restore',
              username: parsedAuth.username,
              password: parsedAuth.password,
              watchlist: localWatchlist,
              watchlistDeleted: localDeleted,
              watchlistUpdatedAt: localUpdatedAt,
            }),
          })
            .then(r => r.json())
            .then(data => {
              if (data?.success && Array.isArray(data.watchlist)) {
                let currentLocal: WatchlistStock[] = [];
                try {
                  const stored = localStorage.getItem('stockWatchlist');
                  if (stored) currentLocal = JSON.parse(stored);
                } catch (e) {}
                let currentLocalDeleted: Record<string, number> = {};
                try {
                  const storedD = localStorage.getItem('stockWatchlistDeleted');
                  if (storedD) currentLocalDeleted = JSON.parse(storedD);
                } catch (e) {}

                // Conflict-free CRDT merge: never loses newly added stocks and honors explicit removals
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
            })
            .catch(err => console.error('Watchlist sync error:', err));
        }
      } catch (e) {}
    }

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

    // Rates
    fetch('/api/rates')
      .then(res => res.json())
      .then(data => {
        if (data?.rates) setRates(data.rates);
      })
      .catch(e => console.error(e));

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // 2. Fetch live quotes for watchlist
  const fetchQuotes = async () => {
    if (watchlist.length === 0) return;
    setIsLoadingQuotes(true);
    try {
      const symbols = watchlist.map(s => s.symbol).join(',');
      const res = await fetch(`/api/quotes?symbols=${symbols}`);
      const data = await res.json();
      if (data?.quotes) {
        setWatchlist(prev => {
          const updated = prev.map(item => {
            const quote = data.quotes[item.symbol];
            return {
              ...item,
              currentPrice: quote?.regularMarketPrice || item.currentPrice,
              dailyChange: quote?.regularMarketChange || item.dailyChange,
              dailyPercentChange: quote?.regularMarketChangePercent || item.dailyPercentChange,
            };
          });
          try {
            localStorage.setItem('stockWatchlist', JSON.stringify(updated));
          } catch (e) {}
          return updated;
        });
      }
    } catch (err) {
      console.error('Failed to fetch watchlist quotes:', err);
    } finally {
      setIsLoadingQuotes(false);
    }
  };

  useEffect(() => {
    if (watchlist.length > 0) {
      fetchQuotes();
      const interval = setInterval(fetchQuotes, 60000);
      return () => clearInterval(interval);
    }
  }, [watchlist.length]);

  // Sync helper
  const syncWatchlistToCloud = (
    updatedList: WatchlistStock[],
    updatedDeleted?: Record<string, number>,
    timestamp?: number,
    credsOverride?: { username: string; password: string }
  ) => {
    const creds = credsOverride || accountUser;
    if (!creds?.username || !creds?.password) return;
    const ts = timestamp || Date.now();
    let delMap = updatedDeleted;
    if (!delMap) {
      try {
        delMap = JSON.parse(localStorage.getItem('stockWatchlistDeleted') || '{}');
      } catch (e) {
        delMap = {};
      }
    }
    fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sync',
        username: creds.username,
        password: creds.password,
        watchlist: updatedList,
        watchlistDeleted: delMap,
        watchlistUpdatedAt: ts,
      }),
    }).catch(e => console.error('Sync failed:', e));
  };

  // Add / Remove from Watchlist
  const handleRemoveFromWatchlist = (symbol: string) => {
    const now = Date.now();
    const updated = watchlist.filter(s => s.symbol !== symbol);

    let delMap: Record<string, number> = {};
    try {
      delMap = JSON.parse(localStorage.getItem('stockWatchlistDeleted') || '{}');
    } catch (e) {}
    delMap[symbol] = now;

    setWatchlist(updated);
    localStorage.setItem('stockWatchlist', JSON.stringify(updated));
    localStorage.setItem('stockWatchlistDeleted', JSON.stringify(delMap));
    localStorage.setItem('stockWatchlistUpdatedAt', String(now));
    syncWatchlistToCloud(updated, delMap, now);
  };

  const handleAddToWatchlist = (stock: { symbol: string; name?: string; shortname?: string; longname?: string }) => {
    if (watchlist.some(s => s.symbol === stock.symbol)) return;
    const now = Date.now();
    const newItem: WatchlistStock = {
      symbol: stock.symbol,
      name: stock.name || stock.shortname || stock.longname || stock.symbol,
      addedAt: new Date(now).toISOString(),
    };
    const updated = [newItem, ...watchlist];

    let delMap: Record<string, number> = {};
    try {
      delMap = JSON.parse(localStorage.getItem('stockWatchlistDeleted') || '{}');
    } catch (e) {}
    delete delMap[stock.symbol];

    setWatchlist(updated);
    localStorage.setItem('stockWatchlist', JSON.stringify(updated));
    localStorage.setItem('stockWatchlistDeleted', JSON.stringify(delMap));
    localStorage.setItem('stockWatchlistUpdatedAt', String(now));
    syncWatchlistToCloud(updated, delMap, now);
    setSearchQuery('');
    setSearchResults([]);
    fetchQuotes();
  };

  // Search logic
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
    setIsSearchFocused(false);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (searchInputRef.current) searchInputRef.current.blur();
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    setIsSearchFocused(true);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setSearchResults(data.quotes || []);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    }, 450);
  };

  // Chart
  const openChart = (stock: WatchlistStock) => {
    setChartStock(stock);
    setChartHoverIndex(null);
    fetchChartData(stock.symbol, chartRange);
  };

  const fetchChartData = async (symbol: string, range: string) => {
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
    } catch {
      setChartError('שגיאת תקשורת בטעינת נתוני הגרף.');
    } finally {
      setChartLoading(false);
    }
  };

  const handleRangeChange = (r: '1d' | '1w' | '1m' | '1y' | '5y') => {
    setChartRange(r);
    if (chartStock) {
      fetchChartData(chartStock.symbol, r);
    }
  };

  // Analysis
  const openAnalysis = async (symbol: string) => {
    setAnalysisSymbol(symbol);
    if (analysisResults[symbol]) return;
    setAnalysisLoading(prev => ({ ...prev, [symbol]: true }));
    try {
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAnalysisErrors(prev => ({ ...prev, [symbol]: data.error || 'שגיאה בניתוח.' }));
      } else {
        setAnalysisResults(prev => {
          const updated = { ...prev, [symbol]: data };
          localStorage.setItem('stockAnalyses', JSON.stringify(updated));
          return updated;
        });
      }
    } catch {
      setAnalysisErrors(prev => ({ ...prev, [symbol]: 'שגיאת תקשורת.' }));
    } finally {
      setAnalysisLoading(prev => ({ ...prev, [symbol]: false }));
    }
  };

  // Buy to portfolio
  const openBuyModal = (stock: WatchlistStock) => {
    setStockToBuy(stock);
    setInvestedInput('');
    setBuyPriceInput(stock.currentPrice ? (stock.currentPrice * rate).toFixed(2) : '');
  };

  const handleBuySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockToBuy || !investedInput || !buyPriceInput) return;

    try {
      const savedPortfolio = localStorage.getItem('stockPortfolio');
      const portfolio: Stock[] = savedPortfolio ? JSON.parse(savedPortfolio) : [];
      const newStock: Stock = {
        symbol: stockToBuy.symbol,
        name: stockToBuy.name,
        buyPrice: parseFloat(buyPriceInput) / rate,
        investedAmount: parseFloat(investedInput) / rate,
        currentPrice: stockToBuy.currentPrice,
        dailyChange: stockToBuy.dailyChange,
        dailyPercentChange: stockToBuy.dailyPercentChange,
        buyDate: new Date().toISOString(),
      };
      const updatedPortfolio = [...portfolio, newStock];
      localStorage.setItem('stockPortfolio', JSON.stringify(updatedPortfolio));

      // Sync to cloud if user is logged in
      if (accountUser?.username && accountUser?.password) {
        fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sync',
            username: accountUser.username,
            password: accountUser.password,
            portfolio: updatedPortfolio,
          }),
        }).catch(console.error);
      }

      alert(`מניית ${stockToBuy.symbol} נוספה בהצלחה לתיק ההשקעות שלך!`);
      setStockToBuy(null);
    } catch (err) {
      console.error(err);
    }
  };

  // Stats
  const risingCount = watchlist.filter(s => (s.dailyChange || 0) > 0).length;
  const fallingCount = watchlist.filter(s => (s.dailyChange || 0) < 0).length;

  return (
    <div className="container">
      {/* Header - Identical layout to main page */}
      <header className="header" style={{ flexWrap: 'wrap', gap: '0.75rem', marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', textDecoration: 'none' }}>
            <img
              src="/icon-192.png"
              alt="top stock"
              style={{ width: '38px', height: '38px', borderRadius: '10px', objectFit: 'cover', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)' }}
            />
            <h1 className="header-title" style={{ margin: 0 }}>top stock</h1>
          </Link>
        </div>

        {/* Navigation Tabs - Fixed position & order matching main page */}
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
          <Link
            href="/"
            style={{
              padding: '0.45rem 1rem',
              borderRadius: '9999px',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: 'var(--text-muted)',
              textDecoration: 'none',
              transition: 'all 0.2s',
            }}
          >
            💼 התיק שלי
          </Link>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.45rem 1.1rem',
              borderRadius: '9999px',
              fontSize: '0.85rem',
              fontWeight: 700,
              background: 'var(--accent-color)',
              color: '#ffffff',
              boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)',
            }}
          >
            <Bookmark size={14} fill="#ffffff" />
            <span>רשימת מעקב ({watchlist.length})</span>
          </div>
        </div>

        {/* Back to Portfolio Button on right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Link
            href="/"
            className="btn btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.85rem',
              padding: '0.45rem 0.9rem',
              borderRadius: '9999px',
              textDecoration: 'none',
            }}
          >
            <ArrowRight size={15} />
            <span>חזרה לתיק</span>
          </Link>
        </div>
      </header>

      {/* Page Title & Subtitle */}
      <div style={{ marginBottom: '1.75rem', direction: 'rtl', textAlign: 'right' }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '0 0 0.35rem 0' }}>👁️ רשימת מעקב</h2>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          עקוב אחרי מניות שמעניינות אותך וגלה כמה הן עולות או יורדות היום
        </p>
      </div>

      {/* Top Banner & Quick Controls */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'rgba(59, 130, 246, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-color)',
            }}
          >
            <Bookmark size={22} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>מניות במעקב</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{watchlist.length}</div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--profit-color)',
            }}
          >
            <TrendingUp size={22} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>עולות היום</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--profit-color)' }}>
              {risingCount} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>מניות</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: '46px',
              height: '46px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--loss-color)',
            }}
          >
            <TrendingDown size={22} />
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>יורדות היום</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--loss-color)' }}>
              {fallingCount} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>מניות</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>רענון נתונים</div>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '0.2rem' }}>
              מתעדכן אוטומטית
            </div>
          </div>
          <button
            onClick={fetchQuotes}
            disabled={isLoadingQuotes}
            className="btn btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.55rem 0.85rem',
              fontSize: '0.85rem',
              borderRadius: '0.65rem',
            }}
          >
            <RefreshCw size={14} className={isLoadingQuotes ? 'animate-spin' : ''} />
            <span>רענן עכשיו</span>
          </button>
        </div>
      </div>

      {/* Search Bar on Watchlist Page */}
      <div className="search-container" style={{ marginBottom: '2rem' }}>
        <div className="search-input-wrapper">
          <Search className="search-icon" size={20} />
          <input
            ref={searchInputRef}
            type="text"
            className="input search-input"
            placeholder="חפש מניה להוספה לרשימת המעקב (למשל: NVDA, AAPL, TSLA)..."
            value={searchQuery}
            onChange={handleSearch}
            onFocus={() => setIsSearchFocused(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') handleClearSearch();
            }}
            style={{ paddingRight: (searchQuery || isSearchFocused || searchResults.length > 0) ? '3rem' : '1rem' }}
          />
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
              searchResults.map((result, i) => {
                const isAlready = watchlist.some(w => w.symbol === result.symbol);
                return (
                  <div
                    key={i}
                    className="search-result-item"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
                      <span className="search-result-symbol">{result.symbol}</span>
                      <span className="search-result-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {result.shortname || result.longname}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleAddToWatchlist(result)}
                      disabled={isAlready}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.45rem 0.85rem',
                        borderRadius: '8px',
                        border: isAlready ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(245, 158, 11, 0.5)',
                        background: isAlready ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.18)',
                        color: isAlready ? '#34d399' : '#fbbf24',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: isAlready ? 'default' : 'pointer',
                      }}
                    >
                      {isAlready ? (
                        <>
                          <CheckCircle2 size={14} />
                          <span>כבר במעקב</span>
                        </>
                      ) : (
                        <>
                          <Plus size={14} />
                          <span>הוסף למעקב</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Main Watchlist Items */}
      {watchlist.length === 0 ? (
        <div
          className="card"
          style={{
            padding: '3.5rem 1.5rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(245, 158, 11, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fbbf24',
            }}
          >
            <Eye size={32} />
          </div>
          <h2 style={{ fontSize: '1.4rem', margin: 0 }}>רשימת המעקב שלך ריקה</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: '420px', fontSize: '0.95rem' }}>
            חפש מניות בשורת החיפוש למעלה והקלק על <b>"הוסף למעקב"</b> כדי לעקוב כאן בזמן אמת כמה הן עולות או יורדות היום!
          </p>

          <div style={{ marginTop: '1rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.6rem' }}>
              מניות פופולריות להוספה מהירה בלחיצה אחת:
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {[
                { symbol: 'NVDA', name: 'NVIDIA Corp' },
                { symbol: 'AAPL', name: 'Apple Inc' },
                { symbol: 'TSLA', name: 'Tesla Inc' },
                { symbol: 'MSFT', name: 'Microsoft' },
                { symbol: 'AMZN', name: 'Amazon.com' },
                { symbol: 'GOOGL', name: 'Alphabet Inc' },
              ].map(stock => (
                <button
                  key={stock.symbol}
                  onClick={() => handleAddToWatchlist(stock)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.45rem 0.8rem',
                    borderRadius: '9999px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={13} color="var(--accent-color)" />
                  <span>{stock.symbol}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {watchlist.map(stock => {
            const isPositive = (stock.dailyChange || 0) >= 0;
            const changeColor = isPositive ? 'var(--profit-color)' : 'var(--loss-color)';
            const analysis = analysisResults[stock.symbol];

            return (
              <div
                key={stock.symbol}
                className="card animate-fade-in"
                style={{
                  padding: '1.25rem 1.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  borderRight: `4px solid ${changeColor}`,
                }}
              >
                {/* Symbol & Name */}
                <div style={{ minWidth: '160px', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.5px' }}>
                      {stock.symbol}
                    </span>
                    {analysis?.consensus?.rating && (
                      <span
                        style={{
                          fontSize: '0.75rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '9999px',
                          background: 'rgba(59, 130, 246, 0.15)',
                          border: '1px solid rgba(59, 130, 246, 0.35)',
                          color: 'var(--accent-color)',
                          fontWeight: 600,
                        }}
                      >
                        {analysis.consensus.rating}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '280px',
                    }}
                  >
                    {stock.name}
                  </div>
                </div>

                {/* Price & Daily Change */}
                <div style={{ textAlign: 'left', minWidth: '150px', direction: 'ltr' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                    {money(stock.currentPrice)}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      color: changeColor,
                      marginTop: '0.1rem',
                    }}
                  >
                    {isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    <span>
                      {isPositive ? '+' : ''}
                      {(stock.dailyPercentChange || 0).toFixed(2)}%
                    </span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.85, fontWeight: 500 }}>
                      ({signedMoney(stock.dailyChange)})
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {/* Price Chart */}
                  <button
                    onClick={() => openChart(stock)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.5rem 0.85rem',
                      borderRadius: '0.65rem',
                      border: '1px solid rgba(59, 130, 246, 0.35)',
                      background: 'rgba(59, 130, 246, 0.12)',
                      color: 'var(--accent-color)',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="הצג גרף מחיר היסטורי"
                  >
                    <LineChart size={15} />
                    <span>גרף</span>
                  </button>

                  {/* Gemini Analysis */}
                  <button
                    onClick={() => openAnalysis(stock.symbol)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.5rem 0.85rem',
                      borderRadius: '0.65rem',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      background: 'rgba(16, 185, 129, 0.12)',
                      color: 'var(--profit-color)',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="ניתוח תחזיות אנליסטים מ-TipRanks ו-StockAnalysis"
                  >
                    <Sparkles size={15} />
                    <span>ניתוח</span>
                  </button>

                  {/* Add to Portfolio */}
                  <button
                    onClick={() => openBuyModal(stock)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.5rem 0.85rem',
                      borderRadius: '0.65rem',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      background: 'rgba(245, 158, 11, 0.14)',
                      color: '#fbbf24',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                    title="הוסף מניה זו לתיק ההשקעות שלך"
                  >
                    <Plus size={15} />
                    <span>קנה לתיק</span>
                  </button>

                  {/* Remove from Watchlist */}
                  <button
                    onClick={() => handleRemoveFromWatchlist(stock.symbol)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#f87171',
                      cursor: 'pointer',
                    }}
                    title="הסר מרשימת מעקב"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Buy to Portfolio Modal */}
      {stockToBuy && (
        <div className="modal-overlay" onClick={() => setStockToBuy(null)}>
          <div className="modal-content animate-fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px', direction: 'rtl' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h2 className="modal-title" style={{ margin: 0, fontSize: '1.3rem' }}>
                  הוסף את {stockToBuy.symbol} לתיק
                </h2>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{stockToBuy.name}</span>
              </div>
              <button
                onClick={() => setStockToBuy(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleBuySubmit}>
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="form-label">סכום השקעה כולל ({currencySymbol})</label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="למשל 1000"
                  className="form-input"
                  value={investedInput}
                  onChange={e => setInvestedInput(e.target.value)}
                  style={{ direction: 'ltr' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">מחיר קנייה למניה ({currencySymbol})</label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="מחיר מניה"
                  className="form-input"
                  value={buyPriceInput}
                  onChange={e => setBuyPriceInput(e.target.value)}
                  style={{ direction: 'ltr' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1, padding: '0.75rem', fontWeight: 700 }}>
                  אשר והוסף לתיק שלי
                </button>
                <button type="button" onClick={() => setStockToBuy(null)} className="btn btn-secondary">
                  ביטול
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Interactive Chart Modal */}
      {chartStock && (
        <div className="modal-overlay" onClick={() => setChartStock(null)}>
          <div className="modal-content animate-fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '720px', direction: 'rtl' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 className="modal-title" style={{ margin: 0, fontSize: '1.35rem' }}>
                  {chartStock.symbol} – גרף היסטוריית מחיר
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.2rem' }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{money(chartStock.currentPrice)}</span>
                  <span
                    style={{
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: (chartStock.dailyChange || 0) >= 0 ? 'var(--profit-color)' : 'var(--loss-color)',
                      direction: 'ltr',
                    }}
                  >
                    {(chartStock.dailyChange || 0) >= 0 ? '+' : ''}
                    {(chartStock.dailyPercentChange || 0).toFixed(2)}% היום
                  </span>
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
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem' }}>
              {(['1d', '1w', '1m', '1y', '5y'] as const).map(r => {
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
                    onClick={() => handleRangeChange(r)}
                    className={`timeframe-btn ${chartRange === r ? 'active' : ''}`}
                  >
                    {labels[r]}
                  </button>
                );
              })}
            </div>

            {/* Chart Body */}
            {chartLoading ? (
              <div style={{ height: '260px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
                <div className="loader" style={{ width: '28px', height: '28px' }}></div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>טוען נתונים…</span>
              </div>
            ) : chartError ? (
              <div style={{ height: '260px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--loss-color)' }}>
                <p>{chartError}</p>
              </div>
            ) : chartData && chartData.points && chartData.points.length > 1 ? (
              (() => {
                const points = chartData.points;
                const prices = points.map((p: any) => p.price);
                const minPrice = Math.min(...prices) * 0.98;
                const maxPrice = Math.max(...prices) * 1.02;
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

                const coords = points.map((p: any, i: number) => ({ x: getX(i), y: getY(p.price) }));
                const lineD = coords.reduce((acc: string, c: any, i: number) => `${acc} ${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)},${c.y.toFixed(1)}`, '');
                const areaD = `${lineD} L ${coords[coords.length - 1].x.toFixed(1)},${(padTop + plotH).toFixed(1)} L ${coords[0].x.toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

                const isPositive = (chartData.periodChange || 0) >= 0;
                const lineColor = isPositive ? 'var(--profit-color)' : 'var(--loss-color)';
                const gradId = `chartGrad_wl_${chartStock.symbol}_${chartRange}`;

                const activePoint = chartHoverIndex !== null ? points[chartHoverIndex] : null;

                return (
                  <div>
                    <div style={{ height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.5rem', marginBottom: '0.4rem' }}>
                      {activePoint ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{activePoint.time}</span>
                          <span style={{ fontWeight: 700 }}>{money(activePoint.price)}</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                          <span style={{ color: 'var(--text-muted)' }}>שינוי בתקופה:</span>
                          <span style={{ color: lineColor, fontWeight: 700, direction: 'ltr' }}>
                            {isPositive ? '+' : ''}
                            {(chartData.periodChangePercent || 0).toFixed(2)}% ({signedMoney(chartData.periodChange)})
                          </span>
                        </div>
                      )}
                    </div>

                    <svg
                      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                      onMouseMove={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                        setChartHoverIndex(Math.round(ratio * (points.length - 1)));
                      }}
                      onMouseLeave={() => setChartHoverIndex(null)}
                    >
                      <defs>
                        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={lineColor} stopOpacity="0.35" />
                          <stop offset="100%" stopColor={lineColor} stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      <path d={areaD} fill={`url(#${gradId})`} />
                      <path d={lineD} fill="none" stroke={lineColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                );
              })()
            ) : (
              <div style={{ height: '260px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                אין מספיק נתונים להצגת גרף.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gemini Analysis Modal */}
      {analysisSymbol && (
        <div className="modal-overlay" onClick={() => setAnalysisSymbol(null)}>
          <div className="modal-content animate-fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px', direction: 'rtl' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={20} color="var(--accent-color)" />
                <h2 className="modal-title" style={{ margin: 0, fontSize: '1.35rem' }}>
                  ניתוח אנליסטים עבור {analysisSymbol}
                </h2>
              </div>
              <button
                onClick={() => setAnalysisSymbol(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <X size={20} />
              </button>
            </div>

            {analysisLoading[analysisSymbol] ? (
              <div style={{ padding: '2.5rem', textAlign: 'center' }}>
                <div className="loader" style={{ width: '32px', height: '32px', margin: '0 auto 1rem auto' }}></div>
                <p style={{ color: 'var(--text-muted)' }}>Gemini סורק את TipRanks ו-StockAnalysis עבור {analysisSymbol}…</p>
              </div>
            ) : analysisErrors[analysisSymbol] ? (
              <div style={{ padding: '1.5rem', color: 'var(--loss-color)', textAlign: 'center' }}>
                {analysisErrors[analysisSymbol]}
              </div>
            ) : analysisResults[analysisSymbol] ? (
              (() => {
                const data = analysisResults[analysisSymbol];
                const consensus = data.consensus || {};
                const ups = consensus.upsidePercent !== undefined ? consensus.upsidePercent : null;
                return (
                  <div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3, 1fr)',
                        gap: '0.75rem',
                        marginBottom: '1.25rem',
                      }}
                    >
                      <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>דירוג אנליסטים</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-color)' }}>
                          {consensus.rating || 'N/A'}
                        </div>
                      </div>
                      <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>מחיר יעד ממוצע</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                          {money(consensus.targetPrice)}
                        </div>
                      </div>
                      <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>פוטנציאל עלייה</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: (ups || 0) >= 0 ? 'var(--profit-color)' : 'var(--loss-color)' }}>
                          {ups !== null ? `${ups >= 0 ? '+' : ''}${ups.toFixed(1)}%` : '—'}
                        </div>
                      </div>
                    </div>

                    {data.summaryHe && (
                      <div
                        style={{
                          background: 'rgba(255, 255, 255, 0.04)',
                          padding: '1rem',
                          borderRadius: '0.75rem',
                          border: '1px solid var(--border-color)',
                          fontSize: '0.9rem',
                          lineHeight: '1.6',
                          color: 'var(--text-main)',
                        }}
                      >
                        {data.summaryHe}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
