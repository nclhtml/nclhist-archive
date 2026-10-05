import React, { useEffect, useRef, useState } from 'react';

import { archiveTool } from './archiveToolsClient.js';
import { getArchiveVersionLabel } from './archiveWriteSafety.js';

export default function ArchiveVersionSearchControl({
    familyId,
    archives,
    disabled,
    onChanged
}) {
    const [selection, setSelection] = useState('__auto__');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const lock = useRef(false);

    useEffect(() => {
        let active = true;

        setLoading(true);
        setMessage('');

        archiveTool({
            action: 'readVersionSearch',
            familyId
        })
            .then(result => {
                if (!active) return;

                setSelection(
                    result.setting.mode === 'only'
                        ? result.setting.versionId
                        : '__auto__'
                );
            })
            .catch(error => {
                if (active) setMessage(error.message);
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
        };
    }, [familyId]);

    const versions = [...new Map(
        archives
            .filter(item => item.versionFamilyId === familyId)
            .map(item => [item.versionId, item])
    ).values()].sort((a, b) =>
        Number(b.year) - Number(a.year) ||
        getArchiveVersionLabel(a).localeCompare(
            getArchiveVersionLabel(b),
            undefined,
            { numeric: true }
        )
    );

    const save = async () => {
        if (disabled || loading || lock.current) return;

        const chosen = selection === '__auto__'
            ? null
            : versions.find(item => item.versionId === selection);

        if (selection !== '__auto__' && !chosen) {
            setMessage('Select an existing saved version.');
            return;
        }

        if (!window.confirm(
            chosen
                ? `Make "${getArchiveVersionLabel(chosen)}" the only ` +
                  'version searchable by students in this family?\n\n' +
                  'Administrators retain every version.\n' +
                  'Existing assessment links are not changed.\n' +
                  'This does not grant additional document access.'
                : 'Use automatic newest-version selection for this family?\n\n' +
                  'Existing assessment links are not changed.'
        )) return;

        lock.current = true;
        setSaving(true);
        setMessage('');

        let saved = false;

        try {
            await archiveTool({
                action: 'saveVersionSearch',
                familyId,
                mode: chosen ? 'only' : 'auto',
                versionId: chosen?.versionId || ''
            });

            saved = true;
            await onChanged?.();

            setMessage(
                'Search preference saved. Students should refresh the archive. ' +
                'Existing assessment links were retained.'
            );
        } catch (error) {
            setMessage(
                (saved
                    ? 'The preference was saved, but refreshing failed.\n'
                    : 'The preference was not saved.\n') +
                error.message
            );
        } finally {
            lock.current = false;
            setSaving(false);
        }
    };

    return (
        <div className="rounded-lg border border-indigo-300 bg-white p-3 space-y-3">
            <h4 className="text-sm font-bold text-indigo-950">
                Student search visibility
            </h4>

            <p className="text-xs text-slate-600">
                Choose the only searchable version for this entire family.
                Administrators can still search all versions. An explicitly
                assigned older document remains available through its saved
                assessment link, not as a normal search result.
            </p>

            <select
                value={selection}
                disabled={disabled || loading || saving}
                onChange={event => setSelection(event.target.value)}
                className="w-full rounded-lg border border-indigo-200 bg-white p-2 text-sm"
            >
                <option value="__auto__">
                    Automatic — newest version
                </option>

                {versions.map(item => (
                    <option key={item.versionId} value={item.versionId}>
                        Only: {getArchiveVersionLabel(item)}
                    </option>
                ))}
            </select>

            <button
                type="button"
                disabled={disabled || loading || saving}
                onClick={save}
                className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
                {loading
                    ? 'Loading setting…'
                    : saving
                        ? 'Saving…'
                        : 'Save search visibility'}
            </button>

            {message && (
                <p role="status" className="whitespace-pre-wrap text-xs text-indigo-900">
                    {message}
                </p>
            )}
        </div>
    );
}