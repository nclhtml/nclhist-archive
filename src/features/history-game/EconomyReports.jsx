import React from "react";

import { formatYen } from "./advisor-model.mjs";
import {
  companyValue,
  PROJECT_LABELS,
} from "./resilience-model.mjs";

const signed = (value) =>
  `${value > 0 ? "+" : ""}${formatYen(value)}`;

function Rows({ rows }) {
  return (
    <dl className="hg-ledger">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function EconomicRound({
  entry,
  compact = false,
  onInspect,
}) {
  if (!entry) return null;

  const m = entry.metrics;
  const advice = entry.advisor?.advice;

  const ledger = (
    <Rows rows={[
      ["Sales booked as revenue", formatYen(m.revenue)],
      ["Customer cash received, including earlier invoices", formatYen(m.cashCollections)],
      ["New sales awaiting payment", formatYen(m.creditSales)],
      ["Earlier invoices written off", formatYen(m.receivableLoss)],
      ["Production cash spending", formatYen(m.productionCost)],
      ["Factory employment / contract costs", formatYen(m.overhead)],
      ["Storage", formatYen(m.storage)],
      ["Operating cash flow, before financing", signed(m.operatingCashFlow)],
      ["Interest", formatYen(m.interest)],
      ["Principal requested", formatYen(m.principalDue)],
      ["Maturing debt renewed", formatYen(m.refinancedDebt)],
      ["Share income", formatYen(m.stockIncome)],
      ["Property income", formatYen(m.propertyIncome)],
      ["Factory depreciation — not a cash payment", formatYen(m.factoryDepreciation)],
      ["Inventory write-down — not another purchase", formatYen(m.inventoryWriteDown)],
      ["Improvement project spending", formatYen(m.projectCost)],
      ["Voluntary-sale discount loss", formatYen(m.voluntaryLoss)],
      ["Emergency-sale discount loss", formatYen(m.forcedLoss)],
      ["Unpaid shortfall added to debt", formatYen(m.arrears)],
      ["This quarter's net profit / loss", signed(m.netProfit)],
      ["Opening share repricing — already applied", signed(m.stockChange)],
      ["Opening property repricing — already applied", signed(m.propertyChange)],
      ["Closing cash", formatYen(entry.after.cash)],
      ["Closing receivables", formatYen(entry.after.receivables)],
      ["Closing debt", formatYen(entry.after.debt)],
      ["Closing net worth", formatYen(companyValue(entry.after))],
    ]} />
  );

  return (
    <section className="hd-desk-panel">
      <span className="hg-eyebrow">
        Company accounts • one model quarter
      </span>

      <h2>
        Round {entry.round + 1} — {entry.date}
      </h2>

      {entry.defaulted && (
        <div className="hg-notice hg-warning">
          No student investment plan was submitted. Management followed
          the neutral operating plan without new investments, borrowing,
          expansion or improvement projects.
        </div>
      )}

      {entry.inactive && (
        <div className="hg-notice">
          This company was already suspended. Its balances remained frozen.
        </div>
      )}

      {!entry.inactive && (
        <>
          <div className="hd-report-grid">
            <div>
              <small>Operating cash flow</small>
              <strong className={m.operatingCashFlow < 0 ? "hg-negative" : ""}>
                {signed(m.operatingCashFlow)}
              </strong>
            </div>
            <div>
              <small>Quarterly profit / loss</small>
              <strong className={m.netProfit < 0 ? "hg-negative" : ""}>
                {signed(m.netProfit)}
              </strong>
            </div>
            <div>
              <small>Closing net worth</small>
              <strong>{formatYen(companyValue(entry.after))}</strong>
            </div>
          </div>

          <p className="hg-muted">
            Sales booked: {formatYen(m.revenue)}.
            Customer cash received: {formatYen(m.cashCollections)}.
            These differ because some customers pay later.
            One model quarter contains three model months; approximate
            monthly factory commitments were {formatYen(m.overhead / 3)}.
          </p>

          {m.forcedLoss > 0 && (
            <div className="hg-notice hg-warning">
              Emergency sales caused {formatYen(m.forcedLoss)} of discount losses.
              Selling assets to pay bills is not the same as earning operating profit.
            </div>
          )}

          {entry.after.suspended && (
            <div className="hg-notice hg-warning">
              <strong>Operations suspended.</strong>
              {" "}{entry.after.failureReason}
            </div>
          )}

          <p className="hg-muted">
            Management sold {m.soldDomestic} goods domestically and
            {" "}{m.soldExport} overseas. Unsold goods: {m.unsold}.
            Production quantities were management decisions, not manual
            instructions entered by the student.
          </p>
        </>
      )}

      {compact ? (
        <details>
          <summary>Full account explanation</summary>
          {ledger}
        </details>
      ) : ledger}

      {advice && (
        <details style={{ marginTop: 14 }}>
          <summary>Student instructions recorded for this quarter</summary>
          <Rows rows={[
            ["Share purchase allocation", `${advice.buyStocks}%`],
            ["Property purchase allocation", `${advice.buyProperty}%`],
            ["Share sale percentage", `${advice.sellStocks}%`],
            ["Property sale percentage", `${advice.sellProperty}%`],
            ["Borrowing / voluntary repayment", signed(entry.decision.debt)],
            ["Factory recommendation", String(advice.factoryChange)],
            ["Improvement project", PROJECT_LABELS[advice.project]],
            ["Recommended safety buffer released", `${advice.reserveRelease}%`],
            ["Marketing advice", advice.marketing],
          ]} />
        </details>
      )}

      {entry.liquidations.length > 0 && (
        <details>
          <summary>Emergency-sale record</summary>
          <ul>
            {entry.liquidations.map((sale, index) => (
              <li key={index}>
                {sale.asset}: recorded value {formatYen(sale.bookValue)};
                cash received {formatYen(sale.proceeds)}.
              </li>
            ))}
          </ul>
        </details>
      )}

      {onInspect && (
        <button
          type="button"
          style={{ marginTop: 18 }}
          onClick={onInspect}
        >
          Open balance sheet and company history
        </button>
      )}
    </section>
  );
}

export function EndingReport({ report }) {
  if (!report) return null;

  return (
    <section className="hd-ending">
      <span className="hg-eyebrow">
        Board of Directors • final investment assessment
      </span>

      <h2>{report.outcome}</h2>
      <p><strong>{report.industry}</strong></p>
      <p>{report.explanation}</p>

      <div className="hd-report-grid">
        <div>
          <small>Starting net worth</small>
          <strong>{formatYen(report.starting)}</strong>
        </div>
        <div>
          <small>Ending net worth</small>
          <strong>{formatYen(report.netWorth)}</strong>
        </div>
        <div>
          <small>Average operating cash flow — last 3 active quarters</small>
          <strong className={report.averageOperatingCash < 0 ? "hg-negative" : ""}>
            {signed(report.averageOperatingCash)}
          </strong>
        </div>
      </div>

      <Rows rows={[
        ["Cash still available", formatYen(report.cash)],
        ["Money still owed to the company", formatYen(report.receivables)],
        ["Outstanding debt", formatYen(report.debt)],
        ["Largest recorded fall from peak net worth", `${(report.drawdown * 100).toFixed(1)}%`],
        ["Total share/property valuation changes", signed(report.valuationChanges)],
        ["Factory and improvement spending", formatYen(report.productiveSpending)],
        ["Emergency-sale discount losses", formatYen(report.forcedLoss)],
        ["Completed efficiency levels", `${report.efficiency} / 3`],
        ["Completed product/market-development levels", `${report.development} / 3`],
      ]} />

      <div className="hg-notice">
        <strong>How to interpret the result:</strong> a large remaining
        asset balance does not establish that the business can fund itself.
        Equally, an investor who recognised danger and successfully reduced
        exposure is not penalised simply for having invested in shares.
      </div>

      <details>
        <summary>Continuation stress test</summary>

        {!report.stress.performed ? (
          <p>
            Not performed because the company had already suspended operations.
          </p>
        ) : (
          <>
            <p>
              <strong>
                {report.stress.survived
                  ? "Survived all six continuation quarters."
                  : `Operations failed during continuation quarter ${report.stress.periods}.`}
              </strong>
            </p>
            <p>
              Stress-test ending cash: {formatYen(report.stress.cash)}.
              Stress-test ending net worth: {formatYen(report.stress.netWorth)}.
              The actual game accounts were not changed.
            </p>
          </>
        )}

        <ul>
          {report.stress.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>

        <p className="hg-muted">
          This is a stated hypothetical scenario, not a prediction or proof
          that the company would survive the later Lost Decades.
        </p>
      </details>

      <details style={{ marginTop: 12 }}>
        <summary>Decisions for the board to discuss</summary>
        {report.review.map((topic) => (
          <div className="hg-comparison" key={topic.key}>
            <strong>{topic.title}</strong>
            <p>{topic.lesson}</p>
            {topic.evidence.map((item, index) => (
              <div key={index}>
                <p><strong>Round {item.round + 1}:</strong> {item.decision}</p>
                <p><strong>Known then:</strong> {item.known}</p>
                <p><strong>Recorded result:</strong> {item.outcome}</p>
              </div>
            ))}
          </div>
        ))}
      </details>

      <p className="hg-muted" style={{ marginTop: 18 }}>
        This is a model-based financial assessment, not a mark for historical
        understanding or a legal bankruptcy determination. The final
        reflection is assessed separately.
      </p>
    </section>
  );
}