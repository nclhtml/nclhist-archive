"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

const db = admin.firestore();
const OWNER_EMAIL = "clng@ktls.edu.hk";
const ACCESS_POLICY_VERSION = 2;

function cleanEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function validDocumentId(value) {
    return (
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 1500 &&
        !value.includes("/") &&
        value !== "." &&
        value !== ".."
    );
}

function childrenOf(archive) {
    return Array.isArray(archive.subQuestions)
        ? archive.subQuestions
        : [];
}

function isVersionManaged(archive) {
    return Object.prototype.hasOwnProperty.call(
        archive,
        "versionFamilyId"
    );
}

function validVersion(archive) {
    return !isVersionManaged(archive) || (
        typeof archive.versionFamilyId === "string" &&
        archive.versionFamilyId.length > 0 &&
        typeof archive.versionId === "string" &&
        archive.versionId.length > 0
    );
}

function normalizeTitle(value) {
    return String(value || "")
        .normalize("NFKC")
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
        .replace(/[–—]/g, "-")
        .toLowerCase()
        .replace(/\s+/g, "");
}

// Match the corresponding question set across versions.
// Different question titles remain independent.
function documentGroupKey(archive) {
    return isVersionManaged(archive)
        ? JSON.stringify([
            archive.versionFamilyId,
            normalizeTitle(archive.title)
        ])
        : JSON.stringify(["record", archive.id]);
}

function hongKongNow() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    const values = Object.fromEntries(
        parts.map(part => [part.type, part.value])
    );

    return (
        `${values.year}-${values.month}-${values.day}` +
        `T${values.hour}:${values.minute}`
    );
}

async function readAccount(email) {
    if (email === OWNER_EMAIL) {
        return {
            email,
            role: "admin",
            isAdmin: true,
            classes: [],
            assignmentState: "administrator"
        };
    }

    const roleSnapshot = await db
        .collection("user_roles")
        .doc(email)
        .get();

    if (!roleSnapshot.exists) {
        throw new functions.https.HttpsError(
            "permission-denied",
            "This account has no saved user_roles access record."
        );
    }

    const role = roleSnapshot.data().role;

    if (typeof role !== "string" || !role) {
        throw new functions.https.HttpsError(
            "failed-precondition",
            "This account's saved role is missing or invalid."
        );
    }

    if (role === "admin") {
        return {
            email,
            role,
            isAdmin: true,
            classes: [],
            assignmentState: "administrator"
        };
    }

    const mappingSnapshot = await db
        .collection("user_students")
        .doc(email)
        .get();

    let classes = [];
    let assignmentState = "missing-mapping";

    if (mappingSnapshot.exists) {
        const mapping = mappingSnapshot.data();

        if (mapping.role !== role) {
            assignmentState = "role-mismatch";
        } else if (!Array.isArray(mapping.assignedClasses)) {
            assignmentState = "invalid-mapping";
        } else {
            classes = [...new Set(
                mapping.assignedClasses.filter(value =>
                    typeof value === "string" &&
                    value.length > 0
                )
            )];

            if (
                mapping.classAccessMode === "ownClass" &&
                classes.length !== 1
            ) {
                classes = [];
                assignmentState = "invalid-own-class-mapping";
            } else {
                assignmentState = classes.length
                    ? "ready"
                    : "no-classes";
            }
        }
    }

    // Missing classes do not remove ordinary tier access.
    // They do prevent recognition of class-assigned documents.
    // Never infer additional classes from student profiles.
    return {
        email,
        role,
        isAdmin: false,
        classes,
        assignmentState
    };
}

async function resolveAccount(data, context) {
    const actualEmail = cleanEmail(context.auth?.token?.email);

    if (
        !context.auth ||
        !actualEmail ||
        context.auth.token.email_verified !== true
    ) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "Sign in with your verified Google account."
        );
    }

    const actualAccount = await readAccount(actualEmail);
    const requestedEmail = cleanEmail(data?.effectiveEmail);

    if (!requestedEmail || requestedEmail === actualEmail) {
        return actualAccount;
    }

    if (actualEmail !== OWNER_EMAIL) {
        throw new functions.https.HttpsError(
            "permission-denied",
            "Only the superadmin may inspect another account's archive view."
        );
    }

    return readAccount(requestedEmail);
}

async function readAssignedLinks(account) {
    if (account.isAdmin || account.classes.length === 0) {
        return new Set();
    }

    const assessments = new Map();

    for (const className of account.classes) {
        const snapshots = await Promise.all([
            db.collection("assessments")
                .where("classes", "array-contains", className)
                .get(),
            db.collection("assessments")
                .where("className", "==", className)
                .get()
        ]);

        snapshots.forEach(snapshot => {
            snapshot.docs.forEach(document => {
                assessments.set(document.id, document.data());
            });
        });
    }

    const links = new Set();

    const add = value => {
        if (typeof value === "string" && value.length > 0) {
            links.add(value);
        }
    };

    assessments.forEach(assessment => {
        add(assessment.linkedDocId);

        if (Array.isArray(assessment.sectionsConfig)) {
            assessment.sectionsConfig.forEach(section => {
                add(section?.linkedDocId);
            });
        }
    });

    // Preserve existing archive assignment semantics:
    // a saved class link grants document access independently
    // of the dashboard's mark-disclosure display.
    return links;
}

function ruleUnlocked(rawRule, now) {
    const rule = typeof rawRule === "string"
        ? { date: rawRule, immediate: false }
        : rawRule;

    if (!rule || typeof rule !== "object") return false;
    if (rule.immediate === true) return true;

    return (
        typeof rule.date === "string" &&
        /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(rule.date) &&
        rule.date <= now
    );
}

function tierPermission(archive, state) {
    if (state.account.role === "dse_only") {
        return archive.origin === "DSE Pastpaper"
            ? "full"
            : "";
    }

    const tier = Number(archive.tier || "10");

    if (
        Number.isInteger(tier) &&
        tier >= 1 &&
        tier <= state.maxUnlockedTier
    ) {
        return "full";
    }

    if (
        archive.origin === "DSE Pastpaper" &&
        state.dseViewUnlocked
    ) {
        return "shadow";
    }

    return "";
}

// Build one policy snapshot for this request.
// Read all siblings even when the caller requests only one old ID:
// requesting a specific ID must not bypass newest-version selection.
async function loadPolicy(account) {
    const [archiveSnapshot, links, configSnapshot] = await Promise.all([
        db.collection("archives").get(),
        readAssignedLinks(account),
        db.collection("system_settings").doc("config").get()
    ]);

    const records = archiveSnapshot.docs.map(snapshot => ({
        data: {
            ...snapshot.data(),
            id: snapshot.id
        },
        createdAt: snapshot.createTime?.toMillis() || 0
    }));

    const now = hongKongNow();
    const roleRules =
        configSnapshot.data()?.tierAccess?.[account.role] || {};

    let maxUnlockedTier = 0;

    for (let tier = 1; tier <= 10; tier++) {
        if (ruleUnlocked(roleRules[String(tier)], now)) {
            maxUnlockedTier = tier;
        }
    }

    const newest = new Map();
    const assignedGroups = new Map();

    const newerThan = (candidate, previous) => {
        const candidateYear = Number(candidate.data.year) || 0;
        const previousYear = Number(previous.data.year) || 0;

        if (candidateYear !== previousYear) {
            return candidateYear > previousYear;
        }

        if (candidate.createdAt !== previous.createdAt) {
            return candidate.createdAt > previous.createdAt;
        }

        return candidate.data.id.localeCompare(previous.data.id) > 0;
    };

    records.forEach(record => {
        const archive = record.data;
        if (!validVersion(archive)) return;

        const key = documentGroupKey(archive);
        const previous = newest.get(key);

        if (!previous || newerThan(record, previous)) {
            newest.set(key, record);
        }

        const hasAssignment = links.has(archive.id) ||
            childrenOf(archive).some(child =>
                links.has(`${archive.id}_${child.id}`)
            );

        if (hasAssignment) {
            if (!assignedGroups.has(key)) {
                assignedGroups.set(key, new Set());
            }

            assignedGroups.get(key).add(archive.id);
        }
    });

    return {
        account,
        records,
        links,
        newest,
        assignedGroups,
        now,
        maxUnlockedTier,
        dseViewUnlocked: ruleUnlocked(roleRules.dse_view, now)
    };
}

function permissionFor(archive, state) {
    const allChildIds = childrenOf(archive).map(child => String(child.id));

    const result = (full, childIds, via, shadow = false, tierUnlocked = false) => ({
        policyVersion: ACCESS_POLICY_VERSION,
        full,
        childIds,
        via,
        isDseViewOnly: shadow,
        tierUnlocked
    });

    if (state.account.isAdmin) {
        return result(true, allChildIds, "admin", false, true);
    }

    if (!validVersion(archive)) return null;

    const key = documentGroupKey(archive);
    const assigned = state.assignedGroups.get(key);
    const parentAssigned = state.links.has(archive.id);

    const assignedChildIds = childrenOf(archive)
        .filter(child =>
            state.links.has(`${archive.id}_${child.id}`)
        )
        .map(child => String(child.id));

    const tier = tierPermission(archive, state);

    if (isVersionManaged(archive) && assigned?.size) {
        // An explicit version assignment overrides the default newest
        // version for THIS corresponding document only.
        if (!assigned.has(archive.id)) return null;

        if (parentAssigned) {
            return result(
                true, allChildIds, "assignment", false, tier === "full"
            );
        }

        return assignedChildIds.length
            ? result(false, assignedChildIds, "assignment")
            : null;
    }

    if (
        isVersionManaged(archive) &&
        state.newest.get(key)?.data.id !== archive.id
    ) {
        return null;
    }

    if (parentAssigned) {
        return result(
            true, allChildIds, "assignment", false, tier === "full"
        );
    }

    if (tier === "full") {
        return result(true, allChildIds, "tier", false, true);
    }

    // An explicit part assignment grants its normal part access,
    // not the answers/samples of other parts.
    if (assignedChildIds.length) {
        return result(false, assignedChildIds, "assignment");
    }

    if (tier === "shadow") {
        return result(true, allChildIds, "tier", true, false);
    }

    return null;
}

function projectArchive(archive, access) {
    const permittedChildren = childrenOf(archive).filter(child =>
        access.childIds.includes(String(child.id))
    );

    let output;

    if (access.full) {
        output = {
            ...archive,
            subQuestions: permittedChildren,
            hasFile: Boolean(archive.fileUrl || archive.fileUrlChi),
            hasAnswer: Boolean(
                archive.answerFileUrl || archive.answerFileUrlChi
            )
        };
    } else {
        // Whitelist part-only output.
        // Do not return whole-record question/answer PDFs or samples.
        output = {
            id: archive.id,
            title: archive.title || "",
            batchTitle: archive.batchTitle || "",
            questionNumber: archive.questionNumber || "",
            origin: archive.origin || "",
            year: archive.year ?? "",
            paperType: archive.paperType || "",
            tier: archive.tier || "10",
            rating: archive.rating ?? 0,
            topic: archive.topic || [],
            subQuestions: permittedChildren,
            fileUrl: "",
            fileUrlChi: "",
            answerFileUrl: "",
            answerFileUrlChi: "",
            hasFile: false,
            hasAnswer: false,
            designatedSample: {
                en: { text: "", fileUrl: "" },
                zh: { text: "", fileUrl: "" }
            }
        };

        if (isVersionManaged(archive)) {
            output.versionFamilyId = archive.versionFamilyId;
            output.versionId = archive.versionId;
            output.versionLabel = archive.versionLabel || "";
            output.versionIsOriginal =
                archive.versionIsOriginal === true;
        }
    }

    if (access.isDseViewOnly) {
        output.answerFileUrl = "";
        output.answerFileUrlChi = "";
        output.hasAnswer = false;
        output.candidatePerformance = "";
        output.candidatePerformanceChi = "";
        output.designatedSample = {
            en: { text: "", fileUrl: "" },
            zh: { text: "", fileUrl: "" }
        };

        output.subQuestions = permittedChildren.map(child => ({
            ...child,
            answerFileUrl: "",
            answerFileUrlChi: "",
            candidatePerformance: "",
            candidatePerformanceChi: "",
            designatedSample: {
                en: { text: "", fileUrl: "" },
                zh: { text: "", fileUrl: "" }
            }
        }));
    }

    // Always overwrite any old saved archiveAccess field.
    output.archiveAccess = access;

    return output;
}

function validateRequestedList(value, field, maxLength) {
    if (value === undefined || value === null) return null;

    if (
        !Array.isArray(value) ||
        value.length > 500 ||
        value.some(id =>
            typeof id !== "string" ||
            !id ||
            id.length > maxLength ||
            id.includes("/")
        )
    ) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            `Supply at most 500 valid ${field}.`
        );
    }

    return new Set(value);
}

exports.archiveCatalogue = functions
    .region("us-central1")
    .runWith({ timeoutSeconds: 120, memory: "512MB" })
    .https.onCall(async (data, context) => {
        try {
            const account = await resolveAccount(data, context);

            const ids = validateRequestedList(data?.ids, "archive IDs", 1500);
            const linkedIds = validateRequestedList(
                data?.linkedIds,
                "linked document IDs",
                3000
            );

            if (ids !== null && linkedIds !== null) {
                throw new functions.https.HttpsError(
                    "invalid-argument",
                    "Use either ids or linkedIds, not both."
                );
            }

            const state = await loadPolicy(account);
            const archives = [];

            state.records.forEach(({ data: archive }) => {
                if (ids !== null && !ids.has(archive.id)) return;

                if (
                    linkedIds !== null &&
                    !linkedIds.has(archive.id) &&
                    !childrenOf(archive).some(child =>
                        linkedIds.has(`${archive.id}_${child.id}`)
                    )
                ) return;

                const access = permissionFor(archive, state);
                if (!access) return;

                archives.push(projectArchive(archive, access));
            });

            return {
                policyVersion: ACCESS_POLICY_VERSION,
                effectiveEmail: account.email,
                archives,
                accessContext: {
                    role: account.role,
                    classes: account.classes,
                    assignmentState: account.assignmentState,
                    linkedDocIds: [...state.links],
                    maxUnlockedTier: state.maxUnlockedTier,
                    serverDate: state.now
                }
            };
        } catch (error) {
            if (error instanceof functions.https.HttpsError) throw error;

            console.error("Archive catalogue request failed:", {
                code: error.code || "",
                message: error.message || "Unknown error"
            });

            throw new functions.https.HttpsError(
                "internal",
                "Archive catalogue failed on the server. Ask the administrator to check archiveCatalogue logs."
            );
        }
    });

exports.archiveVersionPdf = functions
    .region("us-central1")
    .runWith({ timeoutSeconds: 120, memory: "512MB" })
    .https.onRequest(async (req, res) => {
        res.set("Access-Control-Allow-Origin", "*");
        res.set("Cache-Control", "private, no-store, max-age=0");
        res.set("X-Content-Type-Options", "nosniff");

        if (req.method === "OPTIONS") {
            res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
            res.set("Access-Control-Allow-Headers", "Authorization");
            return res.status(204).send("");
        }

        if (req.method !== "GET") {
            return res.status(405).send("Method not allowed.");
        }

        try {
            const bearer = (req.get("Authorization") || "")
                .match(/^Bearer (.+)$/);

            if (!bearer) return res.status(401).send("Please sign in.");

            const token = await admin.auth().verifyIdToken(bearer[1], true);

            const account = await resolveAccount(
                { effectiveEmail: req.query.as || "" },
                { auth: { uid: token.uid, token } }
            );

            const bucket = req.query.bucket;
            const path = req.query.path;

            if (
                typeof bucket !== "string" ||
                ![
                    "nclhist.firebasestorage.app",
                    "nclhist.appspot.com"
                ].includes(bucket) ||
                typeof path !== "string"
            ) {
                return res.status(400).send("Invalid PDF request.");
            }

            const match = path.match(
                /^archive_versions\/([^/]+)\/[a-f0-9-]{36}[.]pdf$/
            );

            if (!match || !validDocumentId(match[1])) {
                return res.status(400).send("Invalid version PDF path.");
            }

            const state = await loadPolicy(account);
            const archive = state.records.find(
                record => record.data.id === match[1]
            )?.data;

            if (!archive) {
                return res.status(404).send("The archive no longer exists.");
            }

            const access = permissionFor(archive, state);

            if (!access) {
                return res.status(403).send(
                    "This document version is not available to your account."
                );
            }

            const matchesFile = value => {
                if (
                    typeof value !== "string" ||
                    !value.startsWith("/archive-pdf?")
                ) return false;

                const parameters = new URLSearchParams(
                    value.slice(value.indexOf("?") + 1)
                );

                return parameters.get("bucket") === bucket &&
                    parameters.get("path") === path;
            };

            const sampleMatches = sample =>
                ["en", "zh"].some(language =>
                    matchesFile(sample?.[language]?.fileUrl)
                );

            let permitted = false;

            if (access.full) {
                permitted = [
                    archive.fileUrl,
                    archive.fileUrlChi
                ].some(matchesFile);

                if (!access.isDseViewOnly) {
                    permitted = permitted ||
                        [
                            archive.answerFileUrl,
                            archive.answerFileUrlChi
                        ].some(matchesFile) ||
                        sampleMatches(archive.designatedSample);
                }
            }

            if (!permitted && !access.isDseViewOnly) {
                permitted = childrenOf(archive).some(child =>
                    access.childIds.includes(String(child.id)) &&
                    sampleMatches(child.designatedSample)
                );
            }

            if (!permitted) {
                return res.status(403).send(
                    "This attachment is not available within your document access."
                );
            }

            const file = admin.storage().bucket(bucket).file(path);
            const [metadata] = await file.getMetadata();

            if (
                metadata.contentType !== "application/pdf" ||
                Number(metadata.size) > 8 * 1024 * 1024
            ) {
                return res.status(413).send("Unsupported PDF size or type.");
            }

            const [bytes] = await file.download();

            res.set("Content-Type", "application/pdf");
            res.set(
                "Content-Disposition",
                'inline; filename="archive-version.pdf"'
            );

            return res.status(200).send(bytes);
        } catch (error) {
            const code = String(error.code || "");

            if (
                code.startsWith("auth/") ||
                code === "unauthenticated" ||
                code === "permission-denied" ||
                code === "failed-precondition"
            ) {
                return res.status(403).send(
                    "Access denied. Check your sign-in and saved account permissions."
                );
            }

            console.error("Protected version PDF failed:", {
                code,
                message: error.message || "Unknown error"
            });

            return res.status(500).send("The PDF could not be loaded.");
        }
    });
// Read one explicitly permitted class for StudentDashboard.
// Reuses the same verified account resolution as archiveCatalogue.
exports.archiveClassAssessments = functions
    .region("us-central1")
    .runWith({
        timeoutSeconds: 120,
        memory: "512MB"
    })
    .https.onCall(async (data, context) => {
        try {
            const account = await resolveAccount(data, context);
            const className = data?.className;

            if (
                typeof className !== "string" ||
                className.length === 0 ||
                className.length > 500
            ) {
                throw new functions.https.HttpsError(
                    "invalid-argument",
                    "Select a valid class."
                );
            }

            // Preserve the exact saved teaching-group identifier.
            // Never derive additional access from student profiles.
            if (
                !account.isAdmin &&
                !account.classes.includes(className)
            ) {
                throw new functions.https.HttpsError(
                    "permission-denied",
                    "This class is not in your current saved class assignment. Ask the superadmin to check your role and user_students mapping."
                );
            }

            const snapshots = await Promise.all([
                db.collection("assessments")
                    .where("classes", "array-contains", className)
                    .get(),

                db.collection("assessments")
                    .where("className", "==", className)
                    .get()
            ]);

            const assessments = new Map();

            snapshots.forEach(snapshot => {
                snapshot.docs.forEach(document => {
                    const assessment = document.data();

                    const matchesClass =
                        (
                            Array.isArray(assessment.classes) &&
                            assessment.classes.includes(className)
                        ) ||
                        assessment.className === className;

                    if (matchesClass) {
                        assessments.set(document.id, {
                            ...assessment,
                            id: document.id
                        });
                    }
                });
            });

            return {
                effectiveEmail: account.email,
                className,
                assessments: [...assessments.values()]
            };
        } catch (error) {
            if (error instanceof functions.https.HttpsError) {
                throw error;
            }

            console.error("Class assessment request failed:", {
                code: error.code || "",
                message: error.message || "Unknown error"
            });

            throw new functions.https.HttpsError(
                "internal",
                "The selected class could not be loaded. Ask the administrator to check archiveClassAssessments logs."
            );
        }
    });