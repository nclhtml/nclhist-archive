import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getFunctions, httpsCallable } from "firebase/functions";

import {
  formatYen,
  formatYenExact,
} from "./advisor-model.mjs";

import {
  defaultInvestmentPlan,
  prepareInvestment,
} from "./resilience-model.mjs";

import {
  LISTED_SHARES,
  SHARES_PER_LOT,
  MAX_ORDERS,
  executionQuote,
  marketClock,
  markListed,
  maximumBuyLots,
  tradingSummary,
} from "./dealing-model.mjs";

import { Cash, LineChart, Rows, Slider } from "./desk-widgets";

const number = (value) => new Intl.NumberFormat("en-US").format(value);

function shortError(error) {
  return String(error?.message || "Connection unavailable.")
    .replace(/^Firebase:\s*/i, "");
}

export function useMarketFeed({
  auth,
  exerciseId,
  room,
  uid,
  owner,
}) {
  const [offset, setOffset] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const latest = useRef(room);
  const refreshRef = useRef(null);
  latest.current = room;

  const callable = useMemo(() => httpsCallable(
    getFunctions(auth.app, "us-central1"),
    "historyGame",
    { timeout: 30000 }
  ), [auth]);

  const enabled =
    room?.dealingVersion === 1 &&
    room?.phase === "decision" &&
    Boolean(room?.dealing) &&
    Boolean(uid);

  useEffect(() => {
    setReady(false);
    setError("");

    if (!enabled) {
      refreshRef.current = null;
      return undefined;
    }

    let active = true;
    let pending = false;
    let calibrated = false;
    let localOffset = 0;
    let nextAttempt = 0;

    const code = room.code;
    const round = room.round;
    const stagger = [...uid].reduce(
      (sum, character) => sum + character.charCodeAt(0),
      0
    ) % 1000;

    async function pulse(force = false) {
      const current = latest.current;

      if (
        !active ||
        pending ||
        !current ||
        current.code !== code ||
        current.round !== round ||
        auth.currentUser?.uid !== uid ||
        Date.now() < nextAttempt
      ) return;

      const clock = marketClock(current.dealing, Date.now() + localOffset);

      const lag =
        clock.elapsed - (current.dealing.tick + 1) * 5000;

      const quoteDue =
        clock.tick > current.dealing.tick &&
        lag >= (owner ? 60 : 1200 + stagger);

      if (!force && calibrated && !quoteDue) return;

      pending = true;
      const sentAt = Date.now();

      try {
        const response = await callable({
          action: "marketClock",
          exerciseId,
          code,
          round,
        });

        if (!active) return;

        const receivedAt = Date.now();

        localOffset =
          response.data.serverNow - (sentAt + receivedAt) / 2;

        calibrated = true;
        setOffset(localOffset);
        setReady(true);
        setError("");
        nextAttempt = receivedAt + 500;
      } catch (problem) {
        if (!active) return;

        calibrated = false;
        setReady(false);
        setError(shortError(problem));
        nextAttempt = Date.now() + 4000 + stagger;
      } finally {
        pending = false;
      }
    }

    function resumeCheck() {
      if (document.visibilityState === "hidden") {
        calibrated = false;
        setReady(false);
        return;
      }

      calibrated = false;
      setReady(false);
      nextAttempt = 0;
      pulse(true);
    }

    refreshRef.current = () => {
      nextAttempt = 0;
      pulse(true);
    };

    pulse(true);

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") pulse();
    }, 500);

    document.addEventListener("visibilitychange", resumeCheck);
    window.addEventListener("focus", resumeCheck);

    return () => {
      active = false;
      refreshRef.current = null;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resumeCheck);
      window.removeEventListener("focus", resumeCheck);
    };
  }, [
    enabled,
    room?.code,
    room?.round,
    auth,
    callable,
    exerciseId,
    uid,
    owner,
  ]);

  const refresh = useCallback(() => {
    refreshRef.current?.();
  }, []);

  return { offset, ready, error, refresh };
}

export function useDealingClock(market, offset = 0) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setNow(Date.now());

    if (!market?.startedAt) return undefined;

    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [market?.startedAt]);

  return marketClock(market, now + offset);
}

export function MarketClockLabel({ clock }) {
  const remaining = clock.halted
    ? clock.haltRemainingMs
    : clock.remainingMs;

  const seconds = Math.ceil((remaining || 0) / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");

  const label = {
    off: "",
    briefing: "Waiting for teacher",
    live: "Trading & plans",
    grace: "Final adjustments",
    closed: "Round closed",
  }[clock.stage];

  return (
    <div className={`jd-clock jd-clock-${clock.stage}`}>
      <span>
        {clock.paused
          ? "Paused"
          : clock.halted
            ? "Trading suspended"
            : label}
      </span>

      {["live", "grace"].includes(clock.stage) && (
        <strong>{minutes}:{remainder}</strong>
      )}
    </div>
  );
}

export function DealingTeacher({ room, game }) {
  const clock = useDealingClock(
    room.dealing,
    game.marketFeed.offset
  );

  const [duration, setDuration] = useState(
    room.marketConfig?.durationSeconds || 120
  );

  const [grace, setGrace] = useState(
    room.marketConfig?.graceSeconds ?? 20
  );

  useEffect(() => {
    setDuration(room.marketConfig?.durationSeconds || 120);
    setGrace(room.marketConfig?.graceSeconds ?? 20);
  }, [room.marketConfigRevision]);

  function command(action, extra = {}) {
    return game.act(action, {
      code: room.code,
      round: room.round,
      marketRevision: room.dealing?.revision,
      ...extra,
    });
  }

  return (
    <section className="jd-teacher-market">
      <h3>Shared dealing market</h3>

      {room.phase === "decision" && (
        <>
          <MarketClockLabel clock={clock} />

          <div className="hg-actions">
            {clock.stage === "briefing" && (
              <button
                type="button"
                className="hg-primary"
                disabled={Boolean(game.busy)}
                onClick={() => command("openMarket")}
              >
                Open trading and investment plans
              </button>
            )}

            {["live", "grace"].includes(clock.stage) && (
              <button
                type="button"
                disabled={Boolean(game.busy)}
                onClick={() => command("pause", {
                  paused: !room.paused,
                })}
              >
                {room.paused ? "Resume clock" : "Pause clock"}
              </button>
            )}
          </div>

          <div className="jd-teacher-quotes">
            {LISTED_SHARES.map((share) => (
              <div key={share.id}>
                <small>{share.name}</small>
                <strong>
                  {formatYenExact(
                    room.dealing.prices[share.id] / SHARES_PER_LOT
                  )}
                </strong>
              </div>
            ))}
          </div>
        </>
      )}

      {["lobby", "results"].includes(room.phase) && (
        <details>
          <summary>Next round's timing</summary>

          <div className="hg-form-grid">
            <label className="hg-field">
              <span>Trading and planning: seconds</span>
              <input
                type="number"
                min={30}
                max={600}
                step={5}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </label>

            <label className="hg-field">
              <span>Final adjustments: seconds</span>
              <input
                type="number"
                min={0}
                max={120}
                step={5}
                value={grace}
                onChange={(event) => setGrace(event.target.value)}
              />
            </label>
          </div>

          <button
            type="button"
            disabled={Boolean(game.busy)}
            onClick={() => command("marketSettings", {
              revision: room.marketConfigRevision,
              durationSeconds: Number(duration),
              graceSeconds: Number(grace),
            })}
          >
            Save timing
          </button>
        </details>
      )}

      <details style={{ marginTop: 12 }}>
        <summary>Teacher notes</summary>

        {room.lessonVersion === 4 && (
          <p className="hg-muted">
            This session has eight rounds. Round 5 includes a mid-session
            share-price shock and a short suspension of both buying and
            selling. The suspension consumes part of the dealing window.
            It is a compressed classroom mechanic, not a reconstruction
            of a single historical exchange halt. Property weakness follows
            in the later rounds.
          </p>
        )}
        <p className="hg-muted">
          The listed companies and price paths are teaching scenarios.
          Sector prospects influence expected performance, but no share
          is guaranteed to win. Prices contain shared market movements
          and company-specific variation. Future prices remain private.
        </p>
        <p className="hg-muted">
          Confirmed trades invalidate the student's previous submitted
          investment plan. Final adjustments allow resubmission without
          further trading. A missing final plan uses neutral management
          operations; completed live trades are not reversed.
        </p>
      </details>
    </section>
  );
}

function loadPending(key) {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

export function LiveDealing({ room, player, game }) {
  const clock = useDealingClock(room.dealing, game.marketFeed.offset);
  const [symbol, setSymbol] = useState(LISTED_SHARES[0].id);
  const [side, setSide] = useState("buy");
  const [lots, setLots] = useState(1);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState(0);

  const storageKey = `hg-pending-order:${room.code}:${player.uid}`;
  const [pendingOrder, setPendingOrder] = useState(
    () => loadPending(storageKey)
  );

  useEffect(() => {
    try {
      if (pendingOrder) {
        window.sessionStorage.setItem(
          storageKey,
          JSON.stringify(pendingOrder)
        );
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch {
      // Order idempotency is still enforced by the server.
    }
  }, [pendingOrder, storageKey]);

  const market = room.dealing;
  const state = markListed(player.state, market.prices);
  const totals = tradingSummary(state);
  const selected = LISTED_SHARES.find((share) => share.id === symbol);

  const protection = useMemo(() => prepareInvestment(
    state,
    {
      ...defaultInvestmentPlan(),
      reserveRelease: 100,
    },
    room.rules,
    room.brief
  ), [player.state, market.prices, room.rules, room.brief]);

  const buyingPower = protection.valid ? protection.budget : 0;
  const owned = state.listed[symbol].lots;

  const maximum = side === "buy"
    ? maximumBuyLots(market.prices, symbol, buyingPower)
    : owned;

  const order = lots > 0 && Number.isSafeInteger(lots)
    ? executionQuote(market.prices, symbol, side, lots)
    : null;

  const quoteFresh =
    market.tick === clock.tick &&
    game.marketFeed.ready;

  const accountFresh =
    (player.balanceRevision || 0) >= acknowledgedRevision;

  const canTrade =
    room.phase === "decision" &&
    clock.stage === "live" &&
    !clock.paused &&
    !room.paused &&
    !state.suspended &&
    quoteFresh &&
    accountFresh &&
    !game.busy;

  const histories = LISTED_SHARES.map((share) =>
    market.history.map((row) =>
      row.prices[share.id] / market.history[0].prices[share.id] * 100
    )
  );

  const allValues = histories.flat();
  const chartLow = Math.min(98, ...allValues);
  const chartHigh = Math.max(102, ...allValues);

  async function transmit(request) {
    setPendingOrder(request);

    const result = await game.act("dealOrder", request);

    if (result.ok) {
      setAcknowledgedRevision(result.data.receipt.balanceRevision);
      setPendingOrder(null);
      game.marketFeed.refresh();
      return;
    }

    const definitive = [
      "functions/invalid-argument",
      "functions/failed-precondition",
      "functions/permission-denied",
      "functions/not-found",
      "functions/unauthenticated",
    ].includes(result.errorCode);

    if (definitive) {
      setPendingOrder(null);
    }

    game.marketFeed.refresh();
  }

  function placeOrder() {
    if (
      !canTrade ||
      !order ||
      lots > maximum ||
      pendingOrder
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

  return (
    <section className="jd-panel">
      <div className="jd-section-heading">
        <div>
          <span className="hg-eyebrow">Share dealing</span>
          <h2>Market watch</h2>
        </div>
        <div>
          <small>Available to trade now</small>
          <strong className="jd-large-number">
            <Cash value={buyingPower} />
          </strong>
        </div>
      </div>

      <MarketClockLabel clock={clock} />

      <div className="jd-share-grid">
        {LISTED_SHARES.map((share, index) => {
          const start = market.history[0].prices[share.id];
          const current = market.prices[share.id];
          const previous = market.history[
            Math.max(0, market.history.length - 2)
          ].prices[share.id];

          const movement = (current / start - 1) * 100;
          const tickMovement = (current / previous - 1) * 100;

          return (
            <button
              type="button"
              className={`jd-share-card ${symbol === share.id ? "jd-selected" : ""}`}
              key={share.id}
              aria-pressed={symbol === share.id}
              onClick={() => setSymbol(share.id)}
            >
              <span className="jd-share-name">{share.name}</span>
              <small>{share.sector}</small>

              <strong>
                {formatYenExact(current / SHARES_PER_LOT)}
              </strong>

              <span className={movement < 0 ? "hg-negative" : "hg-positive"}>
                {movement >= 0 ? "+" : ""}{movement.toFixed(1)}% this session
              </span>

              <LineChart
                values={histories[index]}
                minimum={chartLow}
                maximum={chartHigh}
                colour={share.colour}
                label={`${share.name}: ${movement.toFixed(1)}% this session`}
              />

              <small>
                Latest move: {tickMovement >= 0 ? "+" : ""}
                {tickMovement.toFixed(1)}%
              </small>

              <span className="jd-company-signal">
                {room.brief.companyWatch?.find(
                  (item) => item.symbol === share.id
                )?.text}
              </span>

              <small>
                Owned: {number((state.listed[share.id]?.lots || 0) * SHARES_PER_LOT)}
              </small>
            </button>
          );
        })}
      </div>

      <div className="jd-dealing-detail">
        <div>
          <h3>{selected.name}</h3>

          <LineChart
            large
            values={market.history.map((row) => row.prices[symbol])}
            colour={selected.colour}
            label={`${selected.name}: price history for this session`}
          />

          <div className="jd-chart-ends">
            <span>Market opening</span>
            <span>{market.tick * 5} seconds</span>
          </div>

          <details>
            <summary>Price record</summary>
            <div className="hg-table-wrap">
              <table>
                <thead>
                  <tr><th>Elapsed</th><th>Price per share</th></tr>
                </thead>
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
          </details>
        </div>

        <div className="jd-order">
          <div className="jd-tabs">
            <button
              type="button"
              aria-pressed={side === "buy"}
              onClick={() => { setSide("buy"); setLots(1); }}
            >
              Buy
            </button>
            <button
              type="button"
              aria-pressed={side === "sell"}
              onClick={() => { setSide("sell"); setLots(1); }}
            >
              Sell
            </button>
          </div>

          <Slider
            label="Number of lots"
            value={lots}
            max={maximum}
            suffix=""
            onChange={setLots}
            disabled={Boolean(pendingOrder)}
          >
            1 lot = {number(SHARES_PER_LOT)} shares.
            {" "}Available: {number(maximum)} lots.
          </Slider>

          <div className="jd-step-buttons">
            <button
              type="button"
              disabled={Boolean(pendingOrder) || lots <= 0}
              onClick={() => setLots(Math.max(0, lots - 1))}
            >−</button>
            <button
              type="button"
              disabled={Boolean(pendingOrder) || lots >= maximum}
              onClick={() => setLots(Math.min(maximum, lots + 1))}
            >+</button>
          </div>

          {order && (
            <Rows rows={[
              ["Shares", number(order.shares)],
              [
                side === "buy" ? "Buying price / share" : "Selling price / share",
                formatYenExact(order.price / SHARES_PER_LOT),
              ],
              ["Fee", <Cash value={order.fee} />],
              [
                side === "buy" ? "Total cost" : "Cash received",
                <strong><Cash value={order.cashAmount} /></strong>,
              ],
            ]} />
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
            onClick={placeOrder}
          >
            {side === "buy" ? "Buy now" : "Sell now"}
          </button>

          {pendingOrder && (
            <div className="hg-notice hg-warning">
              <p>Checking your last order. Do not place it again with a new reference.</p>
              <button
                type="button"
                disabled={Boolean(game.busy)}
                onClick={() => transmit(pendingOrder)}
              >
                Check / retry the same order
              </button>
            </div>
          )}

          {clock.stage === "live" && !quoteFresh && (
            <small className="jd-inline-note">Updating the quote…</small>
          )}

          <small className="jd-inline-note">
            Trades execute immediately. Unsold shares stay invested.
          </small>
        </div>
      </div>

      <details style={{ marginTop: 16 }}>
        <summary>Trading account and recent orders</summary>

        <Rows rows={[
          ["Listed shares now", <Cash value={totals.value} />],
          ["Realised result", <Cash value={totals.realized} />],
          ["Unrealised result", <Cash value={totals.unrealized} />],
          ["Fees paid", <Cash value={totals.fees} />],
          ["Orders this round", `${player.dealCount || 0} / ${MAX_ORDERS}`],
        ]} />

        <p className="hg-muted">
          Buys use existing cash after operating commitments.
          Pending loans and planned sales do not fund live orders.
          These individual shares are not accepted as loan collateral.
        </p>

        <div className="hg-table-wrap">
          <table>
            <thead>
              <tr><th>Trade</th><th>Shares</th><th>Cash</th></tr>
            </thead>
            <tbody>
              {[...(player.dealLog || [])].reverse().map((receipt) => (
                <tr key={receipt.orderId}>
                  <td>
                    {receipt.side === "buy" ? "Bought" : "Sold"}
                    {" "}{LISTED_SHARES.find(
                      (share) => share.id === receipt.symbol
                    )?.name}
                  </td>
                  <td>{number(receipt.shares)}</td>
                  <td>{formatYen(receipt.cashAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}