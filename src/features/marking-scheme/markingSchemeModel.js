export const PRESETS = {
  own3: {
    label: "3 marks — own knowledge",
    levels: [
      [
        "L1",
        "Unclear explanation, ineffective use of own knowledge.",
        "[max. 1]",
        "解釋模糊，未能有效運用個人所知。"
      ],
      [
        "L2",
        "Clear explanation, effective use of own knowledge.",
        "[max. 3]",
        "解釋清晰，能有效運用個人所知。"
      ]
    ]
  },

  source3: {
    label: "3 marks — source",
    levels: [
      [
        "L1",
        "Unclear explanation, ineffective use of the Source.",
        "[max. 1]",
        "解釋模糊，未能有效運用資料。"
      ],
      [
        "L2",
        "Clear explanation, effective use of the Source.",
        "[max. 3]",
        "解釋清晰，能有效運用資料。"
      ]
    ]
  },

  combined4: {
    label: "4 marks — own knowledge + source",
    levels: [
      [
        "L1",
        "Unclear explanation, ineffective use of the Source or own knowledge.",
        "[max. 2]",
        "解釋模糊，未能有效運用資料***或***個人所知。"
      ],
      [
        "L2",
        "Clear and comprehensive explanation, effective use of the Source and own knowledge.",
        "[max. 4]",
        "解釋清晰且全面，能有效運用資料***及***個人所知。"
      ]
    ]
  },

  source4: {
    label: "4 marks — source",
    levels: [
      [
        "L1",
        "Unclear explanation and ineffective use of the Source.",
        "[max. 1]",
        "解釋含混，未能有效運用資料作答。"
      ],
      [
        "L2",
        "Unbalanced / unclear explanation, but effective use of the Source.",
        "[max. 2]",
        "解釋欠均衡/含混，但能有效運用資料作答。"
      ],
      [
        "L3",
        "Clear explanation and effective use of the Source.",
        "[max. 4]",
        "解釋清晰，能有效運用資料作答。"
      ]
    ]
  },

  eight: {
    label: "8 marks",
    levels: [
      [
        "L1",
        "Unclear explanation, ineffective in using both the Sources and own knowledge.",
        "[max. 2]",
        "解釋含混，未能有效運用資料及個人所知。"
      ],
      [
        "L2",
        "Unbalanced explanation, effective in using ***either*** the Sources ***or*** own knowledge only.",
        "[max. 4]",
        "解釋欠均衡，僅能有效運用資料***或***個人所知。"
      ],
      [
        "L3",
        "Logical and balanced explanation, effective in using ***both*** the Sources ***and*** own knowledge.",
        "[max. 8]",
        "解釋合乎邏輯且均衡，能有效運用資料***及***個人所知。"
      ]
    ]
  }
};

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function languagesForMode(mode) {
  if (mode === "zh") return ["zh"];
  if (mode === "both") return ["zh", "en"];
  return ["en"];
}

export function languageLabel(language) {
  return language === "zh" ? "中文" : "English";
}

/*
 * Remove pasted indentation at the beginning of each line.
 * Preserve paragraph breaks and spaces between words.
 */
export function cleanLeadingText(value) {
  return String(value ?? "").replace(
    /^[^\S\r\n\u2028\u2029]+|^[\u200B\uFEFF]+/gm,
    ""
  ).replace(
    /^[\t \u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]+/gm,
    ""
  );
}

/*
 * Clean strings throughout question/source state,
 * including table cells and both languages.
 */
/*
 * Answers and headings must begin with a letter,
 * Chinese character, or number—not a pasted bullet.
 *
 * Preserve a leading *** emphasis marker when present.
 * Punctuation inside the sentence remains unchanged.
 */
export function cleanAnswerStart(value) {
  return cleanLeadingText(value)
    .split(/\r\n|\r|\n/)
    .map(line => {
      const firstCharacter = line.search(/[\p{L}\p{N}]/u);

      // A line containing only symbols becomes blank.
      if (firstCharacter < 0) return "";

      const prefix = line.slice(0, firstCharacter);

      /*
       * Examples:
       * "- ***Reason***" -> "***Reason***"
       * "  - Answer"    -> "Answer"
       */
      const emphasis = /\*{3}\s*$/.test(prefix)
        ? "***"
        : "";

      return emphasis + line.slice(firstCharacter);
    })
    .join("\n");
}

export function cleanTextTree(value) {
  if (typeof value === "string") {
    return cleanLeadingText(value);
  }

  if (Array.isArray(value)) {
    return value.map(cleanTextTree);
  }

  if (value && typeof value === "object") {
    const answerFields = new Set([
      "heading",
      "headingZh",
      "text",
      "textZh",
      "clues",
      "cluesZh"
    ]);

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,

        answerFields.has(key) &&
        typeof item === "string"
          ? cleanAnswerStart(item)
          : cleanTextTree(item)
      ])
    );
  }

  return value;
}

export function answerHeading(value, language = "en") {
  let heading = cleanAnswerStart(value).trim();

  if (!heading) return "";

  /*
   * Avoid duplicate punctuation, including a colon
   * inside a final ***emphasis*** marker.
   */
  heading = heading
    .replace(/[:：]+\s*(\*{3})?$/, "$1")
    .trimEnd();

  return heading + (language === "zh" ? "：" : ":");
}

export function questionNumber(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/[.．。]+\s*$/, "")
    .trim();

  return text ? `${text}.` : "";
}

export function parenthesized(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^[（(]+\s*/, "")
    .replace(/\s*[）)]+$/, "")
    .trim();

  return text ? `(${text})` : "";
}

export function marksNumber(value) {
  const match = String(value).match(
    /^\s*\[?\s*(\d+)\s*(?:marks?|分)?\s*\]?\s*$/i
  );

  return match ? Number(match[1]) : null;
}

/*
 * Marks are entered once and formatted for each language.
 *
 * Accepted examples:
 * 3
 * [3 marks]
 * [3分]
 * [max. 3]
 * [最多3分]
 *
 * Unrecognised custom text is preserved unchanged.
 */
export function formatMarks(
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

export function automaticPresetKey(marks) {
  switch (marksNumber(marks)) {
    case 3:
      return "source3";

    case 4:
      return "source4";

    case 8:
      return "eight";

    default:
      return "";
  }
}

export function makeLevel(
  label = "",
  description = "",
  marks = "",
  descriptionZh = ""
) {
  return {
    id: makeId(),
    label,
    description,
    descriptionZh,
    marks
  };
}

export function makeAnswer(
  text = "",
  clues = "",
  textZh = "",
  cluesZh = ""
) {
  return {
    id: makeId(),
    text,
    clues,
    textZh,
    cluesZh
  };
}

export function makeAnswerGroup(
  heading = "",
  answers = [makeAnswer()],
  headingZh = ""
) {
  return {
    id: makeId(),
    heading,
    headingZh,
    answers
  };
}

export function getPresetLevels(key) {
  const preset = PRESETS[key];

  if (!preset) return [];

  return preset.levels.map(
    ([label, description, marks, descriptionZh]) =>
      makeLevel(
        label,
        description,
        marks,
        descriptionZh
      )
  );
}

export function makeBlock(overrides = {}) {
  const block = {
    id: makeId(),

    number: "",
    part: "",
    sub: "",
    marks: "",

question: "",
    questionZh: "",

// Paper wording syncs to the marking scheme,
    // but marking-scheme edits do not sync back.
    paperQuestion: "",
    paperQuestionZh: "",

    // Blank means the first main question group.
    paperSectionId: "",

    // auto, custom, none, or a PRESETS key.
    presetMode: "auto",
    levels: [],

    // auto, on, or off.
    examplesMode: "auto",

    /*
     * When enabled, headings, answers, and supporting
     * details extend into the otherwise empty marks column.
     *
     * Question rows and descriptor rows keep their marks.
     */
    extendAnswers: false,

    answerGroups: [makeAnswerGroup()],

    ...overrides
  };

  if (block.presetMode === "auto") {
    block.levels = getPresetLevels(
      automaticPresetKey(block.marks)
    );
  }

  return block;
}

export function showExamplesForBlock(block) {
  // Also supports the validated export payload.
  if (typeof block.showExamples === "boolean") {
    return block.showExamples;
  }

  if (block.examplesMode === "on") return true;
  if (block.examplesMode === "off") return false;

  return marksNumber(block.marks) === 8;
}

export function descriptorSummary(block) {
  let label;

  if (block.presetMode === "auto") {
    const key = automaticPresetKey(block.marks);

    label = key
      ? `Automatic: ${PRESETS[key].label}`
      : "Automatic: no descriptors";
  } else if (block.presetMode === "custom") {
    label = "Custom descriptors";
  } else if (block.presetMode === "none") {
    label = "No descriptors";
  } else {
    label = PRESETS[block.presetMode]?.label ||
      "Custom descriptors";
  }

  return `${label} · ${block.levels.length} level(s)`;
}

export function initialBlocks() {
  return [makeBlock()];
}

export function sampleBlocks() {
  return [
    makeBlock({
      number: "3.",
      part: "(a)",
      marks: "[1 mark]",

      question:
        "According to Source E, identify one major territorial change in Europe between 1914 and 1919.",

      questionZh:
        "根據資料E，指出1914至1919年間歐洲的一項主要領土變化。",

      answerGroups: [
        makeAnswerGroup(
          "Territorial changes:",
          [
            makeAnswer(
              "New nations were set up.",
              "",
              "新國家成立。"
            ),
            makeAnswer(
              "The territory of Germany was reduced.",
              "",
              "德國的領土縮小。"
            )
          ],
          "領土變化："
        )
      ]
    }),

    makeBlock({
      part: "(b)",
      marks: "[3 marks]",

      question:
        "According to Source F, what was the cartoonist’s view towards the Paris Peace Conference in 1919? Cite one clue from Source F to explain your answer.",

      questionZh:
        "根據資料F，漫畫家對1919年巴黎和會持甚麼看法？引用資料F的一項線索，解釋你的答案。",

      answerGroups: [
        makeAnswerGroup(
          "The cartoonist’s view:",
          [
            makeAnswer(
              "Germany would be punished harshly.",
              "The caption ‘Wounded rat at the hands of vengeful cats’ reflected that the victorious powers were going to punish Germany as revenge.",
              "德國將受到嚴厲懲罰。",
              "標題「落在復仇之貓手中的受傷老鼠」反映戰勝國將以懲罰德國作為報復。"
            )
          ],
          "漫畫家的看法："
        )
      ]
    }),

    makeBlock({
      part: "(c)",
      marks: "[8 marks]",

      question:
        "‘The Paris Peace Conference solved the problems leading to the First World War.’ To what extent do you agree with this statement? Explain your answer with reference to Sources E and F, and relevant historical facts in the period 1914–29.",

      questionZh:
        "「巴黎和會解決了導致第一次世界大戰的問題。」你在多大程度上同意此說？參考資料E及F，並就你所知有關1914至1929年間的史實，解釋你的答案。",

      answerGroups: [
        makeAnswerGroup(
          "Problems leading to the First World War:",
          [
            makeAnswer(
              "Hostility between two camps (Source E)",
              "",
              "兩大陣營之間的敵對關係（資料E）"
            ),
            makeAnswer(
              "Nationalistic problem (own knowledge)",
              "",
              "民族主義問題（個人所知）"
            ),
            makeAnswer(
              "Arms race (own knowledge)",
              "",
              "軍備競賽（個人所知）"
            )
          ],
          "導致第一次世界大戰的問題："
        ),

        makeAnswerGroup(
          "Solved:",
          [
            makeAnswer(
              "New nations were set up to solve the nationalistic problem.",
              "(Source E)",
              "新國家成立，以解決民族主義問題。",
              "（資料E）"
            ),
            makeAnswer(
              "Collective security measures emerged from the Paris Peace Conference, such as the establishment of the League of Nations.",
              "(own knowledge)",
              "巴黎和會促成集體安全措施，例如成立國際聯盟。",
              "（個人所知）"
            ),
            makeAnswer(
              "The stability of Europe was maintained in the 1920s.",
              "(own knowledge)",
              "歐洲在1920年代維持穩定。",
              "（個人所知）"
            )
          ],
          "已解決："
        )
      ]
    })
  ];
}

export function richParts(value) {
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

/*
 * Make a language-specific view without changing the
 * shared question/answer structure or the saved contents.
 */
export function localizedBlock(block, language = "en") {
  const chinese = language === "zh";

  return {
    ...block,

number: questionNumber(block.number),
    part: parenthesized(block.part),
    sub: parenthesized(block.sub),

    question: chinese
      ? block.questionZh || ""
      : block.question || "",

    marks: formatMarks(block.marks, language),

    levels: block.levels.map(level => ({
      ...level,

      description: chinese
        ? level.descriptionZh || ""
        : level.description || "",

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
          ? group.headingZh || ""
          : group.heading || "",
        language
      ),

      answers: group.answers.map(answer => ({
        ...answer,

        text: chinese
          ? answer.textZh || ""
          : answer.text || "",

        clues: chinese
          ? answer.cluesZh || ""
          : answer.clues || ""
      }))
    }))
  };
}

function cell(start, span, text = "", style = {}) {
  return {
    start,
    span,
    text,
    ...style
  };
}

export function layoutForBlock(
  sourceBlock,
  language = "en"
) {
  const block = localizedBlock(sourceBlock, language);

  const hasSubquestion = Boolean(block.sub.trim());
  const hasExamples = showExamplesForBlock(block);
  const extendAnswers = block.extendAnswers === true;

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
    rows,
    hasSubquestion,
    hasExamples
  };
}