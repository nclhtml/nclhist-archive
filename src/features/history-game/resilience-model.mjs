import { formatYen } from "./advisor-model.mjs";

import {
  listedValue,
  markListed,
  emergencyListedSales,
} from "./dealing-model.mjs";

import {
  eightCreditLimit,
  eightNewLoanCap,
  propertyCostRemoved,
  eightReview,
} from "./eight-model.mjs";

export const RESILIENCE_VERSION = 2;
export const STARTING_NET_WORTH = 20000;

/*
 * FICTIONAL CLASSROOM PARAMETERS.
 *
 * One money unit is ¥10,000.
 * Each turn settles one model business quarter: three model months.
 * Historical round labels cover unequal periods and are not a literal
 * month-by-month reconstruction of Japanese company accounts.
 *
 * Profiles describe teaching scenarios, not every historical company
 * in an industry.
 */
export const INDUSTRIES = Object.freeze({
  electronics: {
    name: "Electronics and semiconductors",
    description:
      "Export exposure, expensive equipment and a strong need to maintain product competitiveness.",
    factoryPrice: 2600,
    unitCost: 69,
    domesticPrice: 106,
    exportPrice: 119,
    overhead: 900,
    domesticBase: 62,
    exportBase: 50,
    cycle: 1.25,
    delay: 0.18,
    depreciation: 0.04,
    efficiencyCost: 2000,
    developmentCost: 2400,
    electronicsExposure: 0.8,
    autoExposure: 0.1,
  },
  machinery: {
    name: "Automotive components and machinery",
    description:
      "Substantial factory commitments, export customers and opportunities to improve quality and efficiency.",
    factoryPrice: 2400,
    unitCost: 68,
    domesticPrice: 100,
    exportPrice: 113,
    overhead: 850,
    domesticBase: 62,
    exportBase: 46,
    cycle: 1,
    delay: 0.2,
    depreciation: 0.03,
    efficiencyCost: 1900,
    developmentCost: 2200,
    electronicsExposure: 0.1,
    autoExposure: 0.8,
  },
  essentials: {
    name: "Food and household essentials",
    description:
      "Steadier model demand and less export exposure, but lower margins and limited gains from unnecessary expansion.",
    factoryPrice: 1600,
    unitCost: 61,
    domesticPrice: 87,
    exportPrice: 94,
    overhead: 700,
    domesticBase: 100,
    exportBase: 12,
    cycle: 0.35,
    delay: 0.06,
    depreciation: 0.025,
    efficiencyCost: 1600,
    developmentCost: 1800,
    electronicsExposure: 0,
    autoExposure: 0,
  },
  materials: {
    name: "Construction materials",
    description:
      "Domestic construction exposure, costly equipment and relatively slow customer payments.",
    factoryPrice: 2500,
    unitCost: 66,
    domesticPrice: 102,
    exportPrice: 110,
    overhead: 1000,
    domesticBase: 108,
    exportBase: 8,
    cycle: 1.35,
    delay: 0.25,
    depreciation: 0.03,
    efficiencyCost: 2000,
    developmentCost: 2100,
    electronicsExposure: 0,
    autoExposure: 0.05,
  },
});

export const PROJECT_LABELS = Object.freeze({
  none: "No additional improvement project",
  efficiency: "Improve production efficiency",
  development: "Develop products and customer markets",
});

const copy = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const midpoint = (range) => (range[0] + range[1]) / 2;
const totalDebt = (loans) =>
  loans.reduce((sum, loan) => sum + loan.balance, 0);

class InvestmentError extends Error { }

export function industryFor(id) {
  if (!Object.prototype.hasOwnProperty.call(INDUSTRIES, id)) {
    throw new InvestmentError("Choose one of the available company industries.");
  }

  return INDUSTRIES[id];
}

export function initialCompany(industry) {
  const profile = industryFor(industry);
  const factoryBook = profile.factoryPrice * 2;

  return {
    economyVersion: RESILIENCE_VERSION,
    industry,
    initialNetWorth: STARTING_NET_WORTH,
    cash: STARTING_NET_WORTH - factoryBook,
    debt: 0,
    loans: [],
    stocks: 0,
    property: 0,
    factories: 2,
    committedFactories: 2,
    factoryBook,
    inventory: 0,
    inventoryBook: 0,
    receivables: 0,
    efficiency: 0,
    development: 0,
    project: null,
    suspended: false,
    failureReason: "",
  };
}

export function companyValue(state, rules = {}) {
  if (state.economyVersion === RESILIENCE_VERSION) {
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

  return Math.round(
    state.cash +
    state.stocks +
    state.property +
    state.factories * rules.factoryPrice +
    state.inventory * rules.unitCost -
    state.debt
  );
}

export function defaultInvestmentPlan() {
  return {
    buyStocks: 0,
    buyProperty: 0,
    sellStocks: 0,
    sellProperty: 0,
    loanMode: "hold",
    loanPercent: 0,
    factoryChange: 0,
    marketing: "balanced",
    project: "none",
    reserveRelease: 0,
  };
}

function integer(value, minimum, maximum, label) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new InvestmentError(
      `${label} must be a whole number from ${minimum} to ${maximum}.`
    );
  }

  return value;
}

function checkedInstructions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvestmentError("Investment instructions are required.");
  }

  const keys = Object.keys(defaultInvestmentPlan());

  if (Object.keys(input).some((key) => !keys.includes(key))) {
    throw new InvestmentError("Unexpected investment instruction.");
  }

  const advice = {};

  for (const key of [
    "buyStocks",
    "buyProperty",
    "sellStocks",
    "sellProperty",
    "loanPercent",
    "reserveRelease",
  ]) {
    advice[key] = integer(input[key], 0, 100, key);
  }

  advice.factoryChange = integer(
    input.factoryChange, -1, 1, "Factory recommendation"
  );

  if (!["hold", "borrow", "repay"].includes(input.loanMode)) {
    throw new InvestmentError("Choose a valid loan instruction.");
  }

  if (!["balanced", "domestic", "export"].includes(input.marketing)) {
    throw new InvestmentError("Choose a valid marketing recommendation.");
  }

  if (!Object.prototype.hasOwnProperty.call(PROJECT_LABELS, input.project)) {
    throw new InvestmentError("Choose a valid improvement project.");
  }

  advice.loanMode = input.loanMode;
  advice.marketing = input.marketing;
  advice.project = input.project;

  if (advice.loanMode === "hold" && advice.loanPercent !== 0) {
    throw new InvestmentError(
      "Set the loan percentage to zero when leaving loans unchanged."
    );
  }

  if (advice.buyStocks + advice.buyProperty > 100) {
    throw new InvestmentError(
      "Investment allocations plus retained cash cannot exceed 100%."
    );
  }

  if (advice.buyStocks > 0 && advice.sellStocks > 0) {
    throw new InvestmentError(
      "Clear the share sale before buying shares this round."
    );
  }

  if (advice.buyProperty > 0 && advice.sellProperty > 0) {
    throw new InvestmentError(
      "Clear the property sale before buying property this round."
    );
  }

  return advice;
}

export function companyTerms(state, rules, brief) {
  const profile = industryFor(state.industry);
  const economy = rules.economy;

  if (
    !economy ||
    economy.version !== RESILIENCE_VERSION ||
    !brief?.forecast
  ) {
    throw new InvestmentError("The Resilience round conditions are missing.");
  }

  const sectorEvents = (brief.events || []).filter((event) =>
    ["electronics", "car-threat", "car-settlement"].includes(event.id)
  );

  const exposure = (event) =>
    event.id === "electronics"
      ? profile.electronicsExposure
      : profile.autoExposure;

  /*
   * Remove the original pooled trade-event adjustment before applying
   * the appropriate company-industry exposure.
   */
  const exportBenchmark =
    midpoint(brief.forecast.export) -
    sectorEvents.reduce(
      (sum, event) => sum + event.effects.exportDelta,
      0
    );

  const developmentDemand = 1 + state.development * 0.08;

  const domesticCenter = Math.max(0, Math.round(
    profile.domesticBase *
    clamp(
      1 + profile.cycle *
      (midpoint(brief.forecast.domestic) / 100 - 1),
      0.25,
      1.7
    ) *
    developmentDemand
  ));

  const exportCenter = Math.max(0, Math.round(
    profile.exportBase *
    clamp(
      1 + profile.cycle * (exportBenchmark / 75 - 1),
      0.15,
      1.8
    ) *
    developmentDemand +
    sectorEvents.reduce(
      (sum, event) => sum + event.effects.exportDelta * exposure(event),
      0
    )
  ));

  const range = (center) => [
    Math.max(0, Math.floor(center * 0.85)),
    Math.ceil(center * 1.15),
  ];

  const sellingFactor =
    clamp(1 + (economy.priceLevel - 1) * profile.cycle, 0.55, 1.5) *
    (1 + state.development * 0.04);

  const unitCost = Math.max(1, Math.round(
    profile.unitCost *
    economy.costLevel *
    (1 - state.efficiency * 0.07)
  ));

  const exportPriceAdjustment = sectorEvents.reduce(
    (sum, event) =>
      sum + event.effects.exportPriceDelta * exposure(event),
    0
  );

  const averageFactoryBook = state.factories > 0
    ? Math.floor(state.factoryBook / state.factories)
    : 0;

  return {
    industryName: profile.name,
    months: 3,
    forecast: {
      domestic: range(domesticCenter),
      export: range(exportCenter),
    },
    rate: brief.rate,
    unitCost,
    domesticPrice: Math.max(
      1, Math.round(profile.domesticPrice * sellingFactor)
    ),
    exportPrice: Math.max(
      1,
      Math.round(
        profile.exportPrice * sellingFactor + exportPriceAdjustment
      )
    ),
    factoryPrice: profile.factoryPrice,
    factoryResale: Math.floor(
      averageFactoryBook * economy.factorySaleRate
    ),
    factoryCapacity: 50,
    maxFactories: 5,
    factoryOverhead: Math.round(
      profile.overhead *
      economy.payrollLevel *
      (1 - state.efficiency * 0.04)
    ),
    storagePerUnit: 5,
    depreciationRate: profile.depreciation,
    paymentDelay: clamp(profile.delay + economy.delay, 0, 0.6),
    expectedWriteOff: economy.writeOff,
    renewalFraction: economy.renewal,
    loanTermRounds: economy.lessonVersion === 4 ? 2 : 3,
    efficiencyCost: Math.round(
      profile.efficiencyCost *
      (state.performanceVersion === 1 ? 0.6 : 1)
    ),
    developmentCost: Math.round(
      profile.developmentCost *
      (state.performanceVersion === 1 ? 0.75 : 1)
    ),
    noEfficiencyUnitCost: Math.max(
      1,
      Math.round(profile.unitCost * economy.costLevel)
    ),
    noEfficiencyFactoryOverhead: Math.round(
      profile.overhead * economy.payrollLevel
    ),
  };
}

function creditLimit(state, rules) {
  if (rules.economy?.lessonVersion === 4) {
    return eightCreditLimit(state, rules);
  }

  return Math.max(0, Math.min(
    rules.maxDebt,
    Math.floor(
      (
        rules.creditBase +
        state.stocks * rules.stockCollateral +
        state.property * rules.propertyCollateral +
        state.factoryBook * rules.factoryCollateral +
        state.receivables * 0.15
      ) * rules.creditFactor
    )
  ));
}

function repayLoans(loans, requested) {
  let remaining = requested;

  const result = copy(loans).sort(
    (a, b) =>
      a.dueRound - b.dueRound ||
      a.originRound - b.originRound
  );

  for (const loan of result) {
    const payment = Math.min(loan.balance, remaining);
    loan.balance -= payment;
    remaining -= payment;
  }

  if (remaining !== 0) {
    throw new Error("The loan ledger does not match the requested repayment.");
  }

  return result.filter((loan) => loan.balance > 0);
}

function principalAssessment(state, rules, terms, round) {
  const maturing = state.loans
    .filter((loan) => loan.dueRound <= round)
    .reduce((sum, loan) => sum + loan.balance, 0);

  const maturityPayment = Math.ceil(
    maturing * (1 - terms.renewalFraction)
  );

  const scheduled = Math.ceil(state.debt * rules.principalRate);
  const collateralPayment = Math.max(
    0, state.debt - creditLimit(state, rules)
  );

  return {
    maturing,
    requested: Math.min(
      state.debt,
      Math.max(maturityPayment, scheduled, collateralPayment)
    ),
  };
}

/*
 * Management uses the centre of PUBLIC forecasts.
 * Forecast lower bounds are NOT guaranteed minimum sales.
 */
function managementPlan(state, capacity, funding, terms, marketing) {
  const maximum = Math.max(
    0,
    Math.min(capacity, Math.floor(funding / terms.unitCost))
  );

  const domesticDemand = Math.round(midpoint(terms.forecast.domestic));
  const exportDemand = Math.round(midpoint(terms.forecast.export));

  let best = null;

  for (let production = 0; production <= maximum; production += 1) {
    const available = state.inventory + production;

    for (let exports = 0; exports <= 100; exports += 10) {
      const exportAllocation = Math.floor(available * exports / 100);
      const domesticAllocation = available - exportAllocation;

      const soldExport = Math.min(exportAllocation, exportDemand);
      const soldDomestic = Math.min(domesticAllocation, domesticDemand);
      const unsold = available - soldExport - soldDomestic;

      const revenue =
        soldDomestic * terms.domesticPrice +
        soldExport * terms.exportPrice;

      const margin =
        revenue -
        production * terms.unitCost -
        unsold * terms.storagePerUnit;

      const preference = marketing === "domestic"
        ? soldDomestic * 12
        : marketing === "export"
          ? soldExport * 12
          : 0;

      const score = margin + preference;

      if (
        !best ||
        score > best.score ||
        (
          score === best.score &&
          production < best.production
        )
      ) {
        best = {
          score,
          production,
          exports,
          expectedRevenue: revenue,
          expectedUnsold: unsold,
        };
      }
    }
  }

  return best;
}

export function prepareInvestment(state, input, rules, brief) {
  try {
    if (state.economyVersion !== RESILIENCE_VERSION) {
      throw new InvestmentError("This company uses a different economic model.");
    }

    if (state.suspended) {
      throw new InvestmentError("This company's operations are suspended.");
    }

    if (totalDebt(state.loans) !== state.debt) {
      throw new Error("Company debt and its loan ledger disagree.");
    }

    const advice = checkedInstructions(input);

    if (
      state.lessonVersion === 4 &&
      (advice.buyStocks !== 0 || advice.sellStocks !== 0)
    ) {
      throw new InvestmentError(
        "Use the Shares tab to trade individual companies."
      );
    }

    const terms = companyTerms(state, rules, brief);
    const problems = [];
    const round = brief.index;

    const maximumPropertyPercent = Math.floor(
      rules.propertySaleFraction * 100
    );

    if (advice.sellProperty > maximumPropertyPercent) {
      throw new InvestmentError(
        `Only ${maximumPropertyPercent}% of property can be sold this round.`
      );
    }

    const factories = state.factories + advice.factoryChange;

    if (factories < 1 || factories > terms.maxFactories) {
      throw new InvestmentError(
        `Keep between 1 and ${terms.maxFactories} factories.`
      );
    }

    if (
      advice.project !== "none" &&
      (
        state.project ||
        state[advice.project] >= 3
      )
    ) {
      throw new InvestmentError(
        "Finish the current project first. Each improvement is limited to three levels."
      );
    }

    const proposed = copy(state);

    const stockSaleValue = Math.floor(
      state.stocks * advice.sellStocks / 100
    );

    const propertySaleValue = Math.floor(
      state.property * advice.sellProperty / 100
    );

    const propertySaleCash = Math.floor(
      propertySaleValue * rules.propertyBid
    );

    const propertySoldCost = propertyCostRemoved(
      state,
      propertySaleValue
    );

    proposed.stocks -= stockSaleValue;
    proposed.property -= propertySaleValue;
    proposed.cash += stockSaleValue + propertySaleCash;

    if (state.lessonVersion === 4) {
      proposed.propertyCost =
        (state.propertyCost || 0) - propertySoldCost;
    }

    let factoryCost = 0;
    let voluntaryLoss = propertySaleValue - propertySaleCash;

    if (advice.factoryChange > 0) {
      factoryCost = terms.factoryPrice;
      proposed.factoryBook += terms.factoryPrice;
    } else if (advice.factoryChange < 0) {
      const bookSold = Math.floor(
        state.factoryBook / state.factories
      );

      factoryCost = -terms.factoryResale;
      proposed.factoryBook -= bookSold;
      voluntaryLoss += bookSold - terms.factoryResale;
    }

    proposed.factories = factories;
    proposed.cash -= factoryCost;

    const projectCost = advice.project === "efficiency"
      ? terms.efficiencyCost
      : advice.project === "development"
        ? terms.developmentCost
        : 0;

    if (projectCost > 0) {
      proposed.cash -= projectCost;
      proposed.project = {
        kind: advice.project,
        readyRound: round + 2,
        cost: projectCost,
      };
    }

    const borrowLimit = Math.max(0, Math.min(
      state.lessonVersion === 4
        ? eightNewLoanCap(proposed, rules)
        : rules.maxNewDebt,
      rules.maxDebt - state.debt,
      creditLimit(proposed, rules) - state.debt
    ));

    const maxRepayPercent = state.debt > 0
      ? Math.min(100, Math.floor(
        Math.max(0, Math.min(state.debt, proposed.cash)) /
        state.debt * 100
      ))
      : 0;

    const loanChange = advice.loanMode === "borrow"
      ? Math.floor(borrowLimit * advice.loanPercent / 100)
      : advice.loanMode === "repay"
        ? -Math.floor(state.debt * advice.loanPercent / 100)
        : 0;

    if (loanChange > 0) {
      proposed.loans.push({
        originRound: round,
        dueRound: round + terms.loanTermRounds,
        balance: loanChange,
      });
    } else if (loanChange < 0) {
      proposed.loans = repayLoans(proposed.loans, -loanChange);
    }

    proposed.cash += loanChange;
    proposed.debt = totalDebt(proposed.loans);

    if (proposed.cash < 0) {
      problems.push(
        "The repayment, factory recommendation or project exceeds available funds."
      );
    }

    /*
     * Selling or closing a factory does not immediately erase all of
     * its current-period employment and contract commitments.
     */
    const overhead =
      Math.max(state.committedFactories, factories) *
      terms.factoryOverhead;

    const interest = Math.ceil(proposed.debt * terms.rate);

    const initialAssessment = principalAssessment(
      proposed, rules, terms, round
    );

    /*
     * A purchased factory starts producing next round.
     * Its funding and current commissioning/running commitments begin now.
     */
    const productiveFactories =
      state.factories + Math.min(0, advice.factoryChange);

    const productionFunds = Math.max(
      0,
      proposed.cash -
      overhead -
      interest -
      initialAssessment.requested
    );

    const operations = managementPlan(
      state,
      productiveFactories * terms.factoryCapacity,
      productionFunds,
      terms,
      advice.marketing
    );

    const productionCost = operations.production * terms.unitCost;

    const committedReserve =
      productionCost +
      overhead +
      interest +
      initialAssessment.requested;

    const recommendedBuffer = Math.ceil(
      Math.max(overhead, productionCost * 0.25) +
      proposed.debt * 0.04 +
      state.receivables * 0.1
    );

    const requestedBuffer = Math.ceil(
      recommendedBuffer * (1 - advice.reserveRelease / 100)
    );

    const bufferKept = Math.min(
      requestedBuffer,
      Math.max(0, proposed.cash - committedReserve)
    );

    const budget = Math.max(
      0,
      proposed.cash - committedReserve - requestedBuffer
    );

    const stockPurchase = Math.floor(
      budget * advice.buyStocks / 100
    );

    const propertyPurchase = Math.floor(
      budget * advice.buyProperty / 100
    );

    const purchasePercentLimit = budget > 0
      ? clamp(
        Math.ceil(
          (rules.maxInvestmentPurchase + 1) * 100 / budget
        ) - 1,
        0,
        100
      )
      : 100;

    if (
      stockPurchase > rules.maxInvestmentPurchase ||
      propertyPurchase > rules.maxInvestmentPurchase
    ) {
      problems.push(
        `Each market has a purchase limit of ${formatYen(rules.maxInvestmentPurchase)} this round.`
      );
    }

    proposed.cash -= stockPurchase + propertyPurchase;
    proposed.stocks += stockPurchase;
    proposed.property += propertyPurchase;

    if (state.lessonVersion === 4) {
      proposed.propertyCost += propertyPurchase;
    }

    const assessment = principalAssessment(
      proposed, rules, terms, round
    );

    if (
      loanChange > 0 &&
      proposed.debt > creditLimit(proposed, rules)
    ) {
      problems.push("The proposed loan exceeds the collateral ceiling.");
    }

    const cashAfterOrders = proposed.cash - productionCost;

    if (cashAfterOrders < 0) {
      problems.push("Purchases and planned production are unaffordable.");
    }

    const storageReserve =
      (state.inventory + operations.production) *
      terms.storagePerUnit;

    const noSalesCash =
      cashAfterOrders -
      overhead -
      interest -
      assessment.requested -
      storageReserve;

    const expectedNewReceivables = Math.round(
      operations.expectedRevenue * terms.paymentDelay
    );

    const expectedCollections =
      operations.expectedRevenue -
      expectedNewReceivables +
      Math.round(state.receivables * (1 - terms.expectedWriteOff));

    const expectedOperatingCash =
      expectedCollections -
      productionCost -
      overhead -
      operations.expectedUnsold * terms.storagePerUnit;

    return {
      version: RESILIENCE_VERSION,
      valid: problems.length === 0,
      problems,
      advice,
      terms,
      proposed,
      operations,

      decision: {
        debt: loanChange,
        stocks: stockPurchase - stockSaleValue,
        property: propertyPurchase - propertySaleValue,
        factories: advice.factoryChange,
        production: operations.production,
        exports: operations.exports,
      },

      budget,
      stockPurchase,
      propertyPurchase,
      cashAllocation: budget - stockPurchase - propertyPurchase,
      cashPercent: 100 - advice.buyStocks - advice.buyProperty,
      purchasePercentLimit,
      stockSaleValue,
      propertySaleValue,
      propertySaleCash,
      propertySoldCost,
      propertyRealized: propertySaleCash - propertySoldCost,
      factoryCost,
      projectCost,
      voluntaryLoss,

      borrowLimit,
      maxRepayPercent,
      loanChange,
      plannedDebt: proposed.debt,
      creditCeiling: creditLimit(proposed, rules),
      maturingDebt: assessment.maturing,

      productionCost,
      overhead,
      interest,
      principal: assessment.requested,
      principalReserve: initialAssessment.requested,
      storageReserve,
      committedReserve,
      recommendedBuffer,
      bufferKept,
      operatingReserve: committedReserve + bufferKept,
      cashAfterOrders,
      noSalesCash,
      expectedOperatingCash,
    };
  } catch (error) {
    if (error instanceof InvestmentError) {
      return {
        version: RESILIENCE_VERSION,
        valid: false,
        problems: [error.message],
      };
    }

    throw error;
  }
}

export function openCompany(state, packet) {
  let after = copy(state);
  const completedProjects = [];

  if (!state.suspended) {
    if (after.project && after.project.readyRound <= packet.index) {
      after[after.project.kind] += 1;
      completedProjects.push(PROJECT_LABELS[after.project.kind]);
      after.project = null;
    }

    after.stocks = Math.max(0, Math.round(
      state.stocks * (1 + packet.combined.stockBps / 10000)
    ));

    after.property = Math.max(0, Math.round(
      state.property * (1 + packet.combined.propertyBps / 10000)
    ));

    if (packet.dealing && after.listed) {
      after = markListed(after, packet.dealing.path[0]);
    }
  }

  return {
    round: packet.index,
    before: copy(state),
    after,
    stockChange: after.stocks - state.stocks,
    propertyChange: after.property - state.property,
    listedChange: listedValue(after) - listedValue(state),
    completedProjects,
  };
}

function emptyMetrics() {
  return Object.fromEntries([
    "revenue", "cashCollections", "creditSales", "receivableLoss",
    "productionCost", "costOfGoodsSold", "overhead", "interest",
    "storage", "stockIncome", "propertyIncome", "principalDue",
    "soldDomestic", "soldExport", "unsold", "stockChange",
    "propertyChange", "voluntaryLoss", "forcedLoss", "arrears",
    "factoryDepreciation", "inventoryWriteDown", "projectCost",
    "operatingCashFlow", "operatingProfit", "netProfit",
    "refinancedDebt",
  ].map((key) => [key, 0]));
}

export function closeCompany(
  state,
  investment,
  packet,
  defaulted,
  opening
) {
  if (!opening || opening.round !== packet.index) {
    throw new Error("This company's round has not been opened correctly.");
  }

  const terms = companyTerms(state, packet.rules, packet.brief);

  /*
   * Full newspapers are stored once in the room's briefHistory.
   * Company histories retain the company-specific information and evidence.
   */
  const base = {
    economyVersion: RESILIENCE_VERSION,
    round: packet.index,
    date: packet.brief.date,
    before: copy(state),
    opening: copy(opening),
    information: {
      index: packet.index,
      date: packet.brief.date,
      headline: packet.brief.headline,
      body: "Inspect the archived newspaper for this period's historical briefing.",
      rate: terms.rate,
      forecast: copy(terms.forecast),
      warnings: copy(packet.brief.warnings),
      rules: copy(terms),
    },
    terms: copy(terms),
  };

  if (state.suspended) {
    return {
      ...base,
      after: copy(state),
      decision: {
        debt: 0, stocks: 0, property: 0,
        factories: 0, production: 0, exports: 0,
      },
      advisor: null,
      defaulted: false,
      inactive: true,
      liquidations: [],
      metrics: {
        ...emptyMetrics(),
        unsold: state.inventory,
      },
    };
  }

  if (
    !investment ||
    !investment.valid ||
    investment.version !== RESILIENCE_VERSION
  ) {
    throw new Error("A valid saved Resilience investment plan is required.");
  }

  const plan = copy(investment);
  const after = copy(plan.proposed);

  /*
   * Live trades invalidate submitted plans. Price updates do not.
   * Use the actual holdings and final marks supplied by the server,
   * rather than the older price marks stored with the submitted plan.
   */
  if (state.listed) {
    after.listed = copy(state.listed);
    after.listedPrices = copy(state.listedPrices);
    after.dealingTotals = copy(state.dealingTotals);
  }

  if (state.lessonVersion === 4) {
    plan.principal = principalAssessment(
      after,
      packet.rules,
      terms,
      packet.index
    ).requested;
  }

  const shock = packet.outcome.economy[state.industry];

  const domesticDemand = Math.max(0, Math.round(
    midpoint(terms.forecast.domestic) * shock.domesticFactor
  ));

  const exportDemand = Math.max(0, Math.round(
    midpoint(terms.forecast.export) * shock.exportFactor
  ));

  const available = state.inventory + plan.operations.production;
  const exportAllocation = Math.floor(
    available * plan.operations.exports / 100
  );

  const soldExport = Math.min(exportAllocation, exportDemand);
  const soldDomestic = Math.min(
    available - exportAllocation,
    domesticDemand
  );

  const sold = soldDomestic + soldExport;
  const unsold = available - sold;

  const revenue =
    soldDomestic * terms.domesticPrice +
    soldExport * terms.exportPrice;

  const creditSales = Math.round(revenue * terms.paymentDelay);

  const receivableLoss = Math.round(
    state.receivables * shock.writeOff
  );

  const cashCollections =
    revenue -
    creditSales +
    state.receivables -
    receivableLoss;

  const goodsCost = state.inventoryBook + plan.productionCost;
  const costOfGoodsSold = available > 0
    ? Math.floor(goodsCost * sold / available)
    : 0;

  const unsoldBook = goodsCost - costOfGoodsSold;

  const recoverableInventory = Math.floor(
    unsold * Math.min(terms.domesticPrice, terms.exportPrice) * 0.85
  );

  const inventoryWriteDown = Math.max(
    0, unsoldBook - recoverableInventory
  );

  const residualFactoryBook = Math.floor(
    after.factories * terms.factoryPrice * 0.15
  );

  const factoryDepreciation = Math.max(0, Math.min(
    Math.ceil(after.factoryBook * terms.depreciationRate),
    after.factoryBook - residualFactoryBook
  ));

  const storage = unsold * terms.storagePerUnit;
  const stockIncome = Math.floor(
    after.stocks * packet.rules.stockYield
  );
  const propertyIncome = Math.floor(
    after.property * packet.rules.propertyYield
  );

  after.cash +=
    -plan.productionCost +
    cashCollections +
    stockIncome +
    propertyIncome -
    plan.overhead -
    plan.interest -
    storage -
    plan.principal;

  after.receivables = creditSales;
  after.inventory = unsold;
  after.inventoryBook = unsoldBook - inventoryWriteDown;
  after.factoryBook -= factoryDepreciation;

  after.loans = repayLoans(after.loans, plan.principal);

  const refinancedDebt = after.loans
    .filter((loan) => loan.dueRound <= packet.index)
    .reduce((sum, loan) => sum + loan.balance, 0);

  after.loans = after.loans.map((loan) =>
    loan.dueRound <= packet.index
      ? {
        ...loan,
        dueRound: packet.index + terms.loanTermRounds,
      }
      : loan
  );

  after.debt = totalDebt(after.loans);

  /*
   * Emergency closures leave one period of employment/contract
   * commitments. This number is set before forced factory sales.
   */
  after.committedFactories = after.factories;

  const liquidations = [];
  let forcedLoss = 0;
  let propertyEmergencyRealized = 0;

  function liquidate(field, recovery) {
    if (after.cash >= 0 || after[field] <= 0) return;

    const bookValue = Math.min(
      after[field],
      Math.ceil(-after.cash / recovery)
    );

    const proceeds = Math.floor(bookValue * recovery);

    if (field === "property" && state.lessonVersion === 4) {
      const removedCost = propertyCostRemoved(after, bookValue);
      after.propertyCost -= removedCost;
      propertyEmergencyRealized += proceeds - removedCost;
    }

    after[field] -= bookValue;
    after.cash += proceeds;
    forcedLoss += bookValue - proceeds;

    liquidations.push({ asset: field, bookValue, proceeds });
  }

  liquidate("stocks", packet.rules.emergencyStockRate);

  const listedSales = emergencyListedSales(
    after,
    packet.rules.emergencyStockRate
  );

  forcedLoss += listedSales.loss;
  liquidations.push(...listedSales.sales);

  liquidate("property", packet.rules.emergencyPropertyRate);

  while (after.cash < 0 && after.factories > 0) {
    const bookValue = Math.floor(
      after.factoryBook / after.factories
    );

    const proceeds = Math.floor(bookValue * 0.5);

    after.factories -= 1;
    after.factoryBook -= bookValue;
    after.cash += proceeds;
    forcedLoss += bookValue - proceeds;

    liquidations.push({
      asset: "factory",
      bookValue,
      proceeds,
    });
  }

  const arrears = Math.max(0, -after.cash);

  if (arrears > 0) {
    after.loans.push({
      originRound: packet.index,
      dueRound: packet.index + 1,
      balance: arrears,
    });
    after.cash = 0;
  }

  after.debt = totalDebt(after.loans);

  after.suspended =
    arrears > 0 ||
    after.factories === 0 ||
    companyValue(after) <= 0;

  after.failureReason = arrears > 0
    ? "The company could not meet its cash commitments after emergency sales."
    : after.factories === 0
      ? "All productive factories were lost. The company can no longer operate in this model."
      : companyValue(after) <= 0
        ? "Recorded liabilities equal or exceed recorded assets."
        : "";

  const operatingCashFlow =
    cashCollections -
    plan.productionCost -
    plan.overhead -
    storage;

  const efficiencySavings = state.performanceVersion === 1
    ? Math.max(0,
      plan.operations.production *
      (terms.noEfficiencyUnitCost - terms.unitCost) +
      Math.max(
        state.committedFactories,
        plan.proposed.factories
      ) * terms.noEfficiencyFactoryOverhead -
      plan.overhead
    )
    : 0;

  if (state.lessonVersion === 4) {
    after.recentOperatingCash = Math.round(
      (state.recentOperatingCash ?? operatingCashFlow) * 0.5 +
      operatingCashFlow * 0.5
    );
  }

  const operatingProfit =
    revenue -
    costOfGoodsSold -
    plan.overhead -
    storage -
    receivableLoss -
    factoryDepreciation -
    inventoryWriteDown -
    plan.projectCost;

  const netProfit =
    operatingProfit +
    stockIncome +
    propertyIncome -
    plan.interest -
    plan.voluntaryLoss -
    forcedLoss;

  /*
   * Accounting identity:
   * opening net worth + this period's net profit = closing net worth.
   * Opening investment repricing is already included in state.
   */
  if (companyValue(after) - companyValue(state) !== netProfit) {
    throw new Error("The company's accounts failed their reconciliation.");
  }

  return {
    ...base,
    after,
    decision: copy(plan.decision),
    defaulted,
    inactive: false,
    liquidations,
    market: { domesticDemand, exportDemand },
    advisor: {
      version: RESILIENCE_VERSION,
      advice: copy(plan.advice),
      plan: {
        noSalesCash: plan.noSalesCash,
        plannedDebt: plan.plannedDebt,
        principal: plan.principal,
        budget: plan.budget,
        recommendedBuffer: plan.recommendedBuffer,
        bufferKept: plan.bufferKept,
        expectedOperatingCash: plan.expectedOperatingCash,
        projectCost: plan.projectCost,
      },
    },
    metrics: {
      revenue,
      cashCollections,
      creditSales,
      receivableLoss,
      productionCost: plan.productionCost,
      costOfGoodsSold,
      overhead: plan.overhead,
      interest: plan.interest,
      storage,
      stockIncome,
      propertyIncome,
      principalDue: plan.principal,
      soldDomestic,
      soldExport,
      unsold,
      stockChange: opening.stockChange,
      propertyChange: opening.propertyChange,
      voluntaryLoss: plan.voluntaryLoss,
      forcedLoss,
      arrears,
      factoryDepreciation,
      inventoryWriteDown,
      projectCost: plan.projectCost,
      propertyRealized: plan.propertyRealized || 0,
      propertyEmergencyRealized,
      efficiencySavings,
      operatingCashFlow,
      operatingProfit,
      netProfit,
      refinancedDebt,
    },
  };
}

export function buildCompanyReview(history, limit = 3) {
  if (history.some((entry) => entry.before.lessonVersion === 4)) {
    return eightReview(history, limit);
  }

  const candidates = [];
  const manual = history.filter(
    (entry) => !entry.defaulted && !entry.inactive && entry.advisor
  );

  function add(key, title, lesson, score, entry, decision, known, outcome) {
    candidates.push({
      key,
      title,
      tag: "Investment adviser review",
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

  for (const entry of manual) {
    const advice = entry.advisor.advice;
    const plan = entry.advisor.plan;
    const metrics = entry.metrics;

    if (metrics.forcedLoss >= 100 && advice.reserveRelease > 0) {
      add(
        "liquidity",
        "Review the decision to release the safety buffer",
        "The buffer was not a fee. Releasing it increased investable funds but reduced protection against weaker receipts and commitments.",
        metrics.forcedLoss,
        entry,
        `You released ${advice.reserveRelease}% of the recommended buffer.`,
        `The no-customer-receipts cash estimate was ${formatYen(plan.noSalesCash)}.`,
        `Emergency sales produced a discount loss of ${formatYen(metrics.forcedLoss)}.`
      );
    }

    const priorCapacity =
      entry.before.factories * entry.terms.factoryCapacity +
      entry.before.inventory;

    const upperDemand =
      entry.terms.forecast.domestic[1] +
      entry.terms.forecast.export[1];

    if (
      entry.decision.factories > 0 &&
      upperDemand <= priorCapacity + 15
    ) {
      add(
        "capacity",
        "Review whether another factory was needed",
        "Extra capacity did not guarantee additional customers. Management chose production; you recommended the capacity investment.",
        entry.terms.factoryPrice / 2,
        entry,
        `You recommended a factory costing ${formatYen(entry.terms.factoryPrice)}.`,
        `The combined upper demand estimate was ${upperDemand} goods; existing capacity and inventory were visible.`,
        `Current-period factory commitments cost ${formatYen(metrics.overhead)}. The new capacity becomes available next round.`
      );
    }

    if (
      advice.project !== "none" &&
      metrics.projectCost > 0
    ) {
      add(
        "productive",
        "Evaluate an investment in the business itself",
        "A productive project has an upfront cost and a delay. Explain its expected benefit without assuming that every internal investment is automatically worthwhile.",
        metrics.projectCost / 3,
        entry,
        `${PROJECT_LABELS[advice.project]}: ${formatYen(metrics.projectCost)}.`,
        "The stated completion time was two round openings, and the project's cost reduced current funds.",
        `Company operating cash flow that period was ${formatYen(metrics.operatingCashFlow)}. This alone does not measure the project's later benefit.`
      );
    }
  }

  for (const lossEntry of history) {
    const loss =
      Math.max(0, -lossEntry.metrics.stockChange) +
      Math.max(0, -lossEntry.metrics.propertyChange);

    if (loss < 500 || lossEntry.before.debt <= 0) continue;

    const prior = [...manual].reverse().find((entry) =>
      entry.round < lossEntry.round &&
      entry.decision.debt > 0 &&
      (entry.decision.stocks > 0 || entry.decision.property > 0) &&
      history
        .filter((item) =>
          item.round >= entry.round &&
          item.round < lossEntry.round
        )
        .every((item) =>
          item.after.debt > 0 &&
          item.after.stocks + item.after.property > 0
        )
    );

    if (!prior) continue;

    add(
      "leverage",
      "Borrowing amplified exposure to investment losses",
      "Review the exposure and financing decision, not whether you could predict the precise date of a crash.",
      loss,
      prior,
      `You added ${formatYen(prior.decision.debt)} of borrowing while purchasing investments.`,
      "Debt, maturity dates and the risk of asset-price falls were visible.",
      `At round ${lossEntry.round + 1}'s opening, held investments lost ${formatYen(loss)} while the company still owed money. This is not a claim that the whole loss came from one purchase.`
    );
  }

  const bestByTopic = new Map();

  for (const candidate of candidates) {
    const existing = bestByTopic.get(candidate.key);
    if (!existing || candidate.score > existing.score) {
      bestByTopic.set(candidate.key, candidate);
    }
  }

  const result = [...bestByTopic.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, clamp(limit, 1, 3))
    .map(({ score, ...item }) => item);

  if (result.length) return result;

  return [{
    key: "resilience",
    title: manual.length
      ? "Explain a decision worth retaining or improving"
      : "Review the incomplete investment record",
    tag: "Investment adviser review",
    lesson: manual.length
      ? "No major pattern met the review thresholds. That does not establish that every decision was optimal."
      : "No submitted student investment plan could be assessed. Use one of the briefings to explain the instructions you would have given.",
    evidence: [],
  }];
}

export function finalCompanyReport(player, finalPacket) {
  const history = player.history;
  const state = player.state;
  const active = history.filter((entry) => !entry.inactive);
  const recent = active.slice(-3);
  const starting = state.initialNetWorth;

  let peak = starting;
  let drawdown = 0;

  for (const entry of history) {
    for (const position of [entry.before, entry.after]) {
      const value = companyValue(position);
      peak = Math.max(peak, value);
      if (peak > 0) {
        drawdown = Math.max(drawdown, (peak - value) / peak);
      }
    }
  }

  const averageOperatingCash = recent.length
    ? Math.round(
      recent.reduce(
        (sum, entry) => sum + entry.metrics.operatingCashFlow,
        0
      ) / recent.length
    )
    : 0;

  const forcedLoss = active.reduce(
    (sum, entry) => sum + entry.metrics.forcedLoss,
    0
  );

  const productiveSpending = active.reduce(
    (sum, entry) =>
      sum +
      Math.max(0, entry.decision.factories) * entry.terms.factoryPrice +
      entry.metrics.projectCost,
    0
  );

  const valuationChanges = active.reduce(
    (sum, entry) =>
      sum +
      entry.metrics.stockChange +
      entry.metrics.propertyChange +
      (entry.opening.listedChange || 0) +
      (entry.metrics.dealingPriceChange || 0),
    0
  );

  let stressState = copy(state);
  let completedStressPeriods = 0;

  /*
   * Continuation stress test, not additional historical gameplay.
   * No actual company or database state is changed.
   */
  if (!state.suspended) {
    for (let step = 1; step <= 6; step += 1) {
      const index = finalPacket.index + step;

      const rules = {
        ...copy(finalPacket.rules),
        maxNewDebt: 0,
        economy: {
          ...copy(finalPacket.rules.economy),
          round: index,
          renewal: 0,
        },
      };

      const packet = {
        ...copy(finalPacket),
        index,
        rules,
        dealing: null,
        combined: {
          ...finalPacket.combined,
          stockBps: 0,
          propertyBps: 0,
        },
        brief: {
          ...copy(finalPacket.brief),
          index,
          date: `Continuation model quarter ${step}`,
          rules,
        },
        outcome: {
          economy: Object.fromEntries(
            Object.keys(INDUSTRIES).map((id) => [
              id,
              {
                domesticFactor: 0.85,
                exportFactor: 0.85,
                writeOff: rules.economy.writeOff,
              },
            ])
          ),
        },
      };

      const opening = openCompany(stressState, packet);

      const plan = prepareInvestment(
        opening.after,
        defaultInvestmentPlan(),
        rules,
        packet.brief
      );

      if (!plan.valid) {
        throw new Error("The continuation stress-test plan failed.");
      }

      const entry = closeCompany(
        opening.after, plan, packet, false, opening
      );

      stressState = entry.after;
      completedStressPeriods = step;

      if (stressState.suspended) break;
    }
  }

  const netWorth = companyValue(state);
  const stressed = !state.suspended && stressState.suspended;

  const restructured =
    forcedLoss > 0 ||
    active.some((entry) => entry.decision.factories < 0);

  const vulnerable =
    stressed ||
    averageOperatingCash < 0 ||
    state.debt > Math.max(1, netWorth) * 0.6;

  const outcome = state.suspended
    ? "Financial failure / closure"
    : vulnerable
      ? "Surviving but vulnerable"
      : restructured
        ? "Restructured survivor"
        : "Resilient survivor";

  const explanation = state.suspended
    ? state.failureReason
    : vulnerable
      ? "The company remained open, but its cash generation, debt exposure or continuation stress test shows that survival is not the same as lasting financial strength."
      : restructured
        ? "The company survived and passed the continuation checks, but asset sales or downsizing were part of its adjustment."
        : "The company remained open, generated non-negative recent operating cash flow and passed the stated continuation stress test.";

  return {
    version: RESILIENCE_VERSION,
    industry: industryFor(state.industry).name,
    outcome,
    explanation,
    starting,
    netWorth,
    cash: state.cash,
    debt: state.debt,
    receivables: state.receivables,
    averageOperatingCash,
    drawdown,
    productiveSpending,
    valuationChanges,
    forcedLoss,
    efficiency: state.efficiency,
    development: state.development,
    stress: {
      performed: !state.suspended,
      survived: !state.suspended && !stressState.suspended,
      periods: completedStressPeriods,
      cash: stressState.cash,
      netWorth: companyValue(stressState),
      assumptions: [
        "Six additional model quarters, not six reconstructed historical quarters.",
        "Demand is 15% below the final period's central company forecast.",
        "Final-period selling prices and costs continue.",
        "No asset-price recovery, new borrowing or renewal of maturing loans.",
        "Management continues routine operations; emergency sales remain possible.",
      ],
    },
    review: buildCompanyReview(history, 3),
  };
}