import React, { useState } from "react";
import { useLanguage } from "../../LanguageContext.jsx";
import useCloudAnswers from "./useCloudAnswers.js";
import { knowledgeApi } from "./api.js";
import { localizeQuestion, localizedTopic } from "./quizLanguage.js";

function complete(q, value) {
    if (q.type === "mc") {
        return Number.isInteger(value) &&
            value >= 0 &&
            value < q.choices.length;
    }

    if (q.type === "blank") {
        return typeof value === "string" && value.trim().length > 0;
    }

    if (!Array.isArray(value)) return false;

    const length = q.type === "matching" ? q.left.length : q.items.length;
    const maximum = q.type === "matching" ? q.right.length : q.items.length;

    return value.length === length &&
        value.every(index =>
            Number.isInteger(index) && index >= 0 && index < maximum
        ) &&
        new Set(value).size === length;
}

export default function FoundationRunner({
    attempt,
    busy,
    run,
    onFinish,
    onExit
}) {
    const { language } = useLanguage();
    const tr = (en, zh) => language === "zh" ? zh : en;

    const {
        answers,
        updateAnswer,
        save,
        saveStatus,
        getRevision
    } = useCloudAnswers(attempt);

    const [position, setPosition] = useState(0);

    const rawQuestion = attempt.questions[position];
    const q = rawQuestion
        ? localizeQuestion(rawQuestion, language)
        : null;

    if (!q) {
        return (
            <section className="kt-card">
                {tr("No questions are available.", "沒有可用題目。")}
            </section>
        );
    }

    const value = answers[q.id];

    const answered = attempt.questions.filter(question =>
        complete(question, answers[question.id])
    ).length;

    const update = next => updateAnswer(q.id, next);

    const move = next => run(async () => {
        await save();
        setPosition(next);
    });

    const sequence = q.type === "sequence"
        ? (
            Array.isArray(value) && value.length
                ? value
                : q.items.map((_, index) => index)
        )
        : [];

    const moveItem = (index, direction) => {
        const target = index + direction;
        if (target < 0 || target >= sequence.length) return;

        const next = [...sequence];
        [next[index], next[target]] = [next[target], next[index]];
        update(next);
    };

    const typeLabel = q.generatedKind === "yearMatching"
        ? tr("Year matching", "年份配對")
        : {
            mc: tr("Multiple choice", "選擇題"),
            blank: tr("Fill in the blank", "填充題"),
            matching: tr("Matching", "配對題"),
            sequence: tr("Chronological sequencing", "時序排列")
        }[q.type];

    return (
        <section className="kt-card kt-runner">
            <div className="kt-row kt-between">
                <div>
                    <p className="kt-eyebrow">
                        {attempt.preview
                            ? tr("Administrator preview", "管理員預覽")
                            : tr("Knowledge practice", "歷史基礎知識練習")}
                    </p>

                    <h2>{attempt.title}</h2>
                </div>

                <button
                    className="kt-secondary"
                    disabled={busy}
                    onClick={() => run(async () => {
                        await save();
                        await onExit();
                    })}
                >
                    {tr("Save and exit", "儲存並離開")}
                </button>
            </div>

            <p className="kt-muted">
                {tr(
                    "New exercises: 14 foundation questions, 3 sequencing questions and 3 year-matching questions.",
                    "新練習：14題基礎知識、3題時序排列及3題年份配對。"
                )}
            </p>

            {attempt.questions.length < 20 && (
                <p className="kt-notice">
                    {tr(
                        "This older short exercise does not count as a compulsory 20-question assignment.",
                        "這份舊版短練習不計作20題的指定功課。"
                    )}
                </p>
            )}

            <div className="kt-row kt-between">
                <span>
                    {tr(
                        `Question ${position + 1} of ${attempt.questions.length}`,
                        `第 ${position + 1} 題，共 ${attempt.questions.length} 題`
                    )}
                </span>

                <span>
                    {tr(`${answered} answered`, `已回答 ${answered} 題`)}
                </span>
            </div>

            <div className="kt-row kt-between">
                <p className="kt-muted" role="status">
                    {tr("Cloud save status", "雲端儲存狀態")}: {saveStatus}
                </p>

                <button
                    type="button"
                    className="kt-secondary"
                    disabled={busy}
                    onClick={() => run(save)}
                >
                    {tr("Save now / retry", "立即儲存／重試")}
                </button>
            </div>

            <progress value={answered} max={attempt.questions.length} />

            <div
                className="kt-question-nav"
                aria-label={tr("Question navigation", "題目導覽")}
            >
                {attempt.questions.map((question, index) => (
                    <button
                        key={question.id}
                        type="button"
                        disabled={busy}
                        className={[
                            index === position ? "current" : "",
                            complete(question, answers[question.id]) ? "answered" : ""
                        ].join(" ")}
                        aria-label={tr(
                            `Question ${index + 1}`,
                            `第 ${index + 1} 題`
                        )}
                        aria-current={index === position ? "step" : undefined}
                        onClick={() => move(index)}
                    >
                        {index + 1}
                    </button>
                ))}
            </div>

            <div className="kt-row">
                {(q.topicIds || [q.topic]).map(topic => (
                    <span className="kt-tag" key={topic}>
                        {localizedTopic(topic, language)}
                    </span>
                ))}

                <span className="kt-tag">{typeLabel}</span>

                {q.demo && (
                    <span className="kt-tag">
                        {tr("DEMONSTRATION ONLY", "僅供示範")}
                    </span>
                )}
            </div>

            {q.translationMissing && (
                <p className="kt-notice kt-spaced">
                    此題尚未有完整中文翻譯，暫時顯示英文版本。
                </p>
            )}

            {!!q.reviewEvents?.length && (
                <p className="kt-notice kt-spaced">
                    {tr("Previous event mistakes: ", "曾答錯的事件：")}
                    {q.reviewEvents.map(event =>
                        language === "zh"
                            ? event.nameZh || event.name
                            : event.name
                    ).join(" / ")}
                </p>
            )}

            <h3 className="kt-question-title">{q.prompt}</h3>

            <fieldset disabled={busy} className="kt-answer-fieldset">
                <legend className="kt-sr-only">
                    {tr("Your answer", "你的答案")}
                </legend>

                {q.type === "mc" && (
                    <div className="kt-options">
                        {q.choices.map((choice, index) => (
                            <label
                                key={index}
                                className={value === index ? "selected" : ""}
                            >
                                <input
                                    type="radio"
                                    name={q.id}
                                    checked={value === index}
                                    onChange={() => update(index)}
                                />

                                <span className="kt-option-letter">
                                    {String.fromCharCode(65 + index)}
                                </span>

                                <span>{choice}</span>
                            </label>
                        ))}
                    </div>
                )}

                {q.type === "blank" && (
                    <label className="kt-field">
                        {tr("Type your answer", "輸入答案")}

                        <input
                            type="text"
                            maxLength={400}
                            autoComplete="off"
                            value={typeof value === "string" ? value : ""}
                            onChange={event => update(event.target.value)}
                        />
                    </label>
                )}

                {q.type === "matching" && (
                    <>
                        {q.right.length > q.left.length && (
                            <p className="kt-muted">
                                {tr(
                                    `${q.left.length} items and ${q.right.length} options. Some options are not used.`,
                                    `${q.left.length}個配對項目，${q.right.length}個選項。部分選項不會使用。`
                                )}
                            </p>
                        )}

                        <div className="kt-matching">
                            {q.left.map((left, index) => {
                                const matches = Array.isArray(value)
                                    ? value
                                    : q.left.map(() => null);

                                return (
                                    <label key={index}>
                                        <span>{left}</span>

                                        <select
                                            value={matches[index] ?? ""}
                                            onChange={event => {
                                                const next = [...matches];

                                                next[index] = event.target.value === ""
                                                    ? null
                                                    : Number(event.target.value);

                                                update(next);
                                            }}
                                        >
                                            <option value="">
                                                {tr("Choose a match", "選擇配對")}
                                            </option>

                                            {q.right.map((right, rightIndex) => (
                                                <option
                                                    key={rightIndex}
                                                    value={rightIndex}
                                                    disabled={matches.some((v, i) =>
                                                        i !== index && v === rightIndex
                                                    )}
                                                >
                                                    {right}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                );
                            })}
                        </div>
                    </>
                )}

                {q.type === "sequence" && (
                    <>
                        <p className="kt-muted">
                            {tr(
                                "Use the arrows to arrange the events from earliest to latest.",
                                "使用箭嘴，將事件由最早至最遲排列。"
                            )}
                        </p>

                        <ol className="kt-sequence">
                            {sequence.map((item, index) => (
                                <li key={item}>
                                    <span>{index + 1}. {q.items[item]}</span>

                                    <div>
                                        <button
                                            type="button"
                                            className="kt-secondary"
                                            disabled={index === 0}
                                            aria-label={tr(
                                                `Move ${q.items[item]} up`,
                                                `將「${q.items[item]}」上移`
                                            )}
                                            onClick={() => moveItem(index, -1)}
                                        >
                                            ↑
                                        </button>

                                        <button
                                            type="button"
                                            className="kt-secondary"
                                            disabled={index === sequence.length - 1}
                                            aria-label={tr(
                                                `Move ${q.items[item]} down`,
                                                `將「${q.items[item]}」下移`
                                            )}
                                            onClick={() => moveItem(index, 1)}
                                        >
                                            ↓
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ol>

                        {!complete(q, value) && (
                            <button
                                type="button"
                                className="kt-secondary"
                                onClick={() => update(sequence)}
                            >
                                {tr("Use this order", "確認此排列")}
                            </button>
                        )}
                    </>
                )}
            </fieldset>

            <div className="kt-row kt-between kt-spaced">
                <button
                    className="kt-secondary"
                    disabled={busy || position === 0}
                    onClick={() => move(position - 1)}
                >
                    {tr("Previous", "上一題")}
                </button>

                {position < attempt.questions.length - 1 ? (
                    <button
                        disabled={busy}
                        onClick={() => move(position + 1)}
                    >
                        {tr("Next question", "下一題")}
                    </button>
                ) : (
                    <button
                        disabled={busy || answered !== attempt.questions.length}
                        onClick={() => run(async () => {
                            await save();

                            const result = await knowledgeApi("submit", {
                                id: attempt.id,
                                expectedRevision: getRevision()
                            });

                            onFinish(result);
                        })}
                    >
                        {tr("Submit exercise", "提交練習")}
                    </button>
                )}
            </div>

            {position === attempt.questions.length - 1 &&
                answered !== attempt.questions.length && (
                    <p className="kt-muted">
                        {tr(
                            "Answer every question before submitting.",
                            "請回答所有題目後才提交。"
                        )}
                    </p>
                )}
        </section>
    );
}