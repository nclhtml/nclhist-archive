import React, { useState } from "react";
import { knowledgeApi, TOPICS } from "./api.js";

export default function AdminAssignmentTest({
    home,
    busy,
    run,
    start,
    refresh,
    PracticeHomeComponent
}) {
    const [topics, setTopics] = useState(() => {
        const ready = home.topics.find(topic => topic.ready);
        return ready ? [ready.id] : ["ww1"];
    });

    const [target, setTarget] = useState(1);
    const [requestId, setRequestId] = useState(() => crypto.randomUUID());

    const studentViewHome = {
        ...home,
        actor: {
            ...home.actor,
            admin: false,
            superadmin: false
        },
        assignments: (home.assignments || []).filter(assignment =>
            assignment.testOnly === true
        )
    };

    return (
        <>
            <section className="kt-card">
                <p className="kt-eyebrow">Administrator-only testing</p>
                <h2>Test an assigned compulsory practice</h2>

                <p className="kt-notice">
                    Create a test assignment for your own administrator account.
                    The student-style popup, assignment entry, exercise and report
                    use the actual assignment workflow.
                    No student receives this assignment and no emails are scheduled.
                    Test progress is stored only on your own administrator account.
                </p>

                <fieldset disabled={busy} className="kt-answer-fieldset">
                    <legend className="kt-sr-only">Test assignment settings</legend>

                    <div className="kt-row">
                        {TOPICS.map(topic => (
                            <label className="kt-check" key={topic.id}>
                                <input
                                    type="checkbox"
                                    checked={topics.includes(topic.id)}
                                    onChange={event => setTopics(old =>
                                        event.target.checked
                                            ? [...old, topic.id]
                                            : old.filter(id => id !== topic.id)
                                    )}
                                />
                                {topic.label}
                            </label>
                        ))}
                    </div>

                    <label className="kt-field">
                        Required full exercises
                        <input
                            type="number"
                            min="1"
                            max="50"
                            value={target}
                            onChange={event => setTarget(Number(event.target.value))}
                        />
                    </label>

                    <button
                        type="button"
                        disabled={
                            busy ||
                            !topics.length ||
                            !Number.isInteger(target) ||
                            target < 1 ||
                            target > 50
                        }
                        onClick={() => run(async () => {
                            await knowledgeApi("testAssignment", {
                                id: requestId,
                                topics,
                                target
                            });

                            setRequestId(crypto.randomUUID());
                            await refresh();
                        })}
                    >
                        Create my test compulsory assignment
                    </button>
                </fieldset>

                <p className="kt-muted kt-spaced">
                    The test starts immediately and has a seven-day deadline.
                    For repetition testing, choose a larger target.
                    Ordinary topic previews remain previews; use the test
                    assignment button when testing assignment credit and recovery.
                </p>
            </section>

            <PracticeHomeComponent
                home={studentViewHome}
                busy={busy}
                run={run}
                start={start}
                refresh={refresh}
            />
        </>
    );
}