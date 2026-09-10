import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import * as dealing from "./dealing-model.mjs";

import {
  companyValue,
  companyTerms,
  defaultInvestmentPlan,
  prepareInvestment,
  openCompany,
  closeCompany,
  finalCompanyReport,
} from "./resilience-model.mjs";

import {
  createInvestorCompany,
  initialInvestorBoard,
  createReferenceCompany,
  openReferenceCompany,
  settleReferenceCompany,
  investorAddedValue,
  createInvestorMission,
  assessInvestor,
  buildInvestmentRanking,
} from "./investor-model.mjs";

const require = createRequire(import.meta.url);
const { createInvestorPacket } = require("./investor-scenario.cjs");
const { createTape } = require("./dealing-server.cjs");

function packet(round, seed = "investor-test", previousPrices = null) {
  const result = createInvestorPacket(round, seed, {
    count: 0,
    mode: "mixed",
    pinned: [],
  });

  result.dealing = createTape(
    result,
    seed,
    dealing.DEFAULT_MARKET_CONFIG,
    previousPrices,
    dealing
  );

  return result;
}

function basicEntry(round, state, referenceState) {
  return {
    actual: {
      round,
      date: `Round ${round + 1}`,
      after: state,
      inactive: false,
    },
    reference: {
      round,
      date: `Round ${round + 1}`,
      after: referenceState,
      inactive: false,
    },
  };
}

function syntheticMission(round, board) {
  return {
    version: 2,
    round,
    date: `Round ${round + 1}`,
    totalRounds: 8,
    practice: round === 0,
    targetBefore: board.targetTotal,
    baseTarget: round === 0 ? 0 : 100,
    crisisAllowance: 1200,
  };
}

test("borrowed cash is not investor-added value", () => {
  const reference = createInvestorCompany("electronics");

  const actual = {
    ...reference,
    cash: reference.cash + 5000,
    debt: reference.debt + 5000,
  };

  assert.equal(investorAddedValue(actual, reference), 0);
});

test("a share purchase counts its asset, spread and fee correctly", () => {
  const reference = createInvestorCompany("electronics");

  const bought = dealing.applyListedTrade(
    reference,
    dealing.START_PRICES,
    "hikari",
    "buy",
    3,
    reference.cash
  );

  assert.equal(
    investorAddedValue(bought.state, reference),
    -bought.receipt.fee - bought.receipt.spread
  );
});

test("three missed reviews replace the adviser, not the company", () => {
  const state = createInvestorCompany("electronics");
  let board = initialInvestorBoard();

  for (let round = 0; round < 4; round += 1) {
    const entries = basicEntry(round, state, state);

    board = assessInvestor({
      entry: entries.actual,
      referenceEntry: entries.reference,
      mission: syntheticMission(round, board),
      previousBoard: board,
    }).board;
  }

  assert.equal(board.warningLimit, 3);
  assert.equal(board.warnings, 3);
  assert.equal(board.dismissed, true);
  assert.equal(board.dismissedRound, 3);
  assert.equal(state.suspended, false);
});

test("repeated assessment does not duplicate a warning", () => {
  const state = createInvestorCompany("electronics");
  let board = initialInvestorBoard();

  const practice = basicEntry(0, state, state);

  board = assessInvestor({
    entry: practice.actual,
    referenceEntry: practice.reference,
    mission: syntheticMission(0, board),
    previousBoard: board,
  }).board;

  const entries = basicEntry(1, state, state);
  const mission = syntheticMission(1, board);

  const once = assessInvestor({
    entry: entries.actual,
    referenceEntry: entries.reference,
    mission,
    previousBoard: board,
  });

  const twice = assessInvestor({
    entry: entries.actual,
    referenceEntry: entries.reference,
    mission,
    previousBoard: once.board,
  });

  assert.deepEqual(twice, once);
});

test("project deferrals do not add project costs back to investor gain", () => {
  const reference = createInvestorCompany("electronics");

  const actual = {
    ...reference,
    cash: reference.cash - 1200,
    project: { kind: "efficiency", readyRound: 4, cost: 1200 },
  };

  let board = initialInvestorBoard();

  for (let round = 0; round <= 3; round += 1) {
    const entries = basicEntry(round, actual, reference);

    const result = assessInvestor({
      entry: entries.actual,
      referenceEntry: entries.reference,
      mission: syntheticMission(round, board),
      previousBoard: board,
    });

    board = result.board;
  }

  assert.equal(board.score, -1200);
  assert.equal(board.projectDeferralsUsed, 2);
  assert.equal(board.warnings, 1);
});

test("later management losses are not hidden by adviser replacement", () => {
  const reference = createInvestorCompany("electronics");
  let board = initialInvestorBoard();

  for (let round = 0; round < 4; round += 1) {
    const entries = basicEntry(round, reference, reference);

    board = assessInvestor({
      entry: entries.actual,
      referenceEntry: entries.reference,
      mission: syntheticMission(round, board),
      previousBoard: board,
    }).board;
  }

  assert.equal(board.dismissed, true);
  assert.equal(board.score, 0);

  const weakerCompany = {
    ...reference,
    cash: reference.cash - 2000,
  };

  const entries = basicEntry(4, weakerCompany, reference);

  board = assessInvestor({
    entry: entries.actual,
    referenceEntry: entries.reference,
    mission: syntheticMission(4, board),
    previousBoard: board,
  }).board;

  assert.equal(board.score, 0);
  assert.equal(board.companySnapshot.score, -2000);
});

test("targets do not inspect hidden demand or future share paths", () => {
  const state = createInvestorCompany("electronics");
  const original = packet(1);
  const changed = JSON.parse(JSON.stringify(original));

  changed.outcome = { differentHiddenDemand: true };
  changed.dealing.path = [{ secret: "different future prices" }];

  const reference = {
    ...createReferenceCompany("electronics"),
    openedRound: 1,
  };

  const board = initialInvestorBoard();
  const opening = { before: state, after: state };

  assert.deepEqual(
    createInvestorMission(opening, reference, original, board),
    createInvestorMission(opening, reference, changed, board)
  );
});

test("expansion demand rises substantially before the downturn", () => {
  const state = createInvestorCompany("electronics");

  const openingTerms = companyTerms(
    state,
    packet(0).rules,
    packet(0).brief
  );

  const boom = packet(3);
  const weak = packet(5);

  const boomTerms = companyTerms(state, boom.rules, boom.brief);
  const weakTerms = companyTerms(state, weak.rules, weak.brief);

  const totalCenter = (terms) =>
    (
      terms.forecast.domestic[0] +
      terms.forecast.domestic[1] +
      terms.forecast.export[0] +
      terms.forecast.export[1]
    ) / 2;

  assert.ok(totalCenter(boomTerms) > totalCenter(openingTerms) * 1.4);
  assert.ok(totalCenter(weakTerms) < totalCenter(boomTerms) * 0.75);
});

test("rank ties and privacy are preserved", () => {
  function player(company, key, gain) {
    const state = createInvestorCompany("electronics");
    const board = initialInvestorBoard();

    board.score = gain;
    board.scoreRound = 7;
    board.companySnapshot = {
      score: gain,
      round: 7,
      actualWorth: companyValue(state),
      referenceWorth: companyValue(state) - gain,
      closed: false,
    };

    return {
      company,
      rankingKey: key,
      uid: "PRIVATE_AUTH_ID",
      studentName: "PRIVATE_STUDENT_NAME",
      reflection: { text: "PRIVATE_REFLECTION" },
      state,
      board,
      ending: { outcome: "Resilient survivor" },
    };
  }

  const ranking = buildInvestmentRanking([
    player("Alpha", "a", 1000),
    player("Beta", "b", 1000),
    player("Gamma", "c", 500),
  ]);

  assert.deepEqual(
    ranking.rows.map((row) => row.rank),
    [1, 1, 3]
  );

  const publicText = JSON.stringify(ranking);

  assert.equal(publicText.includes("PRIVATE_AUTH_ID"), false);
  assert.equal(publicText.includes("PRIVATE_STUDENT_NAME"), false);
  assert.equal(publicText.includes("PRIVATE_REFLECTION"), false);
});

function runStrategy(industry, strategy, seed) {
  let state = createInvestorCompany(industry);
  let reference = createReferenceCompany(industry);
  let board = initialInvestorBoard();

  const history = [];
  let previousPrices = null;
  let finalPacket;

  for (let round = 0; round < 8; round += 1) {
    const current = packet(round, seed, previousPrices);

    const opening = openCompany(state, current);
    reference = openReferenceCompany(reference, current);

    const mission = createInvestorMission(
      opening,
      reference,
      current,
      board
    );

    let live = opening.after;
    const adviserActive = !board.dismissed && !live.suspended;

    function tradeAt(tick, symbol, side, cashFraction = 1) {
      if (current.dealing.halt &&
          tick >= current.dealing.halt.startTick &&
          tick < current.dealing.halt.endTick) {
        return;
      }

      const prices = current.dealing.path[tick];
      live = dealing.markListed(live, prices);

      if (side === "sell") {
        const lots = live.listed[symbol].lots;
        if (lots === 0) return;

        live = dealing.applyListedTrade(
          live, prices, symbol, "sell", lots, live.cash
        ).state;

        return;
      }

      const protectedPlan = prepareInvestment(
        live,
        { ...defaultInvestmentPlan(), reserveRelease: 100 },
        current.rules,
        current.brief
      );

      if (!protectedPlan.valid) return;

      const money = Math.floor(protectedPlan.budget * cashFraction);
      const lots = dealing.maximumBuyLots(prices, symbol, money);

      if (lots > 0) {
        live = dealing.applyListedTrade(
          live, prices, symbol, "buy", lots, money
        ).state;
      }
    }

    if (adviserActive) {
      if (strategy === "Balanced, no loans") {
        tradeAt(0, "hikari", "buy", 0.15);
        tradeAt(0, "maru", "buy", 0.15);
      }

      if (
        ["Borrowed shares held", "Exit before crash (hindsight)"].includes(strategy) &&
        round < 4
      ) {
        tradeAt(0, "hikari", "buy", 1);
      }

      if (strategy === "Active trader") {
        for (let tick = 0; tick < current.dealing.path.length - 1; tick += 3) {
          tradeAt(
            tick,
            "hikari",
            live.listed.hikari.lots > 0 ? "sell" : "buy",
            0.35
          );
        }
      }

      if (strategy === "Exit before crash (hindsight)" && round === 3) {
        tradeAt(current.dealing.path.length - 2, "hikari", "sell");
      }
    }

    const closingPrices =
      current.dealing.path[current.dealing.path.length - 1];

    if (!live.suspended) {
      live = dealing.markListed(live, closingPrices);
    }

    let advice = defaultInvestmentPlan();

    if (adviserActive) {
      if ([
        "Borrowed shares held",
        "Borrowed property held",
        "Exit before crash (hindsight)",
      ].includes(strategy) && round < 3) {
        advice.loanMode = "borrow";
        advice.loanPercent = 100;
        advice.reserveRelease = 100;
      }

      if (strategy === "Balanced, no loans") {
        advice.buyProperty = 15;
      }

      if (strategy === "Borrowed property held" && round < 4) {
        advice.buyProperty = 100;
        advice.reserveRelease = 100;
      }

      if (
        strategy === "Efficiency, no loans" &&
        round < 6 &&
        !live.project &&
        live.efficiency < 3
      ) {
        advice.project = "efficiency";
      }
    }

    let plan = live.suspended
      ? null
      : prepareInvestment(live, advice, current.rules, current.brief);

    if (plan && !plan.valid && plan.purchasePercentLimit != null) {
      advice.buyProperty = Math.min(
        advice.buyProperty,
        plan.purchasePercentLimit
      );

      plan = prepareInvestment(
        live, advice, current.rules, current.brief
      );
    }

    if (plan && !plan.valid) {
      plan = prepareInvestment(
        live,
        defaultInvestmentPlan(),
        current.rules,
        current.brief
      );
    }

    if (plan) {
      assert.equal(plan.valid, true, plan.problems.join(" "));
    }

    const entry = closeCompany(
      live, plan, current, false, opening
    );

    if (!adviserActive && board.dismissed) {
      entry.boardManaged = true;
    }

    const referenceResult = settleReferenceCompany(reference, current);

    const assessment = assessInvestor({
      entry,
      referenceEntry: referenceResult.entry,
      mission,
      previousBoard: board,
      publicShock: Boolean(current.dealing.halt),
    });

    if (!entry.inactive) {
      assert.equal(
        companyValue(entry.after) - companyValue(entry.before),
        entry.metrics.netProfit
      );
    }

    assert.equal(
      entry.after.debt,
      entry.after.loans.reduce((sum, loan) => sum + loan.balance, 0)
    );

    state = entry.after;
    reference = referenceResult.reference;
    board = assessment.board;
    history.push(entry);
    previousPrices = closingPrices;
    finalPacket = current;
  }

  const ending = finalCompanyReport(
    { state, history, board },
    finalPacket
  );

  return { state, reference, board, history, ending };
}

test("ordinary management profits produce zero investor-added value", () => {
  for (const industry of [
    "electronics",
    "machinery",
    "essentials",
    "materials",
  ]) {
    const result = runStrategy(
      industry,
      "No discretionary investment",
      `same-company-${industry}`
    );

    assert.equal(result.board.companySnapshot.score, 0);
    assert.ok(
      result.history.some((entry) => entry.metrics.netProfit > 0)
    );
  }
});

test("efficiency savings are reported without breaking the accounts", () => {
  const result = runStrategy(
    "electronics",
    "Efficiency, no loans",
    "efficiency-report"
  );

  assert.ok(
    result.history.some((entry) =>
      entry.metrics.efficiencySavings > 0
    )
  );

  const recordSize = Buffer.byteLength(JSON.stringify({
    state: result.state,
    reference: result.reference,
    board: result.board,
    history: result.history,
    ending: result.ending,
  }));

  assert.ok(recordSize < 140000, `Unexpected record size: ${recordSize}`);
});

test("R6 investor strategy audit", () => {
  const rows = [];
  const runs = 6;

  for (const industry of [
    "electronics",
    "machinery",
    "essentials",
    "materials",
  ]) {
    for (const strategy of [
      "No discretionary investment",
      "Balanced, no loans",
      "Efficiency, no loans",
      "Borrowed shares held",
      "Borrowed property held",
      "Active trader",
      "Exit before crash (hindsight)",
    ]) {
      let closures = 0;
      let replacements = 0;
      let totalGain = 0;
      let goalsMet = 0;
      let reviews = 0;

      for (let run = 0; run < runs; run += 1) {
        const result = runStrategy(
          industry,
          strategy,
          `r6-audit-${run}`
        );

        if (result.state.suspended) closures += 1;
        if (result.board.dismissed) replacements += 1;

        totalGain += result.board.companySnapshot.score;
        goalsMet += result.board.reviews - result.board.warnings;
        reviews += result.board.reviews;
      }

      rows.push({
        industry,
        strategy,
        runs,
        closures,
        advisersReplaced: replacements,
        goalsMetPercent: reviews
          ? Math.round(goalsMet / reviews * 100)
          : 0,
        averageInvestmentGainYenMillions:
          Math.round(totalGain / runs / 100),
      });
    }
  }

  console.table(rows);
});