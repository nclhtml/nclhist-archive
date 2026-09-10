"use strict";

const { createEightPacket } = require("./eight-scenario.cjs");

/*
 * Teaching parameters, not historical company accounts.
 *
 * Stronger expansion creates a reason to invest in capacity.
 * During the downturn, orders and selling margins fall faster than
 * employment and contract commitments.
 */
const SETTINGS = [
  {
    domestic: 92, export: 60,
    price: 1.00, cost: 1.00, payroll: 1.00,
    delay: 0.00, writeOff: 0.005,
    credit: 1.15, principal: 0.00, renewal: 1.00,
  },
  {
    domestic: 110, export: 78,
    price: 1.03, cost: 1.02, payroll: 1.02,
    delay: 0.01, writeOff: 0.005,
    credit: 1.40, principal: 0.00, renewal: 1.00,
  },
  {
    domestic: 155, export: 112,
    price: 1.05, cost: 1.04, payroll: 1.06,
    delay: 0.03, writeOff: 0.005,
    credit: 1.65, principal: 0.00, renewal: 1.00,
  },
  {
    domestic: 165, export: 120,
    price: 1.06, cost: 1.07, payroll: 1.10,
    delay: 0.04, writeOff: 0.01,
    credit: 1.70, principal: 0.04, renewal: 0.70,
  },
  {
    domestic: 105, export: 78,
    price: 0.96, cost: 1.07, payroll: 1.14,
    delay: 0.16, writeOff: 0.03,
    credit: 0.70, principal: 0.18, renewal: 0.10,
  },
  {
    domestic: 65, export: 43,
    price: 0.86, cost: 1.06, payroll: 1.13,
    delay: 0.27, writeOff: 0.07,
    credit: 0.48, principal: 0.30, renewal: 0.00,
  },
  {
    domestic: 80, export: 55,
    price: 0.88, cost: 1.04, payroll: 1.11,
    delay: 0.23, writeOff: 0.05,
    credit: 0.53, principal: 0.20, renewal: 0.10,
  },
  {
    domestic: 90, export: 63,
    price: 0.91, cost: 1.03, payroll: 1.10,
    delay: 0.20, writeOff: 0.04,
    credit: 0.60, principal: 0.16, renewal: 0.15,
  },
];

function createInvestorPacket(index, seed, settings) {
  const packet = createEightPacket(index, seed, settings);
  const conditions = SETTINGS[index];

  if (!conditions) throw new Error("Invalid investor period.");

  const oldWriteOff = packet.rules.economy.writeOff;

  packet.performanceVersion = 1;

  packet.rules = {
    ...packet.rules,
    creditFactor: conditions.credit,
    principalRate: conditions.principal,
    maxNewDebt: index < 4
      ? packet.rules.maxNewDebt
      : [1250, 0, 500, 1000][index - 4],
    propertySaleFraction: index < 5
      ? packet.rules.propertySaleFraction
      : [0.12, 0.18, 0.22][index - 5],
    propertyBid: index < 5
      ? packet.rules.propertyBid
      : [0.80, 0.84, 0.88][index - 5],
    emergencyPropertyRate: index < 4 ? 0.55 : 0.38,
    propertyYield: index < 4 ? 0.015 : 0.002,
    economy: {
      ...packet.rules.economy,
      performanceVersion: 1,
      priceLevel: conditions.price,
      costLevel: conditions.cost,
      payrollLevel: conditions.payroll,
      delay: conditions.delay,
      writeOff: conditions.writeOff,
      renewal: conditions.renewal,
    },
  };

  const domestic = Math.max(
    0, conditions.domestic + packet.combined.domesticDelta
  );

  const exports = Math.max(
    0, conditions.export + packet.combined.exportDelta
  );

  packet.brief = {
    ...packet.brief,
    performanceVersion: 1,
    rules: packet.rules,
    forecast: {
      domestic: [Math.max(0, domestic - 12), domestic + 12],
      export: [Math.max(0, exports - 8), exports + 8],
    },
  };

  /*
   * Retain the original shared shock draw.
   * Change only its receivable-loss scale.
   */
  for (const outcome of Object.values(packet.outcome.economy)) {
    const factor = oldWriteOff > 0
      ? outcome.writeOff / oldWriteOff
      : 1;

    outcome.writeOff = Math.min(
      0.25,
      conditions.writeOff * factor
    );
  }

  packet.outcome.domesticDemand = domestic;
  packet.outcome.exportDemand = exports;

  return packet;
}

module.exports = { createInvestorPacket };