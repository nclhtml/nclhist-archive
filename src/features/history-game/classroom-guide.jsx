import React, {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  formatYen,
  formatYenExact,
} from "./advisor-model.mjs";

import {
  BOARD_WARNING_LIMIT,
  boardProgress,
} from "./board-model.mjs";

import { Cash, Rows } from "./desk-widgets";

import {
  InvestorTarget,
  InvestorSummary,
} from "./investor-ui";

import "./classroom-guide.css";

const signed = (value) =>
  `${value > 0 ? "+" : ""}${formatYen(value)}`;

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

function Result({ value }) {
  return (
    <strong className={value < 0 ? "ir-negative" : "ir-positive"}>
      {signed(value)}
    </strong>
  );
}

export function BoardTarget({ room, player, state }) {
  if (player.board?.version === 2) {
    return (
      <InvestorTarget
        room={room}
        player={player}
        state={state}
      />
    );
  }

  const progress = boardProgress({
    state,
    mission: player.mission,
    board: player.board,
    phase: room.phase,
    publicShock: Boolean(room.dealing?.breaking),
  });

  if (!progress) {
    return (
      <section className="ir-board ir-practice" data-guide="goal">
        <strong>Your job</strong>
        <span>Help the company grow. Keep enough money for its bills.</span>
      </section>
    );
  }

  if (state.suspended) {
    return (
      <section className="ir-board ir-board-warning" data-guide="goal">
        <strong>The company has stopped operating.</strong>
        <span>You can still watch the market and finish your reflection.</span>
      </section>
    );
  }

  if (progress.dismissed) {
    return (
      <section className="ir-board ir-board-warning" data-guide="goal">
        <strong>The board has appointed another adviser.</strong>
        <span>
          Five reviews were missed. Management now runs a neutral plan.
          You can still observe and finish your reflection.
        </span>
      </section>
    );
  }

  if (progress.practice) {
    return (
      <section className="ir-board ir-practice" data-guide="goal">
        <strong>Round 1: practise</strong>
        <span>
          Try the controls. There is no board warning this round.
          Your money carries into the next round.
        </span>
      </section>
    );
  }

  const met = progress.gainSoFar >= progress.totalTarget;

  const roundGoal = progress.roundTarget >= 0
    ? `Add ${formatYen(progress.roundTarget)}`
    : `Keep the loss within ${formatYen(-progress.roundTarget)}`;

  return (
    <section
      className={`ir-board ${met ? "ir-board-good" : ""}`}
      data-guide="goal"
    >
      <div className="ir-board-main">
        <div>
          <small>
            {progress.publicShock ? "Board goal: protect the company" : "Board goal"}
          </small>
          <strong>{roundGoal}</strong>
          <span>Earlier results carry forward.</span>
        </div>

        <div>
          <small>Your company gain so far</small>
          <Result value={progress.gainSoFar} />
          <span>
            Goal so far: {signed(progress.totalTarget)}
          </span>
        </div>

        <div className="ir-goal-status">
          <strong>
            {met
              ? progress.final ? "Goal met" : "On target for now"
              : `Need ${formatYen(progress.shortfall)} more`}
          </strong>

          <span>
            Board warnings: {progress.warnings} / {BOARD_WARNING_LIMIT}
          </span>

          <div
            className="ir-warning-dots"
            role="img"
            aria-label={`${progress.warnings} of ${BOARD_WARNING_LIMIT} board warnings`}
          >
            {Array.from({ length: BOARD_WARNING_LIMIT }, (_, index) => (
              <i
                key={index}
                className={index < progress.warnings ? "ir-used" : ""}
              />
            ))}
          </div>
        </div>
      </div>

      <details>
        <summary>How the goal is counted</summary>
        <p>
          Your result is how much company value has changed since the
          practice round. Shares count at their current price, even before
          sale. Borrowed money is not a gain.
        </p>
        <p>
          The board allows for new improvement-project costs when the
          round ends. This allowance changes the target, not your cash.
          Five missed reviews lead to a new adviser.
        </p>
        {progress.projectAllowance > 0 && (
          <p>
            Project allowance this round:
            {" "}<Cash value={progress.projectAllowance} />.
          </p>
        )}
      </details>
    </section>
  );
}

export function BoardSummary({ board, companyClosed = false }) {
  if (!board) return null;

  if (board.version === 2) {
    return (
      <InvestorSummary
        board={board}
        companyClosed={companyClosed}
      />
    );
  }

  return (
    <section className="ir-board-summary">
      <strong>
        {board.dismissed
          ? "The board appointed another adviser"
          : companyClosed
            ? "Adviser record before company closure"
            : "The board kept you as its adviser"}
      </strong>

      <p>
        Goals met: {Math.max(0, board.reviews - board.warnings)}
        {" "}of {board.reviews} reviews.
        {" "}Warnings: {board.warnings} / {BOARD_WARNING_LIMIT}.
        The practice round was not graded.
      </p>

      {board.lastReview?.counted && (
        <Rows rows={[
          ["Company gain since practice", signed(board.lastReview.gainSoFar)],
          ["Board goal over the same period", signed(board.lastReview.totalTarget)],
        ]} />
      )}
    </section>
  );
}

function DiagramIcon({ kind }) {
  const path = kind === "factory"
    ? "M3 21V10l6 3V8l6 4V5h4l2 16z M6 17h2 M11 17h2 M16 17h2"
    : "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18 M12 3c-5 5-5 13 0 18";

  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function MoneyReport({ room, player, funding, terms }) {
  const reducedMotion = useReducedMotion();
  const latest = player.history?.[player.history.length - 1];
  const state = player.state;

  const hasActivity = Boolean(latest && !latest.inactive);
  const [stage, setStage] = useState(
    hasActivity && !reducedMotion ? 0 : 3
  );

  useEffect(() => {
    if (!hasActivity || reducedMotion) {
      setStage(3);
      return undefined;
    }

    setStage(0);

    const timers = [
      window.setTimeout(() => setStage((value) => Math.max(value, 1)), 700),
      window.setTimeout(() => setStage((value) => Math.max(value, 2)), 1400),
      window.setTimeout(() => setStage((value) => Math.max(value, 3)), 2100),
    ];

    return () => timers.forEach(window.clearTimeout);
  }, [
    room.code,
    room.round,
    player.uid,
    latest?.round,
    hasActivity,
    reducedMotion,
  ]);

  const m = latest?.metrics || {};
  const customerMoney = m.cashCollections || 0;
  const investmentIncome = (m.stockIncome || 0) + (m.propertyIncome || 0);
  const received = customerMoney + investmentIncome;

  const running =
    (m.productionCost || 0) +
    (m.overhead || 0) +
    (m.storage || 0);

  const bank = (m.interest || 0) + (m.principalDue || 0);

  const remaining =
    received -
    (stage >= 1 ? running : 0) -
    (stage >= 2 ? bank : 0);

  const decisionPeriod = room.phase === "decision";
  const available = funding?.valid ? funding.budget : 0;
  const kept = Math.max(0, state.cash - available);

  const capacity = terms
    ? state.factories * terms.factoryCapacity
    : 0;

  const planned = funding?.operations?.production || 0;

  const upperOrders = terms
    ? terms.forecast.domestic[1] + terms.forecast.export[1]
    : 0;

  const lowerOrders = terms
    ? terms.forecast.domestic[0] + terms.forecast.export[0]
    : 0;

  let advice = "Factory space and expected orders are fairly close.";

  if (capacity + state.inventory > upperOrders) {
    advice =
      "You can already make enough for these orders. Another factory could add bills without adding sales.";
  } else if (capacity + state.inventory < lowerOrders) {
    advice =
      "Orders may be greater than what you can supply. A new factory could help next round.";
  }

  return (
    <section className="ir-report">
      <div className="ir-report-heading">
        <div>
          <span className="hg-eyebrow">{player.company}</span>
          <h2>Your money report</h2>
        </div>

        {stage < 3 && (
          <button type="button" onClick={() => setStage(3)}>
            Show all
          </button>
        )}
      </div>

      {hasActivity ? (
        <>
          <p className="ir-money-intro">
            In completed round {latest.round + 1}, customers paid us
            {" "}<strong><Cash value={customerMoney} /></strong>!
          </p>

          {investmentIncome > 0 && (
            <p className="ir-money-extra">
              Rent and investment income added
              {" "}<Cash value={investmentIncome} />.
            </p>
          )}

          <div className="ir-money-story">
            <div className="ir-money-row">
              <span>Money received</span>
              <strong><Cash value={received} /></strong>
            </div>

            {stage >= 1 && (
              <div className="ir-money-row ir-reveal">
                <span>Running the business</span>
                <strong className="ir-negative">
                  −<Cash value={running} />
                </strong>
              </div>
            )}

            {stage >= 2 && (
              <div className="ir-money-row ir-reveal">
                <span>Money needed for the bank</span>
                <strong className="ir-negative">
                  −<Cash value={bank} />
                </strong>
              </div>
            )}

            <div className="ir-money-total">
              <span>{stage < 2 ? "Money remaining" : "Left from these receipts"}</span>
              <strong
                key={stage}
                className={remaining < 0 ? "ir-negative" : "ir-positive"}
                aria-label={formatYenExact(remaining)}
              >
                {signed(remaining)}
              </strong>
            </div>
          </div>

          {stage >= 2 && remaining < 0 && (
            <p className="ir-simple-warning">
              Those receipts were not enough to cover these bills.
              Other company money or asset sales were needed.
            </p>
          )}

          {latest.boardManaged && (
            <p className="ir-small">
              Management handled this period after the adviser was replaced.
            </p>
          )}
        </>
      ) : latest?.inactive ? (
        <p>The company was already closed. There was no new business activity.</p>
      ) : (
        <p className="ir-money-intro">Your starting funds are ready.</p>
      )}

      {stage >= 3 && (
        <section className="ir-funding ir-reveal">
          {decisionPeriod ? (
            <>
              <h3>Investment money at this round's start</h3>

              <div className="ir-money-row">
                <span>Cash in the company bank</span>
                <strong><Cash value={state.cash} /></strong>
              </div>

              <div className="ir-money-row">
                <span>Kept for upcoming company bills</span>
                <strong>−<Cash value={kept} /></strong>
              </div>

              <div className="ir-funding-total">
                <span>Ready to invest</span>
                <strong><Cash value={available} /></strong>
              </div>
            </>
          ) : (
            <>
              <h3>Cash after the completed period</h3>
              <div className="ir-funding-total">
                <span>In the company bank</span>
                <strong><Cash value={state.cash} /></strong>
              </div>
              <p className="ir-small">
                The next round's report will show the new investment budget.
              </p>
            </>
          )}
        </section>
      )}

      {decisionPeriod && terms && !state.suspended && (
        <section className="ir-orders-section">
          <h3>Do you need another factory?</h3>

          <div className="ir-orders">
            <div>
              <span className="ir-japan" aria-hidden="true"><i /></span>
              <small>Orders in Japan</small>
              <strong>{terms.forecast.domestic.join("–")}</strong>
            </div>

            <span className="ir-arrow" aria-hidden="true">→</span>

            <div className="ir-factory">
              <DiagramIcon kind="factory" />
              <small>Your {state.factories} factories can make</small>
              <strong>{capacity} goods</strong>
              <span>Management plans to make {planned}</span>
              <span>Already in stock: {state.inventory}</span>
            </div>

            <span className="ir-arrow" aria-hidden="true">←</span>

            <div>
              <DiagramIcon kind="globe" />
              <small>Orders from overseas</small>
              <strong>{terms.forecast.export.join("–")}</strong>
            </div>
          </div>

          <p className="ir-action-hint">{advice}</p>
        </section>
      )}

      {decisionPeriod && funding?.expectedOperatingCash < 0 && (
        <p className="ir-simple-warning">
          Management expects the business to need more cash than it brings in.
          Keep money available before buying more investments.
        </p>
      )}

      {(player.opening?.completedProjects || []).map((project) => (
        <div className="hg-notice hg-success" key={project}>
          Completed: {project}
        </div>
      ))}

      {latest?.metrics.efficiencySavings > 0 && (
        <div className="ip-efficiency">
          Your efficiency improvements reduced this period's costs by
          <strong><Cash value={latest.metrics.efficiencySavings} /></strong>
          <small>
            Compared with producing the same goods without those improvements.
          </small>
        </div>
      )}

      {latest?.metrics.forcedLoss > 0 && (
        <p className="ir-simple-warning">
          Emergency sales lost <Cash value={latest.metrics.forcedLoss} />.
        </p>
      )}

      {state.suspended && (
        <div className="hg-notice hg-warning">
          <strong>Operations suspended.</strong> {state.failureReason}
        </div>
      )}

      <details>
        <summary>See the full explanation</summary>

        <p className="ir-small">
          The first calculation explains receipts and cash commitments from
          the completed period. It does not deduct them from the bank again.
          The investment budget is a separate calculation using cash actually
          in the bank and the coming period's commitments.
        </p>

        {latest && (
          <Rows rows={[
            ["Business profit / loss", signed(m.netProfit || 0)],
            ["Customer money received", formatYen(customerMoney)],
            ["Rent and investment income", formatYen(investmentIncome)],
            ["Running-cost cash requirements", formatYen(running)],
            ["Interest and principal requested", formatYen(bank)],
            ["Customer invoices still unpaid", formatYen(state.receivables)],
            ["Dealing result", signed(m.dealingProfit || 0)],
            ["New improvement-project spending", formatYen(m.projectCost || 0)],
          ]} />
        )}

        <p className="ir-small">
          Buying and selling investments, factory purchases and borrowing
          also affect bank cash. Share-price changes can change company value
          without changing cash. A loan is not earnings.
        </p>
      </details>
    </section>
  );
}

const TOUR_STEPS = [
  {
    scene: "shares",
    target: "goal",
    title: "Your job",
    text:
      "Help this company grow. Keep enough money for its bills. Round 1 is practice. After that, try to meet the board's money goal.",
  },
  {
    scene: "shares",
    target: "funds",
    title: "Money you can use",
    text:
      "This is the money you can use to buy shares now. Cash in the bank also includes money kept for company bills.",
  },
  {
    scene: "shares",
    target: "shares",
    title: "Compare four companies",
    text:
      "Watch all four lines. Tap a company to choose its shares. A price that is rising can still fall.",
  },
  {
    scene: "shares",
    target: "order",
    title: "Buy or sell",
    text:
      "Choose how many lots you want. Then tap Buy now or Sell now. The trade changes your money at once. Green shows a gain. Red shows a loss.",
  },
  {
    scene: "company",
    target: "business",
    title: "Help your own company",
    text:
      "You can add a factory or improve the business. A factory makes more goods, but it also has bills. More goods need more buyers.",
  },
  {
    scene: "company",
    target: "report",
    title: "Read the company report",
    text:
      "This shows money in, bills and money left. Before adding a factory, compare orders with how much your factories can make.",
  },
  {
    scene: "company",
    target: "bank",
    title: "Borrow with care",
    text:
      "New loans arrive when the round ends. You must pay them back, with an extra charge called interest. A loan is not profit.",
  },
  {
    scene: "company",
    target: "submit",
    title: "Save your company plan",
    text:
      "Tap Submit plan to save these choices. A share trade changes your cash, so submit the plan again after trading.",
  },
  {
    scene: "shares",
    target: "clock",
    title: "Watch the time",
    text:
      "When share trading ends, you get a short time to finish your company plan. Then the teacher closes the round. You are ready to practise!",
  },
];

/*
 * A read-only tour.
 * It changes visible tabs, but never submits a plan or places an order.
 */
export function InvestorGuide({
  rootRef,
  onScene,
  onFinish,
  marketRunning = false,
}) {
  const [index, setIndex] = useState(0);
  const dialog = useRef(null);
  const coach = useRef(null);
  const heading = useRef(null);
  const maskId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const [layout, setLayout] = useState({
    width: 1,
    height: 1,
    spot: null,
    card: { left: 12, top: 12, width: 320 },
  });

  const step = TOUR_STEPS[index];

  useEffect(() => {
    const element = dialog.current;
    if (!element) return undefined;

    element.showModal();

    return () => {
      if (element.open) element.close();
    };
  }, []);

  useEffect(() => {
    onScene(step.scene);

    let active = true;
    let target = null;
    let frame = 0;
    let observer = null;
    let attempts = 0;

    const clamp = (value, low, high) =>
      Math.max(low, Math.min(Math.max(low, high), value));

    function measure() {
      frame = 0;

      if (!active || !dialog.current || !coach.current) return;

      const viewport = dialog.current.getBoundingClientRect();
      const width = viewport.width || window.innerWidth;
      const height = viewport.height || window.innerHeight;

      const bounds = target?.getBoundingClientRect();
      const visible = bounds && bounds.width > 0 && bounds.height > 0;

      let spot = null;
      let cardWidth = Math.min(340, width - 24);
      let cardLeft = (width - cardWidth) / 2;
      let cardTop = 12;

      if (visible) {
        const left = clamp(bounds.left - viewport.left - 6, 6, width - 6);
        const top = clamp(bounds.top - viewport.top - 6, 6, height - 6);
        const right = clamp(bounds.right - viewport.left + 6, 6, width - 6);
        const bottom = clamp(bounds.bottom - viewport.top + 6, 6, height - 6);

        if (right > left && bottom > top) {
          spot = {
            left,
            top,
            width: right - left,
            height: bottom - top,
          };
        }

        const rightSpace = width - right - 18;
        const leftSpace = left - 18;

        if (rightSpace >= 260) {
          cardWidth = Math.min(340, rightSpace);
          cardLeft = right + 12;
        } else if (leftSpace >= 260) {
          cardWidth = Math.min(340, leftSpace);
          cardLeft = left - cardWidth - 12;
        } else {
          cardLeft = clamp(
            left + (right - left) / 2 - cardWidth / 2,
            12,
            width - cardWidth - 12
          );
        }

        const cardHeight = Math.min(
          coach.current.offsetHeight || 230,
          height - 24
        );

        if (rightSpace >= 260 || leftSpace >= 260) {
          cardTop = clamp(
            top + (bottom - top) / 2 - cardHeight / 2,
            12,
            height - cardHeight - 12
          );
        } else if (height - bottom - 12 >= cardHeight) {
          cardTop = bottom + 12;
        } else if (top - 12 >= cardHeight) {
          cardTop = top - cardHeight - 12;
        } else {
          cardTop = top > height / 2
            ? 12
            : Math.max(12, height - cardHeight - 12);
        }
      } else {
        cardTop = Math.max(
          12,
          (height - (coach.current.offsetHeight || 230)) / 2
        );
      }

      const next = {
        width,
        height,
        spot,
        card: {
          left: cardLeft,
          top: cardTop,
          width: cardWidth,
        },
      };

      setLayout((previous) =>
        JSON.stringify(previous) === JSON.stringify(next)
          ? previous
          : next
      );
    }

    function queueMeasure() {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    function locate() {
      if (!active) return;

      target = rootRef.current?.querySelector(
        `[data-guide="${step.target}"]`
      );

      if ((!target || target.getClientRects().length === 0) && attempts < 20) {
        attempts += 1;
        frame = requestAnimationFrame(locate);
        return;
      }

      target?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "instant",
      });

      heading.current?.focus({ preventScroll: true });

      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(queueMeasure);
        if (target) observer.observe(target);
        if (coach.current) observer.observe(coach.current);
      }

      measure();
    }

    frame = requestAnimationFrame(locate);

    window.addEventListener("resize", queueMeasure);
    document.addEventListener("scroll", queueMeasure, true);
    window.visualViewport?.addEventListener("resize", queueMeasure);
    window.visualViewport?.addEventListener("scroll", queueMeasure);

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", queueMeasure);
      document.removeEventListener("scroll", queueMeasure, true);
      window.visualViewport?.removeEventListener("resize", queueMeasure);
      window.visualViewport?.removeEventListener("scroll", queueMeasure);
    };
  }, [index, step, onScene, rootRef]);

  const finalStep = index === TOUR_STEPS.length - 1;

  return (
    <dialog
      ref={dialog}
      className="ir-guide"
      aria-labelledby={`${maskId}-title`}
      aria-describedby={`${maskId}-text`}
      onCancel={(event) => {
        event.preventDefault();
        onFinish();
      }}
    >
      <svg
        className="ir-shade"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <mask id={`${maskId}-mask`} maskUnits="userSpaceOnUse">
            <rect width={layout.width} height={layout.height} fill="white" />
            {layout.spot && (
              <rect
                x={layout.spot.left}
                y={layout.spot.top}
                width={layout.spot.width}
                height={layout.spot.height}
                rx="14"
                fill="black"
              />
            )}
          </mask>
        </defs>

        <rect
          width={layout.width}
          height={layout.height}
          fill="rgba(10, 24, 17, 0.72)"
          mask={`url(#${maskId}-mask)`}
        />
      </svg>

      {layout.spot && (
        <div
          className="ir-spotlight"
          style={{
            left: layout.spot.left,
            top: layout.spot.top,
            width: layout.spot.width,
            height: layout.spot.height,
          }}
          aria-hidden="true"
        />
      )}

      <section
        ref={coach}
        className="ir-coach"
        style={{
          left: layout.card.left,
          top: layout.card.top,
          width: layout.card.width,
        }}
      >
        <small>Quick guide · {index + 1} / {TOUR_STEPS.length}</small>

        <h2
          id={`${maskId}-title`}
          ref={heading}
          tabIndex={-1}
        >
          {step.title}
        </h2>

        <p id={`${maskId}-text`}>{step.text}</p>

        {index === 0 && (
          <p className="ir-guide-note">
            Just read and tap Okay. This guide will not buy or sell anything.
          </p>
        )}

        {marketRunning && (
          <p className="ir-guide-note">
            The market clock is running. You may skip this guide.
          </p>
        )}

        <div className="ir-guide-buttons">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex((value) => value - 1)}
          >
            Back
          </button>

          <button
            type="button"
            className="hg-primary"
            onClick={() => {
              if (finalStep) onFinish();
              else setIndex((value) => value + 1);
            }}
          >
            {finalStep ? "Finish guide" : "Okay"}
          </button>
        </div>

        <button type="button" className="ir-skip" onClick={onFinish}>
          Skip guide
        </button>
      </section>
    </dialog>
  );
}