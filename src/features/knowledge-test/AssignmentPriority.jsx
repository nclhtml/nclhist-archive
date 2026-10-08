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

    const assignments = (home.assignments || [])
        .filter(assignment => !assignment.cancelled);

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
        // Close first so errors and confirmations are not hidden
        // behind the compulsory-work reminder.
        dismiss();

        run(async () => {
            try {
                const result = await knowledgeApi("start", {
                    assignmentId: assignment.id
                });

                start(result);
                return;
            } catch (problem) {
                const isDifferentUnfinishedExercise =
                    String(problem.code || "").endsWith(
                        "failed-precondition"
                    ) &&
                    String(problem.message || "").includes(
                        "You already have an unfinished exercise belonging to a different practice or assignment."
                    );

                if (!isDifferentUnfinishedExercise) {
                    // Refresh stale cards, for example when a teacher
                    // cancelled or ended the assignment after loading.
                    await refresh().catch(() => { });
                    throw problem;
                }

                // Obtain the current ID rather than trusting an old
                // home-page snapshot.
                const latestHome = await knowledgeApi("home");
                const activeId =
                    latestHome.summary?.activeAttemptId;

                if (!activeId) {
                    // The previous exercise may have been completed
                    // or abandoned in another tab.
                    const result = await knowledgeApi("start", {
                        assignmentId: assignment.id
                    });

                    start(result);
                    return;
                }

                const confirmed = window.confirm(tr(
                    "You have another unfinished exercise.\n\n" +
                    "Abandon it and enter this assigned practice?\n\n" +
                    "The unfinished exercise will not count towards progress. " +
                    "Submitted reports will not be deleted. " +
                    "If the new practice cannot start, your unfinished exercise will be kept.",
                    "你有另一份尚未完成的練習。\n\n" +
                    "是否放棄它，並進入這份指定練習？\n\n" +
                    "未完成的練習不會計入進度，已提交的報告不會被刪除。" +
                    "如新練習未能開始，原有的未完成練習將會保留。"
                ));

                if (!confirmed) {
                    await refresh();
                    return;
                }

                try {
                    const result = await knowledgeApi("start", {
                        assignmentId: assignment.id,
                        replaceActiveAttemptId: activeId
                    });

                    start(result);
                } catch (switchProblem) {
                    await refresh().catch(() => { });
                    throw switchProblem;
                }
            }
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
                            "You have an unfinished exercise. Use its assignment button to resume it. If you choose a different assignment, you will be asked whether to abandon the unfinished exercise and switch.",
                            "你有尚未完成的練習。按相應功課的按鈕可繼續練習；如選擇另一份功課，系統會詢問你是否放棄原有練習並切換。"
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