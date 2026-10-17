import React, { useMemo, useState } from 'react';
import { auth } from './firebase.js';

import {
    downloadAppearanceDocx
} from './designatedWordExport.js';

const buttonClass =
    'rounded-lg border border-slate-300 bg-white px-3 py-2 ' +
    'text-xs font-bold text-slate-700 disabled:opacity-40';

function asArray(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
}

export function DesignatedQuickAdd({
    busy,
    owner,
    onAdd
}) {
    const [name, setName] = useState('');
    const [addToMarks, setAddToMarks] = useState(true);

    return (
        <form
            className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3"
            onSubmit={async event => {
                event.preventDefault();

                if (busy || !name.trim()) return;

                const saved = await onAdd({
                    name: name.trim(),
                    addToMarks
                });

                if (saved) {
                    setName('');
                    setAddToMarks(true);
                }
            }}
        >
            <label className="block text-xs font-bold text-slate-600">
                New item name
                <input
                    type="text"
                    required
                    maxLength={160}
                    disabled={busy}
                    value={name}
                    onChange={event => setName(event.target.value)}
                    placeholder="Enter a name; link a document later"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal"
                />
            </label>

            {owner ? (
                <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                        type="checkbox"
                        disabled={busy}
                        checked={addToMarks}
                        onChange={event => setAddToMarks(event.target.checked)}
                    />
                    Add to Marks
                </label>
            ) : (
                <p className="text-xs text-slate-500">
                    New items default to Add to Marks ON.
                    Only the superadmin can change this.
                </p>
            )}

            <button
                type="submit"
                disabled={busy || !name.trim()}
                className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
                + Add item
            </button>
        </form>
    );
}

async function downloadPdf(url, filename) {
    await downloadAppearanceDocx(url, filename);
}

export function DesignatedLanguageActions({
    item,
    archives,
    loading = false,
    disabled = false
}) {
    const [downloading, setDownloading] = useState('');
    const [error, setError] = useState('');

    if (!item.archiveId || !item.linkedDocId) {
        return (
            <p className="mt-2 text-xs text-slate-400">
                No document linked yet.
            </p>
        );
    }

    const archive = archives.find(
        value => value.id === item.archiveId
    );

    if (!archive) {
        return (
            <p className="mt-2 text-xs text-amber-700">
                {loading
                    ? 'Loading linked document...'
                    : 'Linked archive unavailable. Reload the catalogue before editing.'}
            </p>
        );
    }

    const child = (archive.subQuestions || []).find(
        value => `${archive.id}_${value.id}` === item.linkedDocId
    );

    return (
        <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-500 break-words">
                {archive.title}
                {child ? ` — Part ${child.label}` : ''}
            </p>

            <div className="grid grid-cols-2 gap-2">
                {[
                    ['zh', '中文', archive.fileUrlChi],
                    ['en', 'English', archive.fileUrl]
                ].map(([language, label, url]) => {
                    const editQuery = new URLSearchParams({
                        editArchiveId: archive.id,
                        editArchiveLanguage: language
                    });

                    return (
                        <div
                            key={language}
                            className="rounded-lg border border-slate-200 bg-slate-50 p-2"
                        >
                            <h5 className="mb-2 text-xs font-bold text-slate-700">
                                {label}
                            </h5>

                            {url ? (
                                <div className="flex flex-wrap gap-2">
                                    <a
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={buttonClass}
                                    >
                                        View
                                    </a>

                                    <button
                                        type="button"
                                        disabled={disabled || Boolean(downloading)}
                                        className={buttonClass}
                                        onClick={async () => {
                                            setDownloading(language);
                                            setError('');

                                            try {
                                                await downloadPdf(
                                                    url,
                                                    `${archive.title} ${language}`
                                                );
                                            } catch (failure) {
                                                setError(
                                                    failure.message || 'Could not download the PDF.'
                                                );
                                            } finally {
                                                setDownloading('');
                                            }
                                        }}
                                    >
                                        {downloading === language
                                            ? 'Converting...'
                                            : 'Download Word'}
                                    </button>
                                </div>
                            ) : (
                                <a
                                    href={`/?${editQuery.toString()}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-block rounded-lg border border-amber-300 bg-amber-50 px-2 py-2 text-xs font-bold text-amber-900"
                                >
                                    Edit question set — add {label}
                                </a>
                            )}
                        </div>
                    );
                })}
            </div>

            {child && (
                <p className="text-[11px] text-slate-500">
                    The link targets this question part.
                    PDF buttons open the parent question-set attachment.
                </p>
            )}

            {error && (
                <p role="alert" className="text-xs text-red-700">
                    {error}
                </p>
            )}
        </div>
    );
}

export function DesignatedDocumentLinker({
    archives,
    loading,
    error,
    selectedId,
    onSelect,
    onClose
}) {
    const [search, setSearch] = useState('');
    const [origin, setOrigin] = useState('');
    const [year, setYear] = useState('');
    const [mode, setMode] = useState('full');
    const [language, setLanguage] = useState('en');
    const [candidateId, setCandidateId] = useState(selectedId || '');

    const options = useMemo(() =>
        archives.flatMap(parent => [
            {
                id: parent.id,
                parent,
                child: null,
                mode: 'full',
                title: parent.title
            },
            ...(parent.subQuestions || []).map(child => ({
                id: `${parent.id}_${child.id}`,
                parent,
                child,
                mode: 'sub',
                title: `${parent.title} Q${child.label}`
            }))
        ]),
        [archives]);

    const candidate = options.find(
        value => value.id === candidateId
    );

    const visible = useMemo(() => {
        const terms = String(search || '')
            .split(/[,，]/)
            .map(value => value.trim().toLowerCase())
            .filter(Boolean);

        return options.filter(option => {
            if (option.mode !== mode) return false;
            if (origin && option.parent.origin !== origin) return false;
            if (year && String(option.parent.year) !== year) return false;

            const children = option.child
                ? [option.child]
                : option.parent.subQuestions || [];

            const text = [
                option.title,
                option.parent.year,
                option.parent.origin,
                option.parent.versionLabel,
                ...asArray(option.parent.topic),
                ...children.flatMap(child => [
                    child.content,
                    child.contentChi,
                    ...asArray(child.topic),
                    ...asArray(child.questionType),
                    ...asArray(child.sourceType)
                ])
            ]
                .filter(value => value !== null && value !== undefined)
                .join(' ')
                .toLowerCase();

            return !terms.length || terms.some(term =>
                text.includes(term) ||
                text.replace(/\s+/g, '').includes(term.replace(/\s+/g, ''))
            );
        });
    }, [options, search, origin, year, mode]);

    const origins = [...new Set(
        archives.map(value => value.origin).filter(Boolean)
    )].sort();

    const years = [...new Set(
        archives
            .map(value => String(value.year || ''))
            .filter(Boolean)
    )].sort((a, b) => b.localeCompare(a));

    const children = candidate
        ? candidate.child
            ? [candidate.child]
            : candidate.parent.subQuestions || []
        : [];

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Select archive document"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-3"
        >
            <div className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                <header className="flex shrink-0 items-center justify-between gap-3 border-b p-4">
                    <h2 className="text-lg font-bold text-slate-800">
                        Link Archive Document
                    </h2>

                    <button type="button" onClick={onClose} className={buttonClass}>
                        Close
                    </button>
                </header>

                <div className="grid shrink-0 gap-2 border-b p-3 md:grid-cols-4">
                    <input
                        type="search"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Search titles/text; separate alternatives with commas"
                        className="rounded-lg border p-2 text-sm"
                    />

                    <select
                        value={origin}
                        onChange={event => setOrigin(event.target.value)}
                        className="rounded-lg border p-2 text-sm"
                    >
                        <option value="">All origins</option>
                        {origins.map(value => (
                            <option key={value} value={value}>{value}</option>
                        ))}
                    </select>

                    <select
                        value={year}
                        onChange={event => setYear(event.target.value)}
                        className="rounded-lg border p-2 text-sm"
                    >
                        <option value="">All years</option>
                        {years.map(value => (
                            <option key={value} value={value}>{value}</option>
                        ))}
                    </select>

                    <select
                        value={mode}
                        onChange={event => setMode(event.target.value)}
                        className="rounded-lg border p-2 text-sm"
                    >
                        <option value="full">Whole question sets</option>
                        <option value="sub">Sub-questions</option>
                    </select>
                </div>

                {loading || error ? (
                    <p
                        role={error ? 'alert' : 'status'}
                        className={`p-5 text-sm ${error ? 'text-red-700' : 'text-blue-700'}`}
                    >
                        {error || 'Updating archive catalogue...'}
                    </p>
                ) : (
                    <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-2">
                        <div className="max-h-[65dvh] space-y-2 overflow-y-auto border-r bg-slate-50 p-3">
                            <p className="text-xs text-slate-500">
                                {visible.length} result(s). Select one to inspect its questions.
                            </p>

                            {visible.map(option => (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setCandidateId(option.id)}
                                    className={`block w-full rounded-lg border p-3 text-left ${candidateId === option.id
                                        ? 'border-blue-500 bg-blue-50'
                                        : 'border-slate-200 bg-white'
                                        }`}
                                >
                                    <span className="block text-sm font-bold text-slate-800">
                                        {option.title}
                                    </span>

                                    <span className="mt-1 block text-xs text-slate-500">
                                        {option.parent.year} · {option.parent.origin}
                                        {' · '}
                                        {option.parent.versionLabel ||
                                            (option.parent.versionFamilyId ? 'Version' : 'Original')}
                                    </span>
                                </button>
                            ))}
                        </div>

                        <div className="max-h-[65dvh] space-y-3 overflow-y-auto p-4">
                            {!candidate ? (
                                <p className="text-sm text-slate-500">
                                    Select a search result to preview its question text.
                                </p>
                            ) : (
                                <>
                                    <h3 className="font-bold text-slate-800">
                                        {candidate.title}
                                    </h3>

                                    <label className="flex items-center gap-2 text-xs font-bold">
                                        Preview language
                                        <select
                                            value={language}
                                            onChange={event => setLanguage(event.target.value)}
                                            className="rounded border p-2"
                                        >
                                            <option value="en">English</option>
                                            <option value="zh">中文</option>
                                        </select>
                                    </label>

                                    {children.map(child => {
                                        const preferred = language === 'zh'
                                            ? child.contentChi
                                            : child.content;

                                        const alternative = language === 'zh'
                                            ? child.content
                                            : child.contentChi;

                                        return (
                                            <article key={child.id} className="rounded-lg border p-3">
                                                <p className="mb-2 text-xs font-bold text-blue-800">
                                                    Q{child.label}
                                                    {candidate.parent.paperType === 'Paper 1 (DBQ)' &&
                                                        String(child.marks ?? '') !== '' &&
                                                        ` · ${child.marks} marks`}
                                                </p>

                                                {!preferred && alternative && (
                                                    <p className="mb-2 text-xs text-amber-700">
                                                        Selected language unavailable; showing the other language.
                                                    </p>
                                                )}

                                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                                                    {preferred || alternative || 'No question text recorded.'}
                                                </p>
                                            </article>
                                        );
                                    })}

                                    {!children.length && (
                                        <p className="text-sm text-slate-500">
                                            No question text recorded.
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}

                <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t p-3">
                    <button
                        type="button"
                        className={buttonClass}
                        onClick={onClose}
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        disabled={!candidate || loading || Boolean(error)}
                        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                        onClick={() => onSelect({
                            archiveId: candidate.parent.id,
                            linkedDocId: candidate.id
                        })}
                    >
                        Use selected document
                    </button>
                </footer>
            </div>
        </div>
    );
}