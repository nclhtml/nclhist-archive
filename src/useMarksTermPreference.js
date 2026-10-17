import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import {
  doc,
  onSnapshot,
  runTransaction,
  setDoc
} from 'firebase/firestore';

import { db } from './firebase.js';

export default function useMarksTermPreference({
  user,
  selectedClass,
  availableTerms,
  enabled
}) {
  const email = String(user?.email || '').toLowerCase().trim();

  const identity = JSON.stringify([
    email,
    selectedClass
  ]);

  const localStorageKey = `marks:last-term:v1:${JSON.stringify([
    user?.uid || user?.email || 'guest',
    selectedClass
  ])}`;

  const termListKey = JSON.stringify(
    Array.isArray(availableTerms) ? availableTerms : []
  );

  const validTerms = useMemo(
    () => JSON.parse(termListKey),
    [termListKey]
  );

  const [selection, setSelection] = useState({
    identity: '',
    value: ''
  });

  const [status, setStatus] = useState({
    identity: '',
    error: ''
  });

  const pendingWriteRef = useRef(null);
  const writeSequenceRef = useRef(0);

  const preferenceRef = useMemo(() => {
    if (!email || !selectedClass) return null;

    return doc(
      db,
      'user_progress',
      email,
      'marks_term_preferences',
      `class:${encodeURIComponent(selectedClass)}`
    );
  }, [email, selectedClass]);

  useEffect(() => {
    pendingWriteRef.current = null;

    setSelection({
      identity,
      value: ''
    });

    setStatus({
      identity,
      error: ''
    });

    if (!enabled || !preferenceRef) return;

    let cancelled = false;
    let creatingPreference = false;

    const readLocalFallback = () => {
      let localTerm = '';

      try {
        localTerm = window.localStorage.getItem(localStorageKey) || '';
      } catch {
        // Firebase remains the cross-device source of truth.
      }

      return validTerms.includes(localTerm)
        ? localTerm
        : validTerms[0] || '';
    };

    const stop = onSnapshot(
      preferenceRef,
      { includeMetadataChanges: true },
      snapshot => {
        if (cancelled) return;

        // Wait for the server before deciding that the preference is
        // absent. An empty local cache must not overwrite another device.
        if (snapshot.metadata.fromCache) return;

        const pending = pendingWriteRef.current;

        const savedTerm = snapshot.exists()
          ? snapshot.data().term
          : '';

        if (
          pending?.identity === identity &&
          savedTerm !== pending.value
        ) {
          return;
        }

        const nextTerm = validTerms.includes(savedTerm)
          ? savedTerm
          : readLocalFallback();

        setSelection({
          identity,
          value: nextTerm
        });

        // Migrate the old browser preference on first use, but create
        // only if the document is STILL absent inside the transaction.
        if (
          !snapshot.exists() &&
          nextTerm &&
          !creatingPreference &&
          !user?.isImpersonating
        ) {
          creatingPreference = true;

          runTransaction(db, async transaction => {
            const current = await transaction.get(preferenceRef);

            if (!current.exists()) {
              transaction.set(preferenceRef, {
                className: selectedClass,
                term: nextTerm,
                updatedAt: new Date().toISOString()
              });
            }
          })
            .catch(error => {
              if (cancelled) return;

              console.error('Could not initialize term preference:', error);

              setStatus({
                identity,
                error:
                  'The term preference could not be saved to Firebase. ' +
                  'Check your connection and try selecting the term again.'
              });
            })
            .finally(() => {
              creatingPreference = false;
            });
        }
      },
      error => {
        if (cancelled) return;

        console.error('Could not load term preference:', error);

        setStatus({
          identity,
          error:
            'Could not load your saved term from Firebase. ' +
            'Check your connection and permissions.'
        });
      }
    );

    return () => {
      cancelled = true;
      stop();
    };
  }, [
    enabled,
    identity,
    preferenceRef,
    localStorageKey,
    termListKey,
    validTerms,
    selectedClass,
    user?.isImpersonating
  ]);

  const setSelectedTerm = useCallback(value => {
    const nextTerm = typeof value === 'string' ? value : '';

    if (
      !enabled ||
      !preferenceRef ||
      !validTerms.includes(nextTerm)
    ) {
      return;
    }

    const sequence = ++writeSequenceRef.current;

    pendingWriteRef.current = {
      identity,
      value: nextTerm,
      sequence
    };

    setSelection({
      identity,
      value: nextTerm
    });

    setStatus({
      identity,
      error: ''
    });

    try {
      window.localStorage.setItem(localStorageKey, nextTerm);
    } catch {
      // A browser-storage failure must not prevent Firebase saving.
    }

    // Debug viewing must not change the impersonated account's preference.
    if (user?.isImpersonating) {
      pendingWriteRef.current = null;
      return;
    }

    setDoc(
      preferenceRef,
      {
        className: selectedClass,
        term: nextTerm,
        updatedAt: new Date().toISOString()
      },
      { merge: true }
    )
      .catch(error => {
        if (writeSequenceRef.current !== sequence) return;

        console.error('Could not save term preference:', error);

        setStatus({
          identity,
          error:
            'This term is selected locally, but Firebase saving failed. ' +
            'Check your connection, then select the term again.'
        });
      })
      .finally(() => {
        if (pendingWriteRef.current?.sequence === sequence) {
          pendingWriteRef.current = null;
        }
      });
  }, [
    enabled,
    preferenceRef,
    validTerms,
    identity,
    localStorageKey,
    selectedClass,
    user?.isImpersonating
  ]);

  return {
    selectedTerm:
      selection.identity === identity ? selection.value : '',
    setSelectedTerm,
    termPreferenceError:
      status.identity === identity ? status.error : ''
  };
}