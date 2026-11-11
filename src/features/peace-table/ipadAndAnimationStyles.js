export const IPAD_AND_ANIMATION_CSS = `
/*
 * Safe viewport height fallbacks for Safari.
 */
:host {
  height:100vh;
  min-height:360px;
}

@supports (height:100svh) {
  :host {
    height:100svh;
  }
}

@supports (height:100dvh) {
  :host {
    height:100dvh;
  }
}

#game {
  height:100%;
  max-height:none;
}

button,
a,
input {
  touch-action:manipulation;
}

/*
 * Keep real content panels scrollable on iPad.
 */
.choices-content,
.ending-content,
.paper-note,
#dialogue-text,
.modal-body {
  -webkit-overflow-scrolling:touch;
  overscroll-behavior-y:contain;
}

/*
 * Do not animate coordinate or dimension changes.
 * StableActor retains the previous slot while fading out.
 */
.actor {
  transition:
    opacity .4s ease,
    filter .4s ease,
    transform .4s ease;
}

/*
 * Koo stays in the right-hand portrait position whether alone
 * or sharing the scene. This removes an unnecessary size/position
 * change between solo thoughts and two-person dialogue.
 */
.actor.solo {
  left:auto;
  right:12%;
  width:min(30vw,390px);
}

.photo-shell {
  -webkit-backface-visibility:hidden;
  backface-visibility:hidden;
}

/*
 * Restore the original narrower ending composition.
 */
.ending-content {
  width:min(790px,100%);
}

/*
 * Safari may not support the Fullscreen API on every iPad.
 * The game remains playable in its normal viewport.
 */
@media (max-width:950px) {
  .actor.solo {
    right:6%;
    width:39vw;
  }
}

@media (max-width:560px) {
  .actor.solo {
    right:-3%;
    width:51vw;
    height:49vh;
  }
}

/*
 * Keep controls reachable in landscape with short viewports.
 */
@media (max-height:600px) {
  #dialogue-text {
    max-height:24vh;
    min-height:50px;
  }

  .choices-content,
  .ending-content {
    padding-top:14px;
    padding-bottom:14px;
  }
}

/*
 * Reduce iPad's automatic text resizing when rotating.
 */
#game {
  -webkit-text-size-adjust:100%;
  text-size-adjust:100%;
}

@media (prefers-reduced-motion:reduce) {
  .actor,
  .backdrop,
  #advance span {
    animation:none !important;
    transition:none !important;
  }
}
`;