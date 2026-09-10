import { eightNetWorth } from "./eight-model.mjs";

export const BOARD_VERSION = 1;
export const BOARD_WARNING_LIMIT = 5;

export function initialBoardRecord() {
  return {
    version: BOARD_VERSION,
    anchorWorth: null,
    targetTotal: 0,
    reviews: 0,
    warnings: 0,
    dismissed: false,
    dismissedRound: null,
    lastReview: null,
  };
}

function boardRecord(value) {
  return {
    ...initialBoardRecord(),
    ...(value || {}),
  };
}

/*
 * Starting target settings.
 *
 * Targets depend on industry and PUBLIC operating conditions.
 * They do not inspect actual hidden demand or future share prices.
 *
 * Borrowing does not raise the target merely by adding cash.
 */
function ordinaryTarget(state, packet) {
  if (packet.index === 0) return 0;

  const reference = state.initialNetWorth;
  const priceLevel = packet.rules.economy.priceLevel;

  const rates = {
    electronics: 0.075,
    machinery: 0.06,
    essentials: 0.04,
    materials: 0.05,
  };

  const rate = rates[state.industry];

  if (
    !Number.isFinite(reference) ||
    reference <= 0 ||
    !Number.isFinite(rate)
  ) {
    throw new Error("The company cannot be assigned a board target.");
  }

  let factor;

  if (priceLevel >= 1.02) {
    factor = 1 + (priceLevel - 1) * 3;
  } else if (priceLevel >= 0.97) {
    factor = 0.35;
  } else if (priceLevel >= 0.92) {
    factor = 0.2;
  } else {
    factor = state.industry === "essentials" ? 0.3 : 0.05;
  }

  if (state.industry === "materials" && priceLevel < 0.92) {
    return -Math.round(reference * 0.01);
  }

  return Math.round(reference * rate * factor);
}

export function createBoardMission(opening, packet, previousBoard) {
  const board = boardRecord(previousBoard);
  const state = opening.after;
  const practice = packet.index === 0;

  return {
    version: BOARD_VERSION,
    round: packet.index,
    date: packet.brief.date,
    practice,
    active: !state.suspended && !board.dismissed,

    previousCloseWorth: eightNetWorth(opening.before),

    anchorWorth: board.anchorWorth == null
      ? eightNetWorth(opening.before)
      : board.anchorWorth,

    priorTargetTotal: board.targetTotal,
    baseTarget: ordinaryTarget(state, packet),

    /*
     * The same contingency rule exists in every period.
     * It becomes active only after a public market disruption.
     * Publishing this rule does not reveal a future crash time.
     */
    crisisTarget: -Math.round(state.initialNetWorth * 0.1),
  };
}

export function effectiveRoundTarget(mission, publicShock) {
  return publicShock
    ? Math.min(mission.baseTarget, mission.crisisTarget)
    : mission.baseTarget;
}

/*
 * Called inside the existing settlement transaction.
 *
 * Company-value changes include:
 * - business earnings and costs;
 * - investment valuation changes;
 * - trading fees and losses;
 * - borrowing and repayments, which cancel between cash and debt.
 *
 * New improvement-project spending receives a target allowance.
 * It does not get added back to cash, assets or accounting profit.
 */
export function settleBoardReview(
  entry,
  mission,
  previousBoard,
  publicShock = false
) {
  const previous = boardRecord(previousBoard);

  if (
    !mission ||
    mission.version !== BOARD_VERSION ||
    mission.round !== entry.round
  ) {
    throw new Error("The board mission is missing or out of date.");
  }

  if (previous.lastReview?.round === entry.round) {
    return {
      board: previous,
      review: previous.lastReview,
    };
  }

  if (
    previous.lastReview &&
    previous.lastReview.round > entry.round
  ) {
    throw new Error("The board record is ahead of this round.");
  }

  const closingWorth = eightNetWorth(entry.after);
  const roundGain = closingWorth - mission.previousCloseWorth;

  if (mission.practice) {
    const review = {
      round: entry.round,
      date: entry.date,
      status: "practice",
      counted: false,
      roundGain,
      gainSoFar: 0,
      roundTarget: 0,
      totalTarget: 0,
      projectAllowance: 0,
      shortfall: 0,
      publicShock: false,
    };

    return {
      board: {
        ...previous,
        anchorWorth: closingWorth,
        targetTotal: 0,
        lastReview: review,
      },
      review,
    };
  }

  if (previous.dismissed || entry.inactive) {
    return {
      board: previous,
      review: {
        round: entry.round,
        date: entry.date,
        status: "observer",
        counted: false,
        roundGain,
        gainSoFar: closingWorth - mission.anchorWorth,
        roundTarget: 0,
        totalTarget: previous.targetTotal,
        projectAllowance: 0,
        shortfall: 0,
        publicShock: Boolean(publicShock),
      },
    };
  }

  const commissionedProject =
    entry.advisor?.advice?.project &&
    entry.advisor.advice.project !== "none";

  const projectAllowance = commissionedProject
    ? Math.max(0, entry.metrics.projectCost || 0)
    : 0;

  const roundTarget =
    effectiveRoundTarget(mission, publicShock) -
    projectAllowance;

  const totalTarget = mission.priorTargetTotal + roundTarget;
  const gainSoFar = closingWorth - mission.anchorWorth;
  const missed = gainSoFar < totalTarget;

  const warnings = previous.warnings + (missed ? 1 : 0);
  const dismissed =
    previous.dismissed ||
    warnings >= BOARD_WARNING_LIMIT;

  const review = {
    round: entry.round,
    date: entry.date,
    status: missed ? "missed" : "met",
    counted: true,
    roundGain,
    gainSoFar,
    roundTarget,
    totalTarget,
    projectAllowance,
    shortfall: Math.max(0, totalTarget - gainSoFar),
    publicShock: Boolean(publicShock),
  };

return {
    board: {
      ...previous,
      targetTotal: totalTarget,
      reviews: previous.reviews + 1,
      warnings,
      dismissed,
      dismissedRound: dismissed
        ? previous.dismissedRound ?? entry.round
        : null,
      lastReview: review,
    },
    review,
  };
}

export function boardProgress({
  state,
  mission,
  board: inputBoard,
  phase,
  publicShock = false,
}) {
  if (!mission) return null;

  const board = boardRecord(inputBoard);

  if (
    phase !== "decision" &&
    board.lastReview?.round === mission.round
  ) {
    return {
      ...board.lastReview,
      practice: mission.practice,
      warnings: board.warnings,
      dismissed: board.dismissed,
      final: true,
    };
  }

  const roundTarget = mission.practice
    ? 0
    : effectiveRoundTarget(mission, publicShock);

  const totalTarget = mission.priorTargetTotal + roundTarget;
  const gainSoFar = eightNetWorth(state) - mission.anchorWorth;

  return {
    round: mission.round,
    practice: mission.practice,
    status: mission.practice
      ? "practice"
      : gainSoFar >= totalTarget ? "met" : "below",
    roundTarget,
    totalTarget,
    gainSoFar,
    shortfall: Math.max(0, totalTarget - gainSoFar),
    projectAllowance: 0,
    warnings: board.warnings,
    dismissed: board.dismissed,
    publicShock: Boolean(publicShock),
    final: false,
  };
}