import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  compileAdvisorPlan,
  defaultAdvice,
  formatYen,
  formatYenExact,
  MARKETING_LABELS,
} from "./advisor-model.mjs";

import {
  companyValue as companyWorth,
  companyTerms,
  defaultInvestmentPlan,
  prepareInvestment,
  industryFor,
  PROJECT_LABELS,
} from "./resilience-model.mjs";

import {
  EconomicRound,
  EndingReport,
} from "./EconomyReports";

import "./investment-desk.css";

let nextControlId = 0;

const count = (value) => new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
}).format(Number(value) || 0);

const percentage = (value) => `${(Number(value) * 100).toFixed(1)}%`;

const signedMoney = (value) =>
  `${value > 0 ? "+" : ""}${formatYen(value)}`;

function Amount({ value }) {
  return <span title={formatYenExact(value)}>{formatYen(value)}</span>;
}

function Message({ children, warning = false }) {
  return (
    <div
      className={`hg-notice ${warning ? "hg-warning" : ""}`}
      role="status"
    >
      {children}
    </div>
  );
}

function Entries({ rows }) {
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

function Modal({
  open,
  title,
  onClose,
  children,
  delivery = false,
}) {
  const reference = useRef(null);
  const heading = useRef(null);
  const [id] = useState(() => `hd-modal-${++nextControlId}`);

  useEffect(() => {
    const dialog = reference.current;
    if (!dialog) return undefined;

    if (open && !dialog.open) {
      dialog.showModal();
      heading.current?.focus();
    }

    if (!open && dialog.open) {
      dialog.close();
    }

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <dialog
      ref={reference}
      className={`hd-modal ${delivery ? "hd-delivery" : ""}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="hd-modal-card">
        <div className="hd-modal-header">
          <h2 id={id} ref={heading} tabIndex={-1}>
            {title}
          </h2>

          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="hd-modal-body">
          {open ? children : null}
        </div>
      </div>
    </dialog>
  );
}

function PercentControl({
  label,
  value,
  max = 100,
  disabled = false,
  onChange,
  children,
}) {
  const [id] = useState(() => `hd-percent-${++nextControlId}`);
  const [text, setText] = useState(String(value));

  const maximum = Math.max(0, Math.min(100, Math.floor(max)));

  useEffect(() => {
    setText(String(value));
  }, [value, maximum]);

  function commit(raw) {
    const parsed = Number(raw);
    const next = Number.isFinite(parsed)
      ? Math.max(0, Math.min(maximum, Math.floor(parsed)))
      : value;

    setText(String(next));
    onChange(next);
  }

  return (
    <div className="hd-percent">
      <div className="hd-control-heading">
        <strong id={id}>{label}</strong>
        <span>Available: 0–{maximum}%</span>
      </div>

      <div className="hd-slider-row">
        <input
          type="range"
          min={0}
          max={maximum}
          step={1}
          value={Math.min(value, maximum)}
          disabled={disabled || maximum === 0}
          aria-labelledby={id}
          aria-describedby={`${id}-help`}
          aria-valuetext={`${value}%`}
          onChange={(event) => commit(event.target.value)}
        />

        <div className="hd-number-box">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={maximum}
            step={1}
            required
            value={text}
            disabled={disabled || maximum === 0}
            aria-label={`${label}: exact percentage`}
            aria-describedby={`${id}-help`}
            aria-invalid={value > maximum}
            onChange={(event) => {
              const raw = event.target.value;
              setText(raw);

              if (raw !== "" && Number.isSafeInteger(Number(raw))) {
                commit(raw);
              }
            }}
            onBlur={() => commit(text === "" ? 0 : text)}
          />
          <span aria-hidden="true">%</span>
        </div>
      </div>

      <small id={`${id}-help`}>{children}</small>
    </div>
  );
}

function MarketChart({
  rows,
  field,
  title,
  colour,
  holding,
  openingReturn,
  ceiling,
}) {
  const [selectedIndex, setSelectedIndex] = useState(rows.length - 1);

  useEffect(() => {
    setSelectedIndex(rows.length - 1);
  }, [rows.length]);

  const width = 540;
  const height = 230;
  const left = 42;
  const right = 16;
  const top = 16;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const selected = rows[
    Math.max(0, Math.min(selectedIndex, rows.length - 1))
  ];

  const latest = rows[rows.length - 1];

  const xAt = (index) =>
    left + index / Math.max(1, rows.length - 1) * plotWidth;

  const yAt = (value) =>
    top + plotHeight - value / ceiling * plotHeight;

  const points = rows
    .map((row, index) => `${xAt(index)},${yAt(row[field])}`)
    .join(" ");

  function inspectPointer(event) {
    const box = event.currentTarget.getBoundingClientRect();

    const logicalX =
      (event.clientX - box.left) / box.width * width;

    const index = Math.round(
      (logicalX - left) / plotWidth * (rows.length - 1)
    );

    setSelectedIndex(Math.max(0, Math.min(rows.length - 1, index)));
  }

  return (
    <article className="hd-market-card">
      <div className="hd-market-top">
        <div>
          <h3>{title}</h3>
          <span className="hg-muted">Simulation market index</span>
          <strong className="hd-index">{latest[field].toFixed(2)}</strong>
        </div>

        <span className={openingReturn < 0 ? "hd-fall" : "hd-rise"}>
          {openingReturn > 0 ? "+" : ""}
          {percentage(openingReturn)}
          <small className="hg-cell-subtitle">This opening</small>
        </span>
      </div>

      <svg
        className="hd-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${title}. Current index ${latest[field].toFixed(2)}. Inspect a period using the selector below.`}
        onPointerDown={inspectPointer}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse") inspectPointer(event);
        }}
      >
        <title>{title}: fictional market history</title>
        <desc>
          The index begins at 100. Only opened rounds are shown.
          An accessible data table is available below the charts.
        </desc>

        {[0, ceiling / 2, ceiling].map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke="#e4e8dd"
            />
            <text x={left - 7} y={yAt(tick) + 4} textAnchor="end">
              {Math.round(tick)}
            </text>
          </g>
        ))}

        <line
          x1={left}
          x2={width - right}
          y1={yAt(100)}
          y2={yAt(100)}
          stroke="#bdbba8"
          strokeDasharray="5 5"
        />

        <polyline
          points={points}
          fill="none"
          stroke={colour}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        <circle
          cx={xAt(Math.min(selectedIndex, rows.length - 1))}
          cy={yAt(selected[field])}
          r="6"
          fill={colour}
          stroke="#fff"
          strokeWidth="2"
        />

        <text x={left} y={height - 8}>Start</text>
        <text x={width - right} y={height - 8} textAnchor="end">
          Latest opened round
        </text>
      </svg>

      <div className="hd-chart-picker">
        <label>
          Inspect a period
          <select
            value={Math.min(selectedIndex, rows.length - 1)}
            onChange={(event) => setSelectedIndex(Number(event.target.value))}
          >
            {rows.map((row, index) => (
              <option key={row.round} value={index}>
                {row.date}
              </option>
            ))}
          </select>
        </label>
        <strong>{selected[field].toFixed(2)}</strong>
      </div>

      <div className="hd-holding">
        <span>Your company's holding</span>
        <strong><Amount value={holding} /></strong>
      </div>
    </article>
  );
}

function secureSource(source) {
  try {
    const url = new URL(source.url);

    return url.protocol === "https:"
      ? { ...source, url: url.href }
      : null;
  } catch {
    return null;
  }
}

function DeskNewspaper({ article }) {
  if (!article) return null;

  const events = article.events || [];
  const lead = events[0];

  const sources = (article.sources || [])
    .map(secureSource)
    .filter(Boolean);

  function eventLabel(event) {
    return event.kind === "milestone"
      ? "Historical milestone"
      : event.kind === "trend"
        ? "Historical context"
        : "Fictional business scenario";
  }

  return (
    <article className="hg-newspaper">
      <div className="hg-paper-topline">
        <span>Delivered to the investment desk</span>
        <span>Classroom edition</span>
      </div>

      <div className="hg-masthead">Tokyo Business Chronicle</div>

      <div className="hg-paper-dateline">
        <span>{article.date}</span>
        <span>Markets • Industry • Trade</span>
      </div>

      <h2 style={{ marginTop: 24 }}>
        {lead?.headline || article.headline}
      </h2>

      {lead && (
        <p className="hd-news-label">
          {eventLabel(lead)} · {lead.date}
        </p>
      )}

      <p className="hg-paper-story">
        {lead?.body || article.body}
      </p>

      {events.slice(1).map((event) => (
        <section className="hd-news-item" key={event.id}>
          <span className="hd-news-label">
            {eventLabel(event)} · {event.date}
          </span>
          <h3>{event.headline}</h3>
          <p>{event.body}</p>
        </section>
      ))}

      {article.forecast && (
        <div className="hg-market-strip">
          <div>
            <small>Domestic demand forecast</small>
            <strong>{article.forecast.domestic.join("–")} goods</strong>
          </div>
          <div>
            <small>Export demand forecast</small>
            <strong>{article.forecast.export.join("–")} goods</strong>
          </div>
          <div>
            <small>Company loan rate / round</small>
            <strong>{percentage(article.rate)}</strong>
          </div>
        </div>
      )}

      <Message>
        Opening price changes have already affected existing investments.
        New instructions use the updated values—not the previous round's prices.
      </Message>

      <details className="hg-source-notes">
        <summary>About this classroom newspaper</summary>
        <p>
          The newspaper and company accounts are fictional teaching materials.
          Historical events provide context; market indexes, company returns,
          demand quantities and per-round loan charges are model parameters.
        </p>

        {sources.length > 0 && (
          <ul>
            {sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  );
}

function AdvisorForm({ room, player, game }) {
  const enhanced = room.advisorMode === 2;

  const [draft, setDraft] = useState(() => ({
    ...(
      player.advice ||
      (enhanced ? defaultInvestmentPlan() : defaultAdvice())
    ),
  }));

  const [tab, setTab] = useState("buy");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (player.advice) {
      setDraft({ ...player.advice });
      setDirty(false);
    }
  }, [player.submittedAt]);

  const preview = useMemo(
    () => enhanced
      ? prepareInvestment(
        player.state,
        draft,
        room.rules,
        room.brief
      )
      : compileAdvisorPlan(
        player.state,
        draft,
        room.rules,
        room.brief
      ),
    [enhanced, player.state, draft, room.rules, room.brief]
  );

  const state = player.state;

  const rules = enhanced
    ? {
      ...room.rules,
      ...companyTerms(state, room.rules, room.brief),
    }
    : room.rules;

  const blocked = Boolean(game.busy) || room.paused;

  const purchaseLimit = preview.purchasePercentLimit ?? 100;
  const propertySaleLimit = Math.floor(rules.propertySaleFraction * 100);

  function change(key, value) {
    setDirty(true);
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  function changeLoanMode(value) {
    setDirty(true);
    setDraft((previous) => ({
      ...previous,
      loanMode: value,
      loanPercent: 0,
    }));
  }

  async function submit(event) {
    event.preventDefault();

    if (blocked || !preview.valid) return;

    const result = await game.act("submit", {
      code: room.code,
      round: room.round,
      advice: draft,
    }, "Investment instructions saved on the server.");

    if (result.ok) setDirty(false);
  }

  const cashPercent = 100 - draft.buyStocks - draft.buyProperty;

  return (
    <section className="hd-desk-panel">
      <div className="hd-heading-row">
        <div>
          <span className="hg-eyebrow">Investment instructions</span>
          <h2>Your investment desk</h2>
        </div>

        {player.ready && (
          <span className={`hd-stamp ${dirty ? "hd-unsaved" : ""}`}>
            {dirty ? "Unsaved changes" : "Instructions filed"}
          </span>
        )}
      </div>

      <p className="hg-muted">
        This is a draft plan. Company balances change when the teacher
        settles the round. You may replace submitted instructions while
        the round remains open.
      </p>

      {room.paused && (
        <Message warning>The teacher has paused submissions.</Message>
      )}

      <form onSubmit={submit}>
        <fieldset disabled={blocked}>
          <div className="hd-budget-box">
            <div>
              <small>Available for new investments</small>
              <strong>
                <Amount value={preview.budget || 0} />
              </strong>
            </div>
            <div>
              <small>After the proposed financing and operating reserve</small>
              <span>Expected sales are not spendable cash.</span>
            </div>
          </div>

          {enhanced && (
            <details className="hd-advice-details" open>
              <summary>Where is the company's cash?</summary>

              <Entries rows={[
                ["Cash currently in the company bank account", <Amount value={state.cash} />],
                ["Production and known commitments reserved", <Amount value={preview.committedReserve || 0} />],
                ["Recommended additional safety buffer", <Amount value={preview.recommendedBuffer || 0} />],
                ["Safety buffer kept in this plan", <Amount value={preview.bufferKept || 0} />],
                ["Available for new investments after the whole plan", <Amount value={preview.budget || 0} />],
              ]} />

              <p className="hg-muted">
                Proposed sales, financing, factory changes and projects also
                change the available budget. Reserves are not additional
                fees: unspent money remains company cash. Outstanding
                customer invoices are not cash already available to invest.
              </p>

              <PercentControl
                label="Release part of the recommended safety buffer"
                value={draft.reserveRelease}
                onChange={(value) => change("reserveRelease", value)}
              >
                0% keeps the recommended buffer where funds permit.
                100% releases the additional buffer for investment.
                Production and known commitments remain protected.
              </PercentControl>

              {draft.reserveRelease > 0 && (
                <Message warning>
                  You are choosing less protection against weak receipts,
                  delayed payments and future financing pressure.
                  Extra investment capacity is not extra company wealth.
                </Message>
              )}
            </details>
          )}

          <div
            className="hd-tabs"
            aria-label="Investment action"
            style={{ marginTop: 20 }}
          >
            <button
              type="button"
              aria-pressed={tab === "buy"}
              onClick={() => setTab("buy")}
            >
              Buy
            </button>
            <button
              type="button"
              aria-pressed={tab === "sell"}
              onClick={() => setTab("sell")}
            >
              Sell
            </button>
          </div>

          {tab === "buy" ? (
            <>
              <div className="hd-two-columns">
                <PercentControl
                  label="Buy Japanese shares"
                  value={draft.buyStocks}
                  max={Math.min(
                    100 - draft.buyProperty,
                    purchaseLimit
                  )}
                  disabled={draft.sellStocks > 0}
                  onChange={(value) => change("buyStocks", value)}
                >
                  {draft.sellStocks > 0
                    ? "Clear the planned share sale in the Sell tab before buying shares."
                    : <>Purchase: <Amount value={preview.stockPurchase || 0} /></>}
                </PercentControl>

                <PercentControl
                  label="Buy property investments"
                  value={draft.buyProperty}
                  max={Math.min(
                    100 - draft.buyStocks,
                    purchaseLimit
                  )}
                  disabled={draft.sellProperty > 0}
                  onChange={(value) => change("buyProperty", value)}
                >
                  {draft.sellProperty > 0
                    ? "Clear the planned property sale in the Sell tab before buying property."
                    : <>Purchase: <Amount value={preview.propertyPurchase || 0} /></>}
                </PercentControl>
              </div>

              <div
                className="hd-allocation-bar"
                role="img"
                aria-label={`Shares ${draft.buyStocks}%, property ${draft.buyProperty}%, retained cash ${cashPercent}%. Total 100%.`}
              >
                <span
                  style={{
                    width: `${draft.buyStocks}%`,
                    background: "#31543a",
                  }}
                />
                <span
                  style={{
                    width: `${draft.buyProperty}%`,
                    background: "#b08a38",
                  }}
                />
                <span
                  style={{
                    width: `${cashPercent}%`,
                    background: "#c9cebf",
                  }}
                />
              </div>

              <div className="hd-allocation-labels">
                <span>Shares {draft.buyStocks}%</span>
                <span>Property {draft.buyProperty}%</span>
                <strong>Keep as cash {cashPercent}%</strong>
                <strong>Total 100%</strong>
              </div>

              <p className="hg-muted">
                Unallocated investment money stays as cash:
                {" "}<Amount value={preview.cashAllocation || 0} />.
                Increasing one investment never silently reduces the other.
              </p>

              <details>
                <summary>Allocation limits and rounding</summary>
                <p className="hg-muted">
                  Percentages allocate this round's investment budget, not
                  your entire existing portfolio. The purchase ceiling is
                  {" "}<Amount value={rules.maxInvestmentPurchase} /> per market
                  per round. Amounts are rounded down to ¥10,000 blocks;
                  any rounding remainder stays as cash.
                </p>
              </details>
            </>
          ) : (
            <>
              <div className="hd-two-columns">
                <PercentControl
                  label="Sell shares already owned"
                  value={draft.sellStocks}
                  max={state.stocks > 0 ? 100 : 0}
                  disabled={draft.buyStocks > 0}
                  onChange={(value) => change("sellStocks", value)}
                >
                  {draft.buyStocks > 0
                    ? "Clear the planned share purchase in the Buy tab before selling."
                    : <>
                      Holding: <Amount value={state.stocks} />.
                      {" "}Sale proceeds:
                      {" "}<Amount value={preview.stockSaleValue || 0} />.
                    </>}
                </PercentControl>

                <PercentControl
                  label="Sell property already owned"
                  value={draft.sellProperty}
                  max={state.property > 0 ? propertySaleLimit : 0}
                  disabled={draft.buyProperty > 0}
                  onChange={(value) => change("sellProperty", value)}
                >
                  {draft.buyProperty > 0
                    ? "Clear the planned property purchase in the Buy tab before selling."
                    : <>
                      Holding: <Amount value={state.property} />.
                      {" "}Cash received:
                      {" "}<Amount value={preview.propertySaleCash || 0} />.
                    </>}
                </PercentControl>
              </div>

              <Message>
                Sale percentages refer to each separate holding, so they
                do not need to total 100%. Property is a portfolio, not
                a single indivisible building.
              </Message>

              <p className="hg-muted">
                Property: at most {propertySaleLimit}% of the holding can
                be sold this round. Buyers currently pay
                {" "}{Math.round(rules.propertyBid * 100)}% of the sold
                property's recorded value. Selling collateral may increase
                required loan repayment.
              </p>
            </>
          )}

          <div className="hd-two-columns">
            <details className="hd-advice-details">
              <summary>Bank desk — loans and repayments</summary>

              <div className="hd-bank-line">
                <span>Current debt: <Amount value={state.debt} /></span>
                <span>Rate: {percentage(room.brief.rate)} / round</span>
              </div>

              <label className="hg-field">
                <span>Loan instruction</span>
                <select
                  value={draft.loanMode}
                  onChange={(event) => changeLoanMode(event.target.value)}
                >
                  <option value="hold">Leave borrowing unchanged</option>
                  <option value="borrow">Borrow additional funds</option>
                  <option value="repay" disabled={state.debt === 0}>
                    Repay existing debt
                  </option>
                </select>
              </label>

              {draft.loanMode === "borrow" && (
                <PercentControl
                  label="Use available additional credit"
                  value={draft.loanPercent}
                  max={(preview.borrowLimit || 0) > 0 ? 100 : 0}
                  onChange={(value) => change("loanPercent", value)}
                >
                  Additional credit available:
                  {" "}<Amount value={preview.borrowLimit || 0} />.
                  {" "}Proposed borrowing:
                  {" "}<Amount value={Math.max(0, preview.loanChange || 0)} />.
                </PercentControl>
              )}

              {draft.loanMode === "repay" && (
                <PercentControl
                  label="Repay a percentage of outstanding debt"
                  value={draft.loanPercent}
                  max={preview.maxRepayPercent ?? 100}
                  onChange={(value) => change("loanPercent", value)}
                >
                  Proposed voluntary repayment:
                  {" "}<Amount value={Math.max(0, -(preview.loanChange || 0))} />.
                  Required principal may also be collected at settlement.
                </PercentControl>
              )}

              <p className="hg-muted" style={{ marginTop: 12 }}>
                Available credit reflects proposed sales and factory advice.
                New share or property purchases do not instantly unlock
                another loan within this planner.
              </p>

              {enhanced && (
                <>
                  <Entries rows={[
                    ["Existing debt reaching maturity this round", <Amount value={preview.maturingDebt || 0} />],
                    ["Permitted renewal of maturing debt", percentage(rules.renewalFraction)],
                    ["New loan term", `${rules.loanTermRounds} round openings`],
                  ]} />

                  <p className="hg-muted">
                    Requested principal is the largest of the maturity
                    payment, scheduled repayment or collateral shortfall,
                    capped at total debt—not the sum of all three.
                    Collateral conditions can reduce the amount renewed.
                  </p>

                  {state.loans.length > 0 && (
                    <ul>
                      {state.loans.map((loan, index) => (
                        <li key={`${loan.originRound}-${index}`}>
                          <Amount value={loan.balance} />
                          {" "}reaches its next maturity review in round
                          {" "}{loan.dueRound + 1}.
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </details>

            <details className="hd-advice-details">
              <summary>Advice to the board and management</summary>

              <label className="hg-field">
                <span>Factory recommendation</span>
                <select
                  value={draft.factoryChange}
                  onChange={(event) =>
                    change("factoryChange", Number(event.target.value))
                  }
                >
                  <option value={0}>Maintain current factories</option>
                  <option
                    value={1}
                    disabled={state.factories >= rules.maxFactories}
                  >
                    Add one factory — {formatYen(rules.factoryPrice)}
                  </option>
                  <option value={-1} disabled={state.factories <= 1}>
                    Sell one factory — receive {formatYen(rules.factoryResale)}
                  </option>
                </select>
                <small>
                  Each factory adds {rules.factoryCapacity} goods of capacity
                  and costs {formatYen(rules.factoryOverhead)} to run per round.
                  Capacity does not create customers.
                </small>
              </label>

              {enhanced && (
                <>
                  <label className="hg-field">
                    <span>Investment in the business</span>
                    <select
                      value={draft.project}
                      onChange={(event) =>
                        change("project", event.target.value)
                      }
                    >
                      <option value="none">
                        No additional improvement project
                      </option>

                      <option
                        value="efficiency"
                        disabled={Boolean(state.project) || state.efficiency >= 3}
                      >
                        Efficiency — {formatYen(rules.efficiencyCost)}
                      </option>

                      <option
                        value="development"
                        disabled={Boolean(state.project) || state.development >= 3}
                      >
                        Products / customer markets — {formatYen(rules.developmentCost)}
                      </option>
                    </select>
                  </label>

                  <p className="hg-muted">
                    Efficiency reduces model unit costs and some running
                    costs. Product development improves model selling
                    opportunities and prices. Benefits begin two round
                    openings after commissioning. Maximum: three levels each.
                    Project spending is expensed in this classroom model;
                    it does not create an immediately sellable asset.
                  </p>

                  <p className="hg-muted">
                    Completed efficiency: {state.efficiency}/3.
                    {" "}Completed development: {state.development}/3.
                  </p>

                  {state.project && (
                    <Message>
                      In progress: {PROJECT_LABELS[state.project.kind]}.
                      {" "}Scheduled completion: round
                      {" "}{state.project.readyRound + 1}.
                    </Message>
                  )}

                  <Message>
                    New factories begin production next round.
                    Their funding and commissioning commitments begin now.
                    Downsizing does not immediately cancel every existing
                    employment or contract obligation.
                  </Message>
                </>
              )}

              <label className="hg-field">
                <span>Marketing advice</span>
                <select
                  value={draft.marketing}
                  onChange={(event) => change("marketing", event.target.value)}
                >
                  {Object.entries(MARKETING_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              <p className="hg-muted">
                Affordable, permitted recommendations become part of this
                round's instructions. Management—not you—calculates the
                exact production quantity and goods allocation.
              </p>
            </details>
          </div>

          {preview.operations && (
            <div className="hd-management-memo">
              <strong>Management's operating memo</strong>

              <p>
                We plan to produce {count(preview.operations.production)}
                {" "}new goods and allocate {preview.operations.exports}%
                of available goods to exports, using existing inventory
                and the information currently available.
              </p>

              {enhanced ? (
                <>
                  <p>
                    Company demand estimate: domestic
                    {" "}{rules.forecast.domestic.join("–")} goods;
                    exports {rules.forecast.export.join("–")} goods.
                    Actual orders can fall below or exceed these estimates.
                  </p>

                  <Entries rows={[
                    ["Expected operating cash flow — not guaranteed", signedMoney(preview.expectedOperatingCash)],
                    ["Factory commitments per model quarter", <Amount value={preview.overhead} />],
                    ["Approximate factory commitments per model month", <Amount value={preview.overhead / 3} />],
                    ["New sales expected to be paid later", percentage(rules.paymentDelay)],
                  ]} />

                  <p>
                    One turn settles one model quarter of three months.
                    Historical dates are contextual labels, not a literal
                    reconstruction of every elapsed month.
                  </p>
                </>
              ) : (
                <p>
                  Set aside for production and conservative commitments:
                  {" "}<strong><Amount value={preview.operatingReserve} /></strong>.
                  Unused reserves remain company cash.
                </p>
              )}
            </div>
          )}

          {preview.problems.length > 0 && (
            <Message warning>
              <ul style={{ marginBottom: 0 }}>
                {preview.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Message>
          )}

          <div className="hd-submit-area">
            <h3>Before you file the instructions</h3>

            {preview.decision && (
              <Entries rows={[
                ["Debt after your loan instruction", <Amount value={preview.plannedDebt} />],
                ["Interest this round", <Amount value={preview.interest} />],
                ["Required principal at settlement", <Amount value={preview.principal} />],
                ["Cash after trades and production", <Amount value={preview.cashAfterOrders} />],
                ["Cash if there are no sales or investment income", <Amount value={preview.noSalesCash} />],
              ]} />
            )}

            {preview.noSalesCash < 0 && (
              <Message warning>
                Existing commitments exceed the no-sales cash budget.
                Receipts or emergency asset sales may be needed. You may
                submit a no-new-investment plan, but existing obligations
                do not disappear.
              </Message>
            )}

            <button
              type="submit"
              className="hg-primary"
              disabled={blocked || !preview.valid}
            >
              {game.busy === "submit"
                ? "Filing instructions…"
                : player.ready
                  ? "Replace submitted instructions"
                  : "Submit investment instructions"}
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function SettlementSummary({ player, onInspect }) {
  const entry = player.history?.[player.history.length - 1];

  if (entry?.economyVersion === 2) {
    return (
      <EconomicRound
        entry={entry}
        compact
        onInspect={onInspect}
      />
    );
  }

  if (!entry) {
    return (
      <Message>
        Operations are suspended. You can continue reading the newspaper,
        watching the markets and inspecting the company record.
      </Message>
    );
  }

  const metrics = entry.metrics;

  const receipts =
    metrics.revenue +
    metrics.stockIncome +
    metrics.propertyIncome;

  const operatingSpending =
    metrics.productionCost +
    metrics.overhead +
    metrics.interest +
    metrics.storage;

  return (
    <section className="hd-desk-panel">
      <span className="hg-eyebrow">Report to the investment adviser</span>
      <h2>The board has closed the books</h2>

      <div className="hd-report-grid">
        <div>
          <small>Sales and investment income</small>
          <strong><Amount value={receipts} /></strong>
        </div>
        <div>
          <small>Operating spending and interest</small>
          <strong><Amount value={operatingSpending} /></strong>
        </div>
        <div>
          <small>Principal requested</small>
          <strong><Amount value={metrics.principalDue} /></strong>
        </div>
      </div>

      {entry.defaulted && (
        <Message warning>
          No investment instructions were submitted. Management followed
          the neutral operating plan as cash allowed, without new investments,
          borrowing or factory recommendations.
        </Message>
      )}

      {entry.inactive && (
        <Message>
          The company was already suspended. This model kept its balances frozen.
        </Message>
      )}

      {(metrics.forcedLoss > 0 || metrics.arrears > 0) && (
        <Message warning>
          Emergency-sale discount loss:
          {" "}<Amount value={metrics.forcedLoss} />.
          {" "}Unpaid shortfall added to debt:
          {" "}<Amount value={metrics.arrears} />.
          Open the company record for the full explanation.
        </Message>
      )}

      <p className="hg-muted">
        Management sold {count(metrics.soldDomestic)} goods domestically and
        {" "}{count(metrics.soldExport)} overseas.
        {" "}{count(metrics.unsold)} goods remained in inventory.
        These operating figures were calculated by management.
      </p>

      <button type="button" onClick={onInspect}>
        Inspect balance sheet and full company record
      </button>
    </section>
  );
}

export default function InvestmentDesk({
  room,
  player,
  game,
  Archive,
  ReflectionPanel,
}) {
  const [newsOpen, setNewsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);
  const prompted = useRef(new Set());

  const [peekId] = useState(() => `hd-peek-${++nextControlId}`);

  const state = player.state;
  const rules = room.rules;
  const netWorth = companyWorth(state, rules);
  const latest = player.history?.[player.history.length - 1];

  const comparisonState = room.phase === "decision"
    ? player.opening?.before
    : latest?.opening?.before;

  const change = comparisonState
    ? netWorth - companyWorth(comparisonState, rules)
    : null;

  const paperKey =
    `hg-adviser-paper:${room.code}:${player.uid}:${room.round}`;

  useEffect(() => {
    if (room.phase !== "decision") return;

    let alreadyDelivered = prompted.current.has(paperKey);

    try {
      alreadyDelivered =
        alreadyDelivered ||
        window.sessionStorage.getItem(paperKey) === "delivered";
    } catch {
      // The in-memory set still prevents repeats while this view is mounted.
    }

    if (alreadyDelivered) return;

    prompted.current.add(paperKey);

    try {
      window.sessionStorage.setItem(paperKey, "delivered");
    } catch {
      // Storage can be unavailable in some browser privacy settings.
    }

    setPeekOpen(false);
    setSheetOpen(false);
    setNewsOpen(true);
  }, [paperKey, room.phase]);

  const rows = useMemo(() => [
    {
      round: -1,
      date: "Before the first opening",
      stocks: 100,
      property: 100,
    },
    ...(room.marketHistory || []),
  ], [room.marketHistory]);

  const ceiling = Math.ceil(
    Math.max(
      120,
      ...rows.flatMap((row) => [row.stocks, row.property])
    ) * 1.1 / 20
  ) * 20;

  const assetRows = [
    ["Cash", state.cash],
    ...(state.economyVersion === 2
      ? [["Customer invoices awaiting payment", state.receivables]]
      : []),
    ["Shares", state.stocks],
    ["Property investments", state.property],
    [
      "Factories — recorded value",
      state.factoryBook ?? state.factories * rules.factoryPrice,
    ],
    [
      "Inventory — recorded value",
      state.inventoryBook ?? state.inventory * rules.unitCost,
    ],
  ];

  function openSheet() {
    setPeekOpen(false);
    setSheetOpen(true);
  }

  return (
    <div className="hd-root">
      <header className="hd-header">
        <div>
          <span className="hg-eyebrow">
            Corporate investment office • Japan
          </span>
          <h1>{player.company}</h1>
          <p>{player.studentName} · Investment adviser</p>
          {state.economyVersion === 2 && (
            <p style={{ marginTop: 6, fontSize: 13 }}>
              {industryFor(state.industry).name} · Resilience R2
            </p>
          )}

          <span className="hd-period">
            {room.phase === "lobby"
              ? "Appointment confirmed · awaiting first briefing"
              : `${room.brief.date} · Round ${room.round + 1} of ${room.totalRounds}`}
          </span>
        </div>

        <div
          className="hd-worth-wrap"
          onMouseEnter={() => {
            if (window.matchMedia("(hover: hover)").matches) {
              setPeekOpen(true);
            }
          }}
          onMouseLeave={() => setPeekOpen(false)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setPeekOpen(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setPeekOpen(false);
          }}
        >
          <button
            type="button"
            className="hd-worth-button"
            aria-haspopup="dialog"
            aria-describedby={peekOpen ? peekId : undefined}
            onFocus={() => setPeekOpen(true)}
            onClick={openSheet}
          >
            <small>Company net worth</small>
            <strong><Amount value={netWorth} /></strong>
            <span>Tap or click for the balance sheet</span>
          </button>

          <div className="hd-cash-line">
            <span>Cash in bank</span>
            <strong><Amount value={state.cash} /></strong>
          </div>

          {change !== null && (
            <div className="hd-change">
              {signedMoney(change)} since the previous close
            </div>
          )}

          {peekOpen && (
            <div className="hd-peek" id={peekId} role="tooltip">
              <strong>Balance-sheet preview</strong>
              <Entries rows={[
                ...assetRows.map(([label, value]) => [
                  label,
                  formatYen(value),
                ]),
                ["Loans owed", formatYen(state.debt)],
                ["Net worth", formatYen(netWorth)],
              ]} />
              <small>Click for exact amounts and company history.</small>
            </div>
          )}
        </div>
      </header>

      {state.suspended && (
        <Message warning>
          <strong>Operations are suspended.</strong> Continue as an observer,
          inspect your investment record and complete the final reflection.
          Balances are frozen under this classroom model; this is not a
          legal determination of bankruptcy.
        </Message>
      )}

      {room.phase === "lobby" ? (
        <section className="hd-letter">
          <span className="hg-eyebrow">Private company correspondence</span>
          <h2>Your appointment as investment adviser</h2>
          <p>Dear {player.studentName},</p>
          <p>
            The board entrusts you with the company's investment funds.
            Study the markets, manage financial investments, and advise
            us on expansion and marketing priorities.
          </p>
          <p>
            Our managers will organise routine production. Your task is
            to seek opportunities without forgetting the company's cash
            needs and obligations.
          </p>
          <p>
            You begin with <Amount value={state.cash} /> in cash and
            {" "}{state.factories} factories. Including those factories,
            company net worth is <Amount value={netWorth} />.
          </p>
          <div className="hd-letter-signature">
            Board of Directors<br />
            {player.company}
          </div>
          <Message>
            Keep this page open. Your teacher will deliver the first briefing.
          </Message>
        </section>
      ) : (
        <>
          <section className="hd-paper-access">
            <div>
              <strong>Tokyo Business Chronicle</strong>
              <small>
                {room.brief.date} · This round's investment briefing
              </small>
            </div>
            <button
              type="button"
              onClick={() => {
                setPeekOpen(false);
                setNewsOpen(true);
              }}
            >
              Read newspaper
            </button>
          </section>

          <section aria-label="Current investment markets">
            <div className="hd-markets">
              <MarketChart
                rows={rows}
                field="stocks"
                title="Japanese shares"
                colour="#31543a"
                holding={state.stocks}
                openingReturn={room.brief.openingMove.stockReturn}
                ceiling={ceiling}
              />

              <MarketChart
                rows={rows}
                field="property"
                title="Property investments"
                colour="#a48132"
                holding={state.property}
                openingReturn={room.brief.openingMove.propertyReturn}
                ceiling={ceiling}
              />
            </div>

            <details style={{ marginTop: 12 }}>
              <summary>Market data and what these charts represent</summary>
              <p className="hg-muted">
                These are fictional market indexes beginning at 100, not
                actual Nikkei or land-price data. One point represents one
                opened game round; rounds cover unequal lengths of historical
                time. Class orders do not themselves set these indexes.
              </p>

              <div className="hg-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Shares index</th>
                      <th>Property index</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.round}>
                        <td>{row.date}</td>
                        <td>{row.stocks.toFixed(2)}</td>
                        <td>{row.property.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>

          {room.phase === "decision" && !state.suspended ? (
            <AdvisorForm
              key={`${room.code}:${room.round}:${player.uid}`}
              room={room}
              player={player}
              game={game}
            />
          ) : (
            <SettlementSummary player={player} onInspect={openSheet} />
          )}

          {room.phase === "results" && (
            <Message>
              Instructions for this round are closed. Wait for the next
              newspaper delivery from your teacher.
            </Message>
          )}

          {room.phase === "finished" && (
            <>
              <EndingReport report={player.ending} />
              <ReflectionPanel
                room={room}
                player={player}
                game={game}
              />
            </>
          )}
        </>
      )}

      <p className="hg-muted">
        Fictional company accounts expressed in yen.
        K = thousand, M = million, B = billion.
        Net worth includes assets that may not be readily convertible to cash.
      </p>

      <Modal
        open={newsOpen}
        title="Newspaper delivered to your desk"
        onClose={() => setNewsOpen(false)}
        delivery
      >
        <DeskNewspaper
          article={
            room.brief && state.economyVersion === 2
              ? {
                ...room.brief,
                forecast: companyTerms(
                  state,
                  room.rules,
                  room.brief
                ).forecast,
              }
              : room.brief
          }
        />
        <button
          type="button"
          className="hg-primary hg-full"
          style={{ marginTop: 20 }}
          onClick={() => setNewsOpen(false)}
        >
          Go to investment desk
        </button>
      </Modal>

      <Modal
        open={sheetOpen}
        title={`${player.company} — balance sheet`}
        onClose={() => setSheetOpen(false)}
      >
        <div className="hd-two-columns">
          <section>
            <h3>Assets</h3>
            <Entries rows={assetRows.map(([label, value]) => [
              label,
              formatYenExact(value),
            ])} />
          </section>

          <section>
            <h3>Liabilities</h3>
            <Entries rows={[
              ["Outstanding loans", formatYenExact(state.debt)],
            ]} />
            <p className="hg-muted">
              Interest is a per-round charge. Loan principal remains
              repayable even when investment values fall.
            </p>
          </section>
        </div>

        <div className="hd-sheet-total">
          <strong>Assets minus liabilities</strong>
          <strong>{formatYenExact(netWorth)}</strong>
        </div>

        <p className="hg-muted">
          Factories: {state.factories}. Inventory: {count(state.inventory)} goods.
          Factory and inventory figures use this model's recorded values,
          not guaranteed emergency-sale proceeds.
          Company positions:
          {" "}{state.suspended ? 0 : state.factories * rules.workersPerFactory}.
          These are company positions, not a national unemployment statistic.
        </p>

        <Archive room={room} player={player} />
      </Modal>
    </div>
  );
}