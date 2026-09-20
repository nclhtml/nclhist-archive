import React, { useState } from "react";
import { TOPICS } from "./api.js";
import { HEADERS } from "./workbook.js";

const SHEETS = ["MC", "Blank", "Matching", "Timeline"];

const LABELS = {
    MC: "Multiple-choice questions",
    Blank: "Fill-in-the-blank questions",
    Matching: "Ordinary matching questions",
    Timeline: "Individual timeline events"
};

const CODES = {
    MC: "MC",
    Blank: "FIB",
    Matching: "MAT",
    Timeline: "EVT"
};

const RULES = {
    MC: `
MULTIPLE CHOICE
- Supply four distinct options in A, B, C and D.
- Answer is exactly A, B, C or D.
- Exactly one option is correct.
- Supply AZh, BZh, CZh and DZh in identical semantic order.
- Do not use all/none of the above, both A and B, or position-dependent wording.
- Suitable content includes event identification, context, clear categories,
  important years and important numerical facts explicitly emphasised in notes.
- Economic data, troop numbers and other technical numerical data belong here
  or in Blank, NOT in Timeline.
`,

    Blank: `
FILL-IN-THE-BLANK — IMPORTANT NAMES AND NUMERICAL EVIDENCE

PURPOSE
This worksheet primarily tests:
1. Important historical names.
2. Important non-date numerical facts that demonstrate historical significance.
Year recall is a minor secondary purpose because Timeline already tests dates.

PRIMARY FOCUS 1 — IMPORTANT NAMES
- Prioritise names of significant events, economic plans, treaties, agreements,
  conferences, organisations, policies and historical terms.
- Important people and countries may also be tested where clearly emphasised.
- Give enough historical context to identify one specific answer.
- Where useful, GIVE the year in the sentence and ask for the name instead.
- Do not routinely give the event or plan name and blank out its year.
- Test recognition of the name through its purpose, action or significance,
  not merely an isolated date clue.
- Blank out the complete meaningful name, not an arbitrary fragment of it.
- Do not reveal the answer elsewhere in the question or its subtopic label.

PRIMARY FOCUS 2 — IMPORTANT NUMERICAL EVIDENCE
- Prioritise significant statistics explicitly emphasised in the English notes.
- Select figures that help students understand the scale or impact of an event:
  unemployment, economic contraction, industrial decline, trade reduction,
  casualties, reparations or other clearly important quantities.
- Important unemployment figures illustrating the Great Depression are
  especially suitable when present in the notes.
- Do not select obscure figures merely because they are numerical.
- Specify the country or region, period, measured quantity and relevant
  comparison or baseline wherever needed to make the answer unambiguous.
- Preserve distinctions such as total GDP versus GDP per head,
  falling BY a percentage versus falling TO a percentage,
  and a number of unemployed people versus an unemployment rate.
- Preserve qualifiers such as approximately, almost and more than.
- Do not invent statistics, calculate new examinable figures, or introduce
  outside data to fill the requested count.
- Explanations should briefly connect the figure to its historical significance.

BALANCE ACROSS THE REQUESTED BLANK ROWS
- Aim for roughly 60% important-name answers and 30–40% significant
  non-date numerical answers when the supplied notes support that balance.
- Year/date answers must not exceed 10% of the requested Blank rows,
  rounded DOWN to a whole number.
- For 30 Blank rows, at most 3 may ask for a year/date.
- This is a ceiling, not a target. Zero year/date answers is acceptable.
- Any year/date answers must concern especially significant milestones,
  not routine dates for every plan, pact, conference or event.
- Years supplied as context do not count as year-answer questions.
- Classify each row by what the student must supply, not by whether the
  sentence contains a number.
- Do not count years or dates as numerical evidence.
- The name/statistic proportions are planning targets, not permission
  to invent facts or repeat questions.
- If there are few suitable statistics, use more important-name questions.
- If important names are limited but significant statistics are plentiful,
  use more supported statistical questions.
- Never use extra year questions to fill a shortage of names or statistics.
- If the requested count cannot be met without unsupported facts, obscure
  trivia, near-duplicates or exceeding the year/date ceiling, ask the teacher
  to reduce the count or supply more notes before generating.

GENUINE SENTENCE-COMPLETION FORMAT
- Use a complete factual sentence containing exactly one ____ blank.
- The missing answer must be one short, objective name, term or quantity.
- Integrate the blank naturally into the sentence.
- Do not write a direct question followed by "Answer: ____" or a detached blank.
- Do not write "答案：____" or append a blank after a Chinese question.
- Make both language versions genuine sentence-completion questions.
- Include enough context for one uniquely identifiable answer.
- Do not require an essay, subjective judgement or multiple separate answers.

WORDING EXAMPLES — USE ONLY IF SUPPORTED BY THE SUPPLIED NOTES
- Avoid: "The Dawes Plan was introduced in ____."
- Prefer: "The ____ was introduced in 1924 to provide American loans
  and restructure German reparations payments."
  Intended answer: Dawes Plan.
- Chinese equivalent: "1924年推行的____提供美國貸款，並重訂德國的賠款支付安排。"
  Intended answer: 多茲計劃.
- For statistics, use a structure such as:
  "By [year], approximately ____ million people were unemployed in [country]."
  Replace bracketed placeholders with supported context before output.
- Alternatively:
  "Between [start year] and [end year], industrial production in [country]
  fell by approximately ____%."
- Never output the bracketed placeholders or invent their values.

ACCEPTED ANSWERS AND UNITS
- AcceptedAnswers contains 1–12 English/numeric variants separated by |.
- AcceptedAnswersZh contains 1–12 Chinese/numeric variants separated by |.
- Include established alternative names, spellings and abbreviations only
  when they unambiguously identify the same answer.
- Do not accept vague fragments that could identify a different answer.
- For a numeric answer, include the intended numeric form in both columns.
- Make the blank's expected scale and units clear in each language.
- If the sentence supplies "million", the missing number is the coefficient,
  not the full number of people. If it supplies "%", the missing number is
  the percentage value, not a decimal fraction.
- English and Chinese may use different conventional scales, such as
  million and 萬. Their accepted answers must match their respective
  sentence wording and represent the same historical quantity.
- Include reasonable forms with or without units only when they express
  the same intended answer and should genuinely be accepted.
- Do not accept a different magnitude merely as a formatting variant.
- Do not rely on automatic translation, numerical conversion or punctuation
  equivalence. Only case, spacing and character-width differences are normalised.
`,

    Matching: `
ORDINARY MATCHING — NOT YEAR MATCHING
- Use 2–6 left items.
- Use at least as many right options as left items, up to 8 right options.
- Extra right options may be unused distractors.
- Answer1 is the NUMBER of the correct Right option for Left1, and so on.
- Each left item has one uniquely correct answer.
- Correct right options must be different for different left items.
- Fill Left and Right columns consecutively without gaps.
- Leave unused cells empty.
- Chinese Left/Right items must align exactly with their English counterparts.
- Suitable pairings: event with description, organisation with role,
  historical term with meaning, or unambiguous event categorisation.
- Do NOT create year-to-event matching here. The application generates it
  from Timeline.
- Do not force one-to-one categorisation where several answers are defensible.
- One complete matching set is ONE question row.
`,

    Timeline: `
TIMELINE EVENT BANK
- One significant historical event per row.
- Event: a concise, identifiable event name.
- Year: one integer year for the specific milestone named.
- Category: its principal historical category/aspect in the English notes.
- Context: a brief explanation of what happened and why it matters.
- EventZh, CategoryZh and ContextZh: faithful Traditional Chinese equivalents.
- Use Chinese-note terminology where available.
- Active must be TRUE; Demo must be FALSE.
- AllowOutsideCentury is FALSE for years 1901–2000.
- For an explicitly authorised year outside 1901–2000, it must be TRUE.

The application uses these rows to generate:
1. Three sequencing questions, each with four events from different years.
2. Three year-matching questions, each with three or four tested years
   and two extra event options.

Do NOT output preassembled question combinations.
Do NOT repeat an event merely to create another combination.
Do NOT place the year in the Event/EventZh label when that reveals the answer.
Use the Year column instead.
Use clear milestones rather than long processes with no single year.
Do not make duplicate labels for different milestones; name the milestone clearly.
Events from different historical categories are welcome.
Spread events across different years where supported by the notes.
A usable bank needs at least six different years, but never invent events
or distort the notes just to reach that threshold.

Exclude:
- Operational stages of military plans.
- Battle manoeuvres.
- Internal steps within one example.
- Intended procedural stages.
- Economic statistics.
- Troop-strength figures.
- Other technical numerical data that are not event years.
`
};

function boundedNumber(value, minimum, maximum) {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number)) return minimum;
    return Math.max(minimum, Math.min(maximum, number));
}

export default function QuestionPrompt() {
    const [topicId, setTopicId] = useState("ww1");
    const [batch, setBatch] = useState("B01");

    const [counts, setCounts] = useState({
        MC: 60,
        Blank: 30,
        Matching: 10
    });

    const [startYear, setStartYear] = useState(1901);
    const [endYear, setEndYear] = useState(2000);
    const [instructions, setInstructions] = useState("");
    const [englishNotes, setEnglishNotes] = useState("");
    const [chineseNotes, setChineseNotes] = useState("");
    const [message, setMessage] = useState("");

    const topic = TOPICS.find(t => t.id === topicId) || TOPICS[0];

    const questionSheets = SHEETS.filter(sheet => sheet !== "Timeline");

    const total = questionSheets.reduce(
        (sum, sheet) => sum + counts[sheet],
        0
    );

    const activeSheets = SHEETS.filter(sheet =>
        sheet === "Timeline" || counts[sheet] > 0
    );

    const valid =
        total >= 0 &&
        total < 2500 &&
        startYear <= endYear;

    const prefix = `${topic.id.toUpperCase()}-${batch || "B01"}`;

    const worksheetRules = activeSheets.map(sheet => `
WORKSHEET: ${sheet}
${sheet === "Timeline"
            ? `Extract ALL distinct significant dated events supported by the
English notes within the selected scope.
There is NO fixed target of 40 events.
The number of rows must follow the source material, not an arbitrary quota.

First inventory the significant events across every section of the notes.
Then check that every eligible event in that inventory has one Timeline row.
Do not select only a representative sample.
Do not omit an eligible event merely because 40 rows have been reached.
Do not invent or pad events when the notes contain fewer than 40.
Do not repeat the same event because it appears in several note sections.
Keep distinct events that share the same year as separate bank rows.
The application, not the workbook, avoids same-year events within a question.
Do not output preassembled sequencing or year-matching questions.

If a significant event has no reliable exact year in the supplied notes,
ask for clarification rather than inventing a year.`
            : `Generate exactly ${counts[sheet]} question rows.`}

IDs: ${prefix}-${CODES[sheet]}-0001, ${prefix}-${CODES[sheet]}-0002, etc.

${RULES[sheet]}

Use this EXACT header order with actual TAB separators:
${HEADERS[sheet].join("\t")}

Every row must contain exactly ${HEADERS[sheet].length} columns.
`).join("\n");

    const prompt = valid
        ? `Create bilingual history FOUNDATION material from the supplied English notes.

WEBSITE CLASSIFICATION
Theme: ${topic.theme}
Topic: ${topic.label}
Use these exact classification values.

TEACHING PURPOSE
Establish students' basic historical knowledge before argument construction.

Prioritise:
- Recognition of important events, plans, treaties, agreements and organisations.
- Basic historical context.
- Important countries, people and historical terms where the notes emphasise them.
- Clear historical categorisation.
- Simple recognition of how an event illustrates a historical factor.
- Important numerical evidence showing historical scale, conditions or impact.
- Important event years and broad chronology, primarily through Timeline.

QUESTION-TYPE EMPHASIS
- Blank: primarily recall of important names and significant non-date statistics.
  Give dates as contextual clues where useful rather than routinely testing them.
  Follow the Blank worksheet's balance rules and strict year/date-answer ceiling.
- Timeline: the principal bank for sequencing and year-to-event matching.
- MC: recognition, context, categories and other suitable foundational facts,
  including selected important years and numerical evidence.
- Matching: meaningful non-year associations such as events and descriptions,
  organisations and roles, or terms and meanings.
- Broad chronology is a course priority, not an instruction to make every
  worksheet predominantly test years.

Avoid:
- Detailed operational processes within an example.
- Stages of Germany's war plan.
- Battle manoeuvres and military routes.
- Minute procedural detail.
- Obscure trivia.
- Essay questions.
- Complex argument construction or evaluation.

Do not present a debatable category as the only defensible interpretation.
Specify the aspect being tested when an event could illustrate several factors.

EXERCISE DESIGN — CONTEXT ONLY
The website generates each new exercise as:
- 14 foundation questions drawn from MC, Blank and ordinary Matching.
- 3 sequencing questions generated from Timeline.
- 3 year-to-event matching questions generated from Timeline.

Do not create prewritten sequencing sets or year-matching sets.
Create individual event rows instead.

AUTHORING COUNTS AND EVENT COVERAGE
${activeSheets.map(sheet =>
            sheet === "Timeline"
                ? "- Timeline: ALL eligible significant dated events from the notes; no fixed event count."
                : `- ${sheet}: exactly ${counts[sheet]} question rows.`
        ).join("\n")}

Fixed foundation-question total: ${total}.
The final combined total is ${total} PLUS the extracted Timeline events.

These are bank-authoring instructions, not exercise percentages.
Each Timeline row is one EVENT, not one generated question.
Each complete ordinary matching set is one question row.

Do not stop extracting events after 40.
Do not invent events to reach 40.
Preserve all distinct eligible events, including events sharing a year.

A single imported workbook supports at most 2,500 combined records.
The existing bank also supports at most 2,500 combined records.
If the requested output would exceed the workbook limit, ask the teacher
to reduce question counts or divide the material into separate workbooks.
Do not silently omit significant events to fit the limit.
Dividing workbooks does not remove the overall bank limit.

DATE SCOPE
Selected range: ${startYear}–${endYear}, inclusive.
Default course range is 1901–2000.
Exclude out-of-range examples even when they appear in the notes,
unless the teacher explicitly authorises an exception below.

Apply the selected scope to:
- Tested facts and event premises.
- Answer options and distractors.
- Matching items.
- Timeline events.
- Examples introduced in explanations.

An explicit teacher exception can authorise an out-of-range event.
For every Timeline year outside 1901–2000, set AllowOutsideCentury=TRUE.
Otherwise set AllowOutsideCentury=FALSE.

SOURCE PRIORITY
1. English notes are the content authority.
2. Chinese notes provide established Traditional Chinese terminology and phrasing.
3. Chinese notes must not add examinable facts absent from the English notes.
4. If a Chinese equivalent is not found, provide an accurate Traditional Chinese
   translation rather than leaving the new bilingual row incomplete.
5. If English and Chinese notes conflict on a fact/year, ask or avoid the point.
6. If no usable English notes are supplied or attached, ask for them first.
7. Never claim to have read an inaccessible attachment.
8. Never invent sources, quotations, events or statistics.

ENGLISH NOTES
${englishNotes.trim() || "[Check for attached English notes. If none are accessible, ask for them.]"}

CHINESE NOTES
${chineseNotes.trim() || "[Check for attached Chinese notes. If unavailable, translate accurately from the English material.]"}

TEACHER'S ADDITIONAL INSTRUCTIONS
${instructions.trim() || "No additional instructions."}

Apply these to teaching emphasis, exclusions and explicitly authorised date exceptions.
Preserve the workbook schemas, answer formats and IDs.
Preserve the requested MC, Blank and ordinary Matching counts.
Timeline coverage is determined by all eligible significant events in the notes,
not by a fixed number of event rows.

BILINGUAL RULES
- English content first, then a faithful Traditional Chinese version.
- Translate questions, subtopics/categories, explanations and all used options/items.
- Keep option/item meanings in exactly the same English/Chinese positions.
- Share the same MC answer letter and matching answer indices across languages.
- Do not place bilingual text in the English cell.
- Do not omit necessary Chinese fields from a newly generated row.
- Do not independently change difficulty or meaning in translation.
- Keep numbers, units, names and qualifiers consistent.

STUDENT-FACING WORDING
- Use the supplied notes as the content authority silently.
- Start directly with the historical question or task.
- Do not introduce questions with references to their origin.
- Never use phrases such as:
  "According to the notes", "From the notes", "Based on the notes",
  "As mentioned in the notes", "In the provided material",
  "According to the textbook", or "As discussed in class".
- Apply the same restriction to Traditional Chinese, including:
  "根據筆記", "按照筆記", "根據講義", "根據教材",
  "筆記指出", "筆記提到", "如課堂所述" and similar wording.
- This applies to questions, options, matching items, explanations,
  event labels and event contexts in both languages.
- Do not refer to note pages, sections, attachments or teaching materials.
- Questions must be self-contained: identify the historical event, country,
  organisation or period needed to answer without opening the notes.
- If removing a source reference makes a question ambiguous, rewrite it
  with specific historical context. Do not merely remove the opening phrase.
- Do not ask what the notes say, list, mention, describe or classify.
  Ask about the historical fact itself.
- Explanations must state the answer and relevant historical context directly,
  not say that an answer is correct because it appears in the notes.
- Keep meaningful historical attribution where it is part of the fact being
  tested, such as a named treaty's provisions or a person's stated policy.
  The restriction concerns references to the teaching material, not history.
- These wording rules do not permit adding facts absent from the source notes.

Wording examples only; do not add these topics unless supported by the notes:
- Avoid: "According to the notes, in which year did Event X occur?"
  Use: "In which year did Event X occur?"
- Avoid: "Which organisation is mentioned in the notes as responsible for X?"
  Use: "Which organisation was responsible for X?"
- Avoid: "根據筆記，事件X發生於哪一年？"
  Use: "事件X發生於哪一年？"
- Avoid: "筆記指出，事件X發生於某年。"
  Use: "事件X發生於某年。"

GENERAL QUALITY
- Use original wording.
- Avoid duplicate and near-duplicate questions.
- Check every answer key.
- Explanations should state the correct fact and briefly explain its context.
- Use meaningful subtopics rather than repeating the overall topic label.
- Question: at most 1600 characters.
- Explanation: at most 2400 characters.
- Subtopic/category: at most 160 characters.
- Individual options, items and accepted answers: at most 400 characters.
- Timeline Event: at most 400 characters.
- Timeline Context: at most 1000 characters.
- Apply the same limits to Chinese equivalents.
- The teacher will review all content before publishing.

IDS AND FLAGS
- Use the worksheet-specific ID prefixes below.
- IDs must be unique across the complete output.
- Only letters, digits, hyphens and underscores.
- IDs must be at most 48 characters.
- Do not use the reserved GEN- prefix.
- Active=TRUE.
- Demo=FALSE.

WORKSHEET REQUIREMENTS
${worksheetRules}

OUTPUT — STRICT TSV
- Output exactly ${activeSheets.length} separate TSV code blocks.
- Order: ${activeSheets.join(", ")}.
- Immediately above each block, put only the exact worksheet name.
- First line inside each block: the exact header.
- For MC, Blank and Matching, output exactly the requested question count.
- For Timeline, output one row for EVERY eligible significant dated event.
- Do not truncate Timeline to 40 rows or pad it to reach 40.
- If the output cannot fit in one response, ask to split it into clearly
  identified parts before generating. Never silently omit the remaining events.
- Actual TAB characters between cells.
- One physical line per row.
- No tabs or line breaks inside a cell.
- Preserve empty cells, including trailing empty cells.
- Do not output Markdown tables, CSV or JSON.
- Do not mix worksheet schemas.
- Do not add a question-number column.
- No formulas; no cell may start with =, +, - or @.
- Do not output a Sequencing worksheet.

FINAL CHECK
Verify counts, column lengths, unique IDs, all answer keys, source scope,
date scope, bilingual alignment and complete Chinese translations.
For Timeline, check that every row is an individual significant event,
not a statistic or a procedural stage.

For Blank, if requested:
- Check the distribution of important-name answers, non-date numerical
  answers and year/date answers.
- Confirm that important names and significant numerical evidence are
  the primary focus, using the worksheet's planning targets where supported.
- Confirm that year/date answers do not exceed 10% of the requested
  Blank rows, rounded down. For 30 rows, the maximum is 3.
- Rewrite excess year questions to test important names or supported
  numerical evidence instead. Do not merely disguise a date question.
- Confirm that each English and Chinese question contains exactly one
  integrated ____ blank, not a question followed by "Answer: ____".
- Ensure that the missing answer is not revealed elsewhere in the
  question or in its subtopic label.
- Check that every statistic has sufficient historical context and preserves
  its quantity, scale, baseline and approximation qualifiers.
- Check that accepted numeric answers match the units and scale supplied
  around the blank in each language.
- Confirm that no statistics were invented and no near-duplicate questions
  were added merely to meet a count or target proportion.
- Keep this review internal; do not add columns or commentary to the TSV.

Review every student-facing English and Chinese cell.
Rewrite any reference to the notes, textbook, handout, attachment, lesson
or source material as a direct historical question or factual statement.
Check for equivalent wording, not only the exact prohibited phrases.
Ensure each rewritten question remains self-contained and unambiguous.
Do not include this review or any source-origin commentary in the output.

If clarification is needed, ask before generating.
Otherwise return only worksheet labels and their TSV code blocks.
Do not claim incomplete output is complete.`
        : "Choose 0–2,499 foundation-question rows and a valid year range. Leave room for Timeline events.";

    return (
        <section className="kt-prompt-content">
            <p className="kt-eyebrow">Question and event authoring</p>
            <h2>Bilingual foundation-bank prompt</h2>

            <p className="kt-notice">
                Exercise format: 14 foundation questions + 3 sequencing
                questions + 3 year-matching questions. Both chronology
                formats use the same Timeline event bank.
            </p>

            <div className="kt-form-grid">
                <label className="kt-field">
                    Topic
                    <select
                        value={topicId}
                        onChange={event => {
                            setTopicId(event.target.value);
                            setMessage("");
                        }}
                    >
                        {TOPICS.map(t => (
                            <option key={t.id} value={t.id}>
                                {t.label}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="kt-field">
                    Batch code
                    <input
                        value={batch}
                        maxLength={20}
                        onChange={event => {
                            setBatch(
                                event.target.value.replace(/[^A-Za-z0-9_-]/g, "")
                            );
                            setMessage("");
                        }}
                    />
                </label>
            </div>

            <h3>Bank rows to author</h3>

            <div className="kt-form-grid">
                {questionSheets.map(sheet => (
                    <label className="kt-field" key={sheet}>
                        {LABELS[sheet]}
                        <input
                            type="number"
                            min="0"
                            max="2500"
                            step="1"
                            value={counts[sheet]}
                            onChange={event => {
                                const value = boundedNumber(
                                    event.target.value,
                                    0,
                                    2500
                                );

                                setCounts(current => ({
                                    ...current,
                                    [sheet]: value
                                }));

                                setMessage("");
                            }}
                        />
                    </label>
                ))}
            </div>

            <p className={total >= 2500 ? "kt-error" : "kt-muted"}>
                Foundation questions: {total}.
                Set a question count to zero to omit that question worksheet.
                Timeline is always included and contains all eligible significant
                dated events identified from the notes.
                The combined workbook must contain no more than 2,500 records.
            </p>

            <p className="kt-notice">
                Timeline event count: automatic — not limited to 40.
                Each row stores one event, its exact year, context and
                Traditional Chinese translation. Distinct events with the same
                year remain in the bank. When an exercise starts, the application
                selects events with different years for sequencing and year matching.
            </p>

            <div className="kt-form-grid">
                <label className="kt-field">
                    First included year
                    <input
                        type="number"
                        min="1"
                        max="3000"
                        value={startYear}
                        onChange={event => {
                            setStartYear(
                                boundedNumber(event.target.value, 1, 3000)
                            );
                            setMessage("");
                        }}
                    />
                </label>

                <label className="kt-field">
                    Last included year
                    <input
                        type="number"
                        min="1"
                        max="3000"
                        value={endYear}
                        onChange={event => {
                            setEndYear(
                                boundedNumber(event.target.value, 1, 3000)
                            );
                            setMessage("");
                        }}
                    />
                </label>
            </div>

            <p className="kt-muted">
                Default: 1901–2000. Explicitly authorised Timeline events
                outside that range require AllowOutsideCentury=TRUE.
                Review such exceptions before importing.
            </p>

            <label className="kt-field">
                Additional teaching instructions
                <textarea
                    className="kt-author-textarea"
                    rows={5}
                    value={instructions}
                    placeholder={
                        "Add topic emphasis, exclusions or explicit date exceptions. " +
                        "Focus on foundational context, categories and important facts, " +
                        "not detailed processes."
                    }
                    onChange={event => {
                        setInstructions(event.target.value);
                        setMessage("");
                    }}
                />
            </label>

            <details className="kt-details">
                <summary>
                    English notes — content authority
                    {englishNotes.trim() ? " (added)" : ""}
                </summary>

                <textarea
                    className="kt-author-textarea"
                    rows={8}
                    value={englishNotes}
                    aria-label="English reference notes"
                    onChange={event => {
                        setEnglishNotes(event.target.value);
                        setMessage("");
                    }}
                />

                <p className="kt-muted">
                    Paste the notes here or attach them when sending the prompt.
                </p>
            </details>

            <details className="kt-details">
                <summary>
                    Chinese notes — preferred terminology
                    {chineseNotes.trim() ? " (added)" : ""}
                </summary>

                <textarea
                    className="kt-author-textarea"
                    rows={8}
                    value={chineseNotes}
                    aria-label="Chinese reference notes"
                    onChange={event => {
                        setChineseNotes(event.target.value);
                        setMessage("");
                    }}
                />
            </details>

            <div className="kt-row kt-spaced">
                <button
                    type="button"
                    disabled={!valid}
                    onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(prompt);
                            setMessage("Prompt copied.");
                        } catch {
                            setMessage(
                                "Open the prompt preview and copy the text manually."
                            );
                        }
                    }}
                >
                    Copy prompt
                </button>

                <span role="status">{message}</span>
            </div>

            <details className="kt-details">
                <summary>Show / hide generated prompt</summary>

                <textarea
                    className="kt-author-textarea kt-prompt-preview"
                    readOnly
                    value={prompt}
                    rows={10}
                    aria-label="Generated AI prompt"
                    onFocus={event => event.target.select()}
                />
            </details>

            <p className="kt-muted kt-spaced">
                Download a fresh template. Paste each TSV block into its
                matching worksheet starting at A1. Do not copy worksheet
                labels or code-block markers. Review all facts and translations.
                Large requests may need smaller batches with different batch codes.
            </p>
        </section>
    );
}