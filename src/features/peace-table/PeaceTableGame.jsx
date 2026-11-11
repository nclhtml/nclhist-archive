import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createPortal } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { Link } from "react-router-dom";

import {
  PEOPLE,
  ACTS,
  DEFAULT_LOCATIONS,
  DECISION_NAMES,
  BRIEF_PARAGRAPHS,
  GLOSSARY,
  HISTORICAL_SUMMARY,
  optionsFor,
  optionFor,
  responseFor,
  endingFor,
  buildStory,
} from "./gameData.js";

import {
  GAME_CSS,
  BACKDROPS,
} from "./presentation.js";

import DecisionIcon, {
  iconForDecision,
} from "./DecisionIcon.jsx";

import StableActor from "./StableActor.jsx";
import useBackgroundMusic from "./useBackgroundMusic.js";

import {
  buildReflectionDocument,
  openReflectionDocument,
  downloadReflectionDocument,
} from "./reflectionWorksheet.jsx";

import useDialogueGestures from "./useDialogueGestures.js";
import { IPAD_AND_ANIMATION_CSS } from "./ipadAndAnimationStyles.js";

const AUTO_KEY = "peace-table-react-v1-auto";
const MANUAL_KEY = "peace-table-react-v1-manual";
const PREF_KEY = "peace-table-react-v1-preferences";

const EXTRA_CSS = `
:host {
  display:block;
  width:100%;
  height:100dvh;
  min-height:360px;
  color:#eee3ca;
  background:#090b09;
  font-family:Georgia,"Times New Roman",serif;
}

#game {
  height:100%;
  max-width:none;
  max-height:none;
}

#game header .top-actions {
  align-items:center;
  flex-wrap:wrap;
  justify-content:flex-end;
}

.archive-link {
  font:10px/1.4 Arial,sans-serif;
  padding:9px;
  text-decoration:none;
  border:1px solid var(--line);
}

.title-portrait .photo-fallback {
  inset:10px;
}

.choice {
  grid-template-columns:55px 1fr auto;
}

.choice-emblem {
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:5px;
  color:#d2b47b;
}

.choice-emblem svg {
  width:44px;
  height:44px;
  filter:drop-shadow(0 1px 0 #000);
}

.choice-emblem small {
  font:10px/1 Arial,sans-serif;
  letter-spacing:.12em;
}

.choice.locked .choice-emblem {
  opacity:.5;
}

.choice h3 {
  line-height:1.6;
}

.term {
  text-transform:inherit;
}

#word-tooltip {
  text-transform:none;
  letter-spacing:normal;
}

.ending-content {
  width:min(980px,100%);
}

.route-report {
  text-align:left;
}

.report-section {
  border:1px solid var(--line);
  background:#17251b;
  padding:19px 22px;
  margin:14px 0;
}

.report-section h3 {
  margin:5px 0 14px;
  color:#dfc38d;
  font-size:22px;
  font-weight:normal;
}

.report-section p,
.continuity-note {
  font-size:16px;
  line-height:1.65;
  color:#cad2c3;
}

.report-section strong {
  color:#e7d4ad;
}

.report-question {
  border-left:2px solid #c9aa70;
  padding-left:13px;
}

.continuity-note {
  border:1px dashed var(--line);
  padding:16px 20px;
}

.ending-content,
.ending-content *,
#modal-body,
#modal-body * {
  -webkit-user-select:text;
  user-select:text;
}

.ending-content button,
#modal-body button {
  -webkit-user-select:none;
  user-select:none;
}

.route-code {
  font:11px/1.7 Arial,sans-serif;
  letter-spacing:.12em;
  color:#c9aa70;
}

.modal-body {
  padding:24px 27px;
  max-height:70svh;
  overflow:auto;
  line-height:1.7;
}

.modal-body h3 {
  color:#dcc38c;
  font-size:22px;
  font-weight:normal;
}

.modal-body p {
  color:#c4cbbd;
}

#close-modal {
  flex-shrink:0;
}

.reflection-preview {
  border:1px solid var(--line);
  padding:15px;
  margin-top:20px;
}

@media(max-width:560px) {
  .choice {
    grid-template-columns:40px 1fr;
  }

  .choice-emblem svg {
    width:35px;
    height:35px;
  }

  .report-section {
    padding:15px;
  }

  .report-section h3 {
    font-size:20px;
  }

  .report-section p {
    font-size:15px;
  }

  .archive-link {
    font-size:9px;
    padding:7px;
  }

  #toolbar .toolbar-group {
    gap:5px 10px;
  }

  .modal-body {
    padding:18px;
  }
}
`;

const PRINT_CSS = `
@page { size:A4 portrait; margin:17mm 18mm; }
* { box-sizing:border-box; }
body {
  margin:0;
  color:#000;
  background:#fff;
  font:11pt/1.45 Georgia,"Times New Roman",serif;
}
main { max-width:180mm; margin:20px auto; }
h1 { font-size:18pt; }
h2 { font-size:14pt; margin-top:22px; }
h3 { font-size:12pt; }
p { margin:7px 0; }
.fields { display:flex; flex-wrap:wrap; gap:25px; margin:22px 0; }
.record {
  border:1px solid #777;
  padding:12px 15px;
  margin:14px 0;
}
.record h3 { margin-top:0; }
.small { font-size:9pt; }
.reflection { break-before:page; }
.write-line { height:9mm; border-bottom:1px solid #aaa; }
.question { margin-top:18px; }
.actions { padding:15px; text-align:center; background:#eee; }
button { padding:10px 15px; font:inherit; cursor:pointer; }
h1,h2,h3 { break-after:avoid; }
p,li { orphans:3; widows:3; }
@media print {
  main { max-width:none; margin:0; }
  .actions { display:none; }
}
`;

const aliasMap = new Map();

for (const entry of GLOSSARY) {
  for (const alias of entry.aliases) {
    aliasMap.set(alias.toLowerCase(), entry.id);
  }
}

const glossaryById = Object.fromEntries(
  GLOSSARY.map(entry => [entry.id, entry])
);

const escapeRegex = text =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const termPattern =
  "\\b(?:" +
  [...aliasMap.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join("|") +
  ")\\b";

function termsIn(text) {
  return new Set(
    [...String(text).matchAll(new RegExp(termPattern, "gi"))]
      .map(match => aliasMap.get(match[0].toLowerCase()))
  );
}

function routeCode(answers) {
  return answers.map((id, index) => {
    const position = optionsFor(index + 1, answers)
      .findIndex(option => option.id === id);

    return `${index + 1}${String.fromCharCode(65 + position)}`;
  }).join(" – ");
}

function readSave(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key));

    if (
      !raw ||
      raw.version !== 1 ||
      !Array.isArray(raw.answers) ||
      raw.answers.length > 4
    ) {
      return null;
    }

    const checked = [];

    for (const id of raw.answers) {
      const option = optionsFor(checked.length + 1, checked)
        .find(candidate => candidate.id === id);

      if (!option || option.locked) return null;

      checked.push(id);
    }

    const story = buildStory(checked);
    const index = story.findIndex(node => node.id === raw.nodeID);

    if (index < 0) return null;

    return {
      answers: checked,
      index,
    };
  } catch {
    return null;
  }
}

function storeSave(key, answers, nodeID) {
  try {
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      answers,
      nodeID,
      savedAt: new Date().toISOString(),
    }));

    return true;
  } catch {
    return false;
  }
}

function initialPreferences() {
  const reduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const defaults = {
    speed: reduced ? 0 : 18,
    size: 22,
  };

  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY));

    if (
      Number.isFinite(saved?.speed) &&
      Number.isFinite(saved?.size)
    ) {
      return {
        speed: reduced ? 0 : Math.max(0, Math.min(50, saved.speed)),
        size: Math.max(19, Math.min(29, saved.size)),
      };
    }
  } catch {
    // Playing remains available when browser storage is blocked.
  }

  return defaults;
}

function useTypewriter(text, sceneKey, speed, enabled) {
  const characters = useMemo(
    () => Array.from(text || ""),
    [text]
  );

  const identity = JSON.stringify([
    sceneKey,
    text,
    speed,
    enabled,
  ]);

  const [display, setDisplay] = useState({
    identity: "",
    count: 0,
    revealed: false,
  });

  const frameRef = useRef(0);
  const runRef = useRef(0);

  useLayoutEffect(() => {
    const run = ++runRef.current;

    cancelAnimationFrame(frameRef.current);

    setDisplay({
      identity,
      count: 0,
      revealed: false,
    });

    if (!enabled || speed === 0 || characters.length === 0) {
      return undefined;
    }

    let previousTime = null;
    let elapsed = 0;
    let lastCount = 0;

    const tick = time => {
      if (run !== runRef.current) return;

      if (previousTime === null) {
        previousTime = time;
      }

      /*
       * Do not reveal a whole sentence because Safari paused animation
       * frames while the tab was hidden or the device was briefly busy.
       */
      const delta = document.hidden
        ? 0
        : Math.min(50, Math.max(0, time - previousTime));

      previousTime = time;
      elapsed += delta;

      const count = Math.min(
        characters.length,
        Math.floor(elapsed / Math.max(1, speed))
      );

      if (count !== lastCount) {
        lastCount = count;

        setDisplay({
          identity,
          count,
          revealed: false,
        });
      }

      if (count < characters.length) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (runRef.current === run) {
        runRef.current += 1;
      }

      cancelAnimationFrame(frameRef.current);
    };
  }, [identity, characters, enabled, speed]);

  const current = display.identity === identity
    ? display
    : { count: 0, revealed: false };

  const done =
    !enabled ||
    speed === 0 ||
    current.revealed ||
    current.count >= characters.length;

  const reveal = () => {
    runRef.current += 1;
    cancelAnimationFrame(frameRef.current);

    setDisplay({
      identity,
      count: characters.length,
      revealed: true,
    });
  };

  return {
    done,
    reveal,
    visible: done
      ? text
      : characters.slice(0, current.count).join(""),
  };
}

function useMusic() {
  const [enabled, setEnabled] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      setEnabled(false);
      return undefined;
    }

    let context;

    try {
      context = new AudioContextClass();
    } catch {
      setEnabled(false);
      return undefined;
    }

    audioRef.current = context;

    const master = context.createGain();
    master.gain.value = 0.09;
    master.connect(context.destination);

    let step = 0;
    const notes = [261.63, 329.63, 392, 329.63, 293.66, 261.63];

    const pulse = () => {
      if (document.hidden || context.state === "closed") return;

      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = notes[step++ % notes.length];

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.7);

      oscillator.connect(gain);
      gain.connect(master);

      oscillator.start(now);
      oscillator.stop(now + 2.8);

      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    };

    const visibility = () => {
      if (document.hidden) {
        context.suspend().catch(() => {});
      } else {
        context.resume().catch(() => {});
      }
    };

    context.resume().then(pulse).catch(() => {});
    const timer = setInterval(pulse, 2400);

    document.addEventListener("visibilitychange", visibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      audioRef.current = null;
      context.close().catch(() => {});
    };
  }, [enabled]);

  const toggle = () => {
    if (enabled) {
      setEnabled(false);
    } else {
      setEnabled(true);
    }
  };

  return { enabled, toggle };
}

function Portrait({ id }) {
  const person = PEOPLE[id];
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const direct = person.url;
  const commons =
    "https://commons.wikimedia.org/wiki/Special:FilePath/" +
    encodeURIComponent(person.file);

  const source = attempt === 0 && direct
    ? direct
    : commons;

  return (
    <>
      {!failed && (
        <img
          src={source}
          alt={`Historical photograph of ${person.name}`}
          draggable={false}
          onError={() => {
            if (attempt === 0 && direct) {
              setAttempt(1);
            } else {
              setFailed(true);
            }
          }}
        />
      )}

      {failed && (
        <div className="photo-fallback" style={{ display: "flex" }}>
          <span>{person.initials}</span>
          <small>{person.name}<br />Portrait unavailable</small>
        </div>
      )}
    </>
  );
}

function Modal({ title, onClose, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;

    if (dialog && !dialog.open) dialog.showModal();

    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;

        const rect = event.currentTarget.getBoundingClientRect();

        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        ) {
          onClose();
        }
      }}
    >
      <div className="modal-header">
        <h2 id="modal-title">{title}</h2>

        <button
          type="button"
          id="close-modal"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div id="modal-body" className="modal-body">
        {children}
      </div>
    </dialog>
  );
}

function Worksheet({ answers }) {
  const ending = endingFor(answers);

  return (
    <main>
      <h1>China at the Peace Table</h1>
      <p><strong>Kowloon True Light School · S3 History</strong></p>
      <p>The Shandong Problem at the Paris Peace Conference</p>

      <div className="fields">
        <span>Name: __________________</span>
        <span>Class: __________</span>
        <span>Date: __________</span>
      </div>

      <p><strong>Route:</strong> {routeCode(answers)}</p>
      <p className="small">{ending.disclaimer}</p>

      <h2>My ending: {ending.title}</h2>
      <p>{ending.narrative}</p>

      <ul>
        {ending.facts.map(fact => <li key={fact}>{fact}</li>)}
      </ul>

      <h2>My decision record</h2>

      {ending.sections.map((section, index) => {
        const option = optionFor(
          index + 1,
          answers[index],
          answers
        );

        return (
          <section className="record" key={index}>
            <h3>Decision {index + 1}: {option.label}</h3>

            <p><strong>What I chose:</strong> {option.text}</p>
            <p><strong>Purpose:</strong> {section.intent}</p>
            <p><strong>Response:</strong> {section.response}</p>
            <p><strong>Consequence:</strong> {section.consequence}</p>
            <p><strong>Reflection:</strong> {section.question}</p>
          </section>
        );
      })}

      <p>{ending.continuity}</p>

      <h2>Historical reference</h2>
      <p>{HISTORICAL_SUMMARY}</p>
      <p className="small">
        The later 1922 agreement was not an automatic result of any
        one choice in this simulation.
      </p>

      <section className="reflection">
        <h2>Reflection — Through the eyes of Wellington Koo</h2>

        {[
          {
            title: "1. How far was your ending good for China?",
            text:
              "Identify an interest protected or a partial gain, then " +
              "identify a problem that remained. Use two specific " +
              "details from your personalised decision record. " +
              ending.question,
          },
          {
            title: "2. Which response from another delegation was most difficult?",
            text:
              "Explain what you wanted, what the other delegation " +
              "actually offered or refused, and why its interests " +
              "made agreement difficult.",
          },
          {
            title: "3. Would you keep or change one decision?",
            text:
              "Name an alternative that was available at that point. " +
              "Explain the possible advantage, the risk, and what " +
              "would still depend on another government.",
          },
          {
            title: "4. How did your final action relate to your preparation?",
            text: ending.sections[2].question,
          },
        ].map(question => (
          <div className="question" key={question.title}>
            <h3>{question.title}</h3>
            <p>{question.text}</p>

            {Array.from({ length: 5 }, (_, index) => (
              <div className="write-line" key={index} />
            ))}
          </div>
        ))}
      </section>
    </main>
  );
}

function worksheetDocument(answers) {
  return buildReflectionDocument(answers);
}

function downloadWorksheet(answers) {
  downloadReflectionDocument(answers);
}

function openPrintableWorksheet(answers) {
  return openReflectionDocument(answers);
}

const BRIEF_CARDS = [
  {
    title: "China",
    text:
      "Recover Jiaozhou’s leased territory and the related railway, " +
      "mining and other rights. Protect sovereignty, territorial " +
      "integrity and the interests of the people living there.",
  },
  {
    title: "Japan",
    text:
      "Obtain recognition of its claim to Germany’s former rights. " +
      "Keep economic and strategic advantages. Its promise to discuss " +
      "restoration later does not mean it accepts Chinese conditions.",
  },
  {
    title: "United States",
    text:
      "Create the League of Nations and preserve the wider settlement. " +
      "Wilson fears losing Japan’s cooperation. America also has an " +
      "interest in equal commercial opportunities.",
  },
  {
    title: "Britain and France",
    text:
      "Both promised wartime support for Japan’s Shandong claims. " +
      "Britain values its international relationships; France also " +
      "prioritises security in Europe.",
  },
];

function GameView() {
  const gameRef = useRef(null);
  const headingRef = useRef(null);
  const advanceRef = useRef(null);
  const tooltipTimer = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [answers, setAnswers] = useState([]);
  const [index, setIndex] = useState(0);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [automatic, setAutomatic] = useState(false);
  const [modal, setModal] = useState(null);
  const [tip, setTip] = useState(null);
  const [toast, setToast] = useState("");
  const [wordMode, setWordMode] = useState("current");
  const [wordSearch, setWordSearch] = useState("");
  const [pageVisible, setPageVisible] = useState(!document.hidden);

  const music = useBackgroundMusic();

  useEffect(() => {
    if (music.error) {
      setToast(music.error);
    }
  }, [music.error]);

  const story = useMemo(() => buildStory(answers), [answers]);
  const node = story[Math.min(index, story.length - 1)];
  const completed = answers.length === 4;
  const ending = completed ? endingFor(answers) : null;

  const line = useTypewriter(
    node?.text || "",
    `${playing}:${node?.id}`,
    preferences.speed,
    playing && !node?.kind
  );

  useEffect(() => {
    if (!toast) return undefined;

    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(preferences));
    } catch {
      // Preferences are optional.
    }
  }, [preferences]);

  useEffect(() => {
    if (playing && node) {
      storeSave(AUTO_KEY, answers, node.id);
    }
  }, [playing, answers, node?.id]);

  useEffect(() => {
    setTip(null);
    clearTimeout(tooltipTimer.current);

    if (!playing) return;

    const frame = requestAnimationFrame(() => {
      if (node?.kind === "choice" || node?.kind === "end") {
        headingRef.current?.focus({ preventScroll: true });
      } else {
        advanceRef.current?.focus({ preventScroll: true });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [playing, node?.id]);

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);

    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const hide = () => setTip(null);
    window.addEventListener("resize", hide);

    return () => {
      window.removeEventListener("resize", hide);
      clearTimeout(tooltipTimer.current);
    };
  }, []);

  const sceneText = !playing
    ? ""
    : node.kind === "note"
      ? BRIEF_PARAGRAPHS.join(" ")
      : node.kind === "choice"
        ? [
            node.title,
            node.context,
            ...optionsFor(node.number, answers)
              .flatMap(option => [
                option.label,
                option.text,
                option.reason || "",
              ]),
          ].join(" ")
        : node.kind === "end"
          ? [
              ending.title,
              ending.narrative,
              ...ending.facts,
            ].join(" ")
          : node.text;

  const currentTerms = termsIn(sceneText);

  function openModal(name) {
    line.reveal();
    setTip(null);
    setAutomatic(false);

    if (name === "words") {
      setWordMode("current");
      setWordSearch("");
    }

    setModal(name);
  }

  function next() {
    if (!playing || modal) return;

    setTip(null);

    if (!node.kind && !line.done) {
      line.reveal();
      return;
    }

    if (
      node.kind === "end" ||
      (node.kind === "choice" && !answers[node.number - 1])
    ) {
      return;
    }

    setIndex(value => Math.min(value + 1, story.length - 1));
  }

  function back() {
    if (!playing || modal) return;
    setAutomatic(false);
    setIndex(value => Math.max(0, value - 1));
  }

  useDialogueGestures({
    gameRef,

    enabled: playing && !modal,

    next: () => {
      setAutomatic(false);
      next();
    },

    back,

    closeTooltip: () => setTip(null),

    tooltipOpen: Boolean(tip),
  });

  function choose(position) {
    if (
      !playing ||
      modal ||
      node.kind !== "choice" ||
      answers.length !== node.number - 1
    ) {
      return;
    }

    const option = optionsFor(node.number, answers)[position];
    if (!option || option.locked) return;

    const nextAnswers = [...answers, option.id];
    const nextStory = buildStory(nextAnswers);

    setAutomatic(false);
    setAnswers(nextAnswers);
    setIndex(
      nextStory.findIndex(item => item.id === `answer${node.number}`)
    );
  }

  function revise() {
    if (
      !window.confirm(
        "Replace this decision and all later decisions? " +
        "Your separate manual save will not be changed."
      )
    ) {
      return;
    }

    const nextAnswers = answers.slice(0, node.number - 1);
    const nextStory = buildStory(nextAnswers);

    setAutomatic(false);
    setAnswers(nextAnswers);
    setIndex(
      nextStory.findIndex(item => item.id === `d${node.number}`)
    );
  }

  function startNew() {
    if (
      readSave(AUTO_KEY) &&
      !window.confirm(
        "Start a new conference and replace automatic progress? " +
        "Your separate manual save will remain available."
      )
    ) {
      return;
    }

    setModal(null);
    setAutomatic(false);
    setAnswers([]);
    setIndex(0);
    setPlaying(true);
  }

  function load(key) {
    const saved = readSave(key);

    if (!saved) {
      setToast("No valid save is available in this slot.");
      return;
    }

    setModal(null);
    setAutomatic(false);
    setAnswers(saved.answers);
    setIndex(saved.index);
    setPlaying(true);
  }

  function saveManual() {
    if (!playing) return;

    const saved = storeSave(MANUAL_KEY, answers, node.id);

    setToast(
      saved
        ? "Your route and current scene have been saved in this browser."
        : "Browser storage is unavailable. You can still play and download your worksheet."
    );
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (gameRef.current?.requestFullscreen) {
        await gameRef.current.requestFullscreen();
      } else {
        setToast("Fullscreen is unavailable in this browser.");
      }
    } catch {
      setToast("Fullscreen could not be opened.");
    }
  }

  useEffect(() => {
    if (
      !automatic ||
      !playing ||
      !line.done ||
      node.kind ||
      modal ||
      tip ||
      !pageVisible
    ) {
      return undefined;
    }

    const timer = setTimeout(
      () => setIndex(value => Math.min(value + 1, story.length - 1)),
      Math.max(2200, node.text.split(/\s+/).length * 230)
    );

    return () => clearTimeout(timer);
  }, [
    automatic,
    playing,
    line.done,
    node,
    modal,
    tip,
    pageVisible,
    story.length,
  ]);

  useEffect(() => {
    const keydown = event => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.composedPath()[0];

      if (
        target instanceof Element &&
        target.closest("input,textarea,select,[contenteditable=true]")
      ) {
        return;
      }

      if (event.key === "Escape" && tip) {
        event.preventDefault();
        setTip(null);
        return;
      }

      if (modal) return;

      if (
        target instanceof Element &&
        target.closest("button,a") &&
        [" ", "Enter"].includes(event.key)
      ) {
        return;
      }

      const actions = {
        m: music.toggle,
        f: fullscreen,
      };

      if (playing) {
        Object.assign(actions, {
          " ": next,
          enter: next,
          arrowright: next,
          arrowleft: back,
          "1": () => choose(0),
          "2": () => choose(1),
          "3": () => choose(2),
          g: () => openModal("words"),
          h: () => openModal("log"),
          b: () => openModal("brief"),
          a: () => setAutomatic(value => !value),
          s: saveManual,
          l: () => load(MANUAL_KEY),
        });
      }

      const action = actions[event.key.toLowerCase()];

      if (action) {
        event.preventDefault();
        action();
      }
    };

    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  function showTerm(id, anchor, pinned = false) {
    clearTimeout(tooltipTimer.current);
    setAutomatic(false);

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    const maxHeight = Math.min(300, window.innerHeight * 0.45);
    const below = window.innerHeight - rect.bottom - 12;

    const top = below >= maxHeight
      ? rect.bottom + 10
      : Math.max(12, rect.top - maxHeight - 10);

    setTip({
      id,
      anchor,
      pinned,
      width,
      maxHeight,
      left: Math.max(
        12,
        Math.min(rect.left, window.innerWidth - width - 12)
      ),
      top,
    });
  }

  function scheduleHideTerm() {
    clearTimeout(tooltipTimer.current);

    tooltipTimer.current = setTimeout(() => {
      setTip(current => {
        if (
          current?.pinned ||
          current?.anchor === current?.anchor?.getRootNode()?.activeElement
        ) {
          return current;
        }

        return null;
      });
    }, 180);
  }

  function rich(text) {
    const value = String(text || "");
    const pieces = [];
    let last = 0;

    for (const match of value.matchAll(new RegExp(termPattern, "gi"))) {
      if (match.index > last) {
        pieces.push(value.slice(last, match.index));
      }

      const id = aliasMap.get(match[0].toLowerCase());

      pieces.push(
        <button
          type="button"
          className="term"
          key={`${match.index}:${id}`}
          aria-label={`${match[0]}: show meaning`}
          aria-describedby={tip?.id === id ? "word-tooltip" : undefined}
          onPointerEnter={event => {
            if (event.pointerType !== "touch") {
              showTerm(id, event.currentTarget);
            }
          }}
          onPointerLeave={scheduleHideTerm}
          onFocus={event => showTerm(id, event.currentTarget)}
          onBlur={scheduleHideTerm}
          onClick={event => {
            event.stopPropagation();
            showTerm(id, event.currentTarget, true);
          }}
        >
          {match[0]}
        </button>
      );

      last = match.index + match[0].length;
    }

    pieces.push(value.slice(last));
    return pieces;
  }

  const sceneChoices = node.kind === "choice"
    ? optionsFor(node.number, answers)
    : [];

  const selected = node.kind === "choice"
    ? answers[node.number - 1]
    : null;

  const decisionCount = story.slice(0, index + 1)
    .filter(item =>
      item.kind === "choice" && answers[item.number - 1]
    ).length;

  const visibleGlossary = GLOSSARY
    .filter(entry =>
      (wordMode === "all" || currentTerms.has(entry.id)) &&
      [
        entry.term,
        entry.zh,
        entry.meaning,
        ...entry.aliases,
      ].join(" ").toLowerCase().includes(wordSearch.toLowerCase())
    )
    .sort((a, b) => a.term.localeCompare(b.term));

  const modalTitles = {
    settings: "Reading room",
    words: "Word help",
    brief: "The delegation brief",
    log: "Your conference record",
    history: "What happened next?",
    worksheet: "My reflection worksheet",
    help: "How to play",
    credits: "Photograph credits",
  };

  return (
    <main
      id="game"
      ref={gameRef}
      aria-label="China at the Peace Table"
      style={{ "--dialog-size": `${preferences.size}px` }}
      onClick={event => {
        if (
          !event.target.closest(".term") &&
          !event.target.closest("#word-tooltip")
        ) {
          setTip(null);
        }
      }}
      onScrollCapture={event => {
        if (!event.target.closest?.("#word-tooltip")) {
          setTip(null);
        }
      }}
    >
      <div id="backdrops" aria-hidden="true">
        {Object.entries(BACKDROPS).map(([name, svg]) => (
          <div
            key={name}
            className={
              "backdrop " +
              ((playing ? node.bg : "study") === name ? "current" : "")
            }
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ))}
      </div>

      <div id="vignette" aria-hidden="true" />

      <header>
        <button
          className="brand"
          aria-label="Return to game title"
          onClick={() => {
            setAutomatic(false);
            setPlaying(false);
            setModal(null);
          }}
        >
          <span className="brand-symbol"><span>✦</span></span>

          <span className="brand-title">
            China at the Peace Table
            <small>Through the eyes of Wellington Koo</small>
          </span>
        </button>

        <div className="top-actions">
          <Link className="archive-link" to="/exercises">
            Website ↗
          </Link>

          <button
            className="icon-button"
            aria-pressed={music.enabled}
            onClick={music.toggle}
          >
            Sound {music.enabled ? "on" : "off"}
          </button>

          <button
            className="icon-button"
            id="fullscreen-button"
            aria-label="Toggle fullscreen"
            onClick={fullscreen}
          >
            ⛶
          </button>

          <button
            className="icon-button"
            onClick={() => openModal("settings")}
          >
            Settings
          </button>
        </div>
      </header>

      {!playing && (
        <section id="title" aria-label="Title screen">
          <div className="title-copy">
            <div className="eyebrow">Paris · January–June 1919</div>

            <h1>China at<br />the <em>Peace Table.</em></h1>

            <p className="title-description">
              A claim to justice. A room full of interests.
              <br />
              Defend China’s rights—and explain what your choices achieved.
            </p>

            <div className="button-row">
              <button className="primary" onClick={startNew}>
                Enter the conference →
              </button>

              {readSave(AUTO_KEY) && (
                <button
                  className="secondary"
                  onClick={() => load(AUTO_KEY)}
                >
                  Continue
                </button>
              )}
            </div>

            <p className="title-foot">
              THREE ACTS · FOUR DECISIONS · NO SIGN-IN REQUIRED
              <br />
              Hover, focus or tap underlined words for help.
              <br />
              Dramatised dialogue—not verbatim historical quotations.
            </p>
          </div>

          <figure className="title-portrait">
            <span className="title-number">1919.</span>
            <Portrait id="koo" />

            <figcaption>
              <span className="eyebrow">The Chinese delegation</span>
              <strong>Wellington Koo</strong>
              <span className="eyebrow">China must be heard.</span>
            </figcaption>
          </figure>

          <div className="title-bottom">
            <span>The Shandong Question</span>
            <span>Principle · Pressure · Choice</span>
          </div>
        </section>
      )}

      {playing && (
        <>
          <div id="hud">
            <div>
              <div className="eyebrow">{ACTS[node.act]}</div>
              <div id="location">
                {node.date ? `${node.date} · ` : ""}
                {DEFAULT_LOCATIONS[node.bg]}
              </div>
            </div>

            <div className="decision-pill">
              Decisions <span id="decision-count">{decisionCount} / 4</span>
            </div>
          </div>

          <div id="actors" aria-hidden="true">
            {Object.keys(PEOPLE).map(id => (
              <StableActor
                key={id}
                id={id}
                node={node}
                caption={PEOPLE[id].caption}
              >
                <Portrait id={id} />
              </StableActor>
            ))}
          </div>

          {node.bg === "memory" && (
            <div id="memory-title" aria-hidden="true">
              <strong>140,000</strong>
              <span className="eyebrow">
                Labourers. Lives. A claim to be heard.
              </span>
            </div>
          )}

          {node.quote && (
            <div id="scene-quote" aria-hidden="true">{node.quote}</div>
          )}

          {!node.kind && (
            <section
              id="dialogue"
              className={PEOPLE[node.who] ? "" : "narration"}
              aria-label="Current dialogue"
              onClick={next}
            >
              <h2 id="speaker">{node.speaker}</h2>

              <p id="dialogue-text" aria-hidden={!line.done}>
                {line.done ? rich(node.text) : line.visible}
              </p>

              <p className="sr-only" aria-live="polite" aria-atomic="true">
                {node.speaker}. {node.text}
              </p>

              <div className="dialogue-footer">
                <span id="counter">
                  {line.done
                    ? "Underlined words: hover or tap · Words: G"
                    : "Click to reveal · Words: G"}
                </span>

                <button
                  id="advance"
                  ref={advanceRef}
                  onClick={event => {
                    event.stopPropagation();
                    next();
                  }}
                >
                  {line.done ? "Continue" : "Reveal line"} <span>▸</span>
                </button>
              </div>
            </section>
          )}

          {node.kind === "note" && (
            <section className="overlay-panel" id="note-overlay">
              <article className="paper-note">
                <div className="eyebrow">
                  Confidential · Chinese delegation
                </div>

                <h2>This is not your time.</h2>
                <p><strong>Paris · 18 January 1919</strong></p>

                {BRIEF_PARAGRAPHS.map(text => (
                  <p key={text}>{rich(text)}</p>
                ))}

                <p>
                  <small>
                    This is a historical simulation. Its conversations
                    and alternative decisions are dramatised.
                  </small>
                </p>

                <hr className="paper-rule" />

                <div className="note-bottom">
                  <span className="seal">CHINESE<br />DELEGATION<br />1919</span>

                  <button
                    ref={advanceRef}
                    className="primary"
                    onClick={next}
                  >
                    Take up the brief →
                  </button>
                </div>
              </article>
            </section>
          )}

          {node.kind === "choice" && (
            <section
              className="overlay-panel"
              id="choices-overlay"
              aria-labelledby="choice-title"
            >
              <div className="choices-content">
                <div className="eyebrow">
                  Decision {node.number} · {DECISION_NAMES[node.number - 1]}
                </div>

                <h2 id="choice-title" ref={headingRef} tabIndex={-1}>
                  {node.title}
                </h2>

                <p>{rich(node.context)}</p>

                {sceneChoices.map((option, position) => (
                  <article
                    key={option.id}
                    className={[
                      "choice",
                      option.locked ? "locked" : "",
                      selected === option.id ? "selected" : "",
                    ].join(" ")}
                  >
                    <span className="choice-emblem" aria-hidden="true">
                      <DecisionIcon
                        name={iconForDecision(
                          node.number,
                          option.id,
                          answers
                        )}
                      />

                      <small>
                        {selected === option.id ? "✓" : `0${position + 1}`}
                      </small>
                    </span>

                    <div className="choice-copy">
                      <h3>{rich(option.label)}</h3>
                      <p className="option-text">{rich(option.text)}</p>

                      {option.locked && (
                        <p className="lock-reason">{option.reason}</p>
                      )}
                    </div>

                    <button
                      className="secondary choose-button"
                      disabled={Boolean(option.locked || selected)}
                      aria-label={
                        option.locked
                          ? option.reason
                          : `Choose option ${position + 1}: ${option.label}`
                      }
                      onClick={() => choose(position)}
                    >
                      {selected === option.id
                        ? "Chosen"
                        : option.locked
                          ? "Unavailable"
                          : `Choose ${position + 1} →`}
                    </button>
                  </article>
                ))}

                <p className="choice-note">
                  Word help never selects an answer. Use a Choose button
                  or keys 1, 2 and 3.
                </p>

                {selected && (
                  <div className="button-row">
                    <button className="primary" onClick={next}>
                      Continue this route →
                    </button>

                    <button className="secondary" onClick={revise}>
                      Revise this decision
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {node.kind === "end" && ending && (
            <section
              className="overlay-panel"
              id="ending"
              aria-labelledby="end-title"
            >
              <div className="ending-content">
                <div className="end-symbol">— ✦ —</div>
                <div className="eyebrow">Paris · 28 June 1919</div>

                <h2 id="end-title" ref={headingRef} tabIndex={-1}>
                  {ending.title}
                </h2>

                <p className="route-code">ROUTE {routeCode(answers)}</p>
                <p>{rich(ending.narrative)}</p>

                <div className="closing-report">
                  <h3>Conference closing report</h3>
                  <ul>
                    {ending.facts.map(fact => (
                      <li key={fact}>{rich(fact)}</li>
                    ))}
                  </ul>
                </div>

                <p className="smallprint">
                  How would you explain your decision to the people at home?
                </p>

                <div className="button-row">
                  <button
                    className="primary"
                    onClick={() => openModal("worksheet")}
                  >
                    My reflection worksheet
                  </button>

                  <button
                    className="secondary"
                    onClick={() => openModal("history")}
                  >
                    What happened next?
                  </button>

                  <button className="secondary" onClick={startNew}>
                    Play again
                  </button>
                </div>

                <p className="smallprint">{ending.disclaimer}</p>
              </div>
            </section>
          )}

          <nav id="toolbar" aria-label="Game controls">
            <div className="toolbar-group">
              <button className="dialogue-step" onClick={back}>
                ▲ Back
              </button>

              <button className="dialogue-step" onClick={next}>
                ▼ Next
              </button>

              <button id="words-button" onClick={() => openModal("words")}>
                Words ({currentTerms.size})
              </button>

              <button onClick={() => openModal("brief")}>Brief</button>
              <button onClick={() => openModal("log")}>Log</button>

              <button
                className={automatic ? "on" : ""}
                aria-pressed={automatic}
                onClick={() => setAutomatic(value => !value)}
              >
                Auto: {automatic ? "on" : "off"}
              </button>

              <button onClick={saveManual}>Save</button>
              <button onClick={() => load(MANUAL_KEY)}>Load</button>
              <button onClick={() => openModal("help")}>Help</button>
            </div>

            <span className="key-hint">
              SPACE: continue · 1 / 2 / 3: choose
            </span>
          </nav>
        </>
      )}

      <div id="progress" aria-hidden="true">
        <span
          style={{
            width: !playing
              ? "0%"
              : node.kind === "end"
                ? "100%"
                : `${Math.min(97, (index / 30) * 100)}%`,
          }}
        />
      </div>

      <div
        id="toast"
        className={toast ? "show" : ""}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>

      <div id="frame" aria-hidden="true" />
      <div id="grain" aria-hidden="true" />

      {tip && glossaryById[tip.id] && (
        <div
          id="word-tooltip"
          role="tooltip"
          style={{
            width: tip.width,
            maxHeight: tip.maxHeight,
            left: tip.left,
            top: tip.top,
          }}
          onPointerEnter={() => clearTimeout(tooltipTimer.current)}
          onPointerLeave={scheduleHideTerm}
        >
          <strong>{glossaryById[tip.id].term}</strong>
          <span className="tip-zh" lang="zh-Hant">
            {glossaryById[tip.id].zh}
          </span>
          <p>{glossaryById[tip.id].meaning}</p>
          <small>Tap elsewhere or press Escape to close.</small>
        </div>
      )}

      {modal && (
        <Modal
          title={modalTitles[modal]}
          onClose={() => setModal(null)}
        >
          {modal === "settings" && (
            <>
              <div className="settings-row">
                <label>
                  Typewriter delay: {preferences.speed} ms
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={preferences.speed}
                    onChange={event => setPreferences(value => ({
                      ...value,
                      speed: Number(event.target.value),
                    }))}
                  />
                </label>
                <p className="smallprint">0 means instant text.</p>
              </div>

              <div className="settings-row">
                <label>
                  Dialogue size: {preferences.size} px
                  <input
                    type="range"
                    min="19"
                    max="29"
                    value={preferences.size}
                    onChange={event => setPreferences(value => ({
                      ...value,
                      size: Number(event.target.value),
                    }))}
                  />
                </label>
              </div>

              <div className="button-row">
                <button className="secondary" onClick={music.toggle}>
                  Sound {music.enabled ? "off" : "on"}
                </button>

                <button
                  className="secondary"
                  onClick={() => setModal("credits")}
                >
                  Photograph credits
                </button>

                <button
                  className="secondary"
                  onClick={() => setModal("help")}
                >
                  Controls
                </button>
              </div>

              <p className="smallprint">
                Progress is stored only in this browser. It is not
                linked to a Google account or uploaded to the school.
                On a shared browser, the next player may see its saved route.
              </p>
            </>
          )}

          {modal === "words" && (
            <>
              <div className="glossary-tabs">
                <button
                  className="secondary"
                  aria-pressed={wordMode === "current"}
                  onClick={() => setWordMode("current")}
                >
                  This scene
                </button>

                <button
                  className="secondary"
                  aria-pressed={wordMode === "all"}
                  onClick={() => setWordMode("all")}
                >
                  All words
                </button>
              </div>

              <input
                type="search"
                className="glossary-search"
                aria-label="Search vocabulary"
                placeholder="Search a word or meaning…"
                value={wordSearch}
                onChange={event => setWordSearch(event.target.value)}
              />

              {visibleGlossary.length === 0 && (
                <p>No matching words. Try All words or another search.</p>
              )}

              {visibleGlossary.map(entry => (
                <article className="glossary-entry" key={entry.id}>
                  <h3>
                    {entry.term}
                    <span className="glossary-zh" lang="zh-Hant">
                      {entry.zh}
                    </span>
                  </h3>
                  <p>{entry.meaning}</p>
                </article>
              ))}
            </>
          )}

          {modal === "brief" && (
            <>
              <p className="smallprint">
                These are teaching summaries of the countries’ concerns,
                not quoted primary-source documents.
              </p>

              {BRIEF_CARDS.map(card => (
                <article className="dossier-card" key={card.title}>
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                </article>
              ))}
            </>
          )}

          {modal === "log" && (
            <>
              {story.slice(0, index + 1).map(item => {
                if (item.kind === "choice") {
                  const answer = answers[item.number - 1];

                  return (
                    <article className="log-entry" key={item.id}>
                      <h3>Decision {item.number}</h3>
                      <p>
                        {answer
                          ? optionFor(item.number, answer, answers).label
                          : "Awaiting your decision."}
                      </p>
                    </article>
                  );
                }

                if (!item.text) return null;

                return (
                  <article className="log-entry" key={item.id}>
                    <h3>{item.speaker}</h3>
                    <p>{item.text}</p>
                  </article>
                );
              })}
            </>
          )}

          {modal === "history" && (
            <>
              <h3>1919: protest and refusal</h3>
              <p>
                Protests began in Beijing on 4 May, before the Chinese
                delegation refused to sign on 28 June. The protests
                increased pressure on the delegation.
              </p>

              <h3>1922: further negotiation</h3>
              <p>{HISTORICAL_SUMMARY}</p>

              <p>
                The later agreement required further negotiation.
                It was not an automatic consequence of a speech,
                a protest, or withholding a signature.
              </p>

              <h3>Compare with your route</h3>
              <p>
                Which actions match the historical sequence?
                Which are alternatives explored by this simulation?
                Which outcomes still depended on another government?
              </p>
            </>
          )}

          {modal === "worksheet" && completed && (
            <>
              <p>
                Page one contains your decision table, short ending
                and historical reference. Page two contains the three
                reflection questions.
              </p>

              <div className="button-row">
                <button
                  className="primary"
                  onClick={() => {
                    if (!openPrintableWorksheet(answers)) {
                      setToast(
                        "The browser blocked the new tab. Allow pop-ups " +
                        "for this site, or download the worksheet HTML."
                      );
                    }
                  }}
                >
                  Open printable worksheet
                </button>

                <button
                  className="secondary"
                  onClick={() => downloadWorksheet(answers)}
                >
                  Download worksheet HTML
                </button>
              </div>

              <p className="smallprint">
                In the new tab, select Print / save as PDF.
                Use A4 portrait and 100% scale. Turn off browser
                headers and footers where that option is available.
                Check that the preview contains two pages.
              </p>

              <div className="reflection-preview">
                <h3>{ending.title}</h3>
                <p>Route: {routeCode(answers)}</p>
                <ul>
                  {ending.facts.map(fact => <li key={fact}>{fact}</li>)}
                </ul>
              </div>
            </>
          )}

          {modal === "help" && (
            <>
              <h3>Read and decide</h3>
              <p>
                Click dialogue or press Space to reveal a line, then
                continue. Use a Choose button or keys 1–3 for decisions.
                Scroll down to reveal or continue; scroll up to go back.
              </p>

              <p>
                On iPad, you can also swipe up or down on the dialogue
                area to continue or go back. Long dialogue, decision
                lists and other panels scroll normally. Tapping an
                underlined word only opens its meaning.
              </p>

              <h3>Vocabulary</h3>
              <p>
                Hover over, focus or tap an underlined word.
                Word help never chooses an answer. Escape closes the
                meaning. Opening word help pauses automatic reading.
              </p>

              <h3>Review and revise</h3>
              <p>
                Back reviews earlier scenes without changing your
                answers. At a recorded decision, Revise replaces that
                decision and all later ones.
              </p>

              <h3>Keyboard</h3>
              <p>
                Space / Enter / →: continue · ←: back<br />
                1–3: choose · G: words · H: log · B: brief<br />
                A: auto · S: save · L: load · M: sound · F: fullscreen
              </p>

              <h3>Saving and privacy</h3>
              <p>
                Automatic progress and the manual Save/Load slot are
                separate. Both belong to this browser, not to a user
                account. No student name or email is required.
              </p>

              <h3>Historical interpretation</h3>
              <p>
                Dialogue is dramatised. A sympathetic response is not
                a commitment; an offer is not an agreement; refusal
                does not automatically recover territory or rights.
              </p>
            </>
          )}

          {modal === "credits" && (
            <>
              {Object.entries(PEOPLE).map(([id, person]) => (
                <article className="log-entry" key={id}>
                  <h3>{person.name}</h3>
                  <p>{person.credit}</p>

                  <a
                    href={
                      "https://commons.wikimedia.org/wiki/File:" +
                      encodeURIComponent(person.file)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Photograph and rights information ↗
                  </a>
                </article>
              ))}

              <p className="smallprint">
                Scenery is copied from your original SVG artwork.
                Decision icons are inline SVG drawings.
                Portraits currently load from Wikimedia.
              </p>
            </>
          )}
        </Modal>
      )}
    </main>
  );
}

export default function PeaceTableGame() {
  const hostRef = useRef(null);
  const [shadowRoot, setShadowRoot] = useState(null);

  useLayoutEffect(() => {
    const host = hostRef.current;

    const root = host.shadowRoot ||
      host.attachShadow({ mode: "open" });

    setShadowRoot(root);
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Wellington Koo — China at the Peace Table";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      style={{
        display: "block",
        width: "100%",
        minHeight: "100dvh",
        background: "#090b09",
      }}
    >
      {shadowRoot && createPortal(
        <>
          <style>
            {GAME_CSS + EXTRA_CSS + IPAD_AND_ANIMATION_CSS}
          </style>
          <GameView />
        </>,
        shadowRoot
      )}
    </div>
  );
}