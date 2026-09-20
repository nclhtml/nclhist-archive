import { useCallback, useEffect, useRef, useState } from "react";
import { knowledgeApi } from "./api.js";

export default function useCloudAnswers(attempt) {
  const [answers, setAnswers] = useState(attempt.answers || {});
  const [saveStatus, setSaveStatus] = useState("Saved to Firebase");

  const answersRef = useRef(attempt.answers || {});
  const revisionRef = useRef(attempt.answerRevision || 0);
  const editedGeneration = useRef(0);
  const savedGeneration = useRef(0);
  const pendingRequest = useRef(null);
  const queue = useRef(Promise.resolve());

  const updateAnswer = useCallback((questionId, value) => {
    const next = {
      ...answersRef.current,
      [questionId]: value
    };

    answersRef.current = next;
    editedGeneration.current += 1;
    setAnswers(next);
    setSaveStatus("Changes not yet saved");
  }, []);

  const save = useCallback(() => {
    const job = queue.current
      .catch(() => {
        // Permit an explicit retry after a failed request.
      })
      .then(async () => {
        while (
          pendingRequest.current ||
          savedGeneration.current < editedGeneration.current
        ) {
          if (!pendingRequest.current) {
            pendingRequest.current = {
              id: attempt.id,
              answers: answersRef.current,
              expectedRevision: revisionRef.current,
              saveId: crypto.randomUUID(),
              generation: editedGeneration.current
            };
          }

          const pending = pendingRequest.current;

          setSaveStatus("Saving to Firebase…");

          try {
            const result = await knowledgeApi("save", {
              id: pending.id,
              answers: pending.answers,
              expectedRevision: pending.expectedRevision,
              saveId: pending.saveId
            });

            revisionRef.current = result.answerRevision;
            savedGeneration.current = pending.generation;
            pendingRequest.current = null;
          } catch (error) {
            // Preserve this request ID so a retry is idempotent.
            setSaveStatus(
              `Not saved: ${error.message || "Check your connection."}`
            );
            throw error;
          }
        }

        setSaveStatus("Saved to Firebase");
      });

    queue.current = job;
    return job;
  }, [attempt.id]);

  useEffect(() => {
    if (savedGeneration.current === editedGeneration.current) return;

    const timer = window.setTimeout(() => {
      save().catch(() => {
        // The visible status reports the error.
      });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [answers, save]);

  useEffect(() => {
    const warnBeforeLeaving = event => {
      if (
        pendingRequest.current ||
        savedGeneration.current < editedGeneration.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", warnBeforeLeaving);

    return () => {
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, []);

  return {
    answers,
    updateAnswer,
    save,
    saveStatus,
    getRevision: () => revisionRef.current
  };
}