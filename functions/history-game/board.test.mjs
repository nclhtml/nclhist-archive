import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import * as dealing from "./dealing-model.mjs";

import {
  initialCompany,
  companyValue,
  defaultInvestmentPlan,
  prepareInvestment,
  openCompany,
  closeCompany,
} from "./resilience-model.mjs";

import {
  initialBoardRecord,
  createBoardMission,
  settleBoardReview,
  effectiveRoundTarget,
} from "./board-model.mjs";

const require = createRequire(import.meta.url);

const { createEightPacket } = require("./eight-scenario.cjs");
const { createTape } = require("./dealing-server.cjs");

function initial(industry = "electronics") {
  return dealing.withListedShares({
    ...initialCompany(industry),
    lessonVersion: 4,
    propertyCost: 0,
  });
}

function packet(round, seed = "board-test", previousPrices = null) {
  const result = createEightPacket(round, seed, {
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

function basicEntry(round, before, after, projectCost = 0) {
  return {
    round,
    date: `Round ${round + 1}`,
    before,
    after,
    inactive: false,
    defaulted: false,
    opening: { before, after: before, round },
    metrics: { projectCost },
    advisor: {
      advice: {
        project: projectCost > 0 ? "efficiency" : "none",
      },
    },
  };
}

test("practice has no warning and establishes the later baseline", () => {
  const before = initial();
  const after = { ...before, cash: before.cash - 1000 };
  const current = packet(0);
  const board = initialBoardRecord();

  const mission = createBoardMission(
    { before, after: before },
    current,
    board
  );

  const result = settleBoardReview(
    basicEntry(0, before, after),
    mission,
    board
  );

  assert.equal(result.board.warnings, 0);
  assert.equal(result.board.reviews, 0);
  assert.equal(result.review.status, "practice");
  assert.equal(result.board.anchorWorth, companyValue(after));
});

test("borrowing cannot create target earnings", () => {
  const before = initial();

  const board = {
    ...initialBoardRecord(),
    anchorWorth: companyValue(before),
  };

  const current = packet(1);

  const mission = createBoardMission(
    { before, after: before },
    current,
    board
  );

  const after = {
    ...before,
    cash: before.cash + 5000,
    debt: before.debt + 5000,
  };

  const result = settleBoardReview(
    basicEntry(1, before, after),
    mission,
    board
  );

  assert.equal(result.review.gainSoFar, 0);
});

test("project allowance offsets its expense without manufacturing success", () => {
  const before = initial();

  const board = {
    ...initialBoardRecord(),
    anchorWorth: companyValue(before),
  };

  const current = packet(1);
  const mission = createBoardMission(
    { before, after: before },
    current,
    board
  );

  const earned = 2500;
  const projectCost = 2000;

  const noProject = settleBoardReview(
    basicEntry(1, before, {
      ...before,
      cash: before.cash + earned,
    }),
    mission,
    board
  );

  const withProject = settleBoardReview(
    basicEntry(1, before, {
      ...before,
      cash: before.cash + earned - projectCost,
    }, projectCost),
    mission,
    board
  );

  assert.equal(
    noProject.review.gainSoFar - noProject.review.totalTarget,
    withProject.review.gainSoFar - withProject.review.totalTarget
  );

  assert.equal(withProject.review.projectAllowance, projectCost);
  assert.equal(
    withProject.review.gainSoFar,
    noProject.review.gainSoFar - projectCost
  );
});

test("the same board review cannot be counted twice", () => {
  const before = initial();

  const board = {
    ...initialBoardRecord(),
    anchorWorth: companyValue(before),
  };

  const current = packet(1);
  const mission = createBoardMission(
    { before, after: before },
    current,
    board
  );

  const entry = basicEntry(1, before, before);

  const once = settleBoardReview(entry, mission, board);
  const twice = settleBoardReview(entry, mission, once.board);

  assert.deepEqual(twice, once);
});

test("five missed reviews replace the adviser without closing the company", () => {
  let state = initial();

  let board = {
    ...initialBoardRecord(),
    anchorWorth: companyValue(state),
  };

  for (let round = 1; round <= 5; round += 1) {
    const current = packet(round);
    const mission = createBoardMission(
      { before: state, after: state },
      current,
      board
    );

    const after = {
      ...state,
      cash: state.cash - 1000,
    };

    const result = settleBoardReview(
      basicEntry(round, state, after),
      mission,
      board
    );

    state = after;
    board = result.board;
  }

  assert.equal(board.warnings, 5);
  assert.equal(board.dismissed, true);
  assert.equal(state.suspended, false);
});

test("target creation does not inspect hidden demand or future prices", () => {
  const state = initial();
  const a = packet(2);
  const b = JSON.parse(JSON.stringify(a));

  b.outcome = { entirelyDifferent: true };
  b.dealing.path = [{ secret: "different future" }];

  const opening = { before: state, after: state };

  assert.deepEqual(
    createBoardMission(opening, a, initialBoardRecord()),
    createBoardMission(opening, b, initialBoardRecord())
  );
});

test("the capital-protection target activates only when requested after a public shock", () => {
  const state = initial();
  const current = packet(4);

  const mission = createBoardMission(
    { before: state, after: state },
    current,
    {
      ...initialBoardRecord(),
      anchorWorth: companyValue(state),
    }
  );

  assert.equal(effectiveRoundTarget(mission, false), mission.baseTarget);
  assert.equal(effectiveRoundTarget(mission, true), mission.crisisTarget);
  assert.ok(mission.crisisTarget < mission.baseTarget);
});

test("board-target strategy audit", () => {
  const strategies = [
    "Cash / no borrowing",
    "Balanced shares and property",
    "Borrowed shares held",
    "Efficiency investment",
    "Exit before 1990 — hindsight benchmark",
  ];

  const results = [];

  for (const industry of [
    "electronics",
    "machinery",
    "essentials",
    "materials",
  ]) {
    for (const strategy of strategies) {
      let closures = 0;
      let replacements = 0;
      let warningsTotal = 0;
      let passedTotal = 0;
      let reviewsTotal = 0;
      const runs = 8;

      for (let run = 0; run < runs; run += 1) {
        let state = initial(industry);
        let board = initialBoardRecord();
        let previousPrices = null;

        for (let round = 0; round < 8; round += 1) {
          const current = packet(
            round,
            `board-audit-${run}`,
            previousPrices
          );

          const opening = openCompany(state, current);
          let tradingState = opening.after;

          const mission = createBoardMission(
            opening,
            current,
            board
          );

          const adviserActive = !board.dismissed;

          const speculative =
            strategy === "Borrowed shares held" ||
            strategy === "Exit before 1990 — hindsight benchmark";

          if (
            !tradingState.suspended &&
            adviserActive &&
            (
              (speculative && round < 4) ||
              strategy === "Balanced shares and property"
            )
          ) {
            const protection = prepareInvestment(
              tradingState,
              {
                ...defaultInvestmentPlan(),
                reserveRelease: 100,
              },
              current.rules,
              current.brief
            );

            let budget = protection.valid ? protection.budget : 0;

            if (strategy === "Balanced shares and property") {
              budget = Math.floor(budget * 0.25);
            }

            const lots = dealing.maximumBuyLots(
              current.dealing.path[0],
              "hikari",
              budget
            );

            if (lots > 0) {
              tradingState = dealing.applyListedTrade(
                tradingState,
                current.dealing.path[0],
                "hikari",
                "buy",
                lots,
                budget
              ).state;
            }
          }

          const closingPrices =
            current.dealing.path[current.dealing.path.length - 1];

          if (!tradingState.suspended) {
            tradingState = dealing.markListed(
              tradingState,
              closingPrices
            );
          }

          if (
            !tradingState.suspended &&
            adviserActive &&
            strategy === "Exit before 1990 — hindsight benchmark" &&
            round === 3 &&
            tradingState.listed.hikari.lots > 0
          ) {
            tradingState = dealing.applyListedTrade(
              tradingState,
              closingPrices,
              "hikari",
              "sell",
              tradingState.listed.hikari.lots,
              tradingState.cash
            ).state;
          }

          let advice = defaultInvestmentPlan();

          if (adviserActive) {
            if (speculative && round < 3) {
              advice.loanMode = "borrow";
              advice.loanPercent = 100;
              advice.reserveRelease = 100;
            }

            if (strategy === "Balanced shares and property") {
              advice.buyProperty = 25;
            }

            if (
              strategy === "Efficiency investment" &&
              round < 6 &&
              !tradingState.project &&
              tradingState.efficiency < 3
            ) {
              advice.project = "efficiency";
            }
          }

          let plan = tradingState.suspended
            ? null
            : prepareInvestment(
                tradingState,
                advice,
                current.rules,
                current.brief
              );

          if (plan && !plan.valid) {
            plan = prepareInvestment(
              tradingState,
              defaultInvestmentPlan(),
              current.rules,
              current.brief
            );
          }

          if (plan) {
            assert.equal(plan.valid, true, plan.problems.join(" "));
          }

          const entry = closeCompany(
            tradingState,
            plan,
            current,
            false,
            opening
          );

          if (!adviserActive) entry.boardManaged = true;

          if (!entry.inactive) {
            const dealingResult =
              companyValue(tradingState) -
              companyValue(opening.after);

            const totalRoundResult =
              companyValue(entry.after) -
              companyValue(opening.before);

            assert.equal(
              totalRoundResult,
              entry.metrics.netProfit +
              dealingResult +
              opening.stockChange +
              opening.propertyChange +
              (opening.listedChange || 0)
            );
          }

          const assessment = settleBoardReview(
            entry,
            mission,
            board,
            Boolean(current.dealing.halt)
          );

          state = entry.after;
          board = assessment.board;
          previousPrices = closingPrices;
        }

        if (state.suspended) closures += 1;
        if (board.dismissed) replacements += 1;

        warningsTotal += board.warnings;
        passedTotal += board.reviews - board.warnings;
        reviewsTotal += board.reviews;
      }

      results.push({
        industry,
        strategy,
        runs,
        companyClosures: closures,
        advisersReplaced: replacements,
        averageWarnings: (warningsTotal / runs).toFixed(1),
        goalsMetPercent: reviewsTotal
          ? Math.round(passedTotal / reviewsTotal * 100)
          : 0,
      });
    }
  }

  console.table(results);
});