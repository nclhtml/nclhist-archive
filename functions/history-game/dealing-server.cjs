"use strict";

const crypto = require("node:crypto");

const {
  createEightTape,
  revealEightMarket,
} = require("./eight-market.cjs");

/*
 * Expected session returns differ by company and period.
 * These are teaching parameters, not historical price observations.
 *
 * Order: Hikari, Seiwa, Maru, Tosei.
 * A stronger expected return does not guarantee the strongest result.
 */
const BUSINESS_OUTLOOK = [
  [0.010, 0.025, 0.000, 0.055],
  [-0.015, -0.025, 0.015, 0.035],
  [0.045, 0.030, 0.005, 0.025],
  [-0.020, 0.015, 0.010, 0.050],
  [0.060, 0.015, 0.005, 0.040],
  [0.010, 0.005, 0.020, -0.015],
  [-0.040, -0.030, 0.005, -0.020],
  [-0.020, -0.010, 0.025, -0.065],
  [-0.020, -0.030, 0.015, -0.050],
  [0.035, 0.020, 0.010, -0.025],
  [0.030, -0.040, 0.015, -0.020],
  [0.020, 0.040, 0.005, -0.020],
];

const BETA = [1.15, 1, 0.5, 1.3];
const VOLATILITY = [0.065, 0.055, 0.035, 0.075];

const COMPANY_NEWS = {
  hikari: {
    good: "New product orders strengthen.",
    neutral: "Management weighs further equipment investment.",
    weak: "Export prices and equipment costs squeeze margins.",
  },
  seiwa: {
    good: "Overseas distributors increase their orders.",
    neutral: "Demand is steady, but margins remain competitive.",
    weak: "Customers reduce orders for components and vehicles.",
  },
  maru: {
    good: "Household orders hold up well.",
    neutral: "Retail demand remains steady.",
    weak: "Retailers resist higher selling prices.",
  },
  tosei: {
    good: "Large developments attract fresh financial backing.",
    neutral: "New projects compete for buyers and financing.",
    weak: "Vacancies and refinancing pressures increase.",
  },
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

function validConfig(config, fail) {
  const duration = config.durationSeconds;
  const grace = config.graceSeconds;

  if (
    !Number.isSafeInteger(duration) ||
    duration < 30 ||
    duration > 600 ||
    duration % 5 !== 0 ||
    !Number.isSafeInteger(grace) ||
    grace < 0 ||
    grace > 120 ||
    grace % 5 !== 0
  ) {
    fail(
      "invalid-argument",
      "Trading must be 30–600 seconds and final adjustment 0–120 seconds, in 5-second steps."
    );
  }
}

function createTape(packet, seed, config, previousPrices, model) {
  validConfig(config, (code, message) => {
    throw new Error(message);
  });

  if (packet.lessonVersion === 4) {
    return createEightTape(
      packet,
      seed,
      config,
      previousPrices,
      model
    );
  }

  const steps = config.durationSeconds / 5;
  const outlook = BUSINESS_OUTLOOK[packet.index];
  const common = randomFor(seed, packet.index, "dealing-common");

  const generators = model.LISTED_SHARES.map((share) =>
    randomFor(seed, packet.index, `dealing-${share.id}`)
  );

  const expected = outlook.map((value, index) =>
    value + (generators[index]() - 0.5) * 0.04
  );

  const openingPrices = {};

  model.LISTED_SHARES.forEach((share, index) => {
    const previous = previousPrices?.[share.id] ?? share.start;

    const openingReturn =
      packet.combined.stockBps / 10000 * BETA[index] +
      expected[index] * 0.2;

    openingPrices[share.id] = Math.max(
      1,
      Math.round(previous * Math.max(0.1, 1 + openingReturn))
    );
  });

  const path = [{ ...openingPrices }];

  for (let tick = 1; tick <= steps; tick += 1) {
    const commonMove = normal(common) * 0.04 / Math.sqrt(steps);
    const jump = common() < 1 / steps
      ? (common() - 0.5) * 0.06
      : 0;

    const prices = {};

    model.LISTED_SHARES.forEach((share, index) => {
      const move =
        expected[index] / steps +
        commonMove * BETA[index] +
        normal(generators[index]) *
        VOLATILITY[index] / Math.sqrt(steps) +
        jump * BETA[index];

      prices[share.id] = Math.max(
        1,
        Math.round(
          path[tick - 1][share.id] *
          (1 + Math.max(-0.08, Math.min(0.08, move)))
        )
      );
    });

    path.push(prices);
  }

  const watch = model.LISTED_SHARES.map((share, index) => ({
    symbol: share.id,
    text: COMPANY_NEWS[share.id][
      outlook[index] > 0.02
        ? "good"
        : outlook[index] < -0.01
          ? "weak"
          : "neutral"
    ],
  }));

  return {
    version: 1,
    durationMs: config.durationSeconds * 1000,
    graceMs: config.graceSeconds * 1000,
    path,
    watch,
  };
}

function initialPublicMarket(tape, round, now) {
  return {
    version: 1,
    round,
    durationMs: tape.durationMs,
    graceMs: tape.graceMs,
    startedAt: null,
    pausedAt: null,
    pausedMs: 0,
    revision: 0,
    tick: 0,
    prices: { ...tape.path[0] },
    history: [{ tick: 0, prices: { ...tape.path[0] } }],
    publishedAt: now,
  };
}

function revealMarket(market, tape, now, model) {
  if (tape.lessonVersion === 4) {
    return revealEightMarket(market, tape, now, model);
  }

  const clock = model.marketClock(market, now);

  if (clock.tick <= market.tick) return market;

  return {
    ...market,
    tick: clock.tick,
    prices: { ...tape.path[clock.tick] },
    history: tape.path.slice(0, clock.tick + 1).map((prices, tick) => ({
      tick,
      prices: { ...prices },
    })),
    publishedAt: now,
  };
}

function orderId(value, fail) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    fail("invalid-argument", "Invalid order reference.");
  }
  return value;
}

function fingerprint(data) {
  return crypto.createHash("sha256")
    .update(JSON.stringify([
      data.round,
      data.symbol,
      data.side,
      data.lots,
      data.quoteTick,
      data.marketRevision,
      data.balanceRevision,
    ]))
    .digest("hex");
}

async function runMarketAction({
  transaction,
  reference,
  room,
  person,
  access,
  data,
  fail,
  privateRef,
  packetRef,
  model,
  economy,
}) {
  const owner = access.teacher && room.ownerUid === person.uid;
  const action = data.action;

  function requireOwner() {
    if (!owner) {
      fail("permission-denied", "Only the session owner can use this control.");
    }
  }

  function requireRound() {
    if (!Number.isSafeInteger(data.round) || data.round !== room.round) {
      fail("failed-precondition", "The round changed. Refresh the current view.");
    }
  }

  if (action === "marketSettings") {
    requireOwner();

    if (!["lobby", "results"].includes(room.phase)) {
      fail("failed-precondition", "Set the next market duration between rounds.");
    }

    const config = {
      durationSeconds: data.durationSeconds,
      graceSeconds: data.graceSeconds,
    };

    validConfig(config, fail);

    if (JSON.stringify(config) === JSON.stringify(room.marketConfig)) {
      return { saved: true, serverNow: Date.now() };
    }

    if (data.revision !== room.marketConfigRevision) {
      fail("failed-precondition", "Another teacher tab changed these settings.");
    }

    transaction.update(reference, {
      marketConfig: config,
      marketConfigRevision: room.marketConfigRevision + 1,
    });

    return { saved: true, serverNow: Date.now() };
  }

  if (action === "openMarket") {
    requireOwner();
    requireRound();

    if (room.phase !== "decision" || room.paused || !room.dealing) {
      fail("failed-precondition", "Open a round before starting its market.");
    }

    if (room.dealing.startedAt != null) {
      return { opened: true, serverNow: Date.now() };
    }

    const now = Date.now();

    transaction.update(reference, {
      dealing: {
        ...room.dealing,
        startedAt: now,
        publishedAt: now,
      },
      updatedAt: now,
    });

    return { opened: true, serverNow: now };
  }

  if (action === "pause") {
    requireOwner();
    requireRound();

    if (
      room.phase !== "decision" ||
      typeof data.paused !== "boolean" ||
      !room.dealing
    ) {
      fail("failed-precondition", "This round cannot be paused.");
    }

    if (data.paused === room.paused) {
      return { paused: data.paused, serverNow: Date.now() };
    }

    if (data.marketRevision !== room.dealing.revision) {
      fail("failed-precondition", "The market clock changed. Try again.");
    }

    const packetSnapshot = await transaction.get(
      packetRef(room.code, room.round)
    );

    if (!packetSnapshot.exists) {
      fail("failed-precondition", "The market record is missing.");
    }

    const now = Date.now();
    const clock = model.marketClock(room.dealing, now);

    if (!["live", "grace"].includes(clock.stage)) {
      fail("failed-precondition", "Only trading or final adjustment can be paused.");
    }

    let market = revealMarket(
      room.dealing,
      packetSnapshot.data().dealing,
      now,
      model
    );

    market = {
      ...market,
      revision: market.revision + 1,
      pausedAt: data.paused ? now : null,
      pausedMs: data.paused
        ? market.pausedMs
        : market.pausedMs + now - market.pausedAt,
      publishedAt: now,
    };

    transaction.update(reference, {
      dealing: market,
      paused: data.paused,
      updatedAt: now,
    });

    return { paused: data.paused, serverNow: now };
  }

  const playerRef = reference.collection("players").doc(person.uid);

  let playerSnapshot = null;

  if (!owner || action === "dealOrder") {
    playerSnapshot = await transaction.get(playerRef);

    if (!playerSnapshot.exists) {
      fail("permission-denied", "Join this session first.");
    }
  }

  if (action === "marketClock") {
    requireRound();

    if (room.phase !== "decision" || !room.dealing) {
      return { serverNow: Date.now() };
    }

    const clock = model.marketClock(room.dealing, Date.now());

    if (clock.tick <= room.dealing.tick) {
      return { serverNow: Date.now() };
    }

    const packetSnapshot = await transaction.get(
      packetRef(room.code, room.round)
    );

    if (!packetSnapshot.exists) {
      fail("failed-precondition", "The market record is missing.");
    }

    const now = Date.now();

    const market = revealMarket(
      room.dealing,
      packetSnapshot.data().dealing,
      now,
      model
    );

    if (market !== room.dealing) {
      transaction.update(reference, {
        dealing: market,
        updatedAt: now,
      });
    }

    return { serverNow: now };
  }

  if (action !== "dealOrder") {
    fail("invalid-argument", "Unknown dealing action.");
  }

  const id = orderId(data.orderId, fail);

  const receiptRef = privateRef(room.code)
    .collection("dealers")
    .doc(person.uid)
    .collection("orders")
    .doc(id);

  const previous = await transaction.get(receiptRef);
  const digest = fingerprint(data);

  /*
   * Return an already committed order BEFORE checking the current
   * deadline or account revision. Retrying cannot place it twice.
   */
  if (previous.exists) {
    const saved = previous.data();

    if (saved.fingerprint !== digest) {
      fail("invalid-argument", "An order reference cannot be reused for a different order.");
    }

    return {
      receipt: saved.receipt,
      serverNow: Date.now(),
    };
  }

  requireRound();

  if (room.phase !== "decision" || room.paused || !room.dealing) {
    fail("failed-precondition", "Trading is not open.");
  }

  const player = playerSnapshot.data();

  if (
    player.state.suspended ||
    player.board?.dismissed ||
    player.openedRound !== room.round ||
    player.settledRound !== room.round - 1
  ) {
    fail(
      "failed-precondition",
      player.board?.dismissed
        ? "The board has appointed another adviser. You can continue observing."
        : "This company cannot trade now."
    );
  }

  if (data.balanceRevision !== (player.balanceRevision || 0)) {
    fail("failed-precondition", "Your company balance changed. Review it and try again.");
  }

  if ((player.dealCount || 0) >= model.MAX_ORDERS) {
    fail("failed-precondition", "The order limit for this round has been reached.");
  }

  const packetSnapshot = await transaction.get(
    packetRef(room.code, room.round)
  );

  if (!packetSnapshot.exists) {
    fail("failed-precondition", "The market record is missing.");
  }

  /*
   * All database reads are complete.
   * Use fresh server time within this transaction attempt.
   */
  const now = Date.now();

  if (now - (player.lastDealAt || 0) < 800) {
    fail("failed-precondition", "Wait briefly before placing another order.");
  }

  let clock;

  try {
    clock = model.checkTradeWindow(
      revealMarket(
        room.dealing,
        packetSnapshot.data().dealing,
        now,
        model
      ),
      now,
      data
    );
  } catch (error) {
    if (error instanceof model.DealingError) {
      fail("failed-precondition", error.message);
    }
    throw error;
  }

  const tape = packetSnapshot.data().dealing;
  const prices = tape.path[clock.tick];
  const markedState = model.markListed(player.state, prices);

  const protection = economy.prepareInvestment(
    markedState,
    {
      ...economy.defaultInvestmentPlan(),
      reserveRelease: 100,
    },
    room.rules,
    room.brief
  );

  const buyingPower = protection.valid ? protection.budget : 0;

  let result;

  try {
    result = model.applyListedTrade(
      markedState,
      prices,
      data.symbol,
      data.side,
      data.lots,
      buyingPower
    );
  } catch (error) {
    if (error instanceof model.DealingError) {
      fail("invalid-argument", error.message);
    }
    throw error;
  }

  const balanceRevision = (player.balanceRevision || 0) + 1;

  const receipt = {
    ...result.receipt,
    orderId: id,
    round: room.round,
    tick: clock.tick,
    acceptedAt: now,
    balanceRevision,
  };

  const market = revealMarket(room.dealing, tape, now, model);

  transaction.update(playerRef, {
    state: result.state,
    balanceRevision,
    ready: false,
    decision: null,
    advicePlan: null,
    planNeedsReview: true,
    lastDealAt: now,
    dealCount: (player.dealCount || 0) + 1,
    dealLog: [...(player.dealLog || []), receipt].slice(-12),
  });

  transaction.create(receiptRef, {
    fingerprint: digest,
    receipt,
  });

  if (market !== room.dealing) {
    transaction.update(reference, {
      dealing: market,
      updatedAt: now,
    });
  }

  return { receipt, serverNow: now };
}

module.exports = {
  createTape,
  initialPublicMarket,
  revealMarket,
  runMarketAction,
};