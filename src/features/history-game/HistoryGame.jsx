import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import InvestmentDesk from "./InvestmentDesk";
import JapanDesk from "./JapanDesk";
import EightDesk from "./EightDesk";
import { BoardSummary } from "./classroom-guide";
import { InvestmentLeaderboard } from "./investor-ui";

import {
  DealingTeacher,
  useMarketFeed,
  useDealingClock,
} from "./dealing-ui";

import {
  markListed,
  listedValue,
} from "./dealing-model.mjs";

import "./japan-desk.css";

import {
  formatYen,
  formatYenExact,
} from "./advisor-model.mjs";

import {
  INDUSTRIES,
  companyValue,
} from "./resilience-model.mjs";

import {
  EconomicRound,
  EndingReport,
} from "./EconomyReports";

import "./history-game.css";

const ENGINE_VERSION = 2;
const SCENARIO = "japan-1985-1995";

const EMPTY = {
  debt: 0,
  stocks: 0,
  property: 0,
  factories: 0,
  production: 0,
  exports: 0,
};

const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

const count = (value) => new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
}).format(num(value));

const money = (value) => formatYen(num(value));

const pct = (value) => `${(num(value) * 100).toFixed(1)}%`;

const signed = (value) =>
  `${num(value) > 0 ? "+" : ""}${money(value)}`;

const signedCount = (value) =>
  `${num(value) > 0 ? "+" : ""}${count(value)}`;

const errorText = (error) =>
  String(error?.message || "The request failed.").replace(/^Firebase:\s*/i, "");

function equity(state, rules) {
  return companyValue(state, rules);
}

function creditLimit(state, rules) {
  return Math.max(0, Math.min(
    rules.maxDebt,
    Math.floor(
      (
        rules.creditBase +
        state.stocks * rules.stockCollateral +
        state.property * rules.propertyCollateral +
        state.factories * rules.factoryPrice * rules.factoryCollateral
      ) * rules.creditFactor
    )
  ));
}

function principalDue(state, rules) {
  return Math.min(state.debt, Math.max(
    Math.ceil(state.debt * rules.principalRate),
    Math.max(0, state.debt - creditLimit(state, rules))
  ));
}

function Notice({ children, type = "" }) {
  return (
    <div
      className={`hg-notice ${type ? `hg-${type}` : ""}`}
      role={type === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

function Loading({ text = "Connecting to the classroom…" }) {
  return (
    <div className="hg-loading" role="status">
      <span className="hg-loading-dot" aria-hidden="true" />
      {text}
    </div>
  );
}

function Field({ label, help, children }) {
  return (
    <label className="hg-field">
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}

function LedgerRows({ rows }) {
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

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function recordsAligned(room, players) {
  if (room.phase === "lobby") return true;

  return players.every((player) =>
    player &&
    player.openedRound === room.round &&
    player.settledRound === (
      room.phase === "decision" ? room.round - 1 : room.round
    )
  );
}

/* ----------------------- Firebase connection ----------------------- */

function useGame({ auth, db, exerciseId, adminView }) {
  const [identity, setIdentity] = useState({ loading: true, uid: null });
  const [boot, setBoot] = useState(null);
  const [bootLoading, setBootLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [code, setCode] = useState("");

  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [player, setPlayer] = useState(null);
  const [roomLoaded, setRoomLoaded] = useState(false);
  const [playersLoaded, setPlayersLoaded] = useState(false);

  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState("");

  const pending = useRef(false);
  const generation = useRef(0);

  const callable = useMemo(() => httpsCallable(
    getFunctions(auth.app, "us-central1"),
    "historyGame",
    { timeout: 120000 }
  ), [auth]);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      generation.current += 1;
      pending.current = false;
      setBusy("");
      setBoot(null);
      setCode("");
      setError("");
      setSuccess("");
      setIdentity({ loading: false, uid: user?.uid || null });
    });
  }, [auth]);

  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setBusy("");
    setBoot(null);
    setCode("");
    setError("");
  }, [exerciseId]);

  useEffect(() => {
    if (!identity.uid || !exerciseId) return undefined;

    let active = true;
    setBootLoading(true);
    setError("");

    callable({ action: "boot", exerciseId })
      .then(({ data }) => {
        if (active) setBoot(data);
      })
      .catch((problem) => {
        if (!active) return;
        setBoot(null);
        setError(errorText(problem));
      })
      .finally(() => {
        if (active) setBootLoading(false);
      });

    return () => { active = false; };
  }, [identity.uid, exerciseId, callable, refresh]);

  useEffect(() => {
    setRoom(null);
    setPlayers([]);
    setPlayer(null);
    setRoomLoaded(false);
    setPlayersLoaded(false);
    setLiveError("");

    if (!code || !identity.uid || !boot) return undefined;
    if (adminView && !boot.teacher) return undefined;

    let active = true;

    const failed = (problem) => {
      if (active) setLiveError(errorText(problem));
    };

    const stopRoom = onSnapshot(
      doc(db, "hgRooms", code),
      (snapshot) => {
        if (!active) return;
        setRoomLoaded(true);

        if (!snapshot.exists()) {
          setLiveError("This session no longer exists.");
          return;
        }

        setRoom(snapshot.data());
      },
      failed
    );

    const stopPlayers = adminView
      ? onSnapshot(
        collection(db, "hgRooms", code, "players"),
        (snapshot) => {
          if (!active) return;

          setPlayers(snapshot.docs.map((item) => ({
            ...item.data(),
            uid: item.id,
          })).sort((a, b) =>
            String(a.studentName).localeCompare(String(b.studentName))
          ));

          setPlayersLoaded(true);
        },
        failed
      )
      : onSnapshot(
        doc(db, "hgRooms", code, "players", identity.uid),
        (snapshot) => {
          if (!active) return;

          setPlayer(snapshot.exists()
            ? { ...snapshot.data(), uid: snapshot.id }
            : null);

          setPlayersLoaded(true);
        },
        failed
      );

    return () => {
      active = false;
      stopRoom();
      stopPlayers();
    };
  }, [db, code, identity.uid, boot, adminView]);

  const act = useCallback(async (action, payload = {}, message = "") => {
    if (pending.current) return { ok: false };

    if (!identity.uid || auth.currentUser?.uid !== identity.uid) {
      setError("Your sign-in changed. Reopen this exercise.");
      return { ok: false };
    }

    const current = generation.current;
    pending.current = true;
    setBusy(action);
    setError("");
    setSuccess("");

    try {
      const response = await callable({
        ...payload,
        action,
        exerciseId,
      });

      if (current !== generation.current) return { ok: false };

      if (message) setSuccess(message);

      return { ok: true, data: response.data };
    } catch (problem) {
      if (current === generation.current) setError(errorText(problem));

      return {
        ok: false,
        errorCode: problem?.code || "",
      };
    } finally {
      if (current === generation.current) {
        pending.current = false;
        setBusy("");
      }
    }
  }, [auth, identity.uid, callable, exerciseId]);

  return {
    identity, boot, bootLoading, code, room, players, player,
    roomLoaded, playersLoaded, error, liveError, success, busy, act,

    open(nextCode) {
      setError("");
      setSuccess("");
      setCode(nextCode);
    },

    home() {
      setCode("");
      setSuccess("");
      setError("");
      setRefresh((value) => value + 1);
    },

    retry() {
      setRefresh((value) => value + 1);
    },
  };
}

/* ----------------------- News and financial panels ----------------------- */

function EventCards({ events = [] }) {
  return (
    <div className="hg-stack" style={{ gap: 12 }}>
      {events.map((event) => {
        const label = event.kind === "milestone"
          ? "Historical Milestone"
          : event.kind === "trend"
            ? "Historical Trend"
            : "Model Scenario";

        return (
          <article
            key={event.id}
            className="hg-panel"
            style={{
              padding: 16,
              borderColor: event.fixed ? "#b08a38" : "#dce2d8",
            }}
          >
            <div className="hg-badges" style={{ margin: "0 0 10px" }}>
              <span className={`hg-badge ${event.fixed ? "hg-milestone" : ""}`}>
                {label} — {event.fixed ? "Compulsory" : "Additional"}
              </span>

              {event.badges.map((badge) => (
                <span key={badge} className="hg-badge hg-topic-badge">
                  {badge}
                </span>
              ))}
            </div>

            <small className="hg-muted">{event.date}</small>
            <h3>{event.headline}</h3>
            <p style={{ marginBottom: 0 }}>{event.body}</p>

            <details style={{ marginTop: 8 }}>
              <summary>Fictional model adjustments</summary>
              <LedgerRows rows={[
                ["Opening shares", pct(event.effects.stockBps / 10000)],
                ["Opening property", pct(event.effects.propertyBps / 10000)],
                ["Domestic demand-forecast adjustment", signedCount(event.effects.domesticDelta)],
                ["Export demand-forecast adjustment", signedCount(event.effects.exportDelta)],
                ["Export unit-price adjustment", signed(event.effects.exportPriceDelta)],
              ]} />
              <small className="hg-muted">
                Zero means no separate adjustment through that channel.
                Loan and liquidity terms are shown in the current trading conditions.
              </small>
            </details>
          </article>
        );
      })}
    </div>
  );
}

function Paper({ article, report = false }) {
  if (!article) return null;

  const sources = (article.sources || [])
    .map((source) => ({ ...source, safe: safeUrl(source.url) }))
    .filter((source) => source.safe);

  return (
    <article className="hg-newspaper">
      <div className="hg-paper-topline">
        <span>Classroom simulation</span>
        <span>Japan • Business and economy</span>
      </div>

      <div className="hg-masthead">The Economic Chronicle</div>

      <div className="hg-paper-dateline">
        <span>{article.date}</span>
        <span>{report ? "Closing report" : "Decision briefing"}</span>
      </div>

      <h2 style={{ marginTop: 20 }}>{article.headline}</h2>
      <p className="hg-paper-story">{article.body}</p>

      {article.forecast && (
        <div className="hg-market-strip">
          <div>
            <small>Domestic demand forecast</small>
            <strong>{article.forecast.domestic.join("–")}</strong>
          </div>
          <div>
            <small>Export demand forecast</small>
            <strong>{article.forecast.export.join("–")}</strong>
          </div>
          <div>
            <small>Company interest / round</small>
            <strong>{pct(article.rate)}</strong>
          </div>
        </div>
      )}

      {report && (
        <div className="hg-market-strip">
          <div>
            <small>Opening share move — already applied</small>
            <strong>{pct(article.stockReturn)}</strong>
          </div>
          <div>
            <small>Opening property move — already applied</small>
            <strong>{pct(article.propertyReturn)}</strong>
          </div>
          <div>
            <small>Actual domestic / export demand</small>
            <strong>
              {article.domesticDemand} / {article.exportDemand}
            </strong>
          </div>
        </div>
      )}

      <EventCards events={article.events} />

      {sources.length > 0 && (
        <details className="hg-source-notes" style={{ marginTop: 16 }}>
          <summary>Historical sources</summary>
          <ul>
            {sources.map((source) => (
              <li key={source.safe}>
                <a href={source.safe} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
          <p>
            Historical sources support the context, not the fictional company
            returns or demand quantities.
          </p>
        </details>
      )}
    </article>
  );
}

function Metrics({ player, rules }) {
  const state = player.state;

  const metrics = [
    ["Cash", state.cash],
    ["Debt", state.debt],
    ["Share value", state.stocks + listedValue(state)],
    ["Property value", state.property],
    ["Net worth", equity(state, rules)],
    ["Factories", state.factories],
  ];

  return (
    <section>
      <div className="hg-metrics">
        {metrics.map(([label, value]) => (
          <div key={label} className="hg-metric">
            <small>{label}</small>
            <strong
              className={value < 0 ? "hg-negative" : ""}
              title={label === "Factories" ? undefined : formatYenExact(value)}
            >
              {label === "Factories" ? count(value) : money(value)}
            </strong>
          </div>
        ))}
      </div>

      <p className="hg-muted" style={{ margin: "10px 0 0" }}>
        Fictional company accounts expressed in yen.
        M = million yen; B = billion yen.
        Inventory: {count(state.inventory)} goods.
        Model company positions:{" "}
        {state.suspended ? 0 : state.factories * rules.workersPerFactory}.
        Positions leaving this company are not a national unemployment statistic.
      </p>
    </section>
  );
}

function TradingTerms({ room, player }) {
  const rules = room.rules;
  const state = player.state;

  return (
    <section className="hg-panel">
      <span className="hg-eyebrow">Known before your decision</span>
      <h2>Current trading conditions</h2>

      <LedgerRows rows={[
        ["Current collateral-based debt ceiling", money(creditLimit(state, rules))],
        ["Maximum new borrowing this round", money(rules.maxNewDebt)],
        ["Company interest charge / round", pct(room.brief.rate)],
        ["Scheduled principal fraction", pct(rules.principalRate)],
        ["Property eligible for voluntary sale", pct(rules.propertySaleFraction)],
        ["Cash received relative to property value sold", pct(rules.propertyBid)],
        ["Domestic / export selling price per unit", `${money(rules.domesticPrice)} / ${money(rules.exportPrice)}`],
        ["Production cost per unit", money(rules.unitCost)],
        ["Factory overhead per round", money(rules.factoryOverhead)],
        ["Share / property income per round", `${pct(rules.stockYield)} / ${pct(rules.propertyYield)}`],
      ]} />

      <Notice>
        Principal requested at settlement is the larger of the scheduled
        fraction or the amount above the collateral ceiling, capped at your
        debt. This assessment happens once, after your planned trades.
        Emergency sales can leave further collateral pressure for a later round.
      </Notice>

      <p className="hg-muted">
        New borrowing is also checked against the collateral left after your
        proposed trades. Selling property reduces its book value by the amount
        entered, but may produce less cash because of the displayed bid.
      </p>

      <Notice type="warning">
        Asset prices can fall. Debt remains repayable. Forecast demand is not
        guaranteed revenue, and property is not always readily convertible to cash.
      </Notice>

      {room.brief.warnings.highRate && (
        <p className="hg-negative">Visible warning: borrowing costs are elevated.</p>
      )}
      {room.brief.warnings.weakDemand && (
        <p className="hg-negative">Visible warning: check demand and inventory before expansion.</p>
      )}
      {room.brief.warnings.trade && (
        <p className="hg-negative">Visible warning: export opportunities face a constraint.</p>
      )}
    </section>
  );
}

function OpeningNotice({ player }) {
  if (!player.opening || player.state.suspended) return null;

  return (
    <Notice>
      <strong>Already applied at this round’s opening:</strong>
      {" "}shares {signed(player.opening.stockChange)};
      {" "}property {signed(player.opening.propertyChange)}.
      These changes affected the holdings carried into the round.
      They will not be applied again when your decision settles.
    </Notice>
  );
}

function DecisionSummary({ decision, advice = null }) {
  if (!decision) {
    return <p className="hg-muted">No submitted decision.</p>;
  }

  const marketing = {
    balanced: "Follow management's recommendation",
    domestic: "Prioritise domestic customers",
    export: "Prioritise export opportunities",
  };

  return (
    <>
      {advice && (
        <p className="hg-muted">
          The student selected investments, financing and broad company advice.
          Production and the exact goods allocation were calculated by management.
          Marketing advice: {marketing[advice.marketing] || advice.marketing}.
        </p>
      )}

      <LedgerRows rows={[
        ["Borrow / repay", signed(decision.debt)],
        ["Buy / sell shares", signed(decision.stocks)],
        ["Buy / sell property book value", signed(decision.property)],
        ["Factory change", signedCount(decision.factories)],
        [
          advice ? "Management: new production" : "New production",
          count(decision.production),
        ],
        [
          advice ? "Management: export allocation" : "Export allocation",
          `${decision.exports}%`,
        ],
      ]} />
    </>
  );
}

function ResultLedger({ entry, rules }) {
  if (!entry) return null;

  if (entry.economyVersion === 2) {
    return <EconomicRound entry={entry} />;
  }

  const m = entry.metrics;

  return (
    <section className="hg-panel">
      <span className="hg-eyebrow">Actual company record</span>
      <h2>Round {entry.round + 1}: {entry.date}</h2>

      {entry.defaulted && (
        <Notice type="warning">
          {entry.advisor
            ? "No investment instructions were submitted. Management followed the neutral operating plan as funds allowed, without new investments, borrowing or factory changes. Existing obligations still applied."
            : "No decision was submitted. The teacher applied the default: no new trades, borrowing or production, with existing goods allocated domestically. Existing obligations still applied."}
        </Notice>
      )}

      {entry.inactive && (
        <Notice>
          This company was already suspended. Its balances remained frozen
          under this classroom model.
        </Notice>
      )}

      <LedgerRows rows={[
        ["Opening share-value change — already applied", signed(m.stockChange)],
        ["Opening property-value change — already applied", signed(m.propertyChange)],
        ["Sales revenue", money(m.revenue)],
        ["Share income", money(m.stockIncome)],
        ["Property income", money(m.propertyIncome)],
        ["Production spending", money(m.productionCost)],
        ["Factory overhead", money(m.overhead)],
        ["Interest", money(m.interest)],
        ["Storage", money(m.storage)],
        ["Principal requested, before any arrears", money(m.principalDue)],
        ["Voluntary-sale discount loss", money(m.voluntaryLoss)],
        ["Emergency-sale discount loss", money(m.forcedLoss)],
        ["Unpaid cash shortfall added to debt", money(m.arrears)],
        ["Units sold: domestic / export", `${m.soldDomestic} / ${m.soldExport}`],
        ["Unsold units", count(m.unsold)],
        ["Closing cash", money(entry.after.cash)],
        ["Closing debt", money(entry.after.debt)],
        ["Closing net worth", money(equity(entry.after, rules))],
      ]} />

      <details>
        <summary>Recorded instructions and management plan</summary>
        <DecisionSummary
          decision={entry.decision}
          advice={entry.advisor?.advice || null}
        />
      </details>

      {entry.liquidations?.length > 0 && (
        <details>
          <summary>Emergency-sale details</summary>
          <ul>
            {entry.liquidations.map((sale, index) => (
              <li key={index}>
                {sale.asset}: book value {money(sale.bookValue)},
                cash received {money(sale.proceeds)}.
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function History({ player, room }) {
  if (!player.history?.length) return null;

  return (
    <section className="hg-panel">
      <h2>Company history</h2>

      <div className="hg-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Round</th><th>Date</th><th>Cash</th><th>Debt</th><th>Net worth</th>
            </tr>
          </thead>
          <tbody>
            {player.history.map((entry) => (
              <tr key={entry.round}>
                <td>{entry.round + 1}</td>
                <td>{entry.date}</td>
                <td>{money(entry.after.cash)}</td>
                <td>{money(entry.after.debt)}</td>
                <td>{money(equity(entry.after, room.rules))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary>Inspect earlier decisions and briefings</summary>
        {player.history.map((entry) => (
          <details key={entry.round}>
            <summary>Round {entry.round + 1} — {entry.date}</summary>
            <div className="hg-stack">
              <ResultLedger entry={entry} rules={entry.information.rules} />
              <Paper
                article={
                  room.briefHistory?.find(
                    (article) => article.index === entry.round
                  ) || entry.information
                }
              />
            </div>
          </details>
        ))}
      </details>
    </section>
  );
}

function MarketHistory({ room }) {
  if (!room.marketHistory?.length) return null;

  return (
    <section className="hg-panel">
      <details>
        <summary>Shared market history</summary>
        <p className="hg-muted">
          Fictional price indexes starting at 100—not the actual Nikkei or a
          historical land-price series. These are shared market prices, not
          your personal portfolio returns.
        </p>
        <div className="hg-table-wrap">
          <table>
            <thead>
              <tr><th>Period</th><th>Shares</th><th>Property</th></tr>
            </thead>
            <tbody>
              {room.marketHistory.map((row) => (
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
  );
}

/* ----------------------- Decision planning ----------------------- */

function previewDecision(state, draft, rules, rate) {
  const decision = {};
  const problems = [];

  for (const key of Object.keys(EMPTY)) {
    if (
      draft[key] === "" ||
      !Number.isSafeInteger(Number(draft[key]))
    ) {
      return { valid: false, problems: ["Complete all fields using whole numbers."] };
    }

    decision[key] = Number(draft[key]);
  }

  const factories = state.factories + decision.factories;

  if (![-1, 0, 1].includes(decision.factories) ||
    factories < 1 || factories > rules.maxFactories) {
    problems.push(`Keep between 1 and ${rules.maxFactories} factories.`);
  }

  if (
    decision.debt < -state.debt ||
    decision.debt > rules.maxNewDebt ||
    state.debt + decision.debt > rules.maxDebt
  ) {
    problems.push("Borrowing or repayment exceeds its limit.");
  }

  if (
    decision.stocks < -state.stocks ||
    decision.stocks > rules.maxInvestmentPurchase
  ) {
    problems.push("The share trade exceeds your holdings or purchase limit.");
  }

  if (
    decision.property < -Math.floor(state.property * rules.propertySaleFraction) ||
    decision.property > rules.maxInvestmentPurchase
  ) {
    problems.push("The property trade exceeds the current sale or purchase limit.");
  }

  if (
    decision.production < 0 ||
    decision.production > factories * rules.factoryCapacity
  ) {
    problems.push("Production exceeds your planned capacity.");
  }

  if (![0, 25, 50, 75, 100].includes(decision.exports)) {
    problems.push("Choose an available export allocation.");
  }

  const propertyCost = decision.property >= 0
    ? decision.property
    : -Math.floor(-decision.property * rules.propertyBid);

  const factoryCost = decision.factories *
    (decision.factories >= 0 ? rules.factoryPrice : rules.factoryResale);

  const proposed = {
    ...state,
    cash: state.cash + decision.debt - decision.stocks - propertyCost - factoryCost,
    debt: state.debt + decision.debt,
    stocks: state.stocks + decision.stocks,
    property: state.property + decision.property,
    factories,
  };

  const limit = creditLimit(proposed, rules);

  if (decision.debt > 0 && proposed.debt > limit) {
    problems.push("Proposed borrowing exceeds the collateral-based ceiling.");
  }

  const cashAfterProduction = proposed.cash - decision.production * rules.unitCost;

  if (cashAfterProduction < 0) {
    problems.push("These purchases and production are unaffordable.");
  }

  const interest = Math.ceil(proposed.debt * rate);
  const principal = principalDue(proposed, rules);
  const overhead = proposed.factories * rules.factoryOverhead;
  const available = state.inventory + decision.production;

  return {
    valid: problems.length === 0,
    problems,
    decision,
    proposed,
    limit,
    cashAfterProduction,
    interest,
    principal,
    overhead,
    noSalesCash:
      cashAfterProduction - interest - principal - overhead -
      available * rules.storagePerUnit,
  };
}

function DecisionForm({ room, player, game }) {
  const [draft, setDraft] = useState(() => ({
    ...(player.decision || EMPTY),
  }));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (player.ready && player.decision) {
      setDraft({ ...player.decision });
      setDirty(false);
    }
  }, [player.submittedAt, player.ready, player.decision]);

  const rules = room.rules;
  const state = player.state;

  const preview = useMemo(
    () => previewDecision(state, draft, rules, room.brief.rate),
    [state, draft, rules, room.brief.rate]
  );

  const disabled = Boolean(game.busy) || room.paused || state.suspended;

  function change(key, value) {
    setDirty(true);
    setDraft((previous) => ({ ...previous, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!preview.valid || disabled) return;

    const result = await game.act("submit", {
      code: room.code,
      round: room.round,
      decision: preview.decision,
    }, "Decision saved on the server.");

    if (result.ok) setDirty(false);
  }

  const inputs = [
    {
      key: "debt",
      label: "Borrow / repay",
      min: -state.debt,
      max: Math.max(0, Math.min(rules.maxNewDebt, rules.maxDebt - state.debt)),
      help: "Positive borrows; negative repays. Collateral is also checked.",
    },
    {
      key: "stocks",
      label: "Buy / sell shares",
      min: -state.stocks,
      max: rules.maxInvestmentPurchase,
      help: `Current share value: ${money(state.stocks)}.`,
    },
    {
      key: "property",
      label: "Buy / sell property book value",
      min: -Math.floor(state.property * rules.propertySaleFraction),
      max: rules.maxInvestmentPurchase,
      help:
        `You may sell up to ${money(Math.floor(state.property * rules.propertySaleFraction))} ` +
        `of book value, receiving ${pct(rules.propertyBid)} of that amount in cash.`,
    },
    {
      key: "production",
      label: "Produce new goods",
      min: 0,
      max: Math.max(0,
        (state.factories + Number(draft.factories || 0)) * rules.factoryCapacity
      ),
      help: `Existing inventory: ${state.inventory}. Cost per new unit: ${rules.unitCost}.`,
    },
  ];

  return (
    <section className="hg-panel">
      <span className="hg-eyebrow">Boardroom</span>
      <h2>Your decision</h2>
      <p className="hg-muted">
        This older session uses manual inputs in units of ¥10,000.
        Positive trade amounts buy; negative amounts sell.
        Displayed financial totals are formatted in yen.
        Editing is not saving: press Submit to record your plan.
      </p>

      {room.paused && <Notice type="warning">Submissions are paused.</Notice>}

      {player.ready && (
        <Notice type="success">
          A decision is submitted. You may replace it while the round is open.
          {dirty && " Your current edits are not yet submitted."}
        </Notice>
      )}

      <form onSubmit={submit}>
        <fieldset disabled={disabled}>
          <div className="hg-form-grid">
            {inputs.map((input) => (
              <Field key={input.key} label={input.label} help={input.help}>
                <input
                  required
                  type="number"
                  step={1}
                  min={input.min}
                  max={input.max}
                  value={draft[input.key]}
                  onChange={(event) => change(input.key, event.target.value)}
                />
              </Field>
            ))}

            <Field
              label="Factory investment"
              help={`Buy: ${rules.factoryPrice}; voluntary sale: ${rules.factoryResale}.`}
            >
              <select
                value={draft.factories}
                onChange={(event) => change("factories", Number(event.target.value))}
              >
                <option value={-1} disabled={state.factories <= 1}>Sell one factory</option>
                <option value={0}>Keep current factories</option>
                <option value={1} disabled={state.factories >= rules.maxFactories}>
                  Buy one factory
                </option>
              </select>
            </Field>

            <Field label="Export allocation" help="Applies to inventory plus new production.">
              <select
                value={draft.exports}
                onChange={(event) => change("exports", Number(event.target.value))}
              >
                {[0, 25, 50, 75, 100].map((value) => (
                  <option key={value} value={value}>
                    {value}% exports / {100 - value}% domestic
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {preview.problems.length > 0 && (
            <Notice type="warning">
              <ul style={{ marginBottom: 0 }}>
                {preview.problems.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            </Notice>
          )}

          {preview.proposed && (
            <div className="hg-budget" aria-live="polite">
              <LedgerRows rows={[
                ["Cash after trades and production", money(preview.cashAfterProduction)],
                ["Planned debt", money(preview.proposed.debt)],
                ["Post-trade collateral ceiling", money(preview.limit)],
                ["Interest", money(preview.interest)],
                ["Principal requested", money(preview.principal)],
                ["Factory overhead", money(preview.overhead)],
                ["Conservative no-sales cash", money(preview.noSalesCash)],
              ]} />

              <small>
                The stress test assumes no sales or investment income and
                storage of every available unit. It is a warning, not a prediction.
                Actual receipts and emergency sales are settled by the server.
              </small>

              {preview.noSalesCash < 0 && (
                <p className="hg-negative" style={{ margin: "10px 0 0" }}>
                  This plan depends on incoming receipts to cover all commitments.
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            className="hg-primary hg-full"
            disabled={disabled || !preview.valid}
          >
            {game.busy === "submit"
              ? "Saving…"
              : player.ready ? "Replace submitted decision" : "Submit decision"}
          </button>
        </fieldset>
      </form>
    </section>
  );
}

/* ----------------------- Review and reflection ----------------------- */

function ReviewCards({ review = [] }) {
  return (
    <div className="hg-review-list">
      {review.map((item, index) => (
        <article key={item.key} className="hg-review-card">
          <div className="hg-review-number">{index + 1}</div>
          <div>
            <span className="hg-eyebrow">{item.tag}</span>
            <h3>{item.title}</h3>
            <p>{item.lesson}</p>

            {item.evidence?.length > 0 && (
              <details>
                <summary>Evidence from your company record</summary>
                {item.evidence.map((evidence, i) => (
                  <div className="hg-comparison" key={`${evidence.round}-${i}`}>
                    <strong>Round {evidence.round + 1} — {evidence.date}</strong>
                    <p><strong>Decision:</strong> {evidence.decision}</p>
                    <p><strong>Information available:</strong> {evidence.known}</p>
                    <p><strong>Recorded outcome:</strong> {evidence.outcome}</p>
                  </div>
                ))}
              </details>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function Reflection({ room, player, game }) {
  const review = player.review || [];
  const [topic, setTopic] = useState(
    player.reflection?.reviewKey || review[0]?.key || ""
  );
  const [answer, setAnswer] = useState(player.reflection?.text || "");

  async function save(event) {
    event.preventDefault();

    await game.act("reflect", {
      code: room.code,
      reviewKey: topic,
      text: answer.trim(),
    }, "Final reflection saved.");
  }

  return (
    <section className="hg-panel">
      <span className="hg-eyebrow">One final reflection</span>
      <h2>Explain your most important decision</h2>

      <p>Choose one important investment decision to explain.</p>

      <ReviewCards review={review} />

      {review.length > 0 ? (
        <form onSubmit={save}>
          <fieldset disabled={Boolean(game.busy)}>
            <Field label="Choose one review topic">
              <select value={topic} onChange={(event) => setTopic(event.target.value)}>
                {review.map((item) => (
                  <option key={item.key} value={item.key}>{item.title}</option>
                ))}
              </select>
            </Field>

            <p className="hg-prompt">
              Choose the decision you would most want to change. Explain how it
              interacted with one historical factor, and what you would do differently
              using the information available then. If no major mistake was identified,
              explain a decision you would retain or improve.
            </p>

            <Field label="Your response" help="Suggested length: 2–3 sentences.">
              <textarea
                required
                minLength={20}
                maxLength={1800}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
              />
            </Field>

            <p className="hg-muted">{answer.trim().length} / 1,800 characters</p>

            <button
              className="hg-primary"
              type="submit"
              disabled={Boolean(game.busy) || answer.trim().length < 20 || !topic}
            >
              {game.busy === "reflect" ? "Saving…" : "Save reflection"}
            </button>
          </fieldset>
        </form>
      ) : (
        <Notice type="warning">The server has not supplied a review yet.</Notice>
      )}

      {player.reflection && (
        <Notice type="success">
          A reflection is saved. Editing and resaving it clears feedback on
          its previous version.
        </Notice>
      )}

      {player.feedback?.reviewed && (
        <div className="hg-teacher-feedback">
          <strong>Teacher feedback</strong>
          <p>{player.feedback.text || "Your teacher has reviewed this answer."}</p>
        </div>
      )}
    </section>
  );
}

function Feedback({ room, player, game }) {
  const [text, setText] = useState(player.feedback?.text || "");

  async function save(event) {
    event.preventDefault();

    await game.act("feedback", {
      code: room.code,
      targetUid: player.uid,
      reflectionSavedAt: player.reflection.savedAt,
      text: text.trim(),
    }, "Feedback saved.");
  }

  return (
    <form onSubmit={save}>
      <fieldset disabled={Boolean(game.busy)}>
        <Field label="Teacher feedback" help="An empty comment can still mark the answer reviewed.">
          <textarea
            maxLength={1000}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <button type="submit" className="hg-primary">Save and mark reviewed</button>
      </fieldset>
    </form>
  );
}

/* ----------------------- Teacher event planner ----------------------- */

function EventPlanner({ room, game }) {
  const [options, setOptions] = useState(null);
  const [settings, setSettings] = useState(null);

  const target = room.phase === "lobby" ? 0 : room.round + 1;

  async function load() {
    const result = await game.act("events", {
      code: room.code,
      targetRound: target,
    });

    if (result.ok) {
      setOptions(result.data);
      setSettings(result.data.config);
    }
  }

  async function save(event) {
    event.preventDefault();

    const result = await game.act("configure", {
      code: room.code,
      targetRound: target,
      revision: options.revision,
      settings,
    }, "Event plan saved for the next opening.");

    if (result.ok) {
      setOptions(result.data);
      setSettings(result.data.config);
    }
  }

  function toggle(id, checked) {
    setSettings((previous) => ({
      ...previous,
      pinned: checked
        ? [...previous.pinned, id]
        : previous.pinned.filter((value) => value !== id),
    }));
  }

  return (
    <section className="hg-panel">
      <span className="hg-eyebrow">Teacher-only planning</span>
      <h2>Events for the next round</h2>

      <p className="hg-muted">
        Every round has 1–3 events in total. Compulsory events occupy slots.
        Additional events are shared by the entire class and cannot be changed
        after the round opens.
      </p>

      <button type="button" onClick={load} disabled={Boolean(game.busy)}>
        {options ? "Reload saved event plan" : "Load event options"}
      </button>

      {options && settings && (
        <form onSubmit={save} style={{ marginTop: 20 }}>
          <fieldset disabled={Boolean(game.busy)}>
            <h3>Round {target + 1} — {options.date}</h3>

            <div className="hg-form-grid">
              <Field label="Total events, including compulsory events">
                <select
                  value={settings.count}
                  onChange={(event) => setSettings({
                    ...settings,
                    count: Number(event.target.value),
                  })}
                >
                  <option value={0}>Automatic total within the 1–3 limit</option>
                  {[1, 2, 3].map((count) => (
                    <option
                      key={count}
                      value={count}
                      disabled={count < options.minimum}
                    >
                      {count} event{count === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Automatically fill remaining slots with">
                <select
                  value={settings.mode}
                  onChange={(event) => setSettings({
                    ...settings,
                    mode: event.target.value,
                  })}
                >
                  <option value="mixed">Mixed random events</option>
                  <option value="good">Good / limited-relief events</option>
                  <option value="bad">Bad events</option>
                </select>
              </Field>
            </div>

            <h3>Compulsory — cannot be removed</h3>
            <ul>
              {options.fixed.map((event) => (
                <li key={event.id}>{event.headline}</li>
              ))}
            </ul>

            <h3>Optional hand-picked events</h3>
            <p className="hg-muted">
              Leave these unchecked for automatic selection. Hand-picked
              events occupy the remaining slots before automatic filling.
            </p>

            {options.optional.map((event) => (
              <label className="hg-checkbox" key={event.id}>
                <input
                  type="checkbox"
                  checked={settings.pinned.includes(event.id)}
                  onChange={(change) => toggle(event.id, change.target.checked)}
                />
                <span>{event.headline} — {event.tone}</span>
              </label>
            ))}

            <button type="submit" className="hg-primary">
              Save event plan
            </button>
          </fieldset>

          <details style={{ marginTop: 16 }}>
            <summary>Saved/default selection preview</summary>
            <p className="hg-muted">
              This preview updates after saving. Reloading does not reroll the
              random draw. New sessions receive a different private random seed.
            </p>
            <EventCards events={options.preview} />
          </details>
        </form>
      )}

      <Notice>
        During the downturn, “good” means limited relief—not a return to ordinary
        boom events. It cannot remove the compulsory crash or property downturn.
        If you do not configure anything, the server uses its default mixed selection.
      </Notice>
    </section>
  );
}

/* ----------------------- Home screen ----------------------- */

function Home({ game, adminView }) {
  const [title, setTitle] = useState("Japan: corporate investment desk");
  const [maximum, setMaximum] = useState(40);
  const [limit, setLimit] = useState(3);
  const [code, setCode] = useState("");
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("electronics");
  const [localError, setLocalError] = useState("");
  const createRequest = useRef(null);

  async function create(event) {
    event.preventDefault();
    setLocalError("");

    if (
      game.boot.resilienceVersion !== 2 ||
      game.boot.dealingVersion !== 1 ||
      game.boot.lessonVersion !== 4 ||
      game.boot.missionVersion !== 2 ||
      game.boot.performanceVersion !== 1
    ) {
      setLocalError(
        "The Investor R6 backend is not connected yet. Deploy historyGame and refresh this page."
      );
      return;
    }

    if (!globalThis.crypto?.randomUUID) {
      setLocalError("Use a modern browser on HTTPS or localhost.");
      return;
    }

    if (!createRequest.current) {
      createRequest.current = {
        requestId: crypto.randomUUID(),
        gameplayVersion: 6,
        title: title.trim(),
        maxPlayers: Number(maximum),
        reflectionLimit: Number(limit),
      };
    }

    const result = await game.act("create", createRequest.current);

    if (result.ok) {
      createRequest.current = null;
      game.open(result.data.code);
    }
  }

  async function join(event) {
    event.preventDefault();

    const result = await game.act("join", {
      code: code.trim().toUpperCase(),
      company: company.trim(),
      industry,
    });

    if (result.ok) game.open(result.data.code);
  }

  const rooms = (game.boot.rooms || []).filter(
    (item) => item.kind === (adminView ? "owner" : "player")
  );

  return (
    <div className="hg-stack">
      <section className="hg-hero">
        <div>
          <span className="hg-eyebrow">The History Archive • Company simulation</span>
          <h1>Japan<br />The investment years</h1>
          <p>
            Manage cash, borrowing, investments and production.
            Read the news, submit decisions and explain the consequences.
          </p>
        </div>
        <div className="hg-hero-seal" aria-hidden="true">
          <span>Company</span><strong>日本</strong><span>Simulation</span>
        </div>
      </section>

      <div className="hg-home-grid">
        <section className="hg-panel">
          <h2>{adminView ? "Create a classroom session" : "Join your class"}</h2>
          {localError && <Notice type="error">{localError}</Notice>}

          {adminView ? (
            <form onSubmit={create}>
              <fieldset disabled={Boolean(game.busy)}>
                <Field label="Session title">
                  <input
                    required minLength={2} maxLength={80}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </Field>

                <div className="hg-form-grid">
                  <Field label="Maximum students">
                    <input
                      required type="number" min={1} max={60} step={1}
                      value={maximum}
                      onChange={(event) => setMaximum(event.target.value)}
                    />
                  </Field>
                  <Field label="Maximum final review cards">
                    <select value={limit} onChange={(event) => setLimit(event.target.value)}>
                      {[1, 2, 3].map((n) => <option value={n} key={n}>{n}</option>)}
                    </select>
                  </Field>
                </div>

                <button className="hg-primary hg-full" type="submit">
                  {game.busy === "create"
                    ? "Creating…"
                    : "Create Japan — 8 rounds + investor goals"}
                </button>
              </fieldset>
            </form>
          ) : (
            <form onSubmit={join}>
              <fieldset disabled={Boolean(game.busy)}>
                <Field label="Teacher's session code">
                  <input
                    required minLength={8} maxLength={8}
                    className="hg-code-input"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase())}
                  />
                </Field>
                <Field label="Company name">
                  <input
                    required minLength={2} maxLength={40}
                    value={company}
                    onChange={(event) => setCompany(event.target.value)}
                  />
                </Field>

                <Field
                  label="Company industry"
                  help={INDUSTRIES[industry].description}
                >
                  <select
                    value={industry}
                    onChange={(event) => setIndustry(event.target.value)}
                  >
                    {Object.entries(INDUSTRIES).map(([id, profile]) => (
                      <option key={id} value={id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <p className="hg-muted">
                  Industry choice applies to new Resilience R2 sessions.
                  Each industry begins with ¥200M of net worth, but a different
                  mix of cash and factory assets. The choice is locked when
                  the company joins.
                </p>

                <button className="hg-primary hg-full" type="submit">
                  {game.busy === "join" ? "Joining…" : "Join classroom"}
                </button>
              </fieldset>
            </form>
          )}

          <Notice>
            Students join before the teacher starts. Rounds have no written
            quizzes or reflections. There is one short reflection at the end.
          </Notice>

          {adminView && (
            <p className="hg-muted">
              Japan engine version {game.boot.engineVersion} is connected.
              Older American test sessions are not resumed or converted.
              Their records have not been deleted.
            </p>
          )}
        </section>

        <section className="hg-panel">
          <h2>Continue a session</h2>
          <div className="hg-session-list">
            {rooms.length === 0 && <p className="hg-muted">No sessions for this exercise yet.</p>}
            {rooms.map((item) => (
              <button
                type="button"
                className="hg-session-link"
                key={item.code}
                disabled={Boolean(game.busy)}
                onClick={() => game.open(item.code)}
              >
                <span><strong>{item.title}</strong><small>{item.code}</small></span>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>

          <h3>Round sequence</h3>
          <ol>
            <li>Shared news revalues existing investments.</li>
            <li>Read forecasts and current trading terms.</li>
            <li>Submit your company decision.</li>
            <li>The teacher settles everyone together.</li>
          </ol>

          <p className="hg-muted">
            This version models a company-level financial cascade.
            Students’ orders do not themselves move the class’s market prices.
            Exports are pooled rather than separate car and electronics businesses.
          </p>
        </section>
      </div>
    </div>
  );
}

/* ----------------------- Student view ----------------------- */

function Student({ room, player, game }) {
  const latest = player.history?.[player.history.length - 1];

  return (
    <div className="hg-stack">
      <section className="hg-company-banner">
        <div>
          <span className="hg-eyebrow">Company investment desk</span>
          <h1>{player.company}</h1>
          <p>{player.studentName}</p>
        </div>
        <span className="hg-status-pill">
          {room.phase === "lobby"
            ? "Waiting for teacher"
            : `Round ${room.round + 1} / ${room.totalRounds}`}
        </span>
      </section>

      <Metrics player={player} rules={room.rules} />

      {room.phase === "lobby" && (
        <section className="hg-panel hg-welcome">
          <h2>Your company has joined</h2>
          <p>Keep this page open. Your teacher will open the first round.</p>
        </section>
      )}

      {player.state.suspended && (
        <Notice type="warning">
          <strong>Operations are suspended.</strong> You can continue observing,
          inspect the company record and complete the final reflection.
          The model freezes this company’s balances; this is not a legal
          determination of bankruptcy.
        </Notice>
      )}

      {room.phase === "decision" && (
        <>
          <OpeningNotice player={player} />
          <div className="hg-play-grid">
            <Paper article={room.brief} />
            <div className="hg-stack">
              {!player.state.suspended && (
                <DecisionForm
                  key={`${room.code}:${room.round}:${player.uid}`}
                  room={room}
                  player={player}
                  game={game}
                />
              )}
              <TradingTerms room={room} player={player} />
            </div>
          </div>
        </>
      )}

      {(room.phase === "results" || room.phase === "finished") && (
        <div className="hg-play-grid">
          <Paper article={room.report} report />
          <ResultLedger entry={latest} rules={room.rules} />
        </div>
      )}

      {room.phase === "results" && (
        <Notice>Wait for your teacher to open the next round.</Notice>
      )}

      {room.phase === "finished" && (
        <Reflection room={room} player={player} game={game} />
      )}

      <MarketHistory room={room} />
      <History room={room} player={player} />
    </div>
  );
}

/* ----------------------- Teacher view ----------------------- */

function Teacher({ room, game }) {
  const [selectedUid, setSelectedUid] = useState("");

  const clock = useDealingClock(
    room.dealing,
    game.marketFeed.offset
  );

  const players = game.players.map((item) => ({
    ...item,
    state: item.state.suspended
      ? item.state
      : markListed(item.state, room.dealing?.prices),
  }));
  const operating = players.filter((item) => !item.state.suspended);

  const active = operating.filter(
    (item) => !item.board?.dismissed
  );
  const ready = active.filter((item) => item.ready).length;
  const missing = active.length - ready;
  const selected = players.find((item) => item.uid === selectedUid);

  function control(action, extra = {}) {
    return game.act(action, {
      code: room.code,
      round: room.round,
      planRevision: room.planRevision,
      ...extra,
    });
  }

  async function resolve() {
    if (
      missing > 0 &&
      !window.confirm(
        `${missing} active student(s) have not submitted.\n\n` +
        "Settle with a no-new-action default for them?\n" +
        "Existing bills and holdings will still be processed."
      )
    ) return;

    await control("resolve", { force: missing > 0 });
  }

  return (
    <div className="hg-stack">
      <section className="hg-panel">
        <div className="hg-section-heading">
          <div>
            <span className="hg-eyebrow">Teacher control room</span>
            <h2>{room.title}</h2>
          </div>
          <div className="hg-code-box">
            <small>SESSION CODE</small><strong>{room.code}</strong>
          </div>
        </div>

        <div className="hg-mini-metrics">
          <div><small>Joined</small><strong>{players.length} / {room.maxPlayers}</strong></div>
          <div><small>Operating companies</small><strong>{operating.length}</strong></div>
          <div>
            <small>Stage</small>
            <strong>
              {room.phase === "lobby" ? "Lobby" : `${room.round + 1} / ${room.totalRounds}`}
            </strong>
          </div>
        </div>

        {room.phase === "decision" && (
          <>
            <div className="hg-progress-label">
              <span>Active companies submitted</span><strong>{ready} / {active.length}</strong>
            </div>
            <progress
              className="hg-progress"
              max={Math.max(1, active.length)}
              value={ready}
              aria-label="Active companies with submitted decisions"
            />
          </>
        )}

        {[1, 2].includes(room.missionVersion) && room.round === 0 && (
          <Notice>
            Round 1 is practice and has no board warning.
            Let students finish the quick guide before opening the market.
            Practice trades, money and investment results carry forward.
          </Notice>
        )}

        {room.performanceVersion === 1 ? (
          <details>
            <summary>Investor-target and ranking rules</summary>
            <p className="hg-muted">
              Investor performance is the company's gain above a matching
              company that makes no discretionary investments. Both use
              the same industry and the same economic and demand outcomes.
              Ordinary management earnings are not investor points.
            </p>
            <p className="hg-muted">
              Three missed reviews replace the adviser. Up to two reviews
              may be deferred while an eligible improvement project is
              unfinished. The project cost remains part of the investment
              result. Crisis tolerance applies only to the crisis review.
            </p>
            <p className="hg-muted">
              The final company ranking includes later results under
              management if an adviser was replaced; those results are
              identified separately. A closed company's assessment freezes
              at closure. Financial survival and investor performance are
              separate measures.
            </p>
          </details>
        ) : room.missionVersion === 1 ? (
          <details>
            <summary>Older-session board rules</summary>
            <p className="hg-muted">
              This preserved session uses the earlier company-value score
              and five-warning limit.
            </p>
          </details>
        ) : null}

        {room.dealingVersion === 1 && (
          <DealingTeacher room={room} game={game} />
        )}
        <div className="hg-actions">
          {room.phase === "lobby" && (
            <button
              className="hg-primary"
              type="button"
              disabled={Boolean(game.busy) || players.length === 0}
              onClick={() => control("start")}
            >
              Open first round
            </button>
          )}

          {room.phase === "decision" && (
            <>
              {room.dealingVersion !== 1 && (
                <button
                  type="button"
                  disabled={Boolean(game.busy)}
                  onClick={() => control("pause", { paused: !room.paused })}
                >
                  {room.paused ? "Resume submissions" : "Pause submissions"}
                </button>
              )}

              <button
                className="hg-primary"
                type="button"
                disabled={
                  Boolean(game.busy) ||
                  room.paused ||
                  (
                    room.dealingVersion === 1 &&
                    clock.stage !== "closed"
                  )
                }
                onClick={resolve}
              >
                {missing
                  ? `Settle with ${missing} missing plans`
                  : "Settle round for everyone"}
              </button>
            </>
          )}

          {room.phase === "results" && (
            <button
              className="hg-primary"
              type="button"
              disabled={Boolean(game.busy)}
              onClick={() => control("next")}
            >
              Open next round
            </button>
          )}
        </div>

        {room.phase === "lobby" && (
          <Notice>Share the code. Admission closes when you open the first round.</Notice>
        )}
        {room.paused && <Notice type="warning">Submissions are paused.</Notice>}
        {room.phase === "finished" && (
          <Notice type="success">
            The game has finished. Inspect companies to review students’ final reflections.
          </Notice>
        )}

        <details>
          <summary>Session limitations</summary>
          <p className="hg-muted">
            This version has no reset, rewind, deletion or late-join action.
            Create a new session for another run. Do not use the standard
            exercise runner’s reset tools for this game.
          </p>
        </details>
      </section>

      {(room.phase === "lobby" || room.phase === "results") && (
        <EventPlanner
          key={`${room.code}:${room.phase === "lobby" ? 0 : room.round + 1}`}
          room={room}
          game={game}
        />
      )}

      {room.phase !== "lobby" && (
        <Paper
          article={room.phase === "decision" ? room.brief : room.report}
          report={room.phase !== "decision"}
        />
      )}

      {room.phase === "finished" && (
        <InvestmentLeaderboard ranking={room.finalRanking} />
      )}

      <section className="hg-panel">
        <h2>Class companies</h2>
        <p className="hg-muted">
          Private teacher monitoring—not a student leaderboard.
          Company inspection is read-only and does not impersonate the student.
        </p>

        <div className="hg-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Student / company</th><th>Status</th><th>Cash</th>
                <th>Debt</th><th>Net worth</th><th>Inspect</th>
              </tr>
            </thead>
            <tbody>
              {players.map((item) => (
                <tr key={item.uid}>
                  <td>
                    <strong>{item.studentName}</strong>
                    <span className="hg-cell-subtitle">{item.company}</span>
                  </td>
                  <td>
                    {item.state.suspended
                      ? "Company suspended"
                      : item.board?.dismissed
                        ? "Adviser replaced"
                        : room.phase === "lobby"
                          ? "In lobby"
                          : room.phase === "decision"
                            ? item.ready ? "Submitted" : "Not submitted"
                            : room.phase === "finished" ? "Finished" : "Results"}

                    {item.board && (
                      <small className="hg-cell-subtitle">
                        Board warnings: {item.board.warnings} / {item.board.warningLimit || 5}
                      </small>
                    )}
                  </td>
                  <td>{money(item.state.cash)}</td>
                  <td>{money(item.state.debt)}</td>
                  <td>{money(equity(item.state, room.rules))}</td>
                  <td>
                    <button
                      type="button"
                      disabled={Boolean(game.busy)}
                      onClick={() => setSelectedUid(
                        selectedUid === item.uid ? "" : item.uid
                      )}
                    >
                      {selectedUid === item.uid ? "Close" : "Inspect"}
                    </button>
                    {room.phase === "finished" && (
                      <small className="hg-cell-subtitle">
                        {item.feedback?.reviewed
                          ? "Reviewed"
                          : item.reflection ? "Reflection submitted" : "Awaiting reflection"}
                      </small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!players.length && <p className="hg-muted">No students have joined.</p>}
      </section>

      {selected && (
        <section className="hg-panel">
          <div className="hg-section-heading">
            <div>
              <span className="hg-eyebrow">Read-only inspection</span>
              <h2>{selected.company}</h2>
              <p className="hg-muted">{selected.studentName}</p>
            </div>
            <button type="button" onClick={() => setSelectedUid("")}>Close inspection</button>
          </div>

          <div className="hg-stack">
            <Metrics player={selected} rules={room.rules} />

            {room.phase === "decision" && (
              <section>
                <h3>Submitted decision</h3>
                <DecisionSummary
                  decision={selected.decision}
                  advice={selected.advice || null}
                />
              </section>
            )}

            <History player={selected} room={room} />

            {room.phase === "finished" && (
              <section>
                <BoardSummary
                  board={selected.board}
                  companyClosed={selected.state.suspended}
                />
                <EndingReport report={selected.ending} />
                <ReviewCards review={selected.review} />

                {selected.reflection ? (
                  <>
                    <p className="hg-muted">
                      Chosen topic:{" "}
                      {selected.review.find(
                        (item) => item.key === selected.reflection.reviewKey
                      )?.title}
                    </p>
                    <blockquote className="hg-student-answer">
                      {selected.reflection.text}
                    </blockquote>
                    <Feedback
                      key={`${selected.uid}:${selected.reflection.savedAt}`}
                      room={room}
                      player={selected}
                      game={game}
                    />
                  </>
                ) : (
                  <Notice>The student has not submitted a reflection.</Notice>
                )}
              </section>
            )}
          </div>
        </section>
      )}

      <MarketHistory room={room} />
    </div>
  );
}

/* ----------------------- Public exports ----------------------- */

function HistoryGameView({ auth, db, exerciseId, adminView }) {
  const baseGame = useGame({ auth, db, exerciseId, adminView });

  const marketFeed = useMarketFeed({
    auth,
    exerciseId,
    room: baseGame.room,
    uid: baseGame.identity.uid,
    owner:
      adminView &&
      baseGame.room?.ownerUid === baseGame.identity.uid,
  });

  const game = { ...baseGame, marketFeed };

  let content;

  if (game.identity.loading) {
    content = <Loading text="Checking your sign-in…" />;
  } else if (!game.identity.uid) {
    content = <Notice type="error">Sign in with your website account.</Notice>;
  } else if (game.bootLoading || (!game.boot && !game.error)) {
    content = <Loading />;
  } else if (!game.boot) {
    content = (
      <section className="hg-panel">
        <h2>Unable to connect</h2>
        <Notice type="error">{game.error}</Notice>
        <button type="button" onClick={game.retry}>Retry</button>
      </section>
    );
  } else if (
    game.boot.engineVersion !== ENGINE_VERSION ||
    game.boot.scenario !== SCENARIO
  ) {
    content = (
      <Notice type="error">
        The server is not running the required Japan engine.
        Deploy the matching engine.cjs and api.cjs files before starting.
      </Notice>
    );
  } else if (adminView && !game.boot.teacher) {
    content = (
      <Notice type="error">
        Your actual signed-in account does not have teacher permission.
      </Notice>
    );
  } else if (!game.code) {
    content = <Home game={game} adminView={adminView} />;
  } else if (game.liveError) {
    content = (
      <section className="hg-panel">
        <h2>Live connection unavailable</h2>
        <Notice type="error">{game.liveError}</Notice>
        <p className="hg-muted">
          Controls are hidden until the current server state can be confirmed.
          Saved company records have not been reset.
        </p>
        <button type="button" onClick={game.retry}>Reconnect</button>
      </section>
    );
  } else if (!game.roomLoaded || !game.playersLoaded || !game.room) {
    content = <Loading text="Loading live session records…" />;
  } else if (
    game.room.exerciseId !== exerciseId ||
    game.room.engineVersion !== ENGINE_VERSION ||
    game.room.scenario !== SCENARIO
  ) {
    content = <Notice type="error">This is an incompatible session. Create a new Japan session.</Notice>;
  } else if (adminView && game.room.ownerUid !== game.identity.uid) {
    content = <Notice type="error">Only this session’s owner can manage it.</Notice>;
  } else if (!adminView && !game.player) {
    content = <Notice type="error">Your company record is unavailable.</Notice>;
  } else if (
    (adminView && game.players.length !== game.room.playerCount) ||
    !recordsAligned(game.room, adminView ? game.players : [game.player])
  ) {
    content = <Loading text="Synchronizing the room and company records…" />;
  } else {
    content = adminView
      ? <Teacher room={game.room} game={game} />
      : game.room.lessonVersion === 4
        ? (
          <EightDesk
            key={`${game.room.code}:${game.player.uid}`}
            room={game.room}
            player={game.player}
            game={game}
            Archive={History}
            ReflectionPanel={Reflection}
          />
        )
        : game.room.advisorMode === 2
          ? (
            <JapanDesk
              key={`${game.room.code}:${game.player.uid}`}
              room={game.room}
              player={game.player}
              game={game}
              Archive={History}
              ReflectionPanel={Reflection}
            />
          )
          : game.room.advisorMode === 1
            ? (
              <InvestmentDesk
                room={game.room}
                player={game.player}
                game={game}
                Archive={History}
                ReflectionPanel={Reflection}
              />
            )
            : <Student room={game.room} player={game.player} game={game} />;
  }

  return (
    <div className="ha-game">
      <div className="hg-container hg-stack">
        <div className="hg-topbar">
          <span>
            {adminView ? "Teacher desk" : "Investment office"}
            {" "}• Japan, 1985–1995

            {adminView && (
              <small style={{ display: "block", marginTop: 4 }}>
                {!game.code
                  ? game.boot?.performanceVersion === 1
                    ? "Investor R6 backend connected"
                    : "Investor R6 backend not yet confirmed"
                  : !game.room
                    ? "Loading session…"
                    : game.room.performanceVersion === 1
                      ? "Active session: Investor R6 · 8 rounds · 3 warnings"
                      : game.room.missionVersion === 1
                        ? "Older session: Guided R5"
                        : game.room.lessonVersion === 4
                          ? "Older session: R4"
                          : "Older session"}
              </small>
            )}
          </span>

          {game.code && (
            <button
              type="button"
              disabled={Boolean(game.busy)}
              onClick={() => {
                if (
                  !adminView &&
                  game.room?.phase === "decision" &&
                  !window.confirm(
                    "Return to the session list? Unsaved edits will be lost. " +
                    "Your last submitted decision remains saved."
                  )
                ) return;

                game.home();
              }}
            >
              Session list
            </button>
          )}
        </div>

        {game.boot && game.error && <Notice type="error">{game.error}</Notice>}
        {game.success && <Notice type="success">{game.success}</Notice>}
        {game.busy && <Notice>Processing {game.busy}… Please wait for confirmation.</Notice>}

        {content}
      </div>
    </div>
  );
}

export function HistoryGameAdmin(props) {
  return <HistoryGameView {...props} adminView />;
}

export function HistoryGameStudent(props) {
  return <HistoryGameView {...props} adminView={false} />;
}