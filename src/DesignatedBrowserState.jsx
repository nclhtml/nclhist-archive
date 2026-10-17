import React, {
  useCallback,
  useEffect,
  useState
} from 'react';

import { useAuth } from './main.jsx';

export function useDesignatedLocalFlag(identity, defaultValue = false) {
  const { user } = useAuth();

  const key = 'designated:interface:v2:' + JSON.stringify([
    user?.email || 'signed-out',
    identity
  ]);

  const read = useCallback(() => {
    try {
      const saved = window.localStorage.getItem(key);

      if (saved === 'true') return true;
      if (saved === 'false') return false;
    } catch {
      // Continue with in-memory state if storage is unavailable.
    }

    return Boolean(defaultValue);
  }, [key, defaultValue]);

  const [state, setState] = useState(() => ({
    key,
    value: read()
  }));

  const value = state.key === key ? state.value : read();

  useEffect(() => {
    setState(previous =>
      previous.key === key
        ? previous
        : { key, value: read() }
    );
  }, [key, read]);

  const setValue = useCallback(next => {
    setState(previous => {
      const oldValue = previous.key === key
        ? previous.value
        : read();

      const value = typeof next === 'function'
        ? Boolean(next(oldValue))
        : Boolean(next);

      try {
        window.localStorage.setItem(key, String(value));
      } catch {
        // Keep the preference in memory for this visit.
      }

      return { key, value };
    });
  }, [key, read]);

  return [value, setValue];
}

export function DesignatedLocalDetails({
  identity,
  title,
  children,
  defaultOpen = false,
  className = ''
}) {
  const [open, setOpen] = useDesignatedLocalFlag(
    identity,
    defaultOpen
  );

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs font-bold text-slate-600"
      >
        <span>{title}</span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      <div hidden={!open} className="mt-2">
        {children}
      </div>
    </div>
  );
}