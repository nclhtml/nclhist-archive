"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { createHash } = require("node:crypto");

const db = admin.firestore();
const OWNER = "clng@ktls.edu.hk";

const LEVELS = ["S4", "S5", "S6"];
const BUCKETS = {
    S4: ["ut1", "exam1", "ut2", "exam2"],
    S5: ["ut1", "exam1", "ut2", "exam2"],
    S6: ["all"]
};

const MAX_ITEMS = 80;

function fail(code, message) {
    throw new functions.https.HttpsError(code, message);
}

function emailOf(context) {
    const token = context.auth?.token;

    if (
        !context.auth ||
        token?.email_verified !== true ||
        typeof token.email !== "string"
    ) {
        fail("unauthenticated", "Sign in with your verified Google account.");
    }

    return token.email.toLowerCase().trim();
}

function text(value, maximum = 200) {
    return typeof value === "string" && value.length <= maximum
        ? value
        : "";
}

function validId(value) {
    return typeof value === "string" &&
        /^[a-f0-9-]{36}$/.test(value);
}

function classKey(name) {
    return createHash("sha256").update(name).digest("hex");
}

function defaultTerms(className) {
    return className.includes("HIST EMI") ||
        className.includes("HIST CMI")
        ? ["S4 Term 1", "S4 Term 2", "S5 Term 1", "S5 Term 2", "S6"]
        : ["Term 1", "Term 2"];
}

function termsFor(map, className) {
    return Array.isArray(map[className])
        ? map[className]
        : defaultTerms(className);
}

function groupRef(level) {
    return db.collection("designated_private").doc(level);
}

function emptyConfig() {
    return {
        classes: [],
        terms: {}
    };
}

function canEdit(email, owner, config, classObjects) {
    return owner || (config.classes || []).some(name =>
        classObjects.some(info =>
            info.name === name && info.owner === email
        )
    );
}

// Conservative deletion protection:
// any non-empty saved student value, including zero, grades or comments,
// prevents automatic deletion.
function hasStudentData(value) {
    if (value === null || value === undefined || value === "") {
        return false;
    }

    if (typeof value === "string") return value.trim() !== "";
    if (typeof value === "number") return true;
    if (typeof value === "boolean") return value;

    if (typeof value === "object") {
        return Object.values(value).some(hasStudentData);
    }

    return false;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function publicItem(item) {
    const { bindings, ...output } = item;

    return {
        ...output,
        generatedCount: Object.keys(bindings || {}).length
    };
}

function validateConfig(input, level, classObjects, termMap) {
    const classes = input?.classes;

    if (
        !Array.isArray(classes) ||
        classes.length > 2 ||
        new Set(classes).size !== classes.length ||
        classes.some(name =>
            typeof name !== "string" ||
            !classObjects.some(info =>
                info.name === name && !info.isArchived
            )
        )
    ) {
        fail(
            "invalid-argument",
            "Assign at most two different active classes."
        );
    }

    const terms = {};

    for (const bucket of BUCKETS[level]) {
        terms[bucket] = {};

        for (const name of classes) {
            const term = input?.terms?.[bucket]?.[name];

            if (!termsFor(termMap, name).includes(term)) {
                fail(
                    "invalid-argument",
                    `Select a valid term for ${name} in every category.`
                );
            }

            terms[bucket][name] = term;
        }
    }

    return { classes: [...classes], terms };
}

exports.designatedAssessments = functions
    .region("us-central1")
    .runWith({
        timeoutSeconds: 120,
        memory: "512MB"
    })
    .https.onCall(async (data, context) => {
        try {
            const email = emailOf(context);
            const owner = email === OWNER;

            if (!owner) {
                const role = await db.collection("user_roles")
                    .doc(email).get();

                if (role.data()?.role !== "admin") {
                    fail("permission-denied", "Administrator access is required.");
                }
            }

            const action = data?.action || "load";

            if (![
                "load",
                "saveConfig",
                "saveItem",
                "deleteItem"
            ].includes(action)) {
                fail("invalid-argument", "Unknown designated-assessment action.");
            }

            return await db.runTransaction(async transaction => {
                const classSettingsRef = db.collection("settings").doc("classes");
                const termSettingsRef = db.collection("settings").doc("terms");

                const [classSnapshot, termSnapshot, ...groupSnapshots] =
                    await Promise.all([
                        transaction.get(classSettingsRef),
                        transaction.get(termSettingsRef),
                        ...LEVELS.map(level =>
                            transaction.get(groupRef(level))
                        )
                    ]);

                const classObjects = (classSnapshot.data()?.list || [])
                    .map(value =>
                        typeof value === "string"
                            ? {
                                name: value,
                                owner: OWNER,
                                isArchived: false
                            }
                            : value
                    )
                    .filter(value =>
                        value && typeof value.name === "string"
                    );

                const savedTermData = termSnapshot.data() || {};
                const termMap = { ...(savedTermData.map || {}) };

                if (!savedTermData.map && Array.isArray(savedTermData.list)) {
                    classObjects.forEach(info => {
                        termMap[info.name] = savedTermData.list;
                    });
                }

                const groups = Object.fromEntries(
                    LEVELS.map((level, index) => [
                        level,
                        {
                            revision: 0,
                            config: emptyConfig(),
                            ...(groupSnapshots[index].data() || {})
                        }
                    ])
                );

                const permittedLevels = LEVELS.filter(level =>
                    canEdit(
                        email,
                        owner,
                        groups[level].config,
                        classObjects
                    )
                );

                if (!permittedLevels.length) {
                    return {
                        owner,
                        levels: [],
                        classes: [],
                        termMap: {},
                        level: "",
                        config: emptyConfig(),
                        revision: 0,
                        items: []
                    };
                }

                const level = permittedLevels.includes(data?.level)
                    ? data.level
                    : action === "load"
                        ? permittedLevels[0]
                        : "";

                if (!level) {
                    fail("permission-denied", "This assessment list is unavailable.");
                }

                const reference = groupRef(level);
                const group = groups[level];

                const itemSnapshot = await transaction.get(
                    reference.collection("items").limit(MAX_ITEMS + 1)
                );

                if (itemSnapshot.size > MAX_ITEMS) {
                    fail(
                        "failed-precondition",
                        `This level exceeds the supported ${MAX_ITEMS} items.`
                    );
                }

                let items = itemSnapshot.docs.map(snapshot => ({
                    ...snapshot.data(),
                    id: snapshot.id
                }));

                const output = (extra = {}) => ({
                    owner,
                    levels: permittedLevels,
                    classes: classObjects.filter(info => !info.isArchived),
                    termMap,
                    level,
                    config: group.config,
                    revision: group.revision,
                    items: items.map(publicItem),
                    ...extra
                });

if (action === "load") return output();

                if (!owner) {
                    fail(
                        "permission-denied",
                        "Only the superadmin can edit designated lists. Class administrators can view them and upload missing PDFs."
                    );
                }

                // A shared revision protects configuration changes,
                // list edits and deletion from stale browser drafts.
                if (data.groupRevision !== group.revision) {
                    fail(
                        "failed-precondition",
                        "This list changed in another window. Reload it before saving."
                    );
                }

                const now = new Date().toISOString();
                let config = group.config;
                let affected = [];
                let deleting = null;

                if (action === "saveConfig") {
                    if (!owner) {
                        fail(
                            "permission-denied",
                            "Only the superadmin can change classes or terms."
                        );
                    }

                    config = validateConfig(
                        data.config,
                        level,
                        classObjects,
                        termMap
                    );

                    affected = items;
                } else {
                    const id = data.id;

                    if (!validId(id)) {
                        fail("invalid-argument", "Invalid list item ID.");
                    }

                    const existing = items.find(item => item.id === id);

                    if (action === "deleteItem") {
                        if (!existing) {
                            fail("not-found", "This list item was already deleted.");
                        }

                        deleting = existing;
                        affected = [existing];
                    } else {
                        if (!existing && items.length >= MAX_ITEMS) {
                            fail(
                                "failed-precondition",
                                `At most ${MAX_ITEMS} items are supported per level.`
                            );
                        }

                        const draft = data.item || {};

                        if (
                            !BUCKETS[level].includes(draft.bucket) ||
                            !["Assignments", "Quizzes"].includes(draft.category)
                        ) {
                            fail("invalid-argument", "Select a valid category.");
                        }

                        const name = text(draft.name, 160).trim();
                        const archiveId = text(draft.archiveId, 1500);
                        const linkedDocId = text(draft.linkedDocId, 3000);

                        if (
                            !name ||
                            archiveId.includes("/") ||
                            linkedDocId.includes("/") ||
                            Boolean(archiveId) !== Boolean(linkedDocId)
                        ) {
                            fail(
                                "invalid-argument",
                                "Enter an item name. A document is optional, but its archive and link identities must agree."
                            );
                        }

                        // Name-only items are valid.
                        // Validate document identity only when a link is supplied.
                        if (archiveId) {
                            const archiveSnapshot = await transaction.get(
                                db.collection("archives").doc(archiveId)
                            );

                            const archive = archiveSnapshot.data();

                            if (
                                !archive ||
                                !(
                                    linkedDocId === archiveId ||
                                    (archive.subQuestions || []).some(child =>
                                        `${archiveId}_${child.id}` === linkedDocId
                                    )
                                )
                            ) {
                                fail(
                                    "failed-precondition",
                                    "The selected document or question part no longer exists."
                                );
                            }
                        }

                        let addToMarks = existing?.addToMarks ?? true;

                        if (owner) {
                            if (typeof draft.addToMarks !== "boolean") {
                                fail(
                                    "invalid-argument",
                                    "Choose whether to add this item to Marks."
                                );
                            }

                            addToMarks = draft.addToMarks;
                        } else if (
                            draft.addToMarks !== undefined &&
                            draft.addToMarks !== addToMarks
                        ) {
                            fail(
                                "permission-denied",
                                "Only the superadmin can change Add to Marks."
                            );
                        }

                        const item = {
                            id,
                            name,
                            archiveId,
                            linkedDocId,
                            bucket: draft.bucket,
                            category: draft.category,
                            addToMarks,
                            order: Number.isFinite(Number(draft.order))
                                ? Number(draft.order)
                                : Date.now(),
bindings: existing?.bindings || {},
                            excludedClasses: existing?.excludedClasses || {},
                            createdAt: existing?.createdAt || now,
                            updatedAt: now,
                            updatedBy: email
                        };

                        items = [
                            ...items.filter(value => value.id !== id),
                            item
                        ];

                        affected = [item];
                    }
                }

                // Read every potentially affected assessment before writing.
                // Existing bindings are retained even when a class is unassigned.
                const targetRefs = new Map();

                affected.forEach(item => {
                    Object.values(item.bindings || {}).forEach(binding => {
                        targetRefs.set(
                            binding.assessmentId,
                            db.collection("assessments").doc(binding.assessmentId)
                        );
                    });

                    if (!deleting && item.addToMarks) {
                        config.classes.forEach(className => {
                            const key = classKey(className);
                            const id = item.bindings?.[key]?.assessmentId ||
                                `designated_${level}_${item.id}_${key}`;

                            targetRefs.set(
                                id,
                                db.collection("assessments").doc(id)
                            );
                        });
                    }
                });

                if (targetRefs.size > 300) {
                    fail(
                        "failed-precondition",
                        "This change affects too many historical class copies. No changes were saved."
                    );
                }

                const targetSnapshots = await Promise.all(
                    [...targetRefs.values()].map(ref =>
                        transaction.get(ref)
                    )
                );

                const targetMap = new Map(
                    targetSnapshots.map(snapshot => [
                        snapshot.id,
                        snapshot
                    ])
                );

                const retained = [];
                const removed = [];
                const skipped = [];
                let created = 0;
                let updated = 0;

                if (deleting) {
                    for (const binding of Object.values(deleting.bindings || {})) {
                        const snapshot = targetMap.get(binding.assessmentId);

                        if (!snapshot?.exists) continue;

                        const assessment = snapshot.data();

                        if (hasStudentData(assessment.marks || {})) {
                            retained.push({
                                id: snapshot.id,
                                name: assessment.name || deleting.name,
                                className: binding.className
                            });

                            transaction.update(snapshot.ref, {
                                designatedSourceDeletedAt: now
                            });
                        } else {
                            transaction.delete(snapshot.ref);
                            removed.push(snapshot.id);
                        }
                    }

                    transaction.delete(
                        reference.collection("items").doc(deleting.id)
                    );

                    items = items.filter(item => item.id !== deleting.id);

                    if (retained.length) {
                        const log = db.collection("admin_logs").doc();

                        transaction.set(log, {
                            type: "DESIGNATED_RETAINED",
                            timestamp: now,
                            viewed: false,
                            message:
                                `<b>Designated item deleted:</b> ` +
                                escapeHtml(deleting.name) +
                                `<br/>Requested by: ${escapeHtml(email)}` +
                                `<br/><b>${retained.length} marked/student-data item(s) retained.</b>` +
                                retained.map(item =>
                                    `<br/>${escapeHtml(item.className)} — ` +
                                    `${escapeHtml(item.name)} [${escapeHtml(item.id)}]`
                                ).join("")
                        });
                    }
                } else {
                    for (const item of affected) {
                        const bindings = { ...(item.bindings || {}) };

                        if (item.addToMarks) {
for (const className of config.classes) {
                                const key = classKey(className);

                                if (item.excludedClasses?.[key] === true) {
                                    continue;
                                }

                                const previous = bindings[key];

                                const assessmentId = previous?.assessmentId ||
                                    `designated_${level}_${item.id}_${key}`;

                                const snapshot = targetMap.get(assessmentId);
                                const term = config.terms?.[item.bucket]?.[className];

                                if (!termsFor(termMap, className).includes(term)) {
                                    fail(
                                        "failed-precondition",
                                        "A saved class term no longer exists. Ask the superadmin to update class settings."
                                    );
                                }

                                // The common name is only an initial name.
                                // Existing class assessment names belong to Marks.
                                const desired = {
                                    category: item.category,
                                    term,
                                    linkedDocId: item.linkedDocId
                                };

                                // Never recreate a previously bound assessment
                                // merely because someone removed it elsewhere.
                                if (previous && !snapshot?.exists) {
                                    skipped.push(assessmentId);
                                    continue;
                                }

                                if (!previous && snapshot?.exists) {
                                    fail(
                                        "already-exists",
                                        "A generated assessment ID is already in use."
                                    );
                                }

                                if (!previous) {
                                    transaction.set(
                                        targetRefs.get(assessmentId),
                                        {
                                            ...desired,

                                            // Initial default only.
                                            // Subsequent source saves never update this name.
                                            name: item.name,

                                            classes: [className],
                                            marks: {},
                                            date: "",
                                            fullMark: null,
                                            paperFullMark: null,
                                            sectionsConfig: null,
                                            isDisclosed: false,
                                            designatedPending: true,
                                            designatedSource: {
                                                level,
                                                itemId: item.id
                                            },
                                            order: item.order,
                                            createdAt: now
                                        }
                                    );

                                    created++;
                                } else {
                                    const patch = {};

                                    // Only changed SOURCE fields propagate.
                                    // Unrelated saves must not overwrite edits
                                    // that were made independently in Marks.
                                    Object.entries(desired).forEach(([field, value]) => {
                                        if (previous.last?.[field] !== value) {
                                            patch[field] = value;
                                        }
                                    });

                                    if (Object.keys(patch).length) {
                                        transaction.update(
                                            targetRefs.get(assessmentId),
                                            patch
                                        );

                                        updated++;
                                    }
                                }

                                bindings[key] = {
                                    className,
                                    assessmentId,
                                    last: desired
                                };
                            }
                        }

                        const savedItem = {
                            ...item,
                            bindings
                        };

                        const { id, ...savedData } = savedItem;

                        transaction.set(
                            reference.collection("items").doc(id),
                            savedData
                        );

                        items = items.map(value =>
                            value.id === id ? savedItem : value
                        );
                    }
                }

                const revision = group.revision + 1;

                transaction.set(reference, {
                    config,
                    revision,
                    updatedAt: now,
                    updatedBy: email
                });

                return output({
                    config,
                    revision,
                    result: {
                        created,
                        updated,
                        removed,
                        retained,
                        skipped
                    }
                });
            });
        } catch (error) {
            if (error instanceof functions.https.HttpsError) throw error;

            console.error("Designated assessment operation failed:", error);

            throw new functions.https.HttpsError(
                "internal",
                "The designated-assessment operation failed. Check the function logs before retrying."
            );
        }
    });