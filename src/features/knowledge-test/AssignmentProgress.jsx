import React from "react";
import { useLanguage } from "../../LanguageContext.jsx";
import { assignmentDone } from "./api.js";

export default function AssignmentProgress({ assignment }) {
    const { language } = useLanguage();

    const onTime = Math.max(0, Number(assignment.completed || 0));
    const late = Math.max(0, Number(assignment.late || 0));
    const target = Number(assignment.target || 1);

    const explanation = language === "zh"
        ? `準時 ${onTime} 次，遲交 ${late} 次；合共完成 ${assignmentDone(assignment)} 次，要求 ${target} 次`
        : `${onTime} on time, ${late} late; ${assignmentDone(assignment)} completed out of ${target} required`;

    return (
        <span
            className="kt-assignment-count"
            title={explanation}
            aria-label={explanation}
        >
            {late > 0 ? (
                <>
                    ({onTime} + <span className="kt-late-count">{late}</span>)
                    /{target}
                </>
            ) : (
                <>{onTime}/{target}</>
            )}
        </span>
    );
}