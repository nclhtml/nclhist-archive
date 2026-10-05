import React, { useEffect, useRef, useState } from 'react';
import {
    collection,
    getDocsFromServer
} from 'firebase/firestore';

import { db } from './firebase.js';

import {
    prepareArchiveWrite,
    commitArchiveWrite,
    getArchiveVersionLabel
} from './archiveWriteSafety.js';

function cleanTypes(value) {
    const values = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? [value]
            : [];

    return values.filter(item =>
        typeof item === 'string' && item.trim()
    );
}

async function readAllArchives() {
    const snapshot = await getDocsFromServer(
        collection(db, 'archives')
    );

    return snapshot.docs.map(document => ({
        ...document.data(),
        id: document.id
    }));
}

function downloadJson(value, filename) {
    const blob = new Blob([
        JSON.stringify(value, null, 2)
    ], { type: 'application/json' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Called only from the administrator's confirmed deletion action.
// Each chunk uses the existing archive-write guard and fingerprint checks.
export async function removeQuestionTypeEverywhere({
    paperType,
    tag,
    email,
    onProgress
}) {
    const records = await readAllArchives();

    const affected = records.filter(record =>
        record.paperType === paperType &&
        (record.subQuestions || []).some(question =>
            cleanTypes(question.questionType).includes(tag)
        )
    );

    if (!affected.length) {
        return { cancelled: false, changed: 0, records };
    }

    const affectedQuestionCount = affected.reduce(
        (total, record) => total +
            (record.subQuestions || []).filter(question =>
                cleanTypes(question.questionType).includes(tag)
            ).length,
        0
    );

    if (!window.confirm(
        `Permanently remove question-type label "${tag}"?\n\n` +
        `Paper: ${paperType}\n` +
        `Archive records: ${affected.length}\n` +
        `Questions containing this label: ${affectedQuestionCount}\n\n` +
        'Other labels and all question IDs will be retained.\n' +
        'A JSON backup will download before saving.\n\n' +
        'Questions left without labels will appear in the missing-label audit.\n\n' +
        'Large changes are saved in batches. If a later batch fails, ' +
        'earlier completed batches remain saved.'
    )) {
        return { cancelled: true, changed: 0, records };
    }

    downloadJson(
        {
            savedAt: new Date().toISOString(),
            operation: 'remove-question-type-label',
            paperType,
            tag,
            records: affected
        },
        `question-label-backup-${Date.now()}.json`
    );

    let completed = 0;

    try {
        // 50 originals + 50 entries stays within your safety helper's
        // 150 combined-record limit.
        for (let index = 0; index < affected.length; index += 50) {
            const originals = affected.slice(index, index + 50);

            const payloads = originals.map(original => {
                const { id, ...data } = original;

                return {
                    ...data,
                    subQuestions: (data.subQuestions || []).map(question => ({
                        ...question,
                        questionType: cleanTypes(
                            question.questionType
                        ).filter(value => value !== tag)
                    })),
                    updatedAt: new Date().toISOString(),
                    updatedBy: email
                };
            });

            const entries = originals.map((original, position) => ({
                id: original.id,
                data: payloads[position]
            }));

            const plan = await prepareArchiveWrite({
                originals,
                entries
            });

            await commitArchiveWrite(plan, payloads, email);

            completed += originals.length;
            onProgress?.(completed, affected.length);
        }

        return {
            cancelled: false,
            changed: completed,
            records: await readAllArchives()
        };
    } catch (error) {
        throw new Error(
            `Label deletion stopped after ${completed} of ` +
            `${affected.length} archive records were saved.\n\n` +
            error.message +
            '\n\nRefresh and scan the audit. Completed batches were not rolled back. ' +
            'Your downloaded JSON contains the original affected records.'
        );
    }
}

export default function ArchiveLabelAudit({
    allowed,
    disabled,
    onEdit,
    revision
}) {
    const [records, setRecords] = useState([]);
    const [scanned, setScanned] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const mounted = useRef(true);
    const scanning = useRef(false);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        // Mark an earlier scan stale after archive changes.
        setScanned(false);
        setRecords([]);
    }, [revision]);

    const scan = async () => {
        if (!allowed || disabled || scanning.current) return;

        scanning.current = true;
        setBusy(true);
        setError('');

        try {
            const next = await readAllArchives();

            if (mounted.current) {
                setRecords(next);
                setScanned(true);
            }
        } catch (problem) {
            if (mounted.current) setError(problem.message);
        } finally {
            scanning.current = false;
            if (mounted.current) setBusy(false);
        }
    };

    if (!allowed) return null;

    const rows = records.flatMap(parent =>
        (parent.subQuestions || [])
            .filter(child => cleanTypes(child.questionType).length === 0)
            .map(child => ({ parent, child }))
    );

    const queryText = search.trim().toLowerCase();

    const visible = rows.filter(({ parent, child }) =>
        !queryText ||
        [
            parent.title,
            parent.origin,
            parent.year,
            parent.id,
            child.id,
            child.label,
            child.content,
            child.contentChi,
            getArchiveVersionLabel(parent)
        ].join(' ').toLowerCase().includes(queryText)
    );

    return (
        <details className="mb-5 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
            <summary className="cursor-pointer font-bold text-amber-950">
                Temporary admin tool: find questions missing question-type labels
            </summary>

            <div className="mt-4 space-y-3">
                <p className="text-sm text-amber-900">
                    Scans all saved archive records, including older versions.
                    Normal search filters are ignored. Edit Parent opens the
                    existing safe editor; add labels and click Update Archive.
                </p>

                <button
                    type="button"
                    disabled={disabled || busy}
                    onClick={scan}
                    className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                    {busy ? 'Scanning…' : 'Scan / refresh all questions'}
                </button>

                {error && (
                    <p role="alert" className="whitespace-pre-wrap text-sm text-red-700">
                        {error}
                    </p>
                )}

                {scanned && (
                    <>
                        <p className="text-sm font-bold text-amber-950">
                            {rows.length} unlabeled questions found.
                        </p>

                        <input
                            type="search"
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            placeholder="Filter audit by title, year, version, ID or question text…"
                            className="w-full rounded-lg border border-amber-300 bg-white p-2 text-sm"
                        />

                        <div className="max-h-[32rem] space-y-3 overflow-auto">
                            {visible.map(({ parent, child }) => (
                                <article
                                    key={`${parent.id}:${child.id}`}
                                    className="rounded-lg border border-amber-200 bg-white p-3 text-left"
                                >
                                    <h3 className="font-bold text-slate-900">
                                        {parent.title} — Q{child.label}
                                    </h3>

                                    <p className="mt-1 text-xs text-slate-600">
                                        {parent.origin} • {parent.paperType}
                                        {' • '}
                                        {getArchiveVersionLabel(parent)}
                                        {parent.paperType === 'Paper 1 (DBQ)' &&
                                            ` • ${child.marks ?? '?'} marks`}
                                    </p>

                                    <p className="mt-1 break-all text-xs text-slate-500">
                                        Archive ID: {parent.id}
                                        {' | '}
                                        Question ID: {String(child.id)}
                                    </p>

                                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                                        {child.content || child.contentChi ||
                                            'No question text saved.'}
                                    </p>

                                    <button
                                        type="button"
                                        disabled={disabled || busy}
                                        onClick={event => onEdit(event, parent)}
                                        className="mt-3 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                                    >
                                        Edit Parent to restore labels
                                    </button>
                                </article>
                            ))}

                            {!visible.length && (
                                <p className="p-3 text-sm text-slate-600">
                                    No unlabeled questions match this audit filter.
                                </p>
                            )}
                        </div>
                    </>
                )}
            </div>
        </details>
    );
}