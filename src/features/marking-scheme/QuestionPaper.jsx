import React from "react";

import {
  makeId,
  parenthesized,
  questionNumber,
  richParts
} from "./markingSchemeModel.js";

export function makePaperSource(label = "A") {
  return {
    id: makeId(),
    label,
    description: "",
    type: "extract",

    extract: "",

    rows: 3,
    columns: 2,
    widths: [25, 75],
    cells: [
      ["", ""],
      ["", ""],
      ["", ""]
    ],
    headerRow: true,

    pictureHeight: 60
  };
}

export function makePaperSection() {
  return {
    id: makeId(),
    topic: "",
    sources: [
      makePaperSource("A"),
      makePaperSource("B")
    ]
  };
}

export function defaultWorksheetSettings() {
  /*
   * Use the computer's local date.
   *
   * September to December:
   * academic year starts in the current calendar year.
   *
   * January to August:
   * academic year started in the previous calendar year.
   */
  const today = new Date();

  const startYear = today.getMonth() >= 8
    ? today.getFullYear()
    : today.getFullYear() - 1;

  const endYear = String(startYear + 1).slice(-2);

return {
    enabled: false,
    academicYear: `${startYear}-${endYear}`,
    level: "S4",

    assessmentEn: "Quiz 4",
    assessmentZh: "小測4"
  };
}

export function initialPaper() {
  return {
    worksheet: defaultWorksheetSettings(),
    sections: [makePaperSection()]
  };
}

function numericQuestionMark(value) {
  const match = String(value ?? "").match(
    /^\s*[\[(（]?\s*(\d+)\s*(?:marks?|分)?\s*[\])）]?\s*$/i
  );

  return match ? Number(match[1]) : null;
}

function worksheetTotal(blocks) {
  let total = 0;

  for (const block of blocks) {
    const value = String(block.marks ?? "").trim();

    // Blank mark fields contribute zero.
    if (!value) continue;

    const mark = numericQuestionMark(value);

    if (mark === null) return null;

    total += mark;
  }

  return total;
}

function worksheetTitle(paper, language) {
  const settings = paper.worksheet;

  if (!settings) return "";

  const topic = String(
    paper.sections[0]?.topic || ""
  )
    .replace(/\*\*\*/g, "")
    .trim();

  const academicYear = String(
    settings.academicYear || ""
  ).trim();

  /*
   * Retain compatibility with the previous quizNumber
   * setting until the new label fields are edited.
   */
  const oldNumber = String(
    settings.quizNumber ?? "4"
  ).trim();

  const assessmentEn = String(
    settings.assessmentEn ??
      (oldNumber ? `Quiz ${oldNumber}` : "Quiz")
  ).trim();

  const assessmentZh = String(
    settings.assessmentZh ??
      (oldNumber ? `小測${oldNumber}` : "小測")
  ).trim();

  const chineseLevel = {
    S4: "中四級",
    S5: "中五級",
    S6: "中六級"
  }[settings.level] || "中四級";

  const base = language === "zh"
    ? [
        academicYear,
        "歷史科",
        chineseLevel,
        assessmentZh
      ].filter(Boolean).join(" ")
    : [
        academicYear,
        "History",
        settings.level,
        assessmentEn
      ].filter(Boolean).join(" ");

  return topic ? `${base} - ${topic}` : base;
}

export function WorksheetSettings({
  paper,
  setPaper,
  blocks
}) {
  const settings =
    paper.worksheet || defaultWorksheetSettings();

  const total = worksheetTotal(blocks);

  function updateSettings(patch) {
    setPaper(previous => ({
      ...previous,

      worksheet: {
        ...(
          previous.worksheet ||
          defaultWorksheetSettings()
        ),
        ...patch
      }
    }));
  }

  return (
    <section className="msg-panel qp-worksheet-settings">
      <label className="msg-checkbox">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={event =>
            updateSettings({
              enabled: event.target.checked
            })
          }
        />

        <span>
          Add worksheet heading, student details and score box
        </span>
      </label>

      {settings.enabled && (
        <>
          <div className="qp-worksheet-setting-fields">
            <label className="msg-field">
              <span>Academic year</span>

              <input
                type="text"
                value={settings.academicYear}
                placeholder="2026-27"
                onChange={event =>
                  updateSettings({
                    academicYear: event.target.value
                  })
                }
              />
            </label>

            <label className="msg-field">
              <span>Form</span>

              <select
                value={settings.level}
                onChange={event =>
                  updateSettings({
                    level: event.target.value
                  })
                }
              >
                <option value="S4">S4 / 中四級</option>
                <option value="S5">S5 / 中五級</option>
                <option value="S6">S6 / 中六級</option>
              </select>
            </label>

<label className="msg-field">
              <span>English worksheet label</span>

              <input
                type="text"
                value={
                  settings.assessmentEn ??
                  `Quiz ${settings.quizNumber ?? "4"}`
                }
                placeholder="Practice 4"
                onChange={event =>
                  updateSettings({
                    assessmentEn: event.target.value
                  })
                }
              />
            </label>

            <label className="msg-field">
              <span>中文工作紙名稱</span>

              <input
                type="text"
                lang="zh-TW"
                className="msg-chinese-input"
                value={
                  settings.assessmentZh ??
                  `小測${settings.quizNumber ?? "4"}`
                }
                placeholder="習作4"
                onChange={event =>
                  updateSettings({
                    assessmentZh: event.target.value
                  })
                }
              />
            </label>

            <div className="qp-worksheet-total">
              <span>Total marks</span>

              <strong>
                {total === null ? "Check marks" : total}
              </strong>
            </div>
          </div>

          <p className="msg-note">
            Academic year defaults from your computer's
            date, using 1 September as the start.
            You can edit it. The heading uses the first
            main question group's topic in the selected
            language. A blank topic adds no dash.
            Total marks include every question row once.
          </p>

          {total === null && (
            <p className="msg-warning">
              A marks field could not be read as a number.
              Use entries such as 3, [3 marks] or [3分]
              so the score box can be calculated.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function WorksheetPreview({
  paper,
  blocks,
  language
}) {
  if (!paper.worksheet?.enabled) return null;

  const total = worksheetTotal(blocks);

  return (
    <div className="qp-worksheet-preview">
      <div className="qp-worksheet-preview-details">
        <p className="qp-worksheet-preview-title">
          {worksheetTitle(paper, language)}
        </p>

        <div className="qp-worksheet-student-row">
          <span>
            {language === "zh" ? "姓名：" : "Name:"}
            {" "}
            <span className="qp-student-line" />
          </span>

          <span>
            {language === "zh" ? "班別：" : "Class:"}
            {" "}
            <span className="qp-class-line" />
            {" (　  )"}
          </span>
        </div>

        <div className="qp-worksheet-date-row">
          {language === "zh" ? "日期：" : "Date:"}
          {" "}
          <span className="qp-student-line" />
        </div>
      </div>

      <div className="qp-worksheet-score">
        /{total === null ? "?" : total}
      </div>
    </div>
  );
}

function sourceName(source) {
  return source.label.trim();
}

export function sourceInstruction(
  sources,
  language = "en"
) {
  const labels = sources
    .map(sourceName)
    .filter(Boolean);

  if (!labels.length) return "";

  if (language === "zh") {
    return `細閱資料${labels.join("及")}。`;
  }

  if (labels.length === 1) {
    return `Study Source ${labels[0]}.`;
  }

  if (labels.length === 2) {
    return `Study Sources ${labels[0]} and ${labels[1]}.`;
  }

  return (
    `Study Sources ${labels.slice(0, -1).join(", ")}` +
    ` and ${labels[labels.length - 1]}.`
  );
}

export function paperSectionId(block, paper) {
  const exists = paper.sections.some(
    section => section.id === block.paperSectionId
  );

  return exists
    ? block.paperSectionId
    : paper.sections[0]?.id;
}

function Rich({
  text,
  automaticNumbers = false,
  language = "en"
}) {
  const parts = richParts(text).flatMap(part => {
    if (part.emphasized || !automaticNumbers) {
      return [part];
    }

    const splitPattern = language === "zh"
      ? /(一項|一個|兩項|兩個)/g
      : /(\b(?:one|two)\b)/gi;

    const exactPattern = language === "zh"
      ? /^(?:一項|一個|兩項|兩個)$/
      : /^(?:one|two)$/i;

    return part.text
      .split(splitPattern)
      .filter(Boolean)
      .map(value => ({
        text: value,
        emphasized: exactPattern.test(value)
      }));
  });

  return parts.map((part, index) => {
    if (!part.emphasized) {
      return (
        <React.Fragment key={index}>
          {part.text}
        </React.Fragment>
      );
    }

    return (
      <strong key={index}>
        {language === "zh"
          ? part.text
          : <em>{part.text}</em>}
      </strong>
    );
  });
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  type = "text",
  min,
  max
}) {
  const Control = multiline ? "textarea" : "input";

  return (
    <label className="msg-field">
      <span>{label}</span>

      <Control
        value={value}
        onChange={event => onChange(event.target.value)}
        {...(
          multiline
            ? { rows: 3 }
            : { type, min, max }
        )}
      />
    </label>
  );
}

function resizeSource(source, rows, columns) {
  return {
    ...source,
    rows,
    columns,

    widths: Array.from(
      { length: columns },
      (_, index) => source.widths[index] || 1
    ),

    cells: Array.from(
      { length: rows },
      (_, row) =>
        Array.from(
          { length: columns },
          (_, column) =>
            source.cells[row]?.[column] || ""
        )
    )
  };
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);

  if (!Number.isInteger(number)) return null;
  if (number < minimum || number > maximum) return null;

  return number;
}

function questionMarks(value, language = "en") {
  const text = String(value || "").trim();

  const match = text.match(
    /^\[?\s*(\d+)\s*(?:marks?|分)?\s*\]?$/i
  );

  if (!match) return text;

  const number = Number(match[1]);

  if (language === "zh") {
    return `(${number}分)`;
  }

  return `(${number}\u00A0${number === 1 ? "mark" : "marks"})`;
}

function paragraphTexts(value) {
  return String(value || "")
    .split(/\r?\n\s*\r?\n+/)
    .map(text => text.trim())
    .filter(Boolean);
}

function PreviewSource({ source, language = "en" }) {
  const total = source.widths.reduce(
    (sum, width) => sum + Number(width || 0),
    0
  ) || 1;

  return (
    <div className="qp-preview-source">
<p className="qp-source-label">
        {language === "zh"
          ? `資料${source.label}`
          : `SOURCE ${source.label}`}
      </p>

      {source.description.trim() && (
        <p className="qp-source-description">
<Rich
            text={source.description}
            language={language}
          />
        </p>
      )}

      {source.type === "table" && (
        <table className="qp-preview-source-table">
          <colgroup>
            {source.widths.map((width, index) => (
              <col
                key={index}
                style={{
                  width: `${Number(width) / total * 100}%`
                }}
              />
            ))}
          </colgroup>

          <tbody>
            {source.cells.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((text, columnIndex) => (
                  <td
                    key={columnIndex}
                    style={{
                      fontWeight:
                        source.headerRow && rowIndex === 0
                          ? "bold"
                          : "normal"
                    }}
                  >
<Rich
                      text={text}
                      language={language}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {source.type === "extract" && (
        <div className="qp-preview-extract">
          {paragraphTexts(source.extract).length
            ? paragraphTexts(source.extract).map(
                (text, index) => (
                  <p key={index}>
<Rich
                      text={text}
                      language={language}
                    />
                  </p>
                )
              )
            : <p>&nbsp;</p>}
        </div>
      )}

      {source.type === "picture" && (
        <div
          className="qp-preview-picture"
          style={{
            minHeight: `${source.pictureHeight}mm`
          }}
        >
          Picture space — paste your picture into Word
          after downloading
        </div>
      )}
    </div>
  );
}

/*
 * A language-specific view of the same source structure.
 * Source labels, types, sizes and table dimensions are shared.
 * Text contents are separate.
 */
export function localizePaper(paper, language = "en") {
  if (language !== "zh") return paper;

  return {
    ...paper,

    sections: paper.sections.map(section => ({
      ...section,

      topic: section.topicZh || "",

      sources: section.sources.map(source => ({
        ...source,

        description: source.descriptionZh || "",
        extract: source.extractZh || "",

        cells: Array.from(
          { length: source.rows },
          (_, row) =>
            Array.from(
              { length: source.columns },
              (_, column) =>
                source.cellsZh?.[row]?.[column] || ""
            )
        )
      }))
    }))
  };
}

function resizedCells(cells, rows, columns) {
  return Array.from(
    { length: rows },
    (_, row) =>
      Array.from(
        { length: columns },
        (_, column) =>
          cells?.[row]?.[column] || ""
      )
  );
}

function mergeChinesePaper(original, edited) {
  return {
    ...original,
    ...edited,

    sections: edited.sections.map(section => {
      const previous = original.sections.find(
        item => item.id === section.id
      );

      return {
        ...section,

        topic: previous?.topic || "",
        topicZh: section.topic,

        sources: section.sources.map(source => {
          const oldSource = previous?.sources.find(
            item => item.id === source.id
          );

          return {
            ...source,

            description: oldSource?.description || "",
            descriptionZh: source.description,

            extract: oldSource?.extract || "",
            extractZh: source.extract,

            cells: resizedCells(
              oldSource?.cells,
              source.rows,
              source.columns
            ),

            cellsZh: source.cells
          };
        })
      };
    })
  };
}

export default function QuestionPaper({
  paper,
  setPaper,
  blocks,
  updateBlock,
  language = "en"
}) {
  const visiblePaper = localizePaper(paper, language);

  function setVisiblePaper(updater) {
    setPaper(previous => {
      const view = localizePaper(previous, language);

      const edited = typeof updater === "function"
        ? updater(view)
        : updater;

      if (language === "zh") {
        return mergeChinesePaper(previous, edited);
      }

      /*
       * Preserve Chinese cells when the English editor
       * changes the shared table dimensions.
       */
      return {
        ...edited,

        sections: edited.sections.map(section => ({
          ...section,

          sources: section.sources.map(source => ({
            ...source,

            cellsZh: resizedCells(
              source.cellsZh,
              source.rows,
              source.columns
            )
          }))
        }))
      };
    });
  }

return (
    <div
      className="qp-language-content"
      lang={language === "zh" ? "zh-TW" : "en"}
    >
      <QuestionPaperEditor
        paper={visiblePaper}
        setPaper={setVisiblePaper}
        blocks={blocks.map(block => ({
          ...block,

          number: questionNumber(block.number),
          part: parenthesized(block.part),
          sub: parenthesized(block.sub),

          paperQuestion: language === "zh"
            ? block.paperQuestionZh || ""
            : block.paperQuestion || ""
        }))}
        updateBlock={updateBlock}
        language={language}
      />
    </div>
  );
}

function QuestionPaperEditor({
  paper,
  setPaper,
  blocks,
  updateBlock,
  language
}) {
  function updateSection(sectionId, patch) {
    setPaper(previous => ({
      ...previous,

      sections: previous.sections.map(section =>
        section.id === sectionId
          ? { ...section, ...patch }
          : section
      )
    }));
  }

  function updateSource(sectionId, sourceId, updater) {
    setPaper(previous => ({
      ...previous,

      sections: previous.sections.map(section =>
        section.id !== sectionId
          ? section
          : {
              ...section,

              sources: section.sources.map(source =>
                source.id === sourceId
                  ? updater(source)
                  : source
              )
            }
      )
    }));
  }

  function addSection() {
    setPaper(previous => ({
      ...previous,
      sections: [
        ...previous.sections,
        makePaperSection()
      ]
    }));
  }

  function removeSection(sectionId) {
    if (paper.sections.length === 1) return;

    if (
      !window.confirm(
        "Remove this source section? Its questions will be moved to the first remaining section. Question wording will not be deleted."
      )
    ) {
      return;
    }

    const remaining = paper.sections.filter(
      section => section.id !== sectionId
    );

    const nextSectionId = remaining[0].id;

    blocks.forEach(block => {
      if (paperSectionId(block, paper) === sectionId) {
        updateBlock(block.id, {
          paperSectionId: nextSectionId
        });
      }
    });

    setPaper(previous => ({
      ...previous,
      sections: previous.sections.filter(
        section => section.id !== sectionId
      )
    }));
  }

  function addSource(section) {
    if (section.sources.length >= 26) return;

    const used = new Set(
      section.sources.map(
        source => source.label.trim().toUpperCase()
      )
    );

    const label =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        .split("")
        .find(letter => !used.has(letter)) || "";

    updateSection(section.id, {
      sources: [
        ...section.sources,
        makePaperSource(label)
      ]
    });
  }

  function removeSource(section, sourceId) {
    if (
      !window.confirm(
        "Remove this source and its contents?"
      )
    ) {
      return;
    }

    updateSection(section.id, {
      sources: section.sources.filter(
        source => source.id !== sourceId
      )
    });
  }

  function moveSource(section, sourceId, direction) {
    const from = section.sources.findIndex(
      source => source.id === sourceId
    );

    const to = from + direction;

    if (
      from < 0 ||
      to < 0 ||
      to >= section.sources.length
    ) {
      return;
    }

    const sources = [...section.sources];

    [sources[from], sources[to]] = [
      sources[to],
      sources[from]
    ];

    updateSection(section.id, { sources });
  }

  return (
    <>
      <section className="msg-panel">
        <div className="msg-section-header">
          <h2>2. Question-paper sources</h2>

          <button
            type="button"
            onClick={addSection}
          >
+ Add another main question group
          </button>
        </div>

        <p className="msg-note">
          Use the shared overview above for question
          numbers, parts, subquestions, marks and the
          separate English question-paper wording.
          Assign each question to a source section there.
        </p>

        <p className="msg-note">
One main question group contains one topic,
          its sources, and its subquestions—for example,
          Question 2 with Sources A/B and parts (a)–(c).
          If your paper has only one main question,
          keep all rows in Group 1.
        </p>

        {paper.sections.map((section, sectionIndex) => {
          const assignedBlocks = blocks.filter(
            block =>
              paperSectionId(block, paper) === section.id
          );

          const mainNumber = assignedBlocks.find(
            block => block.number.trim()
          )?.number || "";

          return (
            <div
              key={section.id}
              className="qp-section-editor"
            >
              <div className="msg-section-header">
                <h3>
Main question group {sectionIndex + 1}
                  {mainNumber ? ` — Question ${mainNumber}` : ""}
                </h3>

                <button
                  type="button"
                  className="msg-danger"
                  disabled={paper.sections.length === 1}
                  onClick={() =>
                    removeSection(section.id)
                  }
                >
Remove group
                </button>
              </div>

              <Field
                label="Topic — optional; printed in bold"
                value={section.topic}
                onChange={topic =>
                  updateSection(section.id, { topic })
                }
              />

              <p className="qp-instruction-preview">
{sourceInstruction(
                  section.sources,
                  language
                ) || (
                  language === "zh"
                    ? "新增資料以產生指示。"
                    : "Add a source to generate the instruction."
                )}
              </p>

              {section.sources.map(
                (source, sourceIndex) => (
                  <div
                    key={source.id}
                    className="qp-source-editor"
                  >
                    <div className="msg-section-header">
<h3>
                        {language === "zh"
                          ? `資料${source.label || "?"}`
                          : `SOURCE ${source.label || "?"}`}
                      </h3>

                      <div className="msg-inline-actions">
                        <button
                          type="button"
                          disabled={sourceIndex === 0}
                          aria-label="Move source up"
                          onClick={() =>
                            moveSource(
                              section,
                              source.id,
                              -1
                            )
                          }
                        >
                          ↑
                        </button>

                        <button
                          type="button"
                          disabled={
                            sourceIndex ===
                            section.sources.length - 1
                          }
                          aria-label="Move source down"
                          onClick={() =>
                            moveSource(
                              section,
                              source.id,
                              1
                            )
                          }
                        >
                          ↓
                        </button>

                        <button
                          type="button"
                          className="msg-danger"
                          onClick={() =>
                            removeSource(section, source.id)
                          }
                        >
                          Remove source
                        </button>
                      </div>
                    </div>

                    <div className="qp-source-settings">
                      <Field
                        label="Source letter / label"
                        value={source.label}
                        onChange={label =>
                          updateSource(
                            section.id,
                            source.id,
                            current => ({
                              ...current,
                              label
                            })
                          )
                        }
                      />

                      <label className="msg-field">
                        <span>Source type</span>

                        <select
                          value={source.type}
                          onChange={event => {
                            const type = event.target.value;

                            updateSource(
                              section.id,
                              source.id,
                              current => ({
                                ...current,
                                type
                              })
                            );
                          }}
                        >
                          <option value="table">
                            Table
                          </option>

                          <option value="picture">
                            Picture space
                          </option>

                          <option value="extract">
                            Bordered extract
                          </option>
                        </select>
                      </label>
                    </div>

                    <Field
                      label="Source description — appears below SOURCE heading"
                      multiline
                      value={source.description}
                      onChange={description =>
                        updateSource(
                          section.id,
                          source.id,
                          current => ({
                            ...current,
                            description
                          })
                        )
                      }
                    />

                    {source.type === "table" && (
                      <>
                        <div className="qp-source-settings">
                          <Field
                            label="Rows — 1 to 60"
                            type="number"
                            min={1}
                            max={60}
                            value={source.rows}
                            onChange={value => {
                              const rows = boundedInteger(
                                value,
                                1,
                                60
                              );

                              if (rows === null) return;

                              if (
                                rows < source.rows &&
                                !window.confirm(
                                  "Reducing rows deletes cells in the removed rows. Continue?"
                                )
                              ) {
                                return;
                              }

                              updateSource(
                                section.id,
                                source.id,
                                current =>
                                  resizeSource(
                                    current,
                                    rows,
                                    current.columns
                                  )
                              );
                            }}
                          />

                          <Field
                            label="Columns — 1 to 10"
                            type="number"
                            min={1}
                            max={10}
                            value={source.columns}
                            onChange={value => {
                              const columns = boundedInteger(
                                value,
                                1,
                                10
                              );

                              if (columns === null) return;

                              if (
                                columns < source.columns &&
                                !window.confirm(
                                  "Reducing columns deletes cells in the removed columns. Continue?"
                                )
                              ) {
                                return;
                              }

                              updateSource(
                                section.id,
                                source.id,
                                current =>
                                  resizeSource(
                                    current,
                                    current.rows,
                                    columns
                                  )
                              );
                            }}
                          />
                        </div>

                        <label className="msg-checkbox">
                          <input
                            type="checkbox"
                            checked={source.headerRow}
                            onChange={event => {
                              const headerRow =
                                event.target.checked;

                              updateSource(
                                section.id,
                                source.id,
                                current => ({
                                  ...current,
                                  headerRow
                                })
                              );
                            }}
                          />

                          <span>
                            First row is a bold header row
                          </span>
                        </label>

                        <p className="msg-note">
                          Column widths are relative weights:
                          25 and 75 gives 25% and 75%.
                          Columns share their width across
                          all rows. All table borders are shown.
                        </p>

                        <div className="qp-width-settings">
                          {source.widths.map(
                            (width, columnIndex) => (
                              <Field
                                key={columnIndex}
                                label={
                                  `Column ${columnIndex + 1} width`
                                }
                                type="number"
                                min={1}
                                max={1000}
                                value={width}
                                onChange={value => {
                                  const next = Number(value);

                                  if (
                                    !Number.isFinite(next) ||
                                    next < 1 ||
                                    next > 1000
                                  ) {
                                    return;
                                  }

                                  updateSource(
                                    section.id,
                                    source.id,
                                    current => ({
                                      ...current,

                                      widths:
                                        current.widths.map(
                                          (item, index) =>
                                            index === columnIndex
                                              ? next
                                              : item
                                        )
                                    })
                                  );
                                }}
                              />
                            )
                          )}
                        </div>

                        <div className="msg-overview-scroll">
                          <table className="qp-table-editor">
                            <tbody>
                              {source.cells.map(
                                (row, rowIndex) => (
                                  <tr key={rowIndex}>
                                    {row.map(
                                      (text, columnIndex) => (
                                        <td key={columnIndex}>
                                          <Field
                                            label={
                                              `Row ${rowIndex + 1}, column ${columnIndex + 1}`
                                            }
                                            multiline
                                            value={text}
                                            onChange={value =>
                                              updateSource(
                                                section.id,
                                                source.id,
                                                current => ({
                                                  ...current,

                                                  cells:
                                                    current.cells.map(
                                                      (currentRow, r) =>
                                                        r !== rowIndex
                                                          ? currentRow
                                                          : currentRow.map(
                                                              (cell, c) =>
                                                                c === columnIndex
                                                                  ? value
                                                                  : cell
                                                            )
                                                    )
                                                })
                                              )
                                            }
                                          />
                                        </td>
                                      )
                                    )}
                                  </tr>
                                )
                              )}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}

                    {source.type === "extract" && (
                      <>
                        <Field
                          label="Extract content"
                          multiline
                          value={source.extract}
                          onChange={extract =>
                            updateSource(
                              section.id,
                              source.id,
                              current => ({
                                ...current,
                                extract
                              })
                            )
                          }
                        />

                        <p className="msg-note">
                          Leave an empty line between
                          paragraphs. Word prints one
                          blank line between paragraphs,
                          inside a single bordered cell.
                          A single Enter creates a line
                          break within the same paragraph.
                        </p>
                      </>
                    )}

                    {source.type === "picture" && (
                      <>
                        <Field
                          label="Reserved picture height — millimetres, 10 to 200"
                          type="number"
                          min={10}
                          max={200}
                          value={source.pictureHeight}
                          onChange={value => {
                            const height = Number(value);

                            if (
                              !Number.isFinite(height) ||
                              height < 10 ||
                              height > 200
                            ) {
                              return;
                            }

                            updateSource(
                              section.id,
                              source.id,
                              current => ({
                                ...current,
                                pictureHeight: height
                              })
                            );
                          }}
                        />

                        <p className="msg-note">
                          The downloaded document contains
                          blank space, not an uploaded image.
                          Paste your picture into that
                          space in Word.
                        </p>
                      </>
                    )}
                  </div>
                )
              )}

              <button
                type="button"
                disabled={section.sources.length >= 26}
                onClick={() => addSource(section)}
              >
                + Add source
              </button>
            </div>
          );
        })}
      </section>

      <section className="msg-panel">
        <h2>3. Question-paper preview</h2>

        <p className="msg-note">
English: ***text*** means bold italic.
          Chinese: ***文字*** means bold only.
English whole words “one” and “two” are
          automatically bold italic. Chinese phrases
          “一項”, “一個”, “兩項” and “兩個” are
          automatically bold only. This automatic
          formatting is not copied to the marking scheme.
          Marks remain together at the end of the question.
        </p>

        <div className="msg-preview-scroll">
<div className="qp-preview">
            <WorksheetPreview
              paper={paper}
              blocks={blocks}
              language={language}
            />

            {paper.sections.map(section => {
              const questions = blocks.filter(
                block =>
                  paperSectionId(block, paper) === section.id
              );

              const mainNumber = questions.find(
                block => block.number.trim()
              )?.number || "";

              return (
                <div
                  key={section.id}
                  className="qp-preview-section"
                >
                  <div className="qp-preview-main-number">
                    {mainNumber}
                  </div>

                  <div className="qp-preview-main-content">
{!paper.worksheet?.enabled &&
                      section.topic.trim() && (
                        <p className="qp-preview-topic">
                          <Rich
                            text={section.topic}
                            language={language}
                          />
                        </p>
                      )}

                    <p className="qp-preview-instruction">
{sourceInstruction(
                        section.sources,
                        language
                      )}
                    </p>

                    {section.sources.map(source => (
<PreviewSource
                        key={source.id}
                        source={source}
                        language={language}
                      />
                    ))}

                    <div className="qp-preview-questions">
                      {questions.map(block => (
                        <div
                          key={block.id}
                          className="qp-preview-question"
                        >
                          <div>{block.part}</div>
                          <div>{block.sub}</div>

                          <div className="qp-preview-question-text">
<Rich
                              text={block.paperQuestion || ""}
                              automaticNumbers
                              language={language}
                            />

                            {block.marks.trim() && (
                              <>
                                {" "}
                                <span className="qp-preview-marks">
{questionMarks(block.marks, language)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}