import { NextResponse } from 'next/server';

// Fallback rates (used only if the live rates service is unreachable)
const FALLBACK = { USD: 1, ILS: 3.7, EUR: 0.92 };

export async function GET() {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      next: { revalidate: 3600 },
    });
    const data = await res.json();
    if (data?.rates?.ILS && data?.rates?.EUR) {
      return NextResponse.json({
        rates: { USD: 1, ILS: data.rates.ILS, EUR: data.rates.EUR },
      });
    }
    return NextResponse.json({ rates: FALLBACK });
  } catch (error) {
    console.error('Rates error:', error);
    return NextResponse.json({ rates: FALLBACK });
  }
}
