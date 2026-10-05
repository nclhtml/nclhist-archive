const { createHash } = require("node:crypto");

module.exports = function makeAssignmentTools({
    db,
    root,
    TOPICS,
    requireValue,
    requireAdmin,
    rosterFor,
    cleanTopics,
    idOf,
    emailOf,
    text,
    integer,
    bankReadiness
}) {
    const assignments = root.collection("assignments");
    const catalogRef = root.collection("state").doc("catalog");

    function groupCollection(actor) {
        requireAdmin(actor);

        // The path is derived from authenticated identity.
        // No client-supplied owner is accepted.
        return root
            .collection("groupOwners")
            .doc(actor.uid)
            .collection("groups");
    }

    async function listGroups(actor) {
        const collection = groupCollection(actor);

        const [snapshot, roster] = await Promise.all([
            collection.get(),
            rosterFor(actor)
        ]);

        const permitted = new Set(roster.map(student => student.email));

        return snapshot.docs.map(doc => {
            const group = doc.data();
            const stored = Array.isArray(group.emails) ? group.emails : [];
            const emails = stored.filter(email => permitted.has(email));

            return {
                id: doc.id,
                name: group.name,
                emails,
                unavailableCount: stored.length - emails.length,
                updatedAt: group.updatedAt || null
            };
        }).sort((a, b) => a.name.localeCompare(b.name));
    }

    async function saveGroup(actor, data) {
        const collection = groupCollection(actor);
        const id = idOf(data.id);
        const name = text(data.name, "Group name", 100);

        requireValue(
            Array.isArray(data.emails) &&
            data.emails.length >= 1 &&
            data.emails.length <= 100,
            "Select between 1 and 100 students for a group."
        );

        const emails = [...new Set(data.emails.map(emailOf))].sort();
        const roster = await rosterFor(actor);
        const permitted = new Set(roster.map(student => student.email));

        requireValue(
            emails.every(email => permitted.has(email)),
            "One or more students are no longer in your permitted roster.",
            "permission-denied"
        );

        const ref = collection.doc(id);

        await db.runTransaction(async tx => {
            const existing = await tx.get(ref);
            const now = Date.now();

            tx.set(ref, {
                id,
                name,
                emails,
                ownerUid: actor.uid,
                ownerEmail: actor.email,
                createdAt: existing.exists
                    ? existing.data().createdAt
                    : now,
                updatedAt: now
            });
        });

        return { ok: true, id };
    }

    async function deleteGroup(actor, data) {
        const collection = groupCollection(actor);
        await collection.doc(idOf(data.id)).delete();
        return { ok: true };
    }

    async function createTestAssignment(actor, data) {
        requireAdmin(actor);

        const requestId = idOf(data.id);
        requireValue(
            requestId.length <= 100,
            "The test request ID is too long."
        );

        const topics = cleanTopics(data.topics);
        const target = integer(data.target, 1, 50, "Required exercises");

        const id = `TEST-${requestId}`;
        const ref = assignments.doc(id);

        const fingerprint = createHash("sha256")
            .update(JSON.stringify({
                ownerUid: actor.uid,
                topics,
                target
            }))
            .digest("hex");

        await db.runTransaction(async tx => {
            const [existing, catalog] = await Promise.all([
                tx.get(ref),
                tx.get(catalogRef)
            ]);

            if (existing.exists) {
                const old = existing.data();

                requireValue(
                    old.testOnly === true &&
                    old.ownerUid === actor.uid &&
                    old.testFingerprint === fingerprint,
                    "This test request ID has already been used for different details.",
                    "failed-precondition"
                );

                return;
            }

            const availability = bankReadiness(
                catalog.data()?.items || [],
                topics
            );

            requireValue(
                availability.ready,
                availability.reason,
                "failed-precondition"
            );

            const now = Date.now();
            const topicTitle = topics.length === 1
                ? TOPICS.find(topic => topic.id === topics[0]).label
                : "Mixed practice";

            tx.create(ref, {
                id,
                email: actor.email,
                creator: actor.email,
                ownerUid: actor.uid,
                title: `[TEST] ${topicTitle}`,
                topics,
                presetId: null,
                target,
                compulsory: true,
                startsAt: now,
                dueAt: now + 7 * 24 * 60 * 60 * 1000,
                createdAt: now,
                completed: 0,
                late: 0,
                cancelled: false,
                testOnly: true,
                testFingerprint: fingerprint,
                notificationsEnabled: false
            });
        });

        return { ok: true, id };
    }

    return {
        listGroups,
        saveGroup,
        deleteGroup,
        createTestAssignment
    };
};