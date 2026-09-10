"use strict";

const crypto = require("node:crypto");

class GameError extends Error {}

const ENGINE_VERSION = 2;
const SCENARIO = "japan-1985-1995";

const clone = (value) => JSON.parse(JSON.stringify(value));

/*
 * CLASSROOM MODEL, NOT HISTORICAL FINANCIAL DATA.
 *
 * A round is an abstract decision period, not a calendar year.
 * Company interest charges are per round, not historical annual rates.
 *
 * Opening:
 *   Historical news -> revalue existing assets -> student decisions.
 *
 * Settlement:
 *   Trades -> production -> sales -> income -> bills -> emergency sales.
 *
 * Asset-price changes are NOT applied again at settlement.
 */
const RULES = Object.freeze({
  startingCash: 10000,
  startingFactories: 2,

  factoryPrice: 2000,
  factoryResale: 1500,
  factoryCapacity: 50,
  maxFactories: 5,
  workersPerFactory: 25,

  unitCost: 70,
  domesticPrice: 100,
  exportPrice: 115,
  factoryOverhead: 400,
  storagePerUnit: 5,

  maxDebt: 20000,
  maxNewDebt: 5000,
  maxInvestmentPurchase: 10000,

  creditBase: 4000,
  stockCollateral: 0.35,
  propertyCollateral: 0.6,
  factoryCollateral: 0.5,
  creditFactor: 1,

  principalRate: 0,
  propertySaleFraction: 1,
  propertyBid: 1,

  stockYield: 0.01,
  propertyYield: 0.015,

  emergencyStockRate: 0.8,
  emergencyPropertyRate: 0.55,
  emergencyFactoryPrice: 1000,
});

const SOURCES = {
  plaza: {
    title: "JBIC: Plaza Accord to Japan's bubble economy",
    url:
      "https://www.jbic.go.jp/en/information/today/today_202310/" +
      "jtd_202310_column1.html",
  },
  policy: {
    title: "Bank of Japan: Monetary policy in the 1980s",
    url:
      "https://www.imes.boj.or.jp/research/papers/english/15-E-12.pdf",
  },
  bubble: {
    title: "Bank of Japan: The asset price bubble and monetary policy",
    url:
      "https://www.imes.boj.or.jp/research/papers/english/me19-s1-14.pdf",
  },
  adjustment: {
    title: "Bank of Japan: Policy responses to post-bubble adjustments",
    url:
      "https://www.imes.boj.or.jp/research/papers/english/me19-s1-5.pdf",
  },
  electronics: {
    title: "USITC: Selected Japanese television products and 1987 duties",
    url:
      "https://www.usitc.gov/publications/tariff_affairs/pub2042.pdf",
  },
  cars: {
    title: "IMF: United States background papers, 1995 auto dispute",
    url:
      "https://www.elibrary.imf.org/view/journals/002/1995/094/" +
      "article-A009-en.xml",
  },
};

function effects(values = {}) {
  return {
    stockBps: 0,
    propertyBps: 0,
    domesticDelta: 0,
    exportDelta: 0,
    exportPriceDelta: 0,
    ...values,
  };
}

function fixed(
  id,
  kind,
  date,
  headline,
  body,
  badges,
  changes = {},
  sources = []
) {
  return {
    id,
    fixed: true,
    kind,
    tone: "fixed",
    date,
    headline,
    body,
    badges,
    effects: effects(changes),
    sources,
  };
}

/*
 * Basis points are used for asset-price changes:
 * 100 basis points = 1%.
 *
 * These changes are fictional teaching parameters.
 * They are not a reconstructed Nikkei or land-price dataset.
 */
const FIXED = Object.fromEntries([
  fixed(
    "mandate",
    "scenario",
    "Early 1985",
    "YOUR COMPANY HAS CAPITAL TO INVEST",
    "The board gives you responsibility for its cash, investments and " +
      "production. This opening company mandate is fictional. Compare " +
      "potential returns with the cash needed to keep the business operating.",
    ["B"]
  ),

  fixed(
    "plaza",
    "milestone",
    "22 September 1985",
    "PLAZA ACCORD CHANGES THE EXPORT BACKGROUND",
    "The United States, Japan, West Germany, France and the United Kingdom " +
      "agree on coordinated currency action. Subsequent yen appreciation " +
      "puts pressure on Japanese exporters.",
    ["C", "D"],
    { exportDelta: -20 },
    [SOURCES.plaza]
  ),

  fixed(
    "easing",
    "milestone",
    "1986",
    "MONETARY POLICY IS EASED",
    "The Bank of Japan lowers its official discount rate in stages. " +
      "The model combines easier credit with rising asset valuations; " +
      "this does not mean monetary policy was the only influence.",
    ["D", "B"],
    { stockBps: 1800, propertyBps: 1500 },
    [SOURCES.policy, SOURCES.bubble]
  ),

  fixed(
    "low-rate",
    "milestone",
    "23 February 1987",
    "OFFICIAL DISCOUNT RATE REACHES 2.5%",
    "The Bank of Japan's official discount rate reaches 2.5%. It remains " +
      "at that level until the first increase in May 1989. Your company's " +
      "separately displayed loan charge is a simplified game rate.",
    ["D", "B"],
    { stockBps: 2500, propertyBps: 2200 },
    [SOURCES.policy]
  ),

  fixed(
    "electronics",
    "milestone",
    "17 April 1987",
    "SELECTED JAPANESE PRODUCTS FACE US DUTIES",
    "The United States imposes 100% duties on selected Japanese products, " +
      "including certain colour televisions, in the semiconductor dispute. " +
      "Not all exports are covered. The model represents this through a " +
      "limited reduction in pooled export opportunities and selling prices.",
    ["C"],
    { exportDelta: -12, exportPriceDelta: -8 },
    [SOURCES.electronics]
  ),

  fixed(
    "optimism",
    "trend",
    "1988",
    "RISING ASSETS ENCOURAGE FURTHER BORROWING",
    "Optimistic expectations, lending and rising stock and land values " +
      "reinforce one another. Higher collateral values can make additional " +
      "borrowing possible, without removing the obligation to repay.",
    ["B", "D"],
    { stockBps: 3000, propertyBps: 2800 },
    [SOURCES.bubble]
  ),

  fixed(
    "capacity",
    "scenario",
    "Late-boom teaching scenario",
    "MORE FACTORIES DO NOT GUARANTEE MORE CUSTOMERS",
    "This compulsory model scenario holds demand below the most ambitious " +
      "expansion plans. It is not a claim about a particular number of " +
      "historically unsold cars. Check your inventory before expanding.",
    ["B"],
    { domesticDelta: -10 }
  ),

  fixed(
    "tightening-1989",
    "milestone",
    "May–December 1989",
    "THE BANK OF JAPAN BEGINS RAISING RATES",
    "The official discount rate rises to 3.25% in May, 3.75% in October " +
      "and 4.25% in December. Higher borrowing costs change the risks " +
      "attached to existing debt.",
    ["D", "B"],
    {},
    [SOURCES.policy]
  ),

  fixed(
    "late-boom",
    "trend",
    "Late 1989",
    "ASSET OPTIMISM PERSISTS DESPITE DEARER CREDIT",
    "Japanese share prices continue rising through the end of 1989. " +
      "In this model, valuations rise again while borrowing becomes " +
      "more expensive. Rising prices are not a repayment plan.",
    ["B"],
    { stockBps: 2200, propertyBps: 2200 },
    [SOURCES.bubble]
  ),

  fixed(
    "tightening-1990",
    "milestone",
    "March–August 1990",
    "TIGHTENING CONTINUES",
    "The official discount rate rises to 5.25% on 20 March and 6% on " +
      "30 August 1990. These were successive increases, not a single " +
      "overnight move from 2.5% to 6%.",
    ["D", "B"],
    {},
    [SOURCES.policy]
  ),

  fixed(
    "stock-collapse",
    "milestone",
    "1990",
    "SHARE VALUES FALL SHARPLY",
    "The equity downturn follows the end-1989 peak. Existing shareholdings " +
      "are revalued before this round's trading. Property is not given the " +
      "same simultaneous collapse, and debts do not disappear.",
    ["B", "D"],
    { stockBps: -3800 },
    [SOURCES.bubble]
  ),

  fixed(
    "land-downturn",
    "trend",
    "1991",
    "PROPERTY WEAKNESS FOLLOWS THE EQUITY DOWNTURN",
    "Land-price weakness spreads after the equity downturn. Falling " +
      "collateral values and reduced liquidity put pressure on borrowers. " +
      "The timing differed between locations and land-price measures.",
    ["B", "D"],
    { stockBps: -1200, propertyBps: -2000 },
    [SOURCES.bubble]
  ),

  fixed(
    "financial-strain",
    "trend",
    "1992",
    "BALANCE SHEETS AND INVENTORIES COME UNDER PRESSURE",
    "Weak demand, inventory adjustment and damaged balance sheets " +
      "prolong the strain. In the model, property is harder to sell " +
      "and lenders require more principal to be repaid.",
    ["B", "D"],
    { stockBps: -1500, propertyBps: -2200 },
    [SOURCES.adjustment]
  ),

  fixed(
    "uneven-adjustment",
    "trend",
    "1993–1994",
    "RELIEF DOES NOT REPAIR EVERY BALANCE SHEET",
    "Policy support provides some breathing room, but balance-sheet " +
      "adjustment and financial-sector problems remain. A partial share " +
      "rebound in the model does not restore previous property values.",
    ["B", "D"],
    { stockBps: 500, propertyBps: -1000 },
    [SOURCES.adjustment]
  ),

  fixed(
    "car-threat",
    "milestone",
    "May 1995",
    "US THREATENS DUTIES ON SELECTED LUXURY CARS",
    "The United States threatens 100% tariffs on 13 Japanese luxury-car " +
      "models. The model reduces some export opportunities through " +
      "uncertainty. It does not charge the threatened tariff.",
    ["C"],
    { stockBps: -800, propertyBps: -500, exportDelta: -15 },
    [SOURCES.cars]
  ),

  fixed(
    "car-settlement",
    "milestone",
    "28 June 1995",
    "NEGOTIATED AGREEMENT AVOIDS THE THREATENED TARIFFS",
    "An agreement prevents the threatened luxury-car tariffs from taking " +
      "effect. Some model export opportunities recover, but this does not " +
      "undo the earlier asset losses or end Japan's broader adjustment.",
    ["C", "B"],
    { stockBps: 300, propertyBps: -500, exportDelta: 12 },
    [SOURCES.cars, SOURCES.adjustment]
  ),
].map((item) => [item.id, item]));

/*
 * credit tuple:
 * [maximum new borrowing, collateral factor, principal fraction,
 *  voluntary property-sale fraction, property bid]
 */
const ROUNDS = Object.freeze([
  {
    date: "Early 1985",
    fixed: ["mandate"],
    rate: 0.06,
    domestic: 100,
    export: 75,
    credit: [5000, 1, 0, 1, 1],
  },
  {
    date: "September–December 1985",
    fixed: ["plaza"],
    rate: 0.06,
    domestic: 100,
    export: 75,
    credit: [5000, 1, 0, 1, 1],
  },
  {
    date: "1986",
    fixed: ["easing"],
    rate: 0.04,
    domestic: 105,
    export: 65,
    credit: [5000, 1, 0, 1, 1],
  },
  {
    date: "February–April 1987",
    fixed: ["low-rate", "electronics"],
    rate: 0.03,
    domestic: 115,
    export: 72,
    credit: [5000, 1, 0, 1, 1],
  },
  {
    date: "1988",
    fixed: ["optimism", "capacity"],
    rate: 0.03,
    domestic: 120,
    export: 70,
    credit: [5000, 1, 0, 1, 1],
  },
  {
    date: "May–December 1989",
    fixed: ["tightening-1989", "late-boom"],
    rate: 0.065,
    domestic: 110,
    export: 65,
    credit: [4000, 0.95, 0.05, 0.75, 0.97],
  },
  {
    date: "1990",
    fixed: ["tightening-1990", "stock-collapse"],
    rate: 0.1,
    domestic: 100,
    export: 60,
    credit: [1500, 0.85, 0.1, 0.5, 0.95],
  },
  {
    date: "1991",
    fixed: ["land-downturn"],
    rate: 0.085,
    domestic: 88,
    export: 55,
    credit: [500, 0.75, 0.15, 0.25, 0.9],
  },
  {
    date: "1992",
    fixed: ["financial-strain"],
    rate: 0.075,
    domestic: 70,
    export: 45,
    credit: [0, 0.6, 0.2, 0.15, 0.85],
  },
  {
    date: "1993–1994",
    fixed: ["uneven-adjustment"],
    rate: 0.055,
    domestic: 78,
    export: 50,
    credit: [500, 0.65, 0.15, 0.2, 0.88],
  },
  {
    date: "May 1995",
    fixed: ["car-threat"],
    rate: 0.045,
    domestic: 80,
    export: 52,
    credit: [500, 0.65, 0.1, 0.2, 0.88],
  },
  {
    date: "June–December 1995",
    fixed: ["car-settlement"],
    rate: 0.04,
    domestic: 85,
    export: 45,
    credit: [1000, 0.7, 0.1, 0.25, 0.9],
  },
]);

function optional(id, min, max, tone, headline, body, badges, changes) {
  return {
    id,
    min,
    max,
    fixed: false,
    kind: "scenario",
    tone,
    headline,
    body,
    badges,
    effects: effects(changes),
    sources: [],
  };
}

const OPTIONAL = [
  optional(
    "retailer-orders", 0, 5, "good",
    "RETAILERS REQUEST MORE GOODS",
    "Fictional event: additional domestic orders improve the demand forecast.",
    ["B"], { domesticDelta: 12 }
  ),
  optional(
    "asset-confidence", 0, 5, "good",
    "INVESTOR CONFIDENCE STRENGTHENS",
    "Fictional event: enthusiasm lifts model asset prices. Future gains are not guaranteed.",
    ["B"], { stockBps: 400, propertyBps: 300 }
  ),
  optional(
    "export-contract", 0, 5, "good",
    "A NEW EXPORT OPPORTUNITY APPEARS",
    "Fictional event: overseas distributors express additional interest.",
    ["C"], { exportDelta: 8 }
  ),
  optional(
    "soft-retail", 0, 5, "bad",
    "SOME RETAILERS REDUCE THEIR ORDERS",
    "Fictional event: domestic demand is weaker than the previous business mood suggested.",
    ["B"], { domesticDelta: -10 }
  ),
  optional(
    "export-setback", 0, 5, "bad",
    "OVERSEAS DISTRIBUTORS BECOME CAUTIOUS",
    "Fictional event: some export opportunities disappear.",
    ["C"], { exportDelta: -8 }
  ),
  optional(
    "valuation-doubts", 0, 5, "bad",
    "ANALYSTS QUESTION SHARE VALUATIONS",
    "Fictional event: a modest share-price setback interrupts market optimism.",
    ["B"], { stockBps: -300 }
  ),

  // No ordinary boom events are eligible from the 1990 round onward.
  optional(
    "local-contract", 6, 11, "good",
    "A LIMITED DOMESTIC CONTRACT PROVIDES RELIEF",
    "Fictional relief event: a modest order improves demand, not asset valuations.",
    ["B"], { domesticDelta: 8 }
  ),
  optional(
    "niche-export", 6, 11, "good",
    "A SMALL OVERSEAS MARKET REMAINS OPEN",
    "Fictional relief event: a few additional export opportunities remain available.",
    ["C"], { exportDelta: 5 }
  ),
  optional(
    "buyer-delay", 6, 11, "bad",
    "CUSTOMERS POSTPONE PURCHASES",
    "Fictional event: postponed orders make cash-flow planning harder.",
    ["B"], { domesticDelta: -8, exportDelta: -3 }
  ),
  optional(
    "market-anxiety", 6, 11, "bad",
    "MARKET ANXIETY ADDS TO SHARE LOSSES",
    "Fictional event: another limited downward adjustment affects model share prices.",
    ["B"], { stockBps: -200 }
  ),
  optional(
    "property-buyers", 7, 11, "bad",
    "PROPERTY BUYERS DEMAND LOWER VALUATIONS",
    "Fictional event: property-market weakness adds a further modest price reduction.",
    ["B"], { propertyBps: -100 }
  ),
];

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new GameError(
      `${label} must be a whole number between ${min} and ${max}.`
    );
  }
  return value;
}

function roundAt(index) {
  integer(index, 0, ROUNDS.length - 1, "Round");
  return ROUNDS[index];
}

function optionalEvents(index) {
  roundAt(index);

  return OPTIONAL
    .filter((item) => index >= item.min && index <= item.max)
    .map(({ min, max, ...item }) => ({
      ...clone(item),
      date: ROUNDS[index].date,
    }));
}

function defaultEventSettings() {
  return { count: 0, mode: "mixed", pinned: [] };
}

function normalizeEventSettings(index, input = defaultEventSettings()) {
  const round = roundAt(index);

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GameError("Event settings are required.");
  }

  if (Object.keys(input).some(
    (key) => !["count", "mode", "pinned"].includes(key)
  )) {
    throw new GameError("Unexpected event setting.");
  }

  const count = integer(input.count, 0, 3, "Event count");

  if (!["mixed", "good", "bad"].includes(input.mode)) {
    throw new GameError("Choose mixed, good or bad automatic events.");
  }

  if (
    !Array.isArray(input.pinned) ||
    input.pinned.some((id) => typeof id !== "string") ||
    new Set(input.pinned).size !== input.pinned.length
  ) {
    throw new GameError("Selected events must be a list without duplicates.");
  }

  const eligible = new Set(optionalEvents(index).map((item) => item.id));

  if (input.pinned.some((id) => !eligible.has(id))) {
    throw new GameError("One of the selected events is not available in this period.");
  }

  const minimum = round.fixed.length + input.pinned.length;

  if (minimum > 3 || (count !== 0 && count < minimum)) {
    throw new GameError(
      "There are not enough event slots for the compulsory and selected events."
    );
  }

  return {
    count,
    mode: input.mode,
    pinned: [...input.pinned].sort(),
  };
}

function seededRandom(seed, index, purpose) {
  let counter = 0;

  return () => {
    const digest = crypto.createHash("sha256")
      .update(`${seed}:${index}:${purpose}:${counter++}`)
      .digest();

    return digest.readUInt32BE(0) / 4294967296;
  };
}

function createPacket(index, seed, input = defaultEventSettings()) {
  const definition = roundAt(index);
  const settings = normalizeEventSettings(index, input);
  const random = seededRandom(seed, index, "events");

  const selected = definition.fixed.map((id) => clone(FIXED[id]));
  const pool = optionalEvents(index);

  for (const id of settings.pinned) {
    selected.push(clone(pool.find((item) => item.id === id)));
  }

  const minimum = selected.length;
  const count = settings.count ||
    (minimum + Math.floor(random() * (4 - minimum)));

  while (selected.length < count) {
    const candidates = pool.filter((item) =>
      !selected.some((chosen) => chosen.id === item.id) &&
      (settings.mode === "mixed" || item.tone === settings.mode)
    );

    if (!candidates.length) {
      throw new GameError("Not enough eligible events for these settings.");
    }

    selected.push(clone(
      candidates[Math.floor(random() * candidates.length)]
    ));
  }

  const combined = effects();

  for (const item of selected) {
    for (const key of Object.keys(combined)) {
      combined[key] += item.effects[key];
    }
  }

  const [
    maxNewDebt,
    creditFactor,
    principalRate,
    propertySaleFraction,
    propertyBid,
  ] = definition.credit;

  const rules = {
    ...RULES,
    maxNewDebt,
    creditFactor,
    principalRate,
    propertySaleFraction,
    propertyBid,
    exportPrice: RULES.exportPrice + combined.exportPriceDelta,
  };

  const domesticCenter = Math.max(
    0, definition.domestic + combined.domesticDelta
  );
  const exportCenter = Math.max(
    0, definition.export + combined.exportDelta
  );

  const forecast = {
    domestic: [Math.max(0, domesticCenter - 12), domesticCenter + 12],
    export: [Math.max(0, exportCenter - 8), exportCenter + 8],
  };

  const demandRandom = seededRandom(seed, index, "demand");

  function draw(range) {
    return range[0] +
      Math.floor(demandRandom() * (range[1] - range[0] + 1));
  }

  const sources = [
    ...new Map(
      selected.flatMap((item) => item.sources)
        .map((source) => [source.url, source])
    ).values(),
  ];

  const brief = {
    index,
    date: definition.date,
    headline: selected[0].headline,
    body:
      "Read the shared news and current trading terms. Opening market " +
      "movements have already changed existing holdings. New trades use " +
      "those updated values. Actual customer demand is revealed at settlement.",
    historical: selected.some((item) => item.kind === "milestone"),
    badges: [...new Set(selected.flatMap((item) => item.badges))],
    events: selected,
    rate: definition.rate,
    forecast,
    warnings: {
      speculation: true,
      weakDemand: index >= 4,
      trade: selected.some(
        (item) => item.badges.includes("C") && item.effects.exportDelta < 0
      ),
      highRate: index >= 5 && definition.rate >= 0.065,
    },
    rules,
    openingMove: {
      stockReturn: combined.stockBps / 10000,
      propertyReturn: combined.propertyBps / 10000,
    },
    sources,
  };

  return {
    engineVersion: ENGINE_VERSION,
    scenario: SCENARIO,
    index,
    settings,
    rules,
    combined,
    brief,
    outcome: {
      domesticDemand: draw(forecast.domestic),
      exportDemand: draw(forecast.export),
    },
  };
}

function publicRound(packet) {
  return clone(packet.brief);
}

function publicReport(packet) {
  return {
    index: packet.index,
    date: packet.brief.date,
    headline: "THE COMPANY BOOKS CLOSE FOR THIS ROUND",
    body:
      "The opening asset-price movements shown here are a recap, not another " +
      "price change. This settlement records sales, investment income, costs, " +
      "loan payments and any emergency sales. The final 1995 round does not " +
      "imply that Japan's broader economic difficulties ended that year.",
    historical: packet.brief.historical,
    badges: clone(packet.brief.badges),
    events: clone(packet.brief.events),
    stockReturn: packet.combined.stockBps / 10000,
    propertyReturn: packet.combined.propertyBps / 10000,
    domesticDemand: packet.outcome.domesticDemand,
    exportDemand: packet.outcome.exportDemand,
    sources: clone(packet.brief.sources),
  };
}

function initialState() {
  return {
    cash: RULES.startingCash,
    debt: 0,
    stocks: 0,
    property: 0,
    factories: RULES.startingFactories,
    inventory: 0,
    suspended: false,
  };
}

function equity(state, rules = RULES) {
  return Math.round(
    state.cash +
    state.stocks +
    state.property +
    state.factories * rules.factoryPrice +
    state.inventory * rules.unitCost -
    state.debt
  );
}

function creditLimit(state, rules = RULES) {
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

function principalDue(state, rules) {
  return Math.min(
    state.debt,
    Math.max(
      Math.ceil(state.debt * rules.principalRate),
      Math.max(0, state.debt - creditLimit(state, rules))
    )
  );
}

function markOpening(state, packet) {
  const after = { ...state };

  if (!state.suspended) {
    after.stocks = Math.max(0, Math.round(
      state.stocks * (10000 + packet.combined.stockBps) / 10000
    ));

    after.property = Math.max(0, Math.round(
      state.property * (10000 + packet.combined.propertyBps) / 10000
    ));
  }

  return {
    round: packet.index,
    before: { ...state },
    after,
    stockChange: after.stocks - state.stocks,
    propertyChange: after.property - state.property,
  };
}

function defaultDecision() {
  return {
    debt: 0,
    stocks: 0,
    property: 0,
    factories: 0,
    production: 0,
    exports: 0,
  };
}

function plan(state, decision, rules = RULES) {
  const propertyCost = decision.property >= 0
    ? decision.property
    : -Math.floor(-decision.property * rules.propertyBid);

  const factoryCost = decision.factories *
    (decision.factories >= 0 ? rules.factoryPrice : rules.factoryResale);

  return {
    ...state,
    cash:
      state.cash +
      decision.debt -
      decision.stocks -
      propertyCost -
      factoryCost,
    debt: state.debt + decision.debt,
    stocks: state.stocks + decision.stocks,
    property: state.property + decision.property,
    factories: state.factories + decision.factories,
  };
}

function normalizeDecision(input, state, rules = RULES) {
  if (state.suspended) {
    throw new GameError("This company's operations are suspended.");
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GameError("A decision is required.");
  }

  const keys = Object.keys(defaultDecision());

  if (Object.keys(input).some((key) => !keys.includes(key))) {
    throw new GameError("Unexpected decision field.");
  }

  const decision = {
    debt: integer(
      input.debt, -state.debt, rules.maxNewDebt, "Borrowing / repayment"
    ),
    stocks: integer(
      input.stocks, -state.stocks,
      rules.maxInvestmentPurchase, "Share purchase / sale"
    ),
    property: integer(
      input.property,
      -Math.floor(state.property * rules.propertySaleFraction),
      rules.maxInvestmentPurchase,
      "Property purchase / sale"
    ),
    factories: integer(input.factories, -1, 1, "Factory change"),
    production: 0,
    exports: integer(input.exports, 0, 100, "Export allocation"),
  };

  const factories = state.factories + decision.factories;

  if (factories < 1 || factories > rules.maxFactories) {
    throw new GameError(`Keep between 1 and ${rules.maxFactories} factories.`);
  }

  if (![0, 25, 50, 75, 100].includes(decision.exports)) {
    throw new GameError("Choose an available export allocation.");
  }

  decision.production = integer(
    input.production, 0,
    factories * rules.factoryCapacity, "Production"
  );

  const proposed = plan(state, decision, rules);

  if (proposed.debt > rules.maxDebt) {
    throw new GameError("This exceeds the maximum debt limit.");
  }

  if (
    decision.debt > 0 &&
    proposed.debt > creditLimit(proposed, rules)
  ) {
    throw new GameError(
      "The proposed borrowing exceeds the collateral-based credit limit."
    );
  }

  if (proposed.cash < decision.production * rules.unitCost) {
    throw new GameError(
      "These trades and production are unaffordable. Reduce spending, " +
      "sell eligible assets or adjust borrowing."
    );
  }

  return decision;
}

function emptyMetrics() {
  return {
    revenue: 0,
    productionCost: 0,
    overhead: 0,
    interest: 0,
    storage: 0,
    stockIncome: 0,
    propertyIncome: 0,
    principalDue: 0,
    soldDomestic: 0,
    soldExport: 0,
    unsold: 0,
    stockChange: 0,
    propertyChange: 0,
    voluntaryLoss: 0,
    forcedLoss: 0,
    arrears: 0,
  };
}

function settle(state, input, packet, defaulted = false, opening = null) {
  if (!opening || opening.round !== packet.index) {
    throw new GameError("This company's round has not been opened correctly.");
  }

  const base = {
    round: packet.index,
    date: packet.brief.date,
    before: { ...state },
    opening: clone(opening),
    information: publicRound(packet),
    market: clone(packet.outcome),
  };

  if (state.suspended) {
    return {
      ...base,
      after: { ...state },
      decision: defaultDecision(),
      defaulted: false,
      inactive: true,
      liquidations: [],
      metrics: { ...emptyMetrics(), unsold: state.inventory },
    };
  }

  const rules = packet.rules;
  const decision = normalizeDecision(input, state, rules);
  const proposed = plan(state, decision, rules);

  const available = state.inventory + decision.production;
  const exportAllocation = Math.floor(available * decision.exports / 100);
  const domesticAllocation = available - exportAllocation;

  const soldExport = Math.min(
    exportAllocation, packet.outcome.exportDemand
  );
  const soldDomestic = Math.min(
    domesticAllocation, packet.outcome.domesticDemand
  );

  const unsold = available - soldExport - soldDomestic;
  const productionCost = decision.production * rules.unitCost;
  const overhead = proposed.factories * rules.factoryOverhead;
  const interest = Math.ceil(proposed.debt * packet.brief.rate);
  const storage = unsold * rules.storagePerUnit;

  const revenue =
    soldDomestic * rules.domesticPrice +
    soldExport * rules.exportPrice;

  const stockIncome = Math.floor(proposed.stocks * rules.stockYield);
  const propertyIncome = Math.floor(proposed.property * rules.propertyYield);
  const requiredPrincipal = principalDue(proposed, rules);

  const after = {
    ...proposed,
    cash:
      proposed.cash -
      productionCost +
      revenue +
      stockIncome +
      propertyIncome -
      overhead -
      interest -
      storage -
      requiredPrincipal,
    debt: proposed.debt - requiredPrincipal,
    inventory: unsold,
  };

  let forcedLoss = 0;
  const liquidations = [];

  function liquidate(field, recoveryRate) {
    if (after.cash >= 0 || after[field] <= 0) return;

    const bookValue = Math.min(
      after[field],
      Math.ceil(-after.cash / recoveryRate)
    );

    const proceeds = Math.floor(bookValue * recoveryRate);

    after[field] -= bookValue;
    after.cash += proceeds;
    forcedLoss += bookValue - proceeds;

    liquidations.push({ asset: field, bookValue, proceeds });
  }

  liquidate("stocks", rules.emergencyStockRate);
  liquidate("property", rules.emergencyPropertyRate);

  while (after.cash < 0 && after.factories > 0) {
    after.factories -= 1;
    after.cash += rules.emergencyFactoryPrice;
    forcedLoss += rules.factoryPrice - rules.emergencyFactoryPrice;

    liquidations.push({
      asset: "factory",
      bookValue: rules.factoryPrice,
      proceeds: rules.emergencyFactoryPrice,
    });
  }

  const arrears = Math.max(0, -after.cash);

  if (arrears > 0) {
    after.debt += arrears;
    after.cash = 0;
  }

  after.suspended =
    arrears > 0 ||
    after.factories === 0 ||
    equity(after, rules) <= 0;

  const propertySold = Math.max(0, -decision.property);

  const voluntaryLoss =
    propertySold -
    Math.floor(propertySold * rules.propertyBid) +
    Math.max(0, -decision.factories) *
      (rules.factoryPrice - rules.factoryResale);

  return {
    ...base,
    after,
    decision,
    defaulted,
    inactive: false,
    liquidations,
    metrics: {
      revenue,
      productionCost,
      overhead,
      interest,
      storage,
      stockIncome,
      propertyIncome,
      principalDue: requiredPrincipal,
      soldDomestic,
      soldExport,
      unsold,
      stockChange: opening.stockChange,
      propertyChange: opening.propertyChange,
      voluntaryLoss,
      forcedLoss,
      arrears,
    },
  };
}

const REVIEW_TOPICS = {
  borrowing: {
    title: "Borrowing increased exposure to asset losses",
    tag: "B — Overinvestment",
    lesson:
      "Debt and concentrated asset holdings made the company vulnerable. " +
      "This is a review of its exposure, not criticism for failing to " +
      "predict the precise timing of a crash.",
  },
  production: {
    title: "Expansion or production exceeded visible demand",
    tag: "B — Overinvestment and overproduction",
    lesson:
      "Production capacity does not create customers. Existing inventory " +
      "and the forecast were available before the decision.",
  },
  rates: {
    title: "Debt remained despite room for repayment",
    tag: "D — Interest-rate policy",
    lesson:
      "When borrowing costs rose, keeping debt involved a trade-off. " +
      "The recorded plan left a conservative cash buffer that could " +
      "have supported some additional repayment.",
  },
  trade: {
    title: "Export allocation ignored a visible constraint",
    tag: "C — Trade disputes",
    lesson:
      "The export forecast and trade warning were visible. Domestic " +
      "opportunities offered a practical alternative for some goods.",
  },
  liquidity: {
    title: "New purchases left too little cash",
    tag: "B + D — Investment and borrowing pressure",
    lesson:
      "Assets were not the same as cash available for bills. The plan " +
      "depended on incoming sales and was followed by emergency sales.",
  },
};

function makeReview(history, limit = 3) {
  const groups = new Map();
  const covered = new Set();

  function add(key, score, evidence) {
    if (score < 100) return;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        ...REVIEW_TOPICS[key],
        score: 0,
        evidence: [],
        examples: [],
      });
    }

    const group = groups.get(key);
    group.score += score;
    group.evidence.push(evidence);
  }

  const manual = history.filter(
    (entry) => !entry.defaulted && !entry.inactive
  );

  const riskyBorrowing = manual.filter((entry) => {
    const rules = entry.information.rules;
    const proposed = plan(entry.before, entry.decision, rules);

    const gross = Math.max(
      1,
      proposed.cash +
      proposed.stocks +
      proposed.property +
      proposed.factories * rules.factoryPrice +
      entry.before.inventory * rules.unitCost
    );

    return (
      entry.decision.debt > 0 &&
      Math.max(0, entry.decision.stocks) +
        Math.max(0, entry.decision.property) > 0 &&
      proposed.debt / gross >= 0.25 &&
      (proposed.stocks + proposed.property) / gross >= 0.5 &&
      entry.after.debt > 0 &&
      entry.information.warnings.speculation
    );
  });

  for (const lossEntry of history) {
    if (lossEntry.inactive || lossEntry.before.debt <= 0) continue;

    const loss =
      Math.max(0, -lossEntry.metrics.stockChange) +
      Math.max(0, -lossEntry.metrics.propertyChange);

    if (loss < 500) continue;

    const prior = [...riskyBorrowing].reverse().find((candidate) =>
      candidate.round < lossEntry.round &&
      history
        .filter((entry) =>
          entry.round >= candidate.round &&
          entry.round < lossEntry.round
        )
        .every((entry) =>
          entry.after.debt > 0 &&
          entry.after.stocks + entry.after.property > 0
        )
    );

    if (!prior) continue;

    covered.add(prior.round);
    covered.add(lossEntry.round);

    add("borrowing", loss, {
      round: prior.round,
      date: prior.date,
      decision:
        `You added ${prior.decision.debt} units of debt while purchasing ` +
        "investments and keeping a concentrated asset position.",
      known:
        "The loan obligation, holdings and cash budget were visible. " +
        "Future asset returns were not guaranteed.",
      outcome:
        `At the opening of round ${lossEntry.round + 1}, the company's ` +
        `held investments lost ${loss} units of value while debt remained. ` +
        "This is the recorded loss on its holdings, not a claim that every " +
        "unit of loss came from that one purchase.",
    });
  }

  for (const entry of manual) {
    const { before, decision, metrics, information } = entry;
    const rules = information.rules;
    const proposed = plan(before, decision, rules);
    const available = before.inventory + decision.production;
    const sold = metrics.soldDomestic + metrics.soldExport;

    let explained = covered.has(entry.round);

    const forecastMaximum =
      information.forecast.domestic[1] +
      information.forecast.export[1];

    const excessiveOutput = available > forecastMaximum + 15;

    const questionableFactory =
      decision.factories > 0 &&
      (before.inventory > 20 || information.warnings.weakDemand) &&
      sold <= before.factories * rules.factoryCapacity;

    if (
      (excessiveOutput || questionableFactory) &&
      (metrics.storage >= 100 || questionableFactory)
    ) {
      explained = true;

      add(
        "production",
        metrics.storage + (questionableFactory ? rules.factoryOverhead : 0),
        {
          round: entry.round,
          date: entry.date,
          decision:
            `Factory change: ${decision.factories}; new production: ` +
            `${decision.production}; existing inventory: ${before.inventory}.`,
          known:
            `The visible combined upper demand forecast was ` +
            `${forecastMaximum} units.`,
          outcome:
            `${metrics.unsold} units remained unsold; storage cost ` +
            `${metrics.storage}. Factory overhead was ${metrics.overhead}.`,
        }
      );
    }

    const noSalesBuffer =
      proposed.cash -
      decision.production * rules.unitCost -
      proposed.factories * rules.factoryOverhead -
      Math.ceil(proposed.debt * information.rate) -
      principalDue(proposed, rules) -
      available * rules.storagePerUnit;

    if (
      !covered.has(entry.round) &&
      information.warnings.highRate &&
      before.debt > 0 &&
      decision.debt >= 0 &&
      noSalesBuffer >= 2000 &&
      metrics.interest >= 100
    ) {
      explained = true;

      add("rates", metrics.interest, {
        round: entry.round,
        date: entry.date,
        decision:
          `You retained or increased borrowing; planned debt was ${proposed.debt}.`,
        known:
          `The visible loan charge was ${(information.rate * 100).toFixed(1)}% ` +
          `per round. Even a no-sales budget left ${noSalesBuffer} units ` +
          "after scheduled costs and principal.",
        outcome: `The company paid ${metrics.interest} units of interest.`,
      });
    }

    const allocatedExport = Math.floor(available * decision.exports / 100);
    const allocatedDomestic = available - allocatedExport;

    if (
      information.warnings.trade &&
      decision.exports >= 50 &&
      allocatedExport > information.forecast.export[1] &&
      allocatedDomestic < information.forecast.domestic[0] &&
      metrics.unsold >= 20
    ) {
      explained = true;

      add("trade", metrics.storage + metrics.unsold * 5, {
        round: entry.round,
        date: entry.date,
        decision:
          `You allocated ${decision.exports}% of available goods to exports.`,
        known:
          `Export demand was forecast at ` +
          `${information.forecast.export.join("–")} units, while the ` +
          "domestic forecast left room to redirect some goods.",
        outcome:
          `Export sales were ${metrics.soldExport} units and total unsold ` +
          `inventory was ${metrics.unsold} units.`,
      });
    }

    if (
      !explained &&
      noSalesBuffer < 0 &&
      metrics.forcedLoss >= 100 &&
      (
        decision.stocks > 0 ||
        decision.property > 0 ||
        decision.factories > 0
      )
    ) {
      add("liquidity", metrics.forcedLoss, {
        round: entry.round,
        date: entry.date,
        decision: "You committed additional cash to investment purchases.",
        known:
          `The conservative no-sales cash estimate was ${noSalesBuffer}. ` +
          "The budget therefore depended on incoming receipts.",
        outcome:
          `Emergency sales caused a recorded discount loss of ` +
          `${metrics.forcedLoss} units.`,
      });
    }
  }

  const result = [...groups.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(3, limit)))
    .map(({ score, ...item }) => ({
      ...item,
      evidence: item.evidence.slice(0, 3),
    }));

  if (result.length) return result;

  return [{
    key: "resilience",
    title: manual.length
      ? "A decision worth retaining or improving"
      : "Review the incomplete decision record",
    tag: "B / C / D",
    lesson: manual.length
      ? "No major decision pattern met this model's review thresholds. " +
        "That does not prove every choice was optimal. Explain one " +
        "decision you would retain or improve."
      : "No completed student decision could be assessed. Choose a " +
        "round and explain what you would have done using its briefing.",
    evidence: [],
    examples: [],
  }];
}

module.exports = {
  GameError,
  ENGINE_VERSION,
  SCENARIO,
  RULES,
  ROUNDS,
  FIXED,
  optionalEvents,
  defaultEventSettings,
  normalizeEventSettings,
  createPacket,
  publicRound,
  publicReport,
  initialState,
  equity,
  creditLimit,
  principalDue,
  markOpening,
  defaultDecision,
  normalizeDecision,
  plan,
  settle,
  makeReview,
};