export function localizeQuestion(question, language) {
    if (language !== "zh") return question;

    if (!question.zh) {
        return {
            ...question,
            translationMissing: true
        };
    }

    const translated = {
        ...question,
        translationMissing: false
    };

    for (const key of [
        "subtopic",
        "prompt",
        "explanation",
        "choices",
        "left",
        "right",
        "items"
    ]) {
        if (question.zh[key] !== undefined) {
            translated[key] = question.zh[key];
        }
    }

    // Only the displayed accepted answers change.
    // Submitted text and numeric answer indices are not translated.
    if (question.type === "blank" && question.zh.answer) {
        translated.answer = question.zh.answer;
    }

    return translated;
}

export function localizedTopic(id, language) {
    const labels = {
        japan: ["Japan", "日本"],
        china: ["China", "中國"],
        "hong-kong": ["Hong Kong", "香港"],
        ww1: ["World War I", "第一次世界大戰"],
        ww2: ["World War II", "第二次世界大戰"],
        "cold-war": ["Cold War", "冷戰"],
        cooperation: ["International Cooperation", "國際協作"]
    };

    return labels[id]?.[language === "zh" ? 1 : 0] || id;
}