const { createHash } = require("node:crypto");

const SITE_URL = "https://nclhist.netlify.app/knowledge-test";
const SUPER_ADMIN = "clng@ktls.edu.hk";
const STAGES = ["start", "reminder", "report"];

function hash(value) {
    return createHash("sha256").update(value).digest("hex");
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function hkDate(value) {
    return new Date(value + 8 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
}

function hkTime(value) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Hong_Kong",
        dateStyle: "medium",
        timeStyle: "short"
    }).format(new Date(value)) + " HKT";
}

function message(subject, paragraphs) {
    const text = [...paragraphs, SITE_URL].join("\n\n");

    const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#233649">
      ${paragraphs.map(p =>
        `<p style="white-space:pre-line">${escapeHtml(p)}</p>`
    ).join("")}
      <p>
        <a href="${SITE_URL}">Open Knowledge Test</a>
      </p>
      <p>Sign in with the school Google account to which this email was sent.</p>
      <p>History Archive</p>
    </div>
  `;

    return { subject, text, html };
}

module.exports = function makeScheduling({
    db,
    root,
    TOPICS,
    requireValue,
    requireAdmin,
    cleanTopics,
    rosterFor,
    bankReadiness
}) {
    const schedules = root.collection("schedules");
    const assignments = root.collection("assignments");
    const jobs = root.collection("notificationJobs");
    const catalogRef = root.collection("state").doc("catalog");
    const presets = root.collection("presets");

    function scheduleId(value) {
        requireValue(
            typeof value === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
            "Invalid schedule ID."
        );
        return value;
    }

    function assignmentId(id, email) {
        return `${id}_${hash(email).slice(0, 20)}`;
    }

    async function create(actor, data) {
        requireAdmin(actor);

        const id = scheduleId(data.id);

        requireValue(
            Array.isArray(data.emails) &&
            data.emails.length > 0 &&
            data.emails.length <= 100,
            "Select between 1 and 100 students per schedule."
        );

        const emails = [...new Set(
            data.emails.map(email => String(email).toLowerCase().trim())
        )].sort();

        const topics = cleanTopics(data.topics);
        const target = Number(data.target);
        const startsAt = Number(data.startsAt);
        const reminderAt = Number(data.reminderAt);
        const dueAt = Number(data.dueAt);

        requireValue(
            Number.isInteger(target) && target >= 1 && target <= 50,
            "The required exercise count must be between 1 and 50."
        );

        requireValue(
            [startsAt, reminderAt, dueAt].every(Number.isFinite),
            "Invalid schedule dates."
        );

        requireValue(
            startsAt <= reminderAt &&
            reminderAt < dueAt &&
            dueAt - startsAt <= 31 * 86400000,
            "Use a valid window of at most 31 days, with the reminder before the deadline."
        );

        requireValue(
            hkDate(reminderAt) === hkDate(dueAt),
            "The reminder must be on the deadline date in Hong Kong time."
        );

        const compulsory = data.compulsory !== false;

        const requestFingerprint = hash(JSON.stringify({
            creator: actor.email,
            emails,
            topics,
            presetId: data.presetId || null,
            target,
            startsAt,
            reminderAt,
            dueAt,
            compulsory
        }));

        const ref = schedules.doc(id);
        const existing = await ref.get();

        if (existing.exists) {
            requireValue(
                existing.data().creator === actor.email &&
                existing.data().requestFingerprint === requestFingerprint,
                "This schedule ID was already used for different details.",
                "failed-precondition"
            );

            return { id, alreadySaved: true };
        }

        const roster = await rosterFor(actor);
        const byEmail = new Map(roster.map(student => [student.email, student]));

        requireValue(
            emails.every(email => byEmail.has(email)),
            "One or more students are outside your current permitted roster.",
            "permission-denied"
        );

        let title = topics.length === 1
            ? TOPICS.find(t => t.id === topics[0]).label
            : "Assigned mixed practice";

        let presetTopics = null;

        if (data.presetId) {
            requireValue(
                typeof data.presetId === "string" &&
                /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(data.presetId),
                "Invalid preset ID."
            );

            const preset = await presets.doc(data.presetId).get();
            requireValue(preset.exists, "Preset not found.");

            presetTopics = cleanTopics(preset.data().topics);

            requireValue(
                JSON.stringify(presetTopics) === JSON.stringify(topics),
                "The preset changed. Reload the page before scheduling."
            );

            title = preset.data().name;
        }

        const recipients = emails.map(email => {
            const student = byEmail.get(email);
            return {
                email,
                name: student.name || email,
                className: student.className || ""
            };
        });

        await db.runTransaction(async tx => {
            const [old, catalog] = await Promise.all([
                tx.get(ref),
                tx.get(catalogRef)
            ]);

            if (old.exists) {
                requireValue(
                    old.data().creator === actor.email &&
                    old.data().requestFingerprint === requestFingerprint,
                    "This schedule ID was already used for different details."
                );
                return;
            }

            requireValue(
                dueAt > Date.now(),
                "The deadline must still be in the future."
            );

            const availability = bankReadiness(
                catalog.data()?.items || [],
                topics
            );

            requireValue(
                availability.ready,
                availability.reason,
                "failed-precondition"
            );

            const now = Date.now();

            tx.create(ref, {
                id,
                creator: actor.email,
                title,
                topics,
                presetId: data.presetId || null,
                target,
                startsAt,
                reminderAt,
                dueAt,
                compulsory,
                recipients,
                requestFingerprint,
                createdAt: now,
                cancelled: false,
                notificationsEnabled: true,
                notifications: {}
            });

            recipients.forEach(student => {
                const aId = assignmentId(id, student.email);

                tx.create(assignments.doc(aId), {
                    id: aId,
                    scheduleId: id,
                    email: student.email,
                    creator: actor.email,
                    title,
                    topics,
                    presetId: data.presetId || null,
                    target,
                    compulsory,
                    startsAt,
                    dueAt,
                    createdAt: now,
                    completed: 0,
                    late: 0,
                    cancelled: false,
                    notificationsEnabled: true
                });
            });

            const times = {
                start: startsAt,
                reminder: reminderAt,
                report: dueAt + 5 * 60 * 1000
            };

            STAGES.forEach(stage => {
                tx.create(jobs.doc(`${id}_${stage}`), {
                    scheduleId: id,
                    stage,
                    runAt: times[stage]
                });
            });
        });

        return { id, alreadySaved: false };
    }

    async function list(actor) {
        requireAdmin(actor);

        const snap = actor.superadmin
            ? await schedules.get()
            : await schedules.where("creator", "==", actor.email).get();

        return snap.docs.map(doc => {
            const s = doc.data();

            // Do not expose stored recipient snapshots through this endpoint.
            return {
                id: s.id,
                creator: s.creator,
                title: s.title,
                startsAt: s.startsAt,
                reminderAt: s.reminderAt,
                dueAt: s.dueAt,
                target: s.target,
                recipientCount: s.recipients.length,
                cancelled: s.cancelled,
                notifications: s.notifications || {},
                createdAt: s.createdAt
            };
        }).sort((a, b) => b.createdAt - a.createdAt);
    }

    async function cancel(actor, data) {
        requireAdmin(actor);
        const ref = schedules.doc(scheduleId(data.id));

        await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            requireValue(snap.exists, "Schedule not found.");

            const s = snap.data();

            requireValue(
                actor.superadmin || s.creator === actor.email,
                "Only the assigning administrator or superadmin can cancel this schedule.",
                "permission-denied"
            );

            const refs = s.recipients.map(student =>
                assignments.doc(assignmentId(s.id, student.email))
            );

            const records = refs.length ? await tx.getAll(...refs) : [];

            tx.update(ref, {
                cancelled: true,
                cancelledAt: Date.now()
            });

            records.forEach(record => {
                if (record.exists) {
                    tx.update(record.ref, {
                        cancelled: true,
                        cancelledAt: Date.now()
                    });
                }
            });

            STAGES.forEach(stage => {
                tx.delete(jobs.doc(`${s.id}_${stage}`));
            });
        });

        return { ok: true };
    }

    async function currentContext(schedule) {
        const creator = schedule.creator;
        const superadmin = creator === SUPER_ADMIN;

        const role = await db.collection("user_roles").doc(creator).get();

        if (!superadmin && (!role.exists || role.data().role !== "admin")) {
            return null;
        }

        const actor = {
            email: creator,
            role: "admin",
            admin: true,
            superadmin
        };

        // Re-evaluate the current permitted roster, not the creation snapshot.
        const roster = await rosterFor(actor);

        return {
            actor,
            byEmail: new Map(roster.map(student => [student.email, student]))
        };
    }

    async function processJob(jobRef) {
        const initialJob = await jobRef.get();
        if (!initialJob.exists) return;

        const initialSchedule = await schedules
            .doc(initialJob.data().scheduleId)
            .get();

        const context = initialSchedule.exists
            ? await currentContext(initialSchedule.data())
            : null;

        await db.runTransaction(async tx => {
            const jobSnap = await tx.get(jobRef);
            if (!jobSnap.exists) return;

            const job = jobSnap.data();
            const scheduleRef = schedules.doc(job.scheduleId);
            const scheduleSnap = await tx.get(scheduleRef);

            if (!scheduleSnap.exists) {
                tx.delete(jobRef);
                return;
            }

            const s = scheduleSnap.data();
            const now = Date.now();

            if (job.runAt > now) return;

            if (
                s.cancelled ||
                !s.notificationsEnabled ||
                !context ||
                !STAGES.includes(job.stage)
            ) {
                tx.delete(jobRef);

                if (STAGES.includes(job.stage)) {
                    tx.update(scheduleRef, {
                        [`notifications.${job.stage}`]: {
                            checkedAt: now,
                            queued: 0,
                            status: "Skipped: cancelled, disabled or access removed"
                        }
                    });
                }

                return;
            }

            const refs = s.recipients.map(student =>
                assignments.doc(assignmentId(s.id, student.email))
            );

            const records = refs.length ? await tx.getAll(...refs) : [];

            // All transaction reads are complete.
            const eligible = records
                .filter(record => record.exists)
                .map(record => record.data())
                .filter(a =>
                    !a.cancelled &&
                    context.byEmail.has(a.email)
                );

            const unfinished = eligible.filter(a =>
                (a.completed || 0) + (a.late || 0) < a.target
            );

            let queued = 0;
            let status = "Checked";

            if (job.stage === "start") {
                // Do not send a stale "starting now" email after the deadline,
                // or alongside an already-due deadline reminder.
                if (now >= s.dueAt || now >= s.reminderAt) {
                    status = "Skipped stale start notice";
                } else {
                    unfinished.forEach(a => {
                        const student = context.byEmail.get(a.email);

                        const mailId = `kt_${s.id}_start_${hash(a.email).slice(0, 20)}`;

                        tx.create(db.collection("mail").doc(mailId), {
                            to: a.email,
                            replyTo: s.creator,
                            knowledgeTest: {
                                scheduleId: s.id,
                                stage: "start",
                                assignmentId: a.id
                            },
                            createdAt: now,
                            message: message(
                                `History practice: ${s.title}`,
                                [
                                    `Dear ${student.name || "Student"},`,
                                    `${s.compulsory ? "Your compulsory" : "Your optional"} assignment is now available: ${s.title}.`,
                                    `Complete ${s.target} exercise(s), each containing 20 questions.`,
                                    `Deadline: ${hkTime(s.dueAt)}.`,
                                    'Open Knowledge Test and use the assignment’s "Start assignment" button. Ordinary practice does not count towards this assignment.',
                                    `Assigned by: ${s.creator}`
                                ]
                            )
                        });

                        queued++;
                    });
                }
            }

            if (job.stage === "reminder") {
                if (now >= s.dueAt) {
                    status = "Skipped reminder because deadline has passed";
                } else {
                    unfinished.forEach(a => {
                        const student = context.byEmail.get(a.email);
                        const done = (a.completed || 0) + (a.late || 0);

                        const mailId = `kt_${s.id}_reminder_${hash(a.email).slice(0, 20)}`;

                        tx.create(db.collection("mail").doc(mailId), {
                            to: a.email,
                            replyTo: s.creator,
                            knowledgeTest: {
                                scheduleId: s.id,
                                stage: "reminder",
                                assignmentId: a.id
                            },
                            createdAt: now,
                            message: message(
                                `Due today: ${s.title}`,
                                [
                                    `Dear ${student.name || "Student"},`,
                                    `Your assignment "${s.title}" is due today.`,
                                    `Completed: ${done}/${a.target}. Remaining: ${Math.max(0, a.target - done)} exercise(s).`,
                                    `Deadline: ${hkTime(s.dueAt)}.`,
                                    'Please open Knowledge Test and use the assignment’s "Start assignment" button.',
                                    `Assigned by: ${s.creator}`
                                ]
                            )
                        });

                        queued++;
                    });
                }
            }

            if (job.stage === "report" && unfinished.length) {
                const lines = unfinished.map(a => {
                    const student = context.byEmail.get(a.email);

                    return [
                        student.name || a.email,
                        student.className || "No class",
                        a.email,
                        `${a.completed || 0} on-time + ${a.late || 0} late / ${a.target} required`
                    ].join(" — ");
                });

                tx.create(db.collection("mail").doc(`kt_${s.id}_report`), {
                    to: s.creator,
                    knowledgeTest: {
                        scheduleId: s.id,
                        stage: "report"
                    },
                    createdAt: now,
                    message: message(
                        `Incomplete history assignment: ${s.title}`,
                        [
                            "Dear Teacher,",
                            `The deadline for "${s.title}" was ${hkTime(s.dueAt)}.`,
                            `The following ${unfinished.length} student(s) were still below the required number of exercises when checked at ${hkTime(now)}:`,
                            lines.join("\n"),
                            "Late submissions already recorded are included in these counts. On-time and late totals remain separate in the administrator dashboard.",
                            "Students no longer in your permitted roster and cancelled assignments are excluded.",
                            "Open Knowledge Test → Students & assignments to inspect the records."
                        ]
                    )
                });

                queued = 1;
            }

            tx.update(scheduleRef, {
                [`notifications.${job.stage}`]: {
                    checkedAt: now,
                    queued,
                    status
                }
            });

            // Atomic with the mail writes above.
            tx.delete(jobRef);
        });
    }

    async function tick() {
        const due = await jobs
            .where("runAt", "<=", Date.now())
            .orderBy("runAt")
            .limit(20)
            .get();

        for (const job of due.docs) {
            try {
                await processJob(job.ref);
            } catch (error) {
                console.error("Knowledge Test notification failed:", job.id, error);

                // Back off this job without blocking all other due jobs.
                await db.runTransaction(async tx => {
                    const current = await tx.get(job.ref);
                    if (!current.exists) return;

                    tx.update(job.ref, {
                        runAt: Date.now() + 15 * 60 * 1000,
                        failures: (current.data().failures || 0) + 1,
                        lastError: String(error.message || error).slice(0, 1000)
                    });
                });
            }
        }

        return null;
    }

    return { create, list, cancel, tick };
};