const { createHash, randomInt } = require("node:crypto");

module.exports = function makeFoundation({
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
}) {
    const questions = root.collection("questions");
    const users = root.collection("users");
    const presets = root.collection("presets");
    const assignments = root.collection("assignments");
    const catalogRef = root.collection("state").doc("catalog");

    const MAX_BANK = 2500;
    const REGULAR_TYPES = new Set(["mc", "blank", "matching"]);
    const topicIds = new Set(TOPICS.map(t => t.id));

    const userRef = email => users.doc(email);
    const stateRef = email => userRef(email).collection("state").doc("selection");
    const attemptsRef = email => userRef(email).collection("attempts");
    const progressRef = email => userRef(email).collection("progress");

    function list(value, name, minimum, maximum) {
        requireValue(
            Array.isArray(value) &&
            value.length >= minimum &&
            value.length <= maximum,
            `${name} must contain ${minimum}–${maximum} items.`
        );

        return value.map((item, index) =>
            text(item, `${name} ${index + 1}`, 400)
        );
    }

    function unique(values, name) {
        requireValue(
            new Set(values.map(normalize)).size === values.length,
            `${name} must contain distinct items.`
        );
    }

    function mapping(value, leftLength, rightLength, name) {
        requireValue(
            Array.isArray(value) &&
            value.length === leftLength &&
            value.every(n =>
                Number.isInteger(n) && n >= 0 && n < rightLength
            ) &&
            new Set(value).size === leftLength,
            `${name} must give one different valid option for every item.`
        );

        return [...value];
    }

    function revisionOf(q) {
        const content = { ...q };
        delete content.active;
        delete content.demo;
        delete content.revision;

        return createHash("sha256")
            .update(JSON.stringify(content))
            .digest("hex")
            .slice(0, 24);
    }

    function cleanRecord(raw) {
        requireValue(
            raw && typeof raw === "object" && !Array.isArray(raw),
            "Invalid question or event."
        );

        const id = idOf(raw.id);

        requireValue(id.length <= 48, "IDs must be at most 48 characters.");
        requireValue(!id.startsWith("GEN-"), "GEN- is reserved for generated questions.");
        requireValue(topicIds.has(raw.topic), `${id}: unknown topic.`);

        const theme = TOPICS.find(t => t.id === raw.topic).theme;

        requireValue(
            String(raw.theme || theme).toUpperCase() === theme,
            `${id}: theme does not match topic.`
        );

        requireValue(
            ["mc", "blank", "matching", "sequence", "event"].includes(raw.type),
            `${id}: unknown record type.`
        );

        requireValue(
            typeof raw.active === "boolean" &&
            typeof raw.demo === "boolean",
            `${id}: Active and Demo must be TRUE or FALSE.`
        );

        const q = {
            id,
            theme,
            topic: raw.topic,
            type: raw.type,
            subtopic: text(raw.subtopic, `${id}: subtopic/category`, 160),
            prompt: text(
                raw.prompt,
                `${id}: question/event`,
                raw.type === "event" ? 400 : 1600
            ),
            explanation: text(
                raw.explanation,
                `${id}: explanation/context`,
                raw.type === "event" ? 1000 : 2400
            ),
            active: raw.active,
            demo: raw.demo
        };

        if (q.type === "mc") {
            q.choices = list(raw.choices, `${id}: options`, 4, 4);
            unique(q.choices, `${id}: options`);
            q.answer = integer(raw.answer, 0, 3, `${id}: answer`);
        }

        if (q.type === "blank") {
            q.answer = list(raw.answer, `${id}: accepted answers`, 1, 12);
        }

        if (q.type === "matching") {
            q.left = list(raw.left, `${id}: left items`, 2, 6);
            q.right = list(raw.right, `${id}: right items`, q.left.length, 8);
            unique(q.left, `${id}: left items`);
            unique(q.right, `${id}: right items`);

            q.answer = mapping(
                raw.answer,
                q.left.length,
                q.right.length,
                `${id}: matching answers`
            );
        }

        if (q.type === "sequence") {
            q.items = list(raw.items, `${id}: sequence items`, 2, 6);
            unique(q.items, `${id}: sequence items`);
            q.answer = mapping(
                raw.answer,
                q.items.length,
                q.items.length,
                `${id}: sequence`
            );
        }

        if (q.type === "event") {
            q.year = integer(raw.year, 1, 3000, `${id}: year`);

            requireValue(
                raw.allowOutsideCentury === undefined ||
                typeof raw.allowOutsideCentury === "boolean",
                `${id}: AllowOutsideCentury must be TRUE or FALSE.`
            );

            q.allowOutsideCentury = raw.allowOutsideCentury === true;

            requireValue(
                (q.year >= 1901 && q.year <= 2000) ||
                q.allowOutsideCentury,
                `${id}: events outside 1901–2000 require AllowOutsideCentury = TRUE.`
            );
        }

        if (raw.zh !== undefined && raw.zh !== null) {
            requireValue(
                typeof raw.zh === "object" && !Array.isArray(raw.zh),
                `${id}: invalid Chinese translation.`
            );

            q.zh = {
                subtopic: text(raw.zh.subtopic, `${id}: Chinese subtopic`, 160),
                prompt: text(
                    raw.zh.prompt,
                    `${id}: Chinese question/event`,
                    q.type === "event" ? 400 : 1600
                ),
                explanation: text(
                    raw.zh.explanation,
                    `${id}: Chinese explanation/context`,
                    q.type === "event" ? 1000 : 2400
                )
            };

            for (const key of ["choices", "left", "right", "items"]) {
                if (!q[key]) continue;

                q.zh[key] = list(
                    raw.zh[key],
                    `${id}: Chinese ${key}`,
                    q[key].length,
                    q[key].length
                );

                unique(q.zh[key], `${id}: Chinese ${key}`);
            }

            if (q.type === "blank") {
                q.zh.answer = list(
                    raw.zh.answer,
                    `${id}: Chinese accepted answers`,
                    1,
                    12
                );
            }
        }

        q.revision = revisionOf(q);

        requireValue(
            Buffer.byteLength(JSON.stringify(q), "utf8") <
            (q.type === "event" ? 7000 : 18000),
            `${id}: this record is too large. Shorten its content.`
        );

        return q;
    }

    function catalogItem(q) {
        const item = {
            id: q.id,
            topic: q.topic,
            type: q.type,
            active: q.active === true,
            demo: q.demo === true,
            prompt: String(q.prompt || "").slice(
                0,
                q.type === "event" ? 400 : 80
            )
        };

        if (q.type === "event") {
            item.year = q.year;
            item.allowOutsideCentury = q.allowOutsideCentury === true;
        }

        return item;
    }

    function catalogData(items) {
        const result = {
            schemaVersion: 2,
            items: [...items].sort((a, b) => a.id.localeCompare(b.id)),
            updatedAt: Date.now()
        };

        requireValue(
            result.items.length <= MAX_BANK,
            `The bank supports at most ${MAX_BANK} combined questions and events.`
        );

        requireValue(
            Buffer.byteLength(JSON.stringify(result), "utf8") < 750000,
            "The question/event catalogue is too large."
        );

        return result;
    }

    function eventPool(items, topics) {
        const seenNames = new Set();

        return items.filter(q => {
            if (
                !q.active ||
                q.demo ||
                q.type !== "event" ||
                !topics.includes(q.topic) ||
                !Number.isInteger(q.year) ||
                !(
                    (q.year >= 1901 && q.year <= 2000) ||
                    q.allowOutsideCentury === true
                )
            ) {
                return false;
            }

            // Do not offer duplicate event names as separate choices.
            const name = normalize(q.prompt);

            if (!name || seenNames.has(name)) return false;

            seenNames.add(name);
            return true;
        });
    }

    function readiness(items, topics) {
        const regular = items.filter(q =>
            q.active &&
            !q.demo &&
            REGULAR_TYPES.has(q.type) &&
            topics.includes(q.topic)
        );

        const events = eventPool(items, topics);
        const years = new Set(events.map(event => event.year)).size;
        const missingTopics = topics.filter(topic =>
            !regular.some(q => q.topic === topic)
        );

        const ready =
            regular.length >= 14 &&
            years >= 6 &&
            missingTopics.length === 0;

        return {
            ready,
            regularCount: regular.length,
            eventCount: events.length,
            yearCount: years,
            reason: ready
                ? ""
                : (
                    "This selection needs at least 14 active non-demo foundation questions, " +
                    "at least one foundation question in every selected topic, " +
                    "and usable timeline events spanning at least 6 different years. " +
                    `Currently: ${regular.length} foundation questions and ${years} event years.`
                )
        };
    }

    function topicCounts(items, topic) {
        const status = readiness(items, [topic]);

        return {
            count: status.regularCount,
            eventCount: status.eventCount,
            yearCount: status.yearCount,
            ready: status.ready
        };
    }

    async function reindex(actor) {
        requireAdmin(actor);

        return db.runTransaction(async tx => {
            // Reading the catalogue also coordinates this operation with imports.
            await tx.get(catalogRef);
            const snap = await tx.get(questions.limit(MAX_BANK + 1));

            requireValue(
                snap.size <= MAX_BANK,
                `The bank contains more than ${MAX_BANK} records.`
            );

            const items = snap.docs.map(doc =>
                catalogItem({ ...doc.data(), id: doc.id })
            );

            tx.set(catalogRef, catalogData(items));

            return {
                indexed: items.length,
                legacySequences: items.filter(q => q.type === "sequence").length
            };
        });
    }

    async function importRows(actor, data, validateOnly) {
        requireAdmin(actor);

        requireValue(
            Array.isArray(data.rows) &&
            data.rows.length >= 1 &&
            data.rows.length <= 75,
            "Import 1–75 records per batch."
        );

        const cleaned = [];
        const errors = [];

        data.rows.forEach((raw, index) => {
            try {
                cleaned.push(cleanRecord(raw));
            } catch (error) {
                errors.push(
                    `${raw?._sheet || "Records"} row ${raw?._row || index + 2}: ${error.message}`
                );
            }
        });

        if (new Set(cleaned.map(q => q.id)).size !== cleaned.length) {
            errors.push("Duplicate IDs in this batch.");
        }

        if (validateOnly) return { errors };

        requireValue(errors.length === 0, errors.slice(0, 8).join("\n"));

        await db.runTransaction(async tx => {
            const [catalogSnap, ...existing] = await Promise.all([
                tx.get(catalogRef),
                ...cleaned.map(q => tx.get(questions.doc(q.id)))
            ]);

            const map = new Map(
                (catalogSnap.data()?.items || []).map(item => [item.id, item])
            );

            cleaned.forEach((q, index) => {
                if (existing[index].exists) {
                    const old = existing[index].data();

                    requireValue(
                        old.topic === q.topic && old.type === q.type,
                        `${q.id}: use a NEW ID when changing the topic or record type.`
                    );
                }

                map.set(q.id, catalogItem(q));
            });

            const nextCatalog = catalogData([...map.values()]);

            cleaned.forEach(q => tx.set(questions.doc(q.id), q));
            tx.set(catalogRef, nextCatalog);
        });

        return { imported: cleaned.length };
    }

    function weightFor(record, entries, uses = {}) {
        const entry = entries[record.id] || {};

        const priority = entry.needsRevision
            ? 6 + Math.min(entry.wrongCount || 0, 6)
            : entry.seen
                ? 1
                : 2;

        return priority / (1 + (uses[record.id] || 0) * 2);
    }

    function weightedOrder(records, entries, uses = {}) {
        return records.map(record => ({
            record,
            key: -Math.log(randomInt(1, 1000001) / 1000001) /
                weightFor(record, entries, uses)
        })).sort((a, b) => a.key - b.key).map(row => row.record);
    }

    function selectRegular(items, topics, entries) {
        const topicOrder = shuffle(topics);
        const pools = Object.fromEntries(topicOrder.map(topic => [
            topic,
            weightedOrder(
                items.filter(q =>
                    q.active &&
                    !q.demo &&
                    REGULAR_TYPES.has(q.type) &&
                    q.topic === topic
                ),
                entries
            )
        ]));

        const result = [];

        while (result.length < 14) {
            let changed = false;

            for (const topic of topicOrder) {
                if (result.length === 14) break;

                const next = pools[topic].shift();

                if (next) {
                    result.push(next);
                    changed = true;
                }
            }

            requireValue(changed, "Not enough foundation questions.");
        }

        return result;
    }

    function sampleEvents(pool, count, entries, uses) {
        const result = [];
        const usedYears = new Set();
        const usedNames = new Set();

        for (const event of weightedOrder(pool, entries, uses)) {
            const name = normalize(event.prompt);

            if (usedYears.has(event.year) || usedNames.has(name)) continue;

            result.push(event);
            usedYears.add(event.year);
            usedNames.add(name);

            if (result.length === count) break;
        }

        requireValue(
            result.length === count,
            "Not enough unambiguous events with different years."
        );

        return result;
    }

    function makePlans(items, topics, entries) {
        const pool = eventPool(items, topics);
        const uses = {};
        const plans = [];
        const signatures = new Set();

        for (let index = 0; index < 6; index++) {
            const kind = index < 3 ? "sequence" : "yearMatching";
            const targetCount = kind === "sequence" ? 4 : randomInt(3, 5);

            let selected;
            let signature;

            // Try to avoid repeating the same tested event set in this exercise.
            for (let trial = 0; trial < 30; trial++) {
                selected = sampleEvents(
                    pool,
                    kind === "sequence" ? 4 : targetCount + 2,
                    entries,
                    uses
                );

                signature = kind + ":" + selected
                    .slice(0, targetCount)
                    .map(event => event.id)
                    .sort()
                    .join("|");

                if (!signatures.has(signature)) break;
            }

            signatures.add(signature);

            selected.forEach(event => {
                uses[event.id] = (uses[event.id] || 0) + 1;
            });

            plans.push({
                kind,
                targetIds: selected.slice(0, targetCount).map(event => event.id),
                optionIds: selected.map(event => event.id)
            });
        }

        return plans;
    }

    function prepareRegular(q) {
        const result = {
            ...q,
            ...(q.zh ? { zh: { ...q.zh } } : {})
        };

        const reorder = (key, order) => {
            result[key] = order.map(i => q[key][i]);

            if (q.zh?.[key]) {
                result.zh[key] = order.map(i => q.zh[key][i]);
            }
        };

        if (q.type === "mc") {
            const order = shuffle(q.choices.map((_, i) => i));
            reorder("choices", order);
            result.answer = order.indexOf(q.answer);
        }

        if (q.type === "matching") {
            const leftOrder = shuffle(q.left.map((_, i) => i));
            const rightOrder = shuffle(q.right.map((_, i) => i));

            reorder("left", leftOrder);
            reorder("right", rightOrder);

            result.answer = leftOrder.map(i =>
                rightOrder.indexOf(q.answer[i])
            );
        }

        return result;
    }

    function makeGenerated(plan, records, entries, attemptId, index) {
        const targets = plan.targetIds.map(id => records.get(id));
        const options = plan.optionIds.map(id => records.get(id));
        const ordered = [...targets].sort((a, b) => a.year - b.year);

        const allChinese = options.every(event => Boolean(event.zh));

        const q = {
            id: `GEN-${attemptId}-${index}`,
            type: plan.kind === "sequence" ? "sequence" : "matching",
            generatedKind: plan.kind,
            topic: targets[0].topic,
            topicIds: [...new Set(targets.map(event => event.topic))],
            theme: targets[0].theme,
            subtopic: plan.kind === "sequence"
                ? "Chronology"
                : "Event years",
            prompt: plan.kind === "sequence"
                ? "Arrange these four events from earliest to latest."
                : "Match each year to its event. Two event options will not be used.",
            explanation: ordered.map(event =>
                `${event.year}: ${event.prompt}. ${event.explanation}`
            ).join("\n"),
            demo: false,
            eventRecords: options,
            targetIds: [...plan.targetIds],
            reviewEvents: targets
                .filter(event => entries[event.id]?.needsRevision)
                .map(event => ({
                    id: event.id,
                    name: event.prompt,
                    nameZh: event.zh?.prompt || ""
                }))
        };

        if (allChinese) {
            q.zh = {
                subtopic: plan.kind === "sequence" ? "時序" : "事件年份",
                prompt: plan.kind === "sequence"
                    ? "將以下四件事件按發生先後排列，由最早至最遲。"
                    : "將每個年份與相應事件配對。有兩個事件選項不會使用。",
                explanation: ordered.map(event =>
                    `${event.year}年：${event.zh.prompt}。${event.zh.explanation}`
                ).join("\n")
            };
        }

        if (plan.kind === "sequence") {
            const shown = shuffle(targets);

            q.items = shown.map(event => event.prompt);
            q.itemEventIds = shown.map(event => event.id);
            q.answer = ordered.map(event =>
                q.itemEventIds.indexOf(event.id)
            );

            if (allChinese) {
                q.zh.items = shown.map(event => event.zh.prompt);
            }
        } else {
            const leftEvents = shuffle(targets);
            const rightEvents = shuffle(options);

            q.left = leftEvents.map(event => String(event.year));
            q.right = rightEvents.map(event => event.prompt);
            q.targetIds = leftEvents.map(event => event.id);
            q.rightEventIds = rightEvents.map(event => event.id);
            q.answer = q.targetIds.map(id => q.rightEventIds.indexOf(id));

            if (allChinese) {
                q.zh.left = leftEvents.map(event => `${event.year}年`);
                q.zh.right = rightEvents.map(event => event.zh.prompt);
            }
        }

        q.revision = revisionOf(q);
        return q;
    }

    async function start(actor, data) {
        let topics;
        let title;
        let assignmentId = null;

        if (data.assignmentId) {
            requireValue(!actor.admin, "Assignments are completed by students.");

            assignmentId = idOf(data.assignmentId);
            const snap = await assignments.doc(assignmentId).get();

            requireValue(snap.exists, "Assignment not found.", "not-found");
            requireValue(
                snap.data().email === actor.email,
                "This assignment belongs to another student.",
                "permission-denied"
            );

            topics = cleanTopics(snap.data().topics);
            title = snap.data().title;
        } else if (data.presetId) {
            const snap = await presets.doc(idOf(data.presetId)).get();
            requireValue(snap.exists, "Preset not found.", "not-found");

            topics = cleanTopics(snap.data().topics);
            title = snap.data().name;
        } else {
            topics = cleanTopics(data.topics);
            title = topics.length === 1
                ? TOPICS.find(t => t.id === topics[0]).label
                : "Custom mixed practice";
        }

        const ref = attemptsRef(actor.email).doc();

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
                const active = await tx.get(
                    attemptsRef(actor.email).doc(summary.activeAttemptId)
                );

                if (active.exists && active.data().status === "active") {
                    return publicAttempt(active.data());
                }
            }

            let assignment = null;

            if (assignmentId) {
                const snap = await tx.get(assignments.doc(assignmentId));
                assignment = snap.exists ? snap.data() : null;

                requireValue(
                    assignment &&
                    assignment.email === actor.email &&
                    !assignment.cancelled,
                    "This assignment is no longer available.",
                    "failed-precondition"
                );

                requireValue(
                    Date.now() >= assignment.startsAt,
                    "This assignment has not started yet.",
                    "failed-precondition"
                );

                topics = cleanTopics(assignment.topics);
                title = assignment.title;
            }

            const items = catalogSnap.data()?.items || [];
            const availability = readiness(items, topics);

            requireValue(
                availability.ready,
                availability.reason,
                "failed-precondition"
            );

            const entries = stateSnap.data()?.entries || {};
            const regular = selectRegular(items, topics, entries);
            const plans = makePlans(items, topics, entries);

            const ids = [...new Set([
                ...regular.map(q => q.id),
                ...plans.flatMap(plan => plan.optionIds)
            ])];

            const snaps = await tx.getAll(
                ...ids.map(id => questions.doc(id))
            );

            requireValue(
                snaps.every(s => s.exists && s.data().active && !s.data().demo),
                "The bank changed. Please try again.",
                "aborted"
            );

            const records = new Map(snaps.map(s => [s.id, s.data()]));

            const questionList = shuffle([
                ...regular.map(q => prepareRegular(records.get(q.id))),
                ...plans.map((plan, index) =>
                    makeGenerated(plan, records, entries, ref.id, index)
                )
            ]);

            const attempt = {
                id: ref.id,
                email: actor.email,
                uid: actor.uid,
                title,
                topics,
                assignmentId: assignment?.id || null,
                preview: actor.admin,
                formatVersion: 2,
                createdAt: Date.now(),
                status: "active",
                questions: questionList,
                answers: {},
                answerRevision: 0
            };

            requireValue(
                Buffer.byteLength(JSON.stringify(attempt), "utf8") < 800000,
                "This exercise is too large. Shorten bank explanations."
            );

            tx.create(ref, attempt);
            tx.set(userRef(actor.email), {
                ...summary,
                activeAttemptId: ref.id
            });

            return publicAttempt(attempt);
        });
    }

    function correctAnswer(q, answer) {
        if (q.type === "blank") {
            return [
                ...q.answer,
                ...(q.zh?.answer || [])
            ].some(accepted => normalize(accepted) === normalize(answer));
        }

        return JSON.stringify(q.answer) === JSON.stringify(answer);
    }

    function collectProgress(attempt, answers) {
        const updates = new Map();

        function add(record, correct, question, submitted) {
            const old = updates.get(record.id);

            if (!old) {
                updates.set(record.id, {
                    record,
                    correct,
                    question,
                    submitted
                });
                return;
            }

            // One recovery opportunity per exercise, not per appearance.
            // Any mistake involving this event makes the exercise incorrect
            // for that event.
            if (!correct) {
                old.correct = false;
                old.question = question;
                old.submitted = submitted;
            }
        }

        for (const q of attempt.questions) {
            const submitted = answers[q.id];

            if (!q.generatedKind) {
                add(q, correctAnswer(q, submitted), q, submitted);
                continue;
            }

            const events = new Map(q.eventRecords.map(event => [event.id, event]));

            if (q.generatedKind === "sequence") {
                const positions = new Map(
                    submitted.map((itemIndex, position) => [
                        q.itemEventIds[itemIndex],
                        position
                    ])
                );

                const wrongIds = new Set();

                for (let i = 0; i < q.targetIds.length; i++) {
                    for (let j = i + 1; j < q.targetIds.length; j++) {
                        const a = events.get(q.targetIds[i]);
                        const b = events.get(q.targetIds[j]);

                        const shouldBeBefore = a.year < b.year;
                        const wasBefore = positions.get(a.id) < positions.get(b.id);

                        if (shouldBeBefore !== wasBefore) {
                            wrongIds.add(a.id);
                            wrongIds.add(b.id);
                        }
                    }
                }

                q.targetIds.forEach(id => {
                    add(events.get(id), !wrongIds.has(id), q, submitted);
                });
            }

            if (q.generatedKind === "yearMatching") {
                q.targetIds.forEach((targetId, index) => {
                    const selectedId = q.rightEventIds[submitted[index]];
                    const correct = selectedId === targetId;

                    add(events.get(targetId), correct, q, submitted);

                    // Choosing an incorrect event also reveals a mistaken
                    // association involving that selected event.
                    if (!correct) {
                        add(events.get(selectedId), false, q, submitted);
                    }
                });
            }
        }

        return [...updates.values()];
    }

    async function submit(actor, data) {
        const ref = attemptsRef(actor.email).doc(idOf(data.id));

        return db.runTransaction(async tx => {
            const [snap, userSnap, stateSnap] = await Promise.all([
                tx.get(ref),
                tx.get(userRef(actor.email)),
                tx.get(stateRef(actor.email))
            ]);

            requireValue(snap.exists, "Exercise not found.", "not-found");

            const attempt = snap.data();

            if (attempt.status === "submitted") return attempt;

            requireValue(
                attempt.status === "active",
                "This exercise is no longer active."
            );

            requireValue(
                Number.isInteger(data.expectedRevision) &&
                data.expectedRevision === (attempt.answerRevision || 0),
                "Your saved answers changed. Reload before submitting.",
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
                correct: correctAnswer(q, answers[q.id])
            }));

            const updates = attempt.preview
                ? []
                : collectProgress(attempt, answers);

            const progressSnaps = updates.length
                ? await tx.getAll(
                    ...updates.map(update =>
                        progressRef(actor.email).doc(update.record.id)
                    )
                )
                : [];

            let assignmentSnap = null;

            if (attempt.assignmentId && !attempt.preview) {
                assignmentSnap = await tx.get(
                    assignments.doc(attempt.assignmentId)
                );
            }

            // All transaction reads are complete.
            const now = Date.now();
            const correct = results.filter(result => result.correct).length;
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
                        completed: (assignment.completed || 0) +
                            (credit === "on-time" ? 1 : 0),
                        late: (assignment.late || 0) +
                            (credit === "late" ? 1 : 0),
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

            if (summary.activeAttemptId === attempt.id) {
                summary.activeAttemptId = null;
            }

            if (!attempt.preview) {
                const entries = { ...(stateSnap.data()?.entries || {}) };
                const stats = { ...(summary.stats || {}) };
                const usedTopics = new Set();

                updates.forEach((update, index) => {
                    const record = update.record;
                    const old = progressSnaps[index].data() || {};
                    const sameVersion = old.revision === record.revision;

                    let needsRevision = sameVersion
                        ? Boolean(old.needsRevision)
                        : Boolean(old.everWrong);

                    let streak = sameVersion ? old.streak || 0 : 0;

                    if (!update.correct) {
                        needsRevision = true;
                        streak = 0;
                    } else if (needsRevision) {
                        streak = Math.min(2, streak + 1);

                        if (streak >= 2) needsRevision = false;
                    }

                    const progress = {
                        ...old,
                        id: record.id,
                        kind: record.type === "event" ? "event" : "question",
                        topic: record.topic,
                        revision: record.revision,
                        seen: (old.seen || 0) + 1,
                        everWrong: Boolean(old.everWrong || !update.correct),
                        wrongCount: (old.wrongCount || 0) +
                            (update.correct ? 0 : 1),
                        needsRevision,
                        streak,
                        lastSeenAt: now,
                        lastCorrect: update.correct
                    };

                    if (!update.correct) {
                        const savedQuestion = {
                            ...update.question,
                            topic: record.topic
                        };

                        if (record.type === "event") {
                            savedQuestion.focusEvent = {
                                id: record.id,
                                name: record.prompt,
                                nameZh: record.zh?.prompt || ""
                            };
                        }

                        progress.lastWrongAt = now;
                        progress.lastWrong = {
                            question: savedQuestion,
                            submitted: update.submitted
                        };
                    }

                    entries[record.id] = {
                        seen: progress.seen,
                        needsRevision,
                        streak,
                        wrongCount: progress.wrongCount,
                        revision: record.revision,
                        kind: progress.kind
                    };

                    tx.set(
                        progressRef(actor.email).doc(record.id),
                        progress
                    );
                });

                attempt.questions.forEach((q, index) => {
                    const topics = q.topicIds || [q.topic];

                    topics.forEach(topic => {
                        stats[topic] = {
                            ...(stats[topic] || {
                                runs: 0,
                                answered: 0,
                                correct: 0
                            }),
                            answered: (stats[topic]?.answered || 0) + 1,
                            correct: (stats[topic]?.correct || 0) +
                                (results[index].correct ? 1 : 0)
                        };

                        usedTopics.add(topic);
                    });
                });

                usedTopics.forEach(topic => {
                    stats[topic].runs = (stats[topic].runs || 0) + 1;
                });

                Object.assign(summary, {
                    completed: (summary.completed || 0) + 1,
                    totalAnswered: (summary.totalAnswered || 0) +
                        attempt.questions.length,
                    totalCorrect: (summary.totalCorrect || 0) + correct,
                    unresolved: Object.values(entries)
                        .filter(entry => entry.needsRevision).length,
                    stats,
                    lastActivity: now
                });

                tx.set(stateRef(actor.email), { entries });
            }

            tx.set(userRef(actor.email), summary);
            return finished;
        });
    }

    return {
        readiness,
        topicCounts,
        reindex,
        importRows,
        start,
        submit
    };
};