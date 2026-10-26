"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  TableLayoutType,
  AlignmentType,
  VerticalAlign
} = require("docx");

const {
  buildQuestionPaper,
  exportQuestionPaper
} = require("./questionPaper.cjs");

const {
  handleGeneratorDocumentAction
} = require("./generatorDocuments.cjs");

const SUPER_ADMIN = "clng@ktls.edu.hk";

const WORD_FONT = {
  ascii: "Times New Roman",
  hAnsi: "Times New Roman",
  eastAsia: "PMingLiU",
  cs: "Times New Roman"
};

function fail(code, message) {
  throw new functions.https.HttpsError(
    code,
    message
  );
}

/*
 * Authorisation is checked on the server.
 * Browser-supplied roles and email addresses are not trusted.
 */
async function requireAdmin(context) {
  const token = context.auth?.token;

  const email = String(token?.email || "")
    .trim()
    .toLowerCase();

  if (
    !context.auth ||
    !email ||
    token.email_verified !== true
  ) {
    fail(
      "unauthenticated",
      "Sign in with your verified administrator account."
    );
  }

  if (email === SUPER_ADMIN) {
    return email;
  }

  const snapshot = await admin.firestore()
    .collection("user_roles")
    .doc(email)
    .get();

  if (
    !snapshot.exists ||
    snapshot.data().role !== "admin"
  ) {
    fail(
      "permission-denied",
      "Only administrators and the superadmin may use this tool."
    );
  }

  return email;
}

function objectValue(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(
      "invalid-argument",
      "Invalid question data."
    );
  }

  return value;
}

function textValue(value, maximum = 20000) {
  if (
    typeof value !== "string" ||
    value.length > maximum
  ) {
    fail(
      "invalid-argument",
      `Text fields must contain at most ${maximum} characters.`
    );
  }

  return cleanLeadingText(value);
}

function optionalTextValue(value, maximum = 20000) {
  return value === undefined
    ? ""
    : textValue(value, maximum);
}

function listValue(value, maximum) {
  if (
    !Array.isArray(value) ||
    value.length > maximum
  ) {
    fail(
      "invalid-argument",
      "Too many entries or invalid question data."
    );
  }

  return value;
}

function booleanValue(value, label) {
  if (
    value !== undefined &&
    typeof value !== "boolean"
  ) {
    fail(
      "invalid-argument",
      `Invalid ${label} setting.`
    );
  }

  return value === true;
}

function validateLanguageMode(value) {
  // An older browser tab defaults to English.
  if (value === undefined) return "en";

  if (!["en", "zh", "both"].includes(value)) {
    fail(
      "invalid-argument",
      "Invalid marking scheme language."
    );
  }

  return value;
}

function languagesForMode(mode) {
  if (mode === "both") return ["zh", "en"];
  if (mode === "zh") return ["zh"];
  return ["en"];
}

function validateBlocks(rawBlocks, languageMode) {
  const input = listValue(rawBlocks, 150);

  if (!input.length) {
    fail(
      "invalid-argument",
      "Add at least one question."
    );
  }

  if (JSON.stringify(input).length > 1000000) {
    fail(
      "resource-exhausted",
      "This marking scheme is too large. Export it in smaller documents."
    );
  }

  let rowCount = 0;

  const blocks = input.map(raw => {
    const block = objectValue(raw);

    const levels = listValue(
      block.levels,
      60
    ).map(rawLevel => {
      const level = objectValue(rawLevel);

      return {
        label: textValue(level.label, 100),
        description: textValue(level.description),

        descriptionZh: optionalTextValue(
          level.descriptionZh
        ),

        marks: textValue(level.marks, 200)
      };
    });

    /*
     * Preserve compatibility with the previous
     * single-heading payload.
     */
    const rawGroups =
      block.answerGroups === undefined
        ? [
            {
              heading: block.heading ?? "",
              answers: block.answers ?? []
            }
          ]
        : block.answerGroups;

    const answerGroups = listValue(
      rawGroups,
      60
    ).map(rawGroup => {
      const group = objectValue(rawGroup);

      const answers = listValue(
        group.answers,
        150
      ).map(rawAnswer => {
        const answer = objectValue(rawAnswer);

        /*
         * Each answer may produce multiple Word paragraphs.
         * Count embedded line breaks in the resource budget.
         */
        const result = {
          text: textValue(answer.text),
          clues: textValue(answer.clues),

          textZh: optionalTextValue(answer.textZh),
          cluesZh: optionalTextValue(answer.cluesZh)
        };

        [
          result.text,
          result.clues,
          result.textZh,
          result.cluesZh
        ].forEach(text => {
          rowCount += (
            text.match(/\r\n|\r|\n/g) || []
          ).length;
        });

        return result;
      });

      rowCount += 1 + answers.length;

      return {
        heading: textValue(group.heading, 2000),

        headingZh: optionalTextValue(
          group.headingZh,
          2000
        ),

        answers
      };
    });

    rowCount += 1 + levels.length;

    return {
      number: textValue(block.number, 100),
      part: textValue(block.part, 100),
      sub: textValue(block.sub, 100),
      marks: textValue(block.marks, 200),

      question: textValue(block.question),

      questionZh: optionalTextValue(
        block.questionZh
      ),

      showExamples: booleanValue(
        block.showExamples,
        "example-column"
      ),

      extendAnswers: booleanValue(
        block.extendAnswers,
        "answer-width"
      ),

      levels,
      answerGroups
    };
  });

  const languageCount =
    languagesForMode(languageMode).length;

  if (rowCount * languageCount > 2000) {
    fail(
      "resource-exhausted",
      "There are too many rows. Export this scheme in smaller documents."
    );
  }

  return blocks;
}

function formatMarks(
  value,
  language = "en",
  maximum = false
) {
  const text = String(value ?? "");

  if (!text.trim()) return "";

  const match = text.match(
    /^\s*\[?\s*(?:max\.?\s*|最多\s*)?(\d+)\s*(?:marks?|分)?\s*\]?\s*$/i
  );

  if (!match) return text;

  const number = Number(match[1]);

  if (language === "zh") {
    return maximum
      ? `[最多${number}分]`
      : `[${number}分]`;
  }

  return maximum
    ? `[max. ${number}]`
    : `[${number} ${number === 1 ? "mark" : "marks"}]`;
}

function cleanLeadingText(value) {
  return String(value ?? "").replace(
    /^[\t \u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/gm,
    ""
  );
}

function cleanAnswerStart(value) {
  return cleanLeadingText(value)
    .split(/\r\n|\r|\n/)
    .map(line => {
      const firstCharacter = line.search(/[\p{L}\p{N}]/u);

      if (firstCharacter < 0) return "";

      const prefix = line.slice(0, firstCharacter);

      const emphasis = /\*{3}\s*$/.test(prefix)
        ? "***"
        : "";

      return emphasis + line.slice(firstCharacter);
    })
    .join("\n");
}

function answerHeading(value, language = "en") {
  let heading = cleanAnswerStart(value).trim();

  if (!heading) return "";

  heading = heading
    .replace(/[:：]+\s*(\*{3})?$/, "$1")
    .trimEnd();

  return heading + (language === "zh" ? "：" : ":");
}

function questionNumber(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/[.．。]+\s*$/, "")
    .trim();

  return text ? `${text}.` : "";
}

function parenthesized(value) {
  const result = String(value ?? "")
    .trim()
    .replace(/^[（(]+\s*/, "")
    .replace(/\s*[）)]+$/, "")
    .trim();

  return result ? `(${result})` : "";
}

function localizedBlock(block, language) {
  const chinese = language === "zh";

  return {
    ...block,

number: questionNumber(block.number),
    part: parenthesized(block.part),
    sub: parenthesized(block.sub),

    question: chinese
      ? block.questionZh
      : block.question,

    marks: formatMarks(block.marks, language),

    levels: block.levels.map(level => ({
      ...level,

      description: chinese
        ? level.descriptionZh
        : level.description,

      marks: formatMarks(
        level.marks,
        language,
        true
      )
    })),

    answerGroups: block.answerGroups.map(group => ({
      ...group,

heading: answerHeading(
        chinese
          ? group.headingZh
          : group.heading,
        language
      ),

      answers: group.answers.map(answer => ({
        ...answer,

text: cleanAnswerStart(
          chinese
            ? answer.textZh
            : answer.text
        ),

        clues: cleanAnswerStart(
          chinese
            ? answer.cluesZh
            : answer.clues
        )
      }))
    }))
  };
}

function richParts(value) {
  return String(value ?? "")
    .split(/(\*\*\*[^*\r\n]+\*\*\*)/g)
    .filter(Boolean)
    .map(part => {
      const emphasized =
        part.startsWith("***") &&
        part.endsWith("***");

      return {
        text: emphasized ? part.slice(3, -3) : part,
        emphasized
      };
    });
}

function cell(start, span, text = "", style = {}) {
  return {
    start,
    span,
    text,
    ...style
  };
}

/*
 * Keep this layout consistent with markingSchemeModel.js.
 *
 * The question and descriptor marks keep their own column.
 * Only headings, answers and supporting details can extend
 * into an otherwise empty marks cell.
 */
function layoutForBlock(sourceBlock, language) {
  const block = localizedBlock(
    sourceBlock,
    language
  );

  const hasSubquestion = Boolean(block.sub.trim());
  const hasExamples = block.showExamples;
  const extendAnswers = block.extendAnswers;

  const answerWidth =
    6796 -
    (hasSubquestion ? 480 : 0) -
    (hasExamples ? 620 : 0);

  const widths = [
    400,
    480,
    ...(hasSubquestion ? [480] : []),
    520,
    ...(hasExamples ? [620] : []),
    350,
    answerWidth,
    1200
  ];

  const levelColumn = hasSubquestion ? 3 : 2;

  const examplesColumn = hasExamples
    ? levelColumn + 1
    : null;

  const bulletColumn =
    levelColumn + 1 + (hasExamples ? 1 : 0);

  const answerColumn = bulletColumn + 1;
  const marksColumn = answerColumn + 1;
  const contentStart = levelColumn + 1;

  const questionCells = [
    cell(0, 1, block.number),
    cell(1, 1, block.part)
  ];

  if (hasSubquestion) {
    questionCells.push(cell(2, 1, block.sub));
  }

  questionCells.push(
    cell(
      levelColumn,
      marksColumn - levelColumn,
      block.question,
      { bold: true }
    ),

    cell(marksColumn, 1, block.marks, {
      bold: true,
      italic: true,
      right: true
    })
  );

  const rows = [
    {
      before: 0,
      gap: 180,
      cells: questionCells
    }
  ];

  block.levels
    .filter(level =>
      [
        level.label,
        level.description,
        level.marks
      ].some(value => value.trim())
    )
    .forEach(level => {
      rows.push({
        before: 0,
        gap: 180,

        cells: [
          cell(0, levelColumn),

          cell(
            levelColumn,
            1,
            level.label,
            { bold: true }
          ),

          cell(
            contentStart,
            marksColumn - contentStart,
            level.description
          ),

          cell(marksColumn, 1, level.marks, {
            italic: true,
            right: true
          })
        ]
      });
    });

  let printedGroups = 0;

  block.answerGroups.forEach(group => {
    const answers = group.answers.filter(answer =>
      answer.text.trim() || answer.clues.trim()
    );

    if (!group.heading.trim() && answers.length === 0) {
      return;
    }

    const groupSpacing = printedGroups > 0 ? 160 : 0;

    if (group.heading.trim()) {
      const headingCells = [
        cell(0, contentStart),

        cell(
          contentStart,
          marksColumn - contentStart +
            (extendAnswers ? 1 : 0),
          group.heading
        )
      ];

      if (!extendAnswers) {
        headingCells.push(cell(marksColumn, 1));
      }

      rows.push({
        before: groupSpacing,
        gap: 40,
        cells: headingCells
      });
    }

    answers.forEach((answer, answerIndex) => {
      const cells = [
        cell(
          0,
          hasExamples ? examplesColumn : bulletColumn
        )
      ];

      if (hasExamples) {
        cells.push(
          cell(
            examplesColumn,
            1,
answerIndex === 0
              ? (language === "zh" ? "例：" : "e.g.")
              : ""
          )
        );
      }

      cells.push(
        cell(bulletColumn, 1, "-"),

        cell(
          answerColumn,
          extendAnswers ? 2 : 1,
          [answer.text, answer.clues]
            .filter(value => value.trim())
            .join("\n")
        )
      );

      if (!extendAnswers) {
        cells.push(cell(marksColumn, 1));
      }

      rows.push({
        before:
          !group.heading.trim() && answerIndex === 0
            ? groupSpacing
            : 0,

        gap: 40,
        cells
      });
    });

    printedGroups += 1;
  });

  return {
    widths,
    rows
  };
}

function paragraphsForCell(item, language) {
  return String(item.text)
    .split(/\r\n|\r|\n/)
    .map(line => {
      const parts = richParts(line);

      const children = parts.length
        ? parts.map(part => {
            const bold = Boolean(
              item.bold || part.emphasized
            );

            /*
             * Chinese emphasis is bold only.
             * Explicit italic marks cells are still italic.
             */
            const italic = Boolean(
              item.italic ||
              (
                language !== "zh" &&
                part.emphasized
              )
            );

            return new TextRun({
              text: part.text,

              font: WORD_FONT,
              size: 24,
              sizeComplexScript: 24,

              bold,
              boldComplexScript: bold,

              italics: italic,
              italicsComplexScript: italic,

              language: {
                value: language === "zh"
                  ? "zh-TW"
                  : "en-US",

                eastAsia: "zh-TW"
              }
            });
          })
        : [
            new TextRun({
              text: "",
              font: WORD_FONT,
              size: 24,
              sizeComplexScript: 24
            })
          ];

      return new Paragraph({
        alignment: item.right
          ? AlignmentType.RIGHT
          : AlignmentType.LEFT,

        spacing: {
          before: 0,
          after: 0,
          line: 240
        },

        children
      });
    });
}

function tableForBlock(block, language) {
  const { widths, rows } = layoutForBlock(
    block,
    language
  );

  const noBorder = {
    style: BorderStyle.NONE,
    size: 0,
    color: "FFFFFF"
  };

  const borders = {
    top: noBorder,
    bottom: noBorder,
    left: noBorder,
    right: noBorder
  };

  return new Table({
    width: {
      size: widths.reduce(
        (sum, value) => sum + value,
        0
      ),

      type: WidthType.DXA
    },

    columnWidths: widths,
    layout: TableLayoutType.FIXED,

    borders: {
      ...borders,
      insideHorizontal: noBorder,
      insideVertical: noBorder
    },

    rows: rows.map(row =>
      new TableRow({
        children: row.cells.map(item =>
          new TableCell({
            columnSpan: item.span,

            width: {
              size: widths
                .slice(
                  item.start,
                  item.start + item.span
                )
                .reduce(
                  (sum, value) => sum + value,
                  0
                ),

              type: WidthType.DXA
            },

            verticalAlign: VerticalAlign.TOP,

            borders,

            margins: {
              top: row.before || 0,
              bottom: row.gap,
              left: 0,
              right: 0
            },

            children: paragraphsForCell(
              item,
              language
            )
          })
        )
      })
    )
  });
}

function separatorParagraph() {
  /*
   * Separate independent question tables so Word does
   * not join tables with different column layouts.
   */
  return new Paragraph({
    spacing: {
      before: 0,
      after: 0,
      line: 240
    },

    children: [
      new TextRun({
        text: "",
        font: WORD_FONT,
        size: 2
      })
    ]
  });
}

async function generateDocument(
  blocks,
  languageMode,
  paperChildren = null
) {
  const children = paperChildren
    ? [
        ...paperChildren,

        /*
         * The marking scheme starts on a fresh page.
         */
        new Paragraph({
          pageBreakBefore: true,

          spacing: {
            before: 0,
            after: 240,
            line: 240
          },

          children: [
            new TextRun({
              text: languageMode === "zh"
                ? "評分參考"
                : "Marking scheme",

              font: WORD_FONT,
              size: 24,
              bold: true,
              italics: false
            })
          ]
        })
      ]
    : [];

  const languages = languagesForMode(languageMode);

  languages.forEach((language, languageIndex) => {
    /*
     * A bilingual document contains two complete schemes.
     * The English version starts on a new page.
     */
    if (languages.length > 1) {
      children.push(
        new Paragraph({
          pageBreakBefore: languageIndex > 0,

          spacing: {
            before: 0,
            after: 240,
            line: 240
          },

          children: [
            new TextRun({
              text: language === "zh"
                ? "中文評分參考"
                : "English marking scheme",

              font: WORD_FONT,
              size: 24,
              sizeComplexScript: 24,
              bold: true,
              boldComplexScript: true,
              italics: false,

              language: {
                value: language === "zh"
                  ? "zh-TW"
                  : "en-US",

                eastAsia: "zh-TW"
              }
            })
          ]
        })
      );
    }

    blocks.forEach((block, blockIndex) => {
      if (blockIndex > 0) {
        children.push(separatorParagraph());
      }

      children.push(
        tableForBlock(block, language)
      );
    });
  });

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: WORD_FONT,
            size: 24,
            sizeComplexScript: 24
          },

          paragraph: {
            spacing: {
              before: 0,
              after: 0,
              line: 240
            }
          }
        }
      }
    },

    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838
            },

            margin: {
              top: 1080,
              bottom: 1080,
              left: 1080,
              right: 1080
            }
          }
        },

        children
      }
    ]
  });

  const base64 = await Packer.toBase64String(
    document
  );

  if (base64.length > 8000000) {
    fail(
      "resource-exhausted",
      "The generated document is too large. Export fewer questions."
    );
  }

  return base64;
}

exports.markingSchemeApi = functions
  .region("us-central1")
  .runWith({
    timeoutSeconds: 120,
    memory: "512MB",
    maxInstances: 5
  })
  .https.onCall(async (data, context) => {
    try {
      await requireAdmin(context);

      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
      ) {
        fail(
          "invalid-argument",
          "Invalid marking scheme request."
        );
      }

if (data.action === "authorize") {
        return {
          authorized: true
        };
      }

      if (
        [
          "listDocuments",
          "saveDocument",
          "loadDocument",
          "deleteDocument"
        ].includes(data.action)
      ) {
        return await handleGeneratorDocumentAction(
          data,
          context
        );
      }

if (data.action === "exportQuestionPaper") {
        return await exportQuestionPaper(data);
      }

      if (data.action === "exportCombined") {
        const languageMode = validateLanguageMode(
          data.languageMode
        );

        if (!["en", "zh"].includes(languageMode)) {
          fail(
            "invalid-argument",
            "A combined document must use one language."
          );
        }

        /*
         * Apply a whole-request size limit as this action
         * contains both paper and marking-scheme contents.
         */
        if (JSON.stringify(data).length > 2000000) {
          fail(
            "resource-exhausted",
            "This combined document is too large. Export fewer questions."
          );
        }

        const blocks = validateBlocks(
          data.blocks,
          languageMode
        );

        const paperChildren = buildQuestionPaper({
          language: languageMode,
          paper: data.paper,
          blocks: data.paperBlocks
        });

        const base64 = await generateDocument(
          blocks,
          languageMode,
          paperChildren
        );

        return {
          filename: languageMode === "zh"
            ? "question-paper-and-marking-scheme-chinese.docx"
            : "question-paper-and-marking-scheme-english.docx",

          base64
        };
      }

      if (data.action === "export") {
        const languageMode = validateLanguageMode(
          data.languageMode
        );

        const blocks = validateBlocks(
          data.blocks,
          languageMode
        );

        const base64 = await generateDocument(
          blocks,
          languageMode
        );

        const filename = languageMode === "both"
          ? "marking-scheme-bilingual.docx"
          : languageMode === "zh"
            ? "marking-scheme-chinese.docx"
            : "marking-scheme-english.docx";

        return {
          filename,
          base64
        };
      }

      fail(
        "invalid-argument",
        "Unknown marking scheme action."
      );
    } catch (error) {
      if (
        error instanceof functions.https.HttpsError
      ) {
        throw error;
      }

      console.error(
        "Marking scheme API failed:",
        {
          code: error.code || "",
          message:
            error.message || "Unknown error"
        }
      );

      throw new functions.https.HttpsError(
        "internal",
        "The marking scheme could not be created. Please try again."
      );
    }
  });