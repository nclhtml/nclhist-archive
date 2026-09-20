import React, { useEffect, useState } from "react";
import { knowledgeApi, TOPICS, hkTime } from "./api.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function toInput(ms) {
  return new Date(ms + 8 * HOUR).toISOString().slice(0, 16);
}

function fromInput(value) {
  return Date.parse(`${value}:00+08:00`);
}

function defaultRow(previous) {
  let startsAt;
  let dueAt;

  if (previous) {
    startsAt = fromInput(previous.starts) + 7 * DAY;
    dueAt = fromInput(previous.due) + 7 * DAY;
  } else {
    const today = toInput(Date.now()).slice(0, 10);
    startsAt = Date.parse(`${today}T00:00:00+08:00`);
    dueAt = startsAt + 7 * DAY - 60 * 1000;
  }

  const dueDate = toInput(dueAt).slice(0, 10);
  const reminderAt = Date.parse(`${dueDate}T09:00:00+08:00`);

  return {
    id: crypto.randomUUID(),
    topics: ["ww1"],
    presetId: "",
    target: 3,
    compulsory: true,
    starts: toInput(startsAt),
    reminder: toInput(reminderAt),
    due: toInput(dueAt)
  };
}

export default function SchedulePlanner({
  students,
  presets,
  busy,
  run,
  onSaved
}) {
  const [selected, setSelected] = useState([]);
  const [className, setClassName] = useState("");
  const [rows, setRows] = useState(() => [defaultRow()]);
  const [savedSchedules, setSavedSchedules] = useState([]);
  const [pendingPlan, setPendingPlan] = useState(null);
  const [message, setMessage] = useState("");

  const classes = [...new Set(
    students.flatMap(s => s.classNames || [])
  )].sort((a, b) => a.localeCompare(b));

  const visible = className
    ? students.filter(s => s.classNames?.includes(className))
    : students;

  const loadSchedules = async () => {
    setSavedSchedules(await knowledgeApi("scheduleList"));
  };

  useEffect(() => {
    run(loadSchedules);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (id, patch) => {
    setRows(old => old.map(row =>
      row.id === id ? { ...row, ...patch } : row
    ));
  };

  const savePlan = async () => {
    const payloads = pendingPlan || rows.map(row => {
      const startsAt = fromInput(row.starts);
      const reminderAt = fromInput(row.reminder);
      const dueAt = fromInput(row.due);

      if (
        !selected.length ||
        selected.length > 100 ||
        !row.topics.length ||
        ![startsAt, reminderAt, dueAt].every(Number.isFinite) ||
        startsAt > reminderAt ||
        reminderAt >= dueAt ||
        row.reminder.slice(0, 10) !== row.due.slice(0, 10)
      ) {
        throw new Error(
          "Select 1–100 students and valid topics/dates. " +
          "Each reminder must be on its deadline date, after the start and before the deadline."
        );
      }

      return {
        id: row.id,
        emails: [...selected],
        topics: [...row.topics],
        presetId: row.presetId || null,
        target: row.target,
        compulsory: row.compulsory,
        startsAt,
        reminderAt,
        dueAt
      };
    });

    // Freeze the original request during partial-save retries.
    setPendingPlan(payloads);

    let confirmed = 0;

    try {
      for (const payload of payloads) {
        setMessage(`Saving schedule ${confirmed + 1} of ${payloads.length}…`);
        await knowledgeApi("schedule", payload);
        confirmed++;
      }

      setPendingPlan(null);
      setRows([defaultRow()]);
      setSelected([]);
      setMessage(`${confirmed} schedule(s) saved to Firebase.`);

      await loadSchedules();
      await onSaved();
    } catch (error) {
      setMessage(
        `${confirmed} schedule(s) confirmed saved. ` +
        "Use Retry remaining save to safely retry this same plan. " +
        "Already-saved rows will not be duplicated."
      );
      throw error;
    }
  };

  return (
    <>
      <section className="kt-card">
        <p className="kt-eyebrow">Scheduled work and email reminders</p>
        <h2>Plan assignments in advance</h2>

        <p className="kt-muted">
          All times are Hong Kong time. Each row has its own assignment,
          start notice, deadline-day reminder and post-deadline teacher report.
        </p>

        <fieldset
          disabled={busy || Boolean(pendingPlan)}
          style={{ border: 0, padding: 0, minWidth: 0 }}
        >
          <label className="kt-field">
            Class filter
            <select value={className} onChange={e => setClassName(e.target.value)}>
              <option value="">All permitted students</option>
              {classes.map((name, index) => (
                <option key={name} value={name}>
                  {name} — group {index + 1}
                </option>
              ))}
            </select>
          </label>

          <div className="kt-row">
            <button
              type="button"
              className="kt-secondary"
              onClick={() => {
                if (visible.length > 100) {
                  window.alert(
                    "This selection exceeds 100 students. Schedule smaller groups separately."
                  );
                  return;
                }
                setSelected(visible.map(s => s.email));
              }}
            >
              Select all students shown
            </button>

            <button
              type="button"
              className="kt-secondary"
              onClick={() => setSelected([])}
            >
              Clear selection
            </button>

            <span>{selected.length} selected</span>
          </div>

          <div
            style={{
              maxHeight: 230,
              overflowY: "auto",
              margin: "16px 0",
              padding: 12,
              border: "1px solid #dce5eb",
              borderRadius: 10
            }}
          >
            {visible.map(student => (
              <label className="kt-check" key={student.email}>
                <input
                  type="checkbox"
                  checked={selected.includes(student.email)}
                  onChange={e => setSelected(old =>
                    e.target.checked
                      ? [...old, student.email]
                      : old.filter(email => email !== student.email)
                  )}
                />
                {student.name} — {student.className || "No class"} — {student.email}
              </label>
            ))}
          </div>

          {rows.map((row, index) => (
            <div className="kt-review" key={row.id}>
              <div className="kt-row kt-between">
                <h3>Assignment {index + 1}</h3>

                {rows.length > 1 && (
                  <button
                    type="button"
                    className="kt-secondary"
                    onClick={() =>
                      setRows(old => old.filter(item => item.id !== row.id))
                    }
                  >
                    Remove row
                  </button>
                )}
              </div>

              <label className="kt-field">
                Saved practice group
                <select
                  value={row.presetId}
                  onChange={e => {
                    const preset = presets.find(p => p.id === e.target.value);

                    updateRow(row.id, {
                      presetId: preset?.id || "",
                      topics: preset ? [...preset.topics] : [...row.topics]
                    });
                  }}
                >
                  <option value="">Choose topics directly</option>
                  {presets.map(preset => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>

              {!row.presetId && (
                <div className="kt-row">
                  {TOPICS.map(topic => (
                    <label className="kt-check" key={topic.id}>
                      <input
                        type="checkbox"
                        checked={row.topics.includes(topic.id)}
                        onChange={e => updateRow(row.id, {
                          topics: e.target.checked
                            ? [...row.topics, topic.id]
                            : row.topics.filter(id => id !== topic.id)
                        })}
                      />
                      {topic.label}
                    </label>
                  ))}
                </div>
              )}

              <div className="kt-form-grid">
                <label className="kt-field">
                  Starts — HKT
                  <input
                    type="datetime-local"
                    value={row.starts}
                    onChange={e => updateRow(row.id, { starts: e.target.value })}
                  />
                </label>

                <label className="kt-field">
                  Deadline-day reminder — HKT
                  <input
                    type="datetime-local"
                    value={row.reminder}
                    onChange={e => updateRow(row.id, { reminder: e.target.value })}
                  />
                </label>

                <label className="kt-field">
                  Deadline — HKT
                  <input
                    type="datetime-local"
                    value={row.due}
                    onChange={e => updateRow(row.id, { due: e.target.value })}
                  />
                </label>
              </div>

              <label className="kt-field">
                Required 20-question exercises
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={row.target}
                  onChange={e =>
                    updateRow(row.id, { target: Number(e.target.value) })
                  }
                />
              </label>

              <label className="kt-check">
                <input
                  type="checkbox"
                  checked={row.compulsory}
                  onChange={e =>
                    updateRow(row.id, { compulsory: e.target.checked })
                  }
                />
                Compulsory
              </label>
            </div>
          ))}

          <button
            type="button"
            className="kt-secondary"
            disabled={rows.length >= 12}
            onClick={() =>
              setRows(old => [...old, defaultRow(old[old.length - 1])])
            }
          >
            Add another week / assignment
          </button>
        </fieldset>

        <div className="kt-row kt-spaced">
          <button
            disabled={busy || (!pendingPlan && !selected.length)}
            onClick={() => run(savePlan)}
          >
            {pendingPlan ? "Retry remaining save" : "Save schedules to Firebase"}
          </button>

          {pendingPlan && (
            <button
              className="kt-secondary"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(
                  "Already-saved schedules will remain active. " +
                  "Stop retrying and review them below?"
                )) return;

                setPendingPlan(null);
                setRows([defaultRow()]);
                setSelected([]);

                run(async () => {
                  await loadSchedules();
                  await onSaved();
                });
              }}
            >
              Stop retrying and review saved rows
            </button>
          )}
        </div>

        {message && <p className="kt-notice kt-spaced" role="status">{message}</p>}
      </section>

      <section className="kt-card">
        <div className="kt-row kt-between">
          <h2>Saved email schedules</h2>
          <button
            className="kt-secondary"
            disabled={busy}
            onClick={() => run(loadSchedules)}
          >
            Refresh
          </button>
        </div>

        <p className="kt-muted">
          “Queued” means handed to the email extension, not confirmed inbox delivery.
          Cancellation cannot recall messages already queued or sent.
        </p>

        <div className="kt-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Assignment</th>
                <th>Students / target</th>
                <th>Times — HKT</th>
                <th>Email processing</th>
                <th />
              </tr>
            </thead>

            <tbody>
              {savedSchedules.map(s => (
                <tr key={s.id}>
                  <td>
                    {s.title}
                    <small>{s.creator}</small>
                    {s.cancelled && <small>Cancelled</small>}
                  </td>

                  <td>
                    {s.recipientCount} students
                    <small>{s.target} exercises each</small>
                  </td>

                  <td>
                    Start: {hkTime(s.startsAt)}
                    <small>Reminder: {hkTime(s.reminderAt)}</small>
                    <small>Deadline: {hkTime(s.dueAt)}</small>
                  </td>

                  <td>
                    {["start", "reminder", "report"].map(stage => {
                      const status = s.notifications?.[stage];

                      return (
                        <small key={stage}>
                          {stage}: {status
                            ? `${status.status}; ${status.queued} queued`
                            : s.cancelled ? "Cancelled" : "Pending"}
                        </small>
                      );
                    })}
                  </td>

                  <td>
                    {!s.cancelled && (
                      <button
                        className="kt-secondary"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(
                            "Cancel this schedule and its student assignments?"
                          )) return;

                          run(async () => {
                            await knowledgeApi("cancelSchedule", { id: s.id });
                            await loadSchedules();
                            await onSaved();
                          });
                        }}
                      >
                        Cancel schedule
                      </button>
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