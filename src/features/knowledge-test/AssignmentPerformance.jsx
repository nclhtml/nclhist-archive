import React, { useState } from "react";

import {
    knowledgeApi,
    accuracy,
    hkTime
} from "./api.js";

import AssignmentProgress from "./AssignmentProgress.jsx";

import {
    StudentReport
} from "./KnowledgeStudentViews.jsx";

export default function AssignmentPerformance({
    assignmentId,
    busy,
    run
}) {
    const [performance, setPerformance] = useState(null);
    const [records, setRecords] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);

    const load = async (append = false) => {
        setLoading(true);

        try {
            const result = await knowledgeApi(
                "assignmentPerformance",
                {
                    id: assignmentId,
                    ...(append && cursor ? { cursor } : {})
                }
            );

            setPerformance(result);
            setRecords(previous =>
                append
                    ? [...previous, ...result.records]
                    : result.records
            );
            setCursor(result.next);
            setReport(null);
        } finally {
            setLoading(false);
        }
    };

    const submitted = records.filter(attempt =>
        attempt.status === "submitted"
    );

    const answered = submitted.reduce(
        (sum, attempt) => sum + Number(attempt.total || 0),
        0
    );

    const correct = submitted.reduce(
        (sum, attempt) => sum + Number(attempt.correct || 0),
        0
    );

    const disabled = busy || loading;

    if (report) {
        return (
            <StudentReport
                key={report.id}
                attempt={report}
                onBack={() => setReport(null)}
            />
        );
    }

    return (
        <div className="kt-spaced">
            <div className="kt-row">
                <button
                    type="button"
                    className="kt-secondary"
                    disabled={disabled}
                    onClick={() => run(() => load(false))}
                >
                    {loading
                        ? "Loading assignment performance…"
                        : performance
                            ? "Refresh assignment performance"
                            : "Load assignment performance"}
                </button>
            </div>

            {performance && (
                <>
                    <p className="kt-spaced">
                        <strong>{performance.assignment.title}</strong>
                        <br />
                        {performance.email}
                    </p>

                    <p>
                        Assignment completion:{" "}
                        <AssignmentProgress
                            assignment={performance.assignment}
                        />
                    </p>

                    <p>
                        Accuracy across loaded submitted exercises:{" "}
                        <strong>{accuracy(correct, answered)}</strong>
                        {" "}
                        ({correct}/{answered} questions)
                    </p>

                    <p className="kt-muted">
                        This list includes only exercises linked to this
                        assignment, not unrelated self-practice.
                        Records are paged in a stable record-ID order,
                        not date order.
                        {cursor && (
                            <>
                                {" "}
                                More records are available. Load all pages
                                before treating the accuracy above as the
                                whole assignment's accuracy.
                            </>
                        )}
                    </p>

                    <div className="kt-table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Submitted / started</th>
                                    <th>Status</th>
                                    <th>Score</th>
                                    <th>Assignment credit</th>
                                    <th>Report</th>
                                </tr>
                            </thead>

                            <tbody>
                                {records.map(attempt => (
                                    <tr key={attempt.id}>
                                        <td>
                                            {hkTime(
                                                attempt.submittedAt ||
                                                attempt.createdAt
                                            )}
                                        </td>

                                        <td>
                                            {attempt.status === "submitted"
                                                ? "Submitted"
                                                : attempt.status === "active"
                                                    ? "Unfinished"
                                                    : attempt.status === "abandoned"
                                                        ? "Abandoned"
                                                        : attempt.status}
                                        </td>

                                        <td>
                                            {attempt.status === "submitted"
                                                ? `${attempt.correct}/${attempt.total}`
                                                : "—"}
                                        </td>

                                        <td>
                                            {attempt.assignmentCredit === "on-time"
                                                ? "On time"
                                                : attempt.assignmentCredit === "late"
                                                    ? "Late"
                                                    : attempt.assignmentCredit === "cancelled"
                                                        ? "Cancelled"
                                                        : "Not credited"}
                                        </td>

                                        <td>
                                            {attempt.status === "submitted" && (
                                                <button
                                                    type="button"
                                                    className="kt-secondary"
                                                    disabled={disabled}
                                                    onClick={() => run(async () => {
                                                        const result =
                                                            await knowledgeApi(
                                                                "attempt",
                                                                {
                                                                    email: performance.email,
                                                                    id: attempt.id
                                                                }
                                                            );

                                                        setReport(result);
                                                    })}
                                                >
                                                    Open report
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {!records.length && (
                        <p className="kt-muted">
                            This student has not started an exercise
                            linked to this assignment yet.
                        </p>
                    )}

                    {cursor && (
                        <button
                            type="button"
                            className="kt-secondary"
                            disabled={disabled}
                            onClick={() => run(() => load(true))}
                        >
                            Load more assignment exercises
                        </button>
                    )}
                </>
            )}
        </div>
    );
}