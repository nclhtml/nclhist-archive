import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

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
  SHARES_PER_LOT,
  MAX_ORDERS,
  executionQuote,
  listedValue,
  markListed,
  maximumBuyLots,
  tradingSummary,
} from "./dealing-model.mjs";

import { estimatedShareSale } from "./eight-model.mjs";

import { efficiencyEstimate } from "./investor-model.mjs";
import { InvestmentLeaderboard } from "./investor-ui";

import {
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

import {
  BoardTarget,
  BoardSummary,
  MoneyReport,
  InvestorGuide,
} from "./classroom-guide";

import "./eight-desk.css";

const count = (value) => new Intl.NumberFormat("en-US").format(value);
const signed = (value) => `${value > 0 ? "+" : ""}${formatYen(value)}`;
const percent = (value) => `${(value * 100).toFixed(1)}%`;

const ICONS = {
  cash: "M3 6h18v12H3z M7 6v12 M17 6v12 M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  shares: "M4 20V4 M4 20h16 M7 15l4-5 4 2 5-7",
  property: "M3 21V8l8-5v18 M11 9l10-3v15 M6 10h2 M6 14h2 M6 18h2 M15 10h2 M15 14h2 M15 18h2",
  factory: "M3 21V10l6 3V8l6 4V5h4l2 16z M6 17h2 M11 17h2 M16 17h2",
  inventory: "M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10",
  invoices: "M5 3h14v18l-3-2-4 2-4-2-3 2z M8 7h8 M8 11h8 M8 15h5",
  loans: "M3 9l9-6 9 6z M5 11v7 M10 11v7 M14 11v7 M19 11v7 M3 21h18",
  worth: "M12 3l9 5v8l-9 5-9-5V8z M8 12l3 3 5-6",
  memo: "M5 3h11l3 3v15H5z M15 3v5h4 M8 11h8 M8 15h8",
  newspaper: "M4 5h16v15H4z M7 8h5v5H7z M15 8h2 M15 11h2 M7 16h10",
  globe: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18 M12 3c-5 5-5 13 0 18",
};

function Icon({ name, size = 24 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name] || ICONS.memo} />
    </svg>
  );
}

function Gain({ value, label = false }) {
  const direction = value > 0 ? "profit" : value < 0 ? "loss" : "neutral";

  return (
    <strong className={`ed-gain ed-${direction}`}>
      {label ? `${value > 0 ? "Profit" : value < 0 ? "Loss" : "Result"} ` : ""}
      {signed(value)}
    </strong>
  );
}

function ValueTile({ icon, title, children }) {
  return (
    <div className="ed-value-tile">
      <Icon name={icon} size={28} />
      <small>{title}</small>
      <strong>{children}</strong>
    </div>
  );
}

const NEWS = {
  plaza: "Coordinated currency action by the major industrial powers is followed by yen appreciation, putting pressure on Japanese exporters.",
  easing: "The Bank of Japan lowers its discount rate in stages. Easier credit supports borrowing and investment.",
  "low-rate": "The official discount rate reaches 2.5%. Borrowing remains attractive as investment confidence strengthens.",
  electronics: "The United States imposes duties on selected Japanese products in the semiconductor dispute, including certain colour televisions.",
  optimism: "Rising land and share values encourage further lending and investment.",
  "tightening-1989": "The Bank of Japan raises rates during 1989. Borrowers review the cost of their financial commitments.",
  "late-boom": "Share and property optimism persists despite more expensive credit.",
  "tightening-1990": "The Bank of Japan continues raising rates. Companies and investors face tighter financing conditions.",
  "land-downturn": "Property weakness spreads after the equity downturn. Buyers and lenders reassess valuations.",
  "financial-strain": "Weak demand and damaged balance sheets increase pressure on businesses. Customer payments and refinancing become more difficult.",
  "uneven-adjustment": "Policy support offers some relief, but adjustment remains uneven across companies and industries.",
  "car-threat": "The United States threatens tariffs on selected Japanese luxury-car models as negotiations continue.",
  "car-settlement": "An agreement on 28 June prevents the threatened tariffs from taking effect. Wider business adjustment continues.",
  "retailer-orders": "Retailers request additional goods.",
  "asset-confidence": "Investor confidence strengthens.",
  "export-contract": "Overseas distributors seek additional supplies.",
  "soft-retail": "Retailers reduce orders following weaker sales.",
  "export-setback": "Overseas distributors become more cautious.",
  "valuation-doubts": "Analysts question share valuations after a rapid rise.",
  "local-contract": "A domestic contract provides limited relief.",
  "niche-export": "A small overseas market offers additional opportunities.",
  "buyer-delay": "Customers postpone some purchases.",
  "market-anxiety": "Market anxiety adds to share-selling pressure.",
  "property-buyers": "Property buyers demand lower valuations.",
};

function Newspaper({ article, breaking }) {
  const events = article.events || [];

  return (
    <article className="hg-newspaper">
      <div className="hg-paper-topline">
        <span>Tokyo</span>
        <span>Business • Finance • Trade</span>
      </div>

      <div className="hg-masthead">Tokyo Business Chronicle</div>

      <div className="hg-paper-dateline">
        <span>{article.date}</span>
        <span>Business edition</span>
      </div>

      {breaking && (
        <section className="ed-breaking">
          <strong>{breaking.headline}</strong>
          <p>{breaking.body}</p>
        </section>
      )}

      {events.map((event, index) => (
        <section className={index ? "ed-news-story" : ""} key={event.id}>
          {index === 0
            ? <h2 style={{ marginTop: 20 }}>{event.headline}</h2>
            : <h3>{event.headline}</h3>}
          <p className={index === 0 ? "hg-paper-story" : ""}>
            {NEWS[event.id] || event.body}
          </p>
        </section>
      ))}
    </article>
  );
}

function BoardMemo({ player }) {
  return (
    <section className="ed-memo">
      <Icon name="memo" size={34} />
      <span className="hg-eyebrow">Board memorandum</span>
      <h2>Appointment of investment adviser</h2>
      <p>To: {player.studentName}</p>
      <p>
        Your investment funds are ready. Manage our financial investments
        and advise the board on business development. Management will
        organise routine production.
      </p>
      <div className="ed-report-tiles">
        <ValueTile icon="cash" title="Starting cash">
          <Cash value={player.opening?.before.cash ?? player.state.cash} />
        </ValueTile>
        <ValueTile icon="factory" title="Starting factories">
          {player.opening?.before.factories ?? player.state.factories}
        </ValueTile>
      </div>
      <p className="ed-signature">Board of Directors<br />{player.company}</p>
    </section>
  );
}

function CompanyReport({ room, player }) {
  /*
   * During decision-making this is the opening report.
   * It does not restart or change whenever a share quote updates.
   */
  const reportState = room.phase === "decision"
    ? player.opening?.after || player.state
    : player.state;

  const reportTerms = room.brief
    ? companyTerms(reportState, room.rules, room.brief)
    : null;

  const funding =
    room.phase === "decision" &&
      room.brief &&
      !reportState.suspended
      ? prepareInvestment(
        reportState,
        {
          ...defaultInvestmentPlan(),
          reserveRelease: 100,
        },
        room.rules,
        room.brief
      )
      : null;

  return (
    <MoneyReport
      room={room}
      player={{ ...player, state: reportState }}
      funding={funding}
      terms={reportTerms}
    />
  );
}

function FinalReport({ report }) {
  if (!report) return null;

  return (
    <section className="ed-panel ed-memo">
      <span className="hg-eyebrow">Final report to the board</span>
      <h2>{report.outcome}</h2>
      <p>{report.explanation}</p>

      <BoardSummary
        board={report.board}
        companyClosed={report.outcome === "Financial failure / closure"}
      />

      <div className="ed-report-tiles">
        <ValueTile icon="worth" title="Final net worth"><Cash value={report.netWorth} /></ValueTile>
        <ValueTile icon="cash" title="Cash remaining"><Cash value={report.cash} /></ValueTile>
        <ValueTile icon="loans" title="Loans remaining"><Cash value={report.debt} /></ValueTile>
        <ValueTile icon="factory" title="Recent operating cash flow"><Gain value={report.averageOperatingCash} /></ValueTile>
      </div>

      {report.dealing && (
        <Rows rows={[
          ["Realised share result", <Gain value={report.dealing.realized} />],
          ["Unrealised share result", <Gain value={report.dealing.unrealized} />],
          ["Trading fees", <Cash value={report.dealing.fees} />],
          ["Emergency-sale losses", <Cash value={report.forcedLoss} />],
        ]} />
      )}

      <details>
        <summary>Continuation assessment</summary>
        <p>
          {!report.stress.performed
            ? "The company had already suspended operations."
            : report.stress.survived
              ? "The company survived all six continuation periods."
              : `The company failed during continuation period ${report.stress.periods}.`}
        </p>
        <ul>
          {report.stress.assumptions.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </details>
    </section>
  );
}

function readPending(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

export default function EightDesk({
  room,
  player,
  game,
  Archive,
  ReflectionPanel,
}) {
  const componentId = useId();
  const deskRoot = useRef(null);
  const guideOffered = useRef(new Set());
  const [guideOpen, setGuideOpen] = useState(false);

  const showGuideScene = useCallback((scene) => {
    setTab(scene === "company" ? "company" : "shares");
  }, []);

  const [tab, setTab] = useState("shares");
  const [symbol, setSymbol] = useState(LISTED_SHARES[0].id);
  const [side, setSide] = useState("buy");
  const [lots, setLots] = useState(1);

  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [documentTab, setDocumentTab] = useState("paper");
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [portfolioPreview, setPortfolioPreview] = useState(false);

  const [draft, setDraft] = useState(
    () => ({ ...(player.advice || defaultInvestmentPlan()) })
  );

  const [dirty, setDirty] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState(0);

  const prompted = useRef(new Set());
  const pendingKey = `hg-pending-order:${room.code}:${player.uid}`;

  const [pendingOrder, setPendingOrder] = useState(
    () => readPending(pendingKey)
  );

  const clock = useDealingClock(room.dealing, game.marketFeed.offset);

  const state = useMemo(
    () => player.state.suspended
      ? player.state
      : markListed(player.state, room.dealing?.prices),
    [player.state, room.dealing?.prices]
  );

  const terms = useMemo(
    () => room.brief ? companyTerms(state, room.rules, room.brief) : null,
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

  const protection = useMemo(
    () => room.brief && !state.suspended
      ? prepareInvestment(
        state,
        { ...defaultInvestmentPlan(), reserveRelease: 100 },
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

  const efficiencyPreview = useMemo(
    () => state.performanceVersion === 1
      ? efficiencyEstimate(
        state,
        room.rules,
        room.brief,
        preview
      )
      : null,
    [state, room.rules, room.brief, preview]
  );

  useEffect(() => {
    setDraft({ ...(player.advice || defaultInvestmentPlan()) });
    setDirty(false);
    setReceipt(null);
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
    try {
      if (pendingOrder) {
        sessionStorage.setItem(pendingKey, JSON.stringify(pendingOrder));
      } else {
        sessionStorage.removeItem(pendingKey);
      }
    } catch {
      // Server-side order references still prevent duplicate execution.
    }
  }, [pendingKey, pendingOrder]);

  useEffect(() => {
    if (room.phase !== "decision") return;

    const key = `hg-r4-briefing:${room.code}:${player.uid}:${room.round}`;
    let seen = prompted.current.has(key);

    try {
      seen = seen || sessionStorage.getItem(key) === "yes";
    } catch {
      // In-memory tracking remains available.
    }

    if (seen) return;

    prompted.current.add(key);

    try {
      sessionStorage.setItem(key, "yes");
    } catch {
      // Documents remain available through their buttons.
    }

    setDocumentTab("paper");
    setDocumentsOpen(true);
  }, [room.phase, room.round, room.code, player.uid]);

  const market = room.dealing;
  const prices = market?.prices || state.listedPrices;
  const selected = LISTED_SHARES.find((share) => share.id === symbol);
  const position = state.listed[symbol];

  const buyingPower = player.board?.dismissed
    ? 0
    : protection?.valid ? protection.budget : 0;

  const maximum = side === "buy"
    ? maximumBuyLots(prices, symbol, buyingPower)
    : position.lots;

  const order = Number.isSafeInteger(lots) && lots > 0
    ? executionQuote(prices, symbol, side, lots)
    : null;

  const saleEstimate = estimatedShareSale(state, symbol, order);

  const quoteFresh =
    Boolean(market) &&
    market.tick === clock.tick &&
    game.marketFeed.ready;

  const accountFresh =
    (player.balanceRevision || 0) >= acknowledgedRevision;

  const canTrade =
    room.phase === "decision" &&
    clock.stage === "live" &&
    !clock.halted &&
    !clock.paused &&
    !room.paused &&
    !state.suspended &&
    !player.board?.dismissed &&
    quoteFresh &&
    accountFresh &&
    !game.busy;

  const canSubmit =
    room.phase === "decision" &&
    ["live", "grace"].includes(clock.stage) &&
    !room.paused &&
    !state.suspended &&
    !player.board?.dismissed;

  const changedSubmittedNumbers = Boolean(
    player.ready &&
    preview?.decision &&
    JSON.stringify(preview.decision) !== JSON.stringify(player.decision)
  );

  const planStatus = player.ready
    ? dirty || changedSubmittedNumbers ? "Submitted · review changes" : "Submitted"
    : player.planNeedsReview ? "Resubmit after trade" : "Not submitted";

  function change(key, value) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  }

  async function submit(event) {
    event.preventDefault();

    if (!canSubmit || !preview?.valid || game.busy) return;

    const result = await game.act("submit", {
      code: room.code,
      round: room.round,
      advice: draft,
      balanceRevision: player.balanceRevision || 0,
    }, "Plan submitted.");

    if (result.ok) setDirty(false);
  }

  async function transmit(request) {
    setPendingOrder(request);

    const result = await game.act("dealOrder", request);

    if (result.ok) {
      setReceipt(result.data.receipt);
      setAcknowledgedRevision(result.data.receipt.balanceRevision);
      setPendingOrder(null);
      game.marketFeed.refresh();
      return;
    }

    if ([
      "functions/invalid-argument",
      "functions/failed-precondition",
      "functions/permission-denied",
      "functions/not-found",
      "functions/unauthenticated",
    ].includes(result.errorCode)) {
      setPendingOrder(null);
    }

    game.marketFeed.refresh();
  }

  function trade() {
    if (
      !canTrade ||
      pendingOrder ||
      !order ||
      lots > maximum
    ) return;

    transmit({
      code: room.code,
      round: room.round,
      orderId: crypto.randomUUID(),
      symbol,
      side,
      lots,
      quoteTick: market.tick,
      marketRevision: market.revision,
      balanceRevision: player.balanceRevision || 0,
    });
  }

  const latestReceipt = receipt || player.dealLog?.[player.dealLog.length - 1];
  const latestHistory = player.history?.[player.history.length - 1];

  const relativeHistories = market
    ? LISTED_SHARES.map((share) => market.history.map((row) =>
      row.prices[share.id] / market.history[0].prices[share.id] * 100
    ))
    : [];

  const allPoints = relativeHistories.flat();
  const graphLow = Math.min(98, ...allPoints);
  const graphHigh = Math.max(102, ...allPoints);

  const portfolioState = portfolioPreview && preview?.proposed
    ? preview.proposed
    : state;

  const portfolio = [
    { id: "cash", label: "Cash", value: portfolioState.cash, colour: "#b5c2aa" },
    { id: "property", label: "Property", value: portfolioState.property, colour: "#ad8432" },
    ...LISTED_SHARES.map((share) => ({
      id: share.id,
      label: share.name,
      colour: share.colour,
      value:
        portfolioState.listed[share.id].lots *
        portfolioState.listedPrices[share.id],
    })),
  ];

  const balance = [
    ["cash", "Cash", state.cash],
    ["shares", "Shares", listedValue(state)],
    ["property", "Property", state.property],
    ["factory", "Factories", state.factoryBook],
    ["inventory", "Inventory", state.inventoryBook],
    ["invoices", "Customer invoices", state.receivables],
    ["loans", "Loans owed", state.debt],
    ["worth", "Net worth", companyValue(state)],
  ];

  function openDocuments(which) {
    setDocumentTab(which);
    setDocumentsOpen(true);
  }

  function guideStorageKey() {
    return `hg-guided-r5:${room.code}:${player.uid}`;
  }

  function startGuide() {
    setDocumentsOpen(false);
    setBalanceOpen(false);
    setPortfolioOpen(false);
    setChartOpen(false);
    setTab("shares");
    setGuideOpen(true);
  }

  function closeDocuments() {
    setDocumentsOpen(false);

    if (
      room.round !== 0 ||
      room.phase !== "decision" ||
      state.suspended ||
      player.board?.dismissed
    ) return;

    const key = guideStorageKey();
    let completed = guideOffered.current.has(key);

    try {
      completed = completed || localStorage.getItem(key) === "done";
    } catch {
      // The in-memory record still prevents repeats during this visit.
    }

    if (!completed) {
      guideOffered.current.add(key);
      startGuide();
    }
  }

  function finishGuide() {
    const key = guideStorageKey();
    guideOffered.current.add(key);

    try {
      localStorage.setItem(key, "done");
    } catch {
      // Help remains available even when browser storage is unavailable.
    }

    setGuideOpen(false);
    setTab("shares");

    requestAnimationFrame(() => {
      deskRoot.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });

      deskRoot.current
        ?.querySelector('[data-guide="help"]')
        ?.focus({ preventScroll: true });
    });
  }

  function tabKey(event, nextTab) {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setTab(nextTab);
      requestAnimationFrame(() => {
        document.getElementById(`${componentId}-${nextTab}-tab`)?.focus();
      });
    }
  }

  return (
    <div className="ed-root" ref={deskRoot}>
      <header className="ed-header ir-investor-header">
        <div className="ed-company">
          <span>{industryFor(state.industry).name}</span>
          <h1>{player.company}</h1>
          <small>
            {room.phase === "lobby"
              ? "Japan • awaiting your first briefing"
              : `${room.brief.date} · Round ${room.round + 1} / ${room.totalRounds}`}
          </small>
        </div>

        <div className="ir-account-head">
          <button
            type="button"
            className="ir-spendable"
            data-guide="funds"
            onClick={() => {
              if (room.phase === "lobby") setBalanceOpen(true);
              else openDocuments("report");
            }}
            aria-haspopup="dialog"
          >
            <small>Available to trade now</small>
            <strong>
              {room.phase === "lobby" ? "—" : <Cash value={buyingPower} />}
            </strong>
          </button>

          <div className="ir-small-balances">
            <span>Cash in bank: {formatYen(state.cash)}</span>
            <button
              type="button"
              onClick={() => setBalanceOpen(true)}
              aria-haspopup="dialog"
            >
              Company value: {formatYen(companyValue(state))}
              {" "}· Balance sheet
            </button>
          </div>
        </div>
      </header>

      {room.phase === "lobby" ? (
        <section className="ed-panel">
          <BoardMemo player={player} />
        </section>
      ) : (
        <>
          <div className="ed-toolbar">
            <div className="ed-document-buttons">
              <button type="button" onClick={() => openDocuments("paper")}>
                <Icon name={room.round === 0 ? "memo" : "newspaper"} />
                {room.round === 0 ? "Board memo" : "Newspaper"}
              </button>
              <button
                type="button"
                data-guide="report"
                onClick={() => openDocuments("report")}
              >
                <Icon name="invoices" /> Company report
              </button>
              <button type="button" onClick={() => setPortfolioOpen(true)}>
                <Icon name="shares" /> Portfolio
              </button>

              <button
                type="button"
                data-guide="help"
                onClick={startGuide}
              >
                ? Help
              </button>
            </div>

            <div data-guide="clock">
              <MarketClockLabel clock={clock} />
            </div>
          </div>

          <BoardTarget
            room={room}
            player={player}
            state={state}
          />

          {clock.halted && (
            <div className="ed-halt" role="status">
              <strong>Trading temporarily suspended</strong>
              <span>
                Both buying and selling reopen in
                {" "}{Math.ceil(clock.haltRemainingMs / 1000)} seconds.
              </span>
            </div>
          )}

          {market?.breaking && !clock.halted && (
            <div className="ed-market-note">
              {market.breaking.headline} · Trading has resumed.
            </div>
          )}

          {state.suspended && (
            <div className="hg-notice hg-warning">
              <strong>Operations suspended.</strong> {state.failureReason}
            </div>
          )}

          <div className="ed-main-tabs" role="tablist" aria-label="Investment desk">
            <button
              id={`${componentId}-shares-tab`}
              type="button"
              role="tab"
              tabIndex={tab === "shares" ? 0 : -1}
              aria-selected={tab === "shares"}
              aria-controls={`${componentId}-shares-panel`}
              onClick={() => setTab("shares")}
              onKeyDown={(event) => tabKey(event, "company")}
            >
              <Icon name="shares" /> Shares
            </button>

            <button
              id={`${componentId}-company-tab`}
              type="button"
              role="tab"
              tabIndex={tab === "company" ? 0 : -1}
              aria-selected={tab === "company"}
              aria-controls={`${componentId}-company-panel`}
              onClick={() => setTab("company")}
              onKeyDown={(event) => tabKey(event, "shares")}
            >
              <Icon name="factory" /> Company & loans
              {room.phase === "decision" && <small>{planStatus}</small>}
            </button>
          </div>

          <section
            id={`${componentId}-shares-panel`}
            role="tabpanel"
            aria-labelledby={`${componentId}-shares-tab`}
            hidden={tab !== "shares"}
            className="ed-panel"
          >
            <div className="ed-stock-layout">
              <div>
                <div className="ed-share-grid" data-guide="shares">
                  {LISTED_SHARES.map((share, index) => {
                    const holding = state.listed[share.id];
                    const current = prices[share.id];
                    const initial = market.history[0].prices[share.id];
                    const movement = current / initial - 1;

                    const estimate = holding.lots > 0
                      ? estimatedShareSale(
                        state,
                        share.id,
                        executionQuote(prices, share.id, "sell", holding.lots)
                      )
                      : null;

                    return (
                      <button
                        type="button"
                        key={share.id}
                        className={`ed-share-card ${symbol === share.id ? "ed-selected" : ""}`}
                        aria-pressed={symbol === share.id}
                        onClick={() => { setSymbol(share.id); setLots(1); }}
                      >
                        <div className="ed-card-title">
                          <strong>{share.name}</strong>
                          <small>{share.sector}</small>
                        </div>

                        <div className="ed-card-price">
                          <strong>{formatYenExact(current / SHARES_PER_LOT)}</strong>
                          <span className={movement < 0 ? "ed-loss" : "ed-profit"}>
                            {movement >= 0 ? "+" : ""}{percent(movement)}
                          </span>
                        </div>

                        <LineChart
                          values={relativeHistories[index]}
                          colour={share.colour}
                          minimum={graphLow}
                          maximum={graphHigh}
                          label={`${share.name}: ${percent(movement)} since this market opened`}
                        />

                        {holding.lots > 0 ? (
                          <div className="ed-holding-details">
                            <span>
                              Avg cost {formatYenExact(holding.cost / (holding.lots * SHARES_PER_LOT))}
                              {" "}· {count(holding.lots * SHARES_PER_LOT)} shares
                            </span>
                            <span>Sell all now: <Gain value={estimate.result} label /></span>
                          </div>
                        ) : <small>No shares owned</small>}

                        <span className="ed-company-signal">
                          {room.brief.companyWatch?.find(
                            (item) => item.symbol === share.id
                          )?.text}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="ed-chart-button"
                  onClick={() => setChartOpen(true)}
                >
                  {selected.name} · Larger chart and price record
                </button>
              </div>

              <section className="ed-order" data-guide="order">
                <div className="ed-order-heading">
                  <h2>{selected.name}</h2>
                  <small>1 lot = {count(SHARES_PER_LOT)} shares</small>
                </div>

                <div className="ed-buy-sell">
                  <button type="button" aria-pressed={side === "buy"} onClick={() => { setSide("buy"); setLots(1); }}>Buy</button>
                  <button type="button" aria-pressed={side === "sell"} onClick={() => { setSide("sell"); setLots(1); }}>Sell</button>
                </div>

                <Slider
                  label="Lots"
                  value={lots}
                  max={maximum}
                  suffix=""
                  onChange={setLots}
                  disabled={Boolean(pendingOrder) || state.suspended}
                >
                  Maximum {count(maximum)} lots
                </Slider>

                <div className="ed-quantity-buttons">
                  <button type="button" disabled={Boolean(pendingOrder) || lots <= 0} onClick={() => setLots(Math.max(0, lots - 1))}>−</button>
                  <button type="button" disabled={Boolean(pendingOrder) || lots >= maximum} onClick={() => setLots(Math.min(maximum, lots + 1))}>+</button>
                  <button type="button" disabled={Boolean(pendingOrder) || maximum === 0} onClick={() => setLots(maximum)}>Max</button>
                </div>

                {order && (
                  <Rows rows={[
                    ["Shares", count(order.shares)],
                    ["Execution price / share", formatYenExact(order.price / SHARES_PER_LOT)],
                    ["Fee", <Cash value={order.fee} />],
                    [
                      side === "buy" ? "Total cost" : "Cash received",
                      <strong><Cash value={order.cashAmount} /></strong>,
                    ],
                    ...(saleEstimate ? [
                      ["Original cost of these shares", <Cash value={saleEstimate.cost} />],
                    ] : []),
                  ]} />
                )}

                {saleEstimate && (
                  <div className="ed-estimated-result">
                    <small>Estimated sale result, after fees</small>
                    <Gain value={saleEstimate.result} label />
                  </div>
                )}

                <button
                  type="button"
                  className="hg-primary hg-full"
                  disabled={
                    !canTrade ||
                    Boolean(pendingOrder) ||
                    !order ||
                    lots > maximum ||
                    (player.dealCount || 0) >= MAX_ORDERS
                  }
                  onClick={trade}
                >
                  {clock.halted
                    ? "Trading suspended"
                    : side === "buy" ? "Buy now" : "Sell now"}
                </button>

                {clock.stage === "live" && !quoteFresh && !clock.halted && (
                  <small className="ed-help">Updating quote…</small>
                )}

                {pendingOrder && (
                  <div className="hg-notice hg-warning">
                    <p>Checking the last order.</p>
                    <button type="button" disabled={Boolean(game.busy)} onClick={() => transmit(pendingOrder)}>
                      Check / retry the same order
                    </button>
                  </div>
                )}

                {latestReceipt && (
                  <div
                    className={`ed-receipt ${latestReceipt.side === "sell"
                      ? latestReceipt.realized < 0 ? "ed-receipt-loss" : "ed-receipt-profit"
                      : ""
                      }`}
                    role="status"
                  >
                    <strong>
                      {latestReceipt.side === "sell" ? "Sold" : "Bought"}
                      {" "}{count(latestReceipt.shares)}
                      {" "}{LISTED_SHARES.find(
                        (share) => share.id === latestReceipt.symbol
                      )?.name}
                    </strong>

                    {latestReceipt.side === "sell"
                      ? <Gain value={latestReceipt.realized} label />
                      : <span>Paid {formatYen(latestReceipt.cashAmount)}</span>}
                  </div>
                )}
              </section>
            </div>
          </section>

          <section
            id={`${componentId}-company-panel`}
            role="tabpanel"
            aria-labelledby={`${componentId}-company-tab`}
            hidden={tab !== "company"}
            className="ed-panel"
          >
            {room.phase === "decision" && !state.suspended && !player.board?.dismissed ? (
              <form onSubmit={submit}>
                <div className="ed-plan-top">
                  <div><small>Available after this plan's commitments</small><strong><Cash value={preview?.budget || 0} /></strong></div>
                  <button type="button" onClick={() => { setPortfolioPreview(true); setPortfolioOpen(true); }}>
                    Preview portfolio
                  </button>
                </div>

                <fieldset disabled={Boolean(game.busy) || room.paused}>
                  <div className="ed-company-layout">
                    <section className="ed-options">
                      <h3><Icon name="property" /> Property</h3>

                      <Rows rows={[
                        ["Current value", <Cash value={state.property} />],
                        ["Original cost still held", <Cash value={state.propertyCost || 0} />],
                      ]} />

                      <Slider
                        label="Buy property — percentage of available funds"
                        value={draft.buyProperty}
                        max={preview?.purchasePercentLimit ?? 100}
                        disabled={draft.sellProperty > 0}
                        onChange={(value) => change("buyProperty", value)}
                      >
                        Buy {formatYen(preview?.propertyPurchase || 0)}.
                        {" "}Keep {100 - draft.buyProperty}% as cash.
                      </Slider>

                      <Slider
                        label="Sell property — percentage owned"
                        value={draft.sellProperty}
                        max={state.property > 0 ? Math.floor(room.rules.propertySaleFraction * 100) : 0}
                        disabled={draft.buyProperty > 0}
                        onChange={(value) => change("sellProperty", value)}
                      >
                        Receive {formatYen(preview?.propertySaleCash || 0)}.
                        {" "}Buyers pay {Math.round(room.rules.propertyBid * 100)}% of value sold.
                      </Slider>

                      {draft.sellProperty > 0 && preview?.valid && (
                        <div className="ed-estimated-result">
                          <small>Estimated property sale result</small>
                          <Gain value={preview.propertyRealized} label />
                        </div>
                      )}
                    </section>

                    <section className="ed-options" data-guide="bank">
                      <h3><Icon name="loans" /> Loans</h3>

                      <div className="ip-rate">
                        <small>Borrowing rate</small>
                        <strong>{percent(terms.rate)} this round</strong>
                        <span>
                          New loan review:
                          {" "}round {room.round + terms.loanTermRounds + 1}
                        </span>
                      </div>

                      <label className="hg-field">
                        <span>Instruction</span>
                        <select
                          value={draft.loanMode}
                          onChange={(event) => {
                            change("loanMode", event.target.value);
                            change("loanPercent", 0);
                          }}
                        >
                          <option value="hold">Keep current borrowing</option>
                          <option value="borrow">Borrow more</option>
                          <option value="repay" disabled={state.debt === 0}>Repay debt</option>
                        </select>
                      </label>

                      {draft.loanMode !== "hold" && (
                        <Slider
                          label={draft.loanMode === "borrow" ? "Use available credit" : "Repay outstanding debt"}
                          value={draft.loanPercent}
                          max={draft.loanMode === "borrow"
                            ? preview?.borrowLimit > 0 ? 100 : 0
                            : preview?.maxRepayPercent ?? 100}
                          onChange={(value) => change("loanPercent", value)}
                        >
                          {signed(preview?.loanChange || 0)}
                        </Slider>
                      )}

                      <Rows rows={[
                        ["Additional credit available", <Cash value={preview?.borrowLimit || 0} />],
                        ["Debt after this instruction", <Cash value={preview?.plannedDebt || 0} />],
                        ["Interest this round", <Cash value={preview?.interest || 0} />],
                        ["Principal currently expected", <Cash value={preview?.principal || 0} />],
                      ]} />

                      <small className="ed-help">
                        New loans arrive at settlement. Repayment is reviewed against closing collateral.
                      </small>
                    </section>

                    <section className="ed-options" data-guide="business">
                      <h3><Icon name="factory" /> Business investment</h3>

                      <label className="hg-field">
                        <span>Factories</span>
                        <select value={draft.factoryChange} onChange={(event) => change("factoryChange", Number(event.target.value))}>
                          <option value={0}>Keep {state.factories} factories</option>
                          <option value={1} disabled={state.factories >= terms.maxFactories}>
                            Add one — {formatYen(terms.factoryPrice)}
                          </option>
                          <option value={-1} disabled={state.factories <= 1}>
                            Sell one — {formatYen(terms.factoryResale)}
                          </option>
                        </select>
                        <small>
                          New capacity starts next round.
                          {" "}{formatYen(terms.factoryOverhead)} running cost per factory.
                        </small>
                      </label>

                      <label className="hg-field">
                        <span>Improvement project</span>
                        <select value={draft.project} onChange={(event) => change("project", event.target.value)}>
                          <option value="none">No new project</option>
                          <option value="efficiency" disabled={Boolean(state.project) || state.efficiency >= 3}>
                            Efficiency — {formatYen(terms.efficiencyCost)}
                          </option>
                          <option value="development" disabled={Boolean(state.project) || state.development >= 3}>
                            Products / markets — {formatYen(terms.developmentCost)}
                          </option>
                        </select>
                        <small>Benefits begin two round openings later.</small>
                      </label>

                      {efficiencyPreview && (
                        <div className="ip-efficiency">
                          Next efficiency upgrade:
                          <strong>
                            Save about {formatYen(efficiencyPreview.saving)}
                            {" "}per round
                          </strong>
                          <small>
                            Estimate using this plan's production and factories.
                            Lower production means smaller savings.
                            Cost: {formatYen(efficiencyPreview.cost)}.
                          </small>

                          {efficiencyPreview.readyRound >= room.totalRounds && (
                            <small>
                              A new project now will not finish before the final round.
                            </small>
                          )}
                        </div>
                      )}

                      {state.project && (
                        <small className="ed-help">
                          {PROJECT_LABELS[state.project.kind]}:
                          ready in round {state.project.readyRound + 1}.
                        </small>
                      )}

                      <details>
                        <summary>Marketing and cash buffer</summary>

                        <label className="hg-field">
                          <span>Marketing advice</span>
                          <select value={draft.marketing} onChange={(event) => change("marketing", event.target.value)}>
                            <option value="balanced">Follow management</option>
                            <option value="domestic">Focus on domestic customers</option>
                            <option value="export">Focus on exports</option>
                          </select>
                        </label>

                        <Slider
                          label="Release the recommended safety buffer"
                          value={draft.reserveRelease}
                          onChange={(value) => change("reserveRelease", value)}
                        >
                          0% keeps it; 100% releases it for investment.
                        </Slider>

                        <Rows rows={[
                          ["Known commitments reserved", <Cash value={preview?.committedReserve || 0} />],
                          ["Additional buffer kept", <Cash value={preview?.bufferKept || 0} />],
                        ]} />
                      </details>
                    </section>
                  </div>

                  {preview?.problems.length > 0 && (
                    <div className="hg-notice hg-warning">
                      {preview.problems.map((problem) => <p key={problem}>{problem}</p>)}
                    </div>
                  )}

                  {preview?.noSalesCash < 0 && (
                    <div className="hg-notice hg-warning">
                      Without customer receipts, cash could fall short by
                      {" "}<Cash value={-preview.noSalesCash} />.
                    </div>
                  )}

                  <div className="ed-submit-bar" data-guide="submit">
                    <span>{planStatus}</span>
                    <button type="submit" className="hg-primary" disabled={!canSubmit || !preview?.valid || Boolean(game.busy)}>
                      {game.busy === "submit" ? "Submitting…" : player.ready ? "Update submitted plan" : "Submit plan"}
                    </button>
                  </div>
                </fieldset>
              </form>
            ) : latestHistory ? (
              <CompanyReport
                room={room}
                player={{ ...player, state }}
                baseline={baseline}
                terms={terms}
              />
            ) : (
              <p>Management has no new operating report yet.</p>
            )}
          </section>

          {room.phase === "results" && latestHistory && (
            <div className="ed-close-strip">
              <span>Period closed</span>
              <span>Operating cash: <Gain value={latestHistory.metrics.operatingCashFlow} /></span>
              <span>Dealing: <Gain value={latestHistory.metrics.dealingProfit || 0} /></span>
              {latestHistory.decision.property < 0 && (
                <span>Property sold: <Gain value={latestHistory.metrics.propertyRealized || 0} label /></span>
              )}
            </div>
          )}

          {room.phase === "finished" && (
            <>
              <FinalReport report={player.ending} />

              <InvestmentLeaderboard
                ranking={room.finalRanking}
                ownKey={player.rankingKey || ""}
              />

              <ReflectionPanel room={room} player={player} game={game} />
            </>
          )}
        </>
      )}

      <DeskModal
        open={documentsOpen}
        title={room.brief?.date || "Company documents"}
        delivery
        onClose={closeDocuments}
      >
        <div className="ed-document-tabs">
          <button type="button" aria-pressed={documentTab === "paper"} onClick={() => setDocumentTab("paper")}>
            {room.round === 0 ? "Board memo" : "Newspaper"}
          </button>
          <button type="button" aria-pressed={documentTab === "report"} onClick={() => setDocumentTab("report")}>
            Company report
          </button>
        </div>

        {documentTab === "paper"
          ? room.round === 0
            ? <BoardMemo player={player} />
            : <Newspaper article={room.brief} breaking={market?.breaking} />
          : <CompanyReport room={room} player={{ ...player, state }} baseline={baseline} terms={terms} />}

        <button
          type="button"
          className="hg-primary hg-full"
          style={{ marginTop: 18 }}
          onClick={() => {
            if (documentTab === "paper") setDocumentTab("report");
            else closeDocuments();
          }}
        >
          {documentTab === "paper" ? "Company report" : "Open investment desk"}
        </button>
      </DeskModal>

      <DeskModal open={balanceOpen} title="Company balance sheet" onClose={() => setBalanceOpen(false)}>
        <div className="ed-balance-grid">
          {balance.map(([icon, label, value]) => (
            <div key={label} className={icon === "loans" ? "ed-liability" : icon === "worth" ? "ed-total" : ""}>
              <Icon name={icon} size={32} />
              <span>{label}</span>
              <strong><Cash value={value} /></strong>
              {icon === "factory" && <small>{state.factories} factories</small>}
              {icon === "inventory" && <small>{state.inventory} goods</small>}
            </div>
          ))}
        </div>

        <details style={{ marginTop: 18 }}>
          <summary>Exact values and company history</summary>
          <Rows rows={balance.map(([, label, value]) => [label, formatYenExact(value)])} />
          <Archive room={room} player={{ ...player, state }} />
        </details>
      </DeskModal>

      <DeskModal open={portfolioOpen} title="Cash and investment portfolio" onClose={() => setPortfolioOpen(false)}>
        <div className="ed-document-tabs">
          <button type="button" aria-pressed={!portfolioPreview} onClick={() => setPortfolioPreview(false)}>Current</button>
          <button type="button" aria-pressed={portfolioPreview} onClick={() => setPortfolioPreview(true)}>After plan</button>
        </div>
        <PortfolioRing items={portfolio} />
        {portfolioPreview && <small>Plan preview, before operating receipts and bills.</small>}
      </DeskModal>

      <DeskModal open={chartOpen} title={selected.name} onClose={() => setChartOpen(false)}>
        {market && (
          <>
            <LineChart
              large
              values={market.history.map((row) => row.prices[symbol])}
              colour={selected.colour}
              label={`${selected.name} price history`}
            />
            <div className="hg-table-wrap">
              <table>
                <thead><tr><th>Elapsed</th><th>Price per share</th></tr></thead>
                <tbody>
                  {market.history.map((row) => (
                    <tr key={row.tick}>
                      <td>{row.tick * 5}s</td>
                      <td>{formatYenExact(row.prices[symbol] / SHARES_PER_LOT)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DeskModal>

      {guideOpen && (
        <InvestorGuide
          rootRef={deskRoot}
          onScene={showGuideScene}
          onFinish={finishGuide}
          marketRunning={
            ["live", "grace"].includes(clock.stage) &&
            !clock.paused
          }
        />
      )}
    </div>
  );
}