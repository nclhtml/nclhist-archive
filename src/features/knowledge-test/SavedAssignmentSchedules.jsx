import React, { useState } from "react";

import {
    knowledgeApi,
    hkTime,
    assignmentStatus,
    assignmentClosed
} from "./api.js";

import AssignmentProgress from "./AssignmentProgress.jsx";

function scheduleStatus(schedule) {
    if (schedule.cancelled) return "Cancelled";
    if (schedule.closeReason === "all-completed") {
        return "Automatically closed — all students completed";
    }
    if (schedule.ended) return "Ended by teacher";
    if (schedule.closed) return "Closed";

    return "Open";
}

export default function SavedAssignmentSchedules({
    schedules,
    assignments,
    busy,
    run,
    refresh,
    onProfile
}) {
    const [openId, setOpenId] = useState("");
    const [search, setSearch] = useState("");

    const studentRows = rows => {
        const text = search.trim().toLowerCase();

        const visible = rows.filter(assignment =>
            !text ||
            [
                assignment.studentName,
                assignment.email,
                assignment.studentClass
            ].join(" ").toLowerCase().includes(text)
        );

        return (
            <>
                <label className="kt-field">
                    Search this assignment's students
                    <input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Name, email or class"
                    />
                </label>

                <div className="kt-table-wrap kt-recipient-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>Student</th>
                                <th>Class</th>
                                <th>Completion</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>

                        <tbody>
                            {visible.map(assignment => (
                                <tr key={assignment.id}>
                                    <td>
                                        <button
                                            type="button"
                                            className="kt-link"
                                            onClick={() => onProfile?.(assignment.email)}
                                        >
                                            {assignment.studentName || assignment.email}
                                        </button>

                                        <small>{assignment.email}</small>
                                        <small>{assignment.title}</small>
                                    </td>

                                    <td>
                                        {assignment.studentClass || "—"}
                                    </td>

                                    <td>
                                        <AssignmentProgress assignment={assignment} />

                                        <small>
                                            {Number(assignment.completed || 0)} on time
                                            {" · "}
                                            {Number(assignment.late || 0)} late
                                        </small>
                                    </td>

                                    <td>
                                        {assignmentStatus(assignment)}
                                        <small>
                                            {assignment.compulsory
                                                ? "Compulsory"
                                                : "Optional"}
                                        </small>
                                    </td>

                                    <td>
                                        <div className="kt-row">
                                            {!assignmentClosed(assignment) && (
                                                <button
                                                    type="button"
                                                    className="kt-danger"
                                                    disabled={busy}
                                                    onClick={() => {
                                                        if (!window.confirm(
                                                            `End this assignment for ${
                                                                assignment.studentName ||
                                                                assignment.email
                                                            }?\n\n` +
                                                            "Existing results will remain. " +
                                                            "No further answering or submission " +
                                                            "will be accepted."
                                                        )) return;

                                                        run(async () => {
                                                            await knowledgeApi(
                                                                "endAssignment",
                                                                { id: assignment.id }
                                                            );

                                                            await refresh();
                                                        });
                                                    }}
                                                >
                                                    End assignment
                                                </button>
                                            )}

                                            {!assignment.cancelled && (
                                                <button
                                                    type="button"
                                                    className="kt-secondary"
                                                    disabled={busy}
                                                    onClick={() => {
                                                        if (!window.confirm(
                                                            "Cancel this student's assignment? " +
                                                            "Existing results will remain."
                                                        )) return;

                                                        run(async () => {
                                                            await knowledgeApi(
                                                                "cancelAssignment",
                                                                { id: assignment.id }
                                                            );

                                                            await refresh();
                                                        });
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {!visible.length && (
                    <p className="kt-muted">
                        No currently permitted students match this selection.
                    </p>
                )}
            </>
        );
    };

    const legacy = assignments.filter(assignment =>
        !assignment.scheduleId
    );

    return (
        <section className="kt-card">
            <div className="kt-row kt-between">
                <h2>Saved email schedules and assignments</h2>

                <button
                    type="button"
                    className="kt-secondary"
                    disabled={busy}
                    onClick={() => run(refresh)}
                >
                    Refresh schedules and progress
                </button>
            </div>

            <p className="kt-muted">
                Open a schedule to view its students and submission counts.
                Only students in your currently permitted roster are listed.
                Red completion numbers are late submissions and count towards
                the required total.
            </p>

            <p className="kt-muted">
                “Queued” means handed to the email extension, not confirmed
                inbox delivery. Ending or cancelling cannot recall an email
                already queued.
            </p>

            {!schedules.length && (
                <p className="kt-muted">No saved schedules yet.</p>
            )}

            {schedules.map(schedule => {
                const recipients = assignments.filter(assignment =>
                    assignment.scheduleId === schedule.id
                );

                const finished = recipients.filter(assignment =>
                    !assignment.cancelled &&
                    Number(assignment.completed || 0) +
                        Number(assignment.late || 0) >= assignment.target
                ).length;

                return (
                    <details
                        key={schedule.id}
                        className="kt-saved-schedule"
                        open={openId === schedule.id}
                    >
                        <summary
                            onClick={event => {
                                event.preventDefault();
                                setSearch("");

                                setOpenId(previous =>
                                    previous === schedule.id ? "" : schedule.id
                                );
                            }}
                        >
                            <strong>{schedule.title}</strong>
                            {" — "}
                            {hkTime(schedule.startsAt)}
                            {" → "}
                            {hkTime(schedule.dueAt)}

                            <span className="kt-tag">
                                {scheduleStatus(schedule)}
                            </span>

                            <small>
                                {schedule.recipientCount} originally assigned
                                {" · "}
                                {recipients.length} currently permitted
                                {" · "}
                                {finished} completed
                                {" · "}
                                {schedule.target} exercises each
                            </small>
                        </summary>

                        <div className="kt-spaced">
                            <p className="kt-muted">
                                Assigned by: {schedule.creator}
                            </p>

                            <p className="kt-muted">
                                Reminder: {hkTime(schedule.reminderAt)} HKT
                            </p>

                            <div className="kt-row">
                                {["start", "reminder", "report"].map(stage => {
                                    const status = schedule.notifications?.[stage];

                                    return (
                                        <span className="kt-tag" key={stage}>
                                            {stage}: {status
                                                ? `${status.status}; ${status.queued} queued`
                                                : schedule.cancelled ||
                                                  schedule.closed ||
                                                  schedule.ended
                                                    ? "Stopped"
                                                    : "Pending"}
                                        </span>
                                    );
                                })}
                            </div>

                            <div className="kt-row kt-spaced">
                                {!schedule.cancelled &&
                                    !schedule.ended &&
                                    !schedule.closed && (
                                        <button
                                            type="button"
                                            className="kt-danger"
                                            disabled={busy}
                                            onClick={() => {
                                                if (!window.confirm(
                                                    "End this schedule for all its remaining students?\n\n" +
                                                    "Existing results will remain. " +
                                                    "Further answering and future email jobs will stop."
                                                )) return;

                                                run(async () => {
                                                    await knowledgeApi(
                                                        "endSchedule",
                                                        { id: schedule.id }
                                                    );

                                                    await refresh();
                                                });
                                            }}
                                        >
                                            End assignment for remaining students
                                        </button>
                                    )}

                                {!schedule.cancelled && (
                                    <button
                                        type="button"
                                        className="kt-secondary"
                                        disabled={busy}
                                        onClick={() => {
                                            if (!window.confirm(
                                                "Cancel this schedule and its student assignments?"
                                            )) return;

                                            run(async () => {
                                                await knowledgeApi(
                                                    "cancelSchedule",
                                                    { id: schedule.id }
                                                );

                                                await refresh();
                                            });
                                        }}
                                    >
                                        Cancel schedule
                                    </button>
                                )}
                            </div>

                            {studentRows(recipients)}
                        </div>
                    </details>
                );
            })}

            {!!legacy.length && (
                <details className="kt-saved-schedule">
                    <summary>
                        Older assignments without email schedules
                        {" "}
                        ({legacy.length})
                    </summary>

                    {studentRows(legacy)}
                </details>
            )}
        </section>
    );
}