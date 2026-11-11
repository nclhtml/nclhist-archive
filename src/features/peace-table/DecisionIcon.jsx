import React from "react";

const DRAWINGS = {
  scales: (
    <>
      <path d="M24 7v34M12 41h24M9 15h30M24 7l-4 5h8z" />
      <path d="M12 15L5 29h14zM36 15l-7 14h14z" />
      <path d="M5 29q7 9 14 0M29 29q7 9 14 0" />
    </>
  ),

  documents: (
    <>
      <path d="M7 9h15v29H7zM27 12h14v29H27z" />
      <path d="M11 16h7M11 22h7M11 28h5M31 19h6M31 25h6M31 31h4" />
      <path d="M23 6v36" strokeDasharray="2 4" />
    </>
  ),

  trade: (
    <>
      <path d="M6 34h36l-7 8H13zM24 7v27M24 9L9 29h15zM27 14l12 15H27z" />
      <path d="M5 44q5-3 10 0t10 0t10 0t9 0" />
    </>
  ),

  train: (
    <>
      <path d="M4 33h34l6 7h-7M8 33V20h20v13M28 17h11v16" />
      <path d="M12 20v-8h6v8M10 12h10M28 17v-4h13v4M32 21h4v6h-4z" />
      <path d="M6 27h21M4 41h40M12 37h18" />
      <circle cx="11" cy="36" r="4" />
      <circle cx="23" cy="36" r="4" />
      <circle cx="34" cy="36" r="3" />
      <path d="M15 8c-5-3 2-6 5-4s7 1 7-2" />
    </>
  ),

  document: (
    <>
      <path d="M11 5h19l8 8v30H11zM30 5v9h8" />
      <path d="M17 20h15M17 26h15M17 32h9" />
      <circle cx="31" cy="36" r="4" />
      <path d="M29 40l-1 5 3-2 3 2-1-5" />
    </>
  ),

  shield: (
    <>
      <path d="M24 5l15 6v13c0 9-7 15-15 20C16 39 9 33 9 24V11z" />
      <path d="M16 24l6 6 11-14M14 12l10-3 10 3" />
    </>
  ),

  newspaper: (
    <>
      <path d="M8 8h31v33H8zM39 15h5v22q0 4-5 4" />
      <path d="M13 14h21M13 19h21M13 25h8v9h-8zM25 25h9M25 30h9M13 37h21" />
    </>
  ),

  refuse: (
    <>
      <path d="M10 5h21l7 7v30H10zM31 5v8h7M16 18h16" />
      <path d="M17 25l13 12M30 25L17 37" />
    </>
  ),

  quill: (
    <>
      <path d="M10 39L36 8M18 30C12 13 30 4 42 5c-1 13-10 29-24 25z" />
      <path d="M22 23h12M27 17h10M6 43h26" />
    </>
  ),

  talks: (
    <>
      <path d="M5 8h27v18H17l-8 7v-7H5z" />
      <path d="M32 18h11v19h-5v7l-8-7H20v-7M11 14h15M11 20h10" />
    </>
  ),
};

export function iconForDecision(number, id, answers = []) {
  if (number === 1) {
    return {
      principle: "scales",
      separate: "documents",
      access: "trade",
    }[id];
  }

  if (number === 2) {
    return {
      challenge: "scales",
      commerce: "trade",
      assets: "train",
    }[id];
  }

  if (number === 3) {
    return {
      reservation: "document",
      safeguards: "shield",
      public: "newspaper",
    }[id];
  }

  if (id === "refuse") return "refuse";
  if (id === "sign") return "quill";

  return answers[2] === "reservation"
    ? "document"
    : "talks";
}

export default function DecisionIcon({ name = "document" }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {DRAWINGS[name] || DRAWINGS.document}
    </svg>
  );
}