const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { randomInt, createHash } = require("node:crypto");

const db = admin.firestore();
const root = db.collection("kt_private").doc("main");

const questions = root.collection("questions");
const users = root.collection("users");
const presets = root.collection("presets");
const assignments = root.collection("assignments");
const catalogRef = root.collection("state").doc("catalog");

const SUPER_ADMIN = "clng@ktls.edu.hk";

const TOPICS = [
    { id: "japan", label: "Japan", theme: "A" },
    { id: "china", label: "China", theme: "A" },
    { id: "hong-kong", label: "Hong Kong", theme: "A" },
    { id: "ww1", label: "World War I", theme: "B" },
    { id: "ww2", label: "World War II", theme: "B" },
    { id: "cold-war", label: "Cold War", theme: "B" },
    { id: "cooperation", label: "International Cooperation", theme: "B" }
];

const topicIds = new Set(TOPICS.map(t => t.id));
const MAX_BANK = 2500;

function fail(message, code = "invalid-argument") {
    throw new functions.https.HttpsError(code, message);
}

function requireValue(condition, message, code) {
    if (!condition) fail(message, code);
}

function emailOf(value) {
    const email = String(value || "").toLowerCase().trim();
    requireValue(
        email.length <= 254 &&
        /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email),
        "Invalid email address."
    );
    return email;
}

function idOf(value) {
    requireValue(
        typeof value === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value),
        "Invalid record ID."
    );
    return value;
}

function text(value, name, max, optional = false) {
    const result = String(value ?? "").trim();
    requireValue(optional || result.length > 0, `${name} is required.`);
    requireValue(result.length <= max, `${name} is too long.`);
    return result;
}

function integer(value, min, max, name) {
    requireValue(
        Number.isInteger(value) && value >= min && value <= max,
        `${name} must be between ${min} and ${max}.`
    );
    return value;
}

function stringList(value, name, min = 2, max = 6) {
    requireValue(
        Array.isArray(value) && value.length >= min && value.length <= max,
        `${name} must contain ${min}–${max} items.`
    );
    return value.map((item, i) => text(item, `${name} ${i + 1}`, 400));
}

function permutation(value, length, name) {
    requireValue(
        Array.isArray(value) &&
        value.length === length &&
        value.every(n => Number.isInteger(n) && n >= 0 && n < length) &&
        new Set(value).size === length,
        `${name} must use every item exactly once.`
    );
    return [...value];
}

function cleanTopics(value) {
    requireValue(
        Array.isArray(value) && value.length > 0 && value.length <= 7,
        "Select at least one topic."
    );
    const result = [...new Set(value)];
    requireValue(result.every(t => topicIds.has(t)), "Unknown topic.");
    return TOPICS.filter(t => result.includes(t.id)).map(t => t.id);
}

function normalize(value) {
    return String(value)
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("en");
}

function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function cleanQuestion(raw) {
    requireValue(raw && typeof raw === "object", "Invalid question.");
    const id = idOf(raw.id);
    requireValue(id.length <= 48, "Question IDs must be at most 48 characters.");
    requireValue(topicIds.has(raw.topic), `${id}: invalid topic.`);

    const expectedTheme = TOPICS.find(t => t.id === raw.topic).theme;
    requireValue(
        String(raw.theme || expectedTheme).toUpperCase() === expectedTheme,
        `${id}: theme does not match topic.`
    );

    requireValue(
        ["mc", "matching", "sequence", "blank"].includes(raw.type),
        `${id}: invalid question type.`
    );

    requireValue(
        typeof raw.active === "boolean" && typeof raw.demo === "boolean",
        `${id}: Active and Demo must be TRUE or FALSE.`
    );

    const q = {
        id,
        theme: expectedTheme,
        topic: raw.topic,
        type: raw.type,
        subtopic: text(raw.subtopic, `${id}: revision subtopic`, 160),
        prompt: text(raw.prompt, `${id}: question`, 1600),
        explanation: text(raw.explanation, `${id}: explanation`, 2400),
        active: raw.active,
        demo: raw.demo
    };

    if (q.type === "mc") {
        q.choices = stringList(raw.choices, `${id}: options`, 4, 4);
        requireValue(
            new Set(q.choices.map(normalize)).size === 4,
            `${id}: MC options must be different.`
        );
        q.answer = integer(raw.answer, 0, 3, `${id}: correct answer`);
    }

    if (q.type === "matching") {
        q.left = stringList(raw.left, `${id}: left items`);
        q.right = stringList(raw.right, `${id}: right items`);
        requireValue(
            q.left.length === q.right.length,
            `${id}: both sides must contain the same number of items.`
        );
        requireValue(
            new Set(q.right.map(normalize)).size === q.right.length,
            `${id}: right-side choices must be different.`
        );
        q.answer = permutation(raw.answer, q.left.length, `${id}: matches`);
    }

    if (q.type === "sequence") {
        q.items = stringList(raw.items, `${id}: sequencing items`);
        requireValue(
            new Set(q.items.map(normalize)).size === q.items.length,
            `${id}: sequencing items must be different.`
        );
        q.answer = permutation(raw.answer, q.items.length, `${id}: order`);
    }

    if (q.type === "blank") {
        q.answer = stringList(raw.answer, `${id}: accepted answers`, 1, 12);
    }

    requireValue(
        Buffer.byteLength(JSON.stringify(q), "utf8") < 10000,
        `${id}: question is too large.`
    );

    // Active/demo changes do not reset recovery. Content changes do.
    const versionContent = { ...q };
    delete versionContent.active;
    delete versionContent.demo;

    q.revision = createHash("sha256")
        .update(JSON.stringify(versionContent))
        .digest("hex")
        .slice(0, 24);

    return q;
}

async function actorFor(context) {
    requireValue(
        context.auth &&
        context.auth.token.email &&
        context.auth.token.email_verified === true,
        "Please sign in with a verified account.",
        "unauthenticated"
    );

    const email = emailOf(context.auth.token.email);
    const superadmin = email === SUPER_ADMIN;
    const roleSnap = await db.collection("user_roles").doc(email).get();

    requireValue(
        superadmin || roleSnap.exists,
        "Your account does not have access.",
        "permission-denied"
    );

    const role = superadmin ? "admin" : roleSnap.data().role;

    return {
        email,
        uid: context.auth.uid,
        role,
        admin: superadmin || role === "admin",
        superadmin
    };
}

function requireAdmin(actor) {
    requireValue(actor.admin, "Administrator access required.", "permission-denied");
}

async function permittedClasses(actor) {
    if (actor.superadmin) return null;

    const snap = await db.collection("user_students").doc(actor.email).get();
    if (!snap.exists) return [];

    const mapping = snap.data();
    if (
        mapping.role !== actor.role ||
        !Array.isArray(mapping.assignedClasses)
    ) return [];

    const classes = [...new Set(
        mapping.assignedClasses.filter(c => typeof c === "string" && c.length > 0)
    )];

    if (mapping.classAccessMode === "ownClass" && classes.length !== 1) {
        return [];
    }

    return classes;
}

async function rosterFor(actor) {
    requireAdmin(actor);

    const [roleSnap, studentSnap, classes] = await Promise.all([
        db.collection("user_roles").get(),
        db.collection("students").get(),
        permittedClasses(actor)
    ]);

    const profiles = new Map();

    studentSnap.forEach(doc => {
        const p = doc.data();
        const email = String(p.email || "").toLowerCase().trim();
        if (!email) return;
        if (!profiles.has(email)) profiles.set(email, []);
        profiles.get(email).push(p);
    });

    const roster = [];

    roleSnap.forEach(doc => {
        const email = doc.id.toLowerCase().trim();
        const role = doc.data().role;
        if (role === "admin" || email === SUPER_ADMIN) return;

        const matches = profiles.get(email) || [];
        const allowed = actor.superadmin
            ? matches
            : matches.filter(p => classes.includes(p.className));

        if (!actor.superadmin && allowed.length === 0) return;

        const profile = allowed[0] || matches[0] || {};

        roster.push({
            email,
            role: role || "",
            name: profile.englishName || email.split("@")[0],
            className: [...new Set(
                allowed.map(p => p.className).filter(Boolean)
            )].join(" / ") || profile.className || "",

            classNames: [...new Set(
                allowed
                    .map(p => p.className)
                    .filter(name => typeof name === "string" && name.length > 0)
            )]
        });
    });

    return roster.sort((a, b) =>
        `${a.className} ${a.name}`.localeCompare(`${b.className} ${b.name}`)
    );
}

async function authorizeTarget(actor, rawEmail) {
    const email = rawEmail ? emailOf(rawEmail) : actor.email;
    if (email === actor.email) return email;

    requireAdmin(actor);

    if (actor.superadmin) {
        const role = await db.collection("user_roles").doc(email).get();
        requireValue(role.exists, "This account is no longer registered.", "not-found");
        return email;
    }

    const roster = await rosterFor(actor);
    requireValue(
        roster.some(s => s.email === email),
        "This student is outside your assigned classes.",
        "permission-denied"
    );
    return email;
}

function userRef(email) {
    return users.doc(email);
}

function stateRef(email) {
    return userRef(email).collection("state").doc("selection");
}

function attemptsRef(email) {
    return userRef(email).collection("attempts");
}

function progressRef(email) {
    return userRef(email).collection("progress");
}

function emptySummary(email) {
    return {
        email,
        completed: 0,
        totalAnswered: 0,
        totalCorrect: 0,
        unresolved: 0,
        stats: {},
        activeAttemptId: null,
        lastActivity: null
    };
}

function attemptSummary(a) {
    return {
        id: a.id,
        title: a.title,
        status: a.status,
        createdAt: a.createdAt,
        submittedAt: a.submittedAt || null,
        total: a.questions.length,
        correct: a.correct ?? null,
        preview: a.preview,
        topics: a.topics,
        assignmentId: a.assignmentId || null,
        assignmentCredit: a.assignmentCredit || null
    };
}

function publicQuestion(q) {
    const result = {
        id: q.id,
        type: q.type,
        topic: q.topic,
        theme: q.theme,
        subtopic: q.subtopic,
        prompt: q.prompt,
        demo: q.demo
    };

    for (const key of ["choices", "left", "right", "items"]) {
        if (q[key]) result[key] = q[key];
    }

    if (q.topicIds) result.topicIds = q.topicIds;
    if (q.generatedKind) result.generatedKind = q.generatedKind;
    if (q.reviewEvents) result.reviewEvents = q.reviewEvents;

    if (q.zh) {
        result.zh = {
            subtopic: q.zh.subtopic,
            prompt: q.zh.prompt
        };

        for (const key of ["choices", "left", "right", "items"]) {
            if (q.zh[key]) result.zh[key] = q.zh[key];
        }
    }

    // Do not include answers, explanations, event years,
    // event records, or private event mappings in active attempts.
    return result;
}

function publicAttempt(a) {
    if (a.status === "submitted") return a;

    return {
        id: a.id,
        title: a.title,
        status: a.status,
        preview: a.preview,
        topics: a.topics,
        createdAt: a.createdAt,
        assignmentId: a.assignmentId,
        questions: a.questions.map(publicQuestion),
        answers: a.answers || {},
        answerRevision: a.answerRevision || 0
    };
}

// Randomize the actual transmitted item arrays, not just the display.
function prepareQuestion(q) {
    const result = {
        ...q,
        theme: TOPICS.find(t => t.id === q.topic)?.theme || q.theme
    };

    if (q.type === "mc") {
        const order = shuffle(q.choices.map((_, i) => i));

        result.choices = order.map(i => q.choices[i]);
        result.answer = order.indexOf(q.answer);
    }

    if (q.type === "matching") {
        const leftOrder = shuffle(q.left.map((_, i) => i));
        const rightOrder = shuffle(q.right.map((_, i) => i));

        result.left = leftOrder.map(i => q.left[i]);
        result.right = rightOrder.map(i => q.right[i]);

        result.answer = leftOrder.map(originalLeftIndex =>
            rightOrder.indexOf(q.answer[originalLeftIndex])
        );
    }

    if (q.type === "sequence") {
        const order = shuffle(q.items.map((_, i) => i));

        result.items = order.map(i => q.items[i]);
        result.answer = q.answer.map(i => order.indexOf(i));
    }

    return result;
}

function chooseQuestions(catalog, selectedTopics, entries) {
    const pools = {};
    const quotas = {};
    const topicOrder = shuffle(selectedTopics);

    for (const topic of topicOrder) {
        pools[topic] = shuffle(
            catalog.filter(q => q.active && q.topic === topic)
        );
        quotas[topic] = 0;
        requireValue(
            pools[topic].length > 0,
            `No active questions are available for ${TOPICS.find(t => t.id === topic).label
            }.`,
            "failed-precondition"
        );
    }

    const total = Math.min(
        20,
        topicOrder.reduce((sum, topic) => sum + pools[topic].length, 0)
    );

    // Round-robin allocation redistributes unused places.
    let allocated = 0;
    while (allocated < total) {
        for (const topic of topicOrder) {
            if (allocated === total) break;
            if (quotas[topic] < pools[topic].length) {
                quotas[topic]++;
                allocated++;
            }
        }
    }

    const chosen = [];
    const chosenIds = new Set();
    const topicCounts = Object.fromEntries(topicOrder.map(t => [t, 0]));

    const take = q => {
        chosen.push(q.id);
        chosenIds.add(q.id);
        topicCounts[q.topic]++;
    };

    let changed = true;

    // Reserve up to twelve places for unresolved mistakes.
    while (chosen.length < Math.min(12, total) && changed) {
        changed = false;
        for (const topic of topicOrder) {
            if (chosen.length >= Math.min(12, total)) break;
            if (topicCounts[topic] >= quotas[topic]) continue;

            const q = pools[topic].find(item =>
                !chosenIds.has(item.id) && entries[item.id]?.needsRevision
            );

            if (q) {
                take(q);
                changed = true;
            }
        }
    }

    for (const topic of topicOrder) {
        const remaining = pools[topic].filter(q => !chosenIds.has(q.id));

        const fresh = remaining.filter(q => !entries[q.id]?.seen);
        const ordinary = remaining.filter(q =>
            entries[q.id]?.seen && !entries[q.id]?.needsRevision
        );
        const reviewFallback = remaining.filter(q =>
            entries[q.id]?.seen && entries[q.id]?.needsRevision
        );

        for (const q of [...fresh, ...ordinary, ...reviewFallback]) {
            if (topicCounts[topic] >= quotas[topic]) break;
            take(q);
        }
    }

    return shuffle(chosen);
}

function cleanAnswers(questionList, raw, required) {
    requireValue(
        raw && typeof raw === "object" && !Array.isArray(raw),
        "Invalid answers."
    );

    const result = {};

    for (const q of questionList) {
        let value = raw[q.id];

        if (value === undefined || value === null) {
            requireValue(!required, `Please answer question ${q.id}.`);
            continue;
        }

        if (q.type === "mc") {
            value = integer(value, 0, q.choices.length - 1, "Selected option");
        }

        if (q.type === "blank") {
            value = text(value, "Answer", 400, !required);
            if (!value && !required) continue;
        }

        if (q.type === "sequence") {
            if (!required && Array.isArray(value) && value.length === 0) continue;
            value = permutation(value, q.items.length, "Your sequence");
        }

        if (q.type === "matching") {
            requireValue(
                Array.isArray(value) && value.length === q.left.length,
                "Please complete the matching question."
            );

            value = value.map(item =>
                item === "" || item === null ? null :
                    integer(item, 0, q.right.length - 1, "Selected match")
            );

            const selected = value.filter(item => item !== null);
            requireValue(
                new Set(selected).size === selected.length,
                "Use each matching choice only once."
            );
            requireValue(
                !required || selected.length === q.left.length,
                "Please complete every matching pair."
            );
        }

        result[q.id] = value;
    }

    return result;
}

function isCorrect(q, answer) {
    if (q.type === "blank") {
        return q.answer.some(accepted => normalize(accepted) === normalize(answer));
    }
    return JSON.stringify(q.answer) === JSON.stringify(answer);
}

async function historyFor(email, cursor) {
    let query = attemptsRef(email).orderBy("createdAt", "desc").limit(21);

    if (cursor) {
        const snap = await attemptsRef(email).doc(idOf(cursor)).get();
        requireValue(snap.exists, "History cursor no longer exists.");
        query = query.startAfter(snap);
    }

    const snap = await query.get();
    const records = snap.docs.slice(0, 20).map(d => attemptSummary(d.data()));

    return {
        records,
        next: snap.size > 20 ? records[records.length - 1].id : null
    };
}

async function homeFor(actor) {
    const [catalog, summary, presetSnap, assignmentSnap] = await Promise.all([
        catalogRef.get(),
        userRef(actor.email).get(),
        presets.get(),
        assignments.where("email", "==", actor.email).get()
    ]);

    const items = catalog.data()?.items || [];

    return {
        actor,
        topics: TOPICS.map(t => ({
            ...t,
            ...foundation.topicCounts(items, t.id)
        })),
        summary: summary.exists ? summary.data() : emptySummary(actor.email),
        presets: presetSnap.docs.map(d => d.data()).sort((a, b) =>
            a.name.localeCompare(b.name)
        ),
        assignments: assignmentSnap.docs.map(d => d.data())
            .sort((a, b) => b.createdAt - a.createdAt)
    };
}

async function startAttempt(actor, data) {
    let selectedTopics;
    let title;
    let assignment = null;

    if (data.assignmentId) {
        requireValue(!actor.admin, "Assignments are completed by students.");
        const snap = await assignments.doc(idOf(data.assignmentId)).get();

        requireValue(snap.exists, "Assignment not found.", "not-found");
        assignment = snap.data();

        requireValue(
            assignment.email === actor.email,
            "This assignment belongs to another student.",
            "permission-denied"
        );

        selectedTopics = assignment.topics;
        title = assignment.title;
    } else if (data.presetId) {
        const snap = await presets.doc(idOf(data.presetId)).get();
        requireValue(snap.exists, "Preset not found.", "not-found");
        selectedTopics = cleanTopics(snap.data().topics);
        title = snap.data().name;
    } else {
        selectedTopics = cleanTopics(data.topics);
        title = selectedTopics.length === 1
            ? TOPICS.find(t => t.id === selectedTopics[0]).label
            : "Custom mixed practice";
    }

    const newRef = attemptsRef(actor.email).doc();

    return db.runTransaction(async tx => {
        const [userSnap, stateSnap, catalogSnap] = await Promise.all([
            tx.get(userRef(actor.email)),
            tx.get(stateRef(actor.email)),
            tx.get(catalogRef)
        ]);

        const summary = userSnap.exists
            ? userSnap.data()
            : emptySummary(actor.email);

        if (summary.activeAttemptId) {
            const activeSnap = await tx.get(
                attemptsRef(actor.email).doc(summary.activeAttemptId)
            );

            if (activeSnap.exists && activeSnap.data().status === "active") {
                return publicAttempt(activeSnap.data());
            }
        }

        let liveAssignment = null;

        if (assignment) {
            const snap = await tx.get(assignments.doc(assignment.id));
            liveAssignment = snap.data();

            requireValue(
                liveAssignment &&
                liveAssignment.email === actor.email &&
                !liveAssignment.cancelled,
                "This assignment is no longer available.",
                "failed-precondition"
            );

            requireValue(
                Date.now() >= liveAssignment.startsAt,
                "This assignment has not started yet.",
                "failed-precondition"
            );
        }

        const ids = chooseQuestions(
            catalogSnap.data()?.items || [],
            selectedTopics,
            stateSnap.data()?.entries || {}
        );

        if (liveAssignment) {
            requireValue(
                ids.length === 20,
                "An assignment requires at least 20 active questions in its selected topics.",
                "failed-precondition"
            );
        }

        const questionSnaps = await tx.getAll(
            ...ids.map(id => questions.doc(id))
        );

        requireValue(
            questionSnaps.every(s => s.exists && s.data().active),
            "The question bank changed. Please try again.",
            "aborted"
        );

        const now = Date.now();

        const attempt = {
            id: newRef.id,
            email: actor.email,
            uid: actor.uid,
            title,
            topics: selectedTopics,
            assignmentId: liveAssignment?.id || null,
            preview: actor.admin,
            createdAt: now,
            status: "active",
            questions: questionSnaps.map(s => prepareQuestion(s.data())),
            answers: {}
        };

        tx.create(newRef, attempt);
        tx.set(userRef(actor.email), {
            ...summary,
            activeAttemptId: newRef.id
        });

        return publicAttempt(attempt);
    });
}

async function saveAttempt(actor, data, abandon = false) {
    const ref = attemptsRef(actor.email).doc(idOf(data.id));

    return db.runTransaction(async tx => {
        const [snap, userSnap] = await Promise.all([
            tx.get(ref),
            tx.get(userRef(actor.email))
        ]);

        requireValue(snap.exists, "Exercise not found.", "not-found");
        const a = snap.data();

        requireValue(
            a.status === "active",
            "This exercise is no longer active. Reload the page.",
            "failed-precondition"
        );

        if (abandon) {
            tx.update(ref, {
                status: "abandoned",
                abandonedAt: Date.now()
            });

            if (userSnap.data()?.activeAttemptId === a.id) {
                tx.update(userRef(actor.email), { activeAttemptId: null });
            }

            return { ok: true };
        }

        const saveId = idOf(data.saveId);
        const currentRevision = a.answerRevision || 0;

        // Retry after an uncertain network response: do not save twice.
        if (a.lastSaveId === saveId) {
            return {
                ok: true,
                answerRevision: currentRevision,
                savedAt: a.savedAt
            };
        }

        requireValue(
            Number.isInteger(data.expectedRevision) &&
            data.expectedRevision === currentRevision,
            "This exercise changed in another tab or device. Reload before continuing.",
            "failed-precondition"
        );

        const answers = cleanAnswers(
            a.questions,
            data.answers || {},
            false
        );

        const savedAt = Date.now();
        const answerRevision = currentRevision + 1;

        tx.update(ref, {
            answers,
            answerRevision,
            lastSaveId: saveId,
            savedAt
        });

        return { ok: true, answerRevision, savedAt };
    });
}

async function submitAttempt(actor, data) {
    const ref = attemptsRef(actor.email).doc(idOf(data.id));

    return db.runTransaction(async tx => {
        const [snap, userSnap, selectionSnap] = await Promise.all([
            tx.get(ref),
            tx.get(userRef(actor.email)),
            tx.get(stateRef(actor.email))
        ]);

        requireValue(snap.exists, "Exercise not found.", "not-found");
        const attempt = snap.data();

        // A retry of the same submission returns the existing report.
        if (attempt.status === "submitted") return attempt;

        requireValue(attempt.status === "active", "This exercise is no longer active.");

        requireValue(
            Number.isInteger(data.expectedRevision) &&
            data.expectedRevision === (attempt.answerRevision || 0),
            "Your saved answers changed. Reload the exercise before submitting.",
            "failed-precondition"
        );

        const answers = cleanAnswers(
            attempt.questions,
            attempt.answers || {},
            true
        );
        const results = attempt.questions.map(q => ({
            id: q.id,
            submitted: answers[q.id],
            correct: isCorrect(q, answers[q.id])
        }));

        const correct = results.filter(r => r.correct).length;
        const now = Date.now();

        let assignmentSnap = null;

        if (attempt.assignmentId && !attempt.preview) {
            assignmentSnap = await tx.get(assignments.doc(attempt.assignmentId));
        }

        const progressSnaps = attempt.preview
            ? []
            : await tx.getAll(
                ...attempt.questions.map(q => progressRef(actor.email).doc(q.id))
            );

        // All transaction reads are above; writes begin below.
        let credit = null;

        if (assignmentSnap?.exists) {
            const assignment = assignmentSnap.data();

            if (assignment.cancelled) {
                credit = "cancelled";
            } else if (
                assignment.email === actor.email &&
                attempt.questions.length === 20 &&
                attempt.createdAt >= assignment.startsAt
            ) {
                credit = now <= assignment.dueAt ? "on-time" : "late";

                tx.update(assignmentSnap.ref, {
                    completed: (assignment.completed || 0) + (credit === "on-time" ? 1 : 0),
                    late: (assignment.late || 0) + (credit === "late" ? 1 : 0),
                    lastSubmissionAt: now
                });
            }
        }

        const finished = {
            ...attempt,
            answers,
            results,
            correct,
            submittedAt: now,
            status: "submitted",
            assignmentCredit: credit
        };

        tx.set(ref, finished);

        const summary = userSnap.exists
            ? userSnap.data()
            : emptySummary(actor.email);

        if (summary.activeAttemptId === attempt.id) summary.activeAttemptId = null;

        if (!attempt.preview) {
            const entries = { ...(selectionSnap.data()?.entries || {}) };
            const stats = { ...(summary.stats || {}) };
            const usedTopics = new Set();

            attempt.questions.forEach((q, index) => {
                const result = results[index];
                const old = progressSnaps[index].data() || {};
                const sameVersion = old.revision === q.revision;

                let needsRevision = sameVersion
                    ? Boolean(old.needsRevision)
                    : Boolean(old.everWrong);

                let streak = sameVersion ? old.streak || 0 : 0;

                if (!result.correct) {
                    needsRevision = true;
                    streak = 0;
                } else if (needsRevision) {
                    streak = Math.min(2, streak + 1);
                    if (streak >= 2) needsRevision = false;
                }

                const progress = {
                    ...old,
                    id: q.id,
                    topic: q.topic,
                    revision: q.revision,
                    seen: (old.seen || 0) + 1,
                    everWrong: Boolean(old.everWrong || !result.correct),
                    wrongCount: (old.wrongCount || 0) + (result.correct ? 0 : 1),
                    needsRevision,
                    streak,
                    lastSeenAt: now,
                    lastCorrect: result.correct
                };

                if (!result.correct) {
                    progress.lastWrongAt = now;
                    progress.lastWrong = {
                        question: q,
                        submitted: result.submitted
                    };
                }

                entries[q.id] = {
                    seen: progress.seen,
                    needsRevision,
                    streak,
                    revision: q.revision
                };

                tx.set(progressRef(actor.email).doc(q.id), progress);

                stats[q.topic] = {
                    ...(stats[q.topic] || { runs: 0, answered: 0, correct: 0 }),
                    answered: (stats[q.topic]?.answered || 0) + 1,
                    correct: (stats[q.topic]?.correct || 0) + (result.correct ? 1 : 0)
                };

                usedTopics.add(q.topic);
            });

            usedTopics.forEach(topic => {
                stats[topic].runs = (stats[topic].runs || 0) + 1;
            });

            Object.assign(summary, {
                completed: (summary.completed || 0) + 1,
                totalAnswered: (summary.totalAnswered || 0) + attempt.questions.length,
                totalCorrect: (summary.totalCorrect || 0) + correct,
                unresolved: Object.values(entries).filter(e => e.needsRevision).length,
                stats,
                lastActivity: now
            });

            tx.set(stateRef(actor.email), { entries });
        }

        tx.set(userRef(actor.email), summary);
        return finished;
    });
}

async function profileFor(actor, data) {
    const email = await authorizeTarget(actor, data.email);

    const [summary, progress, history] = await Promise.all([
        userRef(email).get(),
        progressRef(email).get(),
        historyFor(email, null)
    ]);

    const mistakes = progress.docs
        .map(d => d.data())
        .filter(p => p.everWrong)
        .sort((a, b) =>
            Number(b.needsRevision) - Number(a.needsRevision) ||
            (b.lastWrongAt || 0) - (a.lastWrongAt || 0)
        );

    const page = integer(data.page ?? 0, 0, 1000, "Page");

    return {
        email,
        summary: summary.exists ? summary.data() : emptySummary(email),
        mistakes: mistakes.slice(page * 25, page * 25 + 25),
        mistakeCount: mistakes.length,
        page,
        history
    };
}

async function adminOverview(actor) {
    const roster = await rosterFor(actor);
    const records = [];

    for (let i = 0; i < roster.length; i += 100) {
        const group = roster.slice(i, i + 100);
        const snaps = await db.getAll(...group.map(s => userRef(s.email)));

        group.forEach((student, index) => {
            records.push({
                ...student,
                summary: snaps[index].exists
                    ? snaps[index].data()
                    : emptySummary(student.email)
            });
        });
    }

    const assignmentSnap = actor.superadmin
        ? await assignments.get()
        : await assignments.where("creator", "==", actor.email).get();

    const allowedEmails = new Set(roster.map(s => s.email));

    return {
        students: records,
        assignments: assignmentSnap.docs.map(d => d.data())
            .filter(a => allowedEmails.has(a.email))
            .sort((a, b) => b.createdAt - a.createdAt)
    };
}

async function savePreset(actor, data) {
    requireAdmin(actor);

    const id = idOf(data.id);
    const ref = presets.doc(id);
    const preset = {
        id,
        name: text(data.name, "Preset name", 100),
        topics: cleanTopics(data.topics),
        creator: actor.email,
        createdAt: Date.now()
    };

    await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (snap.exists) {
            requireValue(
                snap.data().creator === actor.email,
                "This preset ID is already in use.",
                "permission-denied"
            );
            return;
        }
        tx.create(ref, preset);
    });

    return { ok: true };
}

async function createAssignments(actor, data) {
    requireAdmin(actor);

    const requestId = idOf(data.requestId);
    requireValue(
        Array.isArray(data.emails) &&
        data.emails.length > 0 &&
        data.emails.length <= 100,
        "Select 1–100 students per assignment batch."
    );

    const emails = [...new Set(data.emails.map(emailOf))];
    const roster = await rosterFor(actor);
    const permitted = new Set(roster.map(s => s.email));

    requireValue(
        emails.every(email => permitted.has(email)),
        "One or more students are outside your permitted roster.",
        "permission-denied"
    );

    let selectedTopics;
    let title;

    if (data.presetId) {
        const preset = await presets.doc(idOf(data.presetId)).get();
        requireValue(preset.exists, "Preset not found.");
        selectedTopics = cleanTopics(preset.data().topics);
        title = preset.data().name;
    } else {
        selectedTopics = cleanTopics(data.topics);
        title = selectedTopics.length === 1
            ? TOPICS.find(t => t.id === selectedTopics[0]).label
            : "Assigned mixed practice";
    }

    const target = integer(data.target, 1, 50, "Required exercises");
    const startsAt = Number(data.startsAt);
    const dueAt = Number(data.dueAt);

    requireValue(
        Number.isFinite(startsAt) &&
        Number.isFinite(dueAt) &&
        dueAt > startsAt &&
        dueAt - startsAt <= 31 * 86400000,
        "Choose a valid assignment window of no more than 31 days."
    );

    const catalog = await catalogRef.get();
    const availability = foundation.readiness(
        catalog.data()?.items || [],
        selectedTopics
    );

    requireValue(
        availability.ready,
        availability.reason,
        "failed-precondition"
    );

    const refs = emails.map(email => assignments.doc(
        `${requestId}_${createHash("sha256").update(email).digest("hex").slice(0, 20)}`
    ));

    await db.runTransaction(async tx => {
        const existing = await tx.getAll(...refs);
        const now = Date.now();

        refs.forEach((ref, index) => {
            if (existing[index].exists) {
                requireValue(
                    existing[index].data().creator === actor.email,
                    "Assignment request ID is already in use.",
                    "permission-denied"
                );
                return;
            }

            tx.create(ref, {
                id: ref.id,
                email: emails[index],
                creator: actor.email,
                title,
                topics: selectedTopics,
                presetId: data.presetId || null,
                target,
                compulsory: data.compulsory !== false,
                startsAt,
                dueAt,
                createdAt: now,
                completed: 0,
                late: 0,
                cancelled: false,
                notificationsEnabled: false
            });
        });
    });

    return { ok: true, count: emails.length };
}

async function cancelAssignment(actor, data) {
    requireAdmin(actor);
    const ref = assignments.doc(text(data.id, "Assignment ID", 120));

    await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        requireValue(snap.exists, "Assignment not found.");

        requireValue(
            actor.superadmin || snap.data().creator === actor.email,
            "Only the assigning administrator or superadmin can cancel this assignment.",
            "permission-denied"
        );

        tx.update(ref, { cancelled: true, cancelledAt: Date.now() });
    });

    return { ok: true };
}

async function importQuestions(actor, data, validateOnly) {
    requireAdmin(actor);

    requireValue(
        Array.isArray(data.rows) && data.rows.length > 0 && data.rows.length <= 75,
        "Import 1–75 questions per batch."
    );

    const cleaned = [];
    const errors = [];

    data.rows.forEach((row, index) => {
        try {
            cleaned.push(cleanQuestion(row));
        } catch (error) {
            errors.push(
                `${row?._sheet || "Questions"} row ${row?._row || index + 2}: ${error.message}`
            );
        }
    });

    const ids = cleaned.map(q => q.id);
    if (new Set(ids).size !== ids.length) errors.push("Duplicate IDs in this batch.");

    if (validateOnly) return { errors };

    requireValue(errors.length === 0, errors.slice(0, 8).join("\n"));

    await db.runTransaction(async tx => {
        const [catalog, ...existing] = await Promise.all([
            tx.get(catalogRef),
            ...cleaned.map(q => tx.get(questions.doc(q.id)))
        ]);

        const map = new Map((catalog.data()?.items || []).map(q => [q.id, q]));

        cleaned.forEach((q, index) => {
            if (existing[index].exists) {
                requireValue(
                    existing[index].data().topic === q.topic,
                    `${q.id}: use a new ID when moving a question to another topic.`
                );
            }

            map.set(q.id, {
                id: q.id,
                topic: q.topic,
                active: q.active,
                demo: q.demo,
                prompt: q.prompt.slice(0, 80)
            });
        });

        requireValue(map.size <= MAX_BANK, `This version supports up to ${MAX_BANK} questions.`);

        const catalogData = {
            items: [...map.values()].sort((a, b) => a.id.localeCompare(b.id)),
            updatedAt: Date.now()
        };

        requireValue(
            Buffer.byteLength(JSON.stringify(catalogData), "utf8") < 750000,
            "The question catalogue is too large."
        );

        cleaned.forEach(q => {
            tx.set(questions.doc(q.id), q);
        });

        tx.set(catalogRef, catalogData);
    });

    return { imported: cleaned.length };
}

async function deleteBankBatch(actor, data) {
    requireAdmin(actor);

    const prefix = text(data.prefix, "Batch prefix", 48);
    idOf(prefix);

    const validTopicPrefix = TOPICS.some(topic => {
        const beginning = `${topic.id.toUpperCase()}-`;

        return prefix.startsWith(beginning) &&
            prefix.length > beginning.length;
    });

    requireValue(
        validTopicPrefix,
        "Enter the full topic and batch prefix, for example WW1-B01."
    );

    requireValue(
        data.confirmation === `DELETE ${prefix}`,
        `Type DELETE ${prefix} to confirm this batch deletion.`
    );

    const belongsToBatch = item => {
        const id = String(item.id || "");
        const beginning = `${prefix}-`;

        if (!id.startsWith(beginning)) return false;

        const suffix = id.slice(beginning.length);

        // Match the authoring ID format exactly.
        // WW1-B01 must not match WW1-B010 or WW1-B01-EXTRA.
        return /^(MC|FIB|MAT|EVT|SEQ)-[0-9]+$/.test(suffix);
    };

    return db.runTransaction(async tx => {
        const snap = await tx.get(catalogRef);
        const catalog = snap.data() || {};
        const items = Array.isArray(catalog.items) ? catalog.items : [];

        const matching = items.filter(belongsToBatch);
        const selected = matching.slice(0, 100);

        if (!selected.length) {
            return {
                deleted: 0,
                done: true,
                remaining: 0
            };
        }

        const deletedIds = new Set(selected.map(item => item.id));

        selected.forEach(item => {
            tx.delete(questions.doc(item.id));
        });

        tx.set(catalogRef, {
            ...catalog,
            items: items.filter(item => !deletedIds.has(item.id)),
            updatedAt: Date.now()
        });

        return {
            deleted: selected.length,
            done: matching.length <= selected.length,
            remaining: matching.length - selected.length
        };
    });
}

async function listBank(actor, data) {
    requireAdmin(actor);
    const snap = await catalogRef.get();

    const search = String(data.search || "").toLowerCase().trim();
    const offset = integer(data.offset ?? 0, 0, MAX_BANK, "Offset");
    const size = integer(data.size ?? 30, 1, 75, "Page size");

    const items = (snap.data()?.items || []).filter(q =>
        (!data.topic || q.topic === data.topic) &&
        (!search || `${q.id} ${q.prompt}`.toLowerCase().includes(search))
    );

    const selected = items.slice(offset, offset + size);
    const docs = selected.length
        ? await db.getAll(...selected.map(q => questions.doc(q.id)))
        : [];

    return {
        total: items.length,
        rows: docs.filter(d => d.exists).map(d => d.data())
    };
}
async function deleteDemoQuestions(actor, data) {
    requireAdmin(actor);

    requireValue(
        data.confirmation === "DELETE DEMOS",
        "Type DELETE DEMOS to confirm permanent deletion."
    );

    // Each request deletes at most 100 demo records.
    // The frontend repeats the request until no demo records remain.
    return db.runTransaction(async tx => {
        const [catalogSnap, demoSnap] = await Promise.all([
            tx.get(catalogRef),
            tx.get(questions.where("demo", "==", true).limit(100))
        ]);

        const catalog = catalogSnap.data() || {};
        const items = Array.isArray(catalog.items) ? catalog.items : [];

        if (demoSnap.empty) {
            // Also remove stale demo catalogue entries whose question
            // documents have already been deleted.
            const remainingItems = items.filter(item => item.demo !== true);
            const removedCatalogueEntries = items.length - remainingItems.length;

            if (removedCatalogueEntries > 0) {
                tx.set(catalogRef, {
                    ...catalog,
                    items: remainingItems,
                    updatedAt: Date.now()
                });
            }

            return {
                deleted: 0,
                done: true,
                removedCatalogueEntries
            };
        }

        const deletedIds = new Set(demoSnap.docs.map(doc => doc.id));

        // All transaction reads are above; writes begin here.
        demoSnap.docs.forEach(doc => {
            tx.delete(doc.ref);
        });

        tx.set(catalogRef, {
            ...catalog,
            items: items.filter(item => !deletedIds.has(item.id)),
            updatedAt: Date.now()
        });

        return {
            deleted: demoSnap.size,
            done: false,
            removedCatalogueEntries: 0
        };
    });
}

const foundation = require("./foundation.cjs")({
    db,
    root,
    TOPICS,
    requireValue,
    requireAdmin,
    cleanTopics,
    idOf,
    text,
    integer,
    normalize,
    shuffle,
    cleanAnswers,
    publicAttempt,
    emptySummary
});

const scheduling = require("./scheduling.cjs")({
    db,
    root,
    TOPICS,
    requireValue,
    requireAdmin,
    cleanTopics,
    rosterFor,
    bankReadiness: foundation.readiness
});

exports.knowledgeNotifications = functions
    .region("us-central1")
    .runWith({
        timeoutSeconds: 300,
        memory: "512MB"
    })
    .pubsub.schedule("every 5 minutes")
    .timeZone("Asia/Hong_Kong")
    .onRun(() => scheduling.tick());
exports.knowledgeApi = functions
    .region("us-central1")
    .runWith({ timeoutSeconds: 120, memory: "512MB" })
    .https.onCall(async (data, context) => {
        try {
            requireValue(data && typeof data === "object", "Invalid request.");
            const actor = await actorFor(context);

            switch (data.action) {
                case "schedule":
                    return await scheduling.create(actor, data);

                case "scheduleList":
                    return await scheduling.list(actor);

                case "cancelSchedule":
                    return await scheduling.cancel(actor, data);
                case "home":
                    return await homeFor(actor);

                case "start":
                    return await foundation.start(actor, data);

                case "save":
                    return await saveAttempt(actor, data);

                case "abandon":
                    return await saveAttempt(actor, data, true);

                case "submit":
                    return await foundation.submit(actor, data);

                case "attempt": {
                    const email = await authorizeTarget(actor, data.email);
                    const snap = await attemptsRef(email).doc(idOf(data.id)).get();
                    requireValue(snap.exists, "Exercise not found.", "not-found");
                    return publicAttempt(snap.data());
                }

                case "profile":
                    return await profileFor(actor, data);

                case "history": {
                    const email = await authorizeTarget(actor, data.email);
                    return await historyFor(email, data.cursor);
                }

                case "overview":
                    return await adminOverview(actor);

                case "preset":
                    return await savePreset(actor, data);

                case "assign":
                    return await createAssignments(actor, data);

                case "cancelAssignment":
                    return await cancelAssignment(actor, data);

                case "validate":
                    return await foundation.importRows(actor, data, true);

                case "import":
                    return await foundation.importRows(actor, data, false);

                case "reindexBank":
                    return await foundation.reindex(actor);

                case "bank":
                    return await listBank(actor, data);

                case "deleteDemos":
                    return await deleteDemoQuestions(actor, data);

                case "deleteBatch":
                    return await deleteBankBatch(actor, data);

                default:
                    fail("Unknown action.");
            }
        } catch (error) {
            if (error instanceof functions.https.HttpsError) throw error;
            console.error("Knowledge Test error:", error);
            throw new functions.https.HttpsError(
                "internal",
                "The request could not be completed. Please try again."
            );
        }
    });