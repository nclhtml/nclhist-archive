import { TOPICS } from "./api.js";

const COMMON = [
    "ID", "Theme", "Topic", "Subtopic", "Question",
    "Explanation", "Active", "Demo"
];

const CHINESE = [
    "SubtopicZh", "QuestionZh", "ExplanationZh"
];

const numberedHeaders = (prefix, count, suffix = "") =>
    Array.from({ length: count }, (_, i) => `${prefix}${i + 1}${suffix}`);

export const HEADERS = {
    MC: [
        ...COMMON,
        "A", "B", "C", "D", "Answer",
        ...CHINESE,
        "AZh", "BZh", "CZh", "DZh"
    ],

    Matching: [
        ...COMMON,
        ...numberedHeaders("Left", 6),
        ...numberedHeaders("Right", 8),
        ...numberedHeaders("Answer", 6),
        ...CHINESE,
        ...numberedHeaders("Left", 6, "Zh"),
        ...numberedHeaders("Right", 8, "Zh")
    ],

    Sequencing: [
        ...COMMON,
        ...numberedHeaders("Item", 6),
        "CorrectOrder",
        ...CHINESE,
        ...numberedHeaders("Item", 6, "Zh")
    ],

    Blank: [
        ...COMMON,
        "AcceptedAnswers",
        ...CHINESE,
        "AcceptedAnswersZh"
    ],

    Timeline: [
        "ID", "Theme", "Topic", "Category", "Event", "Year", "Context",
        "Active", "Demo", "AllowOutsideCentury",
        "CategoryZh", "EventZh", "ContextZh"
    ]
};

const TYPE_SHEET = {
    mc: "MC",
    matching: "Matching",
    sequence: "Sequencing",
    blank: "Blank",
    event: "Timeline"
};

const cell = value => String(value ?? "").trim();

function booleanCell(value, name, fallback) {
    if (cell(value) === "" && fallback !== undefined) return fallback;
    if (value === true || cell(value).toUpperCase() === "TRUE") return true;
    if (value === false || cell(value).toUpperCase() === "FALSE") return false;

    throw new Error(`${name} must be TRUE or FALSE.`);
}

function numberedCells(row, prefix, count, suffix = "") {
    const result = Array.from(
        { length: count },
        (_, i) => cell(row[`${prefix}${i + 1}${suffix}`])
    );

    while (result.length && !result[result.length - 1]) result.pop();

    if (result.some(value => !value)) {
        throw new Error(`${prefix}${suffix} columns must not contain gaps.`);
    }

    return result;
}

function alternatives(value) {
    return cell(value).split("|").map(item => item.trim()).filter(Boolean);
}

function rowToQuestion(row, sheet, rowNumber) {
    const topicText = cell(row.Topic);

    const topic = TOPICS.find(t =>
        t.id === topicText ||
        t.label.toLowerCase() === topicText.toLowerCase()
    );

    if (!topic) throw new Error("Unknown Topic.");

    const timeline = sheet === "Timeline";

    const q = {
        id: cell(row.ID),
        theme: cell(row.Theme).toUpperCase(),
        topic: topic.id,
        subtopic: cell(timeline ? row.Category : row.Subtopic),
        prompt: cell(timeline ? row.Event : row.Question),
        explanation: cell(timeline ? row.Context : row.Explanation),
        active: booleanCell(row.Active, "Active"),
        demo: booleanCell(row.Demo, "Demo"),
        _sheet: sheet,
        _row: rowNumber
    };

    if (!q.theme) throw new Error("Theme is required.");

    if (sheet === "MC") {
        q.type = "mc";
        q.choices = ["A", "B", "C", "D"].map(key => cell(row[key]));
        q.answer = ["A", "B", "C", "D"].indexOf(
            cell(row.Answer).toUpperCase()
        );
    }

    if (sheet === "Matching") {
        q.type = "matching";
        q.left = numberedCells(row, "Left", 6);
        q.right = numberedCells(row, "Right", 8);
        q.answer = q.left.map((_, i) => Number(row[`Answer${i + 1}`]) - 1);
    }

    if (sheet === "Sequencing") {
        q.type = "sequence";
        q.items = numberedCells(row, "Item", 6);
        q.answer = cell(row.CorrectOrder)
            .split(",")
            .map(value => Number(value.trim()) - 1);
    }

    if (sheet === "Blank") {
        q.type = "blank";
        q.answer = alternatives(row.AcceptedAnswers);
    }

    if (timeline) {
        q.type = "event";
        q.year = Number(row.Year);
        q.allowOutsideCentury = booleanCell(
            row.AllowOutsideCentury,
            "AllowOutsideCentury",
            false
        );
    }

    const hasChinese = HEADERS[sheet]
        .filter(header => header.endsWith("Zh"))
        .some(header => cell(row[header]) !== "");

    if (hasChinese) {
        q.zh = {
            subtopic: cell(timeline ? row.CategoryZh : row.SubtopicZh),
            prompt: cell(timeline ? row.EventZh : row.QuestionZh),
            explanation: cell(timeline ? row.ContextZh : row.ExplanationZh)
        };

        if (q.type === "mc") {
            q.zh.choices = ["A", "B", "C", "D"].map(key =>
                cell(row[`${key}Zh`])
            );
        }

        if (q.type === "matching") {
            q.zh.left = numberedCells(row, "Left", 6, "Zh");
            q.zh.right = numberedCells(row, "Right", 8, "Zh");
        }

        if (q.type === "sequence") {
            q.zh.items = numberedCells(row, "Item", 6, "Zh");
        }

        if (q.type === "blank") {
            q.zh.answer = alternatives(row.AcceptedAnswersZh);
        }
    }

    return q;
}

export async function readWorkbook(file) {
    if (!file || file.size > 5 * 1024 * 1024) {
        throw new Error("Choose an Excel workbook smaller than 5 MB.");
    }

    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });

    const questions = [];
    const errors = [];
    const seen = new Set();

    for (const sheet of Object.keys(HEADERS)) {
        const ws = workbook.Sheets[sheet];
        if (!ws) continue;

        const formula = Object.entries(ws).find(([key, value]) =>
            !key.startsWith("!") && value?.f
        );

        if (formula) {
            errors.push(`${sheet}: formulas are not supported. Paste values instead.`);
            continue;
        }

        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

        rows.forEach((row, index) => {
            if (Object.values(row).every(value => cell(value) === "")) return;

            const rowNumber = Number.isInteger(row.__rowNum__)
                ? row.__rowNum__ + 1
                : index + 2;

            try {
                const q = rowToQuestion(row, sheet, rowNumber);

                if (seen.has(q.id)) throw new Error(`Duplicate ID: ${q.id}`);

                seen.add(q.id);
                questions.push(q);
            } catch (error) {
                errors.push(`${sheet} row ${rowNumber}: ${error.message}`);
            }
        });
    }

    if (!questions.length && !errors.length) {
        errors.push("No records found. Use the supplied workbook template.");
    }

    if (questions.length > 2500) {
        errors.push("A workbook may contain at most 2,500 combined questions and events.");
    }

    return { questions, errors };
}

function questionToRow(q) {
    const topic = TOPICS.find(t => t.id === q.topic);

    if (!topic) throw new Error(`Unknown topic for ${q.id}.`);

    if (q.type === "event") {
        return {
            ID: q.id,
            Theme: topic.theme,
            Topic: topic.label,
            Category: q.subtopic,
            Event: q.prompt,
            Year: q.year,
            Context: q.explanation,
            Active: q.active ? "TRUE" : "FALSE",
            Demo: q.demo ? "TRUE" : "FALSE",
            AllowOutsideCentury: q.allowOutsideCentury ? "TRUE" : "FALSE",
            CategoryZh: q.zh?.subtopic || "",
            EventZh: q.zh?.prompt || "",
            ContextZh: q.zh?.explanation || ""
        };
    }

    const row = {
        ID: q.id,
        Theme: topic.theme,
        Topic: topic.label,
        Subtopic: q.subtopic,
        Question: q.prompt,
        Explanation: q.explanation,
        Active: q.active ? "TRUE" : "FALSE",
        Demo: q.demo ? "TRUE" : "FALSE",
        SubtopicZh: q.zh?.subtopic || "",
        QuestionZh: q.zh?.prompt || "",
        ExplanationZh: q.zh?.explanation || ""
    };

    if (q.type === "mc") {
        ["A", "B", "C", "D"].forEach((key, i) => {
            row[key] = q.choices[i];
            row[`${key}Zh`] = q.zh?.choices?.[i] || "";
        });

        row.Answer = ["A", "B", "C", "D"][q.answer];
    }

    if (q.type === "matching") {
        q.left.forEach((value, i) => {
            row[`Left${i + 1}`] = value;
            row[`Answer${i + 1}`] = q.answer[i] + 1;
            row[`Left${i + 1}Zh`] = q.zh?.left?.[i] || "";
        });

        q.right.forEach((value, i) => {
            row[`Right${i + 1}`] = value;
            row[`Right${i + 1}Zh`] = q.zh?.right?.[i] || "";
        });
    }

    if (q.type === "sequence") {
        q.items.forEach((value, i) => {
            row[`Item${i + 1}`] = value;
            row[`Item${i + 1}Zh`] = q.zh?.items?.[i] || "";
        });

        row.CorrectOrder = q.answer.map(i => i + 1).join(",");
    }

    if (q.type === "blank") {
        row.AcceptedAnswers = q.answer.join("|");
        row.AcceptedAnswersZh = q.zh?.answer?.join("|") || "";
    }

    return row;
}

export async function downloadWorkbook(questions, filename) {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();

    const instructions = [
        ["Knowledge Test bilingual question and event bank"],
        ["Exercise format: 14 foundation + 3 sequencing + 3 year-matching questions."],
        ["Timeline contains ONE significant event per row, not prewritten questions."],
        ["The same Timeline bank supplies both generated chronology formats."],
        ["Timeline: Event is the event name; Year is one exact milestone year."],
        ["Timeline: Category is its historical category; Context is a short explanation."],
        ["Default Timeline scope is 1901–2000 inclusive."],
        ["Outside that scope, AllowOutsideCentury must be TRUE with teacher approval."],
        ["Do not place economic statistics or troop numbers in Timeline."],
        ["MC, Blank and ordinary Matching supply the 14 foundation questions."],
        ["Matching: 2–6 left items and up to 8 right options."],
        ["Matching: each left item has one different correct right option."],
        ["Some right options may be unused distractors."],
        ["Answer1 is the Right number for Left1, and so on."],
        ["Blank: separate accepted alternatives with |."],
        ["Both English and supplied Chinese fill-in variants are accepted."],
        ["Chinese columns end in Zh. Use Traditional Chinese."],
        ["If any Chinese content is supplied for a row, supply the complete translation."],
        ["Translations must keep the same option/item alignment as English."],
        ["English notes determine content. Chinese notes determine terminology where available."],
        ["Sequencing is retained for old-bank export/import only."],
        ["Legacy Sequencing rows are NOT selected for new exercises."],
        ["Keep IDs stable when correcting a record."],
        ["Use a NEW ID when changing topic or record type."],
        ["Do not use IDs starting with GEN-."],
        ["Active and Demo must be TRUE or FALSE."],
        ["Omitted records are NOT deleted."],
        ["No formulas, merged question cells, images or rich-text formatting."],
        ["Imports commit in batches. Earlier batches may remain saved after an interruption."]
    ];

    XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet(instructions),
        "Instructions"
    );

    for (const [sheet, header] of Object.entries(HEADERS)) {
        const rows = questions
            .filter(q => TYPE_SHEET[q.type] === sheet)
            .map(questionToRow);

        const ws = XLSX.utils.json_to_sheet(rows, { header });

        ws["!cols"] = header.map(key => ({
            wch: /Question|Explanation|Context|Event/.test(key) ? 55 : 22
        }));

        XLSX.utils.book_append_sheet(workbook, ws, sheet);
    }

    XLSX.writeFile(workbook, filename);
}