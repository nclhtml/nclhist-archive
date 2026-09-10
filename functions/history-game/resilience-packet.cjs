"use strict";

const crypto = require("node:crypto");
const { createPacket } = require("./engine.cjs");

/*
 * Fictional model conditions, not historical company-account data.
 *
 * Columns:
 * selling-price level, input-cost level, payroll/contract level,
 * additional deferred-payment fraction, expected receivable loss,
 * permitted renewal fraction of maturing debt.
 *
 * The historical narrative remains in engine.cjs.
 */
const CONDITIONS = [
  [1.00, 1.00, 1.00, 0.00, 0.005, 1.00],
  [1.00, 1.00, 1.00, 0.00, 0.005, 1.00],
  [1.03, 1.02, 1.03, 0.00, 0.005, 1.00],
  [1.05, 1.03, 1.05, 0.00, 0.005, 1.00],
  [1.07, 1.05, 1.08, 0.01, 0.005, 1.00],
  [1.04, 1.06, 1.10, 0.03, 0.010, 0.70],
  [0.98, 1.05, 1.10, 0.10, 0.020, 0.25],
  [0.92, 1.04, 1.09, 0.17, 0.040, 0.10],
  [0.90, 1.03, 1.08, 0.22, 0.060, 0.00],
  [0.91, 1.02, 1.07, 0.20, 0.040, 0.10],
  [0.92, 1.02, 1.07, 0.18, 0.040, 0.20],
  [0.93, 1.02, 1.06, 0.16, 0.030, 0.25],
];

function randomFor(seed, round, purpose) {
  let counter = 0;

  return () => {
    const digest = crypto.createHash("sha256")
      .update(`${seed}:${round}:${purpose}:${counter++}`)
      .digest();

    return digest.readUInt32BE(0) / 4294967296;
  };
}

function createResiliencePacket(index, seed, settings) {
  const packet = createPacket(index, seed, settings);

  const [
    priceLevel,
    costLevel,
    payrollLevel,
    delay,
    writeOff,
    renewal,
  ] = CONDITIONS[index];

  const economy = {
    version: 2,
    round: index,
    months: 3,
    priceLevel,
    costLevel,
    payrollLevel,
    delay,
    writeOff,
    renewal,
    factorySaleRate: index < 6 ? 0.75 : 0.6,
  };

  packet.rules = {
    ...packet.rules,
    advisorMode: 2,
    maxDebt: 30000,
    maxNewDebt: index < 5 ? 7000 : packet.rules.maxNewDebt,
    creditBase: 6000,
    stockCollateral: 0.3,
    propertyCollateral: 0.65,
    factoryCollateral: 0.5,
    stockYield: index < 6 ? 0.01 : 0.003,
    propertyYield: index < 6 ? 0.015 : 0.005,
    emergencyStockRate: index < 6 ? 0.8 : 0.75,
    emergencyPropertyRate: index < 6 ? 0.55 : 0.45,
    economy,
  };

  packet.brief = {
    ...packet.brief,
    economyVersion: 2,
    rules: packet.rules,
    body:
      "Read the historical briefing and your company's operating outlook. " +
      "Forecasts are estimates, not guaranteed orders. Share and property " +
      "movements have already affected existing holdings. Company operations " +
      "settle once per turn, representing one model quarter.",
  };

  const commonRandom = randomFor(seed, index, "resilience-common");
  const spread = index < 6 ? 0.28 : 0.48;

  const commonDomestic =
    1 + (commonRandom() - 0.5) * spread;

  const commonExport =
    1 + (commonRandom() - 0.5) * spread;

  const industries = [
    "electronics",
    "machinery",
    "essentials",
    "materials",
  ];

  packet.outcome.economy = Object.fromEntries(
    industries.map((industry) => {
      const random = randomFor(
        seed, index, `resilience-${industry}`
      );

      const industrySpread = industry === "essentials"
        ? 0.14
        : 0.32;

      return [
        industry,
        {
          domesticFactor: Math.max(
            0.3,
            commonDomestic +
            (random() - 0.5) * industrySpread
          ),
          exportFactor: Math.max(
            0.3,
            commonExport +
            (random() - 0.5) * industrySpread
          ),
          writeOff: Math.min(
            0.25,
            writeOff * (0.5 + random())
          ),
        },
      ];
    })
  );

  return packet;
}

module.exports = { createResiliencePacket };