"use strict";

const { createHash } = require("node:crypto");

module.exports = function makeBankAudit({ db, requireValue }) {
    function escapeHtml(value) {
        return String(value || "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[character]));
    }

    // Call BEFORE any transaction writes.
    //
    // Reusing one operationId aggregates all batches belonging to
    // the same Excel import into ONE shared superadmin log entry.
    async function prepare(tx, actor, {
        operationId,
        kind,
        ids
    }) {
        if (!ids.length) return null;

        requireValue(
            typeof operationId === "string" &&
            operationId.length > 0 &&
            operationId.length <= 120,
            "Invalid bank audit operation ID."
        );

        const documentId = "kt_edit_" + createHash("sha256")
            .update(`${actor.uid}:${kind}:${operationId}`)
            .digest("hex");

        const reference = db.collection("admin_logs").doc(documentId);
        const previous = await tx.get(reference);

        const old = previous.data() || {};

        const bankIds = [...new Set([
            ...(Array.isArray(old.bankIds) ? old.bankIds : []),
            ...ids
        ])];

        requireValue(
            bankIds.length <= 2500,
            "This bank operation exceeds the supported record limit."
        );

        const now = new Date().toISOString();

        const label = {
            "direct-edit": "Direct question-bank edit",
            "excel-import": "Excel question-bank import",
            "essay-install": "Essay recognition installation"
        }[kind] || "Question-bank change";

        const data = {
            type: "KNOWLEDGE_BANK_EDIT",
            operationId,
            changeKind: kind,
            editorEmail: actor.email,
            editorUid: actor.uid,
            bankIds,
            recordCount: bankIds.length,
            firstTimestamp: old.firstTimestamp || now,
            timestamp: now,
            viewed: false,
            proofreading: true,
            message:
                `<b>${escapeHtml(label)}</b>` +
                `<br/><b>Changed by:</b> ${escapeHtml(actor.email)}` +
                `<br/><b>Records in this operation:</b> ${bankIds.length}` +
                `<br/><b>IDs:</b> ${escapeHtml(
                    bankIds.slice(0, 12).join(", ")
                )}` +
                (
                    bankIds.length > 12
                        ? `<br/>…and ${bankIds.length - 12} more.`
                        : ""
                ) +
                `<br/>Click to inspect the saved question-bank changes.`
        };

        return { reference, data };
    }

    // Call only AFTER all transaction reads have finished.
    function apply(tx, prepared) {
        if (prepared) {
            tx.set(prepared.reference, prepared.data);
        }
    }

    return { prepare, apply };
};