import React, { useEffect, useState } from "react";

import { useLanguage } from "../../LanguageContext.jsx";

import {
    knowledgeApi,
    TOPICS,
    accuracy,
    hkTime,
} from "./api.js";

import {
    localizeQuestion,
    localizedTopic
} from "./quizLanguage.js";

import AssignmentPriority from "./AssignmentPriority.jsx";

function useText() {
    const { language } = useLanguage();

    return {
        language,
        tr: (en, zh) => language === "zh" ? zh : en
    };
}

function practiceTitle(title, topics, language) {
    if (language !== "zh") return title;

    const known = {
        "Custom mixed practice": "自選混合練習",
        "Assigned mixed practice": "指定混合練習",
        "Mixed practice": "混合練習"
    };

    if (known[title]) return known[title];

    const topic = TOPICS.find(item => item.label === title);

    if (topic) return localizedTopic(topic.id, language);

    if (String(title).startsWith("[TEST] ")) {
        return `[測試] ${practiceTitle(
            String(title).slice(7),
            topics,
            language
        )}`;
    }

    // Teacher-created titles are content, not interface labels.
    return title;
}

function TopicPicker({ value, onChange }) {
    const { language, tr } = useText();

    return (
        <div className="kt-topic-picker">
            {["A", "B"].map(theme => (
                <fieldset key={theme}>
                    <legend>{tr("Theme", "主題")} {theme}</legend>

                    {TOPICS.filter(topic => topic.theme === theme).map(topic => (
                        <label key={topic.id}>
                            <input
                                type="checkbox"
                                checked={value.includes(topic.id)}
                                onChange={event => onChange(
                                    event.target.checked
                                        ? [...value, topic.id]
                                        : value.filter(id => id !== topic.id)
                                )}
                            />

                            {localizedTopic(topic.id, language)}
                        </label>
                    ))}
                </fieldset>
            ))}
        </div>
    );
}

function Stats({ summary }) {
    const { language, tr } = useText();

    return (
        <>
            <div className="kt-stat-grid">
                <div>
                    <strong>{summary.completed || 0}</strong>
                    <span>{tr("Completed exercises", "已完成練習")}</span>
                </div>

                <div>
                    <strong>
                        {accuracy(summary.totalCorrect, summary.totalAnswered)}
                    </strong>
                    <span>{tr("Overall accuracy", "整體正確率")}</span>
                </div>

                <div>
                    <strong>{summary.unresolved || 0}</strong>
                    <span>{tr("Unresolved mistakes", "尚未鞏固的錯誤")}</span>
                </div>
            </div>

            <details className="kt-details">
                <summary>{tr("Topic statistics", "各課題統計")}</summary>

                <div className="kt-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>{tr("Topic", "課題")}</th>
                                <th>{tr("Exercises including topic", "涉及此課題的練習")}</th>
                                <th>{tr("Questions answered", "已回答題數")}</th>
                                <th>{tr("Accuracy", "正確率")}</th>
                            </tr>
                        </thead>

                        <tbody>
                            {TOPICS.map(topic => {
                                const stat = summary.stats?.[topic.id] || {};

                                return (
                                    <tr key={topic.id}>
                                        <td>{localizedTopic(topic.id, language)}</td>
                                        <td>{stat.runs || 0}</td>
                                        <td>{stat.answered || 0}</td>
                                        <td>{accuracy(stat.correct, stat.answered)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <p className="kt-muted">
                    {tr(
                        "Mixed exercises and cross-topic chronology questions may appear under more than one topic. Do not add topic totals together to calculate overall totals.",
                        "混合練習及跨課題時序題可能同時記錄於多個課題。請勿將各課題的數字相加，以計算整體練習或答題總數。"
                    )}
                </p>
            </details>
        </>
    );
}

function Review({ question, submitted, correct, children }) {
    const { language, tr } = useText();
    const q = localizeQuestion(question, language);

    const answerText = answer => {
        if (answer === null || answer === undefined) {
            return tr("Not answered", "未作答");
        }

        if (q.type === "mc") {
            return q.choices[answer] ?? tr("Not answered", "未作答");
        }

        if (q.type === "blank") {
            return Array.isArray(answer)
                ? answer.join(" / ")
                : String(answer);
        }

        if (q.type === "sequence") {
            return Array.isArray(answer)
                ? answer.map(index => q.items[index]).join(" → ")
                : tr("Not answered", "未作答");
        }

        return q.left.map((left, index) =>
            `${left} → ${q.right[answer?.[index]] ??
            tr("Not answered", "未作答")
            }`
        ).join("; ");
    };

    return (
        <article className={`kt-review ${correct ? "is-correct" : "is-wrong"}`}>
            <div className="kt-row">
                <span className="kt-tag">
                    {localizedTopic(question.topic, language)}
                </span>

                <span className="kt-muted">{q.subtopic}</span>

                <span className="kt-tag">
                    {correct
                        ? tr("Correct", "正確")
                        : tr("Revise this", "需要溫習")}
                </span>
            </div>

            {question.focusEvent && (
                <p className="kt-notice kt-spaced">
                    <strong>
                        {tr("Event to revise: ", "需要溫習的事件：")}
                    </strong>

                    {language === "zh"
                        ? question.focusEvent.nameZh ||
                        question.focusEvent.name
                        : question.focusEvent.name}
                </p>
            )}

            {q.translationMissing && (
                <p className="kt-muted">
                    此題尚未有完整中文翻譯，暫時顯示英文。
                </p>
            )}

            <h3>{q.prompt}</h3>

            <p>
                <strong>{tr("Your answer: ", "你的答案：")}</strong>
                {answerText(submitted)}
            </p>

            <p>
                <strong>{tr("Correct answer: ", "正確答案：")}</strong>
                {answerText(q.answer)}
            </p>

            <p className="kt-explanation">{q.explanation}</p>

            {children}
        </article>
    );
}

export function StudentReport({ attempt, onBack }) {
    const { language, tr } = useText();
    const [showAll, setShowAll] = useState(false);

    const wrong = attempt.results.filter(result => !result.correct);

    const revisionTopics = {};

    wrong.forEach(result => {
        const raw = attempt.questions.find(question =>
            question.id === result.id
        );

        if (!raw) return;

        const question = localizeQuestion(raw, language);
        const key =
            `${localizedTopic(raw.topic, language)} — ${question.subtopic}`;

        revisionTopics[key] = (revisionTopics[key] || 0) + 1;
    });

    return (
        <section className="kt-card">
            <button
                type="button"
                className="kt-secondary"
                onClick={onBack}
            >
                ← {tr("Back", "返回")}
            </button>

            <p className="kt-eyebrow kt-spaced">
                {attempt.preview
                    ? tr("Administrator preview", "管理員預覽")
                    : tr("Exercise report", "練習報告")}
            </p>

            <h2>{practiceTitle(attempt.title, attempt.topics, language)}</h2>

            <div className="kt-stat-grid">
                <div>
                    <strong>
                        {attempt.correct}/{attempt.questions.length}
                    </strong>
                    <span>{tr("Correct answers", "答對題數")}</span>
                </div>

                <div>
                    <strong>
                        {accuracy(attempt.correct, attempt.questions.length)}
                    </strong>
                    <span>{tr("Accuracy", "正確率")}</span>
                </div>

                <div>
                    <strong>{wrong.length}</strong>
                    <span>{tr("Questions to revise", "需要溫習的題目")}</span>
                </div>
            </div>

            <p className="kt-muted">
                {tr("Submitted", "提交時間")}:
                {" "}{hkTime(attempt.submittedAt, language)} HKT
            </p>

            {attempt.preview && (
                <p className="kt-notice">
                    {attempt.testAssignment
                        ? tr(
                            "Administrator assignment test. Only your own test progress was updated; no student assignments were changed.",
                            "管理員功課測試：只更新你的測試進度，不會更改學生的正式功課。"
                        )
                        : tr(
                            "Preview only. No student progress or assignments were changed.",
                            "僅供預覽，不會更改學生進度或功課紀錄。"
                        )}
                </p>
            )}

            {attempt.assignmentCredit && (
                <p className="kt-notice">
                    {tr("Assignment result: ", "功課紀錄：")}

                    {attempt.assignmentCredit === "on-time"
                        ? tr(
                            "Counted towards completion as on-time work.",
                            "已計入完成次數，並記錄為準時提交。"
                        )
                        : attempt.assignmentCredit === "late"
                            ? tr(
                                "Counted towards completion and labelled late.",
                                "已計入完成次數，並記錄為遲交。"
                            )
                            : tr(
                                "The assignment was cancelled. This report remains in your practice history.",
                                "功課已取消；此報告仍保留於你的練習紀錄。"
                            )}
                </p>
            )}

            {!!wrong.length && (
                <div className="kt-revision-topics">
                    <h3>{tr("Suggested revision", "建議溫習內容")}</h3>

                    <ul>
                        {Object.entries(revisionTopics).map(([topic, count]) => (
                            <li key={topic}>
                                {topic}: {tr(
                                    `${count} incorrect`,
                                    `答錯 ${count} 題`
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {!wrong.length && (
                <p className="kt-notice">
                    {tr(
                        "All answers correct. Well done.",
                        "全部答對，做得很好！"
                    )}
                </p>
            )}

            <label className="kt-check">
                <input
                    type="checkbox"
                    checked={showAll}
                    onChange={event => setShowAll(event.target.checked)}
                />

                {tr(
                    "Show correctly answered questions as well",
                    "同時顯示已答對的題目"
                )}
            </label>

            {attempt.results
                .filter(result => showAll || !result.correct)
                .map(result => (
                    <Review
                        key={result.id}
                        question={attempt.questions.find(question =>
                            question.id === result.id
                        )}
                        submitted={result.submitted}
                        correct={result.correct}
                    />
                ))}
        </section>
    );
}

export function StudentPracticeHome({
    home,
    busy,
    run,
    start,
    refresh
}) {
    const { language, tr } = useText();
    const [mix, setMix] = useState([]);
    const [presetName, setPresetName] = useState("");
    const [presetId, setPresetId] = useState(() => crypto.randomUUID());

    return (
        <>
            {!home.actor.admin && (
                <AssignmentPriority
                    home={home}
                    busy={busy}
                    run={run}
                    start={start}
                    refresh={refresh}
                />
            )}

            {!home.actor.admin && (
                <section className="kt-card">
                    <Stats summary={home.summary} />
                </section>
            )}

            {home.summary.activeAttemptId && (
                <section className="kt-card">
                    <h2>
                        {tr(
                            "Continue your unfinished exercise",
                            "繼續尚未完成的練習"
                        )}
                    </h2>

                    <p className="kt-muted">
                        {tr(
                            "If its assignment has ended, abandon this unfinished exercise before starting other work.",
                            "如所屬功課已結束，請先放棄這份未完成練習，再開始其他練習。"
                        )}
                    </p>

                    <div className="kt-row">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(async () => start(
                                await knowledgeApi("attempt", {
                                    id: home.summary.activeAttemptId
                                })
                            ))}
                        >
                            {tr("Resume exercise", "繼續練習")}
                        </button>

                        <button
                            type="button"
                            className="kt-secondary"
                            disabled={busy}
                            onClick={() => {
                                if (!window.confirm(tr(
                                    "Abandon this exercise? It will not count towards progress.",
                                    "放棄這份練習？它不會計入完成紀錄。"
                                ))) return;

                                run(async () => {
                                    await knowledgeApi("abandonCurrent", {
                                        expectedUid: home.actor.uid
                                    });

                                    await refresh();
                                });
                            }}
                        >
                            {tr("Abandon", "放棄練習")}
                        </button>
                    </div>
                </section>
            )}

            {home.actor.admin && (
                <p className="kt-notice">
                    {tr(
                        "Administrator preview mode: these exercises do not update student scores.",
                        "管理員預覽模式：這些練習不會更改學生的成績。"
                    )}
                </p>
            )}

            <section className="kt-card">
                <p className="kt-eyebrow">
                    {tr("Historical thinking skills", "歷史思維技巧")}
                </p>

                <h2>
                    {tr("Question type recognition", "題型辨識")}
                </h2>

                <p className="kt-muted">
                    {tr(
                        "Essay: recognise the analytical task of an essay question. Each exercise contains 20 multiple-choice questions with 11 fixed question-type options. This category is separate from Theme A and Theme B.",
                        "論述題：辨識論述題的分析要求。每份練習有20道選擇題，每題提供11個固定題型選項。本類別獨立於主題甲及主題乙。"
                    )}
                </p>

                {home.actor.admin && (
                    <button
                        type="button"
                        className="kt-secondary"
                        disabled={busy}
                        onClick={() => run(async () => {
                            const result = await knowledgeApi(
                                "seedEssayRecognition"
                            );

                            await refresh();

                            window.alert(tr(
                                `${result.imported} Essay questions added. ${result.alreadyPresent} existing questions were retained without overwriting edits.`,
                                `已加入 ${result.imported} 道論述題辨識題。另有 ${result.alreadyPresent} 道現有題目保留，沒有覆蓋修改。`
                            ));
                        })}
                    >
                        {tr(
                            "Install the supplied 100 Essay questions",
                            "加入提供的100道論述題辨識題"
                        )}
                    </button>
                )}

                <div className="kt-topic-grid kt-spaced">
                    {home.topics
                        .filter(topic => topic.id === "question-type")
                        .map(topic => (
                            <button
                                type="button"
                                key={topic.id}
                                className="kt-topic-card"
                                disabled={busy || !topic.ready}
                                onClick={() => run(async () => start(
                                    await knowledgeApi("start", {
                                        topics: ["question-type"]
                                    })
                                ))}
                            >
                                <strong>
                                    {tr("Essay", "論述題")}
                                </strong>

                                <span>
                                    {tr(
                                        `${topic.count} active questions`,
                                        `${topic.count} 道可用題目`
                                    )}
                                </span>

                                <span>
                                    {tr(
                                        "20 questions · 11 fixed options",
                                        "20道題目 · 11個固定選項"
                                    )}
                                </span>

                                {!topic.ready && (
                                    <span>
                                        {tr(
                                            "At least 20 active questions are required.",
                                            "需要至少20道可用題目。"
                                        )}
                                    </span>
                                )}

                                <span>
                                    {home.actor.admin
                                        ? tr("Preview →", "預覽 →")
                                        : tr("Practise →", "開始練習 →")}
                                </span>
                            </button>
                        ))}
                </div>
            </section>

            <section className="kt-card">
                <p className="kt-eyebrow">
                    {tr("Choose a focus", "選擇溫習重點")}
                </p>

                <h2>{tr("Topic practice", "課題練習")}</h2>

                <p className="kt-muted">
                    {tr(
                        "Twenty questions: 14 foundation questions, 3 chronological sequencing questions and 3 year-to-event matching questions. Previous mistakes receive higher selection priority.",
                        "每份練習共20題：14題基礎知識、3題時序排列及3題年份與事件配對。曾答錯的題目及事件會獲較高的抽選優先次序。"
                    )}
                </p>

                {["A", "B"].map(theme => (
                    <div key={theme}>
                        <h3>{tr("Theme", "主題")} {theme}</h3>

                        <div className="kt-topic-grid">
                            {home.topics
                                .filter(topic => topic.theme === theme)
                                .map(topic => (
                                    <button
                                        type="button"
                                        key={topic.id}
                                        className="kt-topic-card"
                                        disabled={busy || !topic.ready}
                                        onClick={() => run(async () => start(
                                            await knowledgeApi("start", {
                                                topics: [topic.id]
                                            })
                                        ))}
                                    >
                                        <strong>
                                            {localizedTopic(topic.id, language)}
                                        </strong>

                                        <span>
                                            {tr(
                                                `${topic.count} foundation questions`,
                                                `${topic.count} 題基礎知識題目`
                                            )}
                                        </span>

                                        <span>
                                            {tr(
                                                `${topic.eventCount || 0} timeline events · ${topic.yearCount || 0} different years`,
                                                `${topic.eventCount || 0} 個歷史事件 · ${topic.yearCount || 0} 個不同年份`
                                            )}
                                        </span>

                                        {!topic.ready && (
                                            <span>
                                                {tr(
                                                    "Needs 14 foundation questions and 6 event years",
                                                    "需要至少14題基礎知識及涉及6個不同年份的事件"
                                                )}
                                            </span>
                                        )}

                                        <span>
                                            {home.actor.admin
                                                ? tr("Preview →", "預覽 →")
                                                : tr("Practise →", "開始練習 →")}
                                        </span>
                                    </button>
                                ))}
                        </div>
                    </div>
                ))}
            </section>

            <section className="kt-card">
                <p className="kt-eyebrow">
                    {tr("Make connections", "連繫不同課題")}
                </p>

                <h2>{tr("Build a mixed exercise", "建立混合練習")}</h2>

                <p className="kt-muted">
                    {tr(
                        "Choose any combination. Foundation questions are distributed as evenly as availability allows. Chronology questions use events from the selected topics.",
                        "可選擇任何課題組合。基礎知識題會按題庫供應盡量平均分配；時序題會抽選所選課題的事件。"
                    )}
                </p>

                <TopicPicker value={mix} onChange={setMix} />

                <button
                    type="button"
                    disabled={busy || !mix.length}
                    onClick={() => run(async () => start(
                        await knowledgeApi("start", { topics: mix })
                    ))}
                >
                    {home.actor.admin
                        ? tr("Preview this mix", "預覽此組合")
                        : tr("Start this mix", "開始此混合練習")}
                </button>

                {home.actor.admin && (
                    <div className="kt-preset-create">
                        <label className="kt-field">
                            {tr(
                                "Save this mix as a shared preset",
                                "將此課題組合儲存為共用預設"
                            )}

                            <input
                                value={presetName}
                                maxLength={100}
                                onChange={event =>
                                    setPresetName(event.target.value)
                                }
                            />
                        </label>

                        <button
                            type="button"
                            className="kt-secondary"
                            disabled={busy || !mix.length || !presetName.trim()}
                            onClick={() => run(async () => {
                                await knowledgeApi("preset", {
                                    id: presetId,
                                    name: presetName,
                                    topics: mix
                                });

                                setPresetId(crypto.randomUUID());
                                setPresetName("");
                                await refresh();
                            })}
                        >
                            {tr("Save preset", "儲存預設")}
                        </button>
                    </div>
                )}
            </section>

            {!!home.presets.length && (
                <section className="kt-card">
                    <h2>
                        {tr(
                            "Teacher-created practice groups",
                            "老師設定的課題組合"
                        )}
                    </h2>

                    <div className="kt-topic-grid">
                        {home.presets.map(preset => (
                            <button
                                type="button"
                                key={preset.id}
                                className="kt-topic-card"
                                disabled={busy}
                                onClick={() => run(async () => start(
                                    await knowledgeApi("start", {
                                        presetId: preset.id
                                    })
                                ))}
                            >
                                <strong>{preset.name}</strong>

                                <span>
                                    {preset.topics.map(topic =>
                                        localizedTopic(topic, language)
                                    ).join(" • ")}
                                </span>
                            </button>
                        ))}
                    </div>
                </section>
            )}
        </>
    );
}

export function StudentProfile({ email, busy, run, onReport }) {
    const { language, tr } = useText();

    const [profile, setProfile] = useState(null);
    const [history, setHistory] = useState([]);
    const [cursor, setCursor] = useState(null);
    const [page, setPage] = useState(0);

    useEffect(() => {
        let active = true;

        setProfile(null);
        setHistory([]);
        setCursor(null);
        setPage(0);

        run(async () => {
            const result = await knowledgeApi("profile", {
                email,
                page: 0
            });

            if (!active) return;

            setProfile(result);
            setHistory(result.history.records);
            setCursor(result.history.next);
        });

        return () => {
            active = false;
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [email]);

    if (!profile) {
        return (
            <section className="kt-card">
                {tr("Loading profile…", "正在載入進度…")}
            </section>
        );
    }

    const loadMistakes = next => run(async () => {
        const result = await knowledgeApi("profile", {
            email,
            page: next
        });

        setProfile(result);
        setPage(next);
    });

    const historyStatus = status => ({
        active: tr("Unfinished", "未完成"),
        abandoned: tr("Abandoned", "已放棄"),
        submitted: tr("Submitted", "已提交")
    }[status] || status);

    return (
        <>
            <section className="kt-card">
                <p className="kt-eyebrow">
                    {tr("Individual progress", "個人進度")}
                </p>

                <h2>{email}</h2>
                <Stats summary={profile.summary} />
            </section>

            <section className="kt-card">
                <h2>{tr("Exercise history", "練習紀錄")}</h2>

                <div className="kt-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>{tr("Exercise", "練習")}</th>
                                <th>{tr("Date", "日期")}</th>
                                <th>{tr("Result", "結果")}</th>
                                <th>{tr("Report", "報告")}</th>
                            </tr>
                        </thead>

                        <tbody>
                            {history.map(attempt => (
                                <tr key={attempt.id}>
                                    <td>
                                        {practiceTitle(
                                            attempt.title,
                                            attempt.topics,
                                            language
                                        )}

                                        {attempt.preview &&
                                            tr(" (preview)", "（預覽）")}

                                        {attempt.assignmentCredit === "late" && (
                                            <small className="kt-late-count">
                                                {tr("Late assignment submission", "功課遲交")}
                                            </small>
                                        )}
                                    </td>

                                    <td>
                                        {hkTime(
                                            attempt.submittedAt ||
                                            attempt.createdAt,
                                            language
                                        )}
                                    </td>

                                    <td>
                                        {attempt.status === "submitted"
                                            ? `${attempt.correct}/${attempt.total}`
                                            : historyStatus(attempt.status)}
                                    </td>

                                    <td>
                                        {attempt.status === "submitted" && (
                                            <button
                                                type="button"
                                                className="kt-secondary"
                                                disabled={busy}
                                                onClick={() => run(async () => onReport(
                                                    await knowledgeApi("attempt", {
                                                        email,
                                                        id: attempt.id
                                                    })
                                                ))}
                                            >
                                                {tr("Open report", "查看報告")}
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {!history.length && (
                    <p className="kt-muted">
                        {tr("No exercises yet.", "暫時沒有練習紀錄。")}
                    </p>
                )}

                {cursor && (
                    <button
                        type="button"
                        className="kt-secondary"
                        disabled={busy}
                        onClick={() => run(async () => {
                            const result = await knowledgeApi("history", {
                                email,
                                cursor
                            });

                            setHistory(old => [...old, ...result.records]);
                            setCursor(result.next);
                        })}
                    >
                        {tr("Load older exercises", "載入較早的練習")}
                    </button>
                )}
            </section>

            <section className="kt-card">
                <h2>{tr("Mistake history", "錯誤紀錄")}</h2>

                <p className="kt-muted">
                    {tr(
                        `${profile.mistakeCount} question/event records have previous mistakes. Several event records may refer to the same exercise question.`,
                        `共有 ${profile.mistakeCount} 個曾答錯的題目／事件紀錄。不同事件紀錄可能涉及同一條練習題目。`
                    )}
                </p>

                {profile.mistakes.map(mistake => (
                    <Review
                        key={mistake.id}
                        question={mistake.lastWrong.question}
                        submitted={mistake.lastWrong.submitted}
                        correct={!mistake.needsRevision}
                    >
                        <p>
                            <strong>
                                {mistake.needsRevision
                                    ? tr(
                                        `Recovery: ${mistake.streak || 0}/2`,
                                        `鞏固進度：${mistake.streak || 0}/2`
                                    )
                                    : tr("Resolved", "已鞏固")}
                            </strong>

                            {" · "}

                            {tr(
                                `Incorrect ${mistake.wrongCount} time(s)`,
                                `曾答錯 ${mistake.wrongCount} 次`
                            )}

                            {" · "}

                            {tr("Last incorrect", "最近答錯時間")}:
                            {" "}{hkTime(mistake.lastWrongAt, language)}
                        </p>
                    </Review>
                ))}

                <div className="kt-row">
                    <button
                        type="button"
                        className="kt-secondary"
                        disabled={busy || page === 0}
                        onClick={() => loadMistakes(page - 1)}
                    >
                        {tr("Previous mistakes", "上一頁錯誤紀錄")}
                    </button>

                    <span>
                        {tr(`Page ${page + 1}`, `第 ${page + 1} 頁`)}
                    </span>

                    <button
                        type="button"
                        className="kt-secondary"
                        disabled={
                            busy ||
                            (page + 1) * 25 >= profile.mistakeCount
                        }
                        onClick={() => loadMistakes(page + 1)}
                    >
                        {tr("Next mistakes", "下一頁錯誤紀錄")}
                    </button>
                </div>
            </section>
        </>
    );
}