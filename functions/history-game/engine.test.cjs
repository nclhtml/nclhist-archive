"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    ENGINE_VERSION,
    SCENARIO,
    RULES,
    ROUNDS,
    createPacket,
    publicRound,
    defaultEventSettings,
    normalizeEventSettings,
    initialState,
    equity,
    markOpening,
    defaultDecision,
    normalizeDecision,
    creditLimit,
    plan,
    settle,
    makeReview,
} = require("./engine.cjs");

function packet(round, config = defaultEventSettings()) {
    return createPacket(round, "repeatable-test-seed", config);
}

function play(state, decision, round, defaulted = false, config) {
    const current = packet(round, config);
    const opening = markOpening(state, current);

    return settle(
        opening.after,
        decision,
        current,
        defaulted,
        opening
    );
}

test("Japan scenario and initial equity", () => {
    assert.equal(ENGINE_VERSION, 2);
    assert.equal(SCENARIO, "japan-1985-1995");
    assert.equal(ROUNDS.length, 12);

    assert.equal(
        equity(initialState()),
        RULES.startingCash + RULES.startingFactories * RULES.factoryPrice
    );
});

test("every draw contains 1–3 unique events and all compulsory events", () => {
    for (let seed = 0; seed < 30; seed += 1) {
        for (let round = 0; round < ROUNDS.length; round += 1) {
            for (const mode of ["mixed", "good", "bad"]) {
                const result = createPacket(round, String(seed), {
                    count: 0,
                    mode,
                    pinned: [],
                });

                const ids = result.brief.events.map((event) => event.id);

                assert.ok(ids.length >= 1 && ids.length <= 3);
                assert.equal(new Set(ids).size, ids.length);

                for (const required of ROUNDS[round].fixed) {
                    assert.ok(ids.includes(required));
                }
            }
        }
    }
});

test("two compulsory events cannot be squeezed into one slot", () => {
    assert.throws(() => normalizeEventSettings(3, {
        count: 1,
        mode: "mixed",
        pinned: [],
    }));
});

test("out-of-period and duplicate optional events are rejected", () => {
    assert.throws(() => normalizeEventSettings(8, {
        count: 3,
        mode: "mixed",
        pinned: ["asset-confidence"],
    }));

    assert.throws(() => normalizeEventSettings(0, {
        count: 3,
        mode: "mixed",
        pinned: ["retailer-orders", "retailer-orders"],
    }));
});

test("packet generation is deterministic", () => {
    assert.deepEqual(packet(4), packet(4));
});

test("public briefing contains no unresolved actual demand or seed", () => {
    const brief = publicRound(packet(5));

    assert.equal(brief.outcome, undefined);
    assert.equal(brief.domesticDemand, undefined);
    assert.equal(brief.exportDemand, undefined);
    assert.equal(brief.seed, undefined);
});

test("good events do not cancel the compulsory crash", () => {
    for (let seed = 0; seed < 20; seed += 1) {
        const crash = createPacket(6, String(seed), {
            count: 3,
            mode: "good",
            pinned: [],
        });

        assert.equal(crash.combined.stockBps, -3800);
        assert.equal(crash.combined.propertyBps, 0);

        const land = createPacket(7, String(seed), {
            count: 3,
            mode: "good",
            pinned: [],
        });

        assert.ok(land.combined.propertyBps < 0);
    }
});

test("1995 threat does not implement a 100 percent tariff", () => {
    const threat = packet(10, { count: 1, mode: "mixed", pinned: [] });

    assert.equal(threat.rules.exportPrice, RULES.exportPrice);
    assert.ok(threat.brief.events.some((event) => event.id === "car-threat"));

    const agreement = packet(11, { count: 1, mode: "mixed", pinned: [] });

    assert.ok(agreement.brief.events.some(
        (event) => event.id === "car-settlement"
    ));
});

test("opening crash is applied once, and sales use the reduced holding", () => {
    const state = { ...initialState(), stocks: 10000 };
    const current = packet(6, { count: 2, mode: "mixed", pinned: [] });
    const opening = markOpening(state, current);

    assert.equal(opening.after.stocks, 6200);

    const result = settle(
        opening.after,
        { ...defaultDecision(), stocks: -6200 },
        current,
        false,
        opening
    );

    assert.equal(result.after.stocks, 0);
    assert.equal(result.metrics.stockChange, -3800);
    assert.equal(result.metrics.forcedLoss, 0);
    assert.equal(state.stocks, 10000);
});

test("cannot sell at the old pre-crash share value", () => {
    const current = packet(6, { count: 2, mode: "mixed", pinned: [] });
    const opening = markOpening({ ...initialState(), stocks: 10000 }, current);

    assert.throws(() => normalizeDecision(
        { ...defaultDecision(), stocks: -10000 },
        opening.after,
        current.rules
    ));
});

test("property sale limits and bid discounts are enforced", () => {
    const rules = packet(7).rules;
    const state = { ...initialState(), property: 10000 };

    assert.throws(() => normalizeDecision(
        { ...defaultDecision(), property: -2501 },
        state,
        rules
    ));

    const decision = normalizeDecision(
        { ...defaultDecision(), property: -2500 },
        state,
        rules
    );

    const result = plan(state, decision, rules);

    assert.equal(result.property, 7500);
    assert.equal(result.cash, state.cash + 2250);
});

test("collateral values affect the borrowing ceiling", () => {
    const rules = packet(5).rules;
    const low = initialState();
    const high = { ...low, property: 10000 };

    assert.ok(creditLimit(high, rules) > creditLimit(low, rules));
});

test("fractional, excessive-production and unaffordable plans are rejected", () => {
    const state = initialState();
    const rules = packet(0).rules;

    assert.throws(() => normalizeDecision(
        { ...defaultDecision(), production: 1.5 }, state, rules
    ));

    assert.throws(() => normalizeDecision(
        { ...defaultDecision(), production: 101 }, state, rules
    ));

    assert.throws(() => normalizeDecision(
        { ...defaultDecision(), stocks: 10000, production: 100 },
        state,
        rules
    ));
});

test("unsold inventory carries forward", () => {
    const result = play(
        { ...initialState(), inventory: 100 },
        { ...defaultDecision(), exports: 100 },
        8
    );

    assert.equal(
        result.after.inventory,
        100 - result.market.exportDemand
    );
});

test("cash shortages trigger emergency sales without negative asset balances", () => {
    const result = play(
        { ...initialState(), cash: 0, stocks: 2000, debt: 8000 },
        defaultDecision(),
        8
    );

    assert.ok(result.metrics.forcedLoss > 0);
    assert.ok(result.after.cash >= 0);
    assert.ok(result.after.stocks >= 0);
    assert.ok(result.after.property >= 0);
    assert.ok(result.after.factories >= 0);
});

test("suspended companies remain frozen", () => {
    const state = {
        ...initialState(),
        stocks: 2000,
        suspended: true,
    };

    const result = play(state, defaultDecision(), 6);

    assert.deepEqual(result.after, state);
    assert.equal(result.inactive, true);
});

test("teacher defaults are not treated as student choices", () => {
    const result = play(initialState(), defaultDecision(), 8, true);
    const review = makeReview([result]);

    assert.equal(review.length, 1);
    assert.equal(review[0].key, "resilience");
});

test("review can connect prior leveraged purchases to subsequent actual losses", () => {
    // 1988: establish an existing loan through a valid earlier decision.
    const earlierBorrowing = play(
        initialState(),
        {
            ...defaultDecision(),
            debt: 2000,
        },
        4,
        false,
        { count: 2, mode: "mixed", pinned: [] }
    );

    // 1989: borrow within this round's 4,000-unit NEW borrowing limit.
    // The existing loan carries forward from the preceding round.
    const beforeCrash = play(
        earlierBorrowing.after,
        {
            ...defaultDecision(),
            debt: 4000,
            stocks: 9000,
            property: 1000,
        },
        5,
        false,
        { count: 2, mode: "mixed", pinned: [] }
    );

    // 1990: the opening market fall affects the investments already held.
    const crash = play(
        beforeCrash.after,
        defaultDecision(),
        6,
        false,
        { count: 2, mode: "mixed", pinned: [] }
    );

    const history = [earlierBorrowing, beforeCrash, crash];
    const review = makeReview(history, 3);

    // Confirm that a real investment loss occurred while debt remained.
    assert.ok(crash.metrics.stockChange < 0);
    assert.ok(crash.before.debt > 0);

    // The review should connect that loss to the prior leveraged purchase.
    const borrowingReview = review.find(
        (item) => item.key === "borrowing"
    );

    assert.ok(borrowingReview);

    assert.ok(
        borrowingReview.evidence.some(
            (item) => item.round === beforeCrash.round
        )
    );

    // Keep the existing checks on the teacher's review-card limit.
    assert.ok(review.length <= 3);
    assert.ok(makeReview(history, 1).length <= 1);
});