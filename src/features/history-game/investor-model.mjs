import {
  INDUSTRIES,
  initialCompany,
  companyValue,
  companyTerms,
  openCompany,
  defaultInvestmentPlan,
  prepareInvestment,
  closeCompany,
} from "./resilience-model.mjs";

import { withListedShares } from "./dealing-model.mjs";

export const INVESTOR_VERSION = 1;
export const INVESTOR_BOARD_VERSION = 2;
export const INVESTOR_WARNING_LIMIT = 3;
export const MAX_PROJECT_DEFERRALS = 2;

const copy = (value) => JSON.parse(JSON.stringify(value));

function requireSafeNumber(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe whole number.`);
  }
  return value;
}

export function createInvestorCompany(industry) {
  return withListedShares({
    ...initialCompany(industry),
    lessonVersion: 4,
    performanceVersion: INVESTOR_VERSION,
    propertyCost: 0,
  });
}

export function initialInvestorBoard() {
  return {
    version: INVESTOR_BOARD_VERSION,
    warningLimit: INVESTOR_WARNING_LIMIT,
    targetTotal: 0,
    reviews: 0,
    warnings: 0,
    projectDeferralsUsed: 0,
    dismissed: false,
    dismissedRound: null,
    frozen: false,
    stopReason: null,
    score: 0,
    scoreRound: -1,
    actualWorthAtAssessment: null,
    referenceWorthAtAssessment: null,
    companySnapshot: null,
    lastProcessedRound: -1,
    lastReview: null,
  };
}

export function createReferenceCompany(industry) {
  return {
    version: INVESTOR_VERSION,
    state: createInvestorCompany(industry),
    opening: null,
    openedRound: -1,
    settledRound: -1,
  };
}

export function openReferenceCompany(reference, packet) {
  if (
    !reference ||
    reference.version !== INVESTOR_VERSION ||
    reference.settledRound !== packet.index - 1
  ) {
    throw new Error("The comparison company is out of sync.");
  }

  const opening = openCompany(reference.state, packet);

  return {
    ...copy(reference),
    state: opening.after,
    opening,
    openedRound: packet.index,
  };
}

export function settleReferenceCompany(reference, packet) {
  if (
    !reference ||
    reference.openedRound !== packet.index ||
    reference.settledRound !== packet.index - 1
  ) {
    throw new Error("The comparison company's period is not ready.");
  }

  const plan = reference.state.suspended
    ? null
    : prepareInvestment(
        reference.state,
        defaultInvestmentPlan(),
        packet.rules,
        packet.brief
      );

  if (plan && !plan.valid) {
    throw new Error(
      "The comparison company's operating plan failed: " +
      plan.problems.join(" ")
    );
  }

  /*
   * The comparison company uses the SAME packet and demand outcomes.
   * It does not receive an independent random draw.
   */
  const entry = closeCompany(
    reference.state,
    plan,
    packet,
    false,
    reference.opening
  );

  return {
    reference: {
      version: INVESTOR_VERSION,
      state: entry.after,
      opening: reference.opening,
      openedRound: packet.index,
      settledRound: packet.index,
    },
    entry,
  };
}

export function investorAddedValue(actualState, referenceState) {
  if (actualState.industry !== referenceState.industry) {
    throw new Error("The comparison company must use the same industry.");
  }

  const actualGain =
    companyValue(actualState) - actualState.initialNetWorth;

  const referenceGain =
    companyValue(referenceState) - referenceState.initialNetWorth;

  return requireSafeNumber(
    actualGain - referenceGain,
    "Investor-added value"
  );
}

/*
 * Modest targets for additional performance above ordinary management.
 * Future demand and future share prices are not inspected.
 */
function targetForPeriod(state, packet) {
  if (packet.index === 0) return 0;

  const priceLevel = packet.rules.economy.priceLevel;

  if (priceLevel < 1.02) {
    return 0;
  }

  const industryRate = {
    electronics: 0.006,
    machinery: 0.0055,
    essentials: 0.0045,
    materials: 0.005,
  }[state.industry];

  return Math.round(
    state.initialNetWorth *
    industryRate *
    (1 + (priceLevel - 1) * 2)
  );
}

export function createInvestorMission(
  opening,
  reference,
  packet,
  board,
  totalRounds = 8
) {
  if (
    board?.version !== INVESTOR_BOARD_VERSION ||
    reference?.openedRound !== packet.index
  ) {
    throw new Error("The investor mission cannot be prepared.");
  }

  return {
    version: INVESTOR_BOARD_VERSION,
    round: packet.index,
    date: packet.brief.date,
    totalRounds,
    practice: packet.index === 0,
    targetBefore: board.targetTotal,
    baseTarget: targetForPeriod(opening.after, packet),
    crisisAllowance: Math.round(
      opening.after.initialNetWorth * 0.06
    ),
  };
}

function eligibleProjectDeferral(state, mission, board) {
  return Boolean(
    !mission.practice &&
    board.projectDeferralsUsed < MAX_PROJECT_DEFERRALS &&
    state.project &&
    state.project.readyRound > mission.round &&
    state.project.readyRound < mission.totalRounds
  );
}

export function assessInvestor({
  entry,
  referenceEntry,
  mission,
  previousBoard,
  publicShock = false,
}) {
  const previous = copy(previousBoard);

  if (
    previous.version !== INVESTOR_BOARD_VERSION ||
    mission?.version !== INVESTOR_BOARD_VERSION ||
    mission.round !== entry.round ||
    referenceEntry.round !== entry.round
  ) {
    throw new Error("The investor review records do not match.");
  }

  if (previous.lastProcessedRound === entry.round) {
    return {
      board: previous,
      review: previous.lastReview,
    };
  }

  if (previous.lastProcessedRound !== entry.round - 1) {
    throw new Error("The investor review skipped or repeated a period.");
  }

  const actualWorth = companyValue(entry.after);
  const referenceWorth = companyValue(referenceEntry.after);

  const difference = investorAddedValue(
    entry.after,
    referenceEntry.after
  );

  /*
   * A company's result keeps changing after an adviser is replaced,
   * because its existing investments and business still operate.
   *
   * Once the company itself closes, its ranking assessment freezes.
   * It cannot gain points merely because the comparison later declines.
   */
  const companySnapshot = previous.companySnapshot?.closed
    ? previous.companySnapshot
    : {
        score: difference,
        round: entry.round,
        actualWorth,
        referenceWorth,
        closed: Boolean(entry.after.suspended),
      };

  if (previous.frozen) {
    const review = {
      ...previous.lastReview,
      round: entry.round,
      date: entry.date,
      status: "observer",
      counted: false,
    };

    return {
      board: {
        ...previous,
        companySnapshot,
        lastProcessedRound: entry.round,
        lastReview: review,
      },
      review,
    };
  }

  const deferred =
    !entry.after.suspended &&
    eligibleProjectDeferral(entry.after, mission, previous);

  const counted = !mission.practice && !deferred && !entry.inactive;

  const targetTotal =
    mission.targetBefore +
    (
      mission.practice || deferred || publicShock
        ? 0
        : mission.baseTarget
    );

  /*
   * Crisis tolerance applies to THIS review only.
   * It does not permanently lower every later target.
   */
  const shockAllowance = publicShock && !mission.practice
    ? mission.crisisAllowance
    : 0;

  const requiredTarget = targetTotal - shockAllowance;
  const missed = counted && difference < requiredTarget;

  const warnings = previous.warnings + (missed ? 1 : 0);
  const dismissed = warnings >= INVESTOR_WARNING_LIMIT;

  const frozen = dismissed || entry.after.suspended;

  const review = {
    round: entry.round,
    date: entry.date,
    status: mission.practice
      ? "practice"
      : deferred
        ? "deferred"
        : missed ? "missed" : "met",
    counted,
    score: difference,
    periodContribution: difference - previous.score,
    targetTotal,
    requiredTarget,
    shockAllowance,
    actualWorth,
    referenceWorth,
    shortfall: Math.max(0, requiredTarget - difference),
  };

  return {
    board: {
      ...previous,
      targetTotal,
      reviews: previous.reviews + (counted ? 1 : 0),
      warnings,
      projectDeferralsUsed:
        previous.projectDeferralsUsed + (deferred ? 1 : 0),
      dismissed,
      dismissedRound: dismissed ? entry.round : null,
      frozen,
      stopReason: entry.after.suspended
        ? "company"
        : dismissed ? "adviser" : null,
      score: difference,
      scoreRound: entry.round,
      actualWorthAtAssessment: actualWorth,
      referenceWorthAtAssessment: referenceWorth,
      companySnapshot,
      lastProcessedRound: entry.round,
      lastReview: review,
    },
    review,
  };
}

export function investorProgress({
  state,
  reference,
  mission,
  board,
  phase,
  publicShock = false,
}) {
  if (
    !reference ||
    !mission ||
    board?.version !== INVESTOR_BOARD_VERSION
  ) {
    return null;
  }

  const settled = phase !== "decision";
  const useRecorded = settled || board.frozen;

  const score = useRecorded
    ? board.score
    : investorAddedValue(state, reference.state);

  const deferred = !useRecorded &&
    eligibleProjectDeferral(state, mission, board);

  const targetTotal = useRecorded
    ? board.targetTotal
    : mission.targetBefore +
      (
        mission.practice || deferred || publicShock
          ? 0
          : mission.baseTarget
      );

  const requiredTarget = useRecorded
    ? board.lastReview?.requiredTarget ?? targetTotal
    : targetTotal -
      (publicShock && !mission.practice ? mission.crisisAllowance : 0);

  return {
    score,
    targetTotal,
    requiredTarget,
    shortfall: Math.max(0, requiredTarget - score),
    practice: mission.practice,
    deferred: useRecorded
      ? board.lastReview?.status === "deferred"
      : deferred,
    warnings: board.warnings,
    dismissed: board.dismissed,
    frozen: board.frozen,
    scoreRound: board.scoreRound,
    final: settled,
    status: useRecorded ? board.lastReview?.status : "live",
  };
}

export function efficiencyEstimate(state, rules, brief, plan) {
  if (
    !plan?.operations ||
    !brief ||
    state.efficiency >= 3
  ) {
    return null;
  }

  const now = companyTerms(state, rules, brief);

  const improved = companyTerms(
    { ...state, efficiency: state.efficiency + 1 },
    rules,
    brief
  );

  const committedFactories = Math.max(
    state.committedFactories,
    state.factories + (plan.advice.factoryChange || 0)
  );

  const saving =
    plan.operations.production *
      (now.unitCost - improved.unitCost) +
    committedFactories *
      (now.factoryOverhead - improved.factoryOverhead);

  return {
    cost: now.efficiencyCost,
    saving: Math.max(0, Math.round(saving)),
    readyRound: brief.index + 2,
  };
}

export function describeInvestorResult(board) {
  if (board?.version !== INVESTOR_BOARD_VERSION) return null;

  const company = board.companySnapshot;

  return {
    version: INVESTOR_VERSION,
    companyGain: company?.score ?? board.score,
    companyAssessedRound: company?.round ?? board.scoreRound,
    investorGain: board.score,
    investorAssessedRound: board.scoreRound,
    laterManagementGain: board.dismissed && company
      ? company.score - board.score
      : 0,
    companyWorthAtAssessment: company?.actualWorth ?? null,
    referenceWorthAtAssessment: company?.referenceWorth ?? null,
  };
}

export function buildInvestmentRanking(players) {
  const rows = players.map((player) => {
    if (
      player.board?.version !== INVESTOR_BOARD_VERSION ||
      !player.rankingKey ||
      !player.board.companySnapshot
    ) {
      throw new Error("A final ranking record is incomplete.");
    }

    const performance = describeInvestorResult(player.board);

    requireSafeNumber(performance.companyGain, "Ranking gain");

    return {
      companyId: player.rankingKey,
      company: player.company,
      industry: INDUSTRIES[player.state.industry].name,
      gain: performance.companyGain,
      investorGain: performance.investorGain,
      laterManagementGain: performance.laterManagementGain,
      assessedThroughRound: performance.companyAssessedRound + 1,
      finalNetWorth: companyValue(player.state),
      closed: Boolean(player.state.suspended),
      companyStatus: player.state.suspended
        ? "Closed"
        : player.ending?.outcome || "Operating",
      adviserReplaced: Boolean(player.board.dismissed),
      adviserLastRound: player.board.scoreRound + 1,
    };
  }).sort((a, b) =>
    b.gain - a.gain ||
    a.company.localeCompare(b.company) ||
    a.companyId.localeCompare(b.companyId)
  );

  let previousGain = null;
  let rank = 0;

  rows.forEach((row, index) => {
    if (index === 0 || row.gain !== previousGain) rank = index + 1;
    row.rank = rank;
    previousGain = row.gain;
  });

  const surviving = rows.filter((row) => !row.closed);
  const bestSurvivingGain = surviving.length ? surviving[0].gain : null;

  return {
    version: INVESTOR_VERSION,
    basis: "Investment gain above ordinary management",
    rows: rows.map((row) => ({
      ...row,
      bestSurvivor:
        !row.closed &&
        bestSurvivingGain !== null &&
        row.gain === bestSurvivingGain,
    })),
  };
}