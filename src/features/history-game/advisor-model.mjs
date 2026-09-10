export const ADVISOR_VERSION = 1;
export const YEN_PER_UNIT = 10000;

const decimalFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

export function formatYen(value) {
  const yen = numeric(value) * YEN_PER_UNIT;
  const absolute = Math.abs(yen);
  const sign = yen < 0 ? "-" : "";

  let divisor = 1;
  let suffix = "";

  if (absolute >= 1000000000) {
    divisor = 1000000000;
    suffix = "B";
  } else if (absolute >= 1000000) {
    divisor = 1000000;
    suffix = "M";
  } else if (absolute >= 1000) {
    divisor = 1000;
    suffix = "K";
  }

  return (
    `${sign}¥` +
    decimalFormatter.format(absolute / divisor) +
    suffix
  );
}

export function formatYenExact(value) {
  const yen = numeric(value) * YEN_PER_UNIT;

  return (
    `${yen < 0 ? "-" : ""}¥` +
    integerFormatter.format(Math.abs(yen))
  );
}

export function companyWorth(state, rules) {
  return Math.round(
    state.cash +
    state.stocks +
    state.property +
    state.factories * rules.factoryPrice +
    state.inventory * rules.unitCost -
    state.debt
  );
}

export const MARKETING_LABELS = Object.freeze({
  balanced: "Follow management's recommendation",
  domestic: "Prioritise domestic customers",
  export: "Prioritise export opportunities",
});

export function defaultAdvice() {
  return {
    buyStocks: 0,
    buyProperty: 0,
    sellStocks: 0,
    sellProperty: 0,
    loanMode: "hold",
    loanPercent: 0,
    factoryChange: 0,
    marketing: "balanced",
  };
}

class AdviceError extends Error {}

function requireInteger(value, minimum, maximum, label) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new AdviceError(
      `${label} must be a whole number from ${minimum} to ${maximum}.`
    );
  }

  return value;
}

function checkedAdvice(input, state, rules) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AdviceError("Investment instructions are required.");
  }

  const keys = Object.keys(defaultAdvice());

  if (Object.keys(input).some((key) => !keys.includes(key))) {
    throw new AdviceError("Unexpected investment instruction.");
  }

  const result = {};

  for (const key of [
    "buyStocks",
    "buyProperty",
    "sellStocks",
    "sellProperty",
    "loanPercent",
  ]) {
    result[key] = requireInteger(input[key], 0, 100, key);
  }

  result.factoryChange = requireInteger(
    input.factoryChange,
    -1,
    1,
    "Factory recommendation"
  );

  if (!["hold", "borrow", "repay"].includes(input.loanMode)) {
    throw new AdviceError("Choose a valid loan instruction.");
  }

  if (!Object.prototype.hasOwnProperty.call(
    MARKETING_LABELS,
    input.marketing
  )) {
    throw new AdviceError("Choose a valid marketing recommendation.");
  }

  result.loanMode = input.loanMode;
  result.marketing = input.marketing;

  if (result.loanMode === "hold" && result.loanPercent !== 0) {
    throw new AdviceError(
      "Set the loan percentage to zero when leaving loans unchanged."
    );
  }

  if (result.buyStocks + result.buyProperty > 100) {
    throw new AdviceError(
      "Share purchases, property purchases and retained cash must total 100%."
    );
  }

  if (result.buyStocks > 0 && result.sellStocks > 0) {
    throw new AdviceError(
      "Clear the planned share sale before buying shares this round."
    );
  }

  if (result.buyProperty > 0 && result.sellProperty > 0) {
    throw new AdviceError(
      "Clear the planned property sale before buying property this round."
    );
  }

  const maximumPropertyPercent = Math.floor(
    rules.propertySaleFraction * 100
  );

  if (result.sellProperty > maximumPropertyPercent) {
    throw new AdviceError(
      `Only ${maximumPropertyPercent}% of property can be sold this round.`
    );
  }

  const factories = state.factories + result.factoryChange;

  if (factories < 1 || factories > rules.maxFactories) {
    throw new AdviceError(
      `Keep between 1 and ${rules.maxFactories} factories.`
    );
  }

  if (state.suspended) {
    throw new AdviceError("This company's operations are suspended.");
  }

  return result;
}

function collateralLimit(state, rules) {
  return Math.max(0, Math.min(
    rules.maxDebt,
    Math.floor(
      (
        rules.creditBase +
        state.stocks * rules.stockCollateral +
        state.property * rules.propertyCollateral +
        state.factories * rules.factoryPrice * rules.factoryCollateral
      ) * rules.creditFactor
    )
  ));
}

function requiredPrincipal(state, rules) {
  return Math.min(
    state.debt,
    Math.max(
      Math.ceil(state.debt * rules.principalRate),
      Math.max(0, state.debt - collateralLimit(state, rules))
    )
  );
}

/*
 * Management uses PUBLIC forecasts only.
 *
 * It does not receive the private demand outcome, the session seed,
 * future events, or future prices.
 *
 * The plan favours profitable sales at the lower forecast bounds.
 * Marketing advice is a modest preference, not an order to manufacture
 * a particular number of goods.
 */
function managementPlan(
  inventory,
  maximumProduction,
  rules,
  forecast,
  marketing
) {
  let best = null;

  for (let production = 0; production <= maximumProduction; production += 1) {
    const available = inventory + production;

    for (const exports of [0, 25, 50, 75, 100]) {
      const exportAllocation = Math.floor(available * exports / 100);
      const domesticAllocation = available - exportAllocation;

      const domesticSales = Math.min(
        domesticAllocation,
        forecast.domestic[0]
      );

      const exportSales = Math.min(
        exportAllocation,
        forecast.export[0]
      );

      const unsold = available - domesticSales - exportSales;

      const revenue =
        domesticSales * rules.domesticPrice +
        exportSales * rules.exportPrice;

      const margin =
        revenue -
        production * rules.unitCost -
        unsold * rules.storagePerUnit;

      const preference =
        marketing === "domestic"
          ? domesticSales * 18
          : marketing === "export"
            ? exportSales * 18
            : 0;

      const score = margin + preference;

      if (
        !best ||
        score > best.score ||
        (
          score === best.score &&
          (
            margin > best.margin ||
            (
              margin === best.margin &&
              production < best.production
            )
          )
        )
      ) {
        best = {
          production,
          exports,
          domesticSales,
          exportSales,
          score,
          margin,
        };
      }
    }
  }

  return {
    production: best.production,
    exports: best.exports,
    domesticSalesAtLowForecast: best.domesticSales,
    exportSalesAtLowForecast: best.exportSales,
  };
}

/*
 * All returned money values remain in existing engine units.
 * Formatting alone converts one unit into ¥10,000.
 *
 * Purchases use one budget. Unallocated percentages remain cash.
 * Expected sales revenue is NOT included in spendable cash.
 */
export function compileAdvisorPlan(state, input, rules, brief) {
  try {
    const advice = checkedAdvice(input, state, rules);

    if (!brief?.forecast || !Number.isFinite(brief.rate)) {
      throw new AdviceError("Wait for the current round briefing.");
    }

    const problems = [];

    const stockSaleValue = Math.floor(
      state.stocks * advice.sellStocks / 100
    );

    const propertySaleValue = Math.floor(
      state.property * advice.sellProperty / 100
    );

    const propertySaleCash = Math.floor(
      propertySaleValue * rules.propertyBid
    );

    const factoryCost = advice.factoryChange *
      (
        advice.factoryChange >= 0
          ? rules.factoryPrice
          : rules.factoryResale
      );

    const base = {
      ...state,
      cash:
        state.cash +
        stockSaleValue +
        propertySaleCash -
        factoryCost,
      stocks: state.stocks - stockSaleValue,
      property: state.property - propertySaleValue,
      factories: state.factories + advice.factoryChange,
    };

    /*
     * Borrowing uses collateral after sales and the factory proposal.
     * New financial purchases do not create instant extra borrowing
     * capacity in this beginner planner.
     */
    const borrowLimit = Math.max(0, Math.min(
      rules.maxNewDebt,
      rules.maxDebt - state.debt,
      collateralLimit(base, rules) - state.debt
    ));

    const maxRepayPercent = state.debt > 0
      ? Math.min(100, Math.floor(
          Math.max(0, Math.min(state.debt, base.cash)) /
          state.debt * 100
        ))
      : 0;

    let loanChange = 0;

    if (advice.loanMode === "borrow") {
      loanChange = Math.floor(
        borrowLimit * advice.loanPercent / 100
      );
    } else if (advice.loanMode === "repay") {
      loanChange = -Math.floor(
        state.debt * advice.loanPercent / 100
      );
    }

    base.cash += loanChange;
    base.debt += loanChange;

    if (base.cash < 0) {
      problems.push(
        "The factory recommendation or repayment uses more cash than is available."
      );
    }

    const interest = Math.ceil(base.debt * brief.rate);
    const overhead = base.factories * rules.factoryOverhead;
    const principalReserve = requiredPrincipal(base, rules);

    const existingBills =
      interest +
      overhead +
      principalReserve +
      state.inventory * rules.storagePerUnit;

    const productionFunds = Math.max(0, base.cash - existingBills);

    const maximumProduction = Math.max(0, Math.min(
      base.factories * rules.factoryCapacity,
      Math.floor(
        productionFunds / (rules.unitCost + rules.storagePerUnit)
      )
    ));

    const operations = managementPlan(
      state.inventory,
      maximumProduction,
      rules,
      brief.forecast,
      advice.marketing
    );

    const productionCost = operations.production * rules.unitCost;

    const storageReserve =
      (state.inventory + operations.production) *
      rules.storagePerUnit;

    const operatingReserve =
      productionCost +
      storageReserve +
      overhead +
      interest +
      principalReserve;

    const budget = Math.max(0, base.cash - operatingReserve);

    const stockPurchase = Math.floor(
      budget * advice.buyStocks / 100
    );

    const propertyPurchase = Math.floor(
      budget * advice.buyProperty / 100
    );

    /*
     * The exact integer-percent ceiling allows for rounding purchases
     * down to whole engine units.
     */
    const purchasePercentLimit = budget > 0
      ? Math.max(0, Math.min(
          100,
          Math.ceil(
            (rules.maxInvestmentPurchase + 1) * 100 / budget
          ) - 1
        ))
      : 100;

    if (stockPurchase > rules.maxInvestmentPurchase) {
      problems.push(
        `Share purchases are limited to ${formatYen(rules.maxInvestmentPurchase)} this round. Lower the share allocation.`
      );
    }

    if (propertyPurchase > rules.maxInvestmentPurchase) {
      problems.push(
        `Property purchases are limited to ${formatYen(rules.maxInvestmentPurchase)} this round. Lower the property allocation.`
      );
    }

    const decision = {
      debt: loanChange,
      stocks: stockPurchase - stockSaleValue,
      property: propertyPurchase - propertySaleValue,
      factories: advice.factoryChange,
      production: operations.production,
      exports: operations.exports,
    };

    const proposed = {
      ...base,
      cash: base.cash - stockPurchase - propertyPurchase,
      stocks: base.stocks + stockPurchase,
      property: base.property + propertyPurchase,
    };

    const principal = requiredPrincipal(proposed, rules);
    const creditCeiling = collateralLimit(proposed, rules);

    if (loanChange > 0 && proposed.debt > creditCeiling) {
      problems.push("The proposed loan exceeds the collateral ceiling.");
    }

    const cashAfterOrders = proposed.cash - productionCost;

    if (cashAfterOrders < 0) {
      problems.push("The proposed purchases and operating plan are unaffordable.");
    }

    const noSalesCash =
      cashAfterOrders -
      overhead -
      interest -
      principal -
      storageReserve;

    return {
      version: ADVISOR_VERSION,
      valid: problems.length === 0,
      problems,
      advice,
      decision,
      operations,

      budget,
      stockPurchase,
      propertyPurchase,
      cashAllocation: budget - stockPurchase - propertyPurchase,
      cashPercent: 100 - advice.buyStocks - advice.buyProperty,
      purchasePercentLimit,

      stockSaleValue,
      propertySaleValue,
      propertySaleCash,
      factoryCost,

      borrowLimit,
      maxRepayPercent,
      loanChange,
      plannedDebt: proposed.debt,
      creditCeiling,

      productionCost,
      overhead,
      interest,
      principal,
      principalReserve,
      storageReserve,
      operatingReserve,
      cashAfterOrders,
      noSalesCash,
    };
  } catch (error) {
    if (error instanceof AdviceError) {
      return {
        version: ADVISOR_VERSION,
        valid: false,
        problems: [error.message],
      };
    }

    throw error;
  }
}

/*
 * Reviews assess investment instructions and broad board advice.
 * They do not blame students for exact production quantities selected
 * by the assisted management system.
 */
export function makeAdvisorReview(history, limit = 3) {
  const groups = new Map();

  const manual = history.filter(
    (entry) => entry.advisor && !entry.defaulted && !entry.inactive
  );

  function evidence(entry, decision, known, outcome) {
    return {
      round: entry.round,
      date: entry.date,
      decision,
      known,
      outcome,
    };
  }

  function add(key, title, tag, lesson, score, item) {
    if (score < 100) return;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title,
        tag,
        lesson,
        score: 0,
        evidence: [],
      });
    }

    const group = groups.get(key);
    group.score += score;
    group.evidence.push(item);
  }

  for (const lossEntry of history) {
    if (lossEntry.inactive || lossEntry.before.debt <= 0) continue;

    const loss =
      Math.max(0, -lossEntry.metrics.stockChange) +
      Math.max(0, -lossEntry.metrics.propertyChange);

    if (loss < 500) continue;

    const prior = [...manual].reverse().find((candidate) => {
      if (candidate.round >= lossEntry.round) return false;

      const rules = candidate.information.rules;
      const gross = Math.max(
        1,
        companyWorth(candidate.after, rules) + candidate.after.debt
      );

      const concentrated =
        (candidate.after.stocks + candidate.after.property) / gross >= 0.5;

      const continuousExposure = history
        .filter((entry) =>
          entry.round >= candidate.round &&
          entry.round < lossEntry.round
        )
        .every((entry) =>
          entry.after.debt > 0 &&
          entry.after.stocks + entry.after.property > 0
        );

      return (
        candidate.decision.debt > 0 &&
        (
          candidate.decision.stocks > 0 ||
          candidate.decision.property > 0
        ) &&
        concentrated &&
        continuousExposure
      );
    });

    if (!prior) continue;

    add(
      "borrowing",
      "Borrowing increased exposure to asset losses",
      "Investment and borrowing",
      "Borrowing and concentrated holdings increased vulnerability. Review the exposure, not whether you could predict the exact date of the downturn.",
      loss,
      evidence(
        prior,
        `You added ${formatYen(prior.decision.debt)} of borrowing while purchasing investments.`,
        "The loan obligation, investment holdings and cash preview were visible. Future returns were not guaranteed.",
        `At the opening of round ${lossEntry.round + 1}, held investments lost ${formatYen(loss)} while debt remained. This is the loss on the holdings then owned, not a loss attributed entirely to one purchase.`
      )
    );
  }

  for (const entry of manual) {
    const { decision, metrics, information, before } = entry;
    const advice = entry.advisor.advice;
    const plan = entry.advisor.plan;
    const rules = information.rules;

    const upperDemand =
      information.forecast.domestic[1] +
      information.forecast.export[1];

    const oldAvailableCapacity =
      before.factories * rules.factoryCapacity + before.inventory;

    const sold = metrics.soldDomestic + metrics.soldExport;

    if (
      decision.factories > 0 &&
      upperDemand <= oldAvailableCapacity + 15 &&
      sold <= oldAvailableCapacity
    ) {
      add(
        "expansion",
        "Review the timing of the factory recommendation",
        "Advice to the board",
        "A new factory commits cash and adds running costs. Management handled production; your review concerns whether additional capacity was needed at that time.",
        rules.factoryOverhead,
        evidence(
          entry,
          `You recommended a new factory costing ${formatYen(rules.factoryPrice)}.`,
          `The combined upper demand forecast was ${upperDemand} goods. Existing capacity and inventory were visible.`,
          `The company sold ${sold} goods and paid ${formatYen(metrics.overhead)} in total factory overhead.`
        )
      );
    }

    if (
      information.warnings.highRate &&
      before.debt > 0 &&
      decision.debt >= 0 &&
      plan.noSalesCash >= 2000 &&
      metrics.interest >= 100
    ) {
      add(
        "rates",
        "Consider the cost of keeping loans",
        "Borrowing costs",
        "Retaining debt can be a deliberate trade-off. Explain why keeping the funds was worth the interest, or why repayment would have been preferable.",
        metrics.interest,
        evidence(
          entry,
          `Your plan retained ${formatYen(plan.plannedDebt)} of debt before scheduled principal payments.`,
          `The displayed loan rate was ${(information.rate * 100).toFixed(1)}% per round. The no-sales cash preview was ${formatYen(plan.noSalesCash)}.`,
          `The company paid ${formatYen(metrics.interest)} in interest.`
        )
      );
    }

    if (
      metrics.forcedLoss >= 100 &&
      (
        decision.stocks > 0 ||
        decision.property > 0 ||
        decision.factories > 0
      )
    ) {
      add(
        "liquidity",
        "Investments were not the same as available cash",
        "Liquidity",
        "Review how purchases and commitments interacted. Property and factories could not necessarily be converted back into cash at their recorded values.",
        metrics.forcedLoss,
        evidence(
          entry,
          "You committed additional funds to investments or a factory.",
          `The displayed no-sales cash estimate was ${formatYen(plan.noSalesCash)}. Sale restrictions and borrowing costs were available.`,
          `Emergency sales produced a discount loss of ${formatYen(metrics.forcedLoss)}.`
        )
      );
    }

    if (
      advice.marketing === "export" &&
      information.warnings.trade &&
      metrics.unsold >= 20
    ) {
      add(
        "trade",
        "Review export-focused advice during a trade constraint",
        "Marketing advice",
        "You chose a broad marketing priority, not the exact production schedule. Explain whether the visible trade constraint supported that priority.",
        Math.max(100, metrics.storage),
        evidence(
          entry,
          "You advised the company to prioritise export opportunities.",
          `The export forecast was ${information.forecast.export.join("–")} goods, and the briefing contained a trade warning.`,
          `Export sales were ${metrics.soldExport} goods; ${metrics.unsold} goods remained unsold across the company. This does not prove the advice alone caused the unsold inventory.`
        )
      );
    }
  }

  const review = [...groups.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(3, limit)))
    .map(({ score, ...item }) => ({
      ...item,
      evidence: item.evidence.slice(0, 3),
    }));

  if (review.length) return review;

  return [{
    key: "resilience",
    title: manual.length
      ? "An investment decision worth retaining or improving"
      : "Review the incomplete investment record",
    tag: "Investment review",
    lesson: manual.length
      ? "No major investment pattern met the review thresholds. This does not mean every decision was optimal. Explain an investment or advisory decision you would retain or improve."
      : "No submitted student investment plan could be assessed. Choose a briefing and explain the instructions you would have given.",
    evidence: [],
  }];
}