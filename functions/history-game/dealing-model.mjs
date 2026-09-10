export const DEALING_VERSION = 1;
export const TICK_MS = 5000;
export const SHARES_PER_LOT = 1000;
export const MAX_ORDERS = 80;

export const DEFAULT_MARKET_CONFIG = Object.freeze({
  durationSeconds: 120,
  graceSeconds: 20,
});

export const LISTED_SHARES = Object.freeze([
  {
    id: "hikari",
    name: "Hikari Electronics",
    sector: "Electronics",
    colour: "#356a91",
    start: 250,
  },
  {
    id: "seiwa",
    name: "Seiwa Motors",
    sector: "Automotive",
    colour: "#8b5d92",
    start: 220,
  },
  {
    id: "maru",
    name: "Maru Foods",
    sector: "Consumer goods",
    colour: "#447c4b",
    start: 180,
  },
  {
    id: "tosei",
    name: "Tosei Development",
    sector: "Property development",
    colour: "#b48132",
    start: 300,
  },
]);

export const START_PRICES = Object.freeze(
  Object.fromEntries(LISTED_SHARES.map((share) => [share.id, share.start]))
);

const clone = (value) => JSON.parse(JSON.stringify(value));

export class DealingError extends Error { }

function requireInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new DealingError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

export function emptyTradingTotals() {
  return {
    orders: 0,
    fees: 0,
    spread: 0,
    realized: 0,
    emergencyRealized: 0,
    emergencyDiscount: 0,
    cashSpent: 0,
    cashReceived: 0,
  };
}

export function withListedShares(state) {
  return {
    ...state,
    listed: Object.fromEntries(
      LISTED_SHARES.map((share) => [share.id, { lots: 0, cost: 0 }])
    ),
    listedPrices: { ...START_PRICES },
    dealingTotals: emptyTradingTotals(),
  };
}

export function markListed(state, prices) {
  if (!state.listed) return state;

  return {
    ...state,
    listed: clone(state.listed),
    listedPrices: {
      ...START_PRICES,
      ...state.listedPrices,
      ...(prices || {}),
    },
    dealingTotals: {
      ...emptyTradingTotals(),
      ...state.dealingTotals,
    },
  };
}

export function listedValue(state) {
  if (!state.listed) return 0;

  return LISTED_SHARES.reduce((sum, share) => {
    const position = state.listed[share.id];
    const price = state.listedPrices?.[share.id] ?? share.start;
    return sum + (position?.lots || 0) * price;
  }, 0);
}

export function tradingSummary(state) {
  const value = listedValue(state);
  const cost = LISTED_SHARES.reduce(
    (sum, share) => sum + (state.listed?.[share.id]?.cost || 0),
    0
  );

  return {
    ...emptyTradingTotals(),
    ...state.dealingTotals,
    value,
    cost,
    unrealized: value - cost,
  };
}

export function marketClock(market, now) {
  if (!market) {
    return {
      stage: "off",
      tick: 0,
      elapsed: 0,
      remainingMs: 0,
      paused: false,
    };
  }

  if (market.startedAt == null) {
    return {
      stage: "briefing",
      tick: 0,
      elapsed: 0,
      remainingMs: market.durationMs,
      paused: false,
    };
  }

  const effectiveNow = market.pausedAt ?? now;

  const elapsed = Math.max(
    0,
    effectiveNow - market.startedAt - market.pausedMs
  );

  const stage = elapsed < market.durationMs
    ? "live"
    : elapsed < market.durationMs + market.graceMs
      ? "grace"
      : "closed";

  const halted = Boolean(
    stage === "live" &&
    market.halt &&
    elapsed >= market.halt.fromMs &&
    elapsed < market.halt.untilMs
  );

  return {
    stage,
    elapsed,
    tick: Math.min(
      market.durationMs / TICK_MS,
      Math.floor(elapsed / TICK_MS)
    ),
    remainingMs: Math.max(
      0,
      (stage === "live"
        ? market.durationMs
        : market.durationMs + market.graceMs) - elapsed
    ),
    paused: market.pausedAt != null,
    halted,
    haltRemainingMs: halted
      ? Math.max(0, market.halt.untilMs - elapsed)
      : 0,
  };
}

export function checkTradeWindow(market, now, request) {
  const clock = marketClock(market, now);

  if (clock.paused || clock.stage !== "live") {
    throw new DealingError("Trading is closed or paused.");
  }

  if (clock.halted) {
    throw new DealingError(
      "Trading is temporarily suspended. Both buying and selling will reopen shortly."
    );
  }

  if (
    request.quoteTick !== clock.tick ||
    request.marketRevision !== market.revision
  ) {
    throw new DealingError("The quote changed. Review the current price and try again.");
  }

  return clock;
}

/*
 * Prices are the cost of one 1,000-share lot, in existing ¥10,000 units.
 * Bid/ask rounding and fees therefore remain integer engine amounts.
 */
export function executionQuote(prices, symbol, side, lots) {
  if (!LISTED_SHARES.some((share) => share.id === symbol)) {
    throw new DealingError("Choose an available share.");
  }

  if (!["buy", "sell"].includes(side)) {
    throw new DealingError("Choose Buy or Sell.");
  }

  requireInteger(lots, 1, 5000, "Lots");

  const mid = requireInteger(prices[symbol], 1, 100000000, "Share quote");

  const price = side === "buy"
    ? Math.ceil(mid * 1.003)
    : Math.max(1, Math.floor(mid * 0.997));

  const gross = price * lots;
  const fee = Math.max(1, Math.ceil(gross * 0.002));

  const cashAmount = side === "buy"
    ? gross + fee
    : Math.max(0, gross - fee);

  if (!Number.isSafeInteger(cashAmount)) {
    throw new DealingError("This order is too large.");
  }

  return {
    symbol,
    side,
    lots,
    shares: lots * SHARES_PER_LOT,
    mid,
    price,
    gross,
    fee,
    spread: Math.abs(price - mid) * lots,
    cashAmount,
  };
}

export function maximumBuyLots(prices, symbol, cash) {
  if (!prices || !Number.isFinite(cash) || cash <= 0) return 0;

  const one = executionQuote(prices, symbol, "buy", 1);
  let lots = Math.min(5000, Math.floor(cash / one.price));

  while (
    lots > 0 &&
    executionQuote(prices, symbol, "buy", lots).cashAmount > cash
  ) {
    lots -= 1;
  }

  return lots;
}

export function applyListedTrade(state, prices, symbol, side, lots, buyingPower) {
  const next = markListed(state, prices);

  if (!next.listed) {
    throw new DealingError("This company has no dealing account.");
  }

  if (next.suspended) {
    throw new DealingError("This company is suspended.");
  }

  const quote = executionQuote(prices, symbol, side, lots);
  const position = next.listed[symbol];
  const totals = next.dealingTotals;

  let realized = 0;

  if (side === "buy") {
    if (
      quote.cashAmount > next.cash ||
      quote.cashAmount > buyingPower
    ) {
      throw new DealingError("Not enough available cash for this purchase.");
    }

    next.cash -= quote.cashAmount;
    position.lots += lots;
    position.cost += quote.cashAmount;
    totals.cashSpent += quote.cashAmount;
  } else {
    if (lots > position.lots) {
      throw new DealingError("You do not own enough shares.");
    }

    const costRemoved = lots === position.lots
      ? position.cost
      : Math.floor(position.cost * lots / position.lots);

    position.lots -= lots;
    position.cost -= costRemoved;
    next.cash += quote.cashAmount;

    realized = quote.cashAmount - costRemoved;
    totals.realized += realized;
    totals.cashReceived += quote.cashAmount;
  }

  totals.orders += 1;
  totals.fees += quote.fee;
  totals.spread += quote.spread;

  return {
    state: next,
    receipt: {
      ...quote,
      realized,
    },
  };
}

/*
 * Used only by company settlement when cash is insufficient.
 * Mutates the settlement copy, not the stored database document.
 */
export function emergencyListedSales(state, recoveryRate) {
  const sales = [];
  let loss = 0;

  if (!state.listed) return { sales, loss };

  state.dealingTotals = {
    ...emptyTradingTotals(),
    ...state.dealingTotals,
  };

  for (const share of LISTED_SHARES) {
    if (state.cash >= 0) break;

    const position = state.listed[share.id];
    if (!position || position.lots <= 0) continue;

    const mid = state.listedPrices[share.id];

    const lots = Math.min(
      position.lots,
      Math.ceil(-state.cash / Math.max(0.0001, mid * recoveryRate))
    );

    const bookValue = lots * mid;
    const proceeds = Math.floor(bookValue * recoveryRate);

    const costRemoved = lots === position.lots
      ? position.cost
      : Math.floor(position.cost * lots / position.lots);

    position.lots -= lots;
    position.cost -= costRemoved;
    state.cash += proceeds;

    const realized = proceeds - costRemoved;

    state.dealingTotals.realized += realized;
    state.dealingTotals.emergencyRealized += realized;
    state.dealingTotals.emergencyDiscount += bookValue - proceeds;

    loss += bookValue - proceeds;

    sales.push({
      asset: share.name,
      bookValue,
      proceeds,
    });
  }

  return { sales, loss };
}