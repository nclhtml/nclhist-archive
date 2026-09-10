import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  INDUSTRIES,
  initialCompany,
  companyValue,
  defaultInvestmentPlan,
  prepareInvestment,
  openCompany,
  closeCompany,
  finalCompanyReport,
} from "./resilience-model.mjs";

const require = createRequire(import.meta.url);

const {
  createResiliencePacket,
} = require("./resilience-packet.cjs");

function packet(round, seed = "accounting-test") {
  return createResiliencePacket(round, seed, {
    count: 0,
    mode: "mixed",
    pinned: [],
  });
}

function playRound(state, round, advice, seed = "accounting-test") {
  const current = packet(round, seed);
  const opening = openCompany(state, current);

  const plan = opening.after.suspended
    ? null
    : prepareInvestment(
        opening.after,
        advice,
        current.rules,
        current.brief
      );

  if (plan) {
    assert.equal(
      plan.valid,
      true,
      plan.problems.join(" ")
    );
  }

  const entry = closeCompany(
    opening.after,
    plan,
    current,
    false,
    opening
  );

  assert.equal(
    entry.after.debt,
    entry.after.loans.reduce(
      (sum, loan) => sum + loan.balance,
      0
    )
  );

  if (!entry.inactive) {
    assert.equal(
      companyValue(entry.after) - companyValue(entry.before),
      entry.metrics.netProfit
    );
  }

  for (const key of [
    "cash", "debt", "stocks", "property", "factoryBook",
    "inventory", "inventoryBook", "receivables", "factories",
  ]) {
    assert.equal(Number.isSafeInteger(entry.after[key]), true, key);
    assert.ok(entry.after[key] >= 0, key);
  }

  return { entry, packet: current };
}

test("all four industries start with equal net worth", () => {
  const balances = Object.keys(INDUSTRIES).map((id) =>
    initialCompany(id)
  );

  for (const state of balances) {
    assert.equal(companyValue(state), 20000);
    assert.equal(state.cash + state.factoryBook, 20000);
  }

  assert.notEqual(balances[0].cash, balances[2].cash);
});

test("combined purchase allocation cannot exceed 100%", () => {
  const current = packet(0);
  const opening = openCompany(initialCompany("electronics"), current);

  const invalid = prepareInvestment(
    opening.after,
    {
      ...defaultInvestmentPlan(),
      buyStocks: 70,
      buyProperty: 40,
    },
    current.rules,
    current.brief
  );

  assert.equal(invalid.valid, false);
});

test("releasing the safety buffer does not create wealth", () => {
  const current = packet(0);
  const opening = openCompany(initialCompany("machinery"), current);

  const protectedPlan = prepareInvestment(
    opening.after,
    defaultInvestmentPlan(),
    current.rules,
    current.brief
  );

  const releasedPlan = prepareInvestment(
    opening.after,
    {
      ...defaultInvestmentPlan(),
      reserveRelease: 100,
    },
    current.rules,
    current.brief
  );

  assert.equal(protectedPlan.valid, true);
  assert.equal(releasedPlan.valid, true);
  assert.ok(releasedPlan.budget >= protectedPlan.budget);

  assert.equal(
    companyValue(releasedPlan.proposed),
    companyValue(protectedPlan.proposed)
  );
});

test("opening investment losses are not applied again at settlement", () => {
  const state = initialCompany("essentials");
  state.cash = 100000;
  state.stocks = 10000;

  const current = createResiliencePacket(6, "single-crash", {
    count: 2,
    mode: "mixed",
    pinned: [],
  });

  const opening = openCompany(state, current);
  assert.equal(opening.after.stocks, 6200);

  const plan = prepareInvestment(
    opening.after,
    defaultInvestmentPlan(),
    current.rules,
    current.brief
  );

  assert.equal(plan.valid, true);

  const entry = closeCompany(
    opening.after, plan, current, false, opening
  );

  assert.equal(entry.after.stocks, 6200);
});

test("improvement benefits begin after the stated delay", () => {
  let state = initialCompany("machinery");

  const first = playRound(state, 0, {
    ...defaultInvestmentPlan(),
    project: "efficiency",
  });

  state = first.entry.after;
  assert.equal(state.efficiency, 0);
  assert.equal(state.project.readyRound, 2);

  const second = playRound(state, 1, defaultInvestmentPlan());
  state = second.entry.after;
  assert.equal(state.efficiency, 0);

  const thirdOpening = openCompany(state, packet(2));
  assert.equal(thirdOpening.after.efficiency, 1);
  assert.equal(thirdOpening.after.project, null);
});

test("twelve-round accounts and ending reports reconcile", () => {
  for (const industry of Object.keys(INDUSTRIES)) {
    let state = initialCompany(industry);
    const history = [];
    let finalPacket;

    for (let round = 0; round < 12; round += 1) {
      const result = playRound(
        state,
        round,
        defaultInvestmentPlan(),
        `full-run-${industry}`
      );

      state = result.entry.after;
      history.push(result.entry);
      finalPacket = result.packet;
    }

    const report = finalCompanyReport({ state, history }, finalPacket);

    assert.equal(report.netWorth, companyValue(state));
    assert.ok(report.outcome.length > 0);

    const size = Buffer.byteLength(
      JSON.stringify({ state, history, ending: report }),
      "utf8"
    );

    assert.ok(size < 120000, `Unexpectedly large company record: ${size}`);
  }
});

test("strategy audit — descriptive results, not a rigged pass/fail ranking", () => {
  const strategies = [
    "Cash and no new debt",
    "Borrowed shares held",
    "Borrowed property held",
    "Efficiency investment",
  ];

  const table = [];

  for (const industry of Object.keys(INDUSTRIES)) {
    for (const strategy of strategies) {
      let closed = 0;
      let vulnerable = 0;
      let totalWorth = 0;
      const runs = 8;

      for (let run = 0; run < runs; run += 1) {
        let state = initialCompany(industry);
        const history = [];
        let finalPacket;

        for (let round = 0; round < 12; round += 1) {
          const current = packet(round, `audit-${run}`);
          const opening = openCompany(state, current);
          let advice = defaultInvestmentPlan();

          if (!opening.after.suspended) {
            if (strategy === "Borrowed shares held" && round < 6) {
              advice = {
                ...advice,
                loanMode: "borrow",
                loanPercent: 100,
                buyStocks: 100,
                reserveRelease: 100,
              };
            }

            if (strategy === "Borrowed property held" && round < 6) {
              advice = {
                ...advice,
                loanMode: "borrow",
                loanPercent: 100,
                buyProperty: 100,
                reserveRelease: 100,
              };
            }

            if (
              strategy === "Efficiency investment" &&
              round < 7 &&
              !opening.after.project &&
              opening.after.efficiency < 3
            ) {
              advice.project = "efficiency";
            }
          }

          let plan = opening.after.suspended
            ? null
            : prepareInvestment(
                opening.after,
                advice,
                current.rules,
                current.brief
              );

          if (plan && !plan.valid) {
            advice = {
              ...advice,
              buyStocks: Math.min(
                advice.buyStocks,
                plan.purchasePercentLimit ?? 100
              ),
              buyProperty: Math.min(
                advice.buyProperty,
                plan.purchasePercentLimit ?? 100
              ),
            };

            plan = prepareInvestment(
              opening.after,
              advice,
              current.rules,
              current.brief
            );
          }

          if (plan && !plan.valid) {
            plan = prepareInvestment(
              opening.after,
              defaultInvestmentPlan(),
              current.rules,
              current.brief
            );
          }

          if (plan) {
            assert.equal(plan.valid, true, plan.problems.join(" "));
          }

          const entry = closeCompany(
            opening.after, plan, current, false, opening
          );

          state = entry.after;
          history.push(entry);
          finalPacket = current;
        }

        const report = finalCompanyReport(
          { state, history },
          finalPacket
        );

        if (state.suspended) closed += 1;
        if (report.outcome === "Surviving but vulnerable") vulnerable += 1;

        totalWorth += companyValue(state);
      }

      table.push({
        industry,
        strategy,
        runs,
        closures: closed,
        vulnerable,
        averageEndingYenMillions: Math.round(
          totalWorth / runs / 100
        ),
      });
    }
  }

  console.table(table);
});