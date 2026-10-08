import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "../../LanguageContext.jsx";
import { auth } from "../../firebase.js";
import { knowledgeApi } from "./api.js";

export default function useCloudAnswers(attempt) {
  const { language } = useLanguage();

  const [answers, setAnswers] = useState(attempt.answers || {});
  const [saveStatus, setSaveStatus] = useState("Saved to Firebase");

  const answersRef = useRef(attempt.answers || {});
  const revisionRef = useRef(attempt.answerRevision || 0);
  const editedGeneration = useRef(0);
  const savedGeneration = useRef(0);
  const pendingRequest = useRef(null);
  const queue = useRef(Promise.resolve());
  const mounted = useRef(true);

  const ownerUid = useRef(attempt.uid || auth.currentUser?.uid);
  const ownerEmail = useRef(
    String(attempt.email || auth.currentUser?.email || "")
      .toLowerCase()
      .trim()
  );

  const setStatus = useCallback(value => {
    if (mounted.current) setSaveStatus(value);
  }, []);

  const checkOwner = useCallback(() => {
    const current = auth.currentUser;

    if (
      !current ||
      current.uid !== ownerUid.current ||
      String(current.email || "").toLowerCase().trim() !==
        ownerEmail.current
    ) {
      throw new Error(
        "The signed-in account changed. Sign in again with the account that owns this exercise."
      );
    }
  }, []);

  const updateAnswer = useCallback((questionId, value) => {
    if (!mounted.current) return;

    checkOwner();

    const next = {
      ...answersRef.current,
      [questionId]: value
    };

    answersRef.current = next;
    editedGeneration.current += 1;
    setAnswers(next);
    setStatus("Changes not yet saved");
  }, [checkOwner, setStatus]);

  const save = useCallback(() => {
    const job = queue.current
      .catch(() => {
        // Permit a later retry after a failed request.
      })
      .then(async () => {
        if (!mounted.current) return;

        checkOwner();

        while (
          mounted.current &&
          (
            pendingRequest.current ||
            savedGeneration.current < editedGeneration.current
          )
        ) {
          checkOwner();

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

          setStatus("Saving to Firebase…");

          try {
            const result = await knowledgeApi("save", {
              id: pending.id,
              answers: pending.answers,
              expectedRevision: pending.expectedRevision,
              saveId: pending.saveId,
              expectedUid: ownerUid.current
            });

            revisionRef.current = result.answerRevision;
            savedGeneration.current = pending.generation;
            pendingRequest.current = null;
          } catch (error) {
            setStatus(
              `Not saved: ${error.message || "Check your connection."}`
            );

            throw error;
          }
        }

        if (mounted.current) {
          setStatus("Saved to Firebase");
        }
      });

    queue.current = job;
    return job;
  }, [attempt.id, checkOwner, setStatus]);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (savedGeneration.current === editedGeneration.current) return;

    const timer = window.setTimeout(() => {
      save().catch(error => {
        setStatus(`Not saved: ${error.message || "Check your connection."}`);
      });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [answers, save, setStatus]);

  useEffect(() => {
    const retryUnsaved = () => {
      if (
        mounted.current &&
        (
          pendingRequest.current ||
          savedGeneration.current < editedGeneration.current
        )
      ) {
        save().catch(error => {
          setStatus(
            `Not saved: ${error.message || "Check your connection."}`
          );
        });
      }
    };

    const visibilityChanged = () => {
      // Try saving both when leaving and when returning.
      // A suspended browser cannot guarantee request completion.
      retryUnsaved();
    };

    const warnBeforeLeaving = event => {
      if (
        pendingRequest.current ||
        savedGeneration.current < editedGeneration.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };

    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("online", retryUnsaved);
    window.addEventListener("focus", retryUnsaved);
    window.addEventListener("beforeunload", warnBeforeLeaving);

    return () => {
      document.removeEventListener(
        "visibilitychange",
        visibilityChanged
      );

      window.removeEventListener("online", retryUnsaved);
      window.removeEventListener("focus", retryUnsaved);
      window.removeEventListener("beforeunload", warnBeforeLeaving);
    };
  }, [save, setStatus]);

  const translatedSaveStatus = language === "zh"
    ? (
      {
        "Saved to Firebase": "已儲存至雲端",
        "Changes not yet saved": "修改尚未儲存",
        "Saving to Firebase…": "正在儲存至雲端…"
      }[saveStatus] ||
      (
        saveStatus.startsWith("Not saved:")
          ? "尚未儲存：" + saveStatus.slice("Not saved:".length)
          : saveStatus
      )
    )
    : saveStatus;

  return {
    answers,
    updateAnswer,
    save,
    saveStatus: translatedSaveStatus,
    getRevision: () => revisionRef.current
  };
}