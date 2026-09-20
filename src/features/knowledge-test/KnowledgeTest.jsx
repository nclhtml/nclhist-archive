import React, { useEffect, useState } from "react";
import { useAuth } from "../../main.jsx";
import useCloudAnswers from "./useCloudAnswers.js";
import QuestionPrompt from "./QuestionPrompt.jsx";
import SchedulePlanner from "./SchedulePlanner.jsx";
import { rememberKnowledgeLoginReturn } from "./loginReturn.js";
import { useLanguage } from "../../LanguageContext.jsx";
import FoundationRunner from "./FoundationRunner.jsx";
import { localizeQuestion, localizedTopic } from "./quizLanguage.js";

import {
    knowledgeApi,
    TOPICS,
    topicName,
    accuracy,
    hkTime,
    assignmentStatus
} from "./api.js";

import {
    readWorkbook,
    downloadWorkbook
} from "./workbook.js";

import "./knowledge-test.css";

function TopicPicker({ value, onChange }) {
    return (
        <div className="kt-topic-picker">
            {["A", "B"].map(theme => (
                <fieldset key={theme}>
                    <legend>Theme {theme}</legend>
                    {TOPICS.filter(t => t.theme === theme).map(topic => (
                        <label key={topic.id}>
                            <input
                                type="checkbox"
                                checked={value.includes(topic.id)}
                                onChange={event => onChange(
                                    event.target.checked
                                        ? [...value, topic.id]
                                        : value.filter(id => id !== topic.id)
                                )}
                            />
                            {topic.label}
                        </label>
                    ))}
                </fieldset>
            ))}
        </div>
    );
}

function Stats({ summary }) {
    return (
        <>
            <div className="kt-stat-grid">
                <div><strong>{summary.completed || 0}</strong><span>Completed exercises</span></div>
                <div>
                    <strong>{accuracy(summary.totalCorrect, summary.totalAnswered)}</strong>
                    <span>Overall accuracy</span>
                </div>
                <div><strong>{summary.unresolved || 0}</strong><span>Unresolved mistakes</span></div>
            </div>

            <div className="kt-table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Topic</th>
                            <th>Exercises including topic</th>
                            <th>Questions answered</th>
                            <th>Accuracy</th>
                        </tr>
                    </thead>
                    <tbody>
                        {TOPICS.map(topic => {
                            const stat = summary.stats?.[topic.id] || {};
                            return (
                                <tr key={topic.id}>
                                    <td>{topic.label}</td>
                                    <td>{stat.runs || 0}</td>
                                    <td>{stat.answered || 0}</td>
                                    <td>{accuracy(stat.correct, stat.answered)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <p className="kt-muted">
                Mixed exercises and cross-topic chronology questions can appear under
                more than one topic. Topic totals should not be added together to
                calculate overall exercises or questions answered.
            </p>
        </>
    );
}

function answerText(q, answer) {
    if (answer === undefined || answer === null) return "Not answered";

    if (q.type === "mc") return q.choices[answer] || "Not answered";
    if (q.type === "blank") {
        return Array.isArray(answer) ? answer.join(" / ") : String(answer);
    }
    if (q.type === "sequence") {
        return answer.map(i => q.items[i]).join(" → ");
    }
    return q.left.map((left, i) =>
        `${left} → ${q.right[answer[i]] || "Not answered"}`
    ).join("; ");
}

function ReviewQuestion({ question, submitted, correct, children }) {
    const { language } = useLanguage();
    const tr = (en, zh) => language === "zh" ? zh : en;
    const q = localizeQuestion(question, language);

    const displayAnswer = answer => {
        if (answer === undefined || answer === null) {
            return tr("Not answered", "未作答");
        }

        if (q.type === "mc") {
            return q.choices[answer] ?? tr("Not answered", "未作答");
        }

        if (q.type === "blank") {
            return Array.isArray(answer) ? answer.join(" / ") : String(answer);
        }

        if (q.type === "sequence") {
            return Array.isArray(answer)
                ? answer.map(index => q.items[index]).join(" → ")
                : tr("Not answered", "未作答");
        }

        return q.left.map((left, index) =>
            `${left} → ${q.right[answer?.[index]] ?? tr("Not answered", "未作答")}`
        ).join("; ");
    };

    return (
        <article className={`kt-review ${correct ? "is-correct" : "is-wrong"}`}>
            <div className="kt-row">
                <span className="kt-tag">
                    {localizedTopic(question.topic, language)}
                </span>

                <span className="kt-muted">{q.subtopic}</span>

                {question.demo && (
                    <span className="kt-tag">{tr("DEMO", "示範")}</span>
                )}
            </div>

            {question.focusEvent && (
                <p className="kt-notice kt-spaced">
                    <strong>{tr("Event to revise: ", "需要溫習的事件：")}</strong>
                    {language === "zh"
                        ? question.focusEvent.nameZh || question.focusEvent.name
                        : question.focusEvent.name}
                </p>
            )}

            {q.translationMissing && (
                <p className="kt-muted">
                    此題未有完整中文翻譯，暫時顯示英文版本。
                </p>
            )}

            <h3>{q.prompt}</h3>

            <p>
                <strong>{tr("Your answer:", "你的答案：")}</strong>
                {" "}{displayAnswer(submitted)}
            </p>

            <p>
                <strong>{tr("Correct answer:", "正確答案：")}</strong>
                {" "}{displayAnswer(q.answer)}
            </p>

            <p className="kt-explanation">{q.explanation}</p>

            {children}
        </article>
    );
}

function Report({ attempt, onBack }) {
    const [showAll, setShowAll] = useState(false);
    const wrong = attempt.results.filter(r => !r.correct);

    const topics = {};
    wrong.forEach(result => {
        const q = attempt.questions.find(question => question.id === result.id);
        const key = `${topicName(q.topic)} — ${q.subtopic}`;
        topics[key] = (topics[key] || 0) + 1;
    });

    return (
        <section className="kt-card">
            <button className="kt-secondary" onClick={onBack}>← Back</button>
            <p className="kt-eyebrow">{attempt.preview ? "Administrator preview" : "Exercise report"}</p>
            <h2>{attempt.title}</h2>

            <div className="kt-stat-grid">
                <div><strong>{attempt.correct}/{attempt.questions.length}</strong><span>Correct answers</span></div>
                <div>
                    <strong>{accuracy(attempt.correct, attempt.questions.length)}</strong>
                    <span>Accuracy</span>
                </div>
                <div><strong>{wrong.length}</strong><span>Questions to revise</span></div>
            </div>

            <p className="kt-muted">Submitted: {hkTime(attempt.submittedAt)} HKT</p>

            {attempt.preview && (
                <p className="kt-notice">Preview only. No student progress or assignments were changed.</p>
            )}

            {attempt.assignmentCredit && (
                <p className="kt-notice">
                    Assignment result: {
                        attempt.assignmentCredit === "on-time"
                            ? "Counted towards the target."
                            : attempt.assignmentCredit === "late"
                                ? "Recorded as late work; not counted towards the on-time target."
                                : "The assignment was cancelled; this exercise remains in your practice history."
                    }
                </p>
            )}

            {!!wrong.length && (
                <div className="kt-revision-topics">
                    <h3>Suggested revision</h3>
                    <ul>
                        {Object.entries(topics).map(([topic, count]) => (
                            <li key={topic}>{topic}: {count} incorrect</li>
                        ))}
                    </ul>
                </div>
            )}

            {!wrong.length && <p className="kt-notice">All answers correct. Well done.</p>}

            <label className="kt-check">
                <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
                Show correct answers as well
            </label>

            {attempt.results.filter(r => showAll || !r.correct).map(result => (
                <ReviewQuestion
                    key={result.id}
                    question={attempt.questions.find(q => q.id === result.id)}
                    submitted={result.submitted}
                    correct={result.correct}
                />
            ))}
        </section>
    );
}

function completeAnswer(q, value) {
    if (q.type === "mc") return Number.isInteger(value);
    if (q.type === "blank") return typeof value === "string" && value.trim().length > 0;
    if (!Array.isArray(value)) return false;
    const length = q.type === "matching" ? q.left.length : q.items.length;

    return value.length === length &&
        value.every(Number.isInteger) &&
        new Set(value).size === length;
}

function Runner({ attempt, email, busy, run, onFinish, onExit }) {
    const {
        answers,
        updateAnswer,
        save,
        saveStatus,
        getRevision
    } = useCloudAnswers(attempt);

    const [position, setPosition] = useState(0);
    const q = attempt.questions[position];
    const value = answers[q.id];

    const answered = attempt.questions.filter(question =>
        completeAnswer(question, answers[question.id])
    ).length;

    const update = next => updateAnswer(q.id, next);

    const move = next => run(async () => {
        await save();
        setPosition(next);
    });

    const sequence = Array.isArray(value) && value.length
        ? value
        : q.type === "sequence"
            ? q.items.map((_, i) => i)
            : [];

    const moveItem = (index, direction) => {
        const next = [...sequence];
        const target = index + direction;
        [next[index], next[target]] = [next[target], next[index]];
        update(next);
    };

    return (
        <section className="kt-card kt-runner">
            <div className="kt-row kt-between">
                <div>
                    <p className="kt-eyebrow">{attempt.preview ? "Preview exercise" : "Knowledge practice"}</p>
                    <h2>{attempt.title}</h2>
                </div>
                <button
                    className="kt-secondary"
                    disabled={busy}
                    onClick={() => run(async () => {
                        await save();
                        await onExit();
                    })}
                >
                    Save and exit
                </button>
            </div>

            {attempt.questions.length < 20 && (
                <p className="kt-notice">
                    Short practice: only {attempt.questions.length} questions are available.
                    This does not count as a compulsory 20-question assignment.
                </p>
            )}

            <div className="kt-row kt-between">
                <span>Question {position + 1} of {attempt.questions.length}</span>
                <span>{answered} answered</span>
            </div>
            <div className="kt-row kt-between">
                <p className="kt-muted" role="status">{saveStatus}</p>

                <button
                    type="button"
                    className="kt-secondary"
                    disabled={busy}
                    onClick={() => run(save)}
                >
                    Save now / retry
                </button>
            </div>
            <progress value={answered} max={attempt.questions.length} />

            <div className="kt-question-nav" aria-label="Question navigation">
                {attempt.questions.map((question, index) => (
                    <button
                        key={question.id}
                        type="button"
                        disabled={busy}
                        className={[
                            index === position ? "current" : "",
                            completeAnswer(question, answers[question.id]) ? "answered" : ""
                        ].join(" ")}
                        aria-label={`Question ${index + 1}`}
                        aria-current={index === position ? "step" : undefined}
                        onClick={() => move(index)}
                    >
                        {index + 1}
                    </button>
                ))}
            </div>

            <div className="kt-row">
                <span className="kt-tag">{topicName(q.topic)}</span>
                <span className="kt-tag">{q.type === "mc" ? "Multiple choice" : q.type}</span>
                {q.demo && <span className="kt-tag">DEMONSTRATION ONLY</span>}
            </div>

            <h3 className="kt-question-title">{q.prompt}</h3>

            <fieldset disabled={busy} className="kt-answer-fieldset">
                <legend className="kt-sr-only">Your answer</legend>

                {q.type === "mc" && (
                    <div className="kt-options">
                        {q.choices.map((choice, index) => (
                            <label key={index} className={value === index ? "selected" : ""}>
                                <input
                                    type="radio"
                                    name={q.id}
                                    checked={value === index}
                                    onChange={() => update(index)}
                                />
                                <span className="kt-option-letter">{String.fromCharCode(65 + index)}</span>
                                <span>{choice}</span>
                            </label>
                        ))}
                    </div>
                )}

                {q.type === "blank" && (
                    <label className="kt-field">
                        Type your answer
                        <input
                            type="text"
                            maxLength={400}
                            autoComplete="off"
                            value={typeof value === "string" ? value : ""}
                            onChange={e => update(e.target.value)}
                        />
                    </label>
                )}

                {q.type === "matching" && (
                    <div className="kt-matching">
                        {q.left.map((left, index) => {
                            const matches = Array.isArray(value)
                                ? value
                                : q.left.map(() => null);

                            return (
                                <label key={index}>
                                    <span>{left}</span>
                                    <select
                                        value={matches[index] ?? ""}
                                        onChange={event => {
                                            const next = [...matches];
                                            next[index] = event.target.value === ""
                                                ? null
                                                : Number(event.target.value);
                                            update(next);
                                        }}
                                    >
                                        <option value="">Choose a match</option>
                                        {q.right.map((right, rightIndex) => (
                                            <option
                                                key={rightIndex}
                                                value={rightIndex}
                                                disabled={matches.some((v, i) => i !== index && v === rightIndex)}
                                            >
                                                {right}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            );
                        })}
                    </div>
                )}

                {q.type === "sequence" && (
                    <>
                        <p className="kt-muted">Use the arrows to arrange the items.</p>
                        <ol className="kt-sequence">
                            {sequence.map((item, index) => (
                                <li key={item}>
                                    <span>{index + 1}. {q.items[item]}</span>
                                    <div>
                                        <button
                                            type="button"
                                            className="kt-secondary"
                                            disabled={index === 0}
                                            aria-label={`Move ${q.items[item]} up`}
                                            onClick={() => moveItem(index, -1)}
                                        >↑</button>
                                        <button
                                            type="button"
                                            className="kt-secondary"
                                            disabled={index === sequence.length - 1}
                                            aria-label={`Move ${q.items[item]} down`}
                                            onClick={() => moveItem(index, 1)}
                                        >↓</button>
                                    </div>
                                </li>
                            ))}
                        </ol>
                        {!completeAnswer(q, value) && (
                            <button type="button" className="kt-secondary" onClick={() => update(sequence)}>
                                Use this order
                            </button>
                        )}
                    </>
                )}
            </fieldset>

            <div className="kt-row kt-between kt-spaced">
                <button
                    className="kt-secondary"
                    disabled={busy || position === 0}
                    onClick={() => move(position - 1)}
                >Previous</button>

                {position < attempt.questions.length - 1 ? (
                    <button disabled={busy} onClick={() => move(position + 1)}>Next question</button>
                ) : (
                    <button
                        disabled={busy || answered !== attempt.questions.length}
                        onClick={() => run(async () => {
                            await save();

                            const report = await knowledgeApi("submit", {
                                id: attempt.id,
                                expectedRevision: getRevision()
                            });

                            onFinish(report);
                        })}
                    >
                        Submit exercise
                    </button>
                )}
            </div>

            {position === attempt.questions.length - 1 && answered !== attempt.questions.length && (
                <p className="kt-muted">Answer every question before submitting.</p>
            )}
        </section>
    );
}

function PracticeHome({ home, busy, run, start, refresh }) {
    const [mix, setMix] = useState([]);
    const [presetName, setPresetName] = useState("");
    const [presetId, setPresetId] = useState(() => crypto.randomUUID());

    return (
        <>
            {!home.actor.admin && <section className="kt-card"><Stats summary={home.summary} /></section>}

            {home.summary.activeAttemptId && (
                <section className="kt-card kt-resume">
                    <h2>Continue your unfinished exercise</h2>
                    <div className="kt-row">
                        <button
                            disabled={busy}
                            onClick={() => run(async () => start(
                                await knowledgeApi("attempt", { id: home.summary.activeAttemptId })
                            ))}
                        >Resume exercise</button>

                        <button
                            className="kt-secondary"
                            disabled={busy}
                            onClick={() => {
                                if (!window.confirm("Abandon this exercise? It will not count towards progress.")) return;
                                run(async () => {
                                    await knowledgeApi("abandon", { id: home.summary.activeAttemptId });
                                    await refresh();
                                });
                            }}
                        >Abandon</button>
                    </div>
                </section>
            )}

            {home.actor.admin && (
                <p className="kt-notice">
                    Administrator preview mode: exercises here do not update student scores.
                </p>
            )}

            <section className="kt-card">
                <p className="kt-eyebrow">Choose a focus</p>
                <h2>Topic practice</h2>
                <p className="kt-muted">
                    Twenty questions: 14 foundation questions, 3 chronological
                    sequencing questions and 3 year-to-event matching questions.
                    Previous question and event mistakes receive higher selection priority.
                </p>

                {["A", "B"].map(theme => (
                    <div key={theme}>
                        <h3>Theme {theme}</h3>
                        <div className="kt-topic-grid">
                            {home.topics.filter(t => t.theme === theme).map(topic => (
                                <button
                                    key={topic.id}
                                    className="kt-topic-card"
                                    disabled={busy || !topic.ready}
                                    onClick={() => run(async () => start(
                                        await knowledgeApi("start", { topics: [topic.id] })
                                    ))}
                                >
                                    <strong>{topic.label}</strong>
                                    <span>
                                        {topic.count} foundation questions
                                    </span>
                                    <span>
                                        {topic.eventCount || 0} timeline events
                                        {" · "}{topic.yearCount || 0} different years
                                    </span>
                                    {!topic.ready && (
                                        <span>
                                            Needs 14 foundation questions and 6 event years
                                        </span>
                                    )}
                                    <span>{home.actor.admin ? "Preview →" : "Practise →"}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </section>

            <section className="kt-card">
                <p className="kt-eyebrow">Make connections</p>
                <h2>Build a mixed exercise</h2>
                <p className="kt-muted">
                    Select any combination. The 14 foundation questions are distributed
                    as evenly as availability allows. The 6 chronology questions draw
                    events from the combined selected topics.
                </p>
                <TopicPicker value={mix} onChange={setMix} />

                <button
                    disabled={busy || !mix.length}
                    onClick={() => run(async () => start(
                        await knowledgeApi("start", { topics: mix })
                    ))}
                >
                    {home.actor.admin ? "Preview this mix" : "Start this mix"}
                </button>

                {home.actor.admin && (
                    <div className="kt-preset-create">
                        <label className="kt-field">
                            Save this mix as a shared preset
                            <input
                                value={presetName}
                                maxLength={100}
                                placeholder="For example: Twentieth-century conflicts"
                                onChange={e => setPresetName(e.target.value)}
                            />
                        </label>
                        <button
                            className="kt-secondary"
                            disabled={busy || !mix.length || !presetName.trim()}
                            onClick={() => run(async () => {
                                await knowledgeApi("preset", {
                                    id: presetId,
                                    name: presetName,
                                    topics: mix
                                });
                                setPresetId(crypto.randomUUID());
                                setPresetName("");
                                await refresh();
                            })}
                        >Save preset</button>
                    </div>
                )}
            </section>

            {!!home.presets.length && (
                <section className="kt-card">
                    <h2>Teacher-created practice groups</h2>
                    <div className="kt-topic-grid">
                        {home.presets.map(preset => (
                            <button
                                key={preset.id}
                                className="kt-topic-card"
                                disabled={busy}
                                onClick={() => run(async () => start(
                                    await knowledgeApi("start", { presetId: preset.id })
                                ))}
                            >
                                <strong>{preset.name}</strong>
                                <span>{preset.topics.map(topicName).join(" • ")}</span>
                            </button>
                        ))}
                    </div>
                </section>
            )}

            {!home.actor.admin && (
                <section className="kt-card">
                    <h2>My assignments</h2>
                    {!home.assignments.length && <p className="kt-muted">No assignments yet.</p>}

                    {home.assignments.map(a => (
                        <article className="kt-assignment" key={a.id}>
                            <div>
                                <h3>{a.title}</h3>
                                <p>{a.topics.map(topicName).join(" • ")}</p>
                                <p>
                                    {a.compulsory ? "Compulsory" : "Optional"} · {assignmentStatus(a)}
                                    {" · "}{a.completed}/{a.target} on-time exercises
                                </p>
                                {!!a.late && <p>{a.late} late submission(s)</p>}
                                <p className="kt-muted">
                                    {hkTime(a.startsAt)} – {hkTime(a.dueAt)} HKT
                                </p>
                                <p className="kt-muted">Assigned by {a.creator}</p>
                            </div>
                            {!a.cancelled && (
                                <button
                                    disabled={busy || Date.now() < a.startsAt}
                                    onClick={() => run(async () => start(
                                        await knowledgeApi("start", { assignmentId: a.id })
                                    ))}
                                >
                                    {Date.now() > a.dueAt ? "Complete late work" : "Start assignment"}
                                </button>
                            )}
                        </article>
                    ))}
                </section>
            )}
        </>
    );
}

function Profile({ email, busy, run, onReport }) {
    const [profile, setProfile] = useState(null);
    const [history, setHistory] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [page, setPage] = useState(0);

    useEffect(() => {
        let active = true;

        run(async () => {
            const result = await knowledgeApi("profile", { email, page: 0 });
            if (!active) return;
            setProfile(result);
            setHistory(result.history.records);
            setCursor(result.history.next);
            setPage(0);
        });

        return () => { active = false; };
        // run is an action wrapper; reload only when the selected account changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [email]);

    if (!profile) return <section className="kt-card">Loading profile…</section>;

    const loadPage = next => run(async () => {
        const result = await knowledgeApi("profile", { email, page: next });
        setProfile(result);
        setPage(next);
    });

    return (
        <>
            <section className="kt-card">
                <p className="kt-eyebrow">Individual progress</p>
                <h2>{email}</h2>
                <Stats summary={profile.summary} />
            </section>

            <section className="kt-card">
                <h2>Exercise history</h2>
                <div className="kt-table-wrap">
                    <table>
                        <thead><tr><th>Exercise</th><th>Date</th><th>Result</th><th>Report</th></tr></thead>
                        <tbody>
                            {history.map(a => (
                                <tr key={a.id}>
                                    <td>{a.title}{a.preview ? " (preview)" : ""}</td>
                                    <td>{hkTime(a.submittedAt || a.createdAt)}</td>
                                    <td>{a.status === "submitted" ? `${a.correct}/${a.total}` : a.status}</td>
                                    <td>
                                        {a.status === "submitted" && (
                                            <button
                                                className="kt-secondary"
                                                disabled={busy}
                                                onClick={() => run(async () => onReport(
                                                    await knowledgeApi("attempt", { email, id: a.id })
                                                ))}
                                            >Open report</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!history.length && <p className="kt-muted">No exercises yet.</p>}

                {cursor && (
                    <button
                        className="kt-secondary"
                        disabled={busy}
                        onClick={() => run(async () => {
                            const result = await knowledgeApi("history", { email, cursor });
                            setHistory(old => [...old, ...result.records]);
                            setCursor(result.next);
                        })}
                    >Load older exercises</button>
                )}
            </section>

            <section className="kt-card">
                <h2>Mistake history</h2>
                <p className="kt-muted">
                    {profile.mistakeCount} question/event record(s) have previous mistakes.
                    An event record shows the exercise question in which that event
                    was last answered incorrectly. Several event records can refer
                    to the same question.
                </p>

                {profile.mistakes.map(p => (
                    <ReviewQuestion
                        key={p.id}
                        question={p.lastWrong.question}
                        submitted={p.lastWrong.submitted}
                        correct={!p.needsRevision}
                    >
                        <p>
                            <strong>{p.needsRevision ? `Recovery: ${p.streak || 0}/2` : "Resolved"}</strong>
                            {" · "}Incorrect {p.wrongCount} time(s)
                            {" · "}Last incorrect: {hkTime(p.lastWrongAt)}
                        </p>
                    </ReviewQuestion>
                ))}

                <div className="kt-row">
                    <button className="kt-secondary" disabled={busy || page === 0} onClick={() => loadPage(page - 1)}>
                        Previous mistakes
                    </button>
                    <span>Page {page + 1}</span>
                    <button
                        className="kt-secondary"
                        disabled={busy || (page + 1) * 25 >= profile.mistakeCount}
                        onClick={() => loadPage(page + 1)}
                    >Next mistakes</button>
                </div>
            </section>
        </>
    );
}

function defaultDate(offset = 0) {
    return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Hong_Kong",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date(Date.now() + offset * 86400000));
}

function AdminPanel({ home, busy, run, onProfile }) {
    const [overview, setOverview] = useState(null);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState([]);

    const load = async () => setOverview(await knowledgeApi("overview"));

    useEffect(() => {
        run(load);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!overview) return <section className="kt-card">Loading administrator overview…</section>;

    const visible = overview.students.filter(s =>
        `${s.name} ${s.email} ${s.className}`.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <>
            <section className="kt-card">
                <div className="kt-row kt-between">
                    <div>
                        <p className="kt-eyebrow">Administrator overview</p>
                        <h2>Student progress</h2>
                    </div>
                    <button className="kt-secondary" disabled={busy} onClick={() => run(load)}>Refresh</button>
                </div>

                {!home.actor.superadmin && (
                    <p className="kt-notice">
                        Only students in your current superadmin-assigned classes are shown.
                    </p>
                )}

                <label className="kt-field">
                    Search name, email or class
                    <input value={search} onChange={e => setSearch(e.target.value)} />
                </label>

                <div className="kt-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Select</th><th>Student</th><th>Class</th>
                                <th>Completed</th><th>Accuracy</th><th>Unresolved</th><th>Last activity</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map(s => (
                                <tr key={s.email}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            aria-label={`Select ${s.name}`}
                                            checked={selected.includes(s.email)}
                                            onChange={e => setSelected(old =>
                                                e.target.checked ? [...old, s.email] : old.filter(email => email !== s.email)
                                            )}
                                        />
                                    </td>
                                    <td>
                                        <button className="kt-link" onClick={() => onProfile(s.email)}>{s.name}</button>
                                        <small>{s.email}</small>
                                    </td>
                                    <td>{s.className || "—"}</td>
                                    <td>{s.summary.completed || 0}</td>
                                    <td>{accuracy(s.summary.totalCorrect, s.summary.totalAnswered)}</td>
                                    <td>{s.summary.unresolved || 0}</td>
                                    <td>{hkTime(s.summary.lastActivity)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {!visible.length && <p className="kt-muted">No matching students.</p>}

                <div className="kt-row kt-spaced">
                    <button
                        className="kt-secondary"
                        onClick={() => setSelected(visible.slice(0, 100).map(s => s.email))}
                    >Select visible students, up to 100</button>
                    <button className="kt-secondary" onClick={() => setSelected([])}>Clear selection</button>
                    <span>{selected.length} selected</span>
                </div>

                <details className="kt-details">
                    <summary>Topic-by-topic overview</summary>
                    <div className="kt-table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Student</th>
                                    {TOPICS.map(t => <th key={t.id}>{t.label}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map(s => (
                                    <tr key={s.email}>
                                        <td>{s.name}</td>
                                        {TOPICS.map(t => {
                                            const stat = s.summary.stats?.[t.id] || {};
                                            return (
                                                <td key={t.id}>
                                                    {stat.runs || 0} exercises
                                                    <small>{accuracy(stat.correct, stat.answered)} accuracy</small>
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            </section>

            <SchedulePlanner
                students={overview.students}
                presets={home.presets}
                busy={busy}
                run={run}
                onSaved={load}
            />

            <section className="kt-card">
                <h2>{home.actor.superadmin ? "All permitted assignments" : "Assignments I created"}</h2>
                <p className="kt-muted">
                    Assignments created through the new planner include scheduled emails.
                    Older assignments remain available but have no retroactive email schedule.
                </p>
                <div className="kt-table-wrap">
                    <table>
                        <thead>
                            <tr><th>Student / group</th><th>Progress</th><th>Deadline HKT</th><th>Status</th><th>Assigned by</th><th /></tr>
                        </thead>
                        <tbody>
                            {overview.assignments.map(a => (
                                <tr key={a.id}>
                                    <td>{a.email}<small>{a.title}</small></td>
                                    <td>{a.completed}/{a.target}<small>{a.late || 0} late</small></td>
                                    <td>{hkTime(a.dueAt)}</td>
                                    <td>{assignmentStatus(a)}<small>{a.compulsory ? "Compulsory" : "Optional"}</small></td>
                                    <td>{a.creator}</td>
                                    <td>
                                        {!a.cancelled && (
                                            <button
                                                className="kt-secondary"
                                                disabled={busy}
                                                onClick={() => {
                                                    if (!window.confirm("Cancel this assignment? Existing results will be retained.")) return;
                                                    run(async () => {
                                                        await knowledgeApi("cancelAssignment", { id: a.id });
                                                        await load();
                                                    });
                                                }}
                                            >Cancel</button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </>
    );
}

function Bank({ busy, run, refreshHome }) {
    const [bank, setBank] = useState({ rows: [], total: 0 });
    const [search, setSearch] = useState("");
    const [offset, setOffset] = useState(0);
    const [upload, setUpload] = useState(null);
    const [errors, setErrors] = useState([]);
    const [message, setMessage] = useState("");

    const load = async (nextOffset = offset, nextSearch = search) => {
        setBank(await knowledgeApi("bank", { offset: nextOffset, search: nextSearch, size: 30 }));
        setOffset(nextOffset);
    };

    useEffect(() => {
        run(() => load(0, ""));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const validate = async rows => {
        const found = [];
        for (let i = 0; i < rows.length; i += 75) {
            setMessage(`Validating ${Math.min(i + 75, rows.length)} / ${rows.length}…`);
            const result = await knowledgeApi("validate", { rows: rows.slice(i, i + 75) });
            found.push(...result.errors);
        }
        return found;
    };

    const deleteAllDemos = async () => {
        const confirmation = window.prompt(
            "Permanently delete ALL demo questions from the question bank?\n\n" +
            "This deletes records marked Demo = TRUE, including inactive demos.\n" +
            "Real questions and previous exercise reports will not be deleted.\n\n" +
            "Export the bank first if you want a backup.\n\n" +
            "Type DELETE DEMOS to continue."
        );

        if (confirmation !== "DELETE DEMOS") {
            setMessage("Demo deletion cancelled.");
            return;
        }

        // Discard any prepared upload so it cannot accidentally
        // re-import a previously prepared demonstration bank.
        setUpload(null);
        setErrors([]);

        let deleted = 0;

        try {
            while (true) {
                setMessage(
                    `Deleting demonstration questions… ${deleted} deletion(s) confirmed.`
                );

                const result = await knowledgeApi("deleteDemos", {
                    confirmation
                });

                deleted += result.deleted || 0;

                if (result.done) break;
            }

            setMessage(
                `Demo cleanup complete. ${deleted} question-bank record(s) deleted. ` +
                "Previous exercise reports and mistake-history snapshots were retained."
            );

            await load(0);
            await refreshHome();
        } catch (error) {
            setMessage(
                `${deleted} deletion(s) were confirmed before the interruption. ` +
                "You can safely press Delete all demo questions again to finish. " +
                "Some additional deletions may already have completed."
            );

            throw error;
        }
    };

    const importRows = async () => {
        if (!upload?.length) return;

        const rows = upload;
        let imported = 0;

        try {
            for (let i = 0; i < rows.length; i += 75) {
                const batch = rows.slice(i, i + 75);
                setMessage(`Importing ${imported} / ${rows.length}…`);
                await knowledgeApi("import", { rows: batch });
                imported += batch.length;
            }

            setUpload(null);
            const eventCount = rows.filter(row => row.type === "event").length;

            setMessage(
                `Imported ${imported} records: ` +
                `${imported - eventCount} questions and ${eventCount} Timeline events.`
            );
            await load(0);
            await refreshHome();
        } catch (error) {
            setMessage(
                `${imported} questions were confirmed saved before the interruption. ` +
                "You may retry the same import; stable IDs prevent duplicate questions."
            );
            throw error;
        }
    };

    const deletePreviousBatch = async () => {
        const entered = window.prompt(
            "Enter the exact batch prefix to delete.\n\n" +
            "Example: WW1-B01\n\n" +
            "This removes questions AND Timeline events whose IDs use " +
            "that batch prefix, including inactive records.\n\n" +
            "Other batches and saved exercise history will not be deleted."
        );

        if (entered === null) return;

        const prefix = entered.trim();

        if (!prefix) {
            setMessage("Batch deletion cancelled: no prefix entered.");
            return;
        }

        const confirmation = window.prompt(
            `Permanently delete question and event batch ${prefix}?\n\n` +
            "Export the bank first if you need a backup.\n" +
            "Deletion happens in batches and cannot be undone here.\n\n" +
            `Type DELETE ${prefix} to continue.`
        );

        if (confirmation !== `DELETE ${prefix}`) {
            setMessage("Batch deletion cancelled.");
            return;
        }

        setUpload(null);
        setErrors([]);

        let deleted = 0;

        try {
            while (true) {
                setMessage(
                    `Deleting ${prefix}… ${deleted} record removal(s) confirmed.`
                );

                const result = await knowledgeApi("deleteBatch", {
                    prefix,
                    confirmation
                });

                deleted += result.deleted || 0;

                if (result.done) break;
            }

            setMessage(
                deleted
                    ? `Deleted ${deleted} question/event records from ${prefix}. ` +
                    "Saved exercise reports and mistake history were retained."
                    : `No indexed records matched ${prefix}. ` +
                    "Check the IDs in the bank. If necessary, rebuild the bank index first."
            );

            await load(0);
            await refreshHome();
        } catch (error) {
            setMessage(
                `${deleted} record removal(s) were confirmed before the interruption. ` +
                "Some additional deletions may already have completed. " +
                `You can retry the same ${prefix} deletion to finish.`
            );

            throw error;
        }
    };

    const exportBank = async () => {
        let rows = [];
        let nextOffset = 0;

        while (true) {
            const result = await knowledgeApi("bank", { offset: nextOffset, size: 75 });
            rows.push(...result.rows);
            nextOffset += result.rows.length;

            if (nextOffset >= result.total || !result.rows.length) break;
        }

        await downloadWorkbook(rows, "knowledge-test-bank.xlsx");
    };

    return (
        <>
            <details className="kt-card kt-prompt-panel">
                <summary>
                    AI question authoring — click to expand or collapse
                </summary>

                <QuestionPrompt />
            </details>

            <section className="kt-card">
                <h2>Question bank</h2>
                <p className="kt-muted">
                    Edit questions and timeline events in Excel, then re-import using
                    the same IDs. MC, Blank and ordinary Matching supply foundation
                    questions. Timeline supplies individual events for both generated
                    chronology formats. Legacy Sequencing rows are retained but not
                    used in new exercises. Set Active to FALSE to deactivate a record.
                    Omitted records are not deleted.
                </p>

                <div className="kt-row">
                    <button
                        className="kt-secondary"
                        disabled={busy}
                        onClick={() => run(() => downloadWorkbook([], "knowledge-test-template.xlsx"))}
                    >Download empty template</button>

                    <button className="kt-secondary" disabled={busy} onClick={() => run(exportBank)}>
                        Export bank for editing
                    </button>

                    <button
                        className="kt-secondary"
                        disabled={busy}
                        onClick={() => run(async () => {
                            const result = await knowledgeApi("reindexBank");

                            setMessage(
                                `Indexed ${result.indexed} question/event records. ` +
                                `${result.legacySequences} legacy sequencing records ` +
                                "were retained but will not be selected for new exercises."
                            );

                            await load(0);
                            await refreshHome();
                        })}
                    >
                        Upgrade / rebuild bank index
                    </button>

                    <button
                        className="kt-danger"
                        disabled={busy}
                        onClick={() => run(deletePreviousBatch)}
                    >
                        Delete previous batch
                    </button>

                    <button
                        className="kt-danger"
                        disabled={busy}
                        onClick={() => run(deleteAllDemos)}
                    >
                        Delete all demo questions
                    </button>
                </div>

                <label className="kt-field kt-spaced">
                    Upload Excel workbook
                    <input
                        type="file"
                        accept=".xlsx"
                        disabled={busy}
                        onChange={event => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (!file) return;

                            run(async () => {
                                setUpload(null);
                                setErrors([]);
                                const parsed = await readWorkbook(file);

                                if (parsed.errors.length) {
                                    setErrors(parsed.errors);
                                    setMessage("Please fix the workbook errors.");
                                    return;
                                }

                                const found = await validate(parsed.questions);
                                setErrors(found);
                                setUpload(found.length ? null : parsed.questions);
                                setMessage(found.length
                                    ? "Please fix the workbook errors."
                                    : `${parsed.questions.length} valid question/event records ready for import.`);
                            });
                        }}
                    />
                </label>

                {message && <p className="kt-notice">{message}</p>}

                {!!errors.length && (
                    <div className="kt-error">
                        <strong>{errors.length} validation error(s)</strong>
                        <ul>{errors.slice(0, 100).map((error, i) => <li key={i}>{error}</li>)}</ul>
                    </div>
                )}

                {upload && (
                    <div className="kt-import-preview">
                        <h3>
                            Import preview — {upload.length} records:
                            {" "}{upload.filter(row => row.type !== "event").length} questions
                            {" · "}{upload.filter(row => row.type === "event").length} Timeline events
                        </h3>
                        <p className="kt-muted">
                            Showing the first 20. Imports are saved in batches, not as one workbook-wide transaction.
                        </p>
                        <div className="kt-table-wrap">
                            <table>
                                <thead><tr><th>ID</th><th>Topic</th><th>Type</th><th>Question</th></tr></thead>
                                <tbody>
                                    {upload.slice(0, 20).map(q => (
                                        <tr key={q.id}><td>{q.id}</td><td>{topicName(q.topic)}</td><td>{q.type}</td><td>{q.prompt}</td></tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <button disabled={busy} onClick={() => run(importRows)}>Confirm import</button>
                    </div>
                )}
            </section>

            <section className="kt-card">
                <form
                    className="kt-row"
                    onSubmit={event => {
                        event.preventDefault();
                        run(() => load(0));
                    }}
                >
                    <label className="kt-field kt-grow">
                        Search ID or opening question text
                        <input value={search} onChange={e => setSearch(e.target.value)} />
                    </label>
                    <button disabled={busy}>Search</button>
                </form>

                <p className="kt-muted">{bank.total} matching questions</p>

                <div className="kt-table-wrap">
                    <table>
                        <thead><tr><th>ID / Topic</th><th>Question</th><th>Type</th><th>Status</th><th /></tr></thead>
                        <tbody>
                            {bank.rows.map(q => (
                                <tr key={q.id}>
                                    <td>{q.id}<small>{topicName(q.topic)}</small></td>
                                    <td>{q.prompt}<small>{q.demo ? "DEMO" : q.subtopic}</small></td>
                                    <td>{q.type}</td>
                                    <td>{q.active ? "Active" : "Inactive"}</td>
                                    <td>
                                        <button
                                            className="kt-secondary"
                                            disabled={busy}
                                            onClick={() => run(async () => {
                                                await knowledgeApi("import", { rows: [{ ...q, active: !q.active }] });
                                                await load();
                                                await refreshHome();
                                            })}
                                        >{q.active ? "Deactivate" : "Activate"}</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="kt-row kt-spaced">
                    <button className="kt-secondary" disabled={busy || offset === 0} onClick={() => run(() => load(Math.max(0, offset - 30)))}>
                        Previous
                    </button>
                    <span>Page {Math.floor(offset / 30) + 1}</span>
                    <button className="kt-secondary" disabled={busy || offset + 30 >= bank.total} onClick={() => run(() => load(offset + 30))}>
                        Next
                    </button>
                </div>
            </section>
        </>
    );
}

export default function KnowledgeTest() {
    const { user, realUser, authLoading, loginWithGoogle } = useAuth();

    const [home, setHome] = useState(null);
    const [tab, setTab] = useState("practice");
    const [attempt, setAttempt] = useState(null);
    const [report, setReport] = useState(null);
    const [profileEmail, setProfileEmail] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const run = async job => {
        setBusy(true);
        setError("");
        try {
            return await job();
        } catch (err) {
            setError(err.message || "The request failed.");
            return null;
        } finally {
            setBusy(false);
        }
    };

    const refreshHome = async () => {
        const result = await knowledgeApi("home");
        setHome(result);
    };

    useEffect(() => {
        if (authLoading || !realUser?.isAuthorized || user?.isImpersonating) return;
        let active = true;

        setHome(null);

        run(async () => {
            const result = await knowledgeApi("home");
            if (active) setHome(result);
        });

        return () => { active = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, realUser?.email, realUser?.isAuthorized, user?.isImpersonating]);

    const start = result => {
        if (result.status === "submitted") setReport(result);
        else setAttempt(result);
    };

    const exit = async () => {
        setAttempt(null);
        await refreshHome();
    };

    const body = () => {
        if (authLoading) return <section className="kt-card">Checking access…</section>;

        if (!realUser) {
            return (
                <section className="kt-card">
                    <h2>Sign in to practise</h2>
                    <button
                        onClick={() => {
                            rememberKnowledgeLoginReturn();
                            loginWithGoogle();
                        }}
                    >
                        Sign in
                    </button>
                </section>
            );
        }

        if (!realUser.isAuthorized) {
            return <section className="kt-card">Your account does not have access to this feature.</section>;
        }

        if (report) {
            return (
                <Report
                    key={report.id}
                    attempt={report}
                    onBack={() => run(async () => {
                        setReport(null);
                        if (!user?.isImpersonating) await refreshHome();
                    })}
                />
            );
        }

        if (user?.isImpersonating) {
            return (
                <>
                    <p className="kt-notice">
                        Read-only student inspection. Exercise starts, submissions and administrator changes
                        are disabled while impersonating. Stop debugging to use administrator preview.
                    </p>
                    <Profile
                        key={user.email}
                        email={user.email}
                        busy={busy}
                        run={run}
                        onReport={setReport}
                    />
                </>
            );
        }

        if (attempt) {
            return (
                <FoundationRunner
                    key={attempt.id}
                    attempt={attempt}
                    busy={busy}
                    run={run}
                    onExit={exit}
                    onFinish={result => {
                        setAttempt(null);
                        setReport(result);
                    }}
                />
            );
        }

        if (!home) {
            return (
                <section className="kt-card">
                    {busy ? "Loading Knowledge Test…" : (
                        <button onClick={() => run(refreshHome)}>Retry loading</button>
                    )}
                </section>
            );
        }

        if (profileEmail) {
            return (
                <>
                    <button className="kt-secondary" onClick={() => setProfileEmail(null)}>← Back to overview</button>
                    <Profile email={profileEmail} busy={busy} run={run} onReport={setReport} />
                </>
            );
        }

        return (
            <>
                <div className="kt-tabs" aria-label="Knowledge Test sections">
                    <button className={tab === "practice" ? "active" : ""} onClick={() => setTab("practice")}>
                        {home.actor.admin ? "Preview & presets" : "Practice"}
                    </button>
                    <button className={tab === "progress" ? "active" : ""} onClick={() => setTab("progress")}>
                        {home.actor.admin ? "My preview history" : "My progress"}
                    </button>
                    {home.actor.admin && (
                        <>
                            <button className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}>Students & assignments</button>
                            <button className={tab === "bank" ? "active" : ""} onClick={() => setTab("bank")}>Question bank</button>
                        </>
                    )}
                </div>

                {tab === "practice" && (
                    <PracticeHome home={home} busy={busy} run={run} start={start} refresh={refreshHome} />
                )}

                {tab === "progress" && (
                    <Profile email={realUser.email} busy={busy} run={run} onReport={setReport} />
                )}

                {tab === "admin" && home.actor.admin && (
                    <AdminPanel home={home} busy={busy} run={run} onProfile={setProfileEmail} />
                )}

                {tab === "bank" && home.actor.admin && (
                    <Bank busy={busy} run={run} refreshHome={refreshHome} />
                )}
            </>
        );
    };

    return (
        <main className="kt">
            <header className="kt-page-header">
                <p className="kt-eyebrow">DSE-related · History</p>
                <h1>Knowledge Test</h1>
                <p>Build understanding. Revisit mistakes. Make steady progress.</p>
            </header>

            {error && <div className="kt-error" role="alert">{error}</div>}
            {busy && <div className="kt-working" role="status">Working…</div>}

            {body()}
        </main>
    );
}