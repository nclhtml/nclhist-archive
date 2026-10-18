import React, {
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

import {
    getFunctions,
    httpsCallable
} from "firebase/functions";

import { auth } from "../../firebase.js";

import {
    PRESETS,
automaticPresetKey,
  cleanTextTree,
  descriptorSummary,
    getPresetLevels,
    initialBlocks,
    languageLabel,
    languagesForMode,
    layoutForBlock,
    makeAnswer,
    makeAnswerGroup,
    makeBlock,
    makeLevel,
    richParts,
    sampleBlocks,
    showExamplesForBlock
} from "./markingSchemeModel.js";

import QuestionPaper, {
  initialPaper,
  localizePaper,
  paperSectionId,
  WorksheetSettings
} from "./QuestionPaper.jsx";

import "./marking-scheme.css";

function Field({
    label,
    value,
    onChange,
    multiline = false,
    placeholder = "",
    language
}) {
    const Control = multiline ? "textarea" : "input";

    return (
        <label className="msg-field">
            <span>{label}</span>

            <Control
                value={value ?? ""}
                onChange={event => onChange(event.target.value)}
                placeholder={placeholder}
                lang={language === "zh" ? "zh-TW" : undefined}
                className={
                    language === "zh" ? "msg-chinese-input" : undefined
                }
                {...(
                    multiline
                        ? { rows: 2 }
                        : { type: "text" }
                )}
            />
        </label>
    );
}

function RichText({ text, language = "en" }) {
    return richParts(text).map((part, index) => {
        if (!part.emphasized) {
            return (
                <React.Fragment key={index}>
                    {part.text}
                </React.Fragment>
            );
        }

        if (language === "zh") {
            return (
                <strong key={index}>
                    {part.text}
                </strong>
            );
        }

        return (
            <strong key={index}>
                <em>{part.text}</em>
            </strong>
        );
    });
}

function LanguageTabs({
    id,
    languages,
    value,
    onChange,
    label = "Content language"
}) {
    if (languages.length < 2) return null;

    function handleKeyDown(event, index) {
        let nextIndex;

        if (event.key === "ArrowRight") {
            nextIndex = (index + 1) % languages.length;
        } else if (event.key === "ArrowLeft") {
            nextIndex =
                (index - 1 + languages.length) % languages.length;
        } else if (event.key === "Home") {
            nextIndex = 0;
        } else if (event.key === "End") {
            nextIndex = languages.length - 1;
        } else {
            return;
        }

        event.preventDefault();

        const nextLanguage = languages[nextIndex];

        onChange(nextLanguage);

        document
            .getElementById(`${id}-tab-${nextLanguage}`)
            ?.focus();
    }

    return (
        <div
            className="msg-language-tabs"
            role="tablist"
            aria-label={label}
        >
            {languages.map((language, index) => (
                <button
                    key={language}
                    id={`${id}-tab-${language}`}
                    type="button"
                    role="tab"
                    aria-selected={value === language}
                    aria-controls={`${id}-panel`}
                    tabIndex={value === language ? 0 : -1}
                    onClick={() => onChange(language)}
                    onKeyDown={event =>
                        handleKeyDown(event, index)
                    }
                >
                    {languageLabel(language)}
                </button>
            ))}
        </div>
    );
}

function PreviewBlock({ block, language }) {
    const { widths, rows } = layoutForBlock(
        block,
        language
    );

    const totalWidth = widths.reduce(
        (sum, width) => sum + width,
        0
    );

    return (
        <table
            className="msg-preview-table"
            lang={language === "zh" ? "zh-TW" : "en"}
        >
            <colgroup>
                {widths.map((width, index) => (
                    <col
                        key={index}
                        style={{
                            width: `${width / totalWidth * 100}%`
                        }}
                    />
                ))}
            </colgroup>

            <tbody>
                {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                        {row.cells.map((item, cellIndex) => (
                            <td
                                key={cellIndex}
                                colSpan={item.span}
                                style={{
                                    fontWeight: item.bold
                                        ? "bold"
                                        : "normal",

                                    fontStyle: item.italic
                                        ? "italic"
                                        : "normal",

                                    textAlign: item.right
                                        ? "right"
                                        : "left",

                                    paddingTop:
                                        `${(row.before || 0) / 20}pt`,

                                    paddingBottom:
                                        `${row.gap / 20}pt`
                                }}
                            >
                                <RichText
                                    text={item.text}
                                    language={language}
                                />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function downloadBase64(base64, filename) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (
        let index = 0;
        index < binary.length;
        index += 1
    ) {
        bytes[index] = binary.charCodeAt(index);
    }

    const blob = new Blob([bytes], {
        type:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(
        () => URL.revokeObjectURL(url),
        30000
    );
}

function exportPayload(blocks) {
    return blocks.map(block => ({
        number: block.number,
        part: block.part,
        sub: block.sub,
        marks: block.marks,

        question: block.question,
        questionZh: block.questionZh,

        showExamples: showExamplesForBlock(block),
        extendAnswers: block.extendAnswers === true,

        levels: block.levels.map(level => ({
            label: level.label,
            description: level.description,
            descriptionZh: level.descriptionZh,
            marks: level.marks
        })),

        answerGroups: block.answerGroups.map(group => ({
            heading: group.heading,
            headingZh: group.headingZh,

            answers: group.answers.map(answer => ({
                text: answer.text,
                clues: answer.clues,
                textZh: answer.textZh,
                cluesZh: answer.cluesZh
            }))
        }))
    }));
}

function questionLabel(block, index) {
    const identifier = [
        block.number,
        block.part,
        block.sub
    ]
        .filter(value => value.trim())
        .join(" ");

    return identifier
        ? `Question ${identifier}`
        : `Question block ${index + 1}`;
}

export default function MarkingSchemeGenerator() {
const [blocks, setBlocksState] = useState(
    () => cleanTextTree(initialBlocks())
  );

  function setBlocks(updater) {
    setBlocksState(previous => {
      const next = typeof updater === "function"
        ? updater(previous)
        : updater;

      return cleanTextTree(next);
    });
  }

    const [activeTool, setActiveTool] =
        useState("questionPaper");

const [paper, setPaperState] = useState(
    () => cleanTextTree(initialPaper())
  );

  function setPaper(updater) {
    setPaperState(previous => {
      const next = typeof updater === "function"
        ? updater(previous)
        : updater;

      return cleanTextTree(next);
    });
  }

    const [paperLanguageChoice, setPaperLanguage] =
        useState("en");

    const [languageMode, setLanguageMode] = useState("en");

    /*
     * Single-language mode always shows that language.
     * Both mode remembers the preferred source-editor tab.
     */
    const paperLanguage = languageMode === "both"
        ? paperLanguageChoice
        : languageMode;
    const [blockLanguages, setBlockLanguages] = useState({});
    const [previewLanguage, setPreviewLanguage] =
        useState("zh");

    const [access, setAccess] = useState("checking");
    const [accessMessage, setAccessMessage] = useState("");
    const [accessAttempt, setAccessAttempt] = useState(0);

    const [exporting, setExporting] = useState(false);
    const [status, setStatus] = useState("");

    const overviewRef = useRef(null);
    const languages = languagesForMode(languageMode);

    const effectivePreviewLanguage =
        languages.includes(previewLanguage)
            ? previewLanguage
            : languages[0];

    const callApi = useMemo(() => {
        const functions = getFunctions(
            auth.app,
            "us-central1"
        );

        return httpsCallable(
            functions,
            "markingSchemeApi",
            { timeout: 120000 }
        );
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function checkAccess() {
            setAccess("checking");
            setAccessMessage("");

            try {
                await callApi({ action: "authorize" });

                if (!cancelled) {
                    setAccess("allowed");
                }
            } catch (error) {
                if (!cancelled) {
                    setAccess("denied");

                    setAccessMessage(
                        error.message ||
                        "Administrator access could not be verified."
                    );
                }
            }
        }

        checkAccess();

        return () => {
            cancelled = true;
        };
    }, [callApi, accessAttempt]);

    function editBlock(blockId, updater) {
        setBlocks(previous =>
            previous.map(block =>
                block.id === blockId
                    ? updater(block)
                    : block
            )
        );
    }

    function updateBlock(blockId, patch) {
        editBlock(blockId, block => {
            const next = {
                ...block,
                ...patch
            };

            /*
             * One-way sync:
             * question paper -> marking scheme.
             *
             * Editing marking-scheme wording never updates
             * question-paper wording.
             *
             * Automatic one/two emphasis is not stored in
             * paperQuestion, so it is not copied.
             */
            if (
                Object.prototype.hasOwnProperty.call(
                    patch,
                    "paperQuestion"
                )
            ) {
                next.question = patch.paperQuestion;
            }

            if (
                Object.prototype.hasOwnProperty.call(
                    patch,
                    "paperQuestionZh"
                )
            ) {
                next.questionZh = patch.paperQuestionZh;
            }

            /*
             * Automatic presets update both languages together.
             * Manually edited descriptors remain untouched.
             */
            if (
                Object.prototype.hasOwnProperty.call(
                    patch,
                    "marks"
                ) &&
                block.presetMode === "auto" &&
                automaticPresetKey(block.marks) !==
                automaticPresetKey(next.marks)
            ) {
                next.levels = getPresetLevels(
                    automaticPresetKey(next.marks)
                );
            }

            return next;
        });
    }

    function changePreset(blockId, mode) {
        if (mode === "custom") return;

        editBlock(blockId, block => {
            const key = mode === "auto"
                ? automaticPresetKey(block.marks)
                : mode;

            return {
                ...block,
                presetMode: mode,

                levels: mode === "none"
                    ? []
                    : getPresetLevels(key)
            };
        });
    }

    function updateLevel(blockId, levelId, patch) {
        editBlock(blockId, block => ({
            ...block,
            presetMode: "custom",

            levels: block.levels.map(level =>
                level.id === levelId
                    ? { ...level, ...patch }
                    : level
            )
        }));
    }

    function addLevel(blockId) {
        editBlock(blockId, block => ({
            ...block,
            presetMode: "custom",
            levels: [...block.levels, makeLevel()]
        }));
    }

    function removeLevel(blockId, levelId) {
        if (
            !window.confirm(
                "Remove this level from both language versions?"
            )
        ) {
            return;
        }

        editBlock(blockId, block => ({
            ...block,
            presetMode: "custom",

            levels: block.levels.filter(
                level => level.id !== levelId
            )
        }));
    }

    function addGroup(blockId) {
        editBlock(blockId, block => ({
            ...block,

            answerGroups: [
                ...block.answerGroups,
                makeAnswerGroup()
            ]
        }));
    }

    function updateGroup(blockId, groupId, patch) {
        editBlock(blockId, block => ({
            ...block,

            answerGroups: block.answerGroups.map(group =>
                group.id === groupId
                    ? { ...group, ...patch }
                    : group
            )
        }));
    }

    function removeGroup(blockId, groupId) {
        if (
            !window.confirm(
                "Remove this heading and all its answers from both language versions?"
            )
        ) {
            return;
        }

        editBlock(blockId, block => ({
            ...block,

            answerGroups: block.answerGroups.filter(
                group => group.id !== groupId
            )
        }));
    }

    function updateAnswer(
        blockId,
        groupId,
        answerId,
        patch
    ) {
        editBlock(blockId, block => ({
            ...block,

            answerGroups: block.answerGroups.map(group =>
                group.id !== groupId
                    ? group
                    : {
                        ...group,

                        answers: group.answers.map(answer =>
                            answer.id === answerId
                                ? { ...answer, ...patch }
                                : answer
                        )
                    }
            )
        }));
    }

    function addAnswer(blockId, groupId) {
        editBlock(blockId, block => ({
            ...block,

            answerGroups: block.answerGroups.map(group =>
                group.id !== groupId
                    ? group
                    : {
                        ...group,

                        answers: [
                            ...group.answers,
                            makeAnswer()
                        ]
                    }
            )
        }));
    }

    function removeAnswer(
        blockId,
        groupId,
        answerId
    ) {
        if (
            !window.confirm(
                "Remove this answer from both language versions?"
            )
        ) {
            return;
        }

        editBlock(blockId, block => ({
            ...block,

            answerGroups: block.answerGroups.map(group =>
                group.id !== groupId
                    ? group
                    : {
                        ...group,

                        answers: group.answers.filter(
                            answer => answer.id !== answerId
                        )
                    }
            )
        }));
    }

    function addBlock() {
        setBlocks(previous => [
            ...previous,
            makeBlock()
        ]);
    }

    function hasExistingContent() {
        return blocks.length > 1 || blocks.some(block => {
            const hasQuestionText = [
                block.number,
                block.part,
                block.sub,
                block.marks,
                block.question,
                block.questionZh,
                block.paperQuestion,
                block.paperQuestionZh
            ].some(value => String(value ?? "").trim());

            const hasChangedSettings =
                block.presetMode !== "auto" ||
                block.examplesMode !== "auto" ||
                block.extendAnswers ||
                block.levels.length > 0;

            const hasAnswerContent =
                block.answerGroups.some(group =>
                    group.heading.trim() ||
                    group.headingZh.trim() ||
                    group.answers.some(answer =>
                        answer.text.trim() ||
                        answer.clues.trim() ||
                        answer.textZh.trim() ||
                        answer.cluesZh.trim()
                    )
                );

            const hasAddedStructure =
                block.answerGroups.length !== 1 ||
                block.answerGroups.some(
                    group => group.answers.length !== 1
                );

            return (
                hasQuestionText ||
                hasChangedSettings ||
                hasAnswerContent ||
                hasAddedStructure
            );
        });
    }

    function inputSampleText() {
        if (
            hasExistingContent() &&
            !window.confirm(
                "Replace the shared question list and marking-scheme answers with the sample? Existing question-paper wording will be removed, but source sections will be kept."
            )
        ) {
            return;
        }

        setBlocks(sampleBlocks());
        setBlockLanguages({});
        setStatus("Bilingual sample marking scheme loaded.");

        overviewRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    function startBlankScheme() {
        if (
            hasExistingContent() &&
            !window.confirm(
                "Clear the shared question list, question-paper wording and marking-scheme answers in both languages? Source sections will be kept."
            )
        ) {
            return;
        }

        setBlocks(initialBlocks());
        setBlockLanguages({});
        setStatus("Blank marking scheme ready.");

        overviewRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    function removeBlock(blockId) {
        if (
            !window.confirm(
                "Remove this shared question, its question-paper wording, and its marking-scheme descriptors and answers in both languages?"
            )
        ) {
            return;
        }

        setBlocks(previous =>
            previous.filter(block => block.id !== blockId)
        );
    }

    function moveBlock(blockId, direction) {
        setBlocks(previous => {
            const from = previous.findIndex(
                block => block.id === blockId
            );

            const to = from + direction;

            if (
                from < 0 ||
                to < 0 ||
                to >= previous.length
            ) {
                return previous;
            }

            const next = [...previous];

            [next[from], next[to]] = [
                next[to],
                next[from]
            ];

            return next;
        });
    }

    function goToAnswers(blockId) {
        document
            .getElementById(`msg-block-${blockId}`)
            ?.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
    }

    function goToOverview(blockId) {
        overviewRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

        document
            .getElementById(
                `msg-question-${blockId}-${languages[0]}`
            )
            ?.focus({ preventScroll: true });
    }

    async function exportWord() {
        if (blocks.length === 0) {
            setStatus("Add at least one question first.");
            return;
        }

        const exportingPaper = activeTool === "questionPaper";

        setExporting(true);
        setStatus(
            exportingPaper
                ? "Creating English question paper…"
                : "Creating marking-scheme document(s)…"
        );

        let downloaded = 0;

        try {
            if (exportingPaper) {
                const response = await callApi({
                    action: "exportQuestionPaper",

                    language: paperLanguage,

                    paper: localizePaper(
                        paper,
                        paperLanguage
                    ),

                    blocks: blocks.map(block => ({
                        number: block.number,
                        part: block.part,
                        sub: block.sub,
                        marks: block.marks,

                        paperQuestion: paperLanguage === "zh"
                            ? block.paperQuestionZh || ""
                            : block.paperQuestion || "",

                        paperSectionId: paperSectionId(
                            block,
                            paper
                        )
                    }))
                });

                const result = response.data;

                if (typeof result?.base64 !== "string") {
                    throw new Error(
                        "The server did not return a Word document."
                    );
                }

                downloadBase64(
                    result.base64,
                    result.filename || "question-paper-english.docx"
                );

                downloaded = 1;

                setStatus(
                    `${languageLabel(paperLanguage)} question paper created.`
                );
                return;
            }

            /*
             * Both means two separate API exports and downloads.
             * The server never receives "both" for this button.
             */
            const exportLanguages =
                languagesForMode(languageMode);

            for (const language of exportLanguages) {
                setStatus(
                    `Creating ${languageLabel(language)} marking scheme…`
                );

                const response = await callApi({
                    action: "export",
                    languageMode: language,
                    blocks: exportPayload(blocks)
                });

                const result = response.data;

                if (typeof result?.base64 !== "string") {
                    throw new Error(
                        "The server did not return a Word document."
                    );
                }

                downloadBase64(
                    result.base64,
                    result.filename ||
                    `marking-scheme-${language}.docx`
                );

                downloaded += 1;

                /*
                 * Give the browser a short interval between
                 * separate download requests.
                 */
                if (exportLanguages.length > 1) {
                    await new Promise(resolve =>
                        window.setTimeout(resolve, 500)
                    );
                }
            }

            setStatus(
                downloaded === 2
                    ? "Two documents created: Chinese and English. If only one appears, allow multiple downloads for this site."
                    : "Marking-scheme document created."
            );
        } catch (error) {
            console.error("Word export failed:", error);

            setStatus(
                `${downloaded
                    ? `${downloaded} document downloaded. `
                    : ""
                }Could not complete export: ${error.message || "Unknown error"
                }`
            );
        } finally {
            setExporting(false);
        }
    }

    async function exportCombined() {
        if (!blocks.length) {
            setStatus("Add at least one question first.");
            return;
        }

        /*
         * Follow the shared language selection:
         * English -> one English document
         * Chinese -> one Chinese document
         * Both -> two separate documents
         */
        const selectedLanguages =
            languagesForMode(languageMode);

        const missing = selectedLanguages.some(language =>
            blocks.some(block => {
                const paperText = language === "zh"
                    ? block.paperQuestionZh
                    : block.paperQuestion;

                const schemeText = language === "zh"
                    ? block.questionZh
                    : block.question;

                return !paperText?.trim() || !schemeText?.trim();
            })
        );

        if (
            missing &&
            !window.confirm(
                "Some question wording is blank in the selected language(s). Blank contents will remain blank and will not be translated automatically. Continue?"
            )
        ) {
            return;
        }

        setExporting(true);
        let downloaded = 0;

        try {
            for (const language of selectedLanguages) {
                setStatus(
                    `Creating combined ${languageLabel(language)} document…`
                );

                const response = await callApi({
                    action: "exportCombined",
                    languageMode: language,

                    blocks: exportPayload(blocks),

                    paper: localizePaper(paper, language),

                    paperBlocks: blocks.map(block => ({
                        number: block.number,
                        part: block.part,
                        sub: block.sub,
                        marks: block.marks,

                        paperQuestion: language === "zh"
                            ? block.paperQuestionZh || ""
                            : block.paperQuestion || "",

                        paperSectionId: paperSectionId(
                            block,
                            paper
                        )
                    }))
                });

                const result = response.data;

                if (typeof result?.base64 !== "string") {
                    throw new Error(
                        "The server did not return a Word document."
                    );
                }

                downloadBase64(
                    result.base64,
                    result.filename
                );

                downloaded += 1;

                if (selectedLanguages.length > 1) {
                    await new Promise(resolve =>
                        window.setTimeout(resolve, 500)
                    );
                }
            }

            setStatus(
                selectedLanguages.length === 2
                    ? "Two combined documents created: Chinese and English. Each marking scheme starts on a new page. Allow multiple downloads if your browser asks."
                    : `${languageLabel(selectedLanguages[0])} combined document created. The marking scheme starts on a new page.`
            );
        } catch (error) {
            console.error("Combined export failed:", error);

            setStatus(
                `${downloaded
                    ? `${downloaded} document downloaded. `
                    : ""
                }Combined export failed: ${error.message || "Unknown error"
                }`
            );
        } finally {
            setExporting(false);
        }
    }

    if (access === "checking") {
        return (
            <main className="msg-page">
                <section className="msg-panel" role="status">
                    Checking administrator access…
                </section>
            </main>
        );
    }

    if (access === "denied") {
        return (
            <main className="msg-page">
                <section className="msg-panel">
                    <h1>Document Generator</h1>

                    <p>Administrator access is required.</p>

                    <p className="msg-note" role="alert">
                        {accessMessage}
                    </p>

                    <button
                        type="button"
                        onClick={() =>
                            setAccessAttempt(previous => previous + 1)
                        }
                    >
                        Check access again
                    </button>
                </section>
            </main>
        );
    }

    return (
        <main className="msg-page">
            <header className="msg-intro">
                <div className="msg-toolbar">
                    <div>
                        <h1>Question paper and marking scheme</h1>

                        <p className="msg-note">
                            Use the shared question overview, then
                            choose Question paper or Marking scheme.
                            Numbers and marks are shared; wording is separate.
                        </p>
                    </div>

                    <button
                        type="button"
                        className="msg-primary"
                        disabled={exporting || blocks.length === 0}
                        onClick={exportWord}
                    >
                        {exporting
                            ? "Creating document…"
                            : "Download Word"}
                    </button>
                </div>

                <div className="msg-combined-download">
                    <button
                        type="button"
                        className="msg-primary"
                        disabled={exporting || blocks.length === 0}
                        onClick={exportCombined}
                    >
                        {exporting
                            ? "Creating document(s)…"
                            : languageMode === "both"
                                ? "Download paper + marking scheme — English and 中文"
                                : `Download paper + marking scheme — ${languageLabel(languageMode)
                                }`}
                    </button>

                    <span role="status" aria-live="polite">
                        {status}
                    </span>
                </div>

                <p className="msg-warning">
                    Drafts are not saved. Download your document
                    before leaving or reloading this page.
                </p>

                <p className="msg-note">
                    English: <code>***text***</code> means bold italic.
                    Chinese: <code>***文字***</code> means bold only.
                    Answers and supporting details appear one above
                    the other in Word.
                </p>
            </header>

            <div
                className="msg-tool-tabs"
                role="group"
                aria-label="Document editor"
            >
                <button
                    type="button"
                    aria-pressed={activeTool === "questionPaper"}
                    disabled={exporting}
                    onClick={() => {
                        setActiveTool("questionPaper");
                        setStatus("");
                    }}
                >
                    Question paper
                </button>

                <button
                    type="button"
                    aria-pressed={activeTool === "markingScheme"}
                    disabled={exporting}
                    onClick={() => {
                        setActiveTool("markingScheme");
                        setStatus("");
                    }}
                >
                    Marking scheme
                </button>
            </div>

            <section
                ref={overviewRef}
                className="msg-panel msg-overview"
            >
                <div className="msg-section-header">
                    <h2>1. Shared question overview</h2>

                    <div className="msg-overview-buttons">
                        <button
                            type="button"
                            disabled={exporting}
                            onClick={inputSampleText}
                        >
                            Load marking-scheme sample
                        </button>

                        <button
                            type="button"
                            disabled={exporting}
                            onClick={startBlankScheme}
                        >
                            Clear questions / answers
                        </button>

                        <button
                            type="button"
                            className="msg-primary"
                            onClick={addBlock}
                        >
                            + Add question
                        </button>
                    </div>
                </div>

                <fieldset className="msg-language-options">
                    <legend>
                        Document languages — shared by both tools
                    </legend>

                    {[
                        ["en", "English"],
                        ["zh", "中文"],
                        ["both", "Both / 中英雙語"]
                    ].map(([value, label]) => (
                        <label
                            key={value}
                            className="msg-checkbox"
                        >
                            <input
                                type="radio"
                                name="msg-language-mode"
                                value={value}
                                checked={languageMode === value}
                                disabled={exporting}
                                onChange={() =>
                                    setLanguageMode(value)
                                }
                            />

                            <span>{label}</span>
                        </label>
                    ))}
                </fieldset>

                <p className="msg-note">
                    Numbers, parts, subquestions and marks are shared.
                    Paper wording updates the matching language’s
                    marking-scheme wording, never the reverse.
                    English and Chinese source contents remain separate.
                    Switching languages does not delete either version.
                </p>

                <p className="msg-note">
                    Enter a number such as 2, a part such as a,
                    and a subquestion such as ii. Output automatically
                    adds the full stop and parentheses: 2., (a), (ii).
                    Leave repeated numbers or unused parts blank.
                    Enter marks once, such as 3; output formats
                    them for each language.
                </p>

                <div className="msg-overview-scroll">
                    <table className="msg-overview-table">
                        <colgroup>
                            <col style={{ width: "42px" }} />
                            <col style={{ width: "75px" }} />
                            <col style={{ width: "75px" }} />
                            <col style={{ width: "88px" }} />
                            <col style={{ width: "110px" }} />
                            <col />
                            <col style={{ width: "148px" }} />
                        </colgroup>

                        <thead>
                            <tr>
                                <th scope="col">#</th>
                                <th scope="col">Number</th>
                                <th scope="col">Part</th>
                                <th scope="col">Subquestion</th>
                                <th scope="col">Total marks</th>
                                <th scope="col">Question text</th>
                                <th scope="col">Actions</th>
                            </tr>
                        </thead>

                        <tbody>
                            {blocks.map((block, index) => (
                                <tr key={block.id}>
                                    <td className="msg-row-number">
                                        {index + 1}
                                    </td>

                                    {[
                                        ["number", "number", "3"],
                                        ["part", "part", "a"],
                                        ["sub", "subquestion", "i"],
                                        ["marks", "total marks", "3"]
                                    ].map(([key, label, placeholder]) => (
                                        <td key={key}>
                                            <input
                                                aria-label={
                                                    `Question ${index + 1}: ${label}`
                                                }
                                                value={block[key]}
                                                placeholder={placeholder}
                                                onChange={event =>
                                                    updateBlock(block.id, {
                                                        [key]: event.target.value
                                                    })
                                                }
                                            />
                                        </td>
                                    ))}

                                    <td>
                                        {activeTool === "questionPaper" ? (
                                            <>
                                                <label className="msg-field">
                                                    <span>Main question group</span>

                                                    <select
                                                        value={paperSectionId(block, paper)}
                                                        onChange={event =>
                                                            updateBlock(block.id, {
                                                                paperSectionId:
                                                                    event.target.value
                                                            })
                                                        }
                                                    >
                                                        {paper.sections.map(
                                                            (section, sectionIndex) => (
                                                                <option
                                                                    key={section.id}
                                                                    value={section.id}
                                                                >
                                                                    Group {sectionIndex + 1}
                                                                    {section.topic.trim()
                                                                        ? ` — ${section.topic}`
                                                                        : ""}
                                                                </option>
                                                            )
                                                        )}
                                                    </select>
                                                </label>

                                                {languages.map(language => {
                                                    const chinese = language === "zh";

                                                    const key = chinese
                                                        ? "paperQuestionZh"
                                                        : "paperQuestion";

                                                    return (
                                                        <label
                                                            key={language}
                                                            className="msg-overview-language-field"
                                                        >
                                                            <span>
                                                                {chinese
                                                                    ? "中文試卷題目"
                                                                    : "English question-paper wording"}
                                                            </span>

                                                            <textarea
                                                                id={
                                                                    `msg-paper-question-${block.id}-${language}`
                                                                }
                                                                aria-label={
                                                                    `Question ${index + 1}: ${languageLabel(language)
                                                                    } question-paper text`
                                                                }
                                                                lang={chinese ? "zh-TW" : "en"}
                                                                className={
                                                                    chinese
                                                                        ? "msg-chinese-input"
                                                                        : undefined
                                                                }
                                                                rows={3}
                                                                value={block[key] || ""}
                                                                placeholder={
                                                                    chinese
                                                                        ? "輸入中文試卷題目……"
                                                                        : "Enter question-paper wording…"
                                                                }
                                                                onChange={event =>
                                                                    updateBlock(block.id, {
                                                                        [key]: event.target.value
                                                                    })
                                                                }
                                                            />
                                                        </label>
                                                    );
                                                })}
                                            </>
                                        ) : (
                                            languages.map(language => {
                                                const key = language === "zh"
                                                    ? "questionZh"
                                                    : "question";

                                                return (
                                                    <label
                                                        key={language}
                                                        className="msg-overview-language-field"
                                                    >
                                                        <span>
                                                            {languageLabel(language)}
                                                            {" "}marking-scheme wording
                                                        </span>

                                                        <textarea
                                                            id={
                                                                `msg-question-${block.id}-${language}`
                                                            }
                                                            aria-label={
                                                                `Question ${index + 1}: ${languageLabel(language)
                                                                } marking-scheme question text`
                                                            }
                                                            lang={
                                                                language === "zh"
                                                                    ? "zh-TW"
                                                                    : "en"
                                                            }
                                                            className={
                                                                language === "zh"
                                                                    ? "msg-chinese-input"
                                                                    : undefined
                                                            }
                                                            rows={2}
                                                            value={block[key]}
                                                            placeholder={
                                                                language === "zh"
                                                                    ? "輸入中文題目……"
                                                                    : "Enter English question text…"
                                                            }
                                                            onChange={event =>
                                                                updateBlock(block.id, {
                                                                    [key]:
                                                                        event.target.value
                                                                })
                                                            }
                                                        />
                                                    </label>
                                                );
                                            })
                                        )}
                                    </td>

                                    <td>
                                        <div className="msg-row-actions">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (activeTool === "questionPaper") {
                                                        document
                                                            .getElementById("msg-paper-editor")
                                                            ?.scrollIntoView({
                                                                behavior: "smooth",
                                                                block: "start"
                                                            });

                                                        return;
                                                    }

                                                    goToAnswers(block.id);
                                                }}
                                            >
                                                {activeTool === "questionPaper"
                                                    ? "Edit sources"
                                                    : "Edit answers"}
                                            </button>

                                            <div className="msg-inline-actions">
                                                <button
                                                    type="button"
                                                    aria-label={
                                                        `Move question ${index + 1} up`
                                                    }
                                                    disabled={index === 0}
                                                    onClick={() =>
                                                        moveBlock(block.id, -1)
                                                    }
                                                >
                                                    ↑
                                                </button>

                                                <button
                                                    type="button"
                                                    aria-label={
                                                        `Move question ${index + 1} down`
                                                    }
                                                    disabled={
                                                        index === blocks.length - 1
                                                    }
                                                    onClick={() =>
                                                        moveBlock(block.id, 1)
                                                    }
                                                >
                                                    ↓
                                                </button>

                                                <button
                                                    type="button"
                                                    className="msg-danger"
                                                    onClick={() =>
                                                        removeBlock(block.id)
                                                    }
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            ))}

                            {blocks.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="msg-empty">
                                        No questions yet. Click “Add question”.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="msg-overview-footer">
                    <button type="button" onClick={addBlock}>
                        + Add question
                    </button>

                    <span className="msg-note">
                        Automatic presets: 3 → source;
                        4 → source; 8 → eight-mark preset.
                    </span>
                </div>
            </section>

            {activeTool === "questionPaper" && (
                <div id="msg-paper-editor">
<WorksheetSettings
            paper={paper}
            setPaper={setPaper}
            blocks={blocks}
          />

          <LanguageTabs
            id="msg-paper-source-language"
            languages={languages}
            value={paperLanguage}
            onChange={setPaperLanguage}
            label="Question-paper source language"
          />

                    <div
                        id="msg-paper-source-language-panel"
                        role={
                            languages.length > 1
                                ? "tabpanel"
                                : undefined
                        }
                        aria-labelledby={
                            languages.length > 1
                                ? `msg-paper-source-language-tab-${paperLanguage}`
                                : undefined
                        }
                    >
                        <QuestionPaper
                            paper={paper}
                            setPaper={setPaper}
                            blocks={blocks}
                            updateBlock={updateBlock}
                            language={paperLanguage}
                        />
                    </div>

                    <section className="msg-panel">
                        <div className="msg-actions">
                            <button
                                type="button"
                                className="msg-primary"
                                disabled={
                                    exporting || blocks.length === 0
                                }
                                onClick={exportWord}
                            >
                                {exporting
                                    ? "Creating document…"
                                    : `Download ${languageLabel(paperLanguage)} question paper (.docx)`}
                            </button>

                            <span role="status" aria-live="polite">
                                {status}
                            </span>
                        </div>
                    </section>
                </div>
            )}

            {activeTool === "markingScheme" && (
                <>
                    <h2 className="msg-stage-title">
                        2. Descriptors and answers
                    </h2>

                    {blocks.map((block, index) => {
                        const selectedLanguage =
                            blockLanguages[block.id];

                        const language =
                            languages.includes(selectedLanguage)
                                ? selectedLanguage
                                : languages[0];

                        const chinese = language === "zh";

                        const questionText = chinese
                            ? block.questionZh
                            : block.question;

                        const descriptionKey = chinese
                            ? "descriptionZh"
                            : "description";

                        const headingKey = chinese
                            ? "headingZh"
                            : "heading";

                        const answerKey = chinese
                            ? "textZh"
                            : "text";

                        const cluesKey = chinese
                            ? "cluesZh"
                            : "clues";

                        const tabId = `msg-content-${block.id}`;
                        const hasExamples = showExamplesForBlock(block);

                        return (
                            <section
                                key={block.id}
                                id={`msg-block-${block.id}`}
                                className="msg-panel msg-question-block"
                            >
                                <div className="msg-section-header">
                                    <h2>
                                        {questionLabel(block, index)}

                                        {block.marks.trim() && (
                                            <span className="msg-marks-badge">
                                                {block.marks}
                                            </span>
                                        )}
                                    </h2>

                                    <button
                                        type="button"
                                        onClick={() =>
                                            goToOverview(block.id)
                                        }
                                    >
                                        Edit question above ↑
                                    </button>
                                </div>

                                <div className="msg-shared-settings msg-compact-settings">
                                    <label className="msg-field">
                                        <span>Descriptor preset</span>

                                        <select
                                            value={block.presetMode}
                                            title="Changing the preset replaces descriptors in both languages."
                                            onChange={event =>
                                                changePreset(
                                                    block.id,
                                                    event.target.value
                                                )
                                            }
                                        >
                                            <option value="auto">
                                                Automatic — follow marks
                                            </option>

                                            {Object.entries(PRESETS).map(
                                                ([key, preset]) => (
                                                    <option key={key} value={key}>
                                                        {preset.label}
                                                    </option>
                                                )
                                            )}

                                            <option value="none">
                                                No descriptors
                                            </option>

                                            <option value="custom" disabled>
                                                Custom
                                            </option>
                                        </select>
                                    </label>

                                    <label
                                        className="msg-checkbox"
                                        title="Extend headings, answers and details into the empty marks column."
                                    >
                                        <input
                                            type="checkbox"
                                            checked={block.extendAnswers}
                                            onChange={event =>
                                                updateBlock(block.id, {
                                                    extendAnswers: event.target.checked
                                                })
                                            }
                                        />

                                        <span>Use full answer width</span>
                                    </label>

                                    <label className="msg-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={hasExamples}
                                            onChange={event =>
                                                updateBlock(block.id, {
                                                    examplesMode: event.target.checked
                                                        ? "on"
                                                        : "off"
                                                })
                                            }
                                        />

                                        <span>“e.g.” / “例：”</span>
                                    </label>
                                </div>

                                <LanguageTabs
                                    id={tabId}
                                    languages={languages}
                                    value={language}
                                    onChange={nextLanguage =>
                                        setBlockLanguages(previous => ({
                                            ...previous,
                                            [block.id]: nextLanguage
                                        }))
                                    }
                                />

                                <div
                                    id={`${tabId}-panel`}
                                    role={
                                        languages.length > 1
                                            ? "tabpanel"
                                            : undefined
                                    }
                                    aria-labelledby={
                                        languages.length > 1
                                            ? `${tabId}-tab-${language}`
                                            : undefined
                                    }
                                >
                                    <p className="msg-content-language">
                                        Editing: {languageLabel(language)}
                                    </p>

                                    {questionText.trim() && (
                                        <p
                                            className={
                                                `msg-question-reference ${chinese ? "msg-chinese-content" : ""
                                                }`
                                            }
                                            lang={chinese ? "zh-TW" : "en"}
                                        >
                                            <RichText
                                                text={questionText}
                                                language={language}
                                            />
                                        </p>
                                    )}

                                    <details className="msg-descriptor-details">
                                        <summary>
                                            <span>
                                                {chinese
                                                    ? "等級描述 / Level descriptors"
                                                    : "Level descriptors"}
                                            </span>

                                            <span className="msg-descriptor-status">
                                                {descriptorSummary(block)}
                                            </span>
                                        </summary>

                                        <div className="msg-descriptor-body">
                                            <p className="msg-note">
                                                Level labels and maximum marks are
                                                shared. Descriptor wording is separate
                                                for each language. Maximum marks such
                                                as 3 or [max. 3] are automatically
                                                displayed as [最多3分] in Chinese.
                                            </p>

                                            {block.levels.map(level => (
                                                <div
                                                    key={level.id}
                                                    className="msg-level-row"
                                                >
                                                    <Field
                                                        label="Level — shared"
                                                        value={level.label}
                                                        placeholder="L1"
                                                        onChange={label =>
                                                            updateLevel(
                                                                block.id,
                                                                level.id,
                                                                { label }
                                                            )
                                                        }
                                                    />

                                                    <Field
                                                        label={
                                                            chinese ? "中文描述" : "English descriptor"
                                                        }
                                                        multiline
                                                        language={language}
                                                        value={level[descriptionKey]}
                                                        onChange={description =>
                                                            updateLevel(
                                                                block.id,
                                                                level.id,
                                                                {
                                                                    [descriptionKey]: description
                                                                }
                                                            )
                                                        }
                                                    />

                                                    <Field
                                                        label="Max. marks — shared"
                                                        value={level.marks}
                                                        placeholder="3"
                                                        onChange={marks =>
                                                            updateLevel(
                                                                block.id,
                                                                level.id,
                                                                { marks }
                                                            )
                                                        }
                                                    />

                                                    <button
                                                        type="button"
                                                        className="msg-danger"
                                                        onClick={() =>
                                                            removeLevel(
                                                                block.id,
                                                                level.id
                                                            )
                                                        }
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            ))}

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    addLevel(block.id)
                                                }
                                            >
                                                + Add level to both languages
                                            </button>
                                        </div>
                                    </details>

                                    <div className="msg-answer-toolbar">
                                        <h3>
                                            {chinese ? "答案 / Answers" : "Answers"}
                                        </h3>

                                        <span className="msg-note">
                                            {languageLabel(language)} contents
                                        </span>
                                    </div>

                                    {block.answerGroups.map(
                                        (group, groupIndex) => (
                                            <div
                                                key={group.id}
                                                className="msg-answer-group"
                                            >
                                                <div className="msg-group-heading">
                                                    <Field
                                                        label={
                                                            chinese
                                                                ? `答案組 ${groupIndex + 1} 標題 — 可留空`
                                                                : `Answer group ${groupIndex + 1} heading — optional`
                                                        }
                                                        language={language}
                                                        value={group[headingKey]}
                                                        placeholder={
                                                            chinese ? "原因：" : "Reasons:"
                                                        }
                                                        onChange={heading =>
                                                            updateGroup(
                                                                block.id,
                                                                group.id,
                                                                { [headingKey]: heading }
                                                            )
                                                        }
                                                    />

                                                    <button
                                                        type="button"
                                                        className="msg-danger"
                                                        onClick={() =>
                                                            removeGroup(
                                                                block.id,
                                                                group.id
                                                            )
                                                        }
                                                    >
                                                        Remove group
                                                    </button>
                                                </div>

                                                {group.answers.map(
                                                    (answer, answerIndex) => (
                                                        <div
                                                            key={answer.id}
                                                            className="msg-answer-row"
                                                        >
                                                            <div className="msg-answer-index">
                                                                {answerIndex + 1}
                                                            </div>

                                                            <div className="msg-answer-fields">
                                                                <Field
                                                                    label={
                                                                        chinese ? "答案" : "Answer"
                                                                    }
                                                                    multiline
                                                                    language={language}
                                                                    value={answer[answerKey]}
                                                                    onChange={text =>
                                                                        updateAnswer(
                                                                            block.id,
                                                                            group.id,
                                                                            answer.id,
                                                                            { [answerKey]: text }
                                                                        )
                                                                    }
                                                                />

                                                                <Field
                                                                    label={
                                                                        chinese
                                                                            ? "線索 / 支持細節"
                                                                            : "Clues / supporting details"
                                                                    }
                                                                    multiline
                                                                    language={language}
                                                                    value={answer[cluesKey]}
                                                                    placeholder={
                                                                        chinese ? "可留空" : "Optional"
                                                                    }
                                                                    onChange={clues =>
                                                                        updateAnswer(
                                                                            block.id,
                                                                            group.id,
                                                                            answer.id,
                                                                            { [cluesKey]: clues }
                                                                        )
                                                                    }
                                                                />
                                                            </div>

                                                            <button
                                                                type="button"
                                                                className="msg-danger"
                                                                aria-label={
                                                                    `Remove answer ${answerIndex + 1}`
                                                                }
                                                                onClick={() =>
                                                                    removeAnswer(
                                                                        block.id,
                                                                        group.id,
                                                                        answer.id
                                                                    )
                                                                }
                                                            >
                                                                Remove
                                                            </button>
                                                        </div>
                                                    )
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        addAnswer(block.id, group.id)
                                                    }
                                                >
                                                    + Add answer to both languages
                                                </button>
                                            </div>
                                        )
                                    )}

                                    <button
                                        type="button"
                                        onClick={() =>
                                            addGroup(block.id)
                                        }
                                    >
                                        + Add heading / answer group to both languages
                                    </button>
                                </div>
                            </section>
                        );
                    })}

                    <section className="msg-panel">
                        <h2>3. Layout preview</h2>

                        <p className="msg-note">
                            Each question uses its own layout.
                            The preview reflects the answer-width checkbox.
                            Language tabs change only the preview, not which
                            languages are exported.
                        </p>

                        <LanguageTabs
                            id="msg-preview-language"
                            languages={languages}
                            value={effectivePreviewLanguage}
                            onChange={setPreviewLanguage}
                            label="Preview language"
                        />

                        <div
                            id="msg-preview-language-panel"
                            role={
                                languages.length > 1
                                    ? "tabpanel"
                                    : undefined
                            }
                            aria-labelledby={
                                languages.length > 1
                                    ? `msg-preview-language-tab-${effectivePreviewLanguage}`
                                    : undefined
                            }
                        >
                            <div className="msg-preview-scroll">
                                <div className="msg-preview">
                                    {blocks.map(block => (
                                        <PreviewBlock
                                            key={block.id}
                                            block={block}
                                            language={effectivePreviewLanguage}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>

                        <p className="msg-note">
                            Word output: A4 portrait, 12 pt, hidden table
                            borders. Chinese uses PMingLiU / 新細明體;
                            Latin letters and numbers use Times New Roman.
                            Browser and Word line wrapping may differ.
                            Enter both languages yourself; ordinary question
                            and answer text is not automatically translated.
                        </p>

                        <div className="msg-actions">
                            <button
                                type="button"
                                className="msg-primary"
                                disabled={exporting || blocks.length === 0}
                                onClick={exportWord}
                            >
                                {exporting
                                    ? "Creating document…"
                                    : "Download Word (.docx)"}
                            </button>

                            <span role="status" aria-live="polite">
                                {status}
                            </span>
                        </div>
                    </section>
                </>
            )}
        </main>
    );
}