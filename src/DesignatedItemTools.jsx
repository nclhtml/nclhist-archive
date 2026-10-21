import React, {
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';

import { PDFDocument } from 'pdf-lib';
import { auth } from './firebase.js';
import { useAuth } from './main.jsx';

import {
    loadDesignatedBatch,
    newDesignatedBatch,
    newDesignatedBatchQuestion,
    saveDesignatedBatch
} from './designatedArchiveFiles.js';

import ArchiveTranslationImport from './ArchiveTranslationImport.jsx';
import PoeImportPanel, { BATCH_PROMPT } from './PoeImportPanel.jsx';
import { convertBatchWord } from './convertBatchWord.js';
import { VersionPdfInline } from './VersionPdf.jsx';

import {
    DesignatedSampleEditor
} from './DesignatedSamples.jsx';

import {
    downloadAppearanceDocx
} from './designatedWordExport.js';

const buttonClass =
    'rounded-lg border border-slate-300 bg-white px-3 py-2 ' +
    'text-xs font-bold text-slate-700 disabled:opacity-40';

function asArray(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
}

function EmbeddedArchiveEditor({
    archiveId = '',
    initialLanguage = 'en',
    initialTitle = '',
    category = 'Assignments',
    onClose,
    onSaved
}) {
    const { user, impersonatedEmail } = useAuth();

    const [form, setForm] = useState(null);
    const [tab, setTab] = useState(initialLanguage === 'zh' ? 'zh' : 'en');
    const [sources, setSources] = useState({});
    const [busy, setBusy] = useState(false);
    const [poeBusy, setPoeBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [json, setJson] = useState('');
    const [previewRole, setPreviewRole] = useState('');
    const [previewSaved, setPreviewSaved] = useState('');
    const [savedResult, setSavedResult] = useState(null);

    const originals = useRef([]);
    const sourceUrls = useRef(new Set());
    const lock = useRef(false);
    const alive = useRef(true);

    const allowed = Boolean(
        user?.isAuthorized &&
        user?.isAdmin &&
        !user?.isImpersonating &&
        !impersonatedEmail
    );

    const blocked = busy || poeBusy || loading || Boolean(savedResult);
    const editing = Boolean(archiveId);

    useEffect(() => {
        alive.current = true;
        let cancelled = false;

        const start = async () => {
            try {
                if (!allowed) {
                    throw new Error('Real administrator access is required.');
                }

                if (archiveId) {
                    const loaded = await loadDesignatedBatch(archiveId);

                    if (cancelled) return;

                    originals.current = loaded.originals;
                    setForm(loaded.form);
                } else {
                    setForm(newDesignatedBatch({
                        title: initialTitle,
                        category
                    }));
                }
            } catch (error) {
                if (!cancelled) setMessage(error.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        start();

        return () => {
            cancelled = true;
            alive.current = false;

            for (const url of sourceUrls.current) {
                URL.revokeObjectURL(url);
            }

            sourceUrls.current.clear();
        };
    }, [archiveId, allowed, initialTitle, category]);

    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previous;
        };
    }, []);

    const close = () => {
        if (lock.current || poeBusy) return;

        if (
            !savedResult &&
            form &&
            !window.confirm(
                'Close this document editor and discard its unsaved changes?\n\n' +
                'The assessment/linking draft underneath will remain open.'
            )
        ) return;

        onClose();
    };

    const updateQuestion = (index, update) => {
        setForm(previous => ({
            ...previous,
            questions: previous.questions.map((question, position) =>
                position === index ? { ...question, ...update } : question
            )
        }));
    };

    const updateSub = (questionIndex, subIndex, update) => {
        setForm(previous => ({
            ...previous,
            questions: previous.questions.map((question, position) =>
                position !== questionIndex ? question : {
                    ...question,
                    subQuestions: question.subQuestions.map((sub, number) =>
                        number === subIndex ? { ...sub, ...update } : sub
                    )
                }
            )
        }));
    };

    const selectSource = async (role, originalFile) => {
        if (!originalFile || lock.current || poeBusy) return;

        if (
            sources[role] &&
            !window.confirm(
                'Replace this source PDF?\n\n' +
                'Unsaved page ranges using this source will be cleared. ' +
                'Saved archive attachments will remain.'
            )
        ) return;

        lock.current = true;
        setBusy(true);
        setMessage('Preparing source PDF…');
        setJson('');

        // Invalidate the slot before processing, so a failed conversion
        // cannot silently leave the previous PDF selected.
        const old = sources[role];

        setSources(previous => ({
            ...previous,
            [role]: null
        }));

        setForm(previous => {
            if (!previous) return previous;

            const language = role.endsWith('_zh') ? 'zh' : 'en';
            const suffix = language === 'zh' ? 'Chi' : '';
            const main = role.startsWith('question_');

            return {
                ...previous,
                questions: previous.questions.map(question => ({
                    ...question,
                    ...(main ? { [`pagesStr${suffix}`]: '' } : {}),
                    ...(
                        (question[`ansSource${suffix}`] || 'answer') ===
                        (main ? 'main' : 'answer')
                            ? { [`ansPagesStr${suffix}`]: '' }
                            : {}
                    )
                }))
            };
        });

        if (old?.url) {
            URL.revokeObjectURL(old.url);
            sourceUrls.current.delete(old.url);
        }

        try {
            if (!/\.(pdf|docx)$/i.test(originalFile.name)) {
                throw new Error('Select a PDF or DOCX file.');
            }

            const file = /\.docx$/i.test(originalFile.name)
                ? await convertBatchWord(originalFile)
                : originalFile;

            const pdf = await PDFDocument.load(await file.arrayBuffer());
            const url = URL.createObjectURL(file);

            sourceUrls.current.add(url);

            setSources(previous => ({
                ...previous,
                [role]: { file, pdf, url }
            }));

            setPreviewSaved('');
            setPreviewRole(role);

            setMessage(
                `${file.name}: ${pdf.getPageCount()} physical PDF pages. ` +
                'Check the preview before entering ranges or generating JSON.'
            );
        } catch (error) {
            setMessage(
                'Source loading failed. This slot is empty.\n\n' + error.message
            );
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };

    const importNewBatch = () => {
        if (blocked || editing || !json.trim()) return;

        try {
            let text = json.trim();
            const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
            if (fence) text = fence[1].trim();

            const parsed = JSON.parse(text);
            const rows = Array.isArray(parsed) ? parsed : parsed.questions;

            if (!Array.isArray(rows) || !rows.length) {
                throw new Error('The JSON must contain a non-empty questions array.');
            }

            const textValue = (value, field) => {
                if (value === undefined || value === null) return '';

                if (typeof value !== 'string') {
                    throw new Error(`${field} must be text.`);
                }

                return value;
            };

            const scalar = (value, field) => {
                if (value === undefined || value === null) return '';

                if (!['string', 'number'].includes(typeof value)) {
                    throw new Error(`${field} must be text or a number.`);
                }

                return String(value).trim();
            };

            const usedDbqs = new Set();
            let essaySeen = false;

            const questions = rows.map((row, index) => {
                if (!row || !['Paper 1 (DBQ)', 'Paper 2 (Essay)'].includes(row.paperType)) {
                    throw new Error(`Question set ${index + 1}: invalid paperType.`);
                }

                const essay = row.paperType === 'Paper 2 (Essay)';
                const number = scalar(row.questionNumber, 'questionNumber');

                if (essay) {
                    if (essaySeen) throw new Error('Group all essays in one final essay set.');
                    essaySeen = true;
                } else {
                    if (
                        essaySeen ||
                        !/^[1-9]\d*$/.test(number) ||
                        usedDbqs.has(number)
                    ) {
                        throw new Error('Use unique original DBQ question numbers before the essay set.');
                    }

                    usedDbqs.add(number);
                }

                if (!Array.isArray(row.subQuestions) || !row.subQuestions.length) {
                    throw new Error('Every question set needs subQuestions.');
                }

                const labels = new Set();

                const question = {
                    ...newDesignatedBatchQuestion(row.paperType),
                    questionNumber: essay ? '' : number,
                    pagesStr: textValue(row.pagesStr, 'pagesStr'),
                    pagesStrChi: textValue(row.pagesStrChi, 'pagesStrChi'),
                    ansPagesStr: textValue(row.ansPagesStr, 'ansPagesStr'),
                    ansPagesStrChi: textValue(row.ansPagesStrChi, 'ansPagesStrChi'),
                    ansSource: row.ansSource || 'main',
                    ansSourceChi: row.ansSourceChi || 'main',
                    subQuestions: row.subQuestions.map(sub => {
                        const label = scalar(sub.label, 'label');
                        const key = label.toLowerCase().replace(/\s/g, '');

                        if (!key || labels.has(key)) {
                            throw new Error('Blank or repeated sub-question label.');
                        }

                        labels.add(key);

                        const content = textValue(sub.content, 'content');
                        const contentChi = textValue(sub.contentChi, 'contentChi');
                        const marks = essay ? '' : scalar(sub.marks, 'marks');

                        if (!content.trim() && !contentChi.trim()) {
                            throw new Error(`Q${label}: no wording in either language.`);
                        }

                        if (marks && !/^\d+(?:\.\d+)?$/.test(marks)) {
                            throw new Error(`Q${label}: invalid DBQ marks.`);
                        }

                        return {
                            id: crypto.randomUUID(),
                            label,
                            content,
                            contentChi,
                            marks,
                            candidatePerformance: textValue(
                                sub.candidatePerformance,
                                'candidatePerformance'
                            ),
                            candidatePerformanceChi: textValue(
                                sub.candidatePerformanceChi,
                                'candidatePerformanceChi'
                            ),
                            topic: [],
                            questionType: [],
                            sourceType:
                                !essay &&
                                marks !== '' &&
                                Number(marks) <= 7 &&
                                Array.isArray(sub.sourceType)
                                    ? sub.sourceType.filter(value => typeof value === 'string')
                                    : [],
                            rating: 0,
                            designatedSample: {}
                        };
                    })
                };

                return question;
            });

            if (!window.confirm(
                `Replace this NEW draft with ${questions.length} question set(s)?\n\n` +
                'Selected source PDFs, title, year, origin and tier stay unchanged.\n' +
                'Nothing is saved yet.'
            )) return;

            setForm(previous => ({
                ...previous,
                questions,
                aiSourceFiles: Object.fromEntries(
                    Object.entries(sources)
                        .filter(([, source]) => source?.file)
                        .map(([role, source]) => [role, source.file])
                )
            }));

            setMessage(
                'JSON filled. Review wording, tags, performance commentary ' +
                'and every page range before saving.'
            );
        } catch (error) {
            setMessage('Import stopped. The draft was not changed.\n\n' + error.message);
        }
    };

    const save = async event => {
        event.preventDefault();

        if (!allowed || blocked || lock.current) return;

        lock.current = true;
        setBusy(true);
        setMessage('Checking and saving archive records. Keep this editor open.');

        try {
            const saved = await saveDesignatedBatch({
                form,
                originals: originals.current,
                sources,
                email: user.email
            });

            if (!saved) return;

            // Save success and catalogue/link success are separate.
            // Keep the saved result so a UI error cannot invite a duplicate save.
            setSavedResult(saved);
            setMessage(
                'Archive saved successfully. Returning to the document selector…'
            );

            onSaved(saved);
        } catch (error) {
            setMessage(
                'Save did not complete or could not be confirmed.\n\n' +
                error.message +
                '\n\nIf the connection failed during commit, check the catalogue ' +
                'before submitting again. Uploaded files are retained for safety.'
            );
        } finally {
            lock.current = false;
            if (alive.current) setBusy(false);
        }
    };

    const preferredLanguage = ['en', 'zh'].includes(tab) ? tab : initialLanguage;
    const suffix = preferredLanguage === 'zh' ? 'Chi' : '';
    const previewUrl = previewSaved || sources[previewRole]?.url || '';

    const csv = value =>
        String(value || '').split(/[,，]/).map(part => part.trim()).filter(Boolean);

    const preview = url => (
        <iframe
            title="Archive source PDF preview"
            src={url}
            className="h-full min-h-[420px] w-full border-0 bg-slate-200"
        />
    );

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={editing ? 'Edit archive here' : 'Create batch archive here'}
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-2"
        >
            <div className="flex h-[96dvh] w-full max-w-[1600px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-slate-50 p-3">
                    <div>
                        <h2 className="font-bold text-slate-900">
                            {editing
                                ? 'Edit saved question set — inside Designated Assessment'
                                : 'New batch exam/document — inside Designated Assessment'}
                        </h2>

                        <p className="text-xs text-slate-600">
                            Saving the archive does not attach it automatically.
                            Select the saved document and confirm the link afterwards.
                        </p>
                    </div>

                    <button
                        type="button"
                        disabled={busy || poeBusy}
                        onClick={close}
                        className={buttonClass}
                    >
                        Close editor
                    </button>
                </header>

                {(message || loading || poeBusy) && (
                    <div
                        role="status"
                        className="max-h-36 shrink-0 overflow-auto whitespace-pre-wrap border-b bg-blue-50 p-3 text-xs text-blue-900"
                    >
                        {poeBusy
                            ? 'Poe is processing. Keep this page open; editing and saving are locked.'
                            : loading ? 'Loading saved archive records…' : message}
                    </div>
                )}

                {form && allowed && (
                    <div className="grid min-h-0 flex-1 overflow-auto lg:grid-cols-2">
                        <form
                            id="designated-embedded-batch"
                            onSubmit={save}
                            className="space-y-4 overflow-y-auto p-4"
                        >
                            <div className="flex flex-wrap gap-2">
                                {[
                                    ['en', 'English'],
                                    ['zh', '中文'],
                                    ['samples', 'Designated samples']
                                ].map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        disabled={blocked}
                                        onClick={() => setTab(value)}
                                        className={`${buttonClass} ${tab === value ? 'ring-2 ring-blue-500' : ''}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <fieldset disabled={blocked} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                                <label className="text-xs font-bold">
                                    Exam/document title
                                    <input
                                        required
                                        readOnly={editing}
                                        value={form.title}
                                        onChange={event => setForm(previous => ({
                                            ...previous,
                                            title: event.target.value
                                        }))}
                                        className="mt-1 w-full rounded border p-2 text-sm"
                                    />
                                </label>

                                <label className="text-xs font-bold">
                                    Origin
                                    <select
                                        disabled={editing}
                                        value={form.origin}
                                        onChange={event => setForm(previous => ({
                                            ...previous,
                                            origin: event.target.value
                                        }))}
                                        className="mt-1 w-full rounded border p-2 text-sm"
                                    >
                                        {[
                                            'DSE Pastpaper', 'CE/AL', 'Internal School Exam',
                                            'Mock Examination', 'Quiz', 'Exercise'
                                        ].map(value => <option key={value}>{value}</option>)}
                                    </select>
                                </label>

                                <label className="text-xs font-bold">
                                    Year
                                    <input
                                        required
                                        readOnly={editing}
                                        value={form.year}
                                        onChange={event => setForm(previous => ({
                                            ...previous,
                                            year: event.target.value
                                        }))}
                                        className="mt-1 w-full rounded border p-2 text-sm"
                                    />
                                </label>

                                <label className="text-xs font-bold">
                                    Tier — stored archive tier ID
                                    <input
                                        required
                                        value={form.tier}
                                        onChange={event => setForm(previous => ({
                                            ...previous,
                                            tier: event.target.value
                                        }))}
                                        className="mt-1 w-full rounded border p-2 text-sm"
                                    />
                                </label>
                            </fieldset>

                            {tab === 'samples' ? (
                                <DesignatedSampleEditor
                                    questions={form.questions}
                                    disabled={blocked}
                                    onChange={updater => setForm(previous => ({
                                        ...previous,
                                        questions: updater(previous.questions)
                                    }))}
                                />
                            ) : (
                                <>
                                    <div className="space-y-3 rounded-lg border bg-slate-50 p-3">
                                        <h3 className="text-sm font-bold">
                                            {tab === 'zh' ? 'Chinese' : 'English'} source documents
                                        </h3>

                                        {['question', 'answer'].map(kind => {
                                            const role = `${kind}_${tab}`;
                                            const source = sources[role];

                                            return (
                                                <label key={role} className="block text-xs font-bold">
                                                    {kind === 'question'
                                                        ? 'Main question PDF / DOCX'
                                                        : 'Separate answer PDF / DOCX'}

                                                    <input
                                                        type="file"
                                                        accept=".pdf,.docx"
                                                        disabled={blocked}
                                                        className="mt-1 block w-full text-xs"
                                                        onChange={event => {
                                                            const file = event.target.files?.[0];
                                                            event.target.value = '';
                                                            selectSource(role, file);
                                                        }}
                                                    />

                                                    {source && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setPreviewSaved('');
                                                                setPreviewRole(role);
                                                            }}
                                                            className="mt-1 text-left font-normal text-blue-800 underline"
                                                        >
                                                            {source.file.name}
                                                            {' — '}{source.pdf.getPageCount()} pages
                                                        </button>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    </div>

                                    {editing ? (
                                        <ArchiveTranslationImport
                                            form={form}
                                            language={tab}
                                            sources={sources}
                                            disabled={busy || loading || Boolean(savedResult)}
                                            onChange={setForm}
                                            onBusyChange={setPoeBusy}
                                        />
                                    ) : (
                                        <div className="space-y-3">
                                            <PoeImportPanel
                                                mode="batch"
                                                entries={['question_en', 'question_zh', 'answer_en', 'answer_zh'].map(role => ({
                                                    role,
                                                    label: role,
                                                    file: sources[role]?.file || null
                                                }))}
                                                disabled={busy || loading || Boolean(savedResult)}
                                                onBusyChange={setPoeBusy}
                                                onInvalidate={() => setJson('')}
                                                onDraft={draft => setJson(draft.text)}
                                            />

                                            <button
                                                type="button"
                                                disabled={blocked}
                                                className={buttonClass}
                                                onClick={async () => {
                                                    try {
                                                        await navigator.clipboard.writeText(BATCH_PROMPT);
                                                        setMessage('Batch prompt copied. Give it and the selected original PDFs to your AI.');
                                                    } catch {
                                                        setMessage('Clipboard access was blocked.');
                                                    }
                                                }}
                                            >
                                                Copy batch AI prompt
                                            </button>

                                            <textarea
                                                disabled={blocked}
                                                rows={6}
                                                value={json}
                                                onChange={event => setJson(event.target.value)}
                                                placeholder="Paste complete batch JSON, or generate it above."
                                                className="w-full rounded border p-2 font-mono text-xs"
                                            />

                                            <button
                                                type="button"
                                                disabled={blocked || !json.trim()}
                                                onClick={importNewBatch}
                                                className={buttonClass}
                                            >
                                                Fill new batch from JSON
                                            </button>
                                        </div>
                                    )}

                                    <p className="text-xs text-amber-900">
                                        Page numbers are physical positions in each selected PDF.
                                        New batch titles receive the same D Q / E suffixes as
                                        the archive batch uploader. Existing saved titles and IDs stay unchanged.
                                        Tags below are comma-separated.
                                    </p>

                                    {form.questions.map((question, questionIndex) => (
                                        <fieldset
                                            key={question.id}
                                            disabled={blocked}
                                            className="space-y-3 rounded-xl border-2 border-slate-200 p-3"
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <h3 className="text-sm font-bold">
                                                    {question.originalTitle || `New question set ${questionIndex + 1}`}
                                                </h3>

                                                <button
                                                    type="button"
                                                    className="text-xs font-bold text-red-700"
                                                    onClick={() => {
                                                        if (!window.confirm(
                                                            'Remove this question-set card? ' +
                                                            'Database removal happens only after Save.'
                                                        )) return;

                                                        setForm(previous => ({
                                                            ...previous,
                                                            questions: previous.questions.filter(
                                                                (_, index) => index !== questionIndex
                                                            )
                                                        }));
                                                    }}
                                                >
                                                    Remove record
                                                </button>
                                            </div>

                                            <select
                                                disabled={Boolean(question.originalTitle)}
                                                value={question.paperType}
                                                onChange={event => updateQuestion(questionIndex, {
                                                    paperType: event.target.value
                                                })}
                                                className="w-full rounded border p-2 text-sm"
                                            >
                                                <option>Paper 1 (DBQ)</option>
                                                <option>Paper 2 (Essay)</option>
                                            </select>

                                            {question.paperType === 'Paper 1 (DBQ)' && (
                                                <label className="block text-xs">
                                                    Original main DBQ number
                                                    <input
                                                        disabled={Boolean(question.originalTitle)}
                                                        value={question.questionNumber || ''}
                                                        placeholder="1"
                                                        onChange={event => updateQuestion(questionIndex, {
                                                            questionNumber: event.target.value
                                                        })}
                                                        className="mt-1 w-full rounded border p-2"
                                                    />
                                                </label>
                                            )}

                                            <label className="block text-xs">
                                                Main topics — comma-separated
                                                <input
                                                    value={asArray(question.topic).join(', ')}
                                                    onChange={event => updateQuestion(questionIndex, {
                                                        topic: csv(event.target.value)
                                                    })}
                                                    className="mt-1 w-full rounded border p-2"
                                                />
                                            </label>

                                            {[
                                                [`fileUrl${suffix}`, `pagesStr${suffix}`, 'Question'],
                                                [`answerFileUrl${suffix}`, `ansPagesStr${suffix}`, 'Answer']
                                            ].map(([urlField, pagesField, label]) => (
                                                <div key={urlField} className="space-y-2 rounded border bg-slate-50 p-2">
                                                    <p className="text-xs font-bold">
                                                        {tab.toUpperCase()} {label} PDF
                                                    </p>

                                                    {question[urlField] ? (
                                                        <div className="flex gap-3">
                                                            <button
                                                                type="button"
                                                                className="text-xs text-blue-800 underline"
                                                                onClick={() => {
                                                                    setPreviewRole('');
                                                                    setPreviewSaved(question[urlField]);
                                                                }}
                                                            >
                                                                Preview saved attachment
                                                            </button>

                                                            <button
                                                                type="button"
                                                                className="text-xs text-red-700 underline"
                                                                onClick={() => {
                                                                    if (!window.confirm(
                                                                        'Detach this saved attachment on Save? ' +
                                                                        'Its Storage file will be retained.'
                                                                    )) return;

                                                                    updateQuestion(questionIndex, {
                                                                        [urlField]: '',
                                                                        [pagesField]: ''
                                                                    });
                                                                }}
                                                            >
                                                                Detach / replace
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {label === 'Answer' && (
                                                                <select
                                                                    value={question[`ansSource${suffix}`] || 'answer'}
                                                                    onChange={event => updateQuestion(questionIndex, {
                                                                        [`ansSource${suffix}`]: event.target.value
                                                                    })}
                                                                    className="w-full rounded border p-2 text-xs"
                                                                >
                                                                    <option value="answer">From separate answer PDF</option>
                                                                    <option value="main">From main question PDF</option>
                                                                </select>
                                                            )}

                                                            <input
                                                                value={question[pagesField] || ''}
                                                                placeholder="Physical pages: 2-4, 7"
                                                                onChange={event => updateQuestion(questionIndex, {
                                                                    [pagesField]: event.target.value
                                                                })}
                                                                className="w-full rounded border p-2 text-xs"
                                                            />
                                                        </>
                                                    )}
                                                </div>
                                            ))}

                                            {question.subQuestions.map((sub, subIndex) => (
                                                <div key={sub.id} className="space-y-2 rounded border bg-white p-3">
                                                    <div className="flex gap-2">
                                                        <input
                                                            value={sub.label}
                                                            onChange={event => updateSub(questionIndex, subIndex, {
                                                                label: event.target.value
                                                            })}
                                                            className="w-20 rounded border p-2 text-xs"
                                                            aria-label="Question label"
                                                        />

                                                        <button
                                                            type="button"
                                                            className="ml-auto text-xs text-red-700"
                                                            onClick={() => {
                                                                if (!window.confirm(
                                                                    'Remove this sub-question on Save? ' +
                                                                    'Existing link protections still apply.'
                                                                )) return;

                                                                updateQuestion(questionIndex, {
                                                                    subQuestions: question.subQuestions.filter(
                                                                        (_, index) => index !== subIndex
                                                                    )
                                                                });
                                                            }}
                                                        >
                                                            Remove part
                                                        </button>
                                                    </div>

                                                    <label className="block text-xs font-bold">
                                                        {tab === 'zh' ? '中文題目' : 'English question wording'}
                                                        <textarea
                                                            rows={3}
                                                            value={sub[tab === 'zh' ? 'contentChi' : 'content'] || ''}
                                                            onChange={event => updateSub(questionIndex, subIndex, {
                                                                [tab === 'zh' ? 'contentChi' : 'content']: event.target.value
                                                            })}
                                                            className="mt-1 w-full rounded border p-2 text-sm font-normal"
                                                        />
                                                    </label>

                                                    {question.paperType === 'Paper 1 (DBQ)' && (
                                                        <label className="block text-xs">
                                                            DBQ marks
                                                            <input
                                                                value={sub.marks ?? ''}
                                                                onChange={event => updateSub(questionIndex, subIndex, {
                                                                    marks: event.target.value
                                                                })}
                                                                className="mt-1 w-full rounded border p-2"
                                                            />
                                                        </label>
                                                    )}

                                                    {[
                                                        ['questionType', 'Question-type tags'],
                                                        ['topic', 'Topic tags'],
                                                        ['sourceType', 'Source-type tags']
                                                    ].map(([field, label]) => (
                                                        <label key={field} className="block text-xs">
                                                            {label}
                                                            <input
                                                                value={asArray(sub[field]).join(', ')}
                                                                onChange={event => updateSub(questionIndex, subIndex, {
                                                                    [field]: csv(event.target.value)
                                                                })}
                                                                className="mt-1 w-full rounded border p-2"
                                                            />
                                                        </label>
                                                    ))}

                                                    <label className="block text-xs">
                                                        {tab === 'zh' ? '中文考生表現' : 'English candidate performance'}
                                                        <textarea
                                                            rows={3}
                                                            value={sub[
                                                                tab === 'zh'
                                                                    ? 'candidatePerformanceChi'
                                                                    : 'candidatePerformance'
                                                            ] || ''}
                                                            onChange={event => updateSub(questionIndex, subIndex, {
                                                                [tab === 'zh'
                                                                    ? 'candidatePerformanceChi'
                                                                    : 'candidatePerformance']: event.target.value
                                                            })}
                                                            className="mt-1 w-full rounded border p-2"
                                                        />
                                                    </label>
                                                </div>
                                            ))}

                                            <button
                                                type="button"
                                                className={buttonClass}
                                                onClick={() => {
                                                    const essay = question.paperType === 'Paper 2 (Essay)';

                                                    const sub = newDesignatedBatchQuestion(
                                                        question.paperType
                                                    ).subQuestions[0];

                                                    sub.label = essay
                                                        ? String(question.subQuestions.length + 1)
                                                        : String.fromCharCode(97 + question.subQuestions.length);

                                                    updateQuestion(questionIndex, {
                                                        subQuestions: [...question.subQuestions, sub]
                                                    });
                                                }}
                                            >
                                                + Add sub-question
                                            </button>
                                        </fieldset>
                                    ))}

                                    <div className="flex flex-wrap gap-2">
                                        {['Paper 1 (DBQ)', 'Paper 2 (Essay)'].map(type => (
                                            <button
                                                key={type}
                                                type="button"
                                                disabled={blocked}
                                                className={buttonClass}
                                                onClick={() => setForm(previous => ({
                                                    ...previous,
                                                    questions: [
                                                        ...previous.questions,
                                                        newDesignatedBatchQuestion(type)
                                                    ]
                                                }))}
                                            >
                                                + Add {type}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </form>

                        <section className="flex min-h-[450px] flex-col border-l bg-slate-200">
                            <div className="shrink-0 border-b bg-white p-2">
                                <select
                                    value={previewRole}
                                    onChange={event => {
                                        setPreviewSaved('');
                                        setPreviewRole(event.target.value);
                                    }}
                                    className="w-full rounded border p-2 text-xs"
                                >
                                    <option value="">Select source preview</option>
                                    {Object.entries(sources)
                                        .filter(([, source]) => source?.url)
                                        .map(([role, source]) => (
                                            <option key={role} value={role}>
                                                {role} — {source.file.name}
                                            </option>
                                        ))}
                                </select>
                            </div>

                            <div className="min-h-[420px] flex-1">
                                {!previewUrl ? (
                                    <p className="p-5 text-sm text-slate-600">
                                        Select a source PDF or a saved attachment to preview.
                                    </p>
                                ) : previewUrl.startsWith('/archive-pdf?') ? (
                                    <VersionPdfInline
                                        key={previewUrl}
                                        fileUrl={previewUrl}
                                        renderViewer={preview}
                                    />
                                ) : preview(previewUrl)}
                            </div>
                        </section>
                    </div>
                )}

                <footer className="flex shrink-0 justify-end gap-2 border-t bg-white p-3">
                    <button
                        type="button"
                        disabled={busy || poeBusy}
                        onClick={close}
                        className={buttonClass}
                    >
                        Cancel / return to linking
                    </button>

                    {savedResult ? (
                        <button
                            type="button"
                            onClick={() => onSaved(savedResult)}
                            className={buttonClass}
                        >
                            Return to selector with saved documents
                        </button>
                    ) : (
                        <button
                            type="submit"
                            form="designated-embedded-batch"
                            disabled={!allowed || blocked || !form}
                            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
                        >
                            {busy ? 'Saving…' : editing ? 'Update archive here' : 'Save new batch here'}
                        </button>
                    )}
                </footer>
            </div>
        </div>
    );
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
    onClose,
    recommendations = [],
    preferredLanguage = '',
    initialTitle = '',
    category = 'Assignments',
    allowArchiveEditing = false
}) {
    const { user, impersonatedEmail } = useAuth();

    const canEditArchive = Boolean(
        allowArchiveEditing &&
        user?.isAuthorized &&
        user?.isAdmin &&
        !user?.isImpersonating &&
        !impersonatedEmail
    );

    const [editor, setEditor] = useState(null);
    const [savedArchives, setSavedArchives] = useState([]);
    const [savedMessage, setSavedMessage] = useState('');
    const [search, setSearch] = useState('');
    const [origin, setOrigin] = useState('');
    const [year, setYear] = useState('');
    const [mode, setMode] = useState('full');
    const [language, setLanguage] = useState('en');
const [candidateId, setCandidateId] = useState(selectedId || '');

    const availableArchives = useMemo(() => {
        const combined = new Map(
            archives.map(archive => [archive.id, archive])
        );

        savedArchives.forEach(archive => {
            combined.set(archive.id, archive);
        });

        return [...combined.values()];
    }, [archives, savedArchives]);

    const options = useMemo(() =>
        availableArchives.flatMap(parent => [
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
[availableArchives]);

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
        availableArchives.map(value => value.origin).filter(Boolean)
    )].sort();

    const years = [...new Set(
        availableArchives
            .map(value => String(value.year || ''))
            .filter(Boolean)
    )].sort((a, b) => b.localeCompare(a));

    const inspectLanguage = option => {
        if (!['en', 'zh'].includes(preferredLanguage)) {
            return {
                available: false,
                description: 'Select the class PDF language before deciding which translation is required.'
            };
        }

        const parent = option.parent;
        const children = option.child
            ? [option.child]
            : parent.subQuestions || [];

        const field = preferredLanguage === 'zh' ? 'contentChi' : 'content';
        const pdf = preferredLanguage === 'zh'
            ? parent.fileUrlChi
            : parent.fileUrl;

        const wordingReady =
            children.length > 0 &&
            children.every(child => String(child[field] || '').trim());

        const needsPdf = parent.paperType === 'Paper 1 (DBQ)';
        const available = wordingReady && (!needsPdf || Boolean(pdf));

        return {
            available,
            description: available
                ? 'The required language wording and DBQ attachment, where applicable, are recorded. Review them before linking.'
                : [
                    !wordingReady ? 'Some required-language question wording is missing.' : '',
                    needsPdf && !pdf ? 'The required-language DBQ question PDF is missing.' : ''
                ].filter(Boolean).join(' ')
        };
    };

    const recommendedOptions = recommendations
        .map(recommendation => {
            const option = options.find(
                value => value.id === recommendation.linkedDocId
            );

            return option
                ? { ...option, from: recommendation.from }
                : null;
        })
        .filter(Boolean);

    const finishArchiveSave = saved => {
        setSavedArchives(previous => {
            const combined = new Map(previous.map(value => [value.id, value]));
            saved.forEach(value => combined.set(value.id, value));
            return [...combined.values()];
        });

        const keepSelection = saved.some(archive =>
            archive.id === candidateId ||
            (archive.subQuestions || []).some(child =>
                `${archive.id}_${child.id}` === candidateId
            )
        );

        if (!keepSelection && saved[0]) {
            setCandidateId(saved[0].id);
            setMode('full');
        }

        setSavedMessage(
            `Saved ${saved.length} archive record(s). ` +
            'The catalogue below now includes them. ' +
            'Select the intended question set/part, then click Use selected document.'
        );

        setEditor(null);

        window.dispatchEvent(new CustomEvent('designated-pdf-uploaded', {
            detail: { archives: saved }
        }));
    };

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

<div className="max-h-[32dvh] shrink-0 space-y-3 overflow-auto border-b bg-amber-50 p-3">
                    {savedMessage && (
                        <p role="status" className="text-xs font-bold text-green-800">
                            {savedMessage}
                        </p>
                    )}

                    {recommendedOptions.length > 0 ? (
                        <>
                            <h3 className="text-sm font-bold text-amber-950">
                                Recommended — same common item, other-language class
                            </h3>

                            {recommendedOptions.map(option => {
                                const status = inspectLanguage(option);

                                return (
                                    <div
                                        key={option.id}
                                        className="space-y-2 rounded-lg border border-amber-200 bg-white p-3"
                                    >
                                        <p className="text-sm font-bold text-slate-800">
                                            {option.title}
                                        </p>

                                        <p className="text-xs text-slate-600">
                                            Linked by: {option.from}
                                        </p>

                                        <p className="text-xs text-amber-900">
                                            {status.description}
                                        </p>

                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                className={buttonClass}
                                                onClick={() => {
                                                    setCandidateId(option.id);
                                                    setMode(option.mode);
                                                }}
                                            >
                                                {status.available
                                                    ? 'Recommend this same document — select it'
                                                    : 'Select this document anyway'}
                                            </button>

                                            {canEditArchive && (
                                                <button
                                                    type="button"
                                                    className={buttonClass}
                                                    onClick={() => {
                                                        setCandidateId(option.id);
                                                        setEditor({
                                                            archiveId: option.parent.id,
                                                            language: preferredLanguage || 'en'
                                                        });
                                                    }}
                                                >
                                                    {status.available
                                                        ? 'Review / edit this document here'
                                                        : 'Recommended: add missing translation here'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </>
                    ) : (
                        <p className="text-xs text-amber-950">
                            No available other-language document link was found
                            for this same common item. You can search existing
                            documents or create a new batch below.
                        </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                        {canEditArchive && (
                            <button
                                type="button"
                                className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white"
                                onClick={() => setEditor({
                                    archiveId: '',
                                    language: preferredLanguage || 'en'
                                })}
                            >
                                + Create a NEW batch document here
                            </button>
                        )}

                        <button
                            type="button"
                            className={buttonClass}
                            onClick={() => window.dispatchEvent(
                                new Event('designated-refresh-archives')
                            )}
                        >
                            Reload document catalogue
                        </button>
                    </div>

                    <p className="text-[11px] text-slate-600">
                        Recommendations are optional. Creating a different new
                        document remains available. Nothing is linked until
                        you confirm Use selected document.
                    </p>
                </div>

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

                                    {canEditArchive && (
                                        <button
                                            type="button"
                                            className={buttonClass}
                                            onClick={() => setEditor({
                                                archiveId: candidate.parent.id,
                                                language: preferredLanguage || language
                                            })}
                                        >
                                            Edit this question set / add translation here
                                        </button>
                                    )}

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

{editor && canEditArchive && (
                    <EmbeddedArchiveEditor
                        key={`${editor.archiveId || 'new'}:${editor.language}`}
                        archiveId={editor.archiveId}
                        initialLanguage={editor.language}
                        initialTitle={initialTitle}
                        category={category}
                        onClose={() => setEditor(null)}
                        onSaved={finishArchiveSave}
                    />
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