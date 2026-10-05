const DAY = 24 * 60 * 60 * 1000;
const HK_OFFSET = 8 * 60 * 60 * 1000;

function hkDay(ms = Date.now()) {
    return new Date(ms + HK_OFFSET).toISOString().slice(0, 10);
}

function completedToday(summary, day) {
    return summary.practiceDay === day
        ? Number(summary.completedToday || 0)
        : 0;
}

function limitDisabled(summary, day) {
    // "More than five completed practices" means six completed reports.
    return completedToday(summary, day) > 5;
}

function isBlocked(entry, day) {
    if (!entry) return false;

    // Keep the same-day restriction even if the second inclusion
    // resolves the mistake.
    const isReview =
        entry.needsRevision === true ||
        entry.reviewDay === day;

    return isReview &&
        entry.exposureDay === day &&
        Number(entry.exposureCount || 0) >= 2;
}

function eligibleItems(items, entries, summary, day) {
    if (limitDisabled(summary, day)) return items;

    return items.filter(item => !isBlocked(entries[item.id], day));
}

function reserveAppearances(entries, ids, day) {
    for (const id of new Set(ids)) {
        const old = entries[id] || {};

        entries[id] = {
            ...old,
            exposureDay: day,
            exposureCount: old.exposureDay === day
                ? Number(old.exposureCount || 0) + 1
                : 1,
            reviewDay: old.needsRevision
                ? day
                : old.reviewDay || null
        };
    }
}

function recordIdsForAttempt(attempt) {
    return [...new Set(
        attempt.questions.flatMap(question =>
            question.generatedKind
                ? (question.eventRecords || []).map(event => event.id)
                : [question.id]
        )
    )];
}

module.exports = {
    DAY,
    hkDay,
    completedToday,
    limitDisabled,
    eligibleItems,
    reserveAppearances,
    recordIdsForAttempt
};