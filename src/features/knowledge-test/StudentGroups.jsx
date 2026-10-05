import React, { useEffect, useState } from "react";
import { knowledgeApi } from "./api.js";

export default function StudentGroups({
    selected,
    setSelected,
    busy,
    run
}) {
    const [groups, setGroups] = useState([]);
    const [groupId, setGroupId] = useState("");
    const [name, setName] = useState("");
    const [newId, setNewId] = useState(() => crypto.randomUUID());
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(true);

    const load = async () => {
        const result = await knowledgeApi("studentGroupList");
        setGroups(result);
        setLoading(false);
    };

    useEffect(() => {
        let active = true;

        knowledgeApi("studentGroupList")
            .then(result => {
                if (!active) return;
                setGroups(result);
                setLoading(false);
            })
            .catch(error => {
                if (!active) return;
                setMessage(error.message || "Could not load private groups.");
                setLoading(false);
            });

        return () => { active = false; };
    }, []);

    const current = groups.find(group => group.id === groupId);

    const save = async asNew => {
        if (!selected.length || selected.length > 100) {
            throw new Error("Select between 1 and 100 students first.");
        }

        if (!name.trim()) {
            throw new Error("Enter a group name.");
        }

        if (!asNew && current?.unavailableCount) {
            const confirmed = window.confirm(
                `${current.unavailableCount} saved member(s) are no longer in your permitted roster. ` +
                "Updating this group will replace its membership with the currently selected students. Continue?"
            );

            if (!confirmed) return;
        }

        const id = asNew ? newId : groupId;

        await knowledgeApi("studentGroupSave", {
            id,
            name: name.trim(),
            emails: [...selected]
        });

        if (asNew) setNewId(crypto.randomUUID());

        setGroupId(id);
        await load();
        setMessage("Private group saved to Firebase.");
    };

    return (
        <div className="kt-private-groups">
            <h3>My private student groups</h3>

            <p className="kt-muted">
                These are student-recipient groups, not topic presets.
                Only your account can access them through this application.
                Loading a group replaces the current student selection.
            </p>

            <label className="kt-field">
                Saved student group
                <select
                    value={groupId}
                    disabled={busy || loading}
                    onChange={event => {
                        const id = event.target.value;
                        const group = groups.find(item => item.id === id);

                        setGroupId(id);
                        setName(group?.name || "");

                        if (!group) {
                            setMessage(
                                "New-group mode. Select students below and enter a group name."
                            );
                            return;
                        }

                        setSelected([...group.emails]);

                        setMessage(
                            `Loaded ${group.emails.length} currently permitted student(s).` +
                            (
                                group.unavailableCount
                                    ? ` ${group.unavailableCount} unavailable member(s) were not selected.`
                                    : ""
                            )
                        );
                    }}
                >
                    <option value="">
                        {loading ? "Loading groups…" : "New group / choose a saved group"}
                    </option>

                    {groups.map(group => (
                        <option key={group.id} value={group.id}>
                            {group.name} — {group.emails.length} available students
                        </option>
                    ))}
                </select>
            </label>

            <label className="kt-field">
                Group name
                <input
                    value={name}
                    maxLength={100}
                    placeholder="For example: Form 5 revision group"
                    disabled={busy}
                    onChange={event => setName(event.target.value)}
                />
            </label>

            <div className="kt-row">
                <button
                    type="button"
                    className="kt-secondary"
                    disabled={
                        busy ||
                        loading ||
                        !name.trim() ||
                        !selected.length ||
                        selected.length > 100
                    }
                    onClick={() => run(() => save(true))}
                >
                    Save selected students as a new group
                </button>

                <button
                    type="button"
                    className="kt-secondary"
                    disabled={
                        busy ||
                        !current ||
                        !name.trim() ||
                        !selected.length ||
                        selected.length > 100
                    }
                    onClick={() => run(() => save(false))}
                >
                    Update this group from current selection
                </button>

                <button
                    type="button"
                    className="kt-danger"
                    disabled={busy || !current}
                    onClick={() => {
                        if (!window.confirm(
                            `Delete the private group "${current.name}"? ` +
                            "Assignments already created will not be changed."
                        )) return;

                        run(async () => {
                            await knowledgeApi("studentGroupDelete", {
                                id: current.id
                            });

                            setGroupId("");
                            setName("");
                            await load();
                            setMessage(
                                "Private group deleted. Existing assignments were not changed."
                            );
                        });
                    }}
                >
                    Delete group
                </button>

                <button
                    type="button"
                    className="kt-secondary"
                    disabled={busy}
                    onClick={() => run(load)}
                >
                    Refresh groups
                </button>
            </div>

            {message && (
                <p className="kt-notice kt-spaced" role="status">
                    {message}
                </p>
            )}
        </div>
    );
}