import { NextResponse } from 'next/server';
import { put, get, list } from '@vercel/blob';
import crypto from 'crypto';

function sanitizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_\-\u0590-\u05ff]/g, '');
}

function getBlobKey(username: string): string {
  const hash = crypto.createHash('sha256').update(username.trim().toLowerCase()).digest('hex').slice(0, 32);
  return `users/account_${hash}.json`;
}

function hashPassword(password: string, username: string): string {
  const salt = `nexus_salt_${username.trim().toLowerCase()}`;
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

interface StoredAccount {
  username: string;
  passwordHash: string;
  portfolio: any[];
  watchlist?: any[];
  watchlistDeleted?: Record<string, number>;
  watchlistUpdatedAt?: number;
  analyses: Record<string, any>;
  currency: string;
  updatedAt: string;
}

function mergeWatchlistData(
  listA: any[] = [],
  listB: any[] = [],
  deletedMapA: Record<string, number> = {},
  deletedMapB: Record<string, number> = {}
): { mergedList: any[]; mergedDeleted: Record<string, number> } {
  // 1. Merge deleted maps with maximum timestamp
  const mergedDeleted: Record<string, number> = { ...(deletedMapA || {}) };
  if (deletedMapB && typeof deletedMapB === 'object') {
    for (const [sym, ts] of Object.entries(deletedMapB)) {
      mergedDeleted[sym] = Math.max(mergedDeleted[sym] || 0, typeof ts === 'number' ? ts : 0);
    }
  }

  // 2. Collect all items by symbol (newer addedAt or more complete item wins)
  const itemsBySymbol = new Map<string, any>();
  const allItems = [...(Array.isArray(listA) ? listA : []), ...(Array.isArray(listB) ? listB : [])];
  for (const item of allItems) {
    if (!item?.symbol) continue;
    const sym = item.symbol;
    const existingItem = itemsBySymbol.get(sym);
    if (!existingItem) {
      itemsBySymbol.set(sym, item);
    } else {
      const itemAddedAt = typeof item.addedAt === 'string' ? new Date(item.addedAt).getTime() : (typeof item.addedAt === 'number' ? item.addedAt : 0);
      const existingAddedAt = typeof existingItem.addedAt === 'string' ? new Date(existingItem.addedAt).getTime() : (typeof existingItem.addedAt === 'number' ? existingItem.addedAt : 0);
      if (itemAddedAt >= existingAddedAt) {
        itemsBySymbol.set(sym, { ...existingItem, ...item });
      }
    }
  }

  // 3. Filter out items that are marked deleted, UNLESS addedAt is newer than deletedAt
  const mergedList: any[] = [];
  for (const [sym, item] of itemsBySymbol.entries()) {
    const deletedTimestamp = mergedDeleted[sym];
    if (deletedTimestamp) {
      const addedTimestamp = typeof item.addedAt === 'string' ? new Date(item.addedAt).getTime() : (typeof item.addedAt === 'number' ? item.addedAt : 0);
      if (addedTimestamp > deletedTimestamp) {
        // Resurrected! User re-added this stock after previously deleting it
        delete mergedDeleted[sym];
        mergedList.push(item);
      }
    } else {
      mergedList.push(item);
    }
  }

  return { mergedList, mergedDeleted };
}

async function readAccount(username: string): Promise<StoredAccount | null> {
  const key = getBlobKey(username);
  try {
    const result = await get(key, { access: 'private' });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return null;
    }
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as StoredAccount;
  } catch {
    return null;
  }
}

async function getAllAccounts(): Promise<StoredAccount[]> {
  try {
    const { blobs } = await list({ prefix: 'users/' });
    const accounts = await Promise.all(
      blobs.map(async (b) => {
        try {
          const result = await get(b.pathname, { access: 'private' });
          if (!result || result.statusCode !== 200 || !result.stream) return null;
          const text = await new Response(result.stream).text();
          return JSON.parse(text) as StoredAccount;
        } catch {
          return null;
        }
      })
    );
    return accounts.filter((a): a is StoredAccount => a !== null);
  } catch (err) {
    console.error('Error listing accounts:', err);
    return [];
  }
}

async function writeAccount(account: StoredAccount): Promise<void> {
  const key = getBlobKey(account.username);
  await put(key, JSON.stringify(account), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      action,
      username: rawUsername,
      password,
      portfolio,
      watchlist,
      watchlistDeleted,
      watchlistUpdatedAt,
      analyses,
      currency,
      allowEmptyPortfolio,
    } = body || {};

    if (!rawUsername || typeof rawUsername !== 'string' || rawUsername.trim().length < 2) {
      return NextResponse.json({ error: 'נא להזין קוד משתמש (לפחות 2 תווים).' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length < 3) {
      return NextResponse.json({ error: 'נא להזין סיסמה (לפחות 3 תווים).' }, { status: 400 });
    }

    const username = sanitizeUsername(rawUsername);
    if (!username) {
      return NextResponse.json({ error: 'קוד משתמש לא תקין.' }, { status: 400 });
    }

    const passwordHash = hashPassword(password, username);

    // Registration: STRICT UNIQUENESS check across all existing accounts
    if (action === 'register') {
      const allAccounts = await getAllAccounts();

      let usernameTaken = false;
      let passwordTaken = false;

      for (const acc of allAccounts) {
        const accSanitized = sanitizeUsername(acc.username);
        if (accSanitized === username) {
          usernameTaken = true;
        }
        const candidateHashForAcc = hashPassword(password, accSanitized);
        if (candidateHashForAcc === acc.passwordHash) {
          passwordTaken = true;
        }
      }

      if (usernameTaken && passwordTaken) {
        return NextResponse.json(
          {
            error: 'קוד המשתמש והסיסמה האלו כבר תפוסים במערכת! אנא בחר קוד משתמש וסיסמה חדשים משלך.',
          },
          { status: 409 }
        );
      }

      if (usernameTaken) {
        return NextResponse.json(
          {
            error: 'שם משתמש זה כבר קיים במערכת. לא ניתן לקבוע שם משתמש זהה – אנא בחר קוד משתמש אחר.',
          },
          { status: 409 }
        );
      }

      if (passwordTaken) {
        return NextResponse.json(
          {
            error: 'סיסמה זו כבר נמצאת בשימוש במערכת. לא ניתן לקבוע סיסמה זהה – אנא בחר סיסמה אחרת.',
          },
          { status: 409 }
        );
      }

      const clientWatchlistUpdatedAt = typeof watchlistUpdatedAt === 'number' ? watchlistUpdatedAt : Date.now();
      const { mergedList, mergedDeleted } = mergeWatchlistData(watchlist, [], watchlistDeleted, {});

      const newAccount: StoredAccount = {
        username: rawUsername.trim(),
        passwordHash,
        portfolio: Array.isArray(portfolio) ? portfolio : [],
        watchlist: mergedList,
        watchlistDeleted: mergedDeleted,
        watchlistUpdatedAt: clientWatchlistUpdatedAt,
        analyses: analyses && typeof analyses === 'object' ? analyses : {},
        currency: currency || 'USD',
        updatedAt: new Date().toISOString(),
      };

      await writeAccount(newAccount);

      return NextResponse.json({
        success: true,
        username: newAccount.username,
        portfolio: newAccount.portfolio,
        watchlist: newAccount.watchlist || [],
        watchlistDeleted: newAccount.watchlistDeleted || {},
        watchlistUpdatedAt: newAccount.watchlistUpdatedAt,
        analyses: newAccount.analyses,
        currency: newAccount.currency,
        updatedAt: newAccount.updatedAt,
      });
    }

    const existing = await readAccount(username);

    // Login or Startup Restore: Return user's portfolio and data
    if (action === 'login' || action === 'restore') {
      if (!existing) {
        return NextResponse.json(
          { error: 'לא נמצא חשבון עם קוד משתמש זה. לחץ על "קבע קוד משתמש וסיסמה" כדי ליצור חשבון חדש.' },
          { status: 404 }
        );
      }
      if (existing.passwordHash !== passwordHash) {
        return NextResponse.json({ error: 'סיסמה שגויה. נסה שוב.' }, { status: 401 });
      }

      let needSave = false;

      // Smart Watchlist sync with CRDT merge (never loses added stocks, preserves deletions)
      const { mergedList, mergedDeleted } = mergeWatchlistData(
        existing.watchlist || [],
        Array.isArray(watchlist) ? watchlist : [],
        existing.watchlistDeleted || {},
        watchlistDeleted || {}
      );

      const existingSymbols = (existing.watchlist || []).map((s: any) => s.symbol).sort().join(',');
      const mergedSymbols = mergedList.map((s: any) => s.symbol).sort().join(',');
      const existingDelCount = Object.keys(existing.watchlistDeleted || {}).length;
      const mergedDelCount = Object.keys(mergedDeleted).length;

      if (existingSymbols !== mergedSymbols || existingDelCount !== mergedDelCount) {
        existing.watchlist = mergedList;
        existing.watchlistDeleted = mergedDeleted;
        existing.watchlistUpdatedAt = Math.max(
          existing.watchlistUpdatedAt || 0,
          typeof watchlistUpdatedAt === 'number' ? watchlistUpdatedAt : Date.now()
        );
        needSave = true;
      }

      // If client has local portfolio but cloud was empty, preserve local portfolio
      if (
        (!existing.portfolio || existing.portfolio.length === 0) &&
        Array.isArray(portfolio) &&
        portfolio.length > 0
      ) {
        existing.portfolio = portfolio;
        needSave = true;
      }

      if (needSave) {
        existing.updatedAt = new Date().toISOString();
        await writeAccount(existing);
      }

      return NextResponse.json({
        success: true,
        username: existing.username,
        portfolio: existing.portfolio || [],
        watchlist: existing.watchlist || [],
        watchlistDeleted: existing.watchlistDeleted || {},
        watchlistUpdatedAt: existing.watchlistUpdatedAt || 0,
        analyses: existing.analyses || {},
        currency: existing.currency || 'USD',
        updatedAt: existing.updatedAt,
      });
    }

    // Auto-sync: Update portfolio, watchlist, and analyses
    if (action === 'sync') {
      if (!existing) {
        return NextResponse.json({ error: 'חשבון לא נמצא.' }, { status: 404 });
      }
      if (existing.passwordHash !== passwordHash) {
        return NextResponse.json({ error: 'אימות נכשל.' }, { status: 401 });
      }

      // Safeguard: Never let a background auto-sync wipe out an existing non-empty portfolio
      // with an empty array unless allowEmptyPortfolio is explicitly specified.
      let newPortfolio = existing.portfolio;
      if (Array.isArray(portfolio)) {
        if (portfolio.length > 0 || allowEmptyPortfolio) {
          newPortfolio = portfolio;
        }
      }

      let finalWatchlist = existing.watchlist || [];
      let finalWatchlistDeleted = existing.watchlistDeleted || {};
      let finalWatchlistUpdatedAt = existing.watchlistUpdatedAt || 0;

      if (Array.isArray(watchlist) || watchlistDeleted) {
        const { mergedList, mergedDeleted } = mergeWatchlistData(
          existing.watchlist || [],
          Array.isArray(watchlist) ? watchlist : [],
          existing.watchlistDeleted || {},
          watchlistDeleted || {}
        );
        finalWatchlist = mergedList;
        finalWatchlistDeleted = mergedDeleted;
        finalWatchlistUpdatedAt = Math.max(
          existing.watchlistUpdatedAt || 0,
          typeof watchlistUpdatedAt === 'number' ? watchlistUpdatedAt : Date.now()
        );
      }

      const updatedAccount: StoredAccount = {
        ...existing,
        portfolio: newPortfolio,
        watchlist: finalWatchlist,
        watchlistDeleted: finalWatchlistDeleted,
        watchlistUpdatedAt: finalWatchlistUpdatedAt,
        analyses: analyses && typeof analyses === 'object' ? { ...(existing.analyses || {}), ...analyses } : existing.analyses,
        currency: currency || existing.currency,
        updatedAt: new Date().toISOString(),
      };

      await writeAccount(updatedAccount);

      return NextResponse.json({
        success: true,
        updatedAt: updatedAccount.updatedAt,
        watchlist: updatedAccount.watchlist,
        watchlistDeleted: updatedAccount.watchlistDeleted,
        watchlistUpdatedAt: updatedAccount.watchlistUpdatedAt,
      });
    }

    return NextResponse.json({ error: 'פעולה לא חוקית' }, { status: 400 });
  } catch (err: any) {
    console.error('Auth/Sync API error:', err);
    return NextResponse.json({ error: 'שגיאת שרת בסנכרון החשבון. נסה שוב.' }, { status: 500 });
  }
}
