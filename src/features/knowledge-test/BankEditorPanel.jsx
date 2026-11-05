import React, { useEffect, useRef, useState } from "react";
import { knowledgeApi, TOPICS, topicName } from "./api.js";

export function BankRecordContent({ record }) {
    const answer = value => {
        if (value.type === "event") return String(value.year);

        if (value.type === "mc") {
            return value.choices?.[record.answer] || "—";
        }

        if (value.type === "blank") {
            return (value.answer || []).join(" / ");
        }

        if (value.type === "sequence") {
            return (record.answer || [])
                .map(index => value.items?.[index])
                .join(" → ");
        }

        return (value.left || []).map((left, index) =>
            `${left} → ${value.right?.[record.answer?.[index]] || "—"}`
        ).join("; ");
    };

    const versions = [
        ["English", record],
        ...(record.zh ? [
            ["中文", { ...record, ...record.zh }]
        ] : [])
    ];

    return (
        <div>
            <p className="kt-muted">
                {record.id} · {topicName(record.topic)} · {record.type}
            </p>

            {record.reportHold && (
                <p className="kt-notice">
                    Still held: another unresolved report may remain.
                </p>
            )}

            {versions.map(([label, value]) => (
                <section className="kt-review" key={label}>
                    <strong>{label} — {value.subtopic}</strong>
                    <h3>{value.prompt}</h3>

                    {(value.choices || value.items || []).map((item, index) => (
                        <p key={index}>{index + 1}. {item}</p>
                    ))}

                    {value.type === "matching" && (
                        <>
                            <p>Left: {(value.left || []).join(" / ")}</p>
                            <p>Right: {(value.right || []).join(" / ")}</p>
                        </>
                    )}

                    <p><strong>Answer: </strong>{answer(value)}</p>
                    <p className="kt-explanation">{value.explanation}</p>
                </section>
            ))}
        </div>
    );
}

function RecordEditor({ loaded, readOnly, onClose, onSaved }) {
    const [draft, setDraft] = useState(() =>
        JSON.parse(JSON.stringify(loaded.record))
    );
    const [hasChinese, setHasChinese] = useState(Boolean(draft.zh));
    const [answerOrder, setAnswerOrder] = useState(
        Array.isArray(draft.answer) && draft.type !== "blank"
            ? draft.answer.map(index => index + 1).join(", ")
            : ""
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const pending = useRef(null);
    const lock = useRef(false);

    const recognition = draft.topic === "question-type";

    const update = (field, value, chinese = false) => {
        if (pending.current) return;

        setDraft(previous => chinese
            ? {
                ...previous,
                zh: { ...(previous.zh || {}), [field]: value }
            }
            : { ...previous, [field]: value }
        );
    };

    const save = async () => {
        if (lock.current || readOnly) return;

        lock.current = true;
        setSaving(true);
        setError("");

        try {
            if (!pending.current) {
                const record = JSON.parse(JSON.stringify(draft));

                if (!hasChinese) delete record.zh;

                if (["matching", "sequence"].includes(record.type)) {
                    record.answer = answerOrder
                        .split(",")
                        .map(value => Number(value.trim()) - 1);
                }

                pending.current = {
                    id: loaded.record.id,
                    expectedVersion: loaded.version,
                    requestId: crypto.randomUUID(),
                    record
                };
            }

            await knowledgeApi("bankSave", pending.current);
            pending.current = null;
            await onSaved();
            onClose();
        } catch (problem) {
            // Retain the exact request after an uncertain failure.
            setError(problem.message || "Save failed.");
        } finally {
            lock.current = false;
            setSaving(false);
        }
    };

    const frozen = readOnly || saving || Boolean(pending.current);

    const textField = (field, label, chinese = false, max = 2400) => (
        <label className="kt-field" key={field}>
            {label}
            <textarea
                className="kt-author-textarea"
                rows={field === "prompt" || field === "explanation" ? 4 : 2}
                maxLength={max}
                value={
                    chinese
                        ? draft.zh?.[field] || ""
                        : draft[field] || ""
                }
                onChange={event => update(field, event.target.value, chinese)}
            />
        </label>
    );

    const arrayField = (field, label, chinese = false) => {
        const value = chinese ? draft.zh?.[field] : draft[field];

        return (
            <label className="kt-field" key={field}>
                {label} — one item per line
                <textarea
                    className="kt-author-textarea"
                    rows={Math.max(3, value?.length || 3)}
                    disabled={recognition && field === "choices"}
                    value={(value || []).join("\n")}
                    onChange={event => update(
                        field,
                        event.target.value.split("\n"),
                        chinese
                    )}
                />
            </label>
        );
    };

    const languageFields = chinese => (
        <section className="kt-review">
            <h3>{chinese ? "Chinese version / 中文" : "English version"}</h3>

            {textField("subtopic", "Subtopic / category", chinese, 160)}
            {textField(
                "prompt",
                draft.type === "event" ? "Event name" : "Question",
                chinese,
                draft.type === "event" ? 400 : 1600
            )}
            {textField(
                "explanation",
                "Explanation / context",
                chinese,
                draft.type === "event" ? 1000 : 2400
            )}

            {draft.type === "mc" &&
                arrayField("choices", "Options", chinese)}

            {draft.type === "blank" &&
                arrayField("answer", "Accepted answers", chinese)}

            {draft.type === "matching" && (
                <>
                    {arrayField("left", "Left items", chinese)}
                    {arrayField("right", "Right options", chinese)}
                </>
            )}

            {draft.type === "sequence" &&
                arrayField("items", "Sequence items", chinese)}
        </section>
    );

    return (
        <section className="kt-card">
            <h2>Edit bank record</h2>

            <p className="kt-notice">
                ID: {draft.id}
                {"\n"}Topic: {topicName(draft.topic)}
                {"\n"}Type: {draft.type}
                {"\n"}The ID, topic and record type stay unchanged.
                Student progress and old submitted reports are retained.
                Saving does not release an issue-report hold.
            </p>

            {error && <p className="kt-error">{error}</p>}

            {pending.current && !saving && (
                <p className="kt-notice">
                    The save was not confirmed. Retry the same save, or close
                    and reopen this record before preparing different changes.
                </p>
            )}

            <fieldset disabled={frozen} className="kt-answer-fieldset">
                <label className="kt-check">
                    <input
                        type="checkbox"
                        checked={draft.active}
                        onChange={event => update("active", event.target.checked)}
                    />
                    Active
                </label>

                <label className="kt-check">
                    <input
                        type="checkbox"
                        checked={hasChinese}
                        onChange={event => setHasChinese(event.target.checked)}
                    />
                    Include a complete Chinese version
                </label>

                {languageFields(false)}
                {hasChinese && languageFields(true)}

                {draft.type === "mc" && (
                    <label className="kt-field">
                        Correct option — applies to both languages
                        <select
                            value={draft.answer}
                            onChange={event => update(
                                "answer",
                                Number(event.target.value)
                            )}
                        >
                            {(draft.choices || []).map((choice, index) => (
                                <option key={index} value={index}>
                                    {index + 1}. {choice}
                                </option>
                            ))}
                        </select>
                    </label>
                )}

                {["matching", "sequence"].includes(draft.type) && (
                    <label className="kt-field">
                        {draft.type === "matching"
                            ? "Correct right-option numbers for each left item"
                            : "Correct item order"}
                        <input
                            value={answerOrder}
                            placeholder="For example: 3, 1, 2"
                            onChange={event => setAnswerOrder(event.target.value)}
                        />
                        <span className="kt-muted">
                            Use 1-based numbers separated by English commas.
                            English and Chinese item positions must match.
                        </span>
                    </label>
                )}

                {draft.type === "event" && (
                    <>
                        <label className="kt-field">
                            Correct event year
                            <input
                                type="number"
                                min="1"
                                max="3000"
                                value={draft.year}
                                onChange={event => update(
                                    "year",
                                    Number(event.target.value)
                                )}
                            />
                        </label>

                        <label className="kt-check">
                            <input
                                type="checkbox"
                                checked={draft.allowOutsideCentury === true}
                                onChange={event => update(
                                    "allowOutsideCentury",
                                    event.target.checked
                                )}
                            />
                            Authorize a year outside 1901–2000
                        </label>
                    </>
                )}

                {recognition && (
                    <p className="kt-muted">
                        Essay-recognition options remain the fixed 11 labels.
                        You can edit its wording, explanation and correct type.
                    </p>
                )}
            </fieldset>

            <div className="kt-row">
                <button
                    type="button"
                    disabled={saving || readOnly}
                    onClick={save}
                >
                    {saving ? "Saving…" : pending.current ? "Retry save" : "Save changes"}
                </button>

                <button
                    type="button"
                    className="kt-secondary"
                    disabled={saving}
                    onClick={onClose}
                >
                    Close editor
                </button>
            </div>
        </section>
    );
}

export default function BankEditorPanel({
    busy,
    run,
    refreshHome,
    readOnly = false,
    initialId = ""
}) {
    const [filters, setFilters] = useState({
        search: "", topic: "", type: "", category: "", status: ""
    });
    const [results, setResults] = useState({
        rows: [], categories: [], total: 0
    });
    const [offset, setOffset] = useState(0);
    const [loaded, setLoaded] = useState(null);

    const load = async (nextOffset = 0) => {
        const result = await knowledgeApi("bankSearch", {
            ...filters,
            offset: nextOffset,
            size: 20
        });

        setResults(result);
        setOffset(nextOffset);
    };

    const open = async id => {
        setLoaded(await knowledgeApi("bankRecord", { id }));
    };

    useEffect(() => {
        run(async () => {
            await load(0);
            if (initialId) await open(initialId);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialId]);

    const setFilter = (key, value) => setFilters(previous => ({
        ...previous,
        [key]: value,
        ...(key === "topic" ? { category: "" } : {})
    }));

    return (
        <>
            <section className="kt-card">
                <h2>Search and edit bank questions</h2>

                <p className="kt-muted">
                    Search full English and Chinese wording, explanations,
                    options and categories. Multiple space-separated keywords
                    must all match somewhere in the record.
                </p>

                <form onSubmit={event => {
                    event.preventDefault();
                    run(() => load(0));
                }}>
                    <div className="kt-form-grid">
                        <label className="kt-field">
                            Keywords / ID
                            <input
                                value={filters.search}
                                onChange={event => setFilter(
                                    "search", event.target.value
                                )}
                            />
                        </label>

                        <label className="kt-field">
                            Topic
                            <select
                                value={filters.topic}
                                onChange={event => setFilter(
                                    "topic", event.target.value
                                )}
                            >
                                <option value="">All topics</option>
                                {TOPICS.map(topic => (
                                    <option key={topic.id} value={topic.id}>
                                        {topic.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="kt-field">
                            Type
                            <select
                                value={filters.type}
                                onChange={event => setFilter(
                                    "type", event.target.value
                                )}
                            >
                                <option value="">All types</option>
                                {["mc", "blank", "matching", "sequence", "event"]
                                    .map(type => (
                                        <option key={type} value={type}>{type}</option>
                                    ))}
                            </select>
                        </label>

                        <label className="kt-field">
                            Category / subtopic
                            <select
                                value={filters.category}
                                onChange={event => setFilter(
                                    "category", event.target.value
                                )}
                            >
                                <option value="">All categories</option>
                                {results.categories.map(category => (
                                    <option key={category} value={category}>
                                        {category}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="kt-field">
                            Status
                            <select
                                value={filters.status}
                                onChange={event => setFilter(
                                    "status", event.target.value
                                )}
                            >
                                <option value="">All statuses</option>
                                <option value="active">Active, not held</option>
                                <option value="held">Held for reports</option>
                                <option value="inactive">Inactive</option>
                            </select>
                        </label>
                    </div>

                    <button disabled={busy}>Search / apply filters</button>
                </form>

                <p className="kt-spaced">{results.total} matching records</p>

                <div className="kt-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>ID / category</th>
                                <th>Question / event</th>
                                <th>Status</th>
                                <th>Editor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.rows.map(record => (
                                <tr key={record.id}>
                                    <td>
                                        {record.id}
                                        <small>{record.subtopic}</small>
                                        <small>{record.zh?.subtopic}</small>
                                    </td>
                                    <td>
                                        {record.prompt}
                                        <small>{record.zh?.prompt}</small>
                                    </td>
                                    <td>
                                        {record.reportHold ? "HELD" :
                                            record.active ? "Active" : "Inactive"}
                                    </td>
                                    <td>
                                        <button
                                            type="button"
                                            className="kt-secondary"
                                            disabled={busy}
                                            onClick={() => run(() => open(record.id))}
                                        >
                                            {readOnly ? "Inspect" : "Edit"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="kt-row">
                    <button
                        type="button"
                        className="kt-secondary"
                        disabled={busy || offset === 0}
                        onClick={() => run(() => load(Math.max(0, offset - 20)))}
                    >
                        Previous
                    </button>

                    <span>Page {Math.floor(offset / 20) + 1}</span>

                    <button
                        type="button"
                        className="kt-secondary"
                        disabled={busy || offset + 20 >= results.total}
                        onClick={() => run(() => load(offset + 20))}
                    >
                        Next
                    </button>
                </div>
            </section>

            {loaded && (
                <RecordEditor
                    key={`${loaded.record.id}:${loaded.version}`}
                    loaded={loaded}
                    readOnly={readOnly}
                    onClose={() => setLoaded(null)}
                    onSaved={async () => {
                        await load(offset);
                        await refreshHome();
                    }}
                />
            )}
        </>
    );
}