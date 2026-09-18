import { NextRequest, NextResponse } from "next/server";

const LIGHTER_BASE_URL = "https://api.rh.lighter.xyz";
const EXPLORER_BASE_URL = "https://explorerapi.rh.lighter.xyz/api";
const PROGRAM_START = Date.UTC(2026, 7, 10);
const WEEKLY_CAMPAIGN_START = Date.UTC(2026, 7, 12);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES_PER_ACCOUNT = 30;
const PAGE_BATCH_SIZE = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_REQUESTS = 24;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

type MarketDetail = { symbol: string; market_id: number };
type Account = { index: number };
type ExplorerLog = {
  hash?: string;
  time?: string;
  pubdata_type?: string;
  pubdata?: Record<string, unknown>;
};
type NormalizedTrade = {
  id: string;
  timestamp: number;
  marketId: number;
  usdAmount: number;
  role: "maker" | "taker";
};

function clientKey(request: NextRequest) {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "local";
}

function exceedsRateLimit(request: NextRequest) {
  const now = Date.now();
  const key = clientKey(request);
  const existing = rateLimits.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  existing.count += 1;
  return existing.count > RATE_LIMIT_REQUESTS;
}

function apiHeaders(isCurrent: boolean) {
  return {
    "Cache-Control": isCurrent
      ? "public, s-maxage=20, stale-while-revalidate=60"
      : "public, s-maxage=3600, stale-while-revalidate=86400",
  };
}

function getTrade(log: ExplorerLog, accountIndexes: Set<string>): NormalizedTrade | null {
  const pubdata = log.pubdata ?? {};
  const raw = (pubdata.trade_pubdata ?? pubdata.trade_pubdata_with_funding ??
    pubdata.deleverage_pubdata ?? pubdata.deleverage_pubdata_with_funding) as Record<string, unknown> | undefined;
  if (!raw) return null;

  const maker = String(raw.maker_account_index ?? raw.deleverager_account_index ?? "");
  const taker = String(raw.taker_account_index ?? raw.bankrupt_account_index ?? "");
  const isMaker = accountIndexes.has(maker);
  const isTaker = accountIndexes.has(taker);
  if (!isMaker && !isTaker) return null;

  const timestamp = Date.parse(String(log.time ?? ""));
  const price = Number(raw.price ?? raw.quote ?? 0);
  const size = Number(raw.size ?? 0);
  if (!Number.isFinite(timestamp) || !Number.isFinite(price) || !Number.isFinite(size)) return null;

  return {
    id: String(log.hash ?? `${timestamp}-${maker}-${taker}`),
    timestamp,
    marketId: Number(raw.market_index ?? 0),
    usdAmount: price * size,
    role: isTaker ? "taker" : "maker",
  };
}

function currentWeekStart(now: Date) {
  const start = new Date(now);
  const daysSinceWednesday = (start.getUTCDay() - 3 + 7) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceWednesday);
  start.setUTCHours(0, 0, 0, 0);
  return start.getTime();
}

async function fetchExplorerPage(accountIndex: number, offset: number, typeQuery: string, cacheHistorical: boolean) {
  const url = `${EXPLORER_BASE_URL}/accounts/${accountIndex}/logs?limit=100&offset=${offset}&${typeQuery}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: cacheHistorical ? "force-cache" : "no-store",
        next: cacheHistorical ? { revalidate: 3600 } : undefined,
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const logs = (await response.json()) as ExplorerLog[];
      return Array.isArray(logs) ? logs : null;
    } catch {
      if (attempt === 1) return null;
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    if (exceedsRateLimit(request)) {
      return NextResponse.json({ success: false, error: "Too many requests. Please try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
    }
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get("wallet")?.trim() ?? "";
    const weekParam = searchParams.get("week") ?? "0";
    const isTotal = searchParams.get("range") === "total";

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ success: false, error: "Enter a valid 0x wallet address" }, { status: 400 });
    }
    if (!/^\d+$/.test(weekParam) || !Number.isSafeInteger(Number(weekParam))) {
      return NextResponse.json({ success: false, error: "week must be a non-negative integer" }, { status: 400 });
    }

    const week = Number(weekParam);
    const now = new Date();
    const baseStart = currentWeekStart(now);
    const maxWeekOffset = Math.max(0, Math.floor((baseStart - WEEKLY_CAMPAIGN_START) / WEEK_MS));
    if (!isTotal && week > maxWeekOffset) {
      return NextResponse.json({ success: false, error: `Week is outside the campaign. Maximum offset is ${maxWeekOffset}.` }, { status: 400 });
    }
    const regularPeriodStart = baseStart - week * WEEK_MS;
    const isFirstCampaignWeek = !isTotal && week === maxWeekOffset;
    const periodStart = isTotal ? PROGRAM_START : isFirstCampaignWeek ? PROGRAM_START : regularPeriodStart;
    const periodEnd = isTotal || week === 0 ? now.getTime() : regularPeriodStart + WEEK_MS;

    const accountsResponse = await fetch(
      `${LIGHTER_BASE_URL}/api/v1/accountsByL1Address?l1_address=${encodeURIComponent(wallet)}`,
      { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    const accountsData = await accountsResponse.json();
    const accounts: Account[] = accountsData.sub_accounts ?? [];
    const accountIndexes = new Set(accounts.map((account) => String(account.index)));

    if (!accountsResponse.ok || accountIndexes.size === 0) {
      return NextResponse.json({ success: false, error: "No Robinhood Lighter account was found for this wallet" }, { status: 404 });
    }

    const logTypes = ["Trade", "TradeWithFunding", "LiquidationTrade", "LiquidationTradeWithFunding"];
    const typeQuery = logTypes.map((type) => `pub_data_type=${type}`).join("&");
    const trades = new Map<string, NormalizedTrade>();
    let pagesFetched = 0;
    let truncated = false;

    for (const account of accounts) {
      let accountComplete = false;

      for (let batchStart = 0; batchStart < MAX_PAGES_PER_ACCOUNT && !accountComplete; batchStart += PAGE_BATCH_SIZE) {
        const pages = Array.from(
          { length: Math.min(PAGE_BATCH_SIZE, MAX_PAGES_PER_ACCOUNT - batchStart) },
          (_, index) => batchStart + index,
        );
        const batch = await Promise.all(
          pages.map((page) => fetchExplorerPage(account.index, page * 100, typeQuery, week > 0 && !isTotal)),
        );

        for (let index = 0; index < batch.length; index += 1) {
          const logs = batch[index];
          const page = pages[index];
          if (!logs) {
            truncated = true;
            accountComplete = true;
            break;
          }

          pagesFetched++;
          if (logs.length === 0) {
            accountComplete = true;
            break;
          }

          let oldest = Number.POSITIVE_INFINITY;
          for (const log of logs) {
            const trade = getTrade(log, accountIndexes);
            if (!trade) continue;
            oldest = Math.min(oldest, trade.timestamp);
            if (trade.timestamp >= periodStart && trade.timestamp < periodEnd) trades.set(trade.id, trade);
          }

          if (logs.length < 100 || oldest < periodStart) {
            accountComplete = true;
            break;
          }
          if (page === MAX_PAGES_PER_ACCOUNT - 1) truncated = true;
        }
      }
    }

    const marketsResponse = await fetch(`${LIGHTER_BASE_URL}/api/v1/orderBookDetails`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const marketsData = marketsResponse.ok ? await marketsResponse.json() : {};
    const marketDetails: MarketDetail[] = marketsData.order_book_details ?? [];
    const marketMap = Object.fromEntries(marketDetails.map((market) => [market.market_id, market.symbol]));

    let volume = 0;
    let makerFills = 0;
    let takerFills = 0;
    const activeDays = new Set<string>();
    const volumeByMarket: Record<number, number> = {};

    for (const trade of trades.values()) {
      volume += trade.usdAmount;
      activeDays.add(new Date(trade.timestamp).toISOString().slice(0, 10));
      volumeByMarket[trade.marketId] = (volumeByMarket[trade.marketId] ?? 0) + trade.usdAmount;
      if (trade.role === "maker") makerFills++; else takerFills++;
    }

    const fills = trades.size;
    const sortedMarkets = Object.entries(volumeByMarket).map(([marketId, marketVolume]) => ({
      marketId: Number(marketId), symbol: marketMap[Number(marketId)] ?? `Market ${marketId}`, volume: marketVolume,
    })).sort((a, b) => b.volume - a.volume);

    return NextResponse.json({
      success: true,
      wallet,
      accountIndexes: [...accountIndexes].map(Number),
      week,
      range: isTotal ? "total" : "week",
      period: { from: new Date(periodStart).toISOString(), to: new Date(periodEnd).toISOString(), type: "lighter_week" },
      points: { value: null, status: week === 0 && !isTotal ? "pending_distribution" : "unavailable" },
      summary: {
        volume, fills, markets: sortedMarkets.length,
        activeDays: isTotal ? activeDays.size : Math.min(activeDays.size, 7),
        avgTradeSize: fills > 0 ? volume / fills : 0,
        makerFills, takerFills, makerPercent: fills > 0 ? (makerFills / fills) * 100 : 0,
      },
      topMarket: sortedMarkets[0] ?? null,
      volumeByMarket: sortedMarkets,
      dataCompleteness: truncated ? "partial" : "complete",
      debug: { pagesFetched, tradesLoaded: fills },
    }, { headers: apiHeaders(week === 0 || isTotal) });
  } catch (error) {
    console.error("Lighter weekly error:", error);
    return NextResponse.json({ success: false, error: "Failed to build wallet analytics" }, { status: 500 });
  }
}
