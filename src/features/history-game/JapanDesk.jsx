import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  formatYen,
  formatYenExact,
} from "./advisor-model.mjs";

import {
  companyValue,
  companyTerms,
  defaultInvestmentPlan,
  prepareInvestment,
  industryFor,
  PROJECT_LABELS,
} from "./resilience-model.mjs";

import {
  LISTED_SHARES,
  listedValue,
  markListed,
  tradingSummary,
} from "./dealing-model.mjs";

import {
  LiveDealing,
  MarketClockLabel,
  useDealingClock,
} from "./dealing-ui";

import {
  Cash,
  DeskModal,
  LineChart,
  PortfolioRing,
  Rows,
  Slider,
} from "./desk-widgets";

import "./japan-desk.css";

const signed = (value) =>
  `${value > 0 ? "+" : ""}${formatYen(value)}`;

const percentage = (value) => `${(value * 100).toFixed(1)}%`;

const NEWS_TEXT = {
  mandate: "The board has released funds for investment. Banks, manufacturers and property developers are looking for new opportunities.",
  plaza: "The major industrial powers agree on coordinated currency action. A strengthening yen puts Japanese exporters under pressure.",
  easing: "The Bank of Japan lowers its discount rate in stages. Cheaper credit supports business activity and demand for assets.",
  "low-rate": "The official discount rate reaches 2.5%. Borrowing remains attractive as confidence in investment markets strengthens.",
  electronics: "The United States imposes 100% duties on selected Japanese products in the semiconductor dispute, including certain colour televisions. The measures do not cover all exports.",
  optimism: "Rising stock and land values encourage further borrowing. Higher collateral valuations support another wave of investment.",
  capacity: "Manufacturers add production capacity, but customer orders are not rising equally quickly. Some businesses face accumulating inventories.",
  "tightening-1989": "The Bank of Japan raises the official discount rate in May, October and December. Borrowers face more expensive credit.",
  "late-boom": "Share prices continue rising towards the end of 1989 despite dearer credit. Property-market optimism remains strong.",
  "tightening-1990": "The official discount rate rises to 5.25% in March and 6% in August. Companies review their financing needs.",
  "stock-collapse": "Share prices fall sharply after the end-1989 peak. Investors reassess valuations while outstanding debts remain payable.",
  "land-downturn": "Property weakness spreads after the equity downturn. Buyers become more cautious and collateral valuations come under pressure.",
  "financial-strain": "Weak demand and damaged balance sheets prolong the adjustment. Businesses face slower payments, excess capacity and difficult financing decisions.",
  "uneven-adjustment": "Policy support offers some relief, but financial and business restructuring continues. Recovery is uneven.",
  "car-threat": "The United States threatens 100% tariffs on 13 Japanese luxury-car models. Exporters face uncertainty while negotiations continue.",
  "car-settlement": "An agreement on 28 June prevents the threatened luxury-car tariffs from taking effect. The wider balance-sheet adjustment continues.",
  "retailer-orders": "Retailers request additional goods as domestic orders improve.",
  "asset-confidence": "Investor confidence strengthens, lifting demand for shares and property.",
  "export-contract": "Overseas distributors express interest in additional Japanese supplies.",
  "soft-retail": "Some retailers reduce orders after weaker sales.",
  "export-setback": "Overseas distributors become more cautious about new orders.",
  "valuation-doubts": "Analysts question share valuations after a rapid rise.",
  "local-contract": "A limited domestic contract provides some relief for suppliers.",
  "niche-export": "A small overseas market offers additional opportunities.",
  "buyer-delay": "Customers postpone purchases, making cash-flow planning harder.",
  "market-anxiety": "Market anxiety adds to selling pressure in shares.",
  "property-buyers": "Property buyers demand lower valuations before committing funds.",
};

function Newspaper({ article }) {
  if (!article) return null;

  const events = article.events || [];
  const lead = events[0];

  return (
    <article className="hg-newspaper">
      <div className="hg-paper-topline">
        <span>Tokyo</span>
        <span>Markets • Industry • Trade</span>
      </div>

      <div className="hg-masthead">Tokyo Business Chronicle</div>

      <div className="hg-paper-dateline">
        <span>{article.date}</span>
        <span>Business edition</span>
      </div>

      <h2 style={{ marginTop: 24 }}>
        {lead?.headline || article.headline}
      </h2>

      <p className="hg-paper-story">
        {NEWS_TEXT[lead?.id] || lead?.body || article.body}
      </p>

      {events.slice(1).map((event) => (
        <section className="jd-news-story" key={event.id}>
          <h3>{event.headline}</h3>
          <p>{NEWS_TEXT[event.id] || event.body}</p>
        </section>
      ))}
    </article>
  );
}

function CompanyReport({ room, player, baseline, terms }) {
  const state = player.state;
  const history = player.history || [];
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];

  const changes = [];

  if (latest && !latest.inactive) {
    const factoryChange =
      latest.after.factories - latest.opening.before.factories;

    if (factoryChange !== 0) {
      changes.push(
        `${factoryChange > 0 ? "+" : ""}${factoryChange} factories.`
      );
    }

    if (latest.metrics.creditSales > 0) {
      changes.push(
        `${formatYen(latest.metrics.creditSales)} of new sales are awaiting payment.`
      );
    }

    if (latest.metrics.forcedLoss > 0) {
      changes.push(
        `Emergency-sale losses: ${formatYen(latest.metrics.forcedLoss)}.`
      );
    }

    if (previous && !previous.inactive) {
      const costChange =
        latest.metrics.overhead - previous.metrics.overhead;

      if (costChange !== 0) {
        changes.push(
          `Factory commitments changed by ${signed(costChange)}.`
        );
      }
    }
  }

  for (const project of player.opening?.completedProjects || []) {
    changes.push(`Completed: ${project}.`);
  }

  const previousCashChange = latest
    ? latest.after.cash - latest.opening.before.cash
    : 0;

  return (
    <section className="jd-company-report">
      <span className="hg-eyebrow">{player.company} • Company report</span>
      <h2>{room.brief?.date || "Opening position"}</h2>

      <div className="jd-report-grid">
        <div>
          <small>{latest ? "Last period's business profit / loss" : "Starting net worth"}</small>
          <strong>
            {latest
              ? signed(latest.metrics.netProfit)
              : formatYen(companyValue(state))}
          </strong>
        </div>

        <div>
          <small>{latest ? "Change in cash last period" : "Cash in bank"}</small>
          <strong>
            {latest ? signed(previousCashChange) : formatYen(state.cash)}
          </strong>
        </div>

        <div>
          <small>Investment funding before new instructions</small>
          <strong><Cash value={baseline?.budget || 0} /></strong>
        </div>

        <div>
          <small>Loan payments due this period</small>
          <strong>
            <Cash value={(baseline?.interest || 0) + (baseline?.principal || 0)} />
          </strong>
        </div>
      </div>

      {latest?.metrics.dealingProfit != null && (
        <div className="jd-report-line">
          <span>Last session's dealing result</span>
          <strong>{signed(latest.metrics.dealingProfit)}</strong>
        </div>
      )}

      {latest && (
        <Rows rows={[
          ["Customer cash received last period", <Cash value={latest.metrics.cashCollections} />],
          ["Current unpaid customer invoices", <Cash value={state.receivables} />],
          ["Current inventory", `${state.inventory} goods`],
        ]} />
      )}

      {changes.length > 0 && (
        <>
          <h3>What changed?</h3>
          <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul>
        </>
      )}

      {terms && (
        <section className="jd-management-outlook">
          <h3>Management outlook</h3>

          <Rows rows={[
            ["Domestic orders expected", `${terms.forecast.domestic.join("–")} goods`],
            ["Export orders expected", `${terms.forecast.export.join("–")} goods`],
            ["Expected operating cash flow", signed(baseline?.expectedOperatingCash || 0)],
            ["Factory commitments this quarter", <Cash value={baseline?.overhead || 0} />],
          ]} />
        </section>
      )}

      {state.suspended && (
        <div className="hg-notice hg-warning">
          <strong>Operations suspended.</strong> {state.failureReason}
        </div>
      )}
    </section>
  );
}

function FinalReport({ report, state }) {
  if (!report) return null;
  const dealing = report.dealing || tradingSummary(state);

  return (
    <section className="jd-panel jd-ending">
      <span className="hg-eyebrow">Board of Directors • Final report</span>
      <h2>{report.outcome}</h2>
      <p>{report.explanation}</p>

      <div className="jd-report-grid">
        <div>
          <small>Starting net worth</small>
          <strong><Cash value={report.starting} /></strong>
        </div>
        <div>
          <small>Ending net worth</small>
          <strong><Cash value={report.netWorth} /></strong>
        </div>
        <div>
          <small>Cash remaining</small>
          <strong><Cash value={report.cash} /></strong>
        </div>
        <div>
          <small>Debt remaining</small>
          <strong><Cash value={report.debt} /></strong>
        </div>
      </div>

      <Rows rows={[
        ["Recent average operating cash flow", signed(report.averageOperatingCash)],
        ["Largest recorded decline from peak", percentage(report.drawdown)],
        ["Realised individual-share result", signed(dealing.realized)],
        ["Unrealised individual-share result", signed(dealing.unrealized)],
        ["Trading fees", <Cash value={dealing.fees} />],
        ["Emergency-sale losses", <Cash value={report.forcedLoss} />],
        ["Completed business improvements", `${report.efficiency} efficiency / ${report.development} development`],
      ]} />

      <details>
        <summary>Could the company continue?</summary>
        <p>
          {report.stress.performed
            ? report.stress.survived
              ? "The company survived all six continuation periods."
              : `The company failed during continuation period ${report.stress.periods}.`
            : "The company had already suspended operations."}
        </p>

        <ul>
          {report.stress.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export default function JapanDesk({
  room,
  player,
  game,
  Archive,
  ReflectionPanel,
}) {
  const [documentOpen, setDocumentOpen] = useState(false);
  const [documentTab, setDocumentTab] = useState("news");
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [investmentTab, setInvestmentTab] = useState("buy");
  const [portfolioMode, setPortfolioMode] = useState("current");
  const [dirty, setDirty] = useState(false);

  const [draft, setDraft] = useState(
    () => ({ ...(player.advice || defaultInvestmentPlan()) })
  );

  const prompted = useRef(new Set());

  const state = useMemo(
    () => markListed(player.state, room.dealing?.prices),
    [player.state, room.dealing?.prices]
  );

  const visiblePlayer = { ...player, state };

  const clock = useDealingClock(
    room.dealing,
    game.marketFeed.offset
  );

  const timed = room.dealingVersion === 1;
  const inRound = room.phase === "decision";

  const canSubmit =
    inRound &&
    !room.paused &&
    !state.suspended &&
    (
      !timed ||
      ["live", "grace"].includes(clock.stage)
    );

  const terms = useMemo(
    () => room.brief
      ? companyTerms(state, room.rules, room.brief)
      : null,
    [state, room.rules, room.brief]
  );

  const baseline = useMemo(
    () => room.brief && !state.suspended
      ? prepareInvestment(
          state,
          defaultInvestmentPlan(),
          room.rules,
          room.brief
        )
      : null,
    [state, room.rules, room.brief]
  );

  const preview = useMemo(
    () => room.brief && !state.suspended
      ? prepareInvestment(state, draft, room.rules, room.brief)
      : null,
    [state, draft, room.rules, room.brief]
  );

  useEffect(() => {
    setDraft({ ...(player.advice || defaultInvestmentPlan()) });
    setDirty(false);
  }, [room.round]);

  useEffect(() => {
    if (player.ready && player.advice) {
      setDraft({ ...player.advice });
      setDirty(false);
    }
  }, [player.submittedAt]);

  useEffect(() => {
    if (player.planNeedsReview) setDirty(true);
  }, [player.balanceRevision, player.planNeedsReview]);

  useEffect(() => {
    if (room.phase !== "decision") return;

    const key = `hg-r3-documents:${room.code}:${player.uid}:${room.round}`;
    let delivered = prompted.current.has(key);

    try {
      delivered = delivered || sessionStorage.getItem(key) === "yes";
    } catch {
      // In-memory tracking remains available.
    }

    if (delivered) return;

    prompted.current.add(key);

    try {
      sessionStorage.setItem(key, "yes");
    } catch {
      // The documents remain accessible through their buttons.
    }

    setBalanceOpen(false);
    setDocumentTab("news");
    setDocumentOpen(true);
  }, [room.code, room.round, room.phase, player.uid]);

  function change(key, value) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setPortfolioMode("plan");
  }

  async function submit(event) {
    event.preventDefault();

    if (!canSubmit || !preview?.valid || game.busy) return;

    const result = await game.act("submit", {
      code: room.code,
      round: room.round,
      advice: draft,
      balanceRevision: player.balanceRevision || 0,
    }, "Investment plan submitted.");

    if (result.ok) setDirty(false);
  }

  const portfolioState =
    portfolioMode === "plan" && preview?.proposed
      ? preview.proposed
      : state;

  const portfolioItems = [
    {
      id: "cash",
      label: "Cash",
      value: portfolioState.cash,
      colour: "#b9c3ae",
    },
    {
      id: "basket",
      label: "Share basket",
      value: portfolioState.stocks,
      colour: "#274e39",
    },
    {
      id: "property",
      label: "Property",
      value: portfolioState.property,
      colour: "#b08a38",
    },
    ...LISTED_SHARES.map((share) => ({
      id: share.id,
      label: share.name,
      value:
        (portfolioState.listed?.[share.id]?.lots || 0) *
        (portfolioState.listedPrices?.[share.id] || share.start),
      colour: share.colour,
    })),
  ];

  const cashPercent = 100 - draft.buyStocks - draft.buyProperty;
  const purchaseLimit = preview?.purchasePercentLimit ?? 100;

  const balanceRows = [
    ["Cash", state.cash],
    ["Share basket", state.stocks],
    ["Individual shares", listedValue(state)],
    ["Property", state.property],
    ["Factories", state.factoryBook],
    ["Inventory", state.inventoryBook],
    ["Customer invoices", state.receivables],
    ["Loans owed", -state.debt],
  ];

  const latest = player.history?.[player.history.length - 1];

  return (
    <div className="jd-root">
      <header className="jd-header">
        <div>
          <span className="hg-eyebrow">Corporate investment office • Japan</span>
          <h1>{player.company}</h1>
          <p>{industryFor(state.industry).name}</p>
          <small>
            {room.phase === "lobby"
              ? "Awaiting the first briefing"
              : `${room.brief.date} · Round ${room.round + 1} / ${room.totalRounds}`}
          </small>
        </div>

        <button
          type="button"
          className="jd-worth"
          onClick={() => setBalanceOpen(true)}
          aria-haspopup="dialog"
        >
          <small>Company net worth</small>
          <strong><Cash value={companyValue(state)} /></strong>
          <span>Cash: {formatYen(state.cash)} · View balance sheet</span>
        </button>
      </header>

      {room.phase === "lobby" ? (
        <section className="jd-panel jd-letter">
          <span className="hg-eyebrow">Appointment confirmed</span>
          <h2>Welcome, {player.studentName}</h2>
          <p>
            Manage the company's investments and advise the board.
            Management will handle routine operations.
          </p>
          <Rows rows={[
            ["Starting cash", <Cash value={state.cash} />],
            ["Factories", state.factories],
            ["Company net worth", <Cash value={companyValue(state)} />],
          ]} />
          <p>Your teacher will deliver the first briefing.</p>
        </section>
      ) : (
        <>
          <nav className="jd-document-buttons" aria-label="Company documents">
            <button
              type="button"
              onClick={() => { setDocumentTab("news"); setDocumentOpen(true); }}
            >
              Newspaper
            </button>
            <button
              type="button"
              onClick={() => { setDocumentTab("company"); setDocumentOpen(true); }}
            >
              Company report
            </button>
            <button type="button" onClick={() => setBalanceOpen(true)}>
              Balance sheet
            </button>
          </nav>

          {state.suspended && (
            <div className="hg-notice hg-warning">
              <strong>Operations suspended.</strong> {state.failureReason}
              {" "}You can continue watching the market.
            </div>
          )}

          {timed && (
            <LiveDealing
              key={`${room.code}:${room.round}:${player.uid}`}
              room={room}
              player={player}
              game={game}
            />
          )}

          <section className="jd-panel">
            <div className="jd-section-heading">
              <div>
                <span className="hg-eyebrow">Company portfolio</span>
                <h2>Cash & investments</h2>
              </div>

              {inRound && !state.suspended && (
                <div className="jd-tabs">
                  <button
                    type="button"
                    aria-pressed={portfolioMode === "current"}
                    onClick={() => setPortfolioMode("current")}
                  >
                    Current
                  </button>
                  <button
                    type="button"
                    aria-pressed={portfolioMode === "plan"}
                    onClick={() => setPortfolioMode("plan")}
                  >
                    After plan
                  </button>
                </div>
              )}
            </div>

            <PortfolioRing items={portfolioItems} />

            {portfolioMode === "plan" && inRound && (
              <small className="jd-inline-note">
                Preview of investment instructions, before operating receipts and bills.
              </small>
            )}

            {inRound && !state.suspended && (
              <form onSubmit={submit}>
                <div className="jd-plan-heading">
                  <h3>Investment plan</h3>
                  <strong>
                    {player.ready
                      ? dirty ? "Submitted · unsaved edits" : "Submitted"
                      : player.planNeedsReview
                        ? "Trade completed · resubmit plan"
                        : "Not submitted"}
                  </strong>
                </div>

                {timed && <MarketClockLabel clock={clock} />}

                <div className="jd-plan-budget">
                  <span>Available after this plan's commitments</span>
                  <strong><Cash value={preview?.budget || 0} /></strong>
                </div>

                <fieldset disabled={Boolean(game.busy) || room.paused}>
                  <div className="jd-tabs">
                    <button
                      type="button"
                      aria-pressed={investmentTab === "buy"}
                      onClick={() => setInvestmentTab("buy")}
                    >Buy</button>
                    <button
                      type="button"
                      aria-pressed={investmentTab === "sell"}
                      onClick={() => setInvestmentTab("sell")}
                    >Sell</button>
                  </div>

                  <div className="jd-two">
                    {investmentTab === "buy" ? (
                      <>
                        <Slider
                          label="Share basket"
                          value={draft.buyStocks}
                          max={Math.min(100 - draft.buyProperty, purchaseLimit)}
                          disabled={draft.sellStocks > 0}
                          onChange={(value) => change("buyStocks", value)}
                        >
                          <Cash value={preview?.stockPurchase || 0} />
                          {draft.sellStocks > 0 && " · Clear the basket sale first."}
                        </Slider>

                        <Slider
                          label="Property"
                          value={draft.buyProperty}
                          max={Math.min(100 - draft.buyStocks, purchaseLimit)}
                          disabled={draft.sellProperty > 0}
                          onChange={(value) => change("buyProperty", value)}
                        >
                          <Cash value={preview?.propertyPurchase || 0} />
                          {draft.sellProperty > 0 && " · Clear the property sale first."}
                        </Slider>
                      </>
                    ) : (
                      <>
                        <Slider
                          label="Sell share basket"
                          value={draft.sellStocks}
                          max={state.stocks > 0 ? 100 : 0}
                          disabled={draft.buyStocks > 0}
                          onChange={(value) => change("sellStocks", value)}
                        >
                          Receive <Cash value={preview?.stockSaleValue || 0} />
                        </Slider>

                        <Slider
                          label="Sell property"
                          value={draft.sellProperty}
                          max={state.property > 0
                            ? Math.floor(room.rules.propertySaleFraction * 100)
                            : 0}
                          disabled={draft.buyProperty > 0}
                          onChange={(value) => change("sellProperty", value)}
                        >
                          Receive <Cash value={preview?.propertySaleCash || 0} />.
                          {" "}Buyers pay {Math.round(room.rules.propertyBid * 100)}% of value sold.
                        </Slider>
                      </>
                    )}
                  </div>

                  {investmentTab === "buy" && (
                    <div className="jd-allocation-summary">
                      <span>Basket {draft.buyStocks}%</span>
                      <span>Property {draft.buyProperty}%</span>
                      <strong>Keep cash {cashPercent}%</strong>
                      <strong>Total 100%</strong>
                    </div>
                  )}

                  <div className="jd-two">
                    <details className="jd-options">
                      <summary>Borrow / repay</summary>

                      <label className="hg-field">
                        <span>Loan instruction</span>
                        <select
                          value={draft.loanMode}
                          onChange={(event) => {
                            change("loanMode", event.target.value);
                            change("loanPercent", 0);
                          }}
                        >
                          <option value="hold">Keep current borrowing</option>
                          <option value="borrow">Borrow</option>
                          <option value="repay" disabled={state.debt === 0}>Repay</option>
                        </select>
                      </label>

                      {draft.loanMode !== "hold" && (
                        <Slider
                          label={draft.loanMode === "borrow"
                            ? "Use available credit"
                            : "Repay outstanding debt"}
                          value={draft.loanPercent}
                          max={draft.loanMode === "borrow"
                            ? (preview?.borrowLimit > 0 ? 100 : 0)
                            : preview?.maxRepayPercent ?? 100}
                          onChange={(value) => change("loanPercent", value)}
                        >
                          {signed(preview?.loanChange || 0)}
                        </Slider>
                      )}

                      <Rows rows={[
                        ["Interest this period", <Cash value={preview?.interest || 0} />],
                        ["Principal due", <Cash value={preview?.principal || 0} />],
                        ["Debt after instruction", <Cash value={preview?.plannedDebt || 0} />],
                      ]} />

                      <small>
                        New loans fund the company at settlement, not the live dealing window.
                      </small>
                    </details>

                    <details className="jd-options">
                      <summary>Improve the business</summary>

                      <label className="hg-field">
                        <span>Factories</span>
                        <select
                          value={draft.factoryChange}
                          onChange={(event) => change("factoryChange", Number(event.target.value))}
                        >
                          <option value={0}>Keep current factories</option>
                          <option value={1} disabled={state.factories >= terms.maxFactories}>
                            Add one — {formatYen(terms.factoryPrice)}
                          </option>
                          <option value={-1} disabled={state.factories <= 1}>
                            Sell one — receive {formatYen(terms.factoryResale)}
                          </option>
                        </select>
                        <small>
                          New capacity starts next round. Each factory costs
                          {" "}{formatYen(terms.factoryOverhead)} per quarter.
                        </small>
                      </label>

                      <label className="hg-field">
                        <span>Improvement project</span>
                        <select
                          value={draft.project}
                          onChange={(event) => change("project", event.target.value)}
                        >
                          <option value="none">No new project</option>
                          <option
                            value="efficiency"
                            disabled={Boolean(state.project) || state.efficiency >= 3}
                          >
                            Efficiency — {formatYen(terms.efficiencyCost)}
                          </option>
                          <option
                            value="development"
                            disabled={Boolean(state.project) || state.development >= 3}
                          >
                            Products / markets — {formatYen(terms.developmentCost)}
                          </option>
                        </select>
                        <small>Benefits begin two round openings later.</small>
                      </label>

                      {state.project && (
                        <p className="hg-muted">
                          {PROJECT_LABELS[state.project.kind]}:
                          ready in round {state.project.readyRound + 1}.
                        </p>
                      )}

                      <label className="hg-field">
                        <span>Marketing advice</span>
                        <select
                          value={draft.marketing}
                          onChange={(event) => change("marketing", event.target.value)}
                        >
                          <option value="balanced">Follow management</option>
                          <option value="domestic">Focus on domestic customers</option>
                          <option value="export">Focus on exports</option>
                        </select>
                      </label>
                    </details>
                  </div>

                  <details className="jd-options">
                    <summary>Cash reserve and commitments</summary>

                    <Rows rows={[
                      ["Company cash now", <Cash value={state.cash} />],
                      ["Production and known commitments reserved", <Cash value={preview?.committedReserve || 0} />],
                      ["Additional safety buffer kept", <Cash value={preview?.bufferKept || 0} />],
                      ["Investment funds after the full plan", <Cash value={preview?.budget || 0} />],
                    ]} />

                    <Slider
                      label="Release the recommended safety buffer"
                      value={draft.reserveRelease}
                      onChange={(value) => change("reserveRelease", value)}
                    >
                      0% keeps it. 100% releases it for investment.
                    </Slider>
                  </details>

                  {preview?.problems.length > 0 && (
                    <div className="hg-notice hg-warning">
                      {preview.problems.map((problem) => (
                        <p key={problem}>{problem}</p>
                      ))}
                    </div>
                  )}

                  {preview?.noSalesCash < 0 && (
                    <div className="hg-notice hg-warning">
                      Cash could fall short by
                      {" "}<Cash value={-preview.noSalesCash} />
                      {" "}if customer receipts fail to arrive.
                    </div>
                  )}

                  <div className="jd-submit">
                    <button
                      type="submit"
                      className="hg-primary hg-full"
                      disabled={!canSubmit || !preview?.valid || Boolean(game.busy)}
                    >
                      {game.busy === "submit"
                        ? "Submitting…"
                        : player.ready
                          ? "Update submitted plan"
                          : "Submit investment plan"}
                    </button>

                    {timed && (
                      <small>
                        A completed live trade requires you to resubmit this plan.
                      </small>
                    )}
                  </div>
                </fieldset>
              </form>
            )}
          </section>

          <details className="jd-panel">
            <summary>Property and share-basket history</summary>

            <div className="jd-two">
              {[
                ["stocks", "Share basket", "#31543a"],
                ["property", "Property", "#b08a38"],
              ].map(([field, label, colour]) => {
                const values = [100, ...(room.marketHistory || []).map((row) => row[field])];

                return (
                  <div key={field}>
                    <h3>{label}</h3>
                    <strong>Index {values[values.length - 1].toFixed(2)}</strong>
                    <LineChart values={values} colour={colour} label={`${label} index history`} />
                  </div>
                );
              })}
            </div>
          </details>

          {room.phase === "results" && latest && (
            <section className="jd-panel">
              <h2>Period closed</h2>
              <div className="jd-report-grid">
                <div>
                  <small>Business profit / loss</small>
                  <strong>{signed(latest.metrics.netProfit)}</strong>
                </div>
                <div>
                  <small>Operating cash flow</small>
                  <strong>{signed(latest.metrics.operatingCashFlow)}</strong>
                </div>
                <div>
                  <small>Dealing result</small>
                  <strong>{signed(latest.metrics.dealingProfit || 0)}</strong>
                </div>
                <div>
                  <small>Cash remaining</small>
                  <strong><Cash value={state.cash} /></strong>
                </div>
              </div>
              <p className="hg-muted">Your teacher will open the next period.</p>
            </section>
          )}

          {room.phase === "finished" && (
            <>
              <FinalReport report={player.ending} state={state} />
              <ReflectionPanel room={room} player={player} game={game} />
            </>
          )}
        </>
      )}

      <DeskModal
        open={documentOpen}
        title={room.brief?.date || "Company documents"}
        delivery
        onClose={() => setDocumentOpen(false)}
      >
        <div className="jd-tabs jd-document-tabs">
          <button
            type="button"
            aria-pressed={documentTab === "news"}
            onClick={() => setDocumentTab("news")}
          >Newspaper</button>
          <button
            type="button"
            aria-pressed={documentTab === "company"}
            onClick={() => setDocumentTab("company")}
          >Company report</button>
        </div>

        {documentTab === "news"
          ? <Newspaper article={room.brief} />
          : (
            <CompanyReport
              room={room}
              player={visiblePlayer}
              baseline={baseline}
              terms={terms}
            />
          )}

        <button
          type="button"
          className="hg-primary hg-full"
          style={{ marginTop: 18 }}
          onClick={() => {
            if (documentTab === "news") setDocumentTab("company");
            else setDocumentOpen(false);
          }}
        >
          {documentTab === "news" ? "Read company report" : "Open investment desk"}
        </button>
      </DeskModal>

      <DeskModal
        open={balanceOpen}
        title={`${player.company} — balance sheet`}
        onClose={() => setBalanceOpen(false)}
      >
        <Rows rows={balanceRows.map(([label, value]) => [
          label,
          formatYenExact(value),
        ])} />

        <div className="jd-balance-total">
          <strong>Net worth</strong>
          <strong>{formatYenExact(companyValue(state))}</strong>
        </div>

        <details>
          <summary>Company history</summary>
          <Archive room={room} player={visiblePlayer} />
        </details>
      </DeskModal>
    </div>
  );
}