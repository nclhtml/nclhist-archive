import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../main.jsx";
import { useLanguage } from "../../LanguageContext.jsx";
import { knowledgeApi, hkTime } from "./api.js";
import BankEditorPanel, { BankRecordContent } from "./BankEditorPanel.jsx";

const REASONS = [
    ["wrong-question", "Wrong question / historical information", "題目／歷史資料錯誤"],
    ["wrong-answer", "Wrong answer", "答案錯誤"],
    ["english-wording", "English wording problem", "英文表述問題"],
    ["chinese-translation", "Chinese translation problem", "中文翻譯問題"],
    ["wrong-explanation", "Wrong explanation", "解釋錯誤"],
    ["other", "Other issue", "其他問題"]
];

export function QuestionIssueButton({ attempt, question }) {
    const { user, realUser } = useAuth();
    const { language } = useLanguage();
    const tr = (en, zh) => language === "zh" ? zh : en;

    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [details, setDetails] = useState("");
    const [eventId, setEventId] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const pending = useRef(null);
    const lock = useRef(false);

    const allowed = Boolean(
        realUser?.isAuthorized &&
        !realUser?.isAdmin &&
        !user?.isImpersonating &&
        attempt.status === "submitted" &&
        attempt.email === realUser.email
    );

    if (!allowed) return null;

    const send = async event => {
        event.preventDefault();
        if (lock.current || submitted) return;

        lock.current = true;
        setBusy(true);
        setMessage("");

        try {
            if (!pending.current) {
                pending.current = {
                    requestId: crypto.randomUUID(),
                    attemptId: attempt.id,
                    questionId: question.id,
                    eventId,
                    reason,
                    details
                };
            }

            await knowledgeApi("questionReportSubmit", pending.current);

            setSubmitted(true);
            setOpen(false);
            setMessage(tr(
                "Report received. The affected bank question/event is held for everyone’s newly generated tests until its reports are resolved. Existing exercise reports are retained.",
                "已收到報告。相關題目／事件已暫停供所有學生的新練習抽選，直至報告處理完成。現有練習報告會保留。"
            ));
        } catch (problem) {
            setMessage(problem.message || "Report failed.");
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };

    return (
        <div className="kt-spaced">
            {!submitted && (
                <button
                    type="button"
                    className="kt-danger"
                    disabled={busy}
                    onClick={() => setOpen(value => !value)}
                >
                    {tr("Report question / answer / translation", "舉報題目／答案／翻譯問題")}
                </button>
            )}

            {open && !submitted && (
                <form onSubmit={send} className="kt-review">
                    <h3>{tr("Report an issue", "報告問題")}</h3>

                    <fieldset
                        disabled={busy || Boolean(pending.current)}
                        className="kt-answer-fieldset"
                    >
                        <label className="kt-field">
                            {tr("Report type", "問題類型")}
                            <select
                                required
                                value={reason}
                                onChange={event => setReason(event.target.value)}
                            >
                                <option value="">{tr("Select a type", "選擇類型")}</option>
                                {REASONS.map(([value, en, zh]) => (
                                    <option key={value} value={value}>
                                        {tr(en, zh)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        {question.generatedKind && (
                            <label className="kt-field">
                                {tr("Affected timeline event", "涉及的歷史事件")}
                                <select
                                    value={eventId}
                                    onChange={event => setEventId(event.target.value)}
                                >
                                    <option value="">
                                        {tr(
                                            "Whole question / not sure — hold all contributing events",
                                            "整條題目／未能確定 — 暫停所有涉及事件"
                                        )}
                                    </option>
                                    {(question.eventRecords || []).map(record => (
                                        <option key={record.id} value={record.id}>
                                            {language === "zh"
                                                ? record.zh?.prompt || record.prompt
                                                : record.prompt}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}

                        <label className="kt-field">
                            {tr("Details — optional", "詳情 — 可選填")}
                            <textarea
                                className="kt-author-textarea"
                                rows={4}
                                maxLength={2000}
                                value={details}
                                onChange={event => setDetails(event.target.value)}
                            />
                        </label>
                    </fieldset>

                    <p className="kt-muted">
                        {tr(
                            "A report immediately holds the affected bank records for future tests. Please report a genuine content or translation issue, not merely an answer you got wrong.",
                            "提交後會立即暫停相關題目供新練習使用。請只報告真正的內容或翻譯問題，而不是單純因為自己答錯。"
                        )}
                    </p>

                    <button type="submit" disabled={busy || !reason}>
                        {busy
                            ? tr("Submitting…", "提交中…")
                            : pending.current
                                ? tr("Retry same report", "重試同一報告")
                                : tr("Submit report", "提交報告")}
                    </button>
                </form>
            )}

            {message && (
                <p className={submitted ? "kt-notice" : "kt-error"}>
                    {message}
                </p>
            )}
        </div>
    );
}

export function ReportedQuestionEditor({
    reportId,
    busy,
    run,
    refreshHome
}) {
    const [report, setReport] = useState(null);
    const [editId, setEditId] = useState("");
    const [note, setNote] = useState("");
    const [loadError, setLoadError] = useState("");

    const load = async () => {
        const result = await knowledgeApi("questionReportRead", {
            id: reportId
        });

        setReport(result.report);
        setEditId(previous =>
            result.report.bankIds.includes(previous)
                ? previous
                : result.report.bankIds[0] || ""
        );
    };

    useEffect(() => {
        let active = true;

        setReport(null);
        setEditId("");
        setNote("");
        setLoadError("");

        knowledgeApi("questionReportRead", { id: reportId })
            .then(result => {
                if (!active) return;

                setReport(result.report);
                setEditId(result.report.bankIds[0] || "");
            })
            .catch(problem => {
                if (active) setLoadError(problem.message);
            });

        return () => {
            active = false;
        };
    }, [reportId]);

    const resolve = async () => {
        if (!report || report.status === "resolved") return;

        if (!window.confirm(
            "Resolve this student report?\n\n" +
            "Save any question corrections in the editor FIRST.\n\n" +
            "The student will receive a resolution notification.\n" +
            "The question remains held if other unresolved reports exist.\n" +
            "An inactive question remains inactive."
        )) return;

        await knowledgeApi("questionReportResolve", {
            id: report.id,
            note
        });

        await load();
        await refreshHome();
    };

    return (
        <>
            <section className="kt-card">
                <h2>Reported question — opened from the superadmin log</h2>

                {loadError && (
                    <p className="kt-error">{loadError}</p>
                )}

                {!report && !loadError && <p>Loading report…</p>}

                {report && (
                    <>
                        <p><strong>{report.reason}</strong></p>
                        <p>{report.title}</p>

                        <p className="kt-muted">
                            Reported by: {report.reporterEmail}
                            {" · "}
                            {hkTime(report.createdAt)}
                        </p>

                        <p>
                            Details: {report.details ||
                                "No optional details supplied."}
                        </p>

                        <p className="kt-notice">
                            Edit and save the question below first.
                            Saving an edit does not automatically resolve
                            the student's report or release its hold.
                        </p>

                        {report.bankIds.length > 1 && (
                            <label className="kt-field">
                                This generated question involves several
                                timeline events. Choose the event to edit:
                                <select
                                    value={editId}
                                    onChange={event =>
                                        setEditId(event.target.value)
                                    }
                                >
                                    {report.bankIds.map(id => (
                                        <option key={id} value={id}>
                                            {id}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}

                        <details className="kt-details">
                            <summary>
                                View the original reported exercise snapshot
                            </summary>

                            <p className="kt-muted">
                                This historical snapshot may differ from
                                the current bank record.
                            </p>

                            <BankRecordContent
                                record={report.questionSnapshot}
                            />
                        </details>

                        {report.status === "resolved" ? (
                            <p className="kt-notice kt-spaced">
                                This report has been resolved.
                                The student notification was created.
                            </p>
                        ) : (
                            <>
                                <label className="kt-field">
                                    Resolution note to student — optional
                                    <textarea
                                        className="kt-author-textarea"
                                        rows={3}
                                        maxLength={2000}
                                        value={note}
                                        onChange={event =>
                                            setNote(event.target.value)
                                        }
                                    />
                                </label>

                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => run(resolve)}
                                >
                                    Resolve this report and notify student
                                </button>
                            </>
                        )}
                    </>
                )}
            </section>

            {report && editId && (
                <BankEditorPanel
                    key={`${report.id}:${editId}`}
                    initialId={editId}
                    busy={busy}
                    run={run}
                    refreshHome={refreshHome}
                />
            )}
        </>
    );
}

export function BankProofreadingEditor({
    auditId,
    busy,
    run,
    refreshHome
}) {
    const [audit, setAudit] = useState(null);
    const [editId, setEditId] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;

        setAudit(null);
        setEditId("");
        setError("");

        knowledgeApi("bankAuditRead", { id: auditId })
            .then(result => {
                if (!active) return;

                setAudit(result.audit);
                setEditId(result.audit.bankIds[0] || "");
            })
            .catch(problem => {
                if (active) setError(problem.message);
            });

        return () => {
            active = false;
        };
    }, [auditId]);

    return (
        <>
            <section className="kt-card">
                <h2>Proofread bank changes — opened from superadmin log</h2>

                {error && <p className="kt-error">{error}</p>}
                {!audit && !error && <p>Loading change log…</p>}

                {audit && (
                    <>
                        <p>
                            Changed by: <strong>{audit.editorEmail}</strong>
                        </p>

                        <p>
                            Operation: {audit.changeKind}
                            {" · "}
                            {audit.recordCount} records
                        </p>

                        <p className="kt-muted">{audit.timestamp}</p>

                        <label className="kt-field">
                            Choose a changed record to proofread
                            <select
                                value={editId}
                                onChange={event =>
                                    setEditId(event.target.value)
                                }
                            >
                                {audit.bankIds.map(id => (
                                    <option key={id} value={id}>
                                        {id}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <p className="kt-muted">
                            The editor shows the current saved content.
                            This activity entry records who changed the bank
                            and which IDs were included; it is not a frozen
                            before-and-after snapshot.
                        </p>
                    </>
                )}
            </section>

            {editId && (
                <BankEditorPanel
                    key={`${auditId}:${editId}`}
                    initialId={editId}
                    busy={busy}
                    run={run}
                    refreshHome={refreshHome}
                />
            )}
        </>
    );
}

export function ResolvedKnowledgeQuestion({ id, busy, run }) {
    const [result, setResult] = useState(null);

    useEffect(() => {
        let active = true;

        run(async () => {
            const data = await knowledgeApi("resolvedQuestion", { id });
            if (active) setResult(data);
        });

        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    return (
        <section className="kt-card">
            <h2>Resolved question report / 已處理題目報告</h2>

            {!result && <p>Loading…</p>}

            {result && (
                <>
                    <p>{result.title}</p>
                    {result.note && <p className="kt-notice">{result.note}</p>}

                    <p className="kt-muted">
                        These are the current bank records, not recalculated
                        historical exercise scores.
                    </p>

                    {result.records.map(record => (
                        <BankRecordContent key={record.id} record={record} />
                    ))}

                    {!result.records.length && (
                        <p>
                            The report was resolved, but its bank records
                            were removed. Historical reports remain stored.
                        </p>
                    )}
                </>
            )}
        </section>
    );
}

export function KnowledgeResolutionNotice({
    enabled,
    accountKey,
    language,
    onOpen
}) {
    const [notification, setNotification] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const lock = useRef(false);

    useEffect(() => {
        setNotification(null);
        setError("");
    }, [enabled, accountKey]);

    useEffect(() => {
        if (!enabled || notification) return undefined;

        let active = true;

        const poll = async () => {
            if (
                !active ||
                lock.current ||
                document.visibilityState !== "visible"
            ) return;

            lock.current = true;

            try {
                const result = await knowledgeApi("questionNotificationList");
                if (active) setNotification(result.notification);
            } catch (problem) {
                console.warn("Knowledge report notification check:", problem.message);
            } finally {
                lock.current = false;
            }
        };

        const initial = window.setTimeout(poll, 1500);
        const timer = window.setInterval(poll, 30000);
        document.addEventListener("visibilitychange", poll);

        return () => {
            active = false;
            window.clearTimeout(initial);
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", poll);
        };
    }, [enabled, accountKey, notification]);

    if (!enabled || !notification) return null;

    const finish = async open => {
        if (busy) return;

        setBusy(true);
        setError("");

        try {
            await knowledgeApi("questionNotificationAck", {
                id: notification.id
            });

            if (open) onOpen(notification.reportId);
            setNotification(null);
        } catch (problem) {
            setError(problem.message);
        } finally {
            setBusy(false);
        }
    };

    const zh = language === "zh";

    return createPortal(
        <section
            role="status"
            aria-live="polite"
            style={{
                position: "fixed",
                right: 16,
                top: 100,
                zIndex: 11000,
                width: "min(360px, calc(100vw - 32px))"
            }}
            className="rounded-xl border border-green-300 bg-white p-4 shadow-xl"
        >
            <h2 className="text-sm font-bold text-green-800">
                {zh ? "你的知識測驗報告已處理" : "Your Knowledge Test report was resolved"}
            </h2>

            <p className="mt-2 text-sm text-slate-700">
                {notification.title}
            </p>

            {notification.note && (
                <p className="mt-2 whitespace-pre-wrap text-sm">
                    {notification.note}
                </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => finish(true)}
                    className="rounded bg-green-700 px-3 py-2 text-sm text-white"
                >
                    {zh ? "查看目前題目" : "View current question"}
                </button>

                <button
                    type="button"
                    disabled={busy}
                    onClick={() => finish(false)}
                    className="rounded border px-3 py-2 text-sm"
                >
                    {zh ? "關閉" : "Dismiss"}
                </button>
            </div>

            {error && (
                <p className="mt-2 text-xs text-red-700">{error}</p>
            )}
        </section>,
        document.body
    );
}