import React, {
    useCallback,
    useEffect,
    useRef,
    useState
} from 'react';

import { getFunctions, httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';

import { auth, db } from './firebase.js';
import { useAuth } from './main.jsx';
import { loadAccessibleArchives } from './archiveAccessClient.js';

import {
    createDesignatedArchive
} from './designatedArchiveFiles.js';

import {
    DesignatedQuickAdd,
    DesignatedDocumentLinker
} from './DesignatedItemTools.jsx';

import DesignatedCompactFiles from './DesignatedCompactFiles.jsx';

import {
    DesignatedLocalDetails
} from './DesignatedBrowserState.jsx';

import {
    DesignatedIncomingProvider,
    DesignatedCategoryControls,
    DesignatedCommonOrder,
    DesignatedClassColumns,
    DesignatedCommonDropTarget,
    DesignatedCategoryFrame,
    DesignatedBoundCopies
} from './DesignatedIncoming.jsx';

const request = httpsCallable(
    getFunctions(auth.app, 'us-central1'),
    'designatedAssessments',
    { timeout: 120000 }
);

const BUCKETS = {
    S4: [
        ['ut1', 'Before 1st UT'],
        ['exam1', 'Before 1st Exam'],
        ['ut2', 'Before 2nd UT'],
        ['exam2', 'Before 2nd Exam']
    ],
    S5: [
        ['ut1', 'Before 1st UT'],
        ['exam1', 'Before 1st Exam'],
        ['ut2', 'Before 2nd UT'],
        ['exam2', 'Before 2nd Exam']
    ],
    S6: [['all', 'S6 Assessments']]
};

function defaultTerms(name) {
    return name.includes('HIST EMI') || name.includes('HIST CMI')
        ? ['S4 Term 1', 'S4 Term 2', 'S5 Term 1', 'S5 Term 2', 'S6']
        : ['Term 1', 'Term 2'];
}

function newDraft(level, bucket = BUCKETS[level][0][0]) {
    return {
        id: crypto.randomUUID(),
        name: '',
        bucket,
        category: 'Assignments',
        archiveId: '',
        linkedDocId: '',
        addToMarks: true,
        order: Date.now()
    };
}

const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm';

const buttonClass =
    'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm ' +
    'font-bold text-slate-700 disabled:opacity-40';

export default function DesignatedAssessments() {
    const { user, impersonatedEmail } = useAuth();

    const allowed = Boolean(
        user?.isAuthorized &&
        user?.isAdmin &&
        !user?.isImpersonating &&
        !impersonatedEmail
    );

    const [data, setData] = useState(null);
    const [level, setLevel] = useState('S4');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [configDraft, setConfigDraft] = useState(null);
    const [draft, setDraft] = useState(null);
    const [search, setSearch] = useState('');
    const [showDocumentLinker, setShowDocumentLinker] = useState(false);

    useEffect(() => {
        const openReferenceLink = event => {
            if (!data?.owner) {
                window.alert(
                    'The shared reference link is controlled by the superadmin.\n\n' +
                    'To fix your class assessment, use its amber “No link · Add” button.'
                );
                return;
            }

            const item = data.items.find(
                value => value.id === event.detail?.itemId
            );

            if (!item) return;

            if (
                draft &&
                !window.confirm('Discard the current draft and link this reference?')
            ) return;

            setDraft({ ...item });
            setShowDocumentLinker(true);
        };

        window.addEventListener(
            'designated-link-reference',
            openReferenceLink
        );

        return () => {
            window.removeEventListener(
                'designated-link-reference',
                openReferenceLink
            );
        };
    }, [data, draft]);
    const [archives, setArchives] = useState([]);
    const [archiveError, setArchiveError] = useState('');
    const [archiveLoading, setArchiveLoading] = useState(false);

    const [paperType, setPaperType] = useState('Paper 1 (DBQ)');
    const [englishFile, setEnglishFile] = useState(null);
    const [chineseFile, setChineseFile] = useState(null);

    const lock = useRef(false);
    const loadSequence = useRef(0);

    const apply = useCallback(result => {
        setData(result);
        setLevel(result.level || 'S4');
        setConfigDraft(JSON.parse(JSON.stringify(result.config)));
    }, []);

    const load = useCallback(async requestedLevel => {
        if (!allowed || lock.current) return;

        const sequence = ++loadSequence.current;

        setBusy(true);
        setError('');

        try {
            const response = await request({
                action: 'load',
                level: requestedLevel
            });

            if (sequence !== loadSequence.current) return;

            apply(response.data);
        } catch (failure) {
            if (sequence === loadSequence.current) {
                setError(failure.message || 'Could not load the list.');
            }
        } finally {
            if (sequence === loadSequence.current) {
                setBusy(false);
            }
        }
    }, [allowed, apply]);

    useEffect(() => {
        load('S4');

        return () => {
            loadSequence.current++;
        };
    }, [load]);

    // Load once, on explicit refresh, or after this page uploads a PDF.
    // No polling, focus refresh or archive revision listener.
    useEffect(() => {
        if (!allowed) return;

        let cancelled = false;
        let sequence = 0;

        const refresh = async () => {
            const current = ++sequence;

            setArchiveLoading(true);
            setArchiveError('');

            try {
                const documents = await loadAccessibleArchives({
                    effectiveEmail: user.email
                });

                if (!cancelled && current === sequence) {
                    setArchives(documents);
                }
            } catch (failure) {
                if (!cancelled && current === sequence) {
                    setArchiveError(
                        failure.message || 'Could not load archive documents.'
                    );
                }
            } finally {
                if (!cancelled && current === sequence) {
                    setArchiveLoading(false);
                }
            }
        };

        refresh();

        window.addEventListener('designated-refresh-archives', refresh);
        window.addEventListener('designated-pdf-uploaded', refresh);

        return () => {
            cancelled = true;
            sequence++;

            window.removeEventListener(
                'designated-refresh-archives',
                refresh
            );

            window.removeEventListener(
                'designated-pdf-uploaded',
                refresh
            );
        };
    }, [allowed, user?.email]);

    const run = async (operation, onSuccess) => {
        if (lock.current) return false;

        lock.current = true;
        setBusy(true);
        setError('');
        setMessage('');

        try {
            const result = await operation();
            await onSuccess?.(result);
            return true;
        } catch (failure) {
            setError(
                (failure.message || 'The operation failed.') +
                '\n\nIf this was an upload, check the archive before creating it again.'
            );

            return false;
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };

    const addQuickItem = async (bucket, category, values) => {
        if (!data || busy || lock.current) return false;

        const id = crypto.randomUUID();

        return run(
            async () => {
                const response = await request({
                    action: 'saveItem',
                    level,
                    groupRevision: data.revision,
                    id,
                    item: {
                        name: values.name,
                        bucket,
                        category,
                        archiveId: '',
                        linkedDocId: '',
                        order: Date.now(),
                        ...(data.owner
                            ? { addToMarks: values.addToMarks }
                            : {})
                    }
                });

                return response.data;
            },
            result => {
                apply(result);

                setMessage(
                    `Item added. ${result.result.created} Marks copy/copies created. ` +
                    'You can link a document later.'
                );
            }
        );
    };

    const saveConfig = () => {
        if (!data?.owner || !configDraft) return;

        run(
            async () => {
                const response = await request({
                    action: 'saveConfig',
                    level,
                    groupRevision: data.revision,
                    config: configDraft
                });

                return response.data;
            },
            result => {
                apply(result);

                setMessage(
                    `Class settings saved. ` +
                    `${result.result.created} Marks item(s) created; ` +
                    `${result.result.updated} updated.`
                );
            }
        );
    };

    const saveItem = event => {
        event.preventDefault();

        if (!draft || !data) return;

        run(
            async () => {
                const item = {
                    name: draft.name,
                    bucket: draft.bucket,
                    category: draft.category,
                    archiveId: draft.archiveId,
                    linkedDocId: draft.linkedDocId,
                    order: Number(draft.order),
                    ...(data.owner
                        ? { addToMarks: draft.addToMarks }
                        : {})
                };

                const response = await request({
                    action: 'saveItem',
                    level,
                    groupRevision: data.revision,
                    id: draft.id,
                    item
                });

                return response.data;
            },
            result => {
                apply(result);
                setDraft(null);
                setEnglishFile(null);
                setChineseFile(null);

                setMessage(
                    `Item saved. ${result.result.created} Marks item(s) created; ` +
                    `${result.result.updated} updated. ` +
                    'Existing marks and marking settings were not replaced.'
                );
            }
        );
    };

    const removeItem = item => {
        if (!window.confirm(
            `Delete "${item.name}" from the designated list?\n\n` +
            'Associated Marks items without student data will be deleted.\n' +
            'Items containing student data will be retained and reported.\n' +
            'The archive document and its PDFs will NOT be deleted.'
        )) return;

        run(
            async () => {
                const response = await request({
                    action: 'deleteItem',
                    level,
                    groupRevision: data.revision,
                    id: item.id
                });

                return response.data;
            },
            result => {
                apply(result);

                if (draft?.id === item.id) setDraft(null);

                const retained = result.result.retained;

                const summary =
                    `Designated item deleted.\n` +
                    `Empty Marks items deleted: ${result.result.removed.length}\n` +
                    `Marks items retained: ${retained.length}` +
                    (retained.length
                        ? '\n\nRetained because student data exists:\n' +
                        retained.map(value =>
                            `${value.className} — ${value.name}\nID: ${value.id}`
                        ).join('\n\n') +
                        '\n\nA notification was added to the superadmin logs.'
                        : '');

                setMessage(summary);

                if (retained.length) window.alert(summary);
            }
        );
    };

    const uploadNewArchive = () => {
        if (!draft) return;

        run(
            () => createDesignatedArchive({
                title: draft.name,
                paperType,
                category: draft.category,
                englishFile,
                chineseFile,
                email: user.email
            }),
            archive => {
                setArchives(previous => [
                    archive,
                    ...previous.filter(value => value.id !== archive.id)
                ]);

                setDraft(previous => ({
                    ...previous,
                    archiveId: archive.id,
                    linkedDocId: archive.id
                }));

                setEnglishFile(null);
                setChineseFile(null);

                setMessage(
                    'Archive document uploaded and selected. ' +
                    'Click Save Item below to save the designated item and synchronize Marks.'
                );
            }
        );
    };

    // Missing-language PDFs/settings are edited through App.jsx.
    // The language action buttons open the exact linked archive record.

    const changeLevel = next => {
        if (
            draft &&
            !window.confirm('Discard the open item draft and change level?')
        ) return;

        setDraft(null);
        setMessage('');
        load(next);
    };

    const termsFor = name =>
        Array.isArray(data?.termMap?.[name])
            ? data.termMap[name]
            : defaultTerms(name);

    const selectClass = (name, checked) => {
        setConfigDraft(previous => {
            const selected = checked
                ? [...previous.classes, name]
                : previous.classes.filter(value => value !== name);

            if (selected.length > 2) return previous;

            const nextTerms = {};

            BUCKETS[level].forEach(([bucket]) => {
                nextTerms[bucket] = {};

                selected.forEach(className => {
                    nextTerms[bucket][className] =
                        previous.terms?.[bucket]?.[className] ||
                        termsFor(className)[0] ||
                        '';
                });
            });

            return {
                classes: selected,
                terms: nextTerms
            };
        });
    };

    const linkOptions = archives.flatMap(parent => [
        {
            id: parent.id,
            archiveId: parent.id,
            label: `${parent.title} — ${parent.versionLabel || parent.year || ''} — whole record`
        },
        ...(parent.subQuestions || []).map(child => ({
            id: `${parent.id}_${child.id}`,
            archiveId: parent.id,
            label: `${parent.title} Q${child.label} — ${parent.versionLabel || parent.year || ''}`
        }))
    ]);

    const filteredOptions = linkOptions.filter(option =>
        option.id === draft?.linkedDocId ||
        !search.trim() ||
        option.label.toLowerCase().includes(search.toLowerCase().trim())
    );

    const languageButtons = item => (
        <DesignatedCompactFiles
            item={item}
            archives={archives}
            loading={archiveLoading}
            disabled={busy}
            uploadAllowed={Boolean(data?.levels?.includes(level))}
        />
    );

    if (!allowed) {
        return (
            <div className="mx-auto max-w-xl p-6 text-center text-slate-700">
                Administrator access is required. Exit Debug Mode before editing.
            </div>
        );
    }

    return (
        <DesignatedIncomingProvider
            data={data}
            archives={archives}
            onCommonChanged={() => load(level)}
        >
            <main
                className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-8"
                data-designated-readonly={data && !data.owner ? 'true' : 'false'}
            >
                <style>{`
        [data-designated-readonly="true"] .designated-edit-controls {
          display: none !important;
        }

        .designated-edit-controls {
          margin-top: 8px !important;
          gap: 4px !important;
        }

        .designated-edit-controls > button {
          min-height: 28px;
          padding: 4px 7px !important;
          font-size: 10px !important;
          line-height: 1.2;
          border-radius: 5px !important;
        }

        .designated-edit-controls > button:first-child {
          font-size: 0 !important;
        }

        .designated-edit-controls > button:first-child::after {
          content: '✎ Settings';
          font-size: 10px;
        }

        .designated-edit-controls > button:nth-child(2) {
          font-size: 0 !important;
        }

        .designated-edit-controls > button:nth-child(2)::after {
          content: '↗ Document';
          font-size: 10px;
        }

        .designated-edit-controls > button:last-child {
          font-size: 0 !important;
        }

        .designated-edit-controls > button:last-child::after {
          content: '× Delete';
          font-size: 10px;
        }
      `}</style>
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">
                            Designated Assessment
                        </h1>

                        <p className="mt-1 text-sm text-slate-600">
                            Shared assessment lists → independent class Marks items.
                        </p>
                    </div>

                    <button
                        type="button"
                        disabled={busy}
                        className={buttonClass}
                        onClick={() => {
                            if (
                                draft &&
                                !window.confirm('Discard the open draft and reload?')
                            ) return;

                            setDraft(null);

                            window.dispatchEvent(
                                new Event('designated-refresh-archives')
                            );

                            load(level);
                        }}
                    >
                        Reload list
                    </button>
                </header>

                {busy && (
                    <p role="status" className="rounded-lg bg-blue-50 p-3 text-blue-700">
                        Working—please keep this page open.
                    </p>
                )}

                {error && (
                    <p
                        role="alert"
                        className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
                    >
                        {error}
                    </p>
                )}

                {message && (
                    <p
                        role="status"
                        className="whitespace-pre-wrap rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800"
                    >
                        {message}
                    </p>
                )}

                {archiveError && (
                    <p role="alert" className="text-sm text-red-700">
                        Archive catalogue: {archiveError}
                    </p>
                )}

                {data?.levels?.length === 0 && (
                    <div className="rounded-xl border bg-white p-6 text-slate-600">
                        No designated list is assigned to a class you manage.
                        Ask the superadmin to configure the class assignments first.
                    </div>
                )}

                {showDocumentLinker && draft && data?.owner && (
                    <DesignatedDocumentLinker
                        archives={archives}
                        loading={archiveLoading}
                        error={archiveError}
                        selectedId={draft.linkedDocId}
                        onClose={() => setShowDocumentLinker(false)}
                        onSelect={selection => {
                            setDraft(previous => ({
                                ...previous,
                                ...selection
                            }));

                            setShowDocumentLinker(false);

                            setMessage(
                                'Document selected. Click Save Item to save the link and ' +
                                'synchronize it to Marks where Add to Marks is ON.'
                            );

                            window.requestAnimationFrame(() => {
                                document
                                    .getElementById('designated-item-editor')
                                    ?.scrollIntoView({
                                        behavior: 'smooth',
                                        block: 'start'
                                    });
                            });
                        }}
                    />
                )}

                {data?.levels?.length > 0 && (
                    <>
                        <nav className="flex gap-2" aria-label="Assessment level">
                            {data.levels.map(value => (
                                <button
                                    key={value}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => changeLevel(value)}
                                    className={`rounded-lg border px-5 py-2 font-bold ${level === value
                                        ? 'border-blue-600 bg-blue-600 text-white'
                                        : 'border-slate-300 bg-white text-slate-600'
                                        }`}
                                >
                                    {value}
                                </button>
                            ))}
                        </nav>

                        <DesignatedLocalDetails
                            key={`settings:${level}`}
                            identity={`class-settings:${level}`}
                            title={
                                'Classes / terms · ' +
                                data.config.classes
                                    .map(name => name.replace(/\u200B/g, ''))
                                    .join(' + ')
                            }
                            className="rounded-lg border border-indigo-200 bg-indigo-50 p-3"
                        >
                            <h2 className="text-xs font-bold text-indigo-950">
                                Assigned classes
                                {!data.owner && ' — superadmin-controlled'}
                            </h2>

                            {data.owner ? (
                                <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                                    {data.classes.map(info => (
                                        <label
                                            key={info.name}
                                            className="flex items-center gap-2 rounded border bg-white p-2 text-xs"
                                        >
                                            <input
                                                type="checkbox"
                                                disabled={busy}
                                                checked={configDraft?.classes.includes(info.name)}
                                                onChange={event =>
                                                    selectClass(info.name, event.target.checked)
                                                }
                                            />

                                            <span>
                                                {info.name.replace(/\u200B/g, '')}
                                                {' — '}{info.owner}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-indigo-900">
                                    {data.config.classes
                                        .map(name => name.replace(/\u200B/g, ''))
                                        .join(' + ')}
                                </p>
                            )}

                            <p className="text-xs text-indigo-900">
                                At most two classes. Terms are assigned separately in each
                                category. Removing a class does not delete its existing Marks items.
                            </p>

                            {BUCKETS[level].map(([bucket, label]) => (
                                <div key={bucket} className="rounded-lg border border-indigo-200 bg-white p-3">
                                    <h3 className="mb-2 text-sm font-bold">{label}</h3>

                                    <div className="grid gap-3 md:grid-cols-2">
                                        {(configDraft?.classes || []).map(name => (
                                            <label key={name} className="text-xs font-bold text-slate-600">
                                                {name.replace(/\u200B/g, '')}

                                                <select
                                                    disabled={!data.owner || busy}
                                                    value={configDraft.terms?.[bucket]?.[name] || ''}
                                                    className={`${inputClass} mt-1`}
                                                    onChange={event => {
                                                        const term = event.target.value;

                                                        setConfigDraft(previous => ({
                                                            ...previous,
                                                            terms: {
                                                                ...previous.terms,
                                                                [bucket]: {
                                                                    ...previous.terms[bucket],
                                                                    [name]: term
                                                                }
                                                            }
                                                        }));
                                                    }}
                                                >
                                                    <option value="" disabled>Select term</option>

                                                    {termsFor(name).map(term => (
                                                        <option key={term} value={term}>{term}</option>
                                                    ))}
                                                </select>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {data.owner && (
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={saveConfig}
                                    className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                                >
                                    Save classes / terms and sync
                                </button>
                            )}
                        </DesignatedLocalDetails>

                        {draft && data.owner && (
                            <section
                                id="designated-item-editor"
                                style={{ scrollMarginTop: '140px' }}
                                className="space-y-4 rounded-xl border-2 border-blue-300 bg-white p-4"
                            >
                                <h2 className="text-lg font-bold text-slate-800">
                                    Assessment item
                                </h2>

                                <form onSubmit={saveItem} className="space-y-4">
                                    <label className="block text-sm font-bold">
                                        Common reference name
                                        <input
                                            required
                                            maxLength={160}
                                            disabled={busy}
                                            value={draft.name}
                                            onChange={event =>
                                                setDraft(previous => ({
                                                    ...previous,
                                                    name: event.target.value
                                                }))
                                            }
                                            className={`${inputClass} mt-1`}
                                        />

                                        <span className="mt-2 block text-xs font-normal text-slate-500">
                                            Used as the initial name for newly created Marks copies.
                                            Class owners can rename their assessment in Marks.
                                            Later changes here do not replace those class names.
                                            Attaching an existing record always keeps its existing name.
                                        </span>
                                    </label>

                                    <div className="grid gap-3 md:grid-cols-3">
                                        <label className="text-sm font-bold">
                                            Category
                                            <select
                                                disabled={busy}
                                                value={draft.bucket}
                                                className={`${inputClass} mt-1`}
                                                onChange={event =>
                                                    setDraft(previous => ({
                                                        ...previous,
                                                        bucket: event.target.value
                                                    }))
                                                }
                                            >
                                                {BUCKETS[level].map(([value, label]) => (
                                                    <option key={value} value={value}>{label}</option>
                                                ))}
                                            </select>
                                        </label>

                                        <label className="text-sm font-bold">
                                            Column
                                            <select
                                                disabled={busy}
                                                value={draft.category}
                                                className={`${inputClass} mt-1`}
                                                onChange={event =>
                                                    setDraft(previous => ({
                                                        ...previous,
                                                        category: event.target.value
                                                    }))
                                                }
                                            >
                                                <option value="Assignments">Assignment</option>
                                                <option value="Quizzes">Quiz</option>
                                            </select>
                                        </label>

                                        <label className="text-sm font-bold">
                                            List order — smaller first
                                            <input
                                                type="number"
                                                required
                                                disabled={busy}
                                                value={draft.order}
                                                className={`${inputClass} mt-1`}
                                                onChange={event =>
                                                    setDraft(previous => ({
                                                        ...previous,
                                                        order: event.target.value
                                                    }))
                                                }
                                            />
                                        </label>
                                    </div>

                                    {data.owner ? (
                                        <label className="flex items-start gap-2 rounded-lg bg-indigo-50 p-3 text-sm">
                                            <input
                                                type="checkbox"
                                                disabled={busy}
                                                checked={draft.addToMarks}
                                                className="mt-1"
                                                onChange={event =>
                                                    setDraft(previous => ({
                                                        ...previous,
                                                        addToMarks: event.target.checked
                                                    }))
                                                }
                                            />

                                            <span>
                                                <strong>Add to Marks</strong>
                                                <br />
                                                OFF keeps existing copies but stops synchronization.
                                            </span>
                                        </label>
                                    ) : (
                                        <p className="text-xs text-slate-600">
                                            Add to Marks: {draft.addToMarks ? 'ON' : 'OFF'}.
                                            Only the superadmin can change this setting.
                                        </p>
                                    )}

                                    <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
                                        <h3 className="text-sm font-bold">
                                            Linked document — optional
                                        </h3>

                                        <p className="text-xs text-slate-500">
                                            This item can be saved with only its name.
                                            Link a document whenever it is ready.
                                        </p>

                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => setShowDocumentLinker(true)}
                                                className={buttonClass}
                                            >
                                                {draft.linkedDocId
                                                    ? 'Change linked document'
                                                    : 'Search / link document'}
                                            </button>

                                            {draft.linkedDocId && (
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700"
                                                    onClick={() =>
                                                        setDraft(previous => ({
                                                            ...previous,
                                                            archiveId: '',
                                                            linkedDocId: ''
                                                        }))
                                                    }
                                                >
                                                    Remove document link
                                                </button>
                                            )}
                                        </div>

                                        {languageButtons(draft)}
                                    </div>

                                    <details className="rounded-lg border bg-amber-50 p-3">
                                        <summary className="cursor-pointer text-sm font-bold text-amber-900">
                                            Or upload a NEW question-set document
                                        </summary>

                                        <div className="mt-3 space-y-3">
                                            <p className="text-xs text-amber-900">
                                                Uses the item name above as the archive title.
                                                Upload each language as its own whole question-set PDF.
                                                Maximum 8 MiB per PDF.
                                            </p>

                                            <select
                                                disabled={busy}
                                                value={paperType}
                                                onChange={event => setPaperType(event.target.value)}
                                                className={inputClass}
                                            >
                                                <option value="Paper 1 (DBQ)">Paper 1 (DBQ)</option>
                                                <option value="Paper 2 (Essay)">Paper 2 (Essay)</option>
                                            </select>

                                            <label className="block text-xs font-bold">
                                                English PDF
                                                <input
                                                    type="file"
                                                    accept=".pdf,application/pdf"
                                                    disabled={busy}
                                                    className="mt-1 block w-full"
                                                    onChange={event =>
                                                        setEnglishFile(event.target.files?.[0] || null)
                                                    }
                                                />
                                            </label>

                                            <label className="block text-xs font-bold">
                                                Chinese PDF
                                                <input
                                                    type="file"
                                                    accept=".pdf,application/pdf"
                                                    disabled={busy}
                                                    className="mt-1 block w-full"
                                                    onChange={event =>
                                                        setChineseFile(event.target.files?.[0] || null)
                                                    }
                                                />
                                            </label>

                                            <button
                                                type="button"
                                                disabled={
                                                    busy ||
                                                    !draft.name.trim() ||
                                                    (!englishFile && !chineseFile)
                                                }
                                                onClick={uploadNewArchive}
                                                className={buttonClass}
                                            >
                                                Upload new archive and select it
                                            </button>
                                        </div>
                                    </details>

                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="submit"
                                            disabled={busy || !draft.name.trim()}
                                            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                                        >
                                            Save Item
                                        </button>

                                        <button
                                            type="button"
                                            disabled={busy}
                                            className={buttonClass}
                                            onClick={() => {
                                                setDraft(null);
                                                setEnglishFile(null);
                                                setChineseFile(null);
                                            }}
                                        >
                                            Cancel draft
                                        </button>
                                    </div>
                                </form>
                            </section>
                        )}

                        {BUCKETS[level].map(([bucket, label]) => (
                            <DesignatedCategoryFrame
                                key={`${level}:${bucket}`}
                                bucket={bucket}
                                label={label}
                            >
                                <div className="grid gap-4 md:grid-cols-2">
                                    {[
                                        ['Assignments', 'Assignment'],
                                        ['Quizzes', 'Quiz']
                                    ].map(([category, heading]) => {
                                        const items = data.items
                                            .filter(item =>
                                                item.bucket === bucket &&
                                                item.category === category
                                            )
                                            .sort((a, b) =>
                                                Number(a.order) - Number(b.order) ||
                                                a.name.localeCompare(b.name)
                                            );

                                        return (
                                            <div key={category} className="rounded-lg border bg-slate-50 p-3">
                                                <h3 className="mb-3 font-bold text-slate-700">
                                                    {heading}
                                                </h3>

                                                {data.owner && (
                                                    <DesignatedLocalDetails
                                                        key={`add:${level}:${bucket}:${category}`}
                                                        identity={`quick-add:${level}:${bucket}:${category}`}
                                                        title="+ Add common item"
                                                        className="mb-2 rounded border border-slate-200 bg-white p-2"
                                                    >
                                                        <DesignatedQuickAdd
                                                            busy={busy}
                                                            owner={true}
                                                            onAdd={values =>
                                                                addQuickItem(bucket, category, values)
                                                            }
                                                        />
                                                    </DesignatedLocalDetails>
                                                )}

                                                <div className="space-y-3">
                                                    {!items.length && (
                                                        <p className="text-sm text-slate-400">
                                                            No items yet.
                                                        </p>
                                                    )}

                                                    {items.map(item => (
                                                        <article key={item.id} className="rounded-lg border bg-white p-3">
                                                            <h4 className="font-bold text-slate-800">
                                                                {item.name}
                                                            </h4>

                                                            <p className="mt-1 text-xs text-slate-500">
                                                                {item.addToMarks
                                                                    ? 'Add to Marks ON'
                                                                    : 'Sync stopped'}
                                                            </p>

                                                            <DesignatedCommonOrder item={item} />

                                                            {languageButtons(item)}

                                                            <DesignatedBoundCopies item={item} />

                                                            <DesignatedCommonDropTarget item={item} />

                                                            <div className="designated-edit-controls mt-3 flex flex-wrap gap-2">
                                                                <button
                                                                    type="button"
                                                                    disabled={busy || !data.owner}
                                                                    className={buttonClass}
                                                                    onClick={() => {
                                                                        if (!data.owner) return;

                                                                        if (
                                                                            draft &&
                                                                            !window.confirm('Discard the open draft?')
                                                                        ) return;

                                                                        setDraft({ ...item });
                                                                        setSearch('');
                                                                        setEnglishFile(null);
                                                                        setChineseFile(null);

                                                                        window.requestAnimationFrame(() => {
                                                                            document
                                                                                .getElementById('designated-item-editor')
                                                                                ?.scrollIntoView({
                                                                                    behavior: 'smooth',
                                                                                    block: 'start'
                                                                                });
                                                                        });
                                                                    }}
                                                                >
                                                                    Edit name / settings
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    disabled={busy}
                                                                    className={buttonClass}
                                                                    onClick={() => {
                                                                        if (
                                                                            draft &&
                                                                            !window.confirm('Discard the open draft?')
                                                                        ) return;

                                                                        setDraft({ ...item });
                                                                        setShowDocumentLinker(true);
                                                                    }}
                                                                >
                                                                    {item.linkedDocId
                                                                        ? 'Change document'
                                                                        : 'Link document'}
                                                                </button>

                                                                <button
                                                                    type="button"
                                                                    disabled={busy}
                                                                    onClick={() => removeItem(item)}
                                                                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-40"
                                                                >
                                                                    Delete safely
                                                                </button>
                                                            </div>
                                                        </article>
                                                    ))}
                                                </div>

                                                <DesignatedClassColumns
                                                    bucket={bucket}
                                                    category={category}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </DesignatedCategoryFrame>
                        ))}
                    </>
                )}
            </main>
        </DesignatedIncomingProvider>
    );
}