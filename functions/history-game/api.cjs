"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const crypto = require("node:crypto");

const {
  GameError,
  ENGINE_VERSION,
  SCENARIO,
  RULES,
  ROUNDS,
  FIXED,
  optionalEvents,
  defaultEventSettings,
  normalizeEventSettings,
  createPacket,
  publicRound,
  publicReport,
  initialState,
  markOpening,
  defaultDecision,
  normalizeDecision,
  settle,
  makeReview,
} = require("./engine.cjs");

const advisorModule = import("./advisor-model.mjs");
const resilienceModule = import("./resilience-model.mjs");

const {
  createResiliencePacket,
} = require("./resilience-packet.cjs");

const {
  EIGHT_ROUNDS,
  createEightPacket,
  normalizeEightSettings,
  eightEventOptions,
} = require("./eight-scenario.cjs");

const dealingModule = import("./dealing-model.mjs");
const boardModule = import("./board-model.mjs");
const investorModule = import("./investor-model.mjs");

const {
  createInvestorPacket,
} = require("./investor-scenario.cjs");

const {
  createTape,
  initialPublicMarket,
  revealMarket,
  runMarketAction,
} = require("./dealing-server.cjs");

// Your existing index.js initializes Firebase Admin.
const db = admin.firestore();

const SUPER_ADMIN = "clng@ktls.edu.hk";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ACTIONS = new Set([
  "boot",
  "create",
  "join",
  "events",
  "configure",
  "start",
  "pause",
  "submit",
  "resolve",
  "next",
  "reflect",
  "feedback",
  "marketClock",
  "marketSettings",
  "openMarket",
  "dealOrder",
]);

function fail(code, message) {
  throw new functions.https.HttpsError(code, message);
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function text(value, min, max, label) {
  if (typeof value !== "string") {
    fail("invalid-argument", `${label} is required.`);
  }

  const cleaned = value.trim();

  if (cleaned.length < min || cleaned.length > max) {
    fail(
      "invalid-argument",
      `${label} must contain ${min}–${max} characters.`
    );
  }

  return cleaned;
}

function whole(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(
      "invalid-argument",
      `${label} must be a whole number between ${min} and ${max}.`
    );
  }

  return value;
}

function documentId(value, label) {
  const id = text(value, 1, 128, label);

  if (id.includes("/") || id === "." || id === "..") {
    fail("invalid-argument", `Invalid ${label}.`);
  }

  return id;
}

function roomCode(value) {
  const code = text(value, 8, 8, "Session code").toUpperCase();

  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)) {
    fail("invalid-argument", "Invalid session code.");
  }

  return code;
}

function newCode() {
  return Array.from(
    { length: 8 },
    () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  ).join("");
}

function roomRef(code) {
  return db.collection("hgRooms").doc(code);
}

function privateRef(code) {
  return db.collection("hgPrivateRooms").doc(code);
}

function packetRef(code, round) {
  return privateRef(code).collection("rounds").doc(String(round));
}

function membershipRef(uid, code) {
  return db.collection("hgUsers").doc(uid).collection("rooms").doc(code);
}

function accessRef(exerciseId, uid) {
  return db.collection("hgExerciseAccess")
    .doc(exerciseId).collection("users").doc(uid);
}

function authenticatedPerson(context) {
  if (!context.auth) {
    fail("unauthenticated", "Sign in with your website account.");
  }

  const token = context.auth.token;

  if (
    typeof token.email !== "string" ||
    token.email_verified !== true
  ) {
    fail("permission-denied", "Use a verified website account.");
  }

  return {
    uid: context.auth.uid,
    email: normalize(token.email),
    studentName: String(token.name || "Student").slice(0, 80),
  };
}

/*
 * Uses current website roles and current exercise assignments.
 * This function only reads. Call finish() after all action reads.
 */
async function loadExerciseAccess(transaction, person, exerciseId) {
  const roleSnapshot = await transaction.get(
    db.collection("user_roles").doc(person.email)
  );

  const storedRole = roleSnapshot.exists
    ? roleSnapshot.data().role
    : null;

  const teacher =
    person.email === SUPER_ADMIN ||
    storedRole === "admin";

  if (
    !teacher &&
    (
      !roleSnapshot.exists ||
      typeof storedRole !== "string" ||
      !storedRole.trim()
    )
  ) {
    fail("permission-denied", "Your account has no valid website role.");
  }

  const exerciseSnapshot = await transaction.get(
    db.collection("exercises").doc(exerciseId)
  );

  if (!exerciseSnapshot.exists) {
    fail("not-found", "This exercise no longer exists.");
  }

  const exercise = exerciseSnapshot.data();

  if (exercise.componentName !== "HistoryGame") {
    fail("failed-precondition", "Set the exercise component name to HistoryGame.");
  }

  const assignedGroups = Array.isArray(exercise.assignedGroups)
    ? exercise.assignedGroups
    : [];

  if (
    assignedGroups.length > 200 ||
    assignedGroups.some((group) => typeof group !== "string")
  ) {
    fail("failed-precondition", "The exercise has invalid assigned groups.");
  }

  const groups = new Set(assignedGroups.map(normalize).filter(Boolean));

  let basis = "";
  let studentId = "";
  let className = "";

  if (teacher) {
    basis = "admin";
  } else if (groups.has("all")) {
    basis = "all";
  } else if (groups.has(normalize(storedRole))) {
    basis = "role";
  } else {
    const students = await transaction.get(
      db.collection("students")
        .where("email", "==", person.email)
        .limit(1)
    );

    if (!students.empty) {
      const profile = students.docs[0];
      const student = profile.data();

      className = typeof student.className === "string"
        ? student.className
        : "";

      if (normalize(className) && groups.has(normalize(className))) {
        basis = "class";
        studentId = profile.id;
      }
    }
  }

  if (!basis) {
    fail(
      "permission-denied",
      "This exercise is not assigned to your website group or class."
    );
  }

  return {
    ...person,
    teacher,
    role: typeof storedRole === "string" ? storedRole : "admin",
    grant: {
      exerciseId,
      email: person.email,
      roleValue: typeof storedRole === "string" ? storedRole : "",
      assignedGroups,
      basis,
      studentId,
      className: basis === "class" ? className : "",
    },
  };
}

function requireTeacher(person) {
  if (!person.teacher) {
    fail("permission-denied", "Teacher access is required.");
  }
}

function requireOwner(room, person) {
  requireTeacher(person);

  if (room.ownerUid !== person.uid) {
    fail("permission-denied", "Only this session's owner can control it.");
  }
}

function requireRound(room, requestedRound) {
  if (
    !Number.isSafeInteger(requestedRound) ||
    room.round !== requestedRound
  ) {
    fail("failed-precondition", "The round changed. Wait for the screen to update.");
  }
}

function readRoom(snapshot, exerciseId) {
  if (!snapshot.exists) {
    fail("not-found", "Session not found.");
  }

  const room = snapshot.data();

  if (room.exerciseId !== exerciseId) {
    fail("permission-denied", "This session belongs to another exercise.");
  }

  if (
    room.accessVersion !== 2 ||
    room.engineVersion !== ENGINE_VERSION ||
    room.scenario !== SCENARIO
  ) {
    fail(
      "failed-precondition",
      "This is an older or incompatible session. Create a new Japan session."
    );
  }

  return room;
}

function nextTarget(room) {
  if (room.phase === "lobby") return 0;

  if (
    room.phase === "results" &&
    room.round < room.totalRounds - 1
  ) {
    return room.round + 1;
  }

  fail(
    "failed-precondition",
    "Configure events in the lobby or between completed rounds."
  );
}

function chosenSettings(setup, target) {
  return setup.scheduled?.round === target
    ? setup.scheduled.settings
    : defaultEventSettings();
}

function eventOptions(room, setup, target, revision = room.planRevision) {
  if (room.lessonVersion === 4) {
    return eightEventOptions(room, setup, target, revision);
  }

  const settings = chosenSettings(setup, target);
  const packet = createPacket(target, setup.seed, settings);

  return {
    targetRound: target,
    date: ROUNDS[target].date,
    revision,
    minimum: ROUNDS[target].fixed.length,
    config: settings,
    fixed: ROUNDS[target].fixed.map((id) => FIXED[id]),
    optional: optionalEvents(target),
    preview: publicRound(packet).events,
  };
}

function readSetup(snapshot) {
  if (!snapshot.exists || typeof snapshot.data().seed !== "string") {
    fail("failed-precondition", "The private session configuration is missing.");
  }

  return snapshot.data();
}

module.exports = functions
  .region("us-central1")
  .runWith({
    timeoutSeconds: 120,
    memory: "512MB",
    maxInstances: 10,
  })
  .https.onCall(async (data, context) => {
    try {
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        fail("invalid-argument", "A request is required.");
      }

      if (!ACTIONS.has(data.action)) {
        fail("invalid-argument", "Unknown game action.");
      }

      const person = authenticatedPerson(context);
      const exerciseId = documentId(data.exerciseId, "exercise ID");
      const action = data.action;

      // Generated once per request, outside transaction retries.
      const candidateCode = action === "create" ? newCode() : null;
      const candidateSeed = action === "create"
        ? crypto.randomBytes(32).toString("hex")
        : null;
      const requestTime = Date.now();

      const {
        compileAdvisorPlan,
        defaultAdvice,
        makeAdvisorReview,
      } = await advisorModule;

      const resilience = await resilienceModule;
      const dealing = await dealingModule;
      const boardModel = await boardModule;
      const investorModel = await investorModule;

      return await db.runTransaction(async (transaction) => {
        const access = await loadExerciseAccess(
          transaction, person, exerciseId
        );

        function finish(result) {
          transaction.set(accessRef(exerciseId, person.uid), {
            ...access.grant,
            checkedAt: requestTime,
          });

          return result;
        }

        if (action === "boot") {
          const memberships = await transaction.get(
            db.collection("hgUsers").doc(person.uid)
              .collection("rooms")
              .where("exerciseId", "==", exerciseId)
          );

          const rooms = memberships.docs
            .map((document) => document.data())
            .filter((membership) =>
              membership.accessVersion === 2 &&
              membership.engineVersion === ENGINE_VERSION &&
              membership.scenario === SCENARIO &&
              (
                membership.kind === "player" ||
                (membership.kind === "owner" && access.teacher)
              )
            )
            .map((membership) => ({
              code: membership.code,
              title: membership.title,
              kind: membership.kind,
              createdAt: membership.createdAt,
            }))
            .sort((a, b) => b.createdAt - a.createdAt);

          return finish({
            teacher: access.teacher,
            role: access.role,
            engineVersion: ENGINE_VERSION,
            scenario: SCENARIO,
            resilienceVersion: 2,
            dealingVersion: 1,
            lessonVersion: 4,
            missionVersion: 2,
            performanceVersion: 1,
            rooms,
          });
        }

        if (action === "create") {
          requireTeacher(access);

          if (data.gameplayVersion !== 6) {
            fail(
              "failed-precondition",
              "Refresh the website before creating an Investor R6 session."
            );
          }

          const title = text(data.title, 2, 80, "Session title");
          const maxPlayers = whole(data.maxPlayers, 1, 60, "Maximum students");
          const reflectionLimit = whole(
            data.reflectionLimit, 1, 3, "Review-card limit"
          );

          const requestId = text(data.requestId, 36, 36, "Request ID");

          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
              .test(requestId)
          ) {
            fail("invalid-argument", "Invalid request ID.");
          }

          const requestRef = db.collection("hgCreateRequests")
            .doc(person.uid).collection("requests").doc(requestId);

          const previous = await transaction.get(requestRef);

          if (previous.exists) {
            const saved = previous.data();

            if (saved.exerciseId !== exerciseId) {
              fail("failed-precondition", "This request belongs to another exercise.");
            }

            const existing = readRoom(
              await transaction.get(roomRef(saved.code)),
              exerciseId
            );

            requireOwner(existing, access);
            return finish({ code: saved.code });
          }

          const reference = roomRef(candidateCode);
          const collision = await transaction.get(reference);

          if (collision.exists) {
            fail("aborted", "Please try creating the session again.");
          }

          const membership = {
            code: candidateCode,
            title,
            exerciseId,
            accessVersion: 2,
            engineVersion: ENGINE_VERSION,
            scenario: SCENARIO,
            createdAt: requestTime,
          };

          transaction.create(reference, {
            ...membership,
            ownerUid: person.uid,
            phase: "lobby",
            round: 0,
            totalRounds: EIGHT_ROUNDS.length,
            lessonVersion: 4,
            missionVersion: 2,
            performanceVersion: 1,
            finalRanking: null,
            paused: false,
            maxPlayers,
            playerCount: 0,
            reflectionLimit,
            advisorMode: 2,
            dealingVersion: 1,
            marketConfig: { ...dealing.DEFAULT_MARKET_CONFIG },
            marketConfigRevision: 0,
            dealing: null,
            rules: { ...RULES, advisorMode: 2 },
            brief: null,
            report: null,
            planRevision: 0,
            briefHistory: [],
            marketHistory: [],
            marketIndexes: { stocks: 100, property: 100 },
            updatedAt: requestTime,
          });

          transaction.create(privateRef(candidateCode), {
            seed: candidateSeed,
            scheduled: null,
            createdAt: requestTime,
          });

          transaction.set(
            membershipRef(person.uid, candidateCode),
            { ...membership, kind: "owner" }
          );

          transaction.create(requestRef, {
            code: candidateCode,
            exerciseId,
            createdAt: requestTime,
          });

          return finish({ code: candidateCode });
        }

        const code = roomCode(data.code);
        const reference = roomRef(code);
        const room = readRoom(await transaction.get(reference), exerciseId);

        const marketAction = [
          "marketClock",
          "marketSettings",
          "openMarket",
          "dealOrder",
        ].includes(action);

        if (
          marketAction ||
          (action === "pause" && room.dealingVersion === 1)
        ) {
          if (room.dealingVersion !== 1) {
            fail(
              "failed-precondition",
              "This session does not have the timed dealing market."
            );
          }

          const result = await runMarketAction({
            transaction,
            reference,
            room,
            person,
            access,
            data,
            fail,
            privateRef,
            packetRef,
            model: dealing,
            economy: resilience,
          });

          return finish(result);
        }

        if (action === "join") {
          const company = text(data.company, 2, 40, "Company name");
          const playerRef = reference.collection("players").doc(person.uid);
          const playerSnapshot = await transaction.get(playerRef);

          if (playerSnapshot.exists) {
            return finish({ code });
          }

          if (room.ownerUid === person.uid) {
            fail(
              "failed-precondition",
              "Use a separate student account to test joining your session."
            );
          }

          if (room.phase !== "lobby") {
            fail("failed-precondition", "This session has already started.");
          }

          if (room.playerCount >= room.maxPlayers) {
            fail("resource-exhausted", "This session is full.");
          }

          if (
            room.advisorMode === 2 &&
            !Object.prototype.hasOwnProperty.call(
              resilience.INDUSTRIES,
              data.industry
            )
          ) {
            fail(
              "invalid-argument",
              "Choose one of the available company industries."
            );
          }

          transaction.create(playerRef, {
            uid: person.uid,
            studentName: person.studentName,
            company,
            state: room.performanceVersion === 1
              ? investorModel.createInvestorCompany(data.industry)
              : room.advisorMode === 2
                ? room.dealingVersion === 1
                  ? dealing.withListedShares({
                    ...resilience.initialCompany(data.industry),
                    ...(room.lessonVersion === 4
                      ? {
                        lessonVersion: 4,
                        propertyCost: 0,
                      }
                      : {}),
                  })
                  : resilience.initialCompany(data.industry)
                : initialState(),
            balanceRevision: 0,
            dealCount: 0,
            dealLog: [],
            planNeedsReview: false,
            ...(room.performanceVersion === 1
              ? {
                board: investorModel.initialInvestorBoard(),
                reference: investorModel.createReferenceCompany(
                  data.industry
                ),
                rankingKey: crypto.randomUUID(),
                mission: null,
              }
              : room.missionVersion === 1
                ? {
                  board: boardModel.initialBoardRecord(),
                  mission: null,
                }
                : {}),
            history: [],
            opening: null,
            openedRound: -1,
            settledRound: -1,
            ready: false,
            decision: null,
            advice: null,
            advicePlan: null,
            review: [],
            reflection: null,
            feedback: null,
            joinedAt: requestTime,
          });

          transaction.update(reference, {
            playerCount: room.playerCount + 1,
            updatedAt: requestTime,
          });

          transaction.set(membershipRef(person.uid, code), {
            code,
            title: room.title,
            exerciseId,
            accessVersion: 2,
            engineVersion: ENGINE_VERSION,
            scenario: SCENARIO,
            kind: "player",
            createdAt: requestTime,
          });

          return finish({ code });
        }

        if (action === "submit") {
          requireRound(room, data.round);

          if (room.phase !== "decision" || room.paused) {
            fail("failed-precondition", "This round is not accepting decisions.");
          }

          const playerRef = reference.collection("players").doc(person.uid);
          const snapshot = await transaction.get(playerRef);

          if (!snapshot.exists) {
            fail("permission-denied", "Join this session first.");
          }

          const player = snapshot.data();

          if (player.board?.dismissed) {
            fail(
              "failed-precondition",
              "The board has appointed another adviser. You can continue observing."
            );
          }

          if (
            player.openedRound !== room.round ||
            player.settledRound !== room.round - 1
          ) {
            fail(
              "failed-precondition",
              "Wait for the company's round to synchronize."
            );
          }

          let planningState = player.state;

          if (room.dealingVersion === 1) {
            if (data.balanceRevision !== (player.balanceRevision || 0)) {
              fail(
                "failed-precondition",
                "A trade changed your balance. Review the updated plan and submit again."
              );
            }

            const marketPacketSnapshot = await transaction.get(
              packetRef(code, room.round)
            );

            if (!marketPacketSnapshot.exists) {
              fail("failed-precondition", "The market record is missing.");
            }

            const now = Date.now();
            const clock = dealing.marketClock(room.dealing, now);

            if (
              clock.paused ||
              !["live", "grace"].includes(clock.stage)
            ) {
              fail(
                "failed-precondition",
                "Investment-plan submission is not open."
              );
            }

            planningState = dealing.markListed(
              player.state,
              marketPacketSnapshot.data().dealing.path[clock.tick]
            );
          }

          let advicePlan = null;

          if (room.advisorMode === 2) {
            advicePlan = resilience.prepareInvestment(
              planningState,
              data.advice,
              room.rules,
              room.brief
            );
          } else if (room.advisorMode === 1) {
            advicePlan = compileAdvisorPlan(
              player.state,
              data.advice,
              room.rules,
              room.brief
            );
          }

          if (advicePlan && !advicePlan.valid) {
            fail(
              "invalid-argument",
              advicePlan.problems.join(" ")
            );
          }

          /*
           * R2 validates industry costs, term loans and allocations
           * through its own shared planner. Older sessions retain
           * their original validation.
           */
          const decision = room.advisorMode === 2
            ? advicePlan.decision
            : normalizeDecision(
              advicePlan ? advicePlan.decision : data.decision,
              player.state,
              room.rules
            );

          transaction.update(playerRef, {
            decision,
            ready: true,
            planNeedsReview: false,
            submittedAt: Math.max(
              requestTime,
              Number(player.submittedAt || 0) + 1
            ),
            ...(advicePlan
              ? {
                advice: advicePlan.advice,
                advicePlan,
              }
              : {}),
          });

          return finish({ saved: true });
        }

        if (action === "reflect") {
          if (room.phase !== "finished") {
            fail("failed-precondition", "Reflection opens after the final round.");
          }

          const answer = text(data.text, 20, 1800, "Final reflection");
          const reviewKey = text(data.reviewKey, 1, 40, "Review topic");

          const playerRef = reference.collection("players").doc(person.uid);
          const snapshot = await transaction.get(playerRef);

          if (!snapshot.exists) {
            fail("permission-denied", "You are not a session member.");
          }

          const player = snapshot.data();

          if (!player.review.some((item) => item.key === reviewKey)) {
            fail("invalid-argument", "Choose one of your review topics.");
          }

          if (
            player.reflection?.text === answer &&
            player.reflection?.reviewKey === reviewKey
          ) {
            return finish({ saved: true });
          }

          transaction.update(playerRef, {
            reflection: {
              reviewKey,
              text: answer,
              savedAt: Math.max(
                requestTime,
                Number(player.reflection?.savedAt || 0) + 1
              ),
            },
            feedback: null,
          });

          return finish({ saved: true });
        }

        // All remaining actions require this session's actual owner.
        requireOwner(room, access);

        if (action === "feedback") {
          if (room.phase !== "finished") {
            fail("failed-precondition", "The game has not finished.");
          }

          const uid = documentId(data.targetUid, "student ID");
          const feedbackText = text(data.text, 0, 1000, "Feedback");
          const playerRef = reference.collection("players").doc(uid);
          const snapshot = await transaction.get(playerRef);

          if (!snapshot.exists) fail("not-found", "Student not found.");

          const player = snapshot.data();

          if (!player.reflection) {
            fail("failed-precondition", "The student has not submitted a reflection.");
          }

          if (data.reflectionSavedAt !== player.reflection.savedAt) {
            fail(
              "failed-precondition",
              "The student edited this answer. Read the updated version first."
            );
          }

          transaction.update(playerRef, {
            feedback: {
              text: feedbackText,
              reviewed: true,
              savedAt: requestTime,
            },
          });

          return finish({ saved: true });
        }

        if (action === "events" || action === "configure") {
          const target = nextTarget(room);

          if (data.targetRound !== target) {
            fail("failed-precondition", "The event-planning round has changed.");
          }

          const setup = readSetup(
            await transaction.get(privateRef(code))
          );

          if (action === "events") {
            return finish(eventOptions(room, setup, target));
          }

          const settings = room.lessonVersion === 4
            ? normalizeEightSettings(target, data.settings)
            : normalizeEventSettings(target, data.settings);
          const existing = chosenSettings(setup, target);

          if (JSON.stringify(existing) === JSON.stringify(settings)) {
            return finish(eventOptions(room, setup, target));
          }

          if (data.revision !== room.planRevision) {
            fail(
              "failed-precondition",
              "Another teacher tab changed the plan. Reload event options."
            );
          }

          // Validate and derive the selection before saving.
          if (room.lessonVersion === 4) {
            createEightPacket(target, setup.seed, settings);
          } else {
            createPacket(target, setup.seed, settings);
          }

          const updatedSetup = {
            ...setup,
            scheduled: { round: target, settings },
          };

          const revision = room.planRevision + 1;

          transaction.update(privateRef(code), {
            scheduled: updatedSetup.scheduled,
          });

          transaction.update(reference, {
            planRevision: revision,
            updatedAt: requestTime,
          });

          return finish(eventOptions(
            room, updatedSetup, target, revision
          ));
        }

        if (action === "start" || action === "next") {
          let target;

          if (action === "start") {
            if (room.phase !== "lobby" && room.startedAt) {
              return finish({ started: true });
            }

            if (room.phase !== "lobby" || room.playerCount < 1) {
              fail("failed-precondition", "Wait for at least one student to join.");
            }

            target = 0;
          } else {
            if (
              Number.isSafeInteger(data.round) &&
              room.round === data.round + 1
            ) {
              return finish({ advanced: true });
            }

            requireRound(room, data.round);
            target = nextTarget(room);
          }

          if (data.planRevision !== room.planRevision) {
            fail(
              "failed-precondition",
              "The event plan changed. Wait for the teacher screen to update."
            );
          }

          const setup = readSetup(
            await transaction.get(privateRef(code))
          );

          const playersSnapshot = await transaction.get(
            reference.collection("players")
          );

          if (playersSnapshot.size !== room.playerCount) {
            fail("failed-precondition", "The session roster is inconsistent.");
          }

          const packet = room.performanceVersion === 1
            ? createInvestorPacket(
              target,
              setup.seed,
              chosenSettings(setup, target)
            )
            : room.lessonVersion === 4
              ? createEightPacket(
                target,
                setup.seed,
                chosenSettings(setup, target)
              )
              : room.advisorMode === 2
                ? createResiliencePacket(
                  target,
                  setup.seed,
                  chosenSettings(setup, target)
                )
                : createPacket(
                  target,
                  setup.seed,
                  chosenSettings(setup, target)
                );

          let openingMarket = null;

          if (room.dealingVersion === 1) {
            packet.dealing = createTape(
              packet,
              setup.seed,
              room.marketConfig,
              room.dealing?.prices,
              dealing
            );

            packet.brief.companyWatch = packet.dealing.watch;

            openingMarket = initialPublicMarket(
              packet.dealing,
              target,
              requestTime
            );
          }

          if (room.advisorMode === 1) {
            packet.rules = {
              ...packet.rules,
              advisorMode: 1,
            };

            packet.brief.rules = packet.rules;
          }

          const marketIndexes = {
            stocks: Math.round(
              room.marketIndexes.stocks *
              (1 + packet.combined.stockBps / 10000) * 100
            ) / 100,
            property: Math.round(
              room.marketIndexes.property *
              (1 + packet.combined.propertyBps / 10000) * 100
            ) / 100,
          };

          packet.brief.marketIndexes = marketIndexes;

          // No further database reads occur after this point.
          for (const document of playersSnapshot.docs) {
            const player = document.data();

            if (player.settledRound !== target - 1) {
              fail("failed-precondition", "A company has an inconsistent round record.");
            }

            const opening = room.advisorMode === 2
              ? resilience.openCompany(player.state, packet)
              : markOpening(player.state, packet);

            const openedReference = room.performanceVersion === 1
              ? investorModel.openReferenceCompany(
                player.reference,
                packet
              )
              : null;

            transaction.update(document.ref, {
              state: opening.after,
              opening,
              openedRound: target,
              ready: false,
              decision: null,
              advice: null,
              advicePlan: null,
              ...(room.performanceVersion === 1
                ? {
                  reference: openedReference,
                  mission: investorModel.createInvestorMission(
                    opening,
                    openedReference,
                    packet,
                    player.board,
                    room.totalRounds
                  ),
                }
                : room.missionVersion === 1
                  ? {
                    mission: boardModel.createBoardMission(
                      opening,
                      packet,
                      player.board
                    ),
                  }
                  : {}),
              ...(room.dealingVersion === 1
                ? {
                  balanceRevision: (player.balanceRevision || 0) + 1,
                  dealCount: 0,
                  dealLog: [],
                  planNeedsReview: false,
                  lastDealAt: 0,
                }
                : {}),
            });
          }

          // Only the server can read the seed and unresolved demand.
          transaction.create(packetRef(code, target), packet);

          transaction.update(privateRef(code), { scheduled: null });

          transaction.update(reference, {
            round: target,
            phase: "decision",
            paused: false,
            rules: packet.rules,
            brief: publicRound(packet),
            report: null,
            marketIndexes,
            ...(openingMarket ? { dealing: openingMarket } : {}),
            ...(room.advisorMode === 2
              ? {
                briefHistory: [
                  ...(room.briefHistory || []),
                  publicRound(packet),
                ],
              }
              : {}),
            marketHistory: [
              ...room.marketHistory,
              {
                round: target,
                date: packet.brief.date,
                ...marketIndexes,
              },
            ],
            updatedAt: requestTime,
            ...(action === "start" ? { startedAt: requestTime } : {}),
          });

          return finish(
            action === "start" ? { started: true } : { advanced: true }
          );
        }

        requireRound(room, data.round);

        if (action === "pause") {
          if (
            room.phase !== "decision" ||
            typeof data.paused !== "boolean"
          ) {
            fail("failed-precondition", "Only an open round can be paused.");
          }

          transaction.update(reference, {
            paused: data.paused,
            updatedAt: requestTime,
          });

          return finish({ paused: data.paused });
        }

        // Only "resolve" remains.
        if (room.phase === "results" || room.phase === "finished") {
          return finish({ resolved: true });
        }

        if (room.phase !== "decision" || room.paused) {
          fail("failed-precondition", "Resume an open round before settling.");
        }

        const packetSnapshot = await transaction.get(
          packetRef(code, room.round)
        );

        if (!packetSnapshot.exists) {
          fail("failed-precondition", "The round's server record is missing.");
        }

        const packet = packetSnapshot.data();

        if (
          packet.engineVersion !== ENGINE_VERSION ||
          packet.index !== room.round
        ) {
          fail("failed-precondition", "The round uses an incompatible engine.");
        }

        const playersSnapshot = await transaction.get(
          reference.collection("players")
        );

        const missing = playersSnapshot.docs.filter((document) => {
          const player = document.data();
          return (
            !player.state.suspended &&
            !player.board?.dismissed &&
            !player.ready
          );
        });

        if (missing.length && data.force !== true) {
          fail(
            "failed-precondition",
            `${missing.length} student(s) have not submitted.`
          );
        }

        if (
          room.dealingVersion === 1 &&
          dealing.marketClock(room.dealing, Date.now()).stage !== "closed"
        ) {
          fail(
            "failed-precondition",
            "Wait until trading and final adjustments have closed."
          );
        }

        const finished = room.round === room.totalRounds - 1;
        const finalCompanies = [];

        for (const document of playersSnapshot.docs) {
          const player = document.data();

          if (
            player.openedRound !== room.round ||
            player.settledRound !== room.round - 1
          ) {
            fail("failed-precondition", "A company has already settled or is out of sync.");
          }

          if (room.advisorMode === 2) {
            const referenceResult = room.performanceVersion === 1
              ? investorModel.settleReferenceCompany(
                player.reference,
                packet
              )
              : null;

            const closingState =
              room.dealingVersion === 1 && !player.state.suspended
                ? dealing.markListed(
                  player.state,
                  packet.dealing.path[packet.dealing.path.length - 1]
                )
                : player.state;

            const adviserActive = !player.board?.dismissed;
            const submitted = player.ready && adviserActive;

            let investment = null;

            if (!closingState.suspended) {
              investment = submitted
                ? player.advicePlan
                : resilience.prepareInvestment(
                  closingState,
                  resilience.defaultInvestmentPlan(),
                  packet.rules,
                  packet.brief
                );

              if (
                !investment ||
                !investment.valid ||
                investment.version !== 2
              ) {
                fail(
                  "failed-precondition",
                  "A Resilience investment plan is missing or incompatible."
                );
              }
            }

            const entry = resilience.closeCompany(
              closingState,
              investment,
              packet,
              !closingState.suspended && adviserActive && !submitted,
              player.opening
            );

            if (!adviserActive) {
              entry.boardManaged = true;
            }

            if (room.dealingVersion === 1 && !entry.inactive) {
              const beforeTotals = dealing.tradingSummary(
                player.opening.after
              );

              const closeTotals = dealing.tradingSummary(closingState);

              const dealingProfit =
                resilience.companyValue(closingState) -
                resilience.companyValue(player.opening.after);

              const dealingFees = closeTotals.fees - beforeTotals.fees;
              const dealingSpread = closeTotals.spread - beforeTotals.spread;

              entry.metrics.dealingProfit = dealingProfit;
              entry.metrics.dealingFees = dealingFees;
              entry.metrics.dealingSpread = dealingSpread;

              entry.metrics.dealingPriceChange =
                dealingProfit + dealingFees + dealingSpread;
            }

            const boardResult = room.performanceVersion === 1
              ? investorModel.assessInvestor({
                entry,
                referenceEntry: referenceResult.entry,
                mission: player.mission,
                previousBoard: player.board,
                publicShock: Boolean(packet.dealing?.halt),
              })
              : room.missionVersion === 1
                ? boardModel.settleBoardReview(
                  entry,
                  player.mission,
                  player.board,
                  Boolean(packet.dealing?.halt)
                )
                : null;

            if (boardResult) {
              entry.boardReview = boardResult.review;
            }

            if (referenceResult) {
              entry.reference = {
                closingWorth: resilience.companyValue(
                  referenceResult.entry.after
                ),
                businessProfit: referenceResult.entry.metrics.netProfit,
                operatingCashFlow:
                  referenceResult.entry.metrics.operatingCashFlow,
              };
            }

            const history = [...player.history, entry];

            const completedPlayer = {
              ...player,
              state: entry.after,
              history,
              ...(boardResult ? { board: boardResult.board } : {}),
              ...(referenceResult
                ? { reference: referenceResult.reference }
                : {}),
            };

            const ending = finished
              ? {
                ...resilience.finalCompanyReport(
                  completedPlayer,
                  packet
                ),
                ...(room.dealingVersion === 1
                  ? { dealing: dealing.tradingSummary(entry.after) }
                  : {}),
                ...(boardResult ? { board: boardResult.board } : {}),
                ...(room.performanceVersion === 1
                  ? {
                    performance: investorModel.describeInvestorResult(
                      boardResult.board
                    ),
                  }
                  : {}),
              }
              : null;

            if (room.performanceVersion === 1) {
              finalCompanies.push({
                ...completedPlayer,
                ending,
              });
            }

            transaction.update(document.ref, {
              state: entry.after,
              history,
              settledRound: room.round,
              ready: false,
              decision: null,
              advice: null,
              advicePlan: null,
              planNeedsReview: false,
              balanceRevision: (player.balanceRevision || 0) + 1,
              ...(boardResult ? { board: boardResult.board } : {}),
              ...(referenceResult
                ? { reference: referenceResult.reference }
                : {}),
              ...(finished
                ? {
                  review: resilience.buildCompanyReview(
                    history,
                    room.reflectionLimit
                  ),
                  ending,
                }
                : {}),
            });

            continue;
          }

          let settlementDecision = player.ready
            ? player.decision
            : defaultDecision();

          let savedAdvice = null;
          let savedAdvicePlan = null;

          if (room.advisorMode === 1 && !player.state.suspended) {
            if (player.ready) {
              savedAdvice = player.advice;
              savedAdvicePlan = player.advicePlan;

              if (
                !savedAdvice ||
                !savedAdvicePlan ||
                savedAdvicePlan.version !== 1
              ) {
                fail(
                  "failed-precondition",
                  "A submitted adviser plan is incomplete. Ask the student to refresh and resubmit."
                );
              }

              /*
               * Use the monetary instructions saved at submission.
               * Do not recalculate a submitted percentage allocation.
               */
              settlementDecision = player.decision;
            } else {
              /*
               * A missing submission makes no new investments, takes
               * no new loans and recommends no factory change.
               * Management still runs a neutral operating plan using
               * only public information and available cash.
               */
              savedAdvicePlan = compileAdvisorPlan(
                player.state,
                defaultAdvice(),
                packet.rules,
                packet.brief
              );

              if (!savedAdvicePlan.valid) {
                fail(
                  "failed-precondition",
                  "Management could not prepare a default operating plan: " +
                  savedAdvicePlan.problems.join(" ")
                );
              }

              savedAdvice = savedAdvicePlan.advice;
              settlementDecision = savedAdvicePlan.decision;
            }
          }

          const entry = settle(
            player.state,
            settlementDecision,
            packet,
            !player.state.suspended && !player.ready,
            player.opening
          );

          if (savedAdvicePlan) {
            entry.advisor = {
              version: 1,
              advice: savedAdvice,
              plan: savedAdvicePlan,
            };
          }

          const history = [...player.history, entry];

          transaction.update(document.ref, {
            state: entry.after,
            history,
            settledRound: room.round,
            ready: false,
            decision: null,
            advice: null,
            advicePlan: null,
            ...(finished
              ? {
                review: room.advisorMode === 1
                  ? makeAdvisorReview(history, room.reflectionLimit)
                  : makeReview(history, room.reflectionLimit),
              }
              : {}),
          });
        }

        transaction.update(reference, {
          phase: finished ? "finished" : "results",
          report: publicReport(packet),
          ...(finished && room.performanceVersion === 1
            ? {
              finalRanking: investorModel.buildInvestmentRanking(
                finalCompanies
              ),
            }
            : {}),
          ...(room.dealingVersion === 1
            ? {
              dealing: revealMarket(
                room.dealing,
                packet.dealing,
                Date.now(),
                dealing
              ),
            }
            : {}),
          paused: false,
          updatedAt: requestTime,
          ...(finished ? { finishedAt: requestTime } : {}),
        });

        return finish({ resolved: true, finished });
      });
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;

      if (error instanceof GameError) {
        throw new functions.https.HttpsError(
          "invalid-argument", error.message
        );
      }

      console.error("History game API error:", error);

      throw new functions.https.HttpsError(
        "internal",
        "The game could not complete this request. Please try again."
      );
    }
  });