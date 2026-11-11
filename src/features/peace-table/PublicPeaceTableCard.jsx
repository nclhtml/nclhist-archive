import React from "react";
import { Link } from "react-router-dom";
import DecisionIcon from "./DecisionIcon.jsx";

export default function PublicPeaceTableCard() {
  return (
    <section
      aria-labelledby="public-peace-table-title"
      className="mb-6 rounded-xl border p-5 shadow-sm"
      style={{
        background: "#17231b",
        borderColor: "#826d45",
        color: "#eee3ca",
      }}
    >
      <div className="flex items-start gap-4">
        <div
          aria-hidden="true"
          style={{
            width: 48,
            minWidth: 48,
            color: "#d2b47b",
          }}
        >
          <DecisionIcon name="document" />
        </div>

        <div className="min-w-0 flex-1">
          <p
            className="mb-1 text-xs uppercase tracking-widest"
            style={{ color: "#d2b47b" }}
          >
            Public historical simulation · No sign-in required
          </p>

          <h2
            id="public-peace-table-title"
            className="text-xl font-bold"
          >
            China at the Peace Table
          </h2>

          <p className="mt-2 text-sm leading-relaxed">
            Take the role of Wellington Koo at the Paris Peace Conference.
            Make four decisions and receive a personalised conference
            record for your reflection.
          </p>

          <Link
            to="/peace-table"
            className="mt-4 inline-block rounded-md px-4 py-2 text-sm font-bold"
            style={{
              background: "#cfb079",
              color: "#172019",
            }}
          >
            Enter the conference →
          </Link>
        </div>
      </div>
    </section>
  );
}