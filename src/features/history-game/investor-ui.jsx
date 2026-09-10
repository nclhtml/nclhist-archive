import React from "react";

import { formatYen } from "./advisor-model.mjs";

import {
  INVESTOR_WARNING_LIMIT,
  MAX_PROJECT_DEFERRALS,
  investorProgress,
  describeInvestorResult,
} from "./investor-model.mjs";

import { Cash, Rows } from "./desk-widgets";

import "./investor-ui.css";

const signed = (value) =>
  `${value > 0 ? "+" : ""}${formatYen(value)}`;

function Gain({ value }) {
  return (
    <strong className={value < 0 ? "ip-loss" : "ip-gain"}>
      {signed(value)}
    </strong>
  );
}

export function InvestorTarget({ room, player, state }) {
  const progress = investorProgress({
    state,
    reference: player.reference,
    mission: player.mission,
    board: player.board,
    phase: room.phase,
    publicShock: Boolean(room.dealing?.breaking),
  });

  if (!progress) return null;

  if (state.suspended) {
    return (
      <section className="ir-board ir-board-warning" data-guide="goal">
        <strong>The company has stopped operating.</strong>
        <span>Your investment record remains available.</span>
      </section>
    );
  }

  if (progress.dismissed) {
    return (
      <section className="ir-board ir-board-warning" data-guide="goal">
        <strong>The board has appointed another adviser.</strong>
        <span>
          Three reviews were missed. Your adviser result is recorded.
          The company continues under management.
        </span>
      </section>
    );
  }

  if (progress.practice) {
    return (
      <section className="ir-board ir-practice" data-guide="goal">
        <strong>Practice round — no warning</strong>
        <span>
          Your money and investment results carry forward.
          Ordinary business earnings are not investor points.
        </span>
      </section>
    );
  }

  const onTarget = progress.score >= progress.requiredTarget;

  return (
    <section
      className={`ir-board ${onTarget ? "ir-board-good" : ""}`}
      data-guide="goal"
    >
      <div className="ir-board-main">
        <div>
          <small>Your decisions added</small>
          <Gain value={progress.score} />
          <span>Above a company that runs as normal.</span>
        </div>

        <div>
          <small>Board goal so far</small>
          <strong>{signed(progress.requiredTarget)}</strong>
          <span>Earlier results carry forward.</span>
        </div>

        <div className="ir-goal-status">
          <strong>
            {progress.deferred
              ? "Project in progress — review deferred"
              : onTarget
                ? progress.final ? "Goal met" : "On target so far"
                : `Need ${formatYen(progress.shortfall)} more`}
          </strong>

          <span>
            Warnings: {progress.warnings} / {INVESTOR_WARNING_LIMIT}
          </span>

          <div
            className="ir-warning-dots"
            role="img"
            aria-label={`${progress.warnings} of ${INVESTOR_WARNING_LIMIT} warnings`}
          >
            {Array.from({ length: INVESTOR_WARNING_LIMIT }, (_, index) => (
              <i
                key={index}
                className={index < progress.warnings ? "ir-used" : ""}
              />
            ))}
          </div>
        </div>
      </div>

      <details>
        <summary>What counts?</summary>
        <p>
          Shares, property, business improvements, fees and loan costs count.
          Normal management earnings are removed using a matching company
          with the same industry and demand conditions.
        </p>
        <p>
          Borrowed money is not a gain. Unsold investments count at their
          current value. Final operating results are added when the period ends.
        </p>
        <p>
          Up to {MAX_PROJECT_DEFERRALS} reviews can be deferred while a
          business-improvement project is unfinished. Its cost still counts
          in your investment result.
        </p>
      </details>
    </section>
  );
}

export function InvestorSummary({ board, companyClosed = false }) {
  const result = describeInvestorResult(board);
  if (!result) return null;

  return (
    <section className="ir-board-summary">
      <strong>
        {board.dismissed
          ? "The board appointed another adviser"
          : companyClosed
            ? "Investment record before company closure"
            : "The board retained you as adviser"}
      </strong>

      <p>
        Goals met: {Math.max(0, board.reviews - board.warnings)}
        {" "}of {board.reviews} scored reviews.
        {" "}Warnings: {board.warnings} / {INVESTOR_WARNING_LIMIT}.
      </p>

      <Rows rows={[
        ["Company investment gain", <Gain value={result.companyGain} />],
        ["Gain while you were adviser", <Gain value={result.investorGain} />],
        ...(board.dismissed ? [
          ["Later result under management", <Gain value={result.laterManagementGain} />],
        ] : []),
      ]} />

      <small>
        Compared with ordinary management under the same industry conditions.
        Project spending is included; it is not added back as free profit.
      </small>
    </section>
  );
}

export function InvestmentLeaderboard({ ranking, ownKey = "" }) {
  if (!ranking?.rows?.length) return null;

  return (
    <section className="ip-leaderboard">
      <span className="hg-eyebrow">After Round 8</span>
      <h2>Final investment ranking</h2>
      <p>
        Ranked by investment gain above ordinary management—not by borrowed
        money or the company's normal earnings.
      </p>

      <div className="hg-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Company</th>
              <th>Industry</th>
              <th>Investment gain</th>
              <th>Final position</th>
            </tr>
          </thead>

          <tbody>
            {ranking.rows.map((row) => (
              <tr
                key={row.companyId}
                className={row.companyId === ownKey ? "ip-own-company" : ""}
              >
                <td className="ip-rank">{row.rank}</td>

                <td>
                  <strong>{row.company}</strong>
                  {row.companyId === ownKey && (
                    <small className="hg-cell-subtitle">Your company</small>
                  )}
                  {row.bestSurvivor && (
                    <small className="ip-award">Highest-ranked surviving company</small>
                  )}
                </td>

                <td>{row.industry}</td>

                <td>
                  <Gain value={row.gain} />
                  {row.adviserReplaced && (
                    <small className="hg-cell-subtitle">
                      After adviser replacement:
                      {" "}{signed(row.laterManagementGain)}
                    </small>
                  )}
                </td>

                <td>
                  {row.companyStatus}
                  <small className="hg-cell-subtitle">
                    Net worth: <Cash value={row.finalNetWorth} />
                  </small>

                  {row.adviserReplaced && (
                    <small className="hg-cell-subtitle">
                      Adviser replaced after round {row.adviserLastRound}
                    </small>
                  )}

                  {row.closed && (
                    <small className="hg-cell-subtitle">
                      Investment assessment stopped in round {row.assessedThroughRound}
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <small className="ip-ranking-note">
        Equal gains receive equal ranks. Company closure and adviser replacement
        are shown separately. No student reflections or private account records
        are included in this table.
      </small>
    </section>
  );
}