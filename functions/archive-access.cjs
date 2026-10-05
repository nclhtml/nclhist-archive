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
    const [
        archiveSnapshot,
        links,
        configSnapshot,
        versionSettingsSnapshot
    ] = await Promise.all([
        db.collection("archives").get(),
        readAssignedLinks(account),
        db.collection("system_settings").doc("config").get(),
        db.collection("archive_version_settings").get()
    ]);

    const records = archiveSnapshot.docs.map(snapshot => ({
        data: {
            ...snapshot.data(),
            id: snapshot.id
        },
        createdAt: snapshot.createTime?.toMillis() || 0
    }));

    const searchSettings = new Map(
        versionSettingsSnapshot.docs.map(snapshot => [
            snapshot.id,
            snapshot.data()
        ])
    );

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
        const setting = archive.versionFamilyId
            ? searchSettings.get(archive.versionFamilyId)
            : null;

        // A pinned version replaces automatic newest-year selection.
        //
        // Fail closed if a pinned version no longer exists:
        // do not silently make a different version searchable.
        const eligibleForDefaultSearch =
            !setting ||
            setting.mode !== "only" ||
            archive.versionId === setting.versionId;

        if (eligibleForDefaultSearch) {
            const previous = newest.get(key);

            if (!previous || newerThan(record, previous)) {
                newest.set(key, record);
            }
        }

        // Existing explicit assessment assignments remain independent.
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
        searchSettings,
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

                archives.push({
                    ...projectArchive(archive, access),

                    // Administrators can search every version.
                    // Students can still open an explicitly assigned old
                    // version, but it does not become a normal search result.
                    archiveSearchable:
                        account.isAdmin ||
                        !isVersionManaged(archive) ||
                        state.newest.get(documentGroupKey(archive))
                            ?.data.id === archive.id
                });
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
// ------------------------------------------------------------
// Archive maintenance, reports and version-search configuration
// ------------------------------------------------------------

const { randomUUID: archiveToolUUID } = require("node:crypto");

const REPORT_REASONS = new Set([
    "Wrong deployment of files",
    "Missing/wrong pages",
    "Difficult to view",
    "Spelling mistakes of questions",
    "No answer attached",
    "Wrong tags",
    "Others (Please specify)"
]);

function toolError(code, message) {
    throw new functions.https.HttpsError(code, message);
}

function escapeReportHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/\r?\n/g, "<br/>");
}

function canHaveArchiveVersions(archive) {
    const origin = String(archive?.origin || "")
        .normalize("NFKC")
        .trim()
        .toLowerCase();

    return Boolean(origin) && !(
        origin.includes("dse") ||
        origin.includes("mock") ||
        origin.includes("internal assessment") ||
        origin.includes("internal school exam")
    );
}

function reportAccountRef(uid) {
    return db.collection("report_private").doc(uid);
}

function resolutionRef(reportId) {
    return db.collection("report_private")
        .doc("_resolutions")
        .collection("items")
        .doc(reportId);
}

async function actualToolAccount(context) {
    // No effectiveEmail / impersonation parameter is accepted here.
    // Reports and notifications always belong to the actual login.
    return resolveAccount({}, context);
}

function requireToolAdmin(account) {
    if (!account.isAdmin) {
        toolError("permission-denied", "Administrator access is required.");
    }
}

async function submitArchiveReport(data, context, account) {
    const requestId = data.requestId;
    const archiveId = data.archiveId;
    const childId = String(data.childId ?? "");
    const sampleId = String(data.sampleId || "");
    const sampleTag = String(data.sampleTag || "");

    if (
        typeof requestId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(requestId) ||
        !validDocumentId(archiveId) ||
        childId.length > 1500 ||
        childId.includes("/") ||
        (sampleId && !validDocumentId(sampleId)) ||
        sampleTag.length > 500
    ) {
        toolError("invalid-argument", "Invalid report target.");
    }

    const reason = String(data.reason || "").trim();
    const details = String(data.details || "").trim();

    if (
        !REPORT_REASONS.has(reason) ||
        !details ||
        details.length > 8000
    ) {
        toolError(
            "invalid-argument",
            "Select a report reason and enter details of at most 8,000 characters."
        );
    }

    const uid = context.auth.uid;
    const accountRef = reportAccountRef(uid);
    const submissionRef = accountRef
        .collection("submissions")
        .doc(requestId);

    // Recognize a successful retry before rechecking a potentially
    // changed document. The receipt belongs only to this actual UID.
    const previousSubmission = await submissionRef.get();

    if (previousSubmission.exists) {
        return {
            ok: true,
            reportId: previousSubmission.data().reportId
        };
    }

    const state = await loadPolicy(account);
    const archive = state.records.find(
        record => record.data.id === archiveId
    )?.data;

    if (!archive) {
        toolError("not-found", "The reported archive no longer exists.");
    }

    const access = permissionFor(archive, state);

    if (!access) {
        toolError("permission-denied", "This document is unavailable.");
    }

    const child = childId
        ? childrenOf(archive).find(
            item => String(item.id) === childId
        )
        : null;

    if (
        childId &&
        (!child || !access.childIds.includes(childId))
    ) {
        toolError("permission-denied", "This question is unavailable.");
    }

    if (data.answer === true && (
        !access.full ||
        access.isDseViewOnly
    )) {
        toolError("permission-denied", "The answer is unavailable.");
    }

    if (sampleId) {
        if (access.isDseViewOnly || (
            isVersionManaged(archive) &&
            archive.versionIsOriginal !== true
        ) || (
                isVersionManaged(archive) &&
                !account.isAdmin &&
                !access.full
            )) {
            toolError(
                "permission-denied",
                "This legacy student sample is unavailable."
            );
        }

        const sampleSnapshot = await db
            .collection("student_samples")
            .doc(sampleId)
            .get();

        const sample = sampleSnapshot.data();

        if (!sample || !sampleTag || !sample.scoresData?.[sampleTag]) {
            toolError("not-found", "The reported sample is unavailable.");
        }

        // Check the same archive/title association used by the
        // application's legacy sample reader.
        const possibleTags = new Set([archive.title]);

        if (archive.paperType === "Paper 1 (DBQ)") {
            possibleTags.add(`${archive.title} Q1`);
        }

        const targetChildren = child
            ? [child]
            : childrenOf(archive).filter(item =>
                access.childIds.includes(String(item.id))
            );

        for (const item of targetChildren) {
            const label = String(item.label || "");

            if (archive.paperType === "Paper 2 (Essay)") {
                possibleTags.add(`${archive.title} Q${label}`);
                possibleTags.add(
                    `${archive.title} Q${label.replace(/[a-z]/gi, "")}`
                );
                possibleTags.add(`${archive.title}${label}`);
            } else {
                possibleTags.add(`${archive.title} Q1${label}`);
                possibleTags.add(`${archive.title}${label}`);
            }
        }

        const permittedTag = possibleTags.has(sampleTag) || (
            access.full &&
            sampleTag.startsWith(archive.title)
        );

        if (!permittedTag) {
            toolError(
                "permission-denied",
                "This sample is not associated with the reported document."
            );
        }
    }

    const targetViewId = child
        ? `${archive.id}_${child.id}`
        : archive.id;

    const documentName = sampleId
        ? `Student Sample — ${sampleTag}`
        : `${data.answer === true ? "Answer Key: " : ""}` +
        archive.title +
        (child ? ` Q${child.label}` : "");

    // Retain the existing administrator sample-management link.
    const adminViewId = sampleId
        ? `sample_${sampleId}`
        : targetViewId;

    const logRef = db.collection("admin_logs").doc(requestId);
    const now = Date.now();
    const timestamp = new Date(now).toISOString();

    await db.runTransaction(async transaction => {
        const [receiptSnapshot, rateSnapshot, logSnapshot] =
            await Promise.all([
                transaction.get(submissionRef),
                transaction.get(accountRef),
                transaction.get(logRef)
            ]);

        if (receiptSnapshot.exists) return;

        if (logSnapshot.exists) {
            toolError(
                "already-exists",
                "The report request ID is already in use."
            );
        }

        const lastSubmittedAt =
            Number(rateSnapshot.data()?.lastSubmittedAt) || 0;

        if (now - lastSubmittedAt < 5000) {
            toolError(
                "resource-exhausted",
                "Please wait a few seconds before submitting another report."
            );
        }

        transaction.set(logRef, {
            type: "USER_REPORT",
            reportSchemaVersion: 2,
            reporterUid: uid,
            reporterEmail: account.email,
            documentName,
            reason,
            details,
            archiveId,
            childId,
            sampleId,
            sampleTag,
            answer: data.answer === true && !sampleId,
            targetViewId,
            viewId: adminViewId,
            timestamp,
            viewed: false,
            message:
                `<b>Report from ${escapeReportHtml(account.email)}</b>` +
                `<br/><b>Document:</b> ${escapeReportHtml(documentName)}` +
                `<br/><b>Reason:</b> ${escapeReportHtml(reason)}` +
                `<br/><b>Details:</b> ${escapeReportHtml(details)}`
        });

        transaction.set(submissionRef, {
            reportId: logRef.id,
            createdAt: timestamp
        });

        transaction.set(accountRef, {
            lastSubmittedAt: now
        }, { merge: true });
    });

    return { ok: true, reportId: logRef.id };
}

async function resolveArchiveReport(data, account) {
    requireToolAdmin(account);

    const reportId = data.reportId;

    if (!validDocumentId(reportId)) {
        toolError("invalid-argument", "Invalid report ID.");
    }

    const logRef = db.collection("admin_logs").doc(reportId);
    const receiptRef = resolutionRef(reportId);
    const resolvedAt = new Date().toISOString();

    return db.runTransaction(async transaction => {
        const [logSnapshot, receiptSnapshot] = await Promise.all([
            transaction.get(logRef),
            transaction.get(receiptRef)
        ]);

        if (receiptSnapshot.exists) {
            return {
                ok: true,
                legacy: receiptSnapshot.data().legacy === true
            };
        }

        if (!logSnapshot.exists) {
            toolError("not-found", "This report was already removed.");
        }

        const report = logSnapshot.data();

        if (report.type !== "USER_REPORT") {
            toolError("invalid-argument", "This entry is not a user report.");
        }

        const verifiedReporter =
            report.reportSchemaVersion === 2 &&
            typeof report.reporterUid === "string" &&
            report.reporterUid.length > 0 &&
            !report.reporterUid.includes("/") &&
            typeof report.reporterEmail === "string";

        transaction.set(receiptRef, {
            reportId,
            legacy: !verifiedReporter,
            resolvedAt,
            resolvedBy: account.email,
            report
        });

        if (verifiedReporter) {
            const notificationRef = reportAccountRef(report.reporterUid)
                .collection("notifications")
                .doc(reportId);

            // A deterministic ID prevents duplicate resolution notices.
            transaction.set(notificationRef, {
                reportId,
                reporterEmail: report.reporterEmail,
                documentName: report.documentName || "Reported document",
                archiveId: report.archiveId,
                targetViewId: report.targetViewId,
                sampleId: report.sampleId || "",
                sampleTag: report.sampleTag || "",
                answer: report.answer === true,
                resolvedAt,
                claimedAt: null
            });
        }

        // Removal and notification creation happen in one transaction.
        transaction.delete(logRef);

        return { ok: true, legacy: !verifiedReporter };
    });
}

async function claimReportNotification(context, account) {
    const uid = context.auth.uid;
    const notifications = reportAccountRef(uid)
        .collection("notifications");

    return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(
            notifications
                .where("claimedAt", "==", null)
                .limit(1)
        );

        if (snapshot.empty) return { notification: null };

        const document = snapshot.docs[0];
        const notification = document.data();

        // Do not disclose a notification if the login email changed.
        if (cleanEmail(notification.reporterEmail) !== account.email) {
            transaction.update(document.ref, {
                claimedAt: new Date().toISOString(),
                unavailable: true
            });

            return { notification: null };
        }

        transaction.update(document.ref, {
            claimedAt: new Date().toISOString()
        });

        return {
            notification: {
                id: document.id,
                documentName: notification.documentName,
                archiveId: notification.archiveId,
                targetViewId: notification.targetViewId,
                sampleId: notification.sampleId || "",
                sampleTag: notification.sampleTag || "",
                answer: notification.answer === true,
                resolvedAt: notification.resolvedAt
            }
        };
    });
}

async function readVersionSearchSetting(data, account) {
    requireToolAdmin(account);

    const familyId = data.familyId;

    if (!validDocumentId(familyId)) {
        toolError("invalid-argument", "Invalid version family.");
    }

    const snapshot = await db
        .collection("archive_version_settings")
        .doc(familyId)
        .get();

    return {
        setting: snapshot.exists
            ? snapshot.data()
            : { mode: "auto", versionId: "" }
    };
}

async function saveVersionSearchSetting(data, account) {
    requireToolAdmin(account);

    const familyId = data.familyId;
    const mode = data.mode;
    const versionId = String(data.versionId || "");

    if (
        !validDocumentId(familyId) ||
        !["auto", "only"].includes(mode) ||
        (mode === "only" && !validDocumentId(versionId))
    ) {
        toolError("invalid-argument", "Invalid search-version setting.");
    }

    const settingRef = db
        .collection("archive_version_settings")
        .doc(familyId);

    const guardRef = db
        .collection("system_settings")
        .doc("archive_write_guard");

    const revision = archiveToolUUID();
    const now = new Date().toISOString();

    return db.runTransaction(async transaction => {
        const [familySnapshot] = await Promise.all([
            transaction.get(
                db.collection("archives")
                    .where("versionFamilyId", "==", familyId)
            ),
            transaction.get(guardRef),
            transaction.get(settingRef)
        ]);

        const records = familySnapshot.docs.map(snapshot => ({
            ...snapshot.data(),
            id: snapshot.id
        }));

        if (!records.length || !records.every(canHaveArchiveVersions)) {
            toolError(
                "failed-precondition",
                "This document family is not eligible for versions."
            );
        }

        if (
            mode === "only" &&
            !records.some(record => record.versionId === versionId)
        ) {
            toolError(
                "failed-precondition",
                "The selected version no longer exists in this family."
            );
        }

        const setting = {
            mode,
            versionId: mode === "only" ? versionId : "",
            updatedAt: now,
            updatedBy: account.email
        };

        transaction.set(settingRef, setting);

        // Participate in the existing archive-write concurrency guard.
        transaction.set(guardRef, {
            version: revision,
            updatedAt: now,
            updatedBy: account.email
        });

        return { ok: true, setting };
    });
}

exports.archiveTools = functions
    .region("us-central1")
    .runWith({
        timeoutSeconds: 120,
        memory: "512MB"
    })
    .https.onCall(async (data, context) => {
        try {
            if (!data || typeof data !== "object" || Array.isArray(data)) {
                toolError("invalid-argument", "Invalid archive tools request.");
            }

            const account = await actualToolAccount(context);

            switch (data.action) {
                case "submitReport":
                    return await submitArchiveReport(data, context, account);

                case "resolveReport":
                    return await resolveArchiveReport(data, account);

                case "claimNotification":
                    return await claimReportNotification(context, account);

                case "readVersionSearch":
                    return await readVersionSearchSetting(data, account);

                case "saveVersionSearch":
                    return await saveVersionSearchSetting(data, account);

                default:
                    toolError("invalid-argument", "Unknown archive tools action.");
            }
        } catch (error) {
            if (error instanceof functions.https.HttpsError) throw error;

            console.error("Archive tools failed:", error);

            throw new functions.https.HttpsError(
                "internal",
                "The archive operation failed. Please retry or check archiveTools logs."
            );
        }
    });

// Used by Skill Recall. Reading an archive with the Admin SDK must
// not bypass the user's saved archive/version/assignment permissions.
exports.assertArchiveChildAccess = async (
    email,
    archiveId,
    childIds
) => {
    const account = await readAccount(cleanEmail(email));
    const state = await loadPolicy(account);

    const archive = state.records.find(
        record => record.data.id === archiveId
    )?.data;

    const access = archive ? permissionFor(archive, state) : null;

    if (
        !access ||
        childIds.some(id =>
            !access.childIds.includes(String(id))
        )
    ) {
        toolError(
            "permission-denied",
            "These questions are not available to your account."
        );
    }

    return true;
};