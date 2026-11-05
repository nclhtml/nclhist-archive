"use strict";

const { createHash } = require("node:crypto");

module.exports = function makeBankTools({
    db,
    root,
    requireValue,
    requireAdmin,
    idOf,
    text,
    integer,
    foundation
}) {
    const questions = root.collection("questions");
    const catalogRef = root.collection("state").doc("catalog");
    const holdRef = root.collection("state").doc("bankHolds");
    const reports = root.collection("questionReports");
    const reportOwners = root.collection("questionReportOwners");
    const editRequests = root.collection("bankEditRequests");

    const bankAudit = require("./bank-audit.cjs")({
        db,
        requireValue
    });

    const REASONS = new Set([
        "wrong-question",
        "wrong-answer",
        "english-wording",
        "chinese-translation",
        "wrong-explanation",
        "other"
    ]);

    function hash(value) {
        return createHash("sha256").update(value).digest("hex");
    }

    function version(snapshot) {
        const time = snapshot.updateTime;
        return `${time.seconds}:${time.nanoseconds}`;
    }

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[character]));
    }

    function requireSuperadmin(actor) {
        requireValue(
            actor.superadmin && !actor.impersonating,
            "Only the superadmin can manage question reports.",
            "permission-denied"
        );
    }

    function requireActualAccount(actor) {
        requireValue(
            !actor.impersonating,
            "This action is unavailable during read-only inspection.",
            "permission-denied"
        );
    }

    function notices(actor) {
        return reportOwners.doc(actor.uid).collection("notifications");
    }

    function holdCounts(snapshot) {
        return { ...(snapshot.data()?.counts || {}) };
    }

    function searchable(record) {
        return [
            record.id,
            record.topic,
            record.type,
            record.subtopic,
            record.prompt,
            record.explanation,
            record.year,
            ...(record.choices || []),
            ...(record.left || []),
            ...(record.right || []),
            ...(record.items || []),
            ...(Array.isArray(record.answer) ? record.answer : []),
            record.zh?.subtopic,
            record.zh?.prompt,
            record.zh?.explanation,
            ...(record.zh?.choices || []),
            ...(record.zh?.left || []),
            ...(record.zh?.right || []),
            ...(record.zh?.items || []),
            ...(record.zh?.answer || [])
        ].join(" ").normalize("NFKC").toLowerCase();
    }

    async function search(actor, data) {
        requireAdmin(actor);

        const offset = integer(data.offset ?? 0, 0, 2500, "Offset");
        const size = integer(data.size ?? 20, 1, 50, "Page size");

        const snapshot = await questions.limit(2501).get();

        requireValue(
            snapshot.size <= 2500,
            "The bank exceeds the supported 2,500-record limit.",
            "failed-precondition"
        );

        const records = snapshot.docs.map(document => ({
            ...document.data(),
            id: document.id
        })).sort((a, b) => a.id.localeCompare(b.id));

        const categories = [...new Set(
            records
                .filter(record => !data.topic || record.topic === data.topic)
                .map(record => record.subtopic)
                .filter(Boolean)
        )].sort((a, b) => a.localeCompare(b));

        const terms = String(data.search || "")
            .normalize("NFKC")
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .filter(Boolean);

        const filtered = records.filter(record => {
            if (data.topic && record.topic !== data.topic) return false;
            if (data.type && record.type !== data.type) return false;
            if (data.category && record.subtopic !== data.category) return false;

            if (
                data.status === "held" &&
                record.reportHold !== true
            ) return false;

            if (
                data.status === "active" &&
                (!record.active || record.reportHold)
            ) return false;

            if (
                data.status === "inactive" &&
                record.active
            ) return false;

            const content = searchable(record);
            return terms.every(term => content.includes(term));
        });

        return {
            total: filtered.length,
            categories,
            rows: filtered.slice(offset, offset + size)
        };
    }

    async function read(actor, data) {
        requireAdmin(actor);

        const snapshot = await questions.doc(idOf(data.id)).get();

        requireValue(
            snapshot.exists,
            "This bank record no longer exists.",
            "not-found"
        );

        return {
            record: { ...snapshot.data(), id: snapshot.id },
            version: version(snapshot)
        };
    }

    async function save(actor, data) {
        requireAdmin(actor);
        requireActualAccount(actor);

        const id = idOf(data.id);
        const requestId = idOf(data.requestId);

        requireValue(
            typeof data.expectedVersion === "string",
            "Reopen the question before saving."
        );

        const cleaned = foundation.cleanRecord({
            ...data.record,
            id
        });

        const fingerprint = hash(JSON.stringify({
            id,
            expectedVersion: data.expectedVersion,
            record: cleaned
        }));

        const receiptRef = editRequests.doc(
            hash(`${actor.uid}:${requestId}`)
        );
        const reference = questions.doc(id);

        await db.runTransaction(async tx => {
            const [receipt, snapshot, catalogSnapshot, holdSnapshot] =
                await Promise.all([
                    tx.get(receiptRef),
                    tx.get(reference),
                    tx.get(catalogRef),
                    tx.get(holdRef)
                ]);

            // Safely recognize retries after an uncertain response.
            if (receipt.exists) {
                requireValue(
                    receipt.data().fingerprint === fingerprint,
                    "This save request was already used for different changes.",
                    "failed-precondition"
                );
                return;
            }

            requireValue(
                snapshot.exists,
                "This bank record no longer exists.",
                "not-found"
            );

            requireValue(
                version(snapshot) === data.expectedVersion,
                "This record changed after you opened it. Your edit was not saved. Close and reopen the editor to load the latest version.",
                "failed-precondition"
            );

            const old = snapshot.data();

            requireValue(
                old.topic === cleaned.topic &&
                old.type === cleaned.type,
                "Keep the topic and record type unchanged when editing an existing ID."
            );

            const counts = holdCounts(holdSnapshot);

            const next = {
                ...old,
                ...cleaned,
                reportHold: Number(counts[id] || 0) > 0,
                updatedAt: Date.now(),
                updatedBy: actor.email
            };

            if (!cleaned.zh) delete next.zh;

            const map = new Map(
                (catalogSnapshot.data()?.items || [])
                    .map(item => [item.id, item])
            );

            map.set(id, foundation.catalogItem(next));

            const catalog = foundation.catalogData([...map.values()]);

            const audit = await bankAudit.prepare(tx, actor, {
                operationId: requestId,
                kind: "direct-edit",
                ids: [id]
            });

            // All reads are complete.
            tx.set(reference, next);
            tx.set(catalogRef, catalog);

            tx.create(receiptRef, {
                fingerprint,
                id,
                ownerUid: actor.uid,
                createdAt: Date.now()
            });

            bankAudit.apply(tx, audit);
        });

        return { ok: true, id };
    }

    async function submitReport(actor, data) {
        requireActualAccount(actor);

        requireValue(
            !actor.admin,
            "Student issue reports must be submitted from a student account.",
            "permission-denied"
        );

        const requestId = idOf(data.requestId);
        const attemptId = idOf(data.attemptId);
        const questionId = idOf(data.questionId);

        requireValue(
            REASONS.has(data.reason),
            "Select a valid report type."
        );

        const details = text(data.details, "Details", 2000, true);

        const reportId = hash(`${actor.uid}:${requestId}`);
        const reportRef = reports.doc(reportId);
        const logRef = db.collection("admin_logs").doc(`kt_${reportId}`);
        const ownerRef = reportOwners.doc(actor.uid);

        const attemptRef = root.collection("users")
            .doc(actor.email)
            .collection("attempts")
            .doc(attemptId);

        const fingerprint = hash(JSON.stringify({
            attemptId,
            questionId,
            eventId: data.eventId || "",
            reason: data.reason,
            details
        }));

        await db.runTransaction(async tx => {
            const [
                previous,
                attemptSnapshot,
                ownerSnapshot,
                holdSnapshot,
                catalogSnapshot
            ] = await Promise.all([
                tx.get(reportRef),
                tx.get(attemptRef),
                tx.get(ownerRef),
                tx.get(holdRef),
                tx.get(catalogRef)
            ]);

            if (previous.exists) {
                requireValue(
                    previous.data().reporterUid === actor.uid &&
                    previous.data().fingerprint === fingerprint,
                    "This report request was already used for different details.",
                    "failed-precondition"
                );
                return;
            }

            const attempt = attemptSnapshot.data();

            requireValue(
                attemptSnapshot.exists &&
                attempt.status === "submitted" &&
                attempt.email === actor.email &&
                (!attempt.uid || attempt.uid === actor.uid),
                "You can report only questions in your own submitted exercises.",
                "permission-denied"
            );

            const question = attempt.questions.find(
                item => item.id === questionId
            );

            requireValue(
                question,
                "This question is not in the submitted exercise.",
                "permission-denied"
            );

            let bankIds;

            if (question.generatedKind) {
                const eventIds = [...new Set(
                    (question.eventRecords || [])
                        .map(event => event.id)
                )];

                requireValue(
                    eventIds.length > 0 && eventIds.length <= 8,
                    "This older chronology question has no usable event links.",
                    "failed-precondition"
                );

                if (data.eventId) {
                    const selectedEvent = idOf(data.eventId);

                    requireValue(
                        eventIds.includes(selectedEvent),
                        "This event is not part of the reported question.",
                        "permission-denied"
                    );

                    bankIds = [selectedEvent];
                } else {
                    bankIds = eventIds;
                }
            } else {
                requireValue(
                    !data.eventId,
                    "An event selection is valid only for chronology questions."
                );
                bankIds = [question.id];
            }

            bankIds.forEach(idOf);

            const bankSnapshots = await tx.getAll(
                ...bankIds.map(id => questions.doc(id))
            );

            const now = Date.now();

            requireValue(
                now - Number(ownerSnapshot.data()?.lastReportAt || 0) >= 5000,
                "Please wait a few seconds before submitting another report.",
                "resource-exhausted"
            );

            const counts = holdCounts(holdSnapshot);

            bankIds.forEach(id => {
                counts[id] = Number(counts[id] || 0) + 1;
            });

            const catalog = catalogSnapshot.data() || {};
            const items = (catalog.items || []).map(item =>
                bankIds.includes(item.id)
                    ? { ...item, reportHold: true }
                    : item
            );

            const title = String(question.prompt || "").slice(0, 200);

            const report = {
                id: reportId,
                reporterUid: actor.uid,
                reporterEmail: actor.email,
                attemptId,
                questionId,
                bankIds,
                reason: data.reason,
                details,
                questionSnapshot: question,
                title,
                fingerprint,
                status: "open",
                createdAt: now
            };

            // All reads are complete.
            tx.create(reportRef, report);

            tx.set(holdRef, { counts, updatedAt: now });

            tx.set(catalogRef, {
                ...catalog,
                items,
                updatedAt: now
            });

            bankSnapshots.forEach(snapshot => {
                if (snapshot.exists) {
                    tx.update(snapshot.ref, { reportHold: true });
                }
            });

            tx.set(ownerRef, {
                email: actor.email,
                lastReportAt: now
            }, { merge: true });

            tx.create(logRef, {
                type: "KNOWLEDGE_REPORT",
                knowledgeReportId: reportId,
                timestamp: new Date(now).toISOString(),
                viewed: false,
                message:
                    `<b>Knowledge Test question report</b>` +
                    `<br/><b>Student:</b> ${escapeHtml(actor.email)}` +
                    `<br/><b>Type:</b> ${escapeHtml(data.reason)}` +
                    `<br/><b>Records held:</b> ${escapeHtml(bankIds.join(", "))}` +
                    `<br/><b>Question:</b> ${escapeHtml(title)}` +
                    `<br/><b>Details:</b> ${escapeHtml(details || "None supplied")}`
            });
        });

        return { ok: true, reportId };
    }

    async function readAudit(actor, data) {
        requireSuperadmin(actor);

        const snapshot = await db.collection("admin_logs")
            .doc(idOf(data.id))
            .get();

        requireValue(
            snapshot.exists &&
            snapshot.data().type === "KNOWLEDGE_BANK_EDIT",
            "This bank-edit log is unavailable.",
            "not-found"
        );

        const saved = snapshot.data();

        return {
            audit: {
                id: snapshot.id,
                editorEmail: saved.editorEmail,
                changeKind: saved.changeKind,
                bankIds: saved.bankIds || [],
                recordCount: saved.recordCount || 0,
                timestamp: saved.timestamp
            }
        };
    }

    async function readReport(actor, data) {
        requireSuperadmin(actor);

        const snapshot = await reports.doc(idOf(data.id)).get();

        requireValue(
            snapshot.exists,
            "This question report no longer exists.",
            "not-found"
        );

        return {
            report: {
                ...snapshot.data(),
                id: snapshot.id
            }
        };
    }

    async function listReports(actor, data) {
        requireSuperadmin(actor);

        let query = reports
            .where("status", "==", "open")
            .orderBy("__name__")
            .limit(21);

        if (data.cursor) {
            const cursor = await reports.doc(idOf(data.cursor)).get();
            requireValue(cursor.exists, "Report cursor no longer exists.");
            query = query.startAfter(cursor);
        }

        const snapshot = await query.get();
        const documents = snapshot.docs.slice(0, 20);

        return {
            records: documents.map(document => ({
                ...document.data(),
                id: document.id
            })),
            next: snapshot.size > 20
                ? documents[documents.length - 1].id
                : null
        };
    }

    async function resolveReport(actor, data) {
        requireSuperadmin(actor);

        const id = idOf(data.id);
        const reference = reports.doc(id);
        const note = text(data.note, "Resolution note", 2000, true);

        await db.runTransaction(async tx => {
            const [snapshot, holdSnapshot, catalogSnapshot] =
                await Promise.all([
                    tx.get(reference),
                    tx.get(holdRef),
                    tx.get(catalogRef)
                ]);

            requireValue(
                snapshot.exists,
                "Report not found.",
                "not-found"
            );

            const report = snapshot.data();

            if (report.status === "resolved") return;

            const bankSnapshots = await tx.getAll(
                ...report.bankIds.map(bankId => questions.doc(bankId))
            );

            const counts = holdCounts(holdSnapshot);

            report.bankIds.forEach(bankId => {
                const remaining = Math.max(
                    0,
                    Number(counts[bankId] || 0) - 1
                );

                if (remaining) counts[bankId] = remaining;
                else delete counts[bankId];
            });

            const catalog = catalogSnapshot.data() || {};
            const now = Date.now();

            // All reads are complete.
            tx.update(reference, {
                status: "resolved",
                resolvedAt: now,
                resolvedBy: actor.email,
                resolutionNote: note
            });

            tx.set(holdRef, { counts, updatedAt: now });

            tx.set(catalogRef, {
                ...catalog,
                items: (catalog.items || []).map(item =>
                    report.bankIds.includes(item.id)
                        ? {
                            ...item,
                            reportHold: Number(counts[item.id] || 0) > 0
                        }
                        : item
                ),
                updatedAt: now
            });

            bankSnapshots.forEach(bankSnapshot => {
                if (bankSnapshot.exists) {
                    tx.update(bankSnapshot.ref, {
                        reportHold:
                            Number(counts[bankSnapshot.id] || 0) > 0
                    });
                }
            });

            tx.set(
                reportOwners.doc(report.reporterUid)
                    .collection("notifications")
                    .doc(id),
                {
                    reportId: id,
                    reporterEmail: report.reporterEmail,
                    title: report.title,
                    note,
                    resolvedAt: now,
                    acknowledged: false
                }
            );

            tx.delete(db.collection("admin_logs").doc(`kt_${id}`));
        });

        return { ok: true };
    }

    async function notificationList(actor) {
        requireActualAccount(actor);

        const snapshot = await notices(actor)
            .where("acknowledged", "==", false)
            .limit(1)
            .get();

        const document = snapshot.docs[0];

        if (
            !document ||
            document.data().reporterEmail !== actor.email
        ) {
            return { notification: null };
        }

        return {
            notification: {
                ...document.data(),
                id: document.id
            }
        };
    }

    async function notificationAck(actor, data) {
        requireActualAccount(actor);

        const reference = notices(actor).doc(idOf(data.id));

        await db.runTransaction(async tx => {
            const snapshot = await tx.get(reference);

            requireValue(
                snapshot.exists &&
                snapshot.data().reporterEmail === actor.email,
                "Notification unavailable.",
                "permission-denied"
            );

            tx.update(reference, { acknowledged: true });
        });

        return { ok: true };
    }

    async function resolvedQuestion(actor, data) {
        const snapshot = await reports.doc(idOf(data.id)).get();
        const report = snapshot.data();

        requireValue(
            snapshot.exists &&
            report.status === "resolved" &&
            report.reporterUid === actor.uid &&
            report.reporterEmail === actor.email,
            "This resolved report does not belong to your account.",
            "permission-denied"
        );

        const snapshots = await db.getAll(
            ...report.bankIds.map(id => questions.doc(id))
        );

        // Only the verified reporter can use this student-facing action.
        // Return content fields, not administrator maintenance metadata.
        const records = snapshots
            .filter(document => document.exists)
            .map(document => {
                const saved = document.data();
                const result = {};

                for (const key of [
                    "id", "topic", "type", "subtopic", "prompt",
                    "explanation", "choices", "answer", "left", "right",
                    "items", "year", "zh", "reportHold"
                ]) {
                    if (saved[key] !== undefined) result[key] = saved[key];
                }

                result.id = document.id;
                return result;
            });

        return {
            title: report.title,
            note: report.resolutionNote || "",
            records
        };
    }

    return {
        search,
        read,
        save,
        submitReport,
        readAudit,
        readReport,
        listReports,
        resolveReport,
        notificationList,
        notificationAck,
        resolvedQuestion
    };
};