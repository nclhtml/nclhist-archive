import React, { useEffect, useId, useRef, useState } from "react";

import {
  formatYen,
  formatYenExact,
} from "./advisor-model.mjs";

export function Cash({ value }) {
  return (
    <span title={formatYenExact(value)}>
      {formatYen(value)}
    </span>
  );
}

export function Rows({ rows }) {
  return (
    <dl className="hg-ledger">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function Slider({
  label,
  value,
  max = 100,
  onChange,
  disabled = false,
  suffix = "%",
  children,
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const maximum = Math.max(0, Math.floor(max));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit(raw) {
    const parsed = Number(raw);

    const next = Number.isFinite(parsed)
      ? Math.max(0, Math.min(maximum, Math.floor(parsed)))
      : value;

    setText(String(next));
    onChange(next);
  }

  return (
    <div className="jd-slider">
      <label id={id}>{label}</label>

      <div className="jd-slider-inputs">
        <input
          type="range"
          min={0}
          max={maximum}
          step={1}
          value={Math.min(value, maximum)}
          disabled={disabled || maximum === 0}
          aria-labelledby={id}
          onChange={(event) => commit(event.target.value)}
        />

        <div className="jd-exact">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={maximum}
            step={1}
            value={text}
            disabled={disabled || maximum === 0}
            aria-label={`${label}: exact value`}
            onChange={(event) => {
              const raw = event.target.value;
              setText(raw);

              if (raw !== "" && Number.isSafeInteger(Number(raw))) {
                commit(raw);
              }
            }}
            onBlur={() => commit(text === "" ? 0 : text)}
          />
          <span>{suffix}</span>
        </div>
      </div>

      {children && <small>{children}</small>}
    </div>
  );
}

export function DeskModal({
  open,
  title,
  onClose,
  delivery = false,
  children,
}) {
  const reference = useRef(null);
  const heading = useRef(null);
  const id = useId();

  useEffect(() => {
    const dialog = reference.current;
    if (!dialog) return undefined;

    if (open && !dialog.open) {
      dialog.showModal();
      heading.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <dialog
      ref={reference}
      className={`jd-modal ${delivery ? "jd-delivery" : ""}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="jd-modal-card">
        <header>
          <h2 id={id} ref={heading} tabIndex={-1}>{title}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </header>

        <div className="jd-modal-content">
          {open ? children : null}
        </div>
      </div>
    </dialog>
  );
}

export function LineChart({
  values,
  colour = "#31543a",
  label,
  minimum,
  maximum,
  large = false,
}) {
  const data = values.length ? values : [0];
  const width = 500;
  const height = large ? 200 : 95;
  const pad = 12;

  const low = minimum ?? Math.min(...data);
  const high = maximum ?? Math.max(...data);
  const span = Math.max(1, high - low);

  const points = data.map((value, index) => {
    const x = pad + index / Math.max(1, data.length - 1) * (width - pad * 2);
    const y = height - pad - (value - low) / span * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg
      className={`jd-line ${large ? "jd-line-large" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>

      {[0.25, 0.5, 0.75].map((fraction) => (
        <line
          key={fraction}
          x1={pad}
          x2={width - pad}
          y1={height * fraction}
          y2={height * fraction}
          stroke="#e2e7dc"
        />
      ))}

      <polyline
        points={points}
        fill="none"
        stroke={colour}
        strokeWidth={large ? 3 : 4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PortfolioRing({ items }) {
  const populated = items.filter((item) => item.value > 0);
  const total = populated.reduce((sum, item) => sum + item.value, 0);
  const [selectedId, setSelectedId] = useState("");

  const selected = populated.find((item) => item.id === selectedId);
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;

  return (
    <div className="jd-portfolio">
      <svg
        viewBox="0 0 180 180"
        className="jd-ring"
        role="img"
        aria-label={`Cash and investments total ${formatYen(total)}. Breakdown follows.`}
      >
        <circle
          cx={90}
          cy={90}
          r={radius}
          fill="none"
          stroke="#e2e6dc"
          strokeWidth={21}
        />

        {populated.map((item) => {
          const length = item.value / total * circumference;
          const offset = -consumed;
          consumed += length;

          return (
            <circle
              key={item.id}
              cx={90}
              cy={90}
              r={radius}
              fill="none"
              stroke={item.colour}
              strokeWidth={21}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={offset}
              transform="rotate(-90 90 90)"
            />
          );
        })}

        <text x={90} y={83} textAnchor="middle" className="jd-ring-caption">
          {selected ? `${(selected.value / total * 100).toFixed(1)}%` : "Cash & investments"}
        </text>
        <text x={90} y={105} textAnchor="middle" className="jd-ring-value">
          {formatYen(selected?.value ?? total)}
        </text>
      </svg>

      <div className="jd-legend">
        {populated.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={selectedId === item.id}
            onClick={() => setSelectedId(selectedId === item.id ? "" : item.id)}
          >
            <span>
              <i style={{ background: item.colour }} />
              {item.label}
            </span>
            <strong>{formatYen(item.value)}</strong>
            <small>{(item.value / total * 100).toFixed(1)}%</small>
          </button>
        ))}

        {!populated.length && <p>No financial holdings.</p>}
      </div>
    </div>
  );
}