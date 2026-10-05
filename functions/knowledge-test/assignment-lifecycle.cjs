module.exports = function makeAssignmentLifecycle({
    db,
    root,
    requireValue
}) {
    const assignments = root.collection("assignments");
    const schedules = root.collection("schedules");
    const jobs = root.collection("notificationJobs");

    function count(value) {
        const number = Number(value);

        return Number.isFinite(number) && number >= 0
            ? Math.floor(number)
            : 0;
    }

    function total(assignment) {
        return count(assignment.completed) + count(assignment.late);
    }

    function reachedTarget(assignment) {
        return total(assignment) >= Number(assignment.target || 1);
    }

    function closed(assignment) {
        return Boolean(
            assignment.cancelled ||
            assignment.ended ||
            assignment.closed ||
            reachedTarget(assignment)
        );
    }

    function project(assignment) {
        return {
            ...assignment,
            completed: count(assignment.completed),
            late: count(assignment.late),
            completedTotal: total(assignment),
            closed: closed(assignment),
            closeReason:
                assignment.closeReason ||
                (
                    reachedTarget(assignment)
                        ? "target-completed"
                        : ""
                )
        };
    }

    function assertOpen(assignment) {
        requireValue(
            assignment && !closed(assignment),
            "This assignment has ended, was cancelled, or its required exercises are already complete. Return to the assignment list. You can abandon an unfinished exercise that belongs to a closed assignment.",
            "failed-precondition"
        );
    }

    function requireOwner(actor, record) {
        requireValue(
            actor.admin &&
            (
                actor.superadmin ||
                record.creator === actor.email
            ),
            "Only the assigning administrator or superadmin can end this assignment.",
            "permission-denied"
        );
    }

    function validateId(value, description) {
        requireValue(
            typeof value === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(value),
            `Invalid ${description} ID.`
        );

        return value;
    }

    function allRecipientsFinished(records) {
        const active = records.filter(record => !record.cancelled);

        return active.length > 0 &&
            active.every(record => reachedTarget(record));
    }

    function stopJobs(tx, scheduleId) {
        for (const stage of ["start", "reminder", "report"]) {
            tx.delete(jobs.doc(`${scheduleId}_${stage}`));
        }
    }

    function closeScheduleWrites(tx, reference, scheduleId, now, reason) {
        tx.update(reference, {
            closed: true,
            closedAt: now,
            closeReason: reason
        });

        stopJobs(tx, scheduleId);
    }

    // Called inside the submission transaction BEFORE any writes.
    //
    // Returns the proposed assignment update and any matching
    // schedule closure, but does not write them yet.
    async function prepareCredit(tx, assignmentSnapshot, attempt, now) {
        if (!assignmentSnapshot?.exists) {
            return {
                credit: null,
                assignmentPatch: null,
                scheduleClosure: null
            };
        }

        const assignment = assignmentSnapshot.data();

        if (assignment.cancelled) {
            return {
                credit: "cancelled",
                assignmentPatch: null,
                scheduleClosure: null
            };
        }

        assertOpen(assignment);

        if (
            attempt.questions.length !== 20 ||
            attempt.createdAt < assignment.startsAt
        ) {
            return {
                credit: null,
                assignmentPatch: null,
                scheduleClosure: null
            };
        }

        const credit = now <= assignment.dueAt
            ? "on-time"
            : "late";

        const next = {
            ...assignment,
            completed: count(assignment.completed) +
                (credit === "on-time" ? 1 : 0),
            late: count(assignment.late) +
                (credit === "late" ? 1 : 0)
        };

        const complete = reachedTarget(next);

        const assignmentPatch = {
            completed: next.completed,
            late: next.late,
            completedTotal: total(next),
            lastSubmissionAt: now,
            ...(complete ? {
                closed: true,
                closedAt: now,
                closeReason: "target-completed"
            } : {})
        };

        let scheduleClosure = null;

        if (assignment.scheduleId) {
            const scheduleReference = schedules.doc(assignment.scheduleId);

            const [scheduleSnapshot, recipientSnapshot] = await Promise.all([
                tx.get(scheduleReference),
                tx.get(
                    assignments.where(
                        "scheduleId",
                        "==",
                        assignment.scheduleId
                    )
                )
            ]);

            const schedule = scheduleSnapshot.data();

            if (scheduleSnapshot.exists) {
                requireValue(
                    !schedule.cancelled &&
                    !schedule.ended &&
                    !schedule.closed,
                    "This assignment schedule has ended. No further assignment submissions are accepted.",
                    "failed-precondition"
                );

                const recipientRecords = recipientSnapshot.docs.map(document =>
                    document.id === assignmentSnapshot.id
                        ? {
                            ...document.data(),
                            ...assignmentPatch
                        }
                        : document.data()
                );

                if (allRecipientsFinished(recipientRecords)) {
                    scheduleClosure = {
                        reference: scheduleReference,
                        id: assignment.scheduleId,
                        now
                    };
                }
            }
        }

        return {
            credit,
            assignmentPatch,
            scheduleClosure
        };
    }

    // Called only after all submission transaction reads finish.
    function applyCredit(tx, assignmentSnapshot, prepared) {
        if (prepared.assignmentPatch) {
            tx.update(
                assignmentSnapshot.ref,
                prepared.assignmentPatch
            );
        }

        if (prepared.scheduleClosure) {
            const closure = prepared.scheduleClosure;

            closeScheduleWrites(
                tx,
                closure.reference,
                closure.id,
                closure.now,
                "all-completed"
            );
        }
    }

    async function endAssignment(actor, data) {
        const reference = assignments.doc(
            validateId(data.id, "assignment")
        );

        await db.runTransaction(async tx => {
            const snapshot = await tx.get(reference);

            requireValue(
                snapshot.exists,
                "Assignment not found.",
                "not-found"
            );

            const assignment = snapshot.data();
            requireOwner(actor, assignment);

            let scheduleSnapshot = null;
            let recipientSnapshot = null;

            if (assignment.scheduleId) {
                [scheduleSnapshot, recipientSnapshot] = await Promise.all([
                    tx.get(schedules.doc(assignment.scheduleId)),
                    tx.get(
                        assignments.where(
                            "scheduleId",
                            "==",
                            assignment.scheduleId
                        )
                    )
                ]);
            }

            // All reads are above.
            if (!assignment.cancelled && !closed(assignment)) {
                tx.update(reference, {
                    ended: true,
                    endedAt: Date.now(),
                    endedBy: actor.email,
                    closed: true,
                    closeReason: "teacher-ended"
                });
            }

            if (
                scheduleSnapshot?.exists &&
                !scheduleSnapshot.data().cancelled &&
                !scheduleSnapshot.data().closed
            ) {
                const records = recipientSnapshot.docs.map(document =>
                    document.id === reference.id
                        ? {
                            ...document.data(),
                            ended: true,
                            closed: true
                        }
                        : document.data()
                );

                const active = records.filter(record => !record.cancelled);

                if (
                    active.length > 0 &&
                    active.every(record => closed(record))
                ) {
                    closeScheduleWrites(
                        tx,
                        scheduleSnapshot.ref,
                        assignment.scheduleId,
                        Date.now(),
                        allRecipientsFinished(records)
                            ? "all-completed"
                            : "all-recipients-closed"
                    );
                }
            }
        });

        return { ok: true };
    }

    async function endSchedule(actor, data) {
        const id = validateId(data.id, "schedule");
        const reference = schedules.doc(id);

        await db.runTransaction(async tx => {
            const [snapshot, recipientSnapshot] = await Promise.all([
                tx.get(reference),
                tx.get(
                    assignments.where("scheduleId", "==", id)
                )
            ]);

            requireValue(
                snapshot.exists,
                "Schedule not found.",
                "not-found"
            );

            const schedule = snapshot.data();
            requireOwner(actor, schedule);

            if (schedule.cancelled || schedule.closed || schedule.ended) {
                return;
            }

            const now = Date.now();

            tx.update(reference, {
                ended: true,
                endedAt: now,
                endedBy: actor.email,
                closed: true,
                closedAt: now,
                closeReason: "teacher-ended"
            });

            recipientSnapshot.docs.forEach(document => {
                const assignment = document.data();

                // Keep already-completed recipients labelled completed.
                if (!closed(assignment)) {
                    tx.update(document.ref, {
                        ended: true,
                        endedAt: now,
                        endedBy: actor.email,
                        closed: true,
                        closeReason: "teacher-ended"
                    });
                }
            });

            stopJobs(tx, id);
        });

        return { ok: true };
    }

    // Backfills closure metadata for older schedules whose existing
    // on-time + late totals already meet every active recipient's target.
    //
    // No historical attempt is credited again.
    async function reconcileSchedule(id) {
        await db.runTransaction(async tx => {
            const reference = schedules.doc(id);

            const [snapshot, recipientSnapshot] = await Promise.all([
                tx.get(reference),
                tx.get(
                    assignments.where("scheduleId", "==", id)
                )
            ]);

            if (!snapshot.exists) return;

            const schedule = snapshot.data();

            if (schedule.cancelled || schedule.closed || schedule.ended) {
                return;
            }

            const records = recipientSnapshot.docs.map(document =>
                document.data()
            );

            const now = Date.now();

            recipientSnapshot.docs.forEach(document => {
                const assignment = document.data();

                if (
                    !assignment.cancelled &&
                    reachedTarget(assignment) &&
                    !assignment.closed
                ) {
                    tx.update(document.ref, {
                        closed: true,
                        closedAt: assignment.lastSubmissionAt || now,
                        closeReason: "target-completed",
                        completedTotal: total(assignment)
                    });
                }
            });

            if (allRecipientsFinished(records)) {
                closeScheduleWrites(
                    tx,
                    reference,
                    id,
                    now,
                    "all-completed"
                );
            }
        });
    }

    return {
        total,
        closed,
        project,
        assertOpen,
        prepareCredit,
        applyCredit,
        endAssignment,
        endSchedule,
        reconcileSchedule
    };
};