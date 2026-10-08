const { createHash, randomInt } = require("node:crypto");
const spacing = require("./spacing.cjs");
const essayRecognition = require("./essay-recognition.cjs");

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

    const assignmentLifecycle = require("./assignment-lifecycle.cjs")({
        db,
        root,
        requireValue
    });

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

        if (raw.topic === essayRecognition.TOPIC) {
            raw = essayRecognition.prepare(raw);
        }

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
            const optionCount =
                q.topic === essayRecognition.TOPIC
                    ? essayRecognition.LABELS.length
                    : 4;

            q.choices = list(
                raw.choices,
                `${id}: options`,
                optionCount,
                optionCount
            );

            unique(q.choices, `${id}: options`);

            q.answer = integer(
                raw.answer,
                0,
                optionCount - 1,
                `${id}: answer`
            );
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
        if (topics.includes(essayRecognition.TOPIC)) {
            const validSelection =
                topics.length === 1 &&
                topics[0] === essayRecognition.TOPIC;

            const count = items.filter(item =>
                item.topic === essayRecognition.TOPIC &&
                item.type === "mc" &&
                item.active &&
                !item.demo
            ).length;

            const ready = validSelection && count >= 20;

            return {
                ready,
                regularCount: count,
                eventCount: 0,
                yearCount: 0,
                reason: ready
                    ? ""
                    : (
                        validSelection
                            ? "Question type recognition needs at least 20 active non-demo Essay questions."
                            : "Question type recognition must be selected separately from Theme A and Theme B."
                    )
            };
        }

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
        if (q.topic === essayRecognition.TOPIC) {
            // Unlike ordinary MC questions, the recognition options
            // always stay in their prescribed order.
            return {
                ...q,
                choices: [...q.choices],
                ...(q.zh ? {
                    zh: {
                        ...q.zh,
                        choices: [...q.zh.choices]
                    }
                } : {})
            };
        }

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
            assignmentId = idOf(data.assignmentId);
            const snap = await assignments.doc(assignmentId).get();

            requireValue(snap.exists, "Assignment not found.", "not-found");

            const assigned = snap.data();

            const permitted = assigned.email === actor.email &&
                (
                    actor.admin
                        ? assigned.testOnly === true &&
                        assigned.ownerUid === actor.uid
                        : assigned.testOnly !== true
                );

            requireValue(
                permitted,
                "You cannot open this assignment. Administrators can only complete their own test assignments.",
                "permission-denied"
            );

            topics = cleanTopics(assigned.topics);
            title = assigned.title;
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

            let attemptToAbandon = null;

            if (summary.activeAttemptId) {
                const active = await tx.get(
                    attemptsRef(actor.email).doc(
                        idOf(summary.activeAttemptId)
                    )
                );

                if (active.exists && active.data().status === "active") {
                    const existing = {
                        ...active.data(),
                        id: active.id
                    };

                    let unavailableAssignment = false;

                    if (existing.assignmentId) {
                        const assignedSnapshot = await tx.get(
                            assignments.doc(
                                idOf(existing.assignmentId)
                            )
                        );

                        const assigned = assignedSnapshot.exists
                            ? assignedSnapshot.data()
                            : null;

                        unavailableAssignment =
                            !assigned ||
                            assigned.email !== actor.email ||
                            assignmentLifecycle.closed(assigned) ||
                            (
                                actor.admin
                                    ? assigned.testOnly !== true ||
                                    assigned.ownerUid !== actor.uid
                                    : assigned.testOnly === true
                            );
                    }

                    if (unavailableAssignment) {
                        // Do not let a closed or missing assignment
                        // prevent the student from starting other work.
                        // Defer the write until the new exercise is ready.
                        attemptToAbandon = {
                            reference: active.ref,
                            reason: "assignment-unavailable"
                        };
                    } else if (
                        (existing.assignmentId || null) ===
                        (assignmentId || null)
                    ) {
                        // The requested assignment is already active,
                        // or the student is resuming ordinary practice.
                        return publicAttempt(existing);
                    } else {
                        requireValue(
                            data.replaceActiveAttemptId === existing.id,
                            "You already have an unfinished exercise belonging to a different practice or assignment. Confirm that you want to abandon it before entering this assignment. The requested assignment has NOT been started.",
                            "failed-precondition"
                        );

                        // This exact ID must still be active.
                        // A different exercise opened in another tab
                        // will not be silently abandoned.
                        attemptToAbandon = {
                            reference: active.ref,
                            reason: "replaced-by-request"
                        };
                    }
                }
            }

            let assignment = null;

            if (assignmentId) {
                const snap = await tx.get(assignments.doc(assignmentId));
                assignment = snap.exists ? snap.data() : null;

                requireValue(
                    assignment &&
                    assignment.email === actor.email &&
                    !assignment.cancelled &&
                    (
                        actor.admin
                            ? assignment.testOnly === true &&
                            assignment.ownerUid === actor.uid
                            : assignment.testOnly !== true
                    ),
                    "This assignment is no longer available.",
                    "failed-precondition"
                );

                assignmentLifecycle.assertOpen(assignment);

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

            const now = Date.now();
            const spacingDay = spacing.hkDay(now);

            const entries = {
                ...(stateSnap.data()?.entries || {})
            };

            // Normal administrator previews remain untracked.
            // Test assignments track progress only on the administrator's
            // own account, never on a student's account.
            const trackProgress =
                !actor.admin || assignment?.testOnly === true;

            const eligible = trackProgress
                ? spacing.eligibleItems(
                    items,
                    entries,
                    summary,
                    spacingDay
                )
                : items;

            const eligibleAvailability = readiness(eligible, topics);

            requireValue(
                eligibleAvailability.ready,
                "Some unresolved questions or timeline events have already appeared in two exercises today and are resting until another Hong Kong calendar day. There are not enough remaining eligible records to build this 20-question exercise. Try a different topic or a wider topic mix, or return another day. Teachers can also expand the question bank. The limit is lifted after six fully completed 20-question reports today.",
                "failed-precondition"
            );

            const isRecognition =
                topics.length === 1 &&
                topics[0] === essayRecognition.TOPIC;

            const regular = isRecognition
                ? weightedOrder(
                    eligible.filter(item =>
                        item.topic === essayRecognition.TOPIC &&
                        item.type === "mc" &&
                        item.active &&
                        !item.demo
                    ),
                    entries
                ).slice(0, 20)
                : selectRegular(eligible, topics, entries);

            const plans = isRecognition
                ? []
                : makePlans(eligible, topics, entries);

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
                assignmentId,
                testAssignment: assignment?.testOnly === true,
                preview: actor.admin,
                formatVersion: 2,
                spacingDay,
                createdAt: now,
                status: "active",
                questions: questionList,
                answers: {},
                answerRevision: 0
            };

            requireValue(
                Buffer.byteLength(JSON.stringify(attempt), "utf8") < 800000,
                "This exercise is too large. Shorten bank explanations."
            );

            // All transaction reads and exercise validation are complete.
            // The previous exercise and the new one change together.
            // If creation fails, the previous exercise is retained.
            if (attemptToAbandon) {
                tx.update(attemptToAbandon.reference, {
                    status: "abandoned",
                    abandonedAt: now,
                    abandonReason: attemptToAbandon.reason
                });
            }

            if (trackProgress) {
                spacing.reserveAppearances(entries, ids, spacingDay);

                tx.set(stateRef(actor.email), {
                    ...(stateSnap.data() || {}),
                    entries
                });
            }

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

            const trackProgress =
                !attempt.preview || attempt.testAssignment === true;

            const updates = trackProgress
                ? collectProgress(attempt, answers)
                : [];

            const progressSnaps = updates.length
                ? await tx.getAll(
                    ...updates.map(update =>
                        progressRef(actor.email).doc(update.record.id)
                    )
                )
                : [];

            let assignmentSnap = null;

            if (attempt.assignmentId && trackProgress) {
                assignmentSnap = await tx.get(
                    assignments.doc(attempt.assignmentId)
                );
            }

            const now = Date.now();

            const preparedCredit = await assignmentLifecycle.prepareCredit(
                tx,
                assignmentSnap,
                attempt,
                now
            );

            // All transaction reads, including schedule recipients,
            // are now complete.
            const correct = results.filter(result => result.correct).length;
            let credit = preparedCredit.credit;

            if (assignmentSnap?.exists) {
                const assignment = assignmentSnap.data();

                requireValue(
                    assignment.email === actor.email &&
                    Boolean(assignment.testOnly) ===
                    Boolean(attempt.testAssignment) &&
                    (
                        !assignment.testOnly ||
                        (
                            actor.admin &&
                            assignment.ownerUid === actor.uid
                        )
                    ),
                    "Assignment ownership no longer matches this exercise.",
                    "permission-denied"
                );

                assignmentLifecycle.applyCredit(
                    tx,
                    assignmentSnap,
                    preparedCredit
                );
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

            if (trackProgress) {
                const entries = { ...(stateSnap.data()?.entries || {}) };
                const stats = { ...(summary.stats || {}) };
                const usedTopics = new Set();
                const spacingDay = spacing.hkDay(now);

                // Older attempts have no spacingDay.
                // An exercise submitted on a later day is also counted
                // as an inclusion on its submission day.
                if (attempt.spacingDay !== spacingDay) {
                    spacing.reserveAppearances(
                        entries,
                        spacing.recordIdsForAttempt(attempt),
                        spacingDay
                    );
                }

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
                        ...(entries[record.id] || {}),
                        seen: progress.seen,
                        needsRevision,
                        streak,
                        wrongCount: progress.wrongCount,
                        revision: record.revision,
                        kind: progress.kind,
                        reviewDay: (
                            !update.correct ||
                            old.needsRevision ||
                            needsRevision
                        )
                            ? spacingDay
                            : entries[record.id]?.reviewDay || null
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
                    lastActivity: now,
                    practiceDay: spacingDay,
                    completedToday:
                        spacing.completedToday(summary, spacingDay) +
                        (attempt.questions.length === 20 ? 1 : 0)
                });

                tx.set(stateRef(actor.email), {
                    ...(stateSnap.data() || {}),
                    entries
                });
            }

            tx.set(userRef(actor.email), summary);
            return finished;
        });
    }

    async function seedEssayRecognition(actor) {
        requireAdmin(actor);

        const records = essayRecognition
            .seedRows()
            .map(cleanRecord);

        return db.runTransaction(async tx => {
            const [catalogSnapshot, existing] = await Promise.all([
                tx.get(catalogRef),
                tx.getAll(
                    ...records.map(record =>
                        questions.doc(record.id)
                    )
                )
            ]);

            const map = new Map(
                (catalogSnapshot.data()?.items || [])
                    .map(item => [item.id, item])
            );

            let imported = 0;
            const newRecords = [];

            records.forEach((record, index) => {
                if (existing[index].exists) {
                    // Retain all later edits and deactivation settings.
                    // Installing again must not restore original content.
                    const saved = {
                        ...existing[index].data(),
                        id: existing[index].id
                    };

                    map.set(saved.id, catalogItem(saved));
                    return;
                }

                newRecords.push(record);
                map.set(record.id, catalogItem(record));
                imported++;
            });

            const nextCatalog = catalogData([...map.values()]);

            // All transaction reads are complete.
            newRecords.forEach(record => {
                tx.create(questions.doc(record.id), record);
            });

            tx.set(catalogRef, nextCatalog);

            return {
                ok: true,
                imported,
                alreadyPresent: records.length - imported
            };
        });
    }

    return {
        readiness,
        topicCounts,
        reindex,
        importRows,
        seedEssayRecognition,
        start,
        submit
    };
};