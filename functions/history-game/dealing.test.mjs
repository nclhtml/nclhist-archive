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

const require = createRequire(import.meta.url);

const {
  createResiliencePacket,
} = require("./resilience-packet.cjs");

const {
  createTape,
  initialPublicMarket,
  revealMarket,
} = require("./dealing-server.cjs");

function makePacket(round = 0) {
  const packet = createResiliencePacket(round, "dealing-tests", {
    count: 0,
    mode: "mixed",
    pinned: [],
  });

  packet.dealing = createTape(
    packet,
    "dealing-tests",
    dealing.DEFAULT_MARKET_CONFIG,
    null,
    dealing
  );

  return packet;
}

test("all four price paths exist and are repeatable for the same private seed", () => {
  const a = makePacket();
  const b = makePacket();

  assert.deepEqual(a.dealing.path, b.dealing.path);
  assert.equal(a.dealing.path.length, 25);

  for (const prices of a.dealing.path) {
    assert.equal(Object.keys(prices).length, 4);

    for (const price of Object.values(prices)) {
      assert.ok(Number.isSafeInteger(price));
      assert.ok(price > 0);
    }
  }
});

test("only elapsed quotes are published", () => {
  const packet = makePacket();
  let publicMarket = initialPublicMarket(packet.dealing, 0, 1000);

  publicMarket.startedAt = 1000;

  const published = revealMarket(
    publicMarket,
    packet.dealing,
    11000,
    dealing
  );

  assert.equal(published.tick, 2);
  assert.equal(published.history.length, 3);
  assert.equal("path" in published, false);
  assert.equal("watch" in published, false);
});

test("trading and grace deadlines are separate", () => {
  const packet = makePacket();

  const market = {
    ...initialPublicMarket(packet.dealing, 0, 1000),
    startedAt: 1000,
  };

  assert.equal(dealing.marketClock(market, 120999).stage, "live");
  assert.equal(dealing.marketClock(market, 121000).stage, "grace");
  assert.equal(dealing.marketClock(market, 141000).stage, "closed");

  assert.throws(
    () => dealing.checkTradeWindow(market, 121000, {
      quoteTick: 24,
      marketRevision: 0,
    }),
    /closed/
  );
});

test("pausing freezes elapsed market time", () => {
  const packet = makePacket();

  const market = {
    ...initialPublicMarket(packet.dealing, 0, 1000),
    startedAt: 1000,
    pausedAt: 11000,
  };

  assert.equal(dealing.marketClock(market, 500000).tick, 2);
  assert.equal(dealing.marketClock(market, 500000).paused, true);

  const resumed = {
    ...market,
    pausedAt: null,
    pausedMs: 20000,
  };

  assert.equal(dealing.marketClock(resumed, 31000).tick, 2);
});

test("old quotes are rejected", () => {
  const packet = makePacket();

  const market = {
    ...initialPublicMarket(packet.dealing, 0, 1000),
    startedAt: 1000,
  };

  assert.throws(
    () => dealing.checkTradeWindow(market, 11000, {
      quoteTick: 1,
      marketRevision: 0,
    }),
    /quote changed/
  );
});

test("a buy reduces wealth only by spread and fee at unchanged market prices", () => {
  const state = dealing.withListedShares(initialCompany("electronics"));
  const prices = dealing.START_PRICES;

  const result = dealing.applyListedTrade(
    state,
    prices,
    "hikari",
    "buy",
    4,
    state.cash
  );

  assert.equal(result.state.listed.hikari.lots, 4);

  assert.equal(
    companyValue(result.state) - companyValue(state),
    -result.receipt.fee - result.receipt.spread
  );

  assert.equal(
    result.state.cash,
    state.cash - result.receipt.cashAmount
  );
});

test("overspending and selling unowned shares are rejected", () => {
  const state = dealing.withListedShares(initialCompany("electronics"));

  assert.throws(() => dealing.applyListedTrade(
    state,
    dealing.START_PRICES,
    "hikari",
    "buy",
    4,
    1
  ), /cash/);

  assert.throws(() => dealing.applyListedTrade(
    state,
    dealing.START_PRICES,
    "hikari",
    "sell",
    1,
    state.cash
  ), /own enough/);
});

test("selling a complete holding clears its cost basis", () => {
  let state = dealing.withListedShares(initialCompany("electronics"));

  state = dealing.applyListedTrade(
    state,
    dealing.START_PRICES,
    "hikari",
    "buy",
    4,
    state.cash
  ).state;

  const result = dealing.applyListedTrade(
    state,
    dealing.START_PRICES,
    "hikari",
    "sell",
    4,
    state.cash
  );

  assert.equal(result.state.listed.hikari.lots, 0);
  assert.equal(result.state.listed.hikari.cost, 0);
  assert.ok(result.state.dealingTotals.realized < 0);
});

test("company settlement reconciles after a live trade and later price movement", () => {
  const packet = makePacket();

  const initial = dealing.withListedShares(initialCompany("electronics"));
  const opening = openCompany(initial, packet);

  const trade = dealing.applyListedTrade(
    opening.after,
    packet.dealing.path[0],
    "hikari",
    "buy",
    2,
    2000
  );

  const plan = prepareInvestment(
    trade.state,
    defaultInvestmentPlan(),
    packet.rules,
    packet.brief
  );

  assert.equal(plan.valid, true, plan.problems.join(" "));

  const closingState = dealing.markListed(
    trade.state,
    packet.dealing.path[packet.dealing.path.length - 1]
  );

  const entry = closeCompany(
    closingState,
    plan,
    packet,
    false,
    opening
  );

  assert.equal(
    companyValue(entry.after) - companyValue(entry.before),
    entry.metrics.netProfit
  );

  assert.equal(
    entry.after.debt,
    entry.after.loans.reduce((sum, loan) => sum + loan.balance, 0)
  );
});