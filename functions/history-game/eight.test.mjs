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
  finalCompanyReport,
} from "./resilience-model.mjs";

import {
  eightCreditLimit,
  estimatedShareSale,
} from "./eight-model.mjs";

const require = createRequire(import.meta.url);

const {
  EIGHT_ROUNDS,
  createEightPacket,
} = require("./eight-scenario.cjs");

const {
  createTape,
  initialPublicMarket,
  revealMarket,
} = require("./dealing-server.cjs");

function initial(industry = "electronics") {
  return dealing.withListedShares({
    ...initialCompany(industry),
    lessonVersion: 4,
    propertyCost: 0,
  });
}

function packet(round, seed = "eight-test", previousPrices = null) {
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

test("the new scenario has exactly eight periods", () => {
  assert.equal(EIGHT_ROUNDS.length, 8);
  assert.equal(EIGHT_ROUNDS[0].date, "Early 1985");
  assert.equal(EIGHT_ROUNDS[7].date, "1995");
});

test("the share basket cannot be purchased in R4", () => {
  const current = packet(0);
  const state = openCompany(initial(), current).after;

  const plan = prepareInvestment(
    state,
    { ...defaultInvestmentPlan(), buyStocks: 25 },
    current.rules,
    current.brief
  );

  assert.equal(plan.valid, false);
});

test("the 1990 opening does not announce or apply the scheduled crash", () => {
  const current = createEightPacket(4, "crash-opening", {
    count: 1,
    mode: "mixed",
    pinned: [],
  });

  current.dealing = createTape(
    current,
    "crash-opening",
    dealing.DEFAULT_MARKET_CONFIG,
    dealing.START_PRICES,
    dealing
  );

  assert.equal(current.combined.stockBps, 0);
  assert.deepEqual(current.dealing.path[0], dealing.START_PRICES);

  assert.equal(
    current.brief.events.some((event) => event.id === "stock-collapse"),
    false
  );

  const publicMarket = initialPublicMarket(current.dealing, 4, 1000);

  assert.equal(publicMarket.halt, undefined);
  assert.equal(publicMarket.breaking, undefined);
  assert.equal(publicMarket.path, undefined);
});

test("the mid-session shock interrupts both buying and selling", () => {
  const current = packet(4);
  const tape = current.dealing;

  let market = {
    ...initialPublicMarket(tape, 4, 1000),
    startedAt: 1000,
  };

  const atShock = 1000 + tape.halt.startTick * 5000;

  market = revealMarket(market, tape, atShock, dealing);

  assert.equal(dealing.marketClock(market, atShock).halted, true);
  assert.ok(market.breaking);

  for (const share of dealing.LISTED_SHARES) {
    assert.ok(
      tape.path[tape.halt.startTick][share.id] <
      tape.path[tape.halt.startTick - 1][share.id] * 0.8
    );
  }

  for (const side of ["buy", "sell"]) {
    assert.throws(
      () => dealing.checkTradeWindow(market, atShock, {
        side,
        quoteTick: market.tick,
        marketRevision: market.revision,
      }),
      /temporarily suspended/
    );
  }

  const reopening = 1000 + tape.halt.endTick * 5000;

  market = revealMarket(market, tape, reopening, dealing);

  assert.equal(dealing.marketClock(market, reopening).halted, false);

  assert.doesNotThrow(() => dealing.checkTradeWindow(market, reopening, {
    quoteTick: market.tick,
    marketRevision: market.revision,
  }));
});

test("a loan does not increase net worth or manufacture extra collateral", () => {
  const current = packet(0);
  const state = initial();

  const loanFunded = {
    ...state,
    cash: state.cash + 5000,
    debt: state.debt + 5000,
  };

  assert.equal(companyValue(loanFunded), companyValue(state));
  assert.equal(
    eightCreditLimit(loanFunded, current.rules),
    eightCreditLimit(state, current.rules)
  );
});

test("sale estimates match the actual weighted-cost sale result", () => {
  let state = initial();

  state = dealing.applyListedTrade(
    state,
    dealing.START_PRICES,
    "hikari",
    "buy",
    4,
    state.cash
  ).state;

  const prices = { ...dealing.START_PRICES, hikari: 290 };
  const quote = dealing.executionQuote(prices, "hikari", "sell", 2);
  const estimate = estimatedShareSale(state, "hikari", quote);

  const result = dealing.applyListedTrade(
    state,
    prices,
    "hikari",
    "sell",
    2,
    state.cash
  );

  assert.equal(estimate.result, result.receipt.realized);
});

test("property sales remove proportional historical cost", () => {
  const current = packet(5);

  const state = {
    ...initial(),
    cash: 100000,
    property: 8000,
    propertyCost: 10000,
  };

  const plan = prepareInvestment(
    state,
    { ...defaultInvestmentPlan(), sellProperty: 10 },
    current.rules,
    current.brief
  );

  assert.equal(plan.valid, true, plan.problems.join(" "));
  assert.equal(plan.propertySaleValue, 800);
  assert.equal(plan.propertySoldCost, 1000);
  assert.equal(plan.proposed.propertyCost, 9000);
  assert.equal(plan.propertyRealized, plan.propertySaleCash - 1000);
});

test("eight-round individual-share strategy audit", () => {
  const strategies = [
    "Cash / no new debt",
    "Borrow and hold shares",
    "Exit before 1990",
    "Efficiency investment",
  ];

  const rows = [];

  for (const industry of ["electronics", "machinery", "essentials", "materials"]) {
    for (const strategy of strategies) {
      let closures = 0;
      let vulnerable = 0;
      let finalWorth = 0;
      const runs = 6;

      for (let run = 0; run < runs; run += 1) {
        let state = initial(industry);
        let previousPrices = null;
        const history = [];
        let finalPacket;

        for (let round = 0; round < 8; round += 1) {
          const current = packet(round, `eight-audit-${run}`, previousPrices);
          const opening = openCompany(state, current);
          let activeState = opening.after;

          const borrower =
            strategy === "Borrow and hold shares" ||
            strategy === "Exit before 1990";

          if (!activeState.suspended && borrower && round < 4) {
            const protection = prepareInvestment(
              activeState,
              { ...defaultInvestmentPlan(), reserveRelease: 100 },
              current.rules,
              current.brief
            );

            const lots = protection.valid
              ? dealing.maximumBuyLots(
                  current.dealing.path[0],
                  "hikari",
                  protection.budget
                )
              : 0;

            if (lots > 0) {
              activeState = dealing.applyListedTrade(
                activeState,
                current.dealing.path[0],
                "hikari",
                "buy",
                lots,
                protection.budget
              ).state;
            }
          }

          const closingPrices =
            current.dealing.path[current.dealing.path.length - 1];

          if (!activeState.suspended) {
            activeState = dealing.markListed(activeState, closingPrices);
          }

          if (
            !activeState.suspended &&
            strategy === "Exit before 1990" &&
            round === 3 &&
            activeState.listed.hikari.lots > 0
          ) {
            activeState = dealing.applyListedTrade(
              activeState,
              closingPrices,
              "hikari",
              "sell",
              activeState.listed.hikari.lots,
              activeState.cash
            ).state;
          }

          let advice = defaultInvestmentPlan();

          if (borrower && round < 3) {
            advice.loanMode = "borrow";
            advice.loanPercent = 100;
            advice.reserveRelease = 100;
          }

          if (
            strategy === "Efficiency investment" &&
            round < 6 &&
            !activeState.project &&
            activeState.efficiency < 3
          ) {
            advice.project = "efficiency";
          }

          let plan = activeState.suspended
            ? null
            : prepareInvestment(
                activeState,
                advice,
                current.rules,
                current.brief
              );

          if (plan && !plan.valid) {
            plan = prepareInvestment(
              activeState,
              defaultInvestmentPlan(),
              current.rules,
              current.brief
            );
          }

          if (plan) {
            assert.equal(plan.valid, true, plan.problems.join(" "));
          }

          const entry = closeCompany(
            activeState,
            plan,
            current,
            false,
            opening
          );

          if (!entry.inactive) {
            entry.metrics.dealingProfit =
              companyValue(activeState) - companyValue(opening.after);

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
          history.push(entry);
          previousPrices = closingPrices;
          finalPacket = current;
        }

        const report = finalCompanyReport({ state, history }, finalPacket);

        if (state.suspended) closures += 1;
        if (report.outcome === "Surviving but vulnerable") vulnerable += 1;
        finalWorth += companyValue(state);
      }

      rows.push({
        industry,
        strategy,
        runs,
        closures,
        vulnerable,
        averageEndingYenMillions: Math.round(finalWorth / runs / 100),
      });
    }
  }

  console.table(rows);
});