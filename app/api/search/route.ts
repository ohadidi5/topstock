import { NextResponse } from 'next/server';

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return NextResponse.json({ quotes: [] });
  }

  try {
    const res = await fetch(`https://finnhub.io/api/v1/search?q=${query}&token=${FINNHUB_API_KEY}`);
    const data = await res.json();
    
    // Map to the format the frontend expects
    const quotes = (data.result || []).map((r: any) => ({
      symbol: r.symbol,
      shortname: r.description,
      longname: r.description,
      isYahooFinance: true // Keeping property so frontend doesn't break
    }));

    return NextResponse.json({ quotes });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Failed to search' }, { status: 500 });
  }
}
