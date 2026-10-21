"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { createHash } = require("node:crypto");

const db = admin.firestore();
const OWNER = "clng@ktls.edu.hk";

const BUCKETS = {
    S4: ["ut1", "exam1", "ut2", "exam2"],
    S5: ["ut1", "exam1", "ut2", "exam2"],
    S6: ["all"]
};

function fail(code, message) {
    throw new functions.https.HttpsError(code, message);
}

function validId(value) {
    return typeof value === "string" &&
        value.length > 0 &&
        value.length <= 1500 &&
        !value.includes("/");
}

function classTerms(name, saved) {
    if (Array.isArray(saved.map?.[name])) return saved.map[name];
    if (Array.isArray(saved.list)) return saved.list;

    return name.includes("HIST EMI") || name.includes("HIST CMI")
        ? ["S4 Term 1", "S4 Term 2", "S5 Term 1", "S5 Term 2", "S6"]
        : ["Term 1", "Term 2"];
}

function defaultLanguage(name) {
    if (/CMI/i.test(name)) return "zh";
    if (/EMI/i.test(name)) return "en";
    return "";
}

function bindingClassKey(name) {
    return createHash("sha256").update(name).digest("hex");
}

// Conservative protection: zero, grades, comments and other
// non-empty student values all prevent automatic replacement.
function containsStudentData(value) {
    if (value === null || value === undefined || value === "") {
        return false;
    }

    if (typeof value === "string") return value.trim() !== "";
    if (typeof value === "number") return true;
    if (typeof value === "boolean") return value;

    if (typeof value === "object") {
        return Object.values(value).some(containsStudentData);
    }

    return false;
}

exports.designatedIncoming = functions
    .region("us-central1")
    .runWith({ timeoutSeconds: 120, memory: "512MB" })
    .https.onCall(async (data, context) => {
        try {
            const token = context.auth?.token;

            if (
                !context.auth ||
                token?.email_verified !== true ||
                typeof token.email !== "string"
            ) {
                fail("unauthenticated", "Sign in with your verified account.");
            }

            const email = token.email.toLowerCase().trim();
            const owner = email === OWNER;

            if (!owner) {
                const role = await db.collection("user_roles").doc(email).get();

                if (role.data()?.role !== "admin") {
                    fail("permission-denied", "Administrator access is required.");
                }
            }

            const level = data?.level;
            const action = data?.action || "load";

            if (
                !BUCKETS[level] ||
![
                    "load",
                    "stop",
                    "language",
                    "reorder",
                    "link",
                    "commonOrder",
                    "adopt",
                    "detach"
                ].includes(action)
            ) {
                fail("invalid-argument", "Invalid incoming-assessment request.");
            }

            return await db.runTransaction(async transaction => {
                const groupRef = db.collection("designated_private").doc(level);
                const stateRef = db.collection("designated_incoming_private")
                    .doc(level);

                const [
                    classSnapshot,
                    termSnapshot,
                    groupSnapshot,
                    stateSnapshot,
                    commonSnapshot
                ] = await Promise.all([
                    transaction.get(db.collection("settings").doc("classes")),
                    transaction.get(db.collection("settings").doc("terms")),
                    transaction.get(groupRef),
                    transaction.get(stateRef),
                    transaction.get(groupRef.collection("items"))
                ]);

                const classObjects = (classSnapshot.data()?.list || [])
                    .map(value => typeof value === "string"
                        ? { name: value, owner: OWNER }
                        : value
                    )
                    .filter(value => value && typeof value.name === "string");

                const group = groupSnapshot.data() || {
                    revision: 0,
                    config: { classes: [], terms: {} }
                };

                const config = group.config;
                const names = config.classes || [];

                const ownsClass = name =>
                    owner || classObjects.some(info =>
                        info.name === name && info.owner === email
                    );

                if (!owner && !names.some(ownsClass)) {
                    fail("permission-denied", "You do not manage this list.");
                }

                if (
                    !owner &&
                    !["load", "link"].includes(action)
                ) {
                    fail(
                        "permission-denied",
                        "Only the superadmin can edit lists, reorder items or attach assessments. Class administrators may only add a missing document link to their own class assessment."
                    );
                }

                const saved = stateSnapshot.data() || {};
                const state = {
                    revision: saved.revision || 0,
                    closed: { ...(saved.closed || {}) },
                    languages: { ...(saved.languages || {}) },
                    slots: { ...(saved.slots || {}) }
                };

                if (
                    action !== "load" &&
                    data.revision !== state.revision
                ) {
                    fail(
                        "failed-precondition",
                        "Incoming items changed elsewhere. Reload and retry."
                    );
                }

                const snapshots = [];

                for (const name of names) {
                    const pair = await Promise.all([
                        transaction.get(
                            db.collection("assessments")
                                .where("classes", "array-contains", name)
                        ),
                        transaction.get(
                            db.collection("assessments")
                                .where("className", "==", name)
                        )
                    ]);

                    snapshots.push(...pair);
                }

                const assessments = new Map();

                snapshots.forEach(snapshot => {
                    snapshot.docs.forEach(document => {
                        const item = document.data();

                        if (
                            !item.designatedSource &&
                            ["Assignments", "Quizzes"].includes(item.category)
                        ) {
                            assessments.set(document.id, {
                                ...item,
                                id: document.id
                            });
                        }
                    });
                });

                if (assessments.size > 600) {
                    fail(
                        "failed-precondition",
                        "More than 600 ordinary assignments/quizzes were found. No routing changes were saved."
                    );
                }

                let changed = false;

                if (action === "stop") {
                    if (!owner) {
                        fail("permission-denied", "Superadmin access required.");
                    }

                    if (
                        !BUCKETS[level].includes(data.bucket) ||
                        typeof data.closed !== "boolean"
                    ) {
                        fail("invalid-argument", "Invalid category setting.");
                    }

                    state.closed[data.bucket] = data.closed;
                    changed = true;
                }

                if (action === "language") {
                    if (
                        !owner ||
                        !names.includes(data.className) ||
                        !["zh", "en"].includes(data.language)
                    ) {
                        fail("permission-denied", "Invalid language setting.");
                    }

                    state.languages[data.className] = data.language;
                    changed = true;
                }

                // Load the actual Marks records bound to common items.
                // These are separate from the ordinary incoming records.
                const boundReferences = new Map();

                commonSnapshot.docs.forEach(commonDocument => {
                    const commonItem = commonDocument.data();

                    Object.values(commonItem.bindings || {}).forEach(binding => {
                        if (
                            names.includes(binding.className) &&
                            validId(binding.assessmentId)
                        ) {
                            boundReferences.set(
                                binding.assessmentId,
                                db.collection("assessments")
                                    .doc(binding.assessmentId)
                            );
                        }
                    });
                });

                if (boundReferences.size > 200) {
                    fail(
                        "failed-precondition",
                        "Too many common-item class bindings were found."
                    );
                }

                const boundSnapshots = await Promise.all(
                    [...boundReferences.values()].map(reference =>
                        transaction.get(reference)
                    )
                );

                const boundMap = new Map(
                    boundSnapshots.map(snapshot => [
                        snapshot.id,
                        snapshot
                    ])
                );

                const boundCopies = [];

                commonSnapshot.docs.forEach(commonDocument => {
                    const commonItem = commonDocument.data();

                    Object.values(commonItem.bindings || {}).forEach(binding => {
                        if (!names.includes(binding.className)) return;

                        const snapshot = boundMap.get(binding.assessmentId);

                        if (!snapshot?.exists) return;

                        const assessment = snapshot.data();

                        if (
                            assessment.designatedSource?.level !== level ||
                            assessment.designatedSource?.itemId !== commonDocument.id
                        ) {
                            return;
                        }

                        const matchesClass = Array.isArray(assessment.classes)
                            ? assessment.classes.includes(binding.className)
                            : assessment.className === binding.className;

                        if (!matchesClass) return;

                        boundCopies.push({
                            key:
                                `bound:${commonDocument.id}:` +
                                encodeURIComponent(binding.className),
                            commonId: commonDocument.id,
                            assessmentId: snapshot.id,
                            className: binding.className,
                            bucket: commonItem.bucket,
                            category: commonItem.category,
                            name: assessment.name || "Unnamed assessment",
                            term: assessment.term || "",
                            date: assessment.date || "",
                            linkedDocId: assessment.linkedDocId || "",
                            pending: assessment.designatedPending === true,
                            editable: owner,
                            uploadAllowed: ownsClass(binding.className)
                        });
                    });
                });

const records = [];
                const validSlots = new Set();
                const routingNotices = [];

                const ordered = [...assessments.values()].sort((a, b) =>
                    (Number(a.order) || 0) - (Number(b.order) || 0) ||
                    String(a.date || "").localeCompare(String(b.date || "")) ||
                    a.id.localeCompare(b.id)
                );

                ordered.forEach(item => {
                    const classes = names.filter(name =>
                        Array.isArray(item.classes)
                            ? item.classes.includes(name)
                            : item.className === name
                    );

                    classes.forEach(className => {
                        const key = `${item.id}:${encodeURIComponent(className)}`;

                        const actualTerm = item.term ||
                            classTerms(
                                className,
                                termSnapshot.data() || {}
                            )[0] ||
                            "";

                        const eligible = BUCKETS[level].filter(bucket =>
                            config.terms?.[bucket]?.[className] === actualTerm
                        );

                        let slot = state.slots[key];

                        // Keep a prior placement if its term still matches.
                        if (slot && !eligible.includes(slot.bucket)) {
                            delete state.slots[key];
                            slot = null;
                            changed = true;
                        }

                        if (!slot) {
                            const bucket = eligible.find(value =>
                                state.closed[value] !== true
                            );

// Report why a newly discovered assessment
                            // could not be routed into the visible list.
                            if (!bucket) {
                                routingNotices.push({
                                    assessmentId: item.id,
                                    className,
                                    name: item.name || "Unnamed assessment",
                                    term: actualTerm,
                                    reason: eligible.length
                                        ? "All categories matching this class term are stopped."
                                        : `Its term "${actualTerm}" does not match any configured category term for this class.`
                                });

                                return;
                            }

                            const highest = Math.max(
                                0,
                                ...Object.values(state.slots)
                                    .filter(value =>
                                        value.bucket === bucket &&
                                        value.className === className &&
                                        value.category === item.category
                                    )
                                    .map(value => Number(value.order) || 0)
                            );

                            slot = {
                                assessmentId: item.id,
                                className,
                                category: item.category,
                                bucket,
                                order: highest + 1
                            };

                            state.slots[key] = slot;
                            changed = true;
                        }

                        if (slot.category !== item.category) {
                            slot = { ...slot, category: item.category };
                            state.slots[key] = slot;
                            changed = true;
                        }

                        validSlots.add(key);

                        records.push({
                            key,
                            ...slot,
                            name: item.name || "Unnamed assessment",
                            term: actualTerm,
                            date: item.date || "",
                            linkedDocId: item.linkedDocId || "",
                            editable: owner,
                            uploadAllowed: ownsClass(className)
                        });
                    });
                });

                Object.keys(state.slots).forEach(key => {
                    if (!validSlots.has(key)) {
                        delete state.slots[key];
                        changed = true;
                    }
                });

let linkPatch = null;
                let commonChanged = false;
                let adoption = null;
                let detachment = null;

                const common = commonSnapshot.docs.map(document => {
                    const { bindings, ...item } = document.data();

                    return { ...item, id: document.id };
                });

                if (action === "reorder") {
                    const target = records.find(record =>
                        record.key === data.key
                    );

                    if (!target || !ownsClass(target.className)) {
                        fail("permission-denied", "You cannot reorder this class.");
                    }

                    const list = records
                        .filter(record =>
                            record.className === target.className &&
                            record.bucket === target.bucket &&
                            record.category === target.category
                        )
                        .sort((a, b) => a.order - b.order ||
                            a.key.localeCompare(b.key));

                    const index = list.findIndex(value => value.key === target.key);
                    const other = index + (data.direction === "up" ? -1 : 1);

                    if (
                        !["up", "down"].includes(data.direction) ||
                        other < 0 ||
                        other >= list.length
                    ) {
                        fail("invalid-argument", "Invalid reorder operation.");
                    }

                    [list[index], list[other]] = [list[other], list[index]];

                    list.forEach((record, position) => {
                        record.order = position + 1;
                        state.slots[record.key].order = position + 1;
                    });

                    changed = true;
                }

                if (action === "link") {
                    const target = [...records, ...boundCopies].find(record =>
                        record.key === data.key
                    );

                    if (!target || !ownsClass(target.className)) {
                        fail("permission-denied", "You cannot edit this class.");
                    }

                    const item = target.commonId
                        ? boundMap.get(target.assessmentId)?.data()
                        : assessments.get(target.assessmentId);

                    if (!item) {
                        fail(
                            "not-found",
                            "This assessment was removed. Reload the list."
                        );
                    }

                    // Class administrators may repair an empty link,
                    // but cannot replace or remove an existing link.
                    if (!owner) {
                        if (
                            !ownsClass(target.className) ||
                            (item.linkedDocId || "") !== "" ||
                            typeof data.linkedDocId !== "string" ||
                            !data.linkedDocId
                        ) {
                            fail(
                                "permission-denied",
                                "You may only add a missing document link to your own class assessment. Existing links cannot be changed here."
                            );
                        }

                        // A shared assessment must not let one class owner
                        // change another owner's class link indirectly.
                        const linkedClasses = Array.isArray(item.classes)
                            ? item.classes
                            : [item.className];

                        if (!linkedClasses.every(ownsClass)) {
                            fail(
                                "permission-denied",
                                "This assessment is shared with a class you do not manage. Ask the superadmin to link its document."
                            );
                        }
                    }

                    const link = data.linkedDocId || "";
                    const archiveId = data.archiveId || "";

                    if (
                        Boolean(link) !== Boolean(archiveId) ||
                        (archiveId && !validId(archiveId)) ||
                        typeof link !== "string" ||
                        link.length > 3000 ||
                        link.includes("/")
                    ) {
                        fail("invalid-argument", "Invalid document link.");
                    }

                    if (archiveId) {
                        const archive = await transaction.get(
                            db.collection("archives").doc(archiveId)
                        );

                        if (
                            !archive.exists ||
                            !(
                                link === archiveId ||
                                (archive.data().subQuestions || []).some(child =>
                                    `${archiveId}_${child.id}` === link
                                )
                            )
                        ) {
                            fail(
                                "failed-precondition",
                                "The selected archive or question part was removed."
                            );
                        }
                    }

                    if (
                        (item.linkedDocId || "") !==
                        (data.expectedLink || "")
                    ) {
                        fail(
                            "failed-precondition",
                            "The assessment link changed. Reload before saving."
                        );
                    }

                    linkPatch = {
                        id: target.assessmentId,
                        link
                    };

                    [...records, ...boundCopies].forEach(record => {
                        if (record.assessmentId === target.assessmentId) {
                            record.linkedDocId = link;
                        }
                    });
                }

                if (action === "adopt") {
                    if (data.groupRevision !== (group.revision || 0)) {
                        fail(
                            "failed-precondition",
                            "The common list changed. Reload before attaching an existing Marks item."
                        );
                    }

                    const target = records.find(record =>
                        record.key === data.key
                    );

                    if (!target || !ownsClass(target.className)) {
                        fail(
                            "permission-denied",
                            "You cannot attach this class's assessment."
                        );
                    }

                    const commonDocument = commonSnapshot.docs.find(document =>
                        document.id === data.commonId
                    );

                    if (!commonDocument) {
                        fail("not-found", "The selected common item was removed.");
                    }

                    const commonItem = commonDocument.data();
                    const assessment = assessments.get(target.assessmentId);

                    if (
                        !assessment ||
                        assessment.designatedSource ||
                        commonItem.bucket !== target.bucket ||
                        commonItem.category !== target.category
                    ) {
                        fail(
                            "failed-precondition",
                            "Choose a common item in the same category and Assignment/Quiz column."
                        );
                    }

                    const assignedClasses = Array.isArray(assessment.classes)
                        ? [...new Set(assessment.classes)]
                        : assessment.className
                            ? [assessment.className]
                            : [];

                    // Do not attach a shared multi-class assessment as if
                    // it belonged to one independent class copy.
                    if (
                        assignedClasses.length !== 1 ||
                        assignedClasses[0] !== target.className
                    ) {
                        fail(
                            "failed-precondition",
                            "This assessment is shared by multiple classes. It cannot be adopted as one independent class copy. No records were changed."
                        );
                    }

                    const key = bindingClassKey(target.className);
                    const bindings = { ...(commonItem.bindings || {}) };
                    const previous = bindings[key];

                    let replaceRef = null;

                    if (previous) {
                        if (previous.assessmentId === target.assessmentId) {
                            fail(
                                "already-exists",
                                "This assessment is already attached to that common item."
                            );
                        }

                        if (!validId(previous.assessmentId)) {
                            fail(
                                "failed-precondition",
                                "The saved common-item binding is invalid."
                            );
                        }

                        const existingCopyRef = db.collection("assessments")
                            .doc(previous.assessmentId);

                        const existingCopy = await transaction.get(
                            existingCopyRef
                        );

                        if (existingCopy.exists) {
                            const existing = existingCopy.data();

                            if (
                                existing.designatedSource?.level !== level ||
                                existing.designatedSource?.itemId !== data.commonId
                            ) {
                                fail(
                                    "failed-precondition",
                                    "The existing class binding does not belong to this common item."
                                );
                            }

                            const existingClasses = Array.isArray(existing.classes)
                                ? existing.classes
                                : [existing.className];

                            if (
                                existingClasses.length !== 1 ||
                                existingClasses[0] !== target.className
                            ) {
                                fail(
                                    "failed-precondition",
                                    "The existing generated copy has a different class assignment."
                                );
                            }

                            if (containsStudentData(existing.marks || {})) {
                                fail(
                                    "failed-precondition",
                                    "This common item already has a class copy containing student data. It was retained, and the dragged assessment was not changed."
                                );
                            }

                            replaceRef = existingCopyRef;
                        }
                    }

                    const expectedTerm =
                        config.terms?.[commonItem.bucket]?.[target.className];

                    if (target.term !== expectedTerm) {
                        fail(
                            "failed-precondition",
                            "The assessment no longer matches this category's assigned class term."
                        );
                    }

                    const now = new Date().toISOString();

                    bindings[key] = {
                        className: target.className,
                        assessmentId: target.assessmentId,

                        // Baseline SOURCE values, not a command to overwrite
                        // the adopted record's current fields.
                        //
                        // Only later actual source-field changes propagate.
                        last: {
                            category: commonItem.category,
                            term: expectedTerm,
                            linkedDocId: commonItem.linkedDocId || ""
                        }
                    };

const excludedClasses = {
                        ...(commonItem.excludedClasses || {})
                    };

                    delete excludedClasses[key];

                    adoption = {
                        assessmentRef: db.collection("assessments")
                            .doc(target.assessmentId),
                        commonRef: commonDocument.ref,
                        bindings,
                        excludedClasses,
                        replaceRef,
                        now
                    };

                    // Remove all incoming placements for this assessment.
                    // Its original assessment record is retained.
                    Object.keys(state.slots).forEach(slotKey => {
                        if (
                            state.slots[slotKey].assessmentId ===
                            target.assessmentId
                        ) {
                            delete state.slots[slotKey];
                        }
                    });

                    for (let index = records.length - 1; index >= 0; index--) {
                        if (
                            records[index].assessmentId ===
                            target.assessmentId
                        ) {
                            records.splice(index, 1);
                        }
                    }

                    changed = true;
                }

if (action === "detach") {
                    if (!owner) {
                        fail(
                            "permission-denied",
                            "Only the superadmin can return an attached assessment."
                        );
                    }

                    if (data.groupRevision !== (group.revision || 0)) {
                        fail(
                            "failed-precondition",
                            "The common list changed. Reload before returning an assessment."
                        );
                    }

                    const target = boundCopies.find(record =>
                        record.key === data.key
                    );

                    if (!target) {
                        fail(
                            "not-found",
                            "This attached assessment was removed or changed."
                        );
                    }

                    const commonDocument = commonSnapshot.docs.find(document =>
                        document.id === target.commonId
                    );

                    const assessmentSnapshot = boundMap.get(
                        target.assessmentId
                    );

                    if (!commonDocument || !assessmentSnapshot?.exists) {
                        fail(
                            "not-found",
                            "The common item or assessment no longer exists."
                        );
                    }

                    const commonItem = commonDocument.data();
                    const assessment = assessmentSnapshot.data();

                    if (
                        assessment.designatedSource?.level !== level ||
                        assessment.designatedSource?.itemId !== target.commonId
                    ) {
                        fail(
                            "failed-precondition",
                            "The assessment no longer belongs to this common item."
                        );
                    }

                    const actualTerm = assessment.term ||
                        classTerms(
                            target.className,
                            termSnapshot.data() || {}
                        )[0] ||
                        "";

                    if (
                        config.terms?.[target.bucket]?.[target.className] !==
                        actualTerm
                    ) {
                        fail(
                            "failed-precondition",
                            "This assessment's term no longer matches this category. Correct its term or the category assignment first."
                        );
                    }

                    const classBindingKey = bindingClassKey(target.className);
                    const bindings = { ...(commonItem.bindings || {}) };

                    if (
                        bindings[classBindingKey]?.assessmentId !==
                        target.assessmentId
                    ) {
                        fail(
                            "failed-precondition",
                            "The class binding changed. Reload and retry."
                        );
                    }

                    delete bindings[classBindingKey];

                    // Suppress automatic recreation for this particular
                    // common item/class until explicitly attached again.
                    const excludedClasses = {
                        ...(commonItem.excludedClasses || {}),
                        [classBindingKey]: true
                    };

                    const incomingKey =
                        `${target.assessmentId}:` +
                        encodeURIComponent(target.className);

                    const nextOrder = Math.max(
                        0,
                        ...Object.values(state.slots)
                            .filter(slot =>
                                slot.className === target.className &&
                                slot.bucket === target.bucket &&
                                slot.category === target.category
                            )
                            .map(slot => Number(slot.order) || 0)
                    ) + 1;

                    const slot = {
                        assessmentId: target.assessmentId,
                        className: target.className,
                        category: target.category,
                        bucket: target.bucket,
                        order: nextOrder
                    };

                    state.slots[incomingKey] = slot;

                    records.push({
                        key: incomingKey,
                        ...slot,
                        name: assessment.name || "Unnamed assessment",
                        term: actualTerm,
                        date: assessment.date || "",
                        linkedDocId: assessment.linkedDocId || "",
                        editable: true,
                        uploadAllowed: true
                    });

                    const copyIndex = boundCopies.findIndex(record =>
                        record.key === target.key
                    );

                    if (copyIndex >= 0) boundCopies.splice(copyIndex, 1);

                    detachment = {
                        commonRef: commonDocument.ref,
                        assessmentRef: assessmentSnapshot.ref,
                        bindings,
                        excludedClasses,
                        pending: assessment.designatedPending === true,
                        now: new Date().toISOString()
                    };

                    changed = true;
                }

                if (action === "commonOrder") {
                    if (data.groupRevision !== (group.revision || 0)) {
                        fail(
                            "failed-precondition",
                            "The common list changed. Reload before reordering."
                        );
                    }

                    const target = common.find(item => item.id === data.id);

                    if (!target) fail("not-found", "Common item not found.");

                    const list = common
                        .filter(item =>
                            item.bucket === target.bucket &&
                            item.category === target.category
                        )
                        .sort((a, b) =>
                            Number(a.order) - Number(b.order) ||
                            a.id.localeCompare(b.id)
                        );

                    const index = list.findIndex(item => item.id === target.id);
                    const other = index + (data.direction === "up" ? -1 : 1);

                    if (
                        !["up", "down"].includes(data.direction) ||
                        other < 0 ||
                        other >= list.length
                    ) {
                        fail("invalid-argument", "Invalid common-item reorder.");
                    }

                    [list[index], list[other]] = [list[other], list[index]];

                    list.forEach((item, position) => {
                        item.order = position + 1;
                    });

                    commonChanged = true;
                }

// All transaction reads above; writes below.
                if (detachment) {
                    const remove = admin.firestore.FieldValue.delete();

                    transaction.update(detachment.assessmentRef, {
                        designatedSource: remove,
                        designatedAdoptedAt: remove,
                        designatedAdoptedBy: remove,
                        designatedSourceDeletedAt: remove,

                        // Keep an unconfigured placeholder unconfigured.
                        designatedPending: detachment.pending
                    });

                    transaction.update(detachment.commonRef, {
                        bindings: detachment.bindings,
                        excludedClasses: detachment.excludedClasses,
                        updatedAt: detachment.now,
                        updatedBy: email
                    });

                    transaction.update(groupRef, {
                        revision: (group.revision || 0) + 1,
                        updatedAt: detachment.now,
                        updatedBy: email
                    });
                }

                if (adoption) {
                    if (adoption.replaceRef) {
                        // Already checked transactionally:
                        // no student data exists in this generated copy.
                        transaction.delete(adoption.replaceRef);
                    }

                    transaction.update(adoption.assessmentRef, {
                        designatedSource: {
                            level,
                            itemId: data.commonId
                        },

                        // Existing assessment is already configured.
                        // Its original configuration and marks stay intact.
                        designatedPending: false,
                        designatedAdoptedAt: adoption.now,
                        designatedAdoptedBy: email
                    });

transaction.update(adoption.commonRef, {
                        bindings: adoption.bindings,
                        excludedClasses: adoption.excludedClasses,
                        updatedAt: adoption.now,
                        updatedBy: email
                    });

                    transaction.update(groupRef, {
                        revision: (group.revision || 0) + 1,
                        updatedAt: adoption.now,
                        updatedBy: email
                    });
                }

                if (changed) {
                    state.revision++;

                    transaction.set(stateRef, {
                        ...state,
                        updatedAt: new Date().toISOString()
                    });
                }

                if (linkPatch) {
                    transaction.update(
                        db.collection("assessments").doc(linkPatch.id),
                        { linkedDocId: linkPatch.link || null }
                    );

                    transaction.set(
                        db.collection("settings")
                            .doc("designated_link_updates"),
                        {
                            revision: db.collection("_ids").doc().id,
                            updatedAt: new Date().toISOString()
                        }
                    );
                }

                if (commonChanged) {
                    common.forEach(item => {
                        transaction.update(
                            groupRef.collection("items").doc(item.id),
                            { order: item.order }
                        );
                    });

                    transaction.update(groupRef, {
                        revision: (group.revision || 0) + 1
                    });
                }

                return {
                    level,
                    owner,
                    revision: state.revision,
groupRevision: commonChanged || adoption || detachment
                        ? (group.revision || 0) + 1
                        : group.revision || 0,
                    config,
                    closed: state.closed,
                    languages: Object.fromEntries(names.map(name => [
                        name,
                        state.languages[name] || defaultLanguage(name)
                    ])),
classes: names,
                    records,
                    boundCopies,
                    common,
                    routingNotices,
                    loadedAt: new Date().toISOString()
                };
            });
        } catch (error) {
            if (error instanceof functions.https.HttpsError) throw error;

            console.error("Incoming designated items failed:", error);

            throw new functions.https.HttpsError(
                "internal",
                "Incoming assessment synchronization failed. Check the function logs."
            );
        }
    });