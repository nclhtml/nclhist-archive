"use strict";

const admin = require("firebase-admin");

function numeric(value) {
    if (
        typeof value !== "number" &&
        typeof value !== "string"
    ) {
        return null;
    }

    const text = String(value).trim();

    if (!text) return null;

    const result = Number(text);

    return Number.isFinite(result) ? result : null;
}

function positive(value) {
    const number = numeric(value);
    return number !== null && number > 0;
}

function assessmentClasses(assessment) {
    return Array.isArray(assessment.classes)
        ? assessment.classes
        : assessment.className
            ? [assessment.className]
            : [];
}

function configured(assessment) {
    if (assessment.designatedPending === true) return false;

    const sections = Array.isArray(assessment.sectionsConfig)
        ? assessment.sectionsConfig
        : [];

    if (!sections.length) {
        return positive(assessment.fullMark);
    }

    if (!positive(assessment.paperFullMark)) return false;

    return sections.every(section => {
        const weight = numeric(section.weight);

        if (
            !section.id ||
            !String(section.name || "").trim() ||
            !positive(section.fullMark) ||
            weight === null ||
            weight < 0
        ) {
            return false;
        }

        if (!section.hasSubSections) return true;

        return (
            Array.isArray(section.subSections) &&
            section.subSections.length > 0 &&
            section.subSections.every(sub =>
                sub.id &&
                String(sub.name || "").trim() &&
                positive(sub.fullMark)
            )
        );
    });
}

function containsRecordedMark(value, assessment) {
    // Supports historical total-only records as well as zero.
    if (numeric(value) !== null) return true;

    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        return false;
    }

    const sections = Array.isArray(assessment.sectionsConfig)
        ? assessment.sectionsConfig
        : [];

    if (!sections.length) {
        return Object.values(value).some(
            mark => numeric(mark) !== null
        );
    }

    return sections.some(section => {
        if (section.hasSubSections) {
            return (section.subSections || []).some(
                sub => numeric(value[sub.id]) !== null
            );
        }

        return numeric(value[section.id]) !== null;
    });
}

/**
 * Administrators retain their existing view.
 *
 * Students:
 * - never receive unconfigured placeholders;
 * - receive designated/common assessments only when configured
 *   and containing at least one actual student's numeric mark.
 *
 * This function filters before records or links are returned.
 */
async function studentVisibleAssessments(assessments, account) {
    // Student Dashboard has the same visibility requirements for
    // administrators and students. Planned items belong in Marks,
    // not in the dashboard response.
    const candidates = assessments.filter(
        assessment => assessment.designatedPending !== true
    );

    const common = candidates.filter(
        assessment => Boolean(assessment.designatedSource)
    );

    if (!common.length) return candidates;

// Read only the students of the classes used by these assessments,
    // instead of the whole students collection.
    const classNames = [...new Set(
        common
            .flatMap(assessmentClasses)
            .filter(name => typeof name === "string" && name.length > 0)
    )];

    const chunks = [];

    for (let start = 0; start < classNames.length; start += 30) {
        chunks.push(classNames.slice(start, start + 30));
    }

    const snapshots = await Promise.all(
        chunks.map(chunk =>
            admin.firestore()
                .collection("students")
                .where("className", "in", chunk)
                .get()
        )
    );

    const actualStudents = new Map();

    snapshots.forEach(snapshot => {
        snapshot.docs.forEach(document => {
            const student = document.data();

            if (!student.isDummy && !student.isDeleted) {
                actualStudents.set(document.id, student);
            }
        });
    });

    return candidates.filter(assessment => {
        if (!assessment.designatedSource) return true;
        if (!configured(assessment)) return false;

        const classes = assessmentClasses(assessment);
        const marks = assessment.marks || {};

        return Object.entries(marks).some(([studentId, value]) => {
            const student = actualStudents.get(studentId);

            if (
                !student ||
                !classes.includes(student.className)
            ) {
                return false;
            }

            return containsRecordedMark(value, assessment);
        });
    });
}

module.exports = {
    studentVisibleAssessments
};