"use strict";

const functions = require("firebase-functions/v1");

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
  VerticalAlign,
  TabStopType,
  HeightRule
} = require("docx");

const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const MARGIN = 1080;

const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const NUMBER_WIDTH = 480;

/*
 * Leave a small safety allowance at the right edge.
 * Sources are no longer inside a second table cell.
 */
const CONTENT_WIDTH =
  TEXT_WIDTH - NUMBER_WIDTH - 120;

const FONT = {
  ascii: "Times New Roman",
  hAnsi: "Times New Roman",
  eastAsia: "PMingLiU",
  cs: "Times New Roman"
};

function fail(code, message) {
  throw new functions.https.HttpsError(code, message);
}

function object(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail("invalid-argument", "Invalid question-paper data.");
  }

  return value;
}

function text(value, maximum = 20000) {
  if (
    typeof value !== "string" ||
    value.length > maximum
  ) {
    fail(
      "invalid-argument",
      `Question-paper text must contain at most ${maximum} characters.`
    );
  }

  return value.replace(
    /^[\t \u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/gm,
    ""
  );
}

function list(value, maximum) {
  if (
    !Array.isArray(value) ||
    value.length > maximum
  ) {
    fail(
      "invalid-argument",
      "Invalid question-paper list or too many entries."
    );
  }

  return value;
}

function number(value, minimum, maximum, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    fail(
      "invalid-argument",
      "Invalid question-paper size or table setting."
    );
  }

  return value;
}

function questionNumber(value) {
  const result = String(value ?? "")
    .trim()
    .replace(/[.．。]+\s*$/, "")
    .trim();

  return result ? `${result}.` : "";
}

function parenthesized(value) {
  const result = String(value ?? "")
    .trim()
    .replace(/^[（(]+\s*/, "")
    .replace(/\s*[）)]+$/, "")
    .trim();

  return result ? `(${result})` : "";
}

function validate(data) {
  object(data);

  const language = data.language === undefined
    ? "en"
    : data.language;

  if (!["en", "zh"].includes(language)) {
    fail("invalid-argument", "Invalid paper language.");
  }

  const paper = object(data.paper);

  if (
    JSON.stringify({
      paper,
      blocks: data.blocks
    }).length > 1000000
  ) {
    fail(
      "resource-exhausted",
      "This question paper is too large."
    );
  }

  let units = 0;

  function countedText(value, maximum = 20000) {
    const result = text(value, maximum);

    units += 1 +
      (result.match(/\r\n|\r|\n/g) || []).length;

    return result;
  }

  const sectionIds = new Set();

  const sections = list(paper.sections, 40).map(raw => {
    const section = object(raw);
    const id = text(section.id, 100);

    if (!id || sectionIds.has(id)) {
      fail(
        "invalid-argument",
        "Main question groups need unique identifiers."
      );
    }

    sectionIds.add(id);

    const labels = new Set();

    const sources = list(
      section.sources,
      26
    ).map(rawSource => {
      const source = object(rawSource);
      const label = text(source.label, 30).trim();

      if (
        !label ||
        labels.has(label.toUpperCase())
      ) {
        fail(
          "invalid-argument",
          "Each source needs a unique, nonblank label."
        );
      }

      labels.add(label.toUpperCase());

      if (
        !["table", "picture", "extract"].includes(source.type)
      ) {
        fail("invalid-argument", "Invalid source type.");
      }

if (
        source.captionEnabled !== undefined &&
        typeof source.captionEnabled !== "boolean"
      ) {
        fail(
          "invalid-argument",
          "Invalid source caption setting."
        );
      }

      const result = {
        label,
        type: source.type,

        description: countedText(
          source.description,
          10000
        ),

        captionEnabled: source.captionEnabled === true,

        caption: countedText(
          source.caption === undefined
            ? ""
            : source.caption,
          10000
        )
      };

      if (source.type === "table") {
        const rows = number(source.rows, 1, 60, true);
        const columns = number(
          source.columns,
          1,
          10,
          true
        );

        const widths = list(
          source.widths,
          10
        ).map(value => number(value, 1, 1000));

        if (widths.length !== columns) {
          fail(
            "invalid-argument",
            "Table widths do not match the columns."
          );
        }

        const cells = list(source.cells, 60).map(rawRow => {
          const row = list(rawRow, 10);

          if (row.length !== columns) {
            fail(
              "invalid-argument",
              "Table cells do not match the columns."
            );
          }

          return row.map(value =>
            countedText(value, 10000)
          );
        });

        if (cells.length !== rows) {
          fail(
            "invalid-argument",
            "Table cells do not match the rows."
          );
        }

        if (typeof source.headerRow !== "boolean") {
          fail(
            "invalid-argument",
            "Invalid table header setting."
          );
        }

        Object.assign(result, {
          rows,
          columns,
          widths,
          cells,
          headerRow: source.headerRow
        });
      }

      if (source.type === "extract") {
        result.extract = countedText(
          source.extract,
          100000
        );
      }

      if (source.type === "picture") {
        result.pictureHeight = number(
          source.pictureHeight,
          10,
          200
        );
      }

      return result;
    });

    return {
      id,
      topic: countedText(section.topic, 3000),
      sources
    };
  });

  if (!sections.length) {
    fail(
      "invalid-argument",
      "Add at least one main question group."
    );
  }

  const blocks = list(data.blocks, 150).map(raw => {
    const block = object(raw);
    const sectionId = text(block.paperSectionId, 100);

    if (!sectionIds.has(sectionId)) {
      fail(
        "invalid-argument",
        "A question refers to an unknown group."
      );
    }

    return {
      number: questionNumber(text(block.number, 100)),
      part: parenthesized(text(block.part, 100)),
      sub: parenthesized(text(block.sub, 100)),
      marks: text(block.marks, 200),

      paperQuestion: countedText(
        block.paperQuestion,
        20000
      ),

      paperSectionId: sectionId
    };
  });

  if (!blocks.length) {
    fail("invalid-argument", "Add at least one question.");
  }

  if (units > 3500) {
    fail(
      "resource-exhausted",
      "Too many question-paper cells or paragraphs."
    );
  }

  let worksheet = {
    enabled: false
  };

  if (paper.worksheet !== undefined) {
    const rawWorksheet = object(paper.worksheet);

    if (typeof rawWorksheet.enabled !== "boolean") {
      fail(
        "invalid-argument",
        "Invalid worksheet heading setting."
      );
    }

    if (rawWorksheet.enabled) {
      const academicYear = text(
        rawWorksheet.academicYear,
        40
      ).trim();

      const level = text(
        rawWorksheet.level,
        10
      );

      const oldNumber =
        rawWorksheet.quizNumber === undefined
          ? "4"
          : text(
            rawWorksheet.quizNumber,
            100
          ).trim();

      const assessmentEn = text(
        rawWorksheet.assessmentEn === undefined
          ? (
            oldNumber
              ? `Quiz ${oldNumber}`
              : "Quiz"
          )
          : rawWorksheet.assessmentEn,
        200
      ).trim();

      const assessmentZh = text(
        rawWorksheet.assessmentZh === undefined
          ? (
            oldNumber
              ? `小測${oldNumber}`
              : "小測"
          )
          : rawWorksheet.assessmentZh,
        200
      ).trim();

      if (!["S4", "S5", "S6"].includes(level)) {
        fail(
          "invalid-argument",
          "Select S4, S5 or S6 for the worksheet."
        );
      }

      let totalMarks = 0;

      for (const block of blocks) {
        const value = block.marks.trim();

        // Blank marks contribute zero.
        if (!value) continue;

        const match = value.match(
          /^\s*[\[(（]?\s*(\d+)\s*(?:marks?|分)?\s*[\])）]?\s*$/i
        );

        if (!match) {
          fail(
            "invalid-argument",
            "The worksheet total could not be calculated. Use numeric marks such as 3, [3 marks] or [3分]."
          );
        }

        totalMarks += Number(match[1]);
      }

      if (
        !Number.isSafeInteger(totalMarks) ||
        totalMarks > 1000000
      ) {
        fail(
          "invalid-argument",
          "The worksheet total marks are too large."
        );
      }

      worksheet = {
        enabled: true,
        academicYear,
        level,
        assessmentEn,
        assessmentZh,
        totalMarks
      };
    }
  }

  return {
    sections,
    blocks,
    language,
    worksheet
  };
}

function richParts(
  value,
  automaticNumbers = false,
  language = "en"
) {
  return String(value || "")
    .split(/(\*\*\*[^*\r\n]+\*\*\*)/g)
    .filter(Boolean)
    .flatMap(part => {
      const emphasized =
        part.startsWith("***") &&
        part.endsWith("***");

      if (emphasized) {
        return [{
          text: part.slice(3, -3),
          emphasized: true
        }];
      }

      if (!automaticNumbers) {
        return [{ text: part, emphasized: false }];
      }

      const splitPattern = language === "zh"
        ? /(一項|一個|兩項|兩個)/g
        : /(\b(?:one|two)\b)/gi;

      const exactPattern = language === "zh"
        ? /^(?:一項|一個|兩項|兩個)$/
        : /^(?:one|two)$/i;

      return part
        .split(splitPattern)
        .filter(Boolean)
        .map(text => ({
          text,
          emphasized: exactPattern.test(text)
        }));
    });
}

function runs(value, {
  bold = false,
  language = "en",
  automaticNumbers = false
} = {}) {
  const result = [];

  String(value || "")
    .split(/\r\n|\r|\n/)
    .forEach((line, index) => {
      if (index > 0) {
        result.push(
          new TextRun({
            text: "",
            break: 1,
            font: FONT,
            size: 24
          })
        );
      }

      richParts(
        line,
        automaticNumbers,
        language
      ).forEach(part => {
        result.push(
          new TextRun({
            text: part.text,
            font: FONT,
            size: 24,
            sizeComplexScript: 24,

            bold: bold || part.emphasized,
            italics:
              language === "en" && part.emphasized,

            language: {
              value: language === "zh"
                ? "zh-TW"
                : "en-US",
              eastAsia: "zh-TW"
            }
          })
        );
      });
    });

  return result.length
    ? result
    : [
      new TextRun({
        text: "",
        font: FONT,
        size: 24
      })
    ];
}

function paragraph(value = "", options = {}) {
  return new Paragraph({
    keepNext: options.keepNext === true,
    keepLines: true,

    alignment: options.justify
      ? AlignmentType.JUSTIFIED
      : AlignmentType.LEFT,

    indent: options.indented
      ? { left: NUMBER_WIDTH }
      : undefined,

    spacing: {
      before: options.before || 0,
      after: options.after || 0,
      line: 240
    },

    children: runs(value, options)
  });
}

function tinySeparator() {
  return new Paragraph({
    spacing: {
      before: 0,
      after: 0,
      line: 20
    },

    children: [
      new TextRun({
        text: "",
        font: FONT,
        size: 2
      })
    ]
  });
}

const noBorder = {
  style: BorderStyle.NONE,
  size: 0,
  color: "FFFFFF"
};

const visibleBorder = {
  style: BorderStyle.SINGLE,
  size: 6,
  color: "000000"
};

function borders(visible) {
  const border = visible ? visibleBorder : noBorder;

  return {
    top: border,
    bottom: border,
    left: border,
    right: border
  };
}

function cell(width, children, options = {}) {
  return new TableCell({
    width: {
      size: width,
      type: WidthType.DXA
    },

    borders: borders(options.visible),

    verticalAlign: VerticalAlign.TOP,

    margins: {
      top: options.top || 0,
      bottom: options.bottom || 0,
      left: options.left || 0,
      right: options.right || 0
    },

    children
  });
}

function table(widths, rows, visible = false) {
  const border = visible ? visibleBorder : noBorder;

  return new Table({
    alignment: AlignmentType.LEFT,

    indent: {
      size: 0,
      type: WidthType.DXA
    },

    width: {
      size: widths.reduce((sum, value) => sum + value, 0),
      type: WidthType.DXA
    },

    columnWidths: widths,
    layout: TableLayoutType.FIXED,

    margins: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0
    },

    borders: {
      ...borders(visible),
      insideHorizontal: border,
      insideVertical: border
    },

    rows
  });
}

function instruction(sources, language) {
  const labels = sources.map(source => source.label);

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

function scaledWidths(weights) {
  const sum = weights.reduce(
    (total, value) => total + value,
    0
  );

  const widths = weights.map(weight =>
    Math.floor(weight / sum * CONTENT_WIDTH)
  );

  widths[widths.length - 1] +=
    CONTENT_WIDTH -
    widths.reduce((total, width) => total + width, 0);

  return widths;
}

/*
 * One complete source or complete question group goes
 * inside one outer row.
 *
 * Word can move the entire row to the next page instead
 * of separating its heading, description and contents.
 *
 * An item taller than a whole page cannot remain intact.
 */
function unbrokenGroup(children) {
  return new Table({
    alignment: AlignmentType.LEFT,

    indent: {
      size: NUMBER_WIDTH,
      type: WidthType.DXA
    },

    width: {
      size: CONTENT_WIDTH,
      type: WidthType.DXA
    },

    columnWidths: [CONTENT_WIDTH],
    layout: TableLayoutType.FIXED,

    borders: {
      ...borders(false),
      insideHorizontal: noBorder,
      insideVertical: noBorder
    },

    margins: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0
    },

    rows: [
      new TableRow({
        cantSplit: true,

        children: [
          cell(
            CONTENT_WIDTH,

            /*
             * A paragraph is required after a nested table.
             */
            [...children, tinySeparator()]
          )
        ]
      })
    ]
  });
}

function tableSource(source, language) {
  const widths = scaledWidths(source.widths);

  return table(
    widths,

    source.cells.map((row, rowIndex) =>
      new TableRow({
        tableHeader:
          source.headerRow && rowIndex === 0,

        children: row.map((value, columnIndex) =>
          cell(
            widths[columnIndex],

            [
              paragraph(value, {
                language,
                justify: true,
                bold:
                  source.headerRow && rowIndex === 0
              })
            ],

            {
              visible: true,
              top: 80,
              bottom: 80,
              left: 100,
              right: 100
            }
          )
        )
      })
    ),

    true
  );
}

function extractSource(source, language) {
  const paragraphs = source.extract
    .split(/\r?\n\s*\r?\n+/)
    .map(value => value.trim())
    .filter(Boolean);

  return table(
    [CONTENT_WIDTH],

    [
      new TableRow({
        children: [
          cell(
            CONTENT_WIDTH,

            paragraphs.length
              ? paragraphs.map((value, index) =>
                paragraph(value, {
                  language,
                  justify: true,
                  after:
                    index < paragraphs.length - 1
                      ? 240
                      : 0
                })
              )
              : [paragraph("")],

            {
              visible: true,
              top: 120,
              bottom: 120,
              left: 160,
              right: 160
            }
          )
        ]
      })
    ],

    true
  );
}

function pictureSource(source) {
  return table(
    [CONTENT_WIDTH],

    [
      new TableRow({
        height: {
          value: Math.round(
            source.pictureHeight * 1440 / 25.4
          ),

          rule: HeightRule.ATLEAST
        },

        children: [
          cell(
            CONTENT_WIDTH,
            [paragraph("")]
          )
        ]
      })
    ]
  );
}

function questionMarks(value, language) {
  const input = String(value || "").trim();

  if (!input) return "";

  const match = input.match(
    /^\[?\s*(\d+)\s*(?:marks?|分)?\s*\]?$/i
  );

  if (!match) {
    // Keep custom mark labels together as well.
    return input.replace(/ /g, "\u00A0");
  }

  const count = Number(match[1]);

  if (language === "zh") {
    return `(${count}分)`;
  }

  /*
   * A nonbreaking space prevents "(4" and "marks)"
   * from splitting across lines.
   */
  return `(${count}\u00A0${count === 1 ? "mark" : "marks"})`;
}

/*
 * Keep the word "Source" or "Sources" attached to its
 * first label, for example Source A or Sources A.
 *
 * Apply only to output, not to the stored editor text.
 */
function keepSourceReferencesTogether(value) {
  return String(value ?? "").replace(
    /\b(Sources?)[ \t\u00A0]+([A-Z])\b/gi,
    "$1\u00A0$2"
  );
}

function questionParagraphs(block, width, language) {
  const lines = block.paperQuestion
    .split(/\r\n|\r|\n/);

  const marks = questionMarks(block.marks, language);

  /*
   * Left-align questions containing English source
   * references. This avoids stretching a short line
   * when the complete "Source A" moves to the next line.
   */
  const hasSourceReference = /\bSources?[ \t\u00A0]+[A-Z]\b/i
    .test(block.paperQuestion);

  return lines.map((line, index) => {
    const children = runs(
      keepSourceReferencesTogether(line),
      {
        language,
        automaticNumbers: true
      }
    );

    if (index === lines.length - 1 && marks) {
      children.push(
        new TextRun({
          text: "\t",
          font: FONT,
          size: 24
        }),

        new TextRun({
          text: marks,
          font: FONT,
          size: 24,
          bold: false,
          italics: false
        })
      );
    }

return new Paragraph({
      alignment: hasSourceReference
        ? AlignmentType.LEFT
        : AlignmentType.JUSTIFIED,

      keepLines: true,

      /*
       * The final marks run follows this right tab.
       * Marks stay together because questionMarks()
       * uses nonbreaking spaces.
       *
       * If there is insufficient room on the final text
       * line, Word may place the marks on the next line,
       * still at the right edge.
       */
      tabStops: [
        {
          type: TabStopType.RIGHT,
          position: width - 120
        }
      ],

      spacing: {
        before: 0,
        after: 0,
        line: 240
      },

      children
    });
  });
}

function questionsTable(blocks, language) {
  const hasSub = blocks.some(block => block.sub.trim());

  const partWidth = 480;
  const subWidth = hasSub ? 400 : 0;

  const questionWidth =
    CONTENT_WIDTH - partWidth - subWidth;

  const widths = [
    partWidth,
    ...(hasSub ? [subWidth] : []),
    questionWidth
  ];

  return table(
    widths,

    blocks.map(block =>
      new TableRow({
        children: [
          cell(
            partWidth,
            [paragraph(block.part, { language })],
            { bottom: 240 }
          ),

          ...(
            hasSub
              ? [
                cell(
                  subWidth,
                  [paragraph(block.sub, { language })],
                  { bottom: 240 }
                )
              ]
              : []
          ),

          cell(
            questionWidth,
            questionParagraphs(
              block,
              questionWidth,
              language
            ),
            { bottom: 240 }
          )
        ]
      })
    )
  );
}

function worksheetHeading(
  worksheet,
  firstSection,
  language
) {
  const topic = String(firstSection?.topic || "")
    .replace(/\*\*\*/g, "")
    .trim();

  const chineseLevel = {
    S4: "中四級",
    S5: "中五級",
    S6: "中六級"
  }[worksheet.level];

  const baseTitle = language === "zh"
    ? [
      worksheet.academicYear,
      "歷史科",
      chineseLevel,
      worksheet.assessmentZh
    ].filter(Boolean).join(" ")
    : [
      worksheet.academicYear,
      "History",
      worksheet.level,
      worksheet.assessmentEn
    ].filter(Boolean).join(" ");

  const title = topic
    ? `${baseTitle} - ${topic}`
    : baseTitle;

  /*
   * Full-page-width heading:
   * student information | small gap | score box
   */
  const scoreWidth = 1900;
  const gapWidth = 240;

  const detailsWidth =
    TEXT_WIDTH - scoreWidth - gapWidth;

  const titleParagraph = paragraph(title, {
    language,
    bold: true,
    after: 280
  });

  const nameAndClassParagraph = new Paragraph({
    tabStops: [
      {
        type: TabStopType.LEFT,
        position: 4100
      }
    ],

    spacing: {
      before: 0,
      after: 200,
      line: 240
    },

    children: runs(
      language === "zh"
        ? "姓名：__________________\t班別：__________ (  　)"
        : "Name: __________________\tClass: __________ (  　)",

      { language }
    )
  });

  const dateParagraph = paragraph(
    language === "zh"
      ? "日期：__________________"
      : "Date: __________________",

    { language }
  );

  const scoreParagraph = new Paragraph({
    alignment: AlignmentType.RIGHT,

    spacing: {
      before: 0,
      after: 0
    },

    children: [
      new TextRun({
        text: `/${worksheet.totalMarks}`,
        font: FONT,

        // Font sizes are stored in half-points:
        // 48 half-points = 24 pt.
        size: 48,
        sizeComplexScript: 48,

        bold: true,
        italics: false
      })
    ]
  });

  /*
   * Use a separate top-level table.
   * Do not use the source-table helper here, because
   * source tables have a left indentation.
   */
  return new Table({
    alignment: AlignmentType.LEFT,

    width: {
      size: TEXT_WIDTH,
      type: WidthType.DXA
    },

    columnWidths: [
      detailsWidth,
      gapWidth,
      scoreWidth
    ],

    layout: TableLayoutType.FIXED,

    borders: {
      ...borders(false),
      insideHorizontal: noBorder,
      insideVertical: noBorder
    },

    margins: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0
    },

    rows: [
      new TableRow({
        cantSplit: true,

        /*
         * No forced row height.
         * The box ends at the bottom of the Date row.
         */
        children: [
          new TableCell({
            width: {
              size: detailsWidth,
              type: WidthType.DXA
            },

            borders: borders(false),
            verticalAlign: VerticalAlign.TOP,

            margins: {
              top: 0,
              bottom: 0,
              left: 0,
              right: 0
            },

            children: [
              titleParagraph,
              nameAndClassParagraph,
              dateParagraph
            ]
          }),

          new TableCell({
            width: {
              size: gapWidth,
              type: WidthType.DXA
            },

            borders: borders(false),

            margins: {
              top: 0,
              bottom: 0,
              left: 0,
              right: 0
            },

            children: [paragraph("")]
          }),

          new TableCell({
            width: {
              size: scoreWidth,
              type: WidthType.DXA
            },

            /*
                         * Slightly thicker border for the score box
                         * only. Source-table borders are unchanged.
                         */
            borders: {
              top: {
                style: BorderStyle.SINGLE,
                size: 8,
                color: "000000"
              },

              bottom: {
                style: BorderStyle.SINGLE,
                size: 8,
                color: "000000"
              },

              left: {
                style: BorderStyle.SINGLE,
                size: 8,
                color: "000000"
              },

              right: {
                style: BorderStyle.SINGLE,
                size: 8,
                color: "000000"
              }
            },

            verticalAlign: VerticalAlign.BOTTOM,

            margins: {
              top: 60,
              bottom: 100,
              left: 160,
              right: 200
            },

            children: [scoreParagraph]
          })
        ]
      })
    ]
  });
}

/*
 * Return document elements instead of immediately
 * packing a document. The combined exporter reuses them.
 */
function buildQuestionPaper(data) {
  const {
    sections,
    blocks,
    language,
    worksheet
  } = validate(data);

  const children = [];

  if (worksheet.enabled) {
    children.push(
      worksheetHeading(
        worksheet,
        sections[0],
        language
      ),

      paragraph("", {
        after: 240
      })
    );
  }

  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      children.push(
        paragraph("", { after: 240 })
      );
    }

    const questions = blocks.filter(
      block => block.paperSectionId === section.id
    );

    const mainNumber = questions.find(
      block => block.number.trim()
    )?.number || "";

    /*
         * The worksheet heading already contains the topic.
         * Do not repeat group topics below it when enabled.
         */
    const topic = worksheet.enabled
      ? ""
      : section.topic.trim();

    const sourceInstruction = instruction(
      section.sources,
      language
    );

    /*
     * With a topic:
     * 1. Topic
     *    Study Source A.
     *
     * Without a topic:
     * 1. Study Source A.
     */
    const firstLineText = topic || sourceInstruction;

    const firstLineRuns = [];

    if (mainNumber) {
      firstLineRuns.push(
        new TextRun({
          text: `${mainNumber}\t`,
          font: FONT,
          size: 24,
          bold: false,
          italics: false
        })
      );
    }

    firstLineRuns.push(
      ...runs(firstLineText, {
        language,
        bold: Boolean(topic)
      })
    );

    if (mainNumber || firstLineText) {
      children.push(
        new Paragraph({
          keepNext: true,

          indent: mainNumber
            ? {
              left: NUMBER_WIDTH,
              hanging: NUMBER_WIDTH
            }
            : {
              left: NUMBER_WIDTH
            },

          tabStops: [
            {
              type: TabStopType.LEFT,
              position: NUMBER_WIDTH
            }
          ],

          spacing: {
            before: 0,
            after: 0,
            line: 240
          },

          children: firstLineRuns
        })
      );
    }

    /*
     * Only print a second instruction line when there
     * was a topic on the first line.
     */
    if (topic && sourceInstruction) {
      children.push(
        paragraph(sourceInstruction, {
          language,
          indented: true,
          keepNext: true
        })
      );
    }

    section.sources.forEach(source => {
      const sourceChildren = [
        paragraph(
          language === "zh"
            ? `資料${source.label}`
            : `SOURCE ${source.label}`,

          {
            language,
            bold: true,
            before: 280,
            after: 280,
            keepNext: true
          }
        )
      ];

      if (source.description.trim()) {
        sourceChildren.push(
          paragraph(source.description, {
            language,
            justify: true,
            after: 200,
            keepNext: true
          })
        );
      }

if (source.type === "table") {
        sourceChildren.push(
          tableSource(source, language)
        );
      } else if (source.type === "extract") {
        sourceChildren.push(
          extractSource(source, language)
        );
      } else {
        sourceChildren.push(
          pictureSource(source)
        );
      }

      /*
       * The caption follows the source table directly.
       *
       * It is outside the source border but inside the
       * same non-splitting source group.
       *
       * No indentation: its text starts at the source
       * border's left edge.
       *
       * The paragraph helper uses single line spacing.
       * No extra before/after spacing is added.
       */
if (
        source.captionEnabled &&
        source.caption.trim()
      ) {
        sourceChildren.push(
          paragraph(source.caption, {
            language,
            before: 80, // 4 pt
            after: 0
          })
        );
      }

      children.push(
        unbrokenGroup(sourceChildren),
        tinySeparator()
      );
    });

    if (questions.length) {
      children.push(
        unbrokenGroup([
          paragraph("", { after: 240 }),
          questionsTable(questions, language)
        ]),

        tinySeparator()
      );
    }
  });

  return children;
}

async function exportQuestionPaper(data) {
  const children = buildQuestionPaper(data);
  const language = data.language || "en";

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
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
              width: PAGE_WIDTH,
              height: PAGE_HEIGHT
            },

            margin: {
              top: MARGIN,
              bottom: MARGIN,
              left: MARGIN,
              right: MARGIN
            }
          }
        },

        children
      }
    ]
  });

  const base64 = await Packer.toBase64String(document);

  if (base64.length > 8000000) {
    fail(
      "resource-exhausted",
      "The question-paper document is too large."
    );
  }

  return {
    filename: language === "zh"
      ? "question-paper-chinese.docx"
      : "question-paper-english.docx",

    base64
  };
}

module.exports = {
  buildQuestionPaper,
  exportQuestionPaper
};