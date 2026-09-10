"use strict";

const crypto = require("node:crypto");

const {
  GameError,
  ENGINE_VERSION,
  SCENARIO,
  RULES,
  FIXED,
  optionalEvents,
  defaultEventSettings,
} = require("./engine.cjs");

const copy = (value) => JSON.parse(JSON.stringify(value));

const PERIODS = [
  {
    date: "Early 1985",
    fixed: ["mandate"],
    optionalFrom: 0,
    rate: 0.05,
    domestic: 100,
    export: 75,
    credit: [20000, 1, 0, 1, 1],
    economy: [1, 1, 1, 0, 0.005, 1],
  },
  {
    date: "Late 1985–1986",
    fixed: ["plaza", "easing"],
    optionalFrom: 2,
    rate: 0.035,
    domestic: 108,
    export: 85,
    credit: [20000, 1.15, 0, 1, 1],
    economy: [1.04, 1.02, 1.03, 0, 0.005, 1],
  },
  {
    date: "1987",
    fixed: ["low-rate", "electronics"],
    optionalFrom: 3,
    rate: 0.025,
    domestic: 118,
    export: 82,
    credit: [25000, 1.3, 0, 1, 1],
    economy: [1.07, 1.03, 1.05, 0.01, 0.005, 1],
  },
  {
    date: "1988–1989",
    fixed: ["optimism", "tightening-1989", "late-boom"],
    optionalFrom: 5,
    rate: 0.065,
    domestic: 116,
    export: 72,
    credit: [25000, 1.35, 0.04, 0.8, 0.98],
    economy: [1.08, 1.05, 1.08, 0.02, 0.01, 0.7],
  },
  {
    date: "1990",
    fixed: ["tightening-1990"],
    optionalFrom: 6,
    rate: 0.09,
    domestic: 98,
    export: 63,
    credit: [2500, 0.85, 0.1, 0.5, 0.95],
    economy: [0.98, 1.05, 1.1, 0.12, 0.025, 0.2],
  },
  {
    date: "1991–1992",
    fixed: ["land-downturn", "financial-strain"],
    optionalFrom: 8,
    rate: 0.065,
    domestic: 72,
    export: 50,
    credit: [0, 0.58, 0.2, 0.15, 0.85],
    economy: [0.89, 1.04, 1.09, 0.24, 0.06, 0],
  },
  {
    date: "1993–1994",
    fixed: ["uneven-adjustment"],
    optionalFrom: 9,
    rate: 0.045,
    domestic: 80,
    export: 55,
    credit: [1000, 0.65, 0.15, 0.2, 0.88],
    economy: [0.91, 1.03, 1.08, 0.2, 0.04, 0.1],
  },
  {
    date: "1995",
    fixed: ["car-threat", "car-settlement"],
    optionalFrom: 11,
    rate: 0.035,
    domestic: 87,
    export: 58,
    credit: [2000, 0.7, 0.1, 0.25, 0.9],
    economy: [0.93, 1.02, 1.06, 0.17, 0.03, 0.2],
  },
];

function definition(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= PERIODS.length) {
    throw new GameError("Invalid eight-round period.");
  }
  return PERIODS[index];
}

function randomFor(seed, round, purpose) {
  let counter = 0;

  return () => {
    const digest = crypto.createHash("sha256")
      .update(`${seed}:${round}:${purpose}:${counter++}`)
      .digest();

    return digest.readUInt32BE(0) / 4294967296;
  };
}

function fixedEvents(index) {
  const period = definition(index);

  return period.fixed.map((id) => {
    const event = copy(FIXED[id]);

    /*
     * Consolidated teaching returns for combined periods.
     * The 1990 share collapse is NOT applied at opening.
     */
    if (index === 3 && id === "optimism") {
      event.effects.stockBps = 2200;
      event.effects.propertyBps = 2200;
    }

    if (index === 3 && id === "late-boom") {
      event.effects.stockBps = 1600;
      event.effects.propertyBps = 2000;
    }

    if (index === 5 && id === "land-downturn") {
      event.effects.stockBps = -800;
      event.effects.propertyBps = -1800;
    }

    if (index === 5 && id === "financial-strain") {
      event.effects.stockBps = -600;
      event.effects.propertyBps = -1700;
    }

    return event;
  });
}

function availableEvents(index) {
  const period = definition(index);

  return optionalEvents(period.optionalFrom).map((event) => ({
    ...event,
    date: period.date,
  }));
}

function normalizeEightSettings(index, input = defaultEventSettings()) {
  definition(index);

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GameError("Event settings are required.");
  }

  if (Object.keys(input).some(
    (key) => !["count", "mode", "pinned"].includes(key)
  )) {
    throw new GameError("Unexpected event setting.");
  }

  if (
    !Number.isSafeInteger(input.count) ||
    input.count < 0 ||
    input.count > 3 ||
    !["mixed", "good", "bad"].includes(input.mode) ||
    !Array.isArray(input.pinned) ||
    input.pinned.some((id) => typeof id !== "string") ||
    new Set(input.pinned).size !== input.pinned.length
  ) {
    throw new GameError("Invalid event settings.");
  }

  const available = new Set(availableEvents(index).map((event) => event.id));

  if (input.pinned.some((id) => !available.has(id))) {
    throw new GameError("An event is unavailable in this period.");
  }

  const minimum = fixedEvents(index).length + input.pinned.length;

  if (minimum > 3 || (input.count !== 0 && input.count < minimum)) {
    throw new GameError("Not enough event slots for the selected events.");
  }

  return {
    count: input.count,
    mode: input.mode,
    pinned: [...input.pinned].sort(),
  };
}

function createEightPacket(index, seed, input = defaultEventSettings()) {
  const period = definition(index);
  const settings = normalizeEightSettings(index, input);
  const random = randomFor(seed, index, "eight-events");
  const selected = fixedEvents(index);
  const pool = availableEvents(index);

  for (const id of settings.pinned) {
    selected.push(copy(pool.find((event) => event.id === id)));
  }

  const count = settings.count ||
    selected.length + Math.floor(random() * (4 - selected.length));

  while (selected.length < count) {
    const candidates = pool.filter((event) =>
      !selected.some((chosen) => chosen.id === event.id) &&
      (settings.mode === "mixed" || settings.mode === event.tone)
    );

    if (!candidates.length) {
      throw new GameError("Not enough eligible events for this selection.");
    }

    selected.push(copy(
      candidates[Math.floor(random() * candidates.length)]
    ));
  }

  const combined = {
    stockBps: 0,
    propertyBps: 0,
    domesticDelta: 0,
    exportDelta: 0,
    exportPriceDelta: 0,
  };

  for (const event of selected) {
    for (const key of Object.keys(combined)) {
      combined[key] += event.effects[key];
    }
  }

  const [
    maxNewDebt,
    creditFactor,
    principalRate,
    propertySaleFraction,
    propertyBid,
  ] = period.credit;

  const [
    priceLevel,
    costLevel,
    payrollLevel,
    delay,
    writeOff,
    renewal,
  ] = period.economy;

  const rules = {
    ...RULES,
    advisorMode: 2,
    maxDebt: 120000,
    maxNewDebt,
    maxInvestmentPurchase: 20000,
    creditBase: 5000,
    creditFactor,
    principalRate,
    propertySaleFraction,
    propertyBid,
    stockYield: index < 4 ? 0.01 : 0.003,
    propertyYield: index < 4 ? 0.015 : 0.004,
    emergencyStockRate: index < 4 ? 0.8 : 0.72,
    emergencyPropertyRate: index < 4 ? 0.55 : 0.43,
    economy: {
      version: 2,
      lessonVersion: 4,
      round: index,
      months: 3,
      priceLevel,
      costLevel,
      payrollLevel,
      delay,
      writeOff,
      renewal,
      factorySaleRate: index < 4 ? 0.75 : 0.58,
    },
  };

  const domesticCenter = Math.max(
    0, period.domestic + combined.domesticDelta
  );

  const exportCenter = Math.max(
    0, period.export + combined.exportDelta
  );

  const sources = [...new Map(
    selected.flatMap((event) => event.sources)
      .map((source) => [source.url, source])
  ).values()];

  const common = randomFor(seed, index, "eight-demand");
  const spread = index < 4 ? 0.24 : 0.48;
  const commonDomestic = 1 + (common() - 0.5) * spread;
  const commonExport = 1 + (common() - 0.5) * spread;

  const economyOutcome = Object.fromEntries(
    ["electronics", "machinery", "essentials", "materials"].map((industry) => {
      const draw = randomFor(seed, index, `eight-${industry}`);
      const sectorSpread = industry === "essentials" ? 0.12 : 0.3;

      return [industry, {
        domesticFactor: Math.max(
          0.3, commonDomestic + (draw() - 0.5) * sectorSpread
        ),
        exportFactor: Math.max(
          0.3, commonExport + (draw() - 0.5) * sectorSpread
        ),
        writeOff: Math.min(0.25, writeOff * (0.5 + draw())),
      }];
    })
  );

  const brief = {
    index,
    lessonVersion: 4,
    economyVersion: 2,
    date: period.date,
    headline: selected[0].headline,
    body: index === 0
      ? "The board has appointed its investment adviser."
      : "Business and financial developments in Japan.",
    historical: selected.some((event) => event.kind === "milestone"),
    badges: [...new Set(selected.flatMap((event) => event.badges))],
    events: selected,
    rate: period.rate,
    forecast: {
      domestic: [
        Math.max(0, domesticCenter - 12),
        domesticCenter + 12,
      ],
      export: [
        Math.max(0, exportCenter - 8),
        exportCenter + 8,
      ],
    },
    warnings: {
      speculation: true,
      weakDemand: index >= 3,
      highRate: period.rate >= 0.065,
      trade: selected.some(
        (event) => event.effects.exportDelta < 0
      ),
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
    lessonVersion: 4,
    index,
    settings,
    rules,
    combined,
    brief,
    outcome: {
      domesticDemand: domesticCenter,
      exportDemand: exportCenter,
      economy: economyOutcome,
    },
  };
}

function eightEventOptions(room, setup, target, revision) {
  const settings = setup.scheduled?.round === target
    ? setup.scheduled.settings
    : defaultEventSettings();

  const packet = createEightPacket(target, setup.seed, settings);

  return {
    targetRound: target,
    date: definition(target).date,
    revision,
    minimum: fixedEvents(target).length,
    config: settings,
    fixed: fixedEvents(target),
    optional: availableEvents(target),
    preview: packet.brief.events,
  };
}

module.exports = {
  EIGHT_ROUNDS: PERIODS,
  createEightPacket,
  normalizeEightSettings,
  eightEventOptions,
};