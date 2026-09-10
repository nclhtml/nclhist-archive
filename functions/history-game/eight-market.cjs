"use strict";

const crypto = require("node:crypto");

const OUTLOOK = [
  [0.010, 0.025, 0.005, 0.045],
  [0.020, -0.015, 0.010, 0.045],
  [-0.010, 0.025, 0.010, 0.050],
  [0.050, 0.020, 0.005, 0.040],
  [-0.035, -0.020, 0.005, -0.040],
  [-0.020, -0.025, 0.015, -0.050],
  [0.025, 0.015, 0.010, -0.020],
  [0.020, 0.035, 0.010, -0.010],
];

const BETA = [1.1, 1, 0.5, 1.25];
const VOLATILITY = [0.07, 0.06, 0.035, 0.08];

const NEWS = {
  hikari: [
    "New product orders strengthen.",
    "Equipment investment continues.",
    "Export margins face pressure.",
  ],
  seiwa: [
    "Distributors increase their orders.",
    "Customers review future orders.",
    "Export uncertainty weakens orders.",
  ],
  maru: [
    "Household demand holds up well.",
    "Retail demand remains steady.",
    "Retailers resist higher prices.",
  ],
  tosei: [
    "New developments attract funding.",
    "Projects compete for buyers.",
    "Vacancies and refinancing pressures rise.",
  ],
};

function randomFor(seed, round, purpose) {
  let counter = 0;

  return () => {
    const digest = crypto.createHash("sha256")
      .update(`${seed}:${round}:${purpose}:${counter++}`)
      .digest();

    return digest.readUInt32BE(0) / 4294967296;
  };
}

function normal(random) {
  const a = Math.max(Number.EPSILON, random());
  const b = random();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

function createEightTape(packet, seed, config, previousPrices, model) {
  const steps = config.durationSeconds / 5;
  const outlook = OUTLOOK[packet.index];

  if (!outlook || !Number.isSafeInteger(steps) || steps < 6) {
    throw new Error("Invalid eight-round dealing configuration.");
  }

  const common = randomFor(seed, packet.index, "eight-market-common");
  const haltRandom = randomFor(seed, packet.index, "eight-market-halt");

  const generators = model.LISTED_SHARES.map((share) =>
    randomFor(seed, packet.index, `eight-market-${share.id}`)
  );

  const expected = outlook.map((value, index) =>
    value + (generators[index]() - 0.5) * 0.04
  );

  const isCrash = packet.index === 4;

  const startTick = isCrash
    ? Math.max(2, Math.floor(steps * (0.42 + haltRandom() * 0.14)))
    : null;

  const haltTicks = Math.max(1, Math.min(6, Math.round(steps / 8)));

  const halt = isCrash
    ? {
        startTick,
        endTick: Math.min(steps - 1, startTick + haltTicks),
      }
    : null;

  const openingPrices = {};

  model.LISTED_SHARES.forEach((share, index) => {
    const previous = previousPrices?.[share.id] ?? share.start;

    /*
     * No scheduled crash is applied at the 1990 opening.
     */
    const openingReturn =
      packet.combined.stockBps / 10000 * BETA[index] +
      (isCrash ? 0 : expected[index] * 0.15);

    openingPrices[share.id] = Math.max(
      1,
      Math.round(previous * Math.max(0.1, 1 + openingReturn))
    );
  });

  const path = [{ ...openingPrices }];

  for (let tick = 1; tick <= steps; tick += 1) {
    const previous = path[tick - 1];
    const prices = {};

    if (halt && tick === halt.startTick) {
      const drops = [0.4, 0.36, 0.25, 0.44];

      model.LISTED_SHARES.forEach((share, index) => {
        const drop = drops[index] + (generators[index]() - 0.5) * 0.04;
        prices[share.id] = Math.max(
          1,
          Math.round(previous[share.id] * (1 - drop))
        );
      });
    } else if (
      halt &&
      tick > halt.startTick &&
      tick < halt.endTick
    ) {
      Object.assign(prices, previous);
    } else {
      const shared = normal(common) * 0.045 / Math.sqrt(steps);

      const jump = common() < 0.7 / steps
        ? (common() - 0.5) * 0.05
        : 0;

      model.LISTED_SHARES.forEach((share, index) => {
        const move =
          expected[index] / steps +
          shared * BETA[index] +
          normal(generators[index]) * VOLATILITY[index] / Math.sqrt(steps) +
          jump * BETA[index];

        prices[share.id] = Math.max(
          1,
          Math.round(previous[share.id] * (
            1 + Math.max(-0.08, Math.min(0.08, move))
          ))
        );
      });
    }

    path.push(prices);
  }

  return {
    version: 1,
    lessonVersion: 4,
    durationMs: config.durationSeconds * 1000,
    graceMs: config.graceSeconds * 1000,
    path,
    halt,
    watch: model.LISTED_SHARES.map((share, index) => ({
      symbol: share.id,
      text: NEWS[share.id][
        outlook[index] > 0.02 ? 0 : outlook[index] < -0.01 ? 2 : 1
      ],
    })),
  };
}

function revealEightMarket(market, tape, now, model) {
  const clock = model.marketClock(market, now);

  if (clock.tick <= market.tick) return market;

  const shockPublished =
    tape.halt && clock.tick >= tape.halt.startTick;

  return {
    ...market,
    tick: clock.tick,
    prices: { ...tape.path[clock.tick] },
    history: tape.path.slice(0, clock.tick + 1).map((prices, tick) => ({
      tick,
      prices: { ...prices },
    })),
    ...(shockPublished
      ? {
          halt: {
            fromMs: tape.halt.startTick * 5000,
            untilMs: tape.halt.endTick * 5000,
          },
          breaking: {
            headline: "SHARE PRICES FALL SHARPLY",
            body: "Selling pressure has pushed prices down. Both buying and selling pause briefly before trading resumes.",
          },
        }
      : {}),
    publishedAt: now,
  };
}

module.exports = { createEightTape, revealEightMarket };