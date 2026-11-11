import { useEffect, useLayoutEffect, useRef } from "react";

function hasVerticalScroll(element) {
  return element &&
    element.scrollHeight > element.clientHeight + 2;
}

function elementTarget(event) {
  const target = event.composedPath?.()[0] || event.target;

  return target instanceof Element
    ? target
    : null;
}

export default function useDialogueGestures({
  gameRef,
  enabled,
  next,
  back,
  closeTooltip,
  tooltipOpen,
}) {
  const latest = useRef({
    enabled,
    next,
    back,
    closeTooltip,
    tooltipOpen,
  });

  useLayoutEffect(() => {
    latest.current = {
      enabled,
      next,
      back,
      closeTooltip,
      tooltipOpen,
    };
  });

  useEffect(() => {
    const game = gameRef.current;
    if (!game) return undefined;

    const wheelState = {
      lastTime: 0,
      direction: 0,
      amount: 0,
      used: false,
    };

    let touch = null;

    function wheel(event) {
      const state = latest.current;

      if (
        !state.enabled ||
        event.ctrlKey ||
        !event.deltaY
      ) {
        return;
      }

      const target = elementTarget(event);
      if (!target) return;

      /*
       * These panels use ordinary scrolling, never scene skipping.
       */
      if (
        target.closest(
          "dialog,.choices-content,.ending-content,.paper-note,#word-tooltip"
        )
      ) {
        return;
      }

      const dialogueText = target.closest("#dialogue-text");

      if (hasVerticalScroll(dialogueText)) {
        return;
      }

      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return;
      }

      if (event.cancelable) event.preventDefault();

      if (state.tooltipOpen) {
        state.closeTooltip();
        return;
      }

      const now = performance.now();
      const direction = Math.sign(event.deltaY);
      const newGesture =
        now - wheelState.lastTime > 180 ||
        direction !== wheelState.direction;

      if (newGesture) {
        wheelState.amount = 0;
        wheelState.used = false;
      }

      wheelState.lastTime = now;
      wheelState.direction = direction;

      if (wheelState.used) return;

      const multiplier = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? game.clientHeight
          : 1;

      wheelState.amount += event.deltaY * multiplier;

      if (Math.abs(wheelState.amount) < 28) return;

      wheelState.used = true;

      if (direction > 0) {
        state.next();
      } else {
        state.back();
      }
    }

    function touchStart(event) {
      touch = null;

      if (
        !latest.current.enabled ||
        event.touches.length !== 1
      ) {
        return;
      }

      const target = elementTarget(event);
      const dialogue = target?.closest("#dialogue");

      if (
        !dialogue ||
        target.closest("button,a,input,textarea,.term")
      ) {
        return;
      }

      const text = dialogue.querySelector("#dialogue-text");

      /*
       * Let the user scroll long dialogue normally.
       */
      if (hasVerticalScroll(text)) return;

      const point = event.touches[0];

      touch = {
        x: point.clientX,
        y: point.clientY,
        lastX: point.clientX,
        lastY: point.clientY,
      };
    }

    function touchMove(event) {
      if (!touch) return;

      if (event.touches.length !== 1) {
        touch = null;
        return;
      }

      const point = event.touches[0];

      touch.lastX = point.clientX;
      touch.lastY = point.clientY;

      const dx = touch.lastX - touch.x;
      const dy = touch.lastY - touch.y;

      if (
        Math.abs(dy) > 12 &&
        Math.abs(dy) > Math.abs(dx) * 1.2 &&
        event.cancelable
      ) {
        /*
         * This listener is explicitly non-passive.
         * Prevent page movement only for a recognised dialogue swipe.
         */
        event.preventDefault();
      }
    }

    function touchEnd(event) {
      if (!touch) return;

      const point = event.changedTouches[0];

      const dx = (point?.clientX ?? touch.lastX) - touch.x;
      const dy = (point?.clientY ?? touch.lastY) - touch.y;

      touch = null;

      if (
        !latest.current.enabled ||
        Math.abs(dy) < 55 ||
        Math.abs(dy) <= Math.abs(dx) * 1.2
      ) {
        return;
      }

      /*
       * Prevent the swipe from also producing a synthetic click.
       */
      if (event.cancelable) event.preventDefault();

      if (latest.current.tooltipOpen) {
        latest.current.closeTooltip();
        return;
      }

      if (dy < 0) {
        latest.current.next();
      } else {
        latest.current.back();
      }
    }

    function cancelTouch() {
      touch = null;
    }

    game.addEventListener("wheel", wheel, { passive: false });
    game.addEventListener("touchstart", touchStart, { passive: true });
    game.addEventListener("touchmove", touchMove, { passive: false });
    game.addEventListener("touchend", touchEnd, { passive: false });
    game.addEventListener("touchcancel", cancelTouch);

    return () => {
      game.removeEventListener("wheel", wheel);
      game.removeEventListener("touchstart", touchStart);
      game.removeEventListener("touchmove", touchMove);
      game.removeEventListener("touchend", touchEnd);
      game.removeEventListener("touchcancel", cancelTouch);
    };
  }, [gameRef]);
}