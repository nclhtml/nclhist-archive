import { formatYen } from "./advisor-model.mjs";
import { listedValue } from "./dealing-model.mjs";

export const EIGHT_VERSION = 4;

export function eightNetWorth(state) {
  return Math.round(
    state.cash +
    state.stocks +
    listedValue(state) +
    state.property +
    state.factoryBook +
    state.inventoryBook +
    state.receivables -
    state.debt
  );
}

/*
 * Borrowing itself does not create net worth.
 * Eligible collateral and operating performance also matter.
 */
export function eightCreditLimit(state, rules) {
  const worth = Math.max(0, eightNetWorth(state));
  const recentCash = state.recentOperatingCash || 0;

  const collateral =
    rules.creditBase +
    worth * 0.12 +
    state.property * 0.65 +
    listedValue(state) * 0.18 +
    state.factoryBook * 0.45 +
    state.receivables * 0.1 +
    Math.max(0, recentCash) * 0.6;

  const performanceFactor = recentCash < 0 ? 0.85 : 1;

  return Math.max(0, Math.floor(Math.min(
    rules.maxDebt,
    worth * 1.8,
    collateral * rules.creditFactor * performanceFactor
  )));
}

export function eightNewLoanCap(state, rules) {
  return Math.max(0, Math.floor(Math.min(
    rules.maxNewDebt,
    Math.max(0, eightNetWorth(state)) * 0.35
  )));
}

export function propertyCostRemoved(state, valueSold) {
  const cost = state.propertyCost ?? state.property;

  if (valueSold <= 0 || state.property <= 0) return 0;
  if (valueSold >= state.property) return cost;

  return Math.floor(cost * valueSold / state.property);
}

export function estimatedShareSale(state, symbol, quote) {
  const position = state.listed?.[symbol];

  if (
    !position ||
    position.lots <= 0 ||
    !quote ||
    quote.side !== "sell" ||
    quote.lots > position.lots
  ) {
    return null;
  }

  const cost = quote.lots === position.lots
    ? position.cost
    : Math.floor(position.cost * quote.lots / position.lots);

  return {
    cost,
    proceeds: quote.cashAmount,
    result: quote.cashAmount - cost,
  };
}

export function eightReview(history, limit = 3) {
  const candidates = [];

  function add(key, title, lesson, score, entry, decision, known, outcome) {
    candidates.push({
      key,
      title,
      tag: "Investment review",
      lesson,
      score,
      evidence: [{
        round: entry.round,
        date: entry.date,
        decision,
        known,
        outcome,
      }],
    });
  }

  for (const entry of history) {
    if (entry.inactive) continue;

    const m = entry.metrics;
    const advice = entry.advisor?.advice;
    const prior = entry.opening.before;

    const openingLoss =
      Math.max(0, -(entry.opening.listedChange || 0)) +
      Math.max(0, -m.propertyChange);

    const dealingLoss = Math.max(0, -(m.dealingProfit || 0));

    if (
      prior.debt > 0 &&
      openingLoss + dealingLoss >= 500
    ) {
      add(
        "exposure",
        "Investment losses while the company owed money",
        "Review the combination of investment exposure and debt, not whether you could predict an exact crash time.",
        openingLoss + dealingLoss,
        entry,
        `The company entered this period owing ${formatYen(prior.debt)}.`,
        "Holdings, loan balances and repayment conditions were available.",
        `Opening asset losses and the negative dealing result together amounted to ${formatYen(openingLoss + dealingLoss)}.`
      );
    }

    if (
      advice?.reserveRelease > 0 &&
      m.forcedLoss >= 100
    ) {
      add(
        "cash",
        "The safety buffer and emergency sales",
        "Releasing a cash buffer creates more investment capacity, not more company wealth.",
        m.forcedLoss,
        entry,
        `You released ${advice.reserveRelease}% of the recommended safety buffer.`,
        `The plan's no-receipts cash estimate was ${formatYen(entry.advisor.plan.noSalesCash)}.`,
        `Emergency sales caused ${formatYen(m.forcedLoss)} of discount losses.`
      );
    }

    if ((m.dealingFees || 0) >= 100) {
      add(
        "fees",
        "Was frequent trading worth its cost?",
        "Trading activity is not itself success. Compare the dealing result with the fees and risk taken.",
        m.dealingFees,
        entry,
        "You made individual-share transactions during this period.",
        "Each order displayed its cost, spread and fee.",
        `Fees were ${formatYen(m.dealingFees)}; the dealing result was ${formatYen(m.dealingProfit || 0)}.`
      );
    }

    if (advice?.project !== "none" && m.projectCost > 0) {
      add(
        "business",
        "Investing in the company's future earnings",
        "An improvement project has an upfront cost and a delay. Explain why the expected operating benefit justified the commitment.",
        m.projectCost / 3,
        entry,
        `You commissioned a ${advice.project} project costing ${formatYen(m.projectCost)}.`,
        "The cost and two-round completion delay were visible.",
        `Operating cash flow that period was ${formatYen(m.operatingCashFlow)}. Later periods show whether performance improved.`
      );
    }

    if (entry.decision.factories > 0) {
      const demand =
        entry.terms.forecast.domestic[1] +
        entry.terms.forecast.export[1];

      const capacity =
        entry.before.factories * entry.terms.factoryCapacity +
        entry.before.inventory;

      if (demand <= capacity + 15) {
        add(
          "capacity",
          "Was more factory capacity necessary?",
          "More capacity adds commitments without guaranteeing customers.",
          entry.terms.factoryPrice / 2,
          entry,
          "You recommended one additional factory.",
          `The upper demand estimate was ${demand} goods; existing capacity and inventory were ${capacity}.`,
          `Factory commitments cost ${formatYen(m.overhead)} that period.`
        );
      }
    }
  }

  const best = new Map();

  for (const item of candidates) {
    if (!best.has(item.key) || item.score > best.get(item.key).score) {
      best.set(item.key, item);
    }
  }

  const result = [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(3, limit)))
    .map(({ score, ...item }) => item);

  return result.length ? result : [{
    key: "resilience",
    title: "A decision worth retaining or improving",
    tag: "Investment review",
    lesson:
      "Explain an investment or financing decision using the information available at the time.",
    evidence: [],
  }];
}