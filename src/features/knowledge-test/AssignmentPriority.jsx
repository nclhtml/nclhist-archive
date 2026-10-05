import React, { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../LanguageContext.jsx";
import {
    knowledgeApi,
    hkTime,
    assignmentStatus,
    assignmentDone,
    assignmentClosed
} from "./api.js";

import { localizedTopic } from "./quizLanguage.js";
import AssignmentProgress from "./AssignmentProgress.jsx";

function doneCount(assignment) {
    return assignmentDone(assignment);
}

export default function AssignmentPriority({
    home,
    busy,
    run,
    start,
    refresh
}) {
    const { language } = useLanguage();
    const tr = (en, zh) => language === "zh" ? zh : en;

    const dialogRef = useRef(null);
    const [now, setNow] = useState(Date.now());
    const [dismissedKey, setDismissedKey] = useState("");

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30000);
        return () => window.clearInterval(timer);
    }, []);

    const assignments = [...(home.assignments || [])];

    const unfinished = assignment =>
        !assignmentClosed(assignment);

    const availableCompulsory = assignments
        .filter(assignment =>
            assignment.compulsory &&
            unfinished(assignment) &&
            assignment.startsAt <= now
        )
        .sort((a, b) => a.dueAt - b.dueAt);

    const pendingIds = new Set(
        availableCompulsory.map(assignment => assignment.id)
    );

    assignments.sort((a, b) =>
        Number(pendingIds.has(b.id)) - Number(pendingIds.has(a.id)) ||
        Number(unfinished(b)) - Number(unfinished(a)) ||
        a.dueAt - b.dueAt
    );

    const popupKey = availableCompulsory
        .map(assignment => assignment.id)
        .sort()
        .join("|");

    const showPopup = Boolean(popupKey) && dismissedKey !== popupKey;

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;

        if (showPopup && !dialog.open) {
            dialog.showModal();
        } else if (!showPopup && dialog.open) {
            dialog.close();
        }
    }, [showPopup]);

    const dismiss = () => {
        setDismissedKey(popupKey);
        dialogRef.current?.close();
    };

    const launch = assignment => {
        // Close first so any API error is visible on the main page.
        dismiss();

        run(async () => {
            const result = await knowledgeApi("start", {
                assignmentId: assignment.id
            });

            start(result);
        });
    };

    const assignmentCard = (assignment, compact = false) => {
        const remaining = Math.max(
            0,
            assignment.target - doneCount(assignment)
        );

        const canStart =
            unfinished(assignment) &&
            assignment.startsAt <= now;

        return (
            <article
                className="kt-assignment"
                key={assignment.id}
            >
                <div className="kt-assignment-copy">
                    <div className="kt-row">
                        <h3>{assignment.title}</h3>

                        {assignment.compulsory && (
                            <span className="kt-tag">
                                {tr("Compulsory", "指定功課")}
                            </span>
                        )}
                    </div>

                    <p>
                        {assignment.topics.map(topic =>
                            localizedTopic(topic, language)
                        ).join(" • ")}
                    </p>

                    <p>
                        {tr("Completed", "已完成")}
                        {" "}
                        <AssignmentProgress assignment={assignment} />
                        {" · "}
                        {tr(
                            `${remaining} remaining`,
                            `尚欠 ${remaining} 次`
                        )}
                    </p>

                    {Number(assignment.late || 0) > 0 && (
                        <p className="kt-muted">
                            {tr(
                                "The red number is late work. It counts towards completion.",
                                "紅色數字表示遲交次數，亦會計入完成功課的總次數。"
                            )}
                        </p>
                    )}

                    <p className="kt-muted">
                        {tr("Deadline", "截止時間")}: {hkTime(assignment.dueAt, language)} HKT
                    </p>

                    {unfinished(assignment) &&
                        now > assignment.dueAt &&
                        remaining > 0 && (
                            <p className="kt-muted">
                                {tr(
                                    "The deadline has passed. New submissions count towards completion and are labelled late.",
                                    "截止時間已過，新提交的練習仍會計入完成次數，並標示為遲交。"
                                )}
                            </p>
                        )}

                    {!compact && (
                        <>
                            <p className="kt-muted">
                                {assignmentStatus(assignment, language)}
                                {" · "}
                                {Number(assignment.completed || 0)}
                                {" "}
                                {tr("on time", "準時")}
                                {" · "}
                                {Number(assignment.late || 0)}
                                {" "}
                                {tr("late", "遲交")}
                            </p>

                            <p className="kt-muted">
                                {tr("Available from", "開始時間")}:{" "}
                                {hkTime(assignment.startsAt, language)} HKT
                            </p>

                            <p className="kt-muted">
                                {tr("Assigned by", "指派老師")}: {assignment.creator}
                            </p>
                        </>
                    )}
                </div>

                <div className="kt-assignment-actions">
                    {unfinished(assignment) && (
                        <button
                            type="button"
                            disabled={busy || !canStart}
                            onClick={() => launch(assignment)}
                        >
                            {!canStart
                                ? tr("Not started yet", "尚未開始")
                                : tr(
                                    "Enter this assigned practice",
                                    "直接進入這份指定練習"
                                )}
                        </button>
                    )}

                    {!compact &&
                        assignment.testOnly &&
                        !assignment.cancelled && (
                            <button
                                type="button"
                                className="kt-secondary"
                                disabled={busy}
                                onClick={() => {
                                    if (!window.confirm(tr(
                                        "Cancel this test assignment? Existing test reports will be retained.",
                                        "取消這份測試功課？現有測試報告將會保留。"
                                    ))) return;

                                    run(async () => {
                                        await knowledgeApi("cancelAssignment", {
                                            id: assignment.id
                                        });

                                        await refresh();
                                    });
                                }}
                            >
                                {tr("Cancel test assignment", "取消測試功課")}
                            </button>
                        )}
                </div>
            </article>
        );
    };

    return (
        <>
            <section className="kt-card kt-assignment-priority">
                <div className="kt-row kt-between">
                    <div>
                        <p className="kt-eyebrow">
                            {tr("Assigned work comes first", "請先完成指定功課")}
                        </p>
                        <h2>{tr("My assignments", "我的功課")}</h2>
                    </div>

                    {!!availableCompulsory.length && (
                        <button
                            type="button"
                            className="kt-secondary"
                            disabled={busy}
                            onClick={() => setDismissedKey("")}
                        >
                            {tr("Show compulsory-work reminder", "顯示指定功課提示")}
                        </button>
                    )}
                </div>

                {!!availableCompulsory.length && (
                    <p className="kt-notice">
                        {tr(
                            "You have unfinished compulsory work. Enter it using its assignment button below. Topic practice and mixed self-practice do not count towards these assignments.",
                            "你有尚未完成的指定功課。請使用下方相應功課的按鈕進入。自行選擇的課題練習或混合練習不會計入這些功課。"
                        )}
                    </p>
                )}

                {!assignments.length && (
                    <p className="kt-muted">
                        {tr("No assignments yet.", "暫時沒有功課。")}
                    </p>
                )}

                {assignments.map(assignment =>
                    assignmentCard(assignment)
                )}
            </section>

            <dialog
                ref={dialogRef}
                className="kt-assignment-dialog"
                aria-labelledby="kt-compulsory-heading"
                aria-describedby="kt-compulsory-description"
                onCancel={event => {
                    event.preventDefault();
                    dismiss();
                }}
            >
                <div className="kt-row kt-between">
                    <h2 id="kt-compulsory-heading">
                        {tr("Please enter your assigned practice", "請進入指定練習")}
                    </h2>

                    <button
                        type="button"
                        className="kt-secondary"
                        onClick={dismiss}
                    >
                        {tr("Close", "關閉")}
                    </button>
                </div>

                <p id="kt-compulsory-description" className="kt-notice">
                    {tr(
                        "Please use a button in this window to enter your compulsory assigned practice directly. Starting ordinary topic practice will NOT count towards the assigned work. You may close this reminder; the assignments will remain at the top of the page.",
                        "請按此視窗內的按鈕，直接進入指定功課。一般課題練習不會計入指定功課。你可以關閉此提示；指定功課仍會顯示在頁面最上方。"
                    )}
                </p>

                {home.summary.activeAttemptId && (
                    <p className="kt-muted">
                        {tr(
                            "You have an unfinished exercise. If it belongs to another practice, close this window and use Resume or Abandon before entering the assigned practice.",
                            "你有尚未完成的練習。如它屬於其他練習，請先關閉此視窗，繼續完成或放棄該練習，再進入指定功課。"
                        )}
                    </p>
                )}

                {availableCompulsory.map(assignment =>
                    assignmentCard(assignment, true)
                )}

                <button
                    type="button"
                    className="kt-secondary"
                    onClick={dismiss}
                >
                    {tr("Close and view other practices", "關閉並查看其他練習")}
                </button>
            </dialog>
        </>
    );
}