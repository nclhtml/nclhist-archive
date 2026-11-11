import React, { useLayoutEffect, useState } from "react";

export default function StableActor({
  id,
  node,
  caption,
  children,
}) {
  const position = node.cast.indexOf(id);
  const shown = position >= 0;

  const requestedSlot = node.cast.length === 1
    ? "solo"
    : position === 0
      ? "left"
      : "right";

  const [lastSlot, setLastSlot] = useState(
    id === "koo" ? "right" : "left"
  );

  useLayoutEffect(() => {
    if (shown) {
      setLastSlot(requestedSlot);
    }
  }, [shown, requestedSlot]);

  return (
    <figure
      className={[
        "actor",
        lastSlot,
        shown ? "shown" : "",
        shown && node.focus === id ? "speaking" : "",
      ].join(" ")}
    >
      <div className="photo-shell">
        {children}
      </div>

      <figcaption>{caption}</figcaption>
    </figure>
  );
}