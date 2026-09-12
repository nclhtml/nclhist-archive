import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './main.jsx'; // Adjust path if needed
import { ArrowLeft } from 'lucide-react';

export default function LotteryMachine() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const realUser = user;
  const iframeRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [classesData, setClassesData] = useState([]);

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        // 1. Fetch authorized classes from settings (matching Record.jsx logic)
        const classDocRef = doc(db, "settings", "classes");
        const classDocSnap = await getDoc(classDocRef);

        let visibleClassNames = [];
        if (classDocSnap.exists()) {
          const rawList = classDocSnap.data().list || [];
          const classObjects = rawList.map(c => typeof c === 'string' ? { name: c, owner: 'clng@ktls.edu.hk', isArchived: false } : c);

          let visibleClasses = classObjects;
          if (realUser?.email !== 'clng@ktls.edu.hk') {
            visibleClasses = classObjects.filter(c => c.owner === realUser?.email);
          }

          // Filter out archived and extract just the names (KEEP zero-width spaces so they match the student database)
          visibleClassNames = visibleClasses.filter(c => !c.isArchived).map(c => c.name);
        }

        // 2. Fetch all students
        const studentsSnap = await getDocs(collection(db, "students"));
        const studentsData = studentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 3. Group students by authorized classes
        const groups = {};

        // Pre-fill groups with all visible classes so they appear even if they have 0 students
        visibleClassNames.forEach(className => {
          groups[className] = {
            // Use the exact className as ID to ensure uniqueness even with zero-width spaces
            id: className,
            name: className.replace(/\u200B/g, ''),
            students: []
          };
        });

        studentsData.forEach(student => {
          const className = student.className;

          // Only include students whose class is in the list AND who are not deleted
          if (className && groups[className] && !student.isDeleted) {
            let parsedNum = parseInt(student.classNumber);
            let finalNum = isNaN(parsedNum) ? groups[className].students.length + 1 : parsedNum;

            // Prevent duplicate numbers in the same class to avoid the 3D machine crashing
            while (groups[className].students.some(s => s.number === finalNum)) {
              finalNum++;
            }

            groups[className].students.push({
              id: student.id,
              number: finalNum,
              name: student.englishName || student.name || "Unknown Student"
            });
          }
        });

        const formattedClasses = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
        setClassesData(formattedClasses);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching classes:", error);
        setLoading(false);
      }
    };

    if (realUser) {
      fetchClasses();
    }
  }, [realUser]);

  // We now send the data using the iframe's onLoad event below
  // to ensure the iframe is fully ready to receive the classes.

  // We use a template literal for the HTML. Backticks and $ are escaped so they don't break React.
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#08111f">
  <title>Classroom Lucky Draw · 攪珠機</title>

  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont,
        "Segoe UI", sans-serif;
      color: #edf5ff;
      background: #08111f;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(ellipse at 20% 10%, #193b57, transparent 55%),
        radial-gradient(ellipse at 90% 90%, #162b48, transparent 50%),
        #08111f;
    }

    button, select, input { font: inherit; }
    button, select, input[type="checkbox"] { cursor: pointer; }
    button:disabled, select:disabled { cursor: not-allowed; opacity: .45; }

    button:focus-visible, select:focus-visible, input:focus-visible,
    summary:focus-visible {
      outline: 3px solid #8ee8ff;
      outline-offset: 4px;
    }

    [hidden] { display: none !important; }

    .app {
      max-width: 1320px;
      margin: auto;
      padding: 26px;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 22px;
    }

    .eyebrow {
      color: #81e5ce;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .22em;
      text-transform: uppercase;
    }

    h1 {
      margin: 7px 0 0;
      font-size: clamp(25px, 4vw, 38px);
      letter-spacing: -.04em;
    }

    h1 span {
      color: #9bb1c8;
      font-size: .6em;
      font-weight: 400;
    }

    .badge {
      padding: 9px 14px;
      border: 1px solid #ffffff1c;
      border-radius: 30px;
      color: #aac0d5;
      font-size: 12px;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 20px;
      align-items: stretch;
    }

    .panel {
      background: #0b182bd9;
      border: 1px solid #ffffff15;
      border-radius: 24px;
      overflow: hidden;
      box-shadow: 0 24px 65px #00000025;
    }

    .machine-panel {
      min-height: 720px;
      position: relative;
      background:
        radial-gradient(ellipse at 50% 40%, #29516f66, transparent 65%),
        #091525;
    }

    #stage { position: absolute; inset: 0; }

    #stage canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .scene-top {
      position: absolute;
      top: 21px;
      left: 22px;
      right: 22px;
      display: flex;
      justify-content: space-between;
      gap: 15px;
      color: #acc5da;
      font-size: 12px;
      pointer-events: none;
    }

    .dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      margin-right: 7px;
      background: #75ebcb;
      border-radius: 50%;
      box-shadow: 0 0 12px #75ebcb;
    }

    .scene-bottom {
      position: absolute;
      left: 18px;
      right: 18px;
      bottom: 20px;
      color: #8da8c0;
      text-align: center;
      font-size: 12px;
      pointer-events: none;
    }

    .controls { padding: 24px; }

    .field-label, .result-label {
      display: block;
      color: #a0b8cd;
      font-size: 11px;
      font-weight: 750;
      letter-spacing: .14em;
      text-transform: uppercase;
      margin-bottom: 10px;
    }

    select {
      width: 100%;
      padding: 12px;
      border: 1px solid #ffffff24;
      border-radius: 11px;
      color: #eaf4ff;
      background: #14263a;
    }

    .class-meta {
      margin: 9px 0 22px;
      color: #7793ad;
      font-size: 12px;
    }

    .result-label { text-align: center; }

    .result-ball {
      --ball-color: #294963;
      display: grid;
      place-items: center;
      width: 132px;
      height: 132px;
      margin: 15px auto;
      border-radius: 50%;
      background:
        radial-gradient(circle at 30% 22%, #ffffff60, transparent 42%),
        var(--ball-color);
      box-shadow: inset -12px -17px 25px #0004, 0 12px 35px #0004;
      border: 1px solid #ffffff35;
    }

    #result-number {
      display: grid;
      place-items: center;
      width: 83px;
      height: 83px;
      border-radius: 50%;
      background: #f7fbff;
      color: #122139;
      font-size: 43px;
      font-weight: 850;
      font-variant-numeric: tabular-nums;
    }

    #student-name {
      margin: 0;
      min-height: 34px;
      text-align: center;
      font-size: 25px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    #result-class {
      margin: 6px 0 0;
      color: #7edbc9;
      text-align: center;
      font-size: 12px;
    }

    #status {
      min-height: 43px;
      margin: 15px 0;
      text-align: center;
      color: #9fb7cc;
      font-size: 13px;
      line-height: 1.6;
    }

    .progress {
      height: 4px;
      background: #ffffff0d;
      overflow: hidden;
      border-radius: 10px;
      margin-bottom: 18px;
    }

    #progress-fill {
      width: 0;
      height: 100%;
      background: linear-gradient(90deg, #5dcaff, #8bf0cd);
    }

    .option {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 13px;
      color: #c3d5e5;
      line-height: 1.5;
    }

    .option input {
      width: 17px;
      height: 17px;
      margin: 2px 0 0;
      accent-color: #7ce5cc;
      flex-shrink: 0;
    }

    .option small {
      display: block;
      color: #7995ad;
      font-size: 11px;
    }

    button {
      min-height: 46px;
      border-radius: 11px;
      border: 0;
      font-weight: 750;
      transition: transform .15s;
    }

    button:hover:not(:disabled) { transform: translateY(-1px); }

    #draw {
      width: 100%;
      margin-top: 18px;
      color: #082f32;
      background: linear-gradient(120deg, #92efd0, #6bd5f2);
    }

    #reset {
      width: 100%;
      margin-top: 9px;
      color: #b3c8dc;
      border: 1px solid #ffffff16;
      background: #ffffff08;
    }

    .music-box {
      border-top: 1px solid #ffffff12;
      border-bottom: 1px solid #ffffff12;
      margin-top: 22px;
      padding: 18px 0;
    }

    .music-heading {
      color: #a0b8cd;
      font-size: 11px;
      letter-spacing: .14em;
      font-weight: 750;
      margin-bottom: 12px;
    }

    .music-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    #choose-music {
      min-height: 35px;
      padding: 6px 11px;
      background: #20354d;
      color: #dbecfa;
      font-size: 12px;
    }

    #music-status {
      margin: 10px 0 0;
      color: #7e9ab3;
      font-size: 11px;
      line-height: 1.6;
      overflow-wrap: anywhere;
    }

    .history-heading {
      display: flex;
      justify-content: space-between;
      color: #9eb6cc;
      font-size: 11px;
      letter-spacing: .08em;
      margin: 21px 0 12px;
    }

    #history {
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      gap: 7px;
      max-height: 165px;
      overflow: auto;
    }

    .history-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 9px 5px 5px;
      background: #ffffff07;
      border: 1px solid #ffffff10;
      border-radius: 30px;
      font-size: 11px;
    }

    .history-number {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      color: white;
      font-weight: 800;
    }

    .empty, .note {
      color: #758fa7;
      font-size: 11px;
      line-height: 1.7;
    }

    .note { margin: 18px 0 0; }

    .roster-panel { margin-top: 20px; padding: 20px 24px; }

    summary {
      cursor: pointer;
      color: #c4d8e9;
      font-size: 14px;
      font-weight: 700;
    }

    .table-wrap { max-height: 310px; overflow: auto; margin-top: 16px; }

    table { width: 100%; border-collapse: collapse; font-size: 13px; }

    th, td {
      padding: 11px 12px;
      text-align: left;
      border-bottom: 1px solid #ffffff0c;
    }

    th { color: #8da9c1; font-weight: 600; }
    td { color: #d4e3ef; }
    .picked { color: #82e6c9; }

    #error {
      position: absolute;
      inset: 32% 20px auto;
      padding: 22px;
      border-radius: 14px;
      background: #152338f5;
      color: #ffc0c0;
      line-height: 1.7;
      text-align: center;
    }

    .reveal { animation: reveal .5s ease-out; }

    @keyframes reveal {
      from { transform: scale(.78); }
      65% { transform: scale(1.08); }
      to { transform: scale(1); }
    }

    @media (max-width: 850px) {
      .layout { grid-template-columns: 1fr; }
      .machine-panel { min-height: 490px; }
      .app { padding: 16px; }
      .badge { display: none; }
    }

    @media (max-width: 440px) {
      .app { padding: 10px; }
      .machine-panel { min-height: 420px; }
      .controls { padding: 21px; }
      .scene-top { left: 14px; right: 14px; font-size: 10px; }
      h1 span { display: block; margin-top: 5px; }
      .roster-panel { padding: 18px 12px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
</head>

<body>
  <main class="app">
    <header>
      <div>
        <div class="eyebrow">A little suspense for your classroom</div>
        <h1>Classroom Lucky Draw <span lang="zh-Hant">課堂攪珠機</span></h1>
      </div>
      <div class="badge">One student · One ball · No repeats</div>
    </header>

    <div class="layout">
      <section class="panel machine-panel" aria-label="3D lottery machine">
        <div id="stage" role="img"
             aria-label="A transparent sphere containing numbered student balls">
        </div>

        <div class="scene-top">
          <span><span class="dot"></span><span id="scene-class">LOADING</span></span>
          <span id="remaining">— BALLS REMAINING</span>
        </div>

        <div class="scene-bottom" id="scene-caption">
          Every ball represents one student.
        </div>

        <div id="error" role="alert" hidden></div>
      </section>

      <aside class="panel controls">
        <label class="field-label" for="class-select">Select your class</label>
        <select id="class-select" disabled>
          <option>Loading classes…</option>
        </select>

        <p class="class-meta" id="class-meta">Loading placeholder student lists…</p>

        <div class="result-label">Selected student</div>

        <div id="result-ball" class="result-ball">
          <span id="result-number">—</span>
        </div>

        <h2 id="student-name">Who will it be?</h2>
        <p id="result-class">Ready for your class</p>

        <p id="status" role="status" aria-live="polite" aria-atomic="true">
          Loading the machine…
        </p>

        <div class="progress" aria-hidden="true">
          <div id="progress-fill"></div>
        </div>

 <label class="option">
          <input id="long-mix" type="checkbox">
          <span>
            Longer mixing animation
            <small>Checked: 10 seconds · Unchecked: 3 seconds</small>
          </span>
        </label>

        <button id="draw" disabled>Draw Student</button>
        <button id="reset" disabled>Reset This Class</button>
        <button id="reset-all" disabled style="margin-top: 9px; background: #3a1c1c; color: #ffb3b3; border: 1px solid #ff000030;">Reset All Classes</button>

        <section class="music-box" aria-label="Background music settings">
          <div class="music-heading">BACKGROUND MUSIC</div>

          <div class="music-row">
            <button id="choose-music" type="button">Change music</button>

            <label class="option">
              <input id="mute-bgm" type="checkbox" checked>
              <span>Mute BGM</span>
            </label>
          </div>

          <input id="music-file" type="file" accept="audio/*" hidden>

          <p id="music-status" role="status">
            Loading default music...
          </p>
        </section>

        <div class="history-heading">
          <span>THIS CLASS’S DRAW HISTORY</span>
          <span id="draw-count">0 / 0</span>
        </div>

        <div id="history">
          <span class="empty">No students drawn yet.</span>
        </div>

        <p class="note">
          Each class keeps its own draw history while this page is open.
          Refreshing the page clears all draws.
        </p>
      </aside>
    </div>

    <details class="panel roster-panel">
      <summary>View the selected class’s student list</summary>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Ball number</th>
              <th scope="col">Student</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody id="roster"></tbody>
        </table>
      </div>
    </details>
  </main>

  <audio id="bgm" loop preload="none"></audio>

  <script type="module">
    const $ = selector => document.querySelector(selector);

    const ui = {
      stage: $("#stage"),
      classSelect: $("#class-select"),
      classMeta: $("#class-meta"),
      sceneClass: $("#scene-class"),
      caption: $("#scene-caption"),
      remaining: $("#remaining"),
      resultBall: $("#result-ball"),
      number: $("#result-number"),
      studentName: $("#student-name"),
      resultClass: $("#result-class"),
      status: $("#status"),
      progress: $("#progress-fill"),
      longMix: $("#long-mix"),
      draw: $("#draw"),
      reset: $("#reset"),
      history: $("#history"),
      count: $("#draw-count"),
      roster: $("#roster"),
      error: $("#error"),
      bgm: $("#bgm"),
      chooseMusic: $("#choose-music"),
      musicFile: $("#music-file"),
      mute: $("#mute-bgm"),
      musicStatus: $("#music-status")
    };

// ---------------- Background music ----------------

    // Default background music (Royalty-free placeholder)
let musicURL = "https://www.dropbox.com/scl/fi/veeev5flbx07ihaa8paw5/.m4a?rlkey=1ly73nz89oflq4j2cz2ctbe1q&st=6w6chhct&raw=1";
    let musicName = "Default BGM";
    let musicRequest = 0;

    ui.bgm.volume = 0.08;
    ui.bgm.src = musicURL;
    ui.bgm.load();
    ui.musicStatus.textContent = \`Ready, but muted · \${musicName}\`;

    async function playMusic() {
      if (!musicURL) {
        ui.musicStatus.textContent =
          "Music placeholder: choose an audio file when you are ready.";
        return;
      }

      if (ui.mute.checked) {
        ui.musicStatus.textContent = \`Muted · \${musicName}\`;
        return;
      }

      const request = ++musicRequest;
      ui.bgm.muted = false;

      try {
        await ui.bgm.play();

        if (request === musicRequest && !ui.mute.checked) {
          ui.musicStatus.textContent = \`Playing · \${musicName}\`;
        }
      } catch (error) {
        if (request !== musicRequest) return;

        ui.musicStatus.textContent =
          "Music could not start. Try another audio file, or click Draw Student.";
      }
    }

    ui.chooseMusic.addEventListener("click", () => {
      ui.musicFile.click();
    });

    ui.musicFile.addEventListener("change", () => {
      const file = ui.musicFile.files?.[0];
      if (!file) return;

      musicRequest++;
      ui.bgm.pause();

      if (musicURL) URL.revokeObjectURL(musicURL);

      musicURL = URL.createObjectURL(file);
      musicName = file.name;
      ui.bgm.src = musicURL;
      ui.bgm.load();

      if (ui.mute.checked) {
        ui.musicStatus.textContent = \`Ready, but muted · \${musicName}\`;
      } else {
        void playMusic();
      }

      ui.musicFile.value = "";
    });

    ui.mute.addEventListener("change", () => {
      musicRequest++;
      ui.bgm.muted = ui.mute.checked;

      if (ui.mute.checked) {
        ui.bgm.pause();
        ui.musicStatus.textContent = musicURL
          ? \`Muted · \${musicName}\`
          : "BGM muted. No audio selected.";
      } else if (musicURL) {
        void playMusic();
      } else {
        ui.musicStatus.textContent =
          "Music placeholder: choose an audio file when you are ready.";
      }
    });

    ui.bgm.addEventListener("error", () => {
      if (musicURL) {
        ui.musicStatus.textContent =
          "This audio file could not be loaded. Please choose another file.";
      }
    });

    window.addEventListener("beforeunload", () => {
      if (musicURL) URL.revokeObjectURL(musicURL);
    });


// ---------------- Firebase Data Listener ----------------
    // This replaces the old loadClasses() dummy function
    window.addEventListener('message', async (event) => {
      if (event.data.type === 'LOAD_CLASSES') {
        const classes = event.data.payload;
        const targetClass = event.data.targetClass;
        if (!classes || classes.length === 0) {
          ui.status.textContent = "No classes found for your account.";
          ui.classSelect.innerHTML = "<option>No classes available</option>";
          return;
        }
        await startMachine(classes, targetClass);
      }
    });

    // ---------------- Three.js application ----------------
    async function startMachine(classes, targetClass) {
      try {
        const THREE = await import(
          "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js"
        );

        if (!Array.isArray(classes) || classes.length === 0) {
          throw new Error("No classes are available.");
        }

        const classIDs = new Set();

        for (const classroom of classes) {
          if (
            !classroom.id ||
            !classroom.name ||
            classIDs.has(classroom.id) ||
            !Array.isArray(classroom.students)
          ) {
            throw new Error("A class record is missing data or has a duplicate ID.");
          }

          classIDs.add(classroom.id);

          const ids = new Set();
          const numbers = new Set();

          for (const student of classroom.students) {
            if (
              !student.id ||
              typeof student.name !== "string" ||
              !student.name.trim() ||
              !Number.isInteger(student.number) ||
              student.number < 1 ||
              ids.has(student.id) ||
              numbers.has(student.number)
            ) {
              throw new Error(
                \`\${classroom.name} has invalid or duplicate student records.\`
              );
            }

            ids.add(student.id);
            numbers.add(student.number);
          }
        }

        const scene = new THREE.Scene();

        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true
        });

        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.25;
        ui.stage.appendChild(renderer.domElement);

        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

        scene.add(new THREE.HemisphereLight(0xd5efff, 0x22324a, 2.6));

        function addLight(color, intensity, x, y, z) {
          const light = new THREE.DirectionalLight(color, intensity);
          light.position.set(x, y, z);
          scene.add(light);
        }

        addLight(0xffffff, 3.2, -4, 7, 5);
        addLight(0x75cfff, 2.3, 5, 3, -4);
        addLight(0x86ffd5, 1.3, -4, 0, -2);

        const center = new THREE.Vector3(0, 0.8, 0);
        const ballRadius = 0.225;
        const palette = ["#ee526b", "#368fe8", "#20b78c"];

        const histories = new Map(classes.map(c => [c.id, []]));

        let currentClass = null;
        let machine = null;
        let radius = 2.3;
        let limit = 2;
        let balls = [];
        let available = [];
        let selected = null;

        let state = "idle";
        let phaseTime = 0;
        let mixDuration = 3;
        const extractDuration = 1.8;

        let simulationTime = 0;
        let accumulator = 0;
        let extractionCurve = null;

        let portWorld = new THREE.Vector3();
        let portNormal = new THREE.Vector3();
        let portOutside = new THREE.Vector3();
        let displayPosition = new THREE.Vector3();

        const normal = new THREE.Vector3();
        const delta = new THREE.Vector3();
        const randomBuffer = new Uint32Array(1);

        function classHistory() {
          return histories.get(currentClass.id);
        }

        function colorFor(student) {
          return palette[(student.number - 1) % palette.length];
        }

        function disposeMachine() {
          if (!machine) return;

          const geometries = new Set();
          const materials = new Set();
          const textures = new Set();

          machine.traverse(object => {
            if (object.geometry) geometries.add(object.geometry);

            if (object.material) {
              const list = Array.isArray(object.material)
                ? object.material
                : [object.material];

              for (const material of list) {
                materials.add(material);
                if (material.map) textures.add(material.map);
              }
            }
          });

          scene.remove(machine);
          geometries.forEach(item => item.dispose());
          materials.forEach(item => item.dispose());
          textures.forEach(item => item.dispose());
        }

        function buildMachine() {
          disposeMachine();

          machine = new THREE.Group();
          scene.add(machine);

          radius = Math.max(
            2.3,
            0.66 * Math.cbrt(Math.max(currentClass.students.length, 1))
          );

          limit = radius - ballRadius - 0.025;

          const metal = new THREE.MeshStandardMaterial({
            color: 0x29445d,
            metalness: 0.72,
            roughness: 0.28
          });

          const darkMetal = new THREE.MeshStandardMaterial({
            color: 0x102035,
            metalness: 0.55,
            roughness: 0.35
          });

          const trim = new THREE.MeshStandardMaterial({
            color: 0x8be8dc,
            emissive: 0x268f8b,
            emissiveIntensity: 0.7,
            metalness: 0.5,
            roughness: 0.25
          });

          function cylinder(top, bottom, height, y, material, z = 0) {
            const mesh = new THREE.Mesh(
              new THREE.CylinderGeometry(top, bottom, height, 64),
              material
            );

            mesh.position.set(0, y, z);
            machine.add(mesh);
            return mesh;
          }

          function ring(r, thickness, material, position, rotationX = 0) {
            const mesh = new THREE.Mesh(
              new THREE.TorusGeometry(r, thickness, 12, 100),
              material
            );

            mesh.position.copy(position);
            mesh.rotation.x = rotationX;
            machine.add(mesh);
            return mesh;
          }

          const bottom = center.y - radius;

          cylinder(radius * .85, radius * .94, .28, bottom - .4, darkMetal);
          cylinder(radius * .80, radius * .86, .18, bottom - .18, metal);
          cylinder(.7, 1.05, .3, bottom + .02, metal);

          ring(
            radius * .86, .025, trim,
            new THREE.Vector3(0, bottom - .26, 0),
            Math.PI / 2
          );

          const shellGeometry = new THREE.SphereGeometry(radius, 64, 40);

          const shell = new THREE.Mesh(
            shellGeometry,
            new THREE.MeshPhysicalMaterial({
              color: 0xc0e9ff,
              transparent: true,
              opacity: .10,
              metalness: .04,
              roughness: .12,
              clearcoat: 1,
              side: THREE.FrontSide,
              depthWrite: false
            })
          );

          shell.position.copy(center);
          shell.renderOrder = 5;
          machine.add(shell);

          const backShell = new THREE.Mesh(
            shellGeometry,
            new THREE.MeshBasicMaterial({
              color: 0x80cae4,
              transparent: true,
              opacity: .045,
              side: THREE.BackSide,
              depthWrite: false
            })
          );

          backShell.position.copy(center);
          machine.add(backShell);

          ring(radius + .012, .022, metal, center);

          const sideRing = ring(radius + .012, .018, metal, center);
          sideRing.rotation.y = Math.PI / 2;

          ring(
            radius + .015, .014,
            new THREE.MeshBasicMaterial({
              color: 0x83d6d5,
              transparent: true,
              opacity: .4
            }),
            center,
            Math.PI / 2
          );

          const portY = -radius * .37;
          const portLocal = new THREE.Vector3(
            0,
            portY,
            Math.sqrt(radius * radius - portY * portY)
          );

          portWorld = portLocal.clone().add(center);
          portNormal = portLocal.clone().normalize();
          portOutside = portWorld.clone().addScaledVector(portNormal, .45);

          displayPosition = new THREE.Vector3(
            0, bottom + .20, radius + .85
          );

          const port = ring(.30, .045, trim, portWorld);
          port.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 0, 1),
            portNormal
          );

          const chuteCurve = new THREE.CatmullRomCurve3([
            portWorld,
            portOutside,
            new THREE.Vector3(0, bottom + .85, radius + .64),
            displayPosition
          ]);

          const chute = new THREE.Mesh(
            new THREE.TubeGeometry(chuteCurve, 36, .31, 18, false),
            new THREE.MeshPhysicalMaterial({
              color: 0xb0e2ff,
              transparent: true,
              opacity: .12,
              roughness: .15,
              side: THREE.DoubleSide,
              depthWrite: false
            })
          );

          chute.renderOrder = 6;
          machine.add(chute);

          cylinder(.57, .68, .16, bottom - .29, metal, radius + .85);

          ring(
            .54, .035, trim,
            new THREE.Vector3(0, bottom - .20, radius + .85),
            Math.PI / 2
          );

          createBalls();
          resize();
        }

        function createNumberTexture(number) {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 128;
          const context = canvas.getContext("2d");

          context.fillStyle = "#f7fbff";
          context.beginPath();
          context.arc(64, 64, 59, 0, Math.PI * 2);
          context.fill();

          context.strokeStyle = "#d6e1ea";
          context.lineWidth = 3;
          context.stroke();

          const digits = String(number).length;
          const fontSize = digits <= 2 ? 64 : digits === 3 ? 48 : 36;

          context.fillStyle = "#12223a";
          context.font = \`800 \${fontSize}px Arial, sans-serif\`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(String(number), 64, 67, 105);

          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          return texture;
        }

        function randomPosition() {
          const position = new THREE.Vector3();

          do {
            position.set(
              (Math.random() * 2 - 1) * limit,
              (Math.random() * 2 - 1) * limit,
              (Math.random() * 2 - 1) * limit
            );
          } while (position.lengthSq() > limit * limit);

          return position;
        }

        function createBalls() {
          balls = [];
          available = [];
          selected = null;

          const history = classHistory();
          const drawnIDs = new Set(history.map(student => student.id));
          const latest = history[history.length - 1];

          const geometry = new THREE.SphereGeometry(ballRadius, 24, 16);
          const labelGeometry = new THREE.PlaneGeometry(
            ballRadius * 1.46, ballRadius * 1.46
          );

          const materials = palette.map(color =>
            new THREE.MeshStandardMaterial({
              color,
              roughness: .25,
              metalness: .10
            })
          );

          for (const student of currentClass.students) {
            const mesh = new THREE.Group();

            mesh.add(new THREE.Mesh(
              geometry,
              materials[(student.number - 1) % materials.length]
            ));

            const label = new THREE.Mesh(
              labelGeometry,
              new THREE.MeshBasicMaterial({
                map: createNumberTexture(student.number),
                transparent: true,
                alphaTest: .15,
                toneMapped: false
              })
            );

            label.position.z = ballRadius + .006;
            mesh.add(label);
            machine.add(mesh);

            const ball = {
              student,
              mesh,
              position: randomPosition(),
              velocity: new THREE.Vector3(),
              seed: Math.random() * 100
            };

            balls.push(ball);

            if (drawnIDs.has(student.id)) {
              mesh.visible = false;

              if (latest?.id === student.id) {
                selected = ball;
                mesh.visible = true;
                mesh.position.copy(displayPosition);
                mesh.scale.setScalar(1.65);
              }

              continue;
            }

            for (let attempt = 0; attempt < 250; attempt++) {
              const overlaps = available.some(other =>
                other.position.distanceToSquared(ball.position) <
                (ballRadius * 2.06) ** 2
              );

              if (!overlaps) break;
              ball.position.copy(randomPosition());
            }

            ball.velocity.set(
              (Math.random() - .5) * .4,
              Math.random() * .3,
              (Math.random() - .5) * .4
            );

            mesh.position.copy(ball.position).add(center);
            available.push(ball);
          }
        }

        function updateRosterAndHistory() {
          const history = classHistory();
          const drawnIDs = new Set(history.map(student => student.id));

          ui.remaining.textContent = \`\${available.length} BALLS REMAINING\`;
          ui.count.textContent = \`\${history.length} / \${currentClass.students.length}\`;
          ui.classMeta.textContent =
            \`\${currentClass.students.length} students · \${available.length} still in the machine\`;

          ui.history.replaceChildren();

          if (history.length === 0) {
            const empty = document.createElement("span");
            empty.className = "empty";
            empty.textContent = "No students drawn yet.";
            ui.history.appendChild(empty);
          } else {
            for (const student of history) {
              const chip = document.createElement("span");
              chip.className = "history-chip";

              const number = document.createElement("span");
              number.className = "history-number";
              number.style.backgroundColor = colorFor(student);
              number.textContent = student.number;

              const name = document.createElement("span");
              name.textContent = student.name;

              chip.append(number, name);
              ui.history.appendChild(chip);
            }

            ui.history.scrollTop = ui.history.scrollHeight;
          }

          ui.roster.replaceChildren();

          for (const student of currentClass.students) {
            const row = document.createElement("tr");
            const number = document.createElement("td");
            const name = document.createElement("td");
            const status = document.createElement("td");

            number.textContent = student.number;
            name.textContent = student.name;

            const picked = drawnIDs.has(student.id);
            status.textContent = picked ? "Already drawn" : "In the machine";

            if (picked) status.className = "picked";

            row.append(number, name, status);
            ui.roster.appendChild(row);
          }
        }

        function showResult(student, animate = false) {
          ui.resultBall.classList.remove("reveal");

          ui.number.textContent = student
            ? String(student.number).padStart(2, "0")
            : "—";

          ui.studentName.textContent = student
            ? student.name
            : "Who will it be?";

          ui.resultClass.textContent = currentClass.name;

          ui.resultBall.style.setProperty(
            "--ball-color", student ? colorFor(student) : "#294963"
          );

          if (animate) {
            void ui.resultBall.offsetWidth;
            ui.resultBall.classList.add("reveal");
          }
        }

        function updateButtons() {
          const busy = state !== "idle";

          ui.classSelect.disabled = busy;
          ui.reset.disabled = busy;
          ui.longMix.disabled = busy;
          ui.draw.disabled = busy || available.length === 0;

          if (!busy) {
            ui.draw.textContent = available.length
              ? "Draw Student"
              : "No Students Remaining";
          }
        }

        function selectClass(id) {
          if (state !== "idle") return;

          currentClass = classes.find(classroom => classroom.id === id);
          if (!currentClass) return;

          phaseTime = 0;
          accumulator = 0;
          extractionCurve = null;

          ui.classSelect.value = currentClass.id;
          ui.sceneClass.textContent = currentClass.name;
          ui.progress.style.width = "0%";

          buildMachine();
          updateRosterAndHistory();

          const history = classHistory();
          const latest = history[history.length - 1];

          showResult(latest);

          ui.status.textContent = available.length
            ? \`\${currentClass.name} is ready. Each ball represents one student.\`
            : currentClass.students.length
              ? "Everyone in this class has been drawn. Reset to start again."
              : "This class has no students.";

          ui.caption.textContent =
            \`\${currentClass.name} · \${currentClass.students.length} students\`;

          updateButtons();
        }

        function randomIndex(length) {
          if (globalThis.crypto?.getRandomValues) {
            const cutoff = Math.floor(4294967296 / length) * length;

            do {
              globalThis.crypto.getRandomValues(randomBuffer);
            } while (randomBuffer[0] >= cutoff);

            return randomBuffer[0] % length;
          }

          return Math.floor(Math.random() * length);
        }

        function beginDraw() {
          if (state !== "idle" || available.length === 0) return;

          void playMusic();

          if (selected) selected.mesh.visible = false;
          selected = null;

          mixDuration = ui.longMix.checked ? 10 : 3;
          phaseTime = 0;
          state = "mixing";

          showResult(null);
          ui.studentName.textContent = "Mixing…";
          ui.status.textContent =
            \`Mixing \${currentClass.name} for \${mixDuration} seconds…\`;
          ui.draw.textContent = "Mixing…";
          ui.progress.style.width = "0%";

          updateButtons();

          for (const ball of available) {
            ball.velocity.set(
              (Math.random() - .5) * 7,
              3 + Math.random() * 5,
              (Math.random() - .5) * 7
            );
          }
        }

        function beginExtraction() {
          const index = randomIndex(available.length);
          selected = available.splice(index, 1)[0];

          const start = selected.position.clone().add(center);
          const insidePort = portWorld.clone()
            .addScaledVector(portNormal, -.48);

          extractionCurve = new THREE.CatmullRomCurve3([
            start,
            start.clone().lerp(insidePort, .55),
            insidePort,
            portWorld,
            portOutside,
            new THREE.Vector3(
              0, center.y - radius + .85, radius + .64
            ),
            displayPosition
          ]);

          state = "extracting";
          phaseTime = 0;

          ui.draw.textContent = "Drawing…";
          ui.studentName.textContent = "Here it comes…";
          ui.status.textContent = "A student’s ball is rolling out…";
          ui.remaining.textContent = \`\${available.length} BALLS REMAINING\`;
        }

        function finishDraw() {
          state = "idle";

          const student = selected.student;
          classHistory().push(student);

          showResult(student, true);
          updateRosterAndHistory();
          updateButtons();

          ui.progress.style.width = "100%";

          ui.status.textContent =
            \`\${currentClass.name}: number \${student.number}, \${student.name}! \` +
            (available.length
              ? \`\${available.length} students remain.\`
              : "Everyone has now been drawn.");

          ui.caption.textContent =
            \`Selected: \${student.number} · \${student.name} · \${currentClass.name}\`;
        }

        function constrain(ball, restitution) {
          const distance = ball.position.length();
          if (distance <= limit) return;

          normal.copy(ball.position).divideScalar(distance);
          ball.position.copy(normal).multiplyScalar(limit);

          const outwardSpeed = ball.velocity.dot(normal);

          if (outwardSpeed > 0) {
            ball.velocity.addScaledVector(
              normal, -(1 + restitution) * outwardSpeed
            );
          }
        }

        function physics(dt) {
          simulationTime += dt;

          const mixing = state === "mixing";
          const restitution = mixing ? .88 : .35;

          for (const ball of available) {
            const p = ball.position;
            const v = ball.velocity;

            v.y -= 7.5 * dt;

            if (mixing) {
              const t = simulationTime;
              const s = ball.seed;

              v.x += (Math.sin(t * 4.1 + s) * 12 - p.z * 5) * dt;
              v.z += (Math.cos(t * 3.7 + s) * 12 + p.x * 5) * dt;
              v.y += (10 + Math.sin(t * 5.3 + s) * 8) * dt;

              if (p.y < -radius * .45) v.y += 15 * dt;
            }

            v.multiplyScalar(Math.exp(-(mixing ? .28 : .85) * dt));
            v.clampLength(0, mixing ? 8.5 : 6);

            p.addScaledVector(v, dt);
            constrain(ball, restitution);
          }

          const diameter = ballRadius * 2;
          const diameterSquared = diameter * diameter;

          for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < available.length; i++) {
              for (let j = i + 1; j < available.length; j++) {
                const a = available[i];
                const b = available[j];

                delta.subVectors(b.position, a.position);

                const distanceSquared = delta.lengthSq();
                if (distanceSquared >= diameterSquared) continue;

                let distance = Math.sqrt(distanceSquared);

                if (distance < .00001) {
                  delta.set(1, 0, 0);
                  distance = 0;
                } else {
                  delta.divideScalar(distance);
                }

                const correction = (diameter - distance) * .5;

                a.position.addScaledVector(delta, -correction);
                b.position.addScaledVector(delta, correction);

                const relativeSpeed =
                  (b.velocity.x - a.velocity.x) * delta.x +
                  (b.velocity.y - a.velocity.y) * delta.y +
                  (b.velocity.z - a.velocity.z) * delta.z;

                if (relativeSpeed < 0) {
                  const impulse = -(1 + restitution) * relativeSpeed * .5;
                  a.velocity.addScaledVector(delta, -impulse);
                  b.velocity.addScaledVector(delta, impulse);
                }
              }
            }

            for (const ball of available) {
              constrain(ball, restitution);
            }
          }
        }

        function resize() {
          const width = ui.stage.clientWidth;
          const height = ui.stage.clientHeight;

          if (!width || !height) return;

          renderer.setSize(width, height, false);
          camera.aspect = width / height;

          const verticalFov = THREE.MathUtils.degToRad(camera.fov);
          const horizontalFov = 2 * Math.atan(
            Math.tan(verticalFov / 2) * camera.aspect
          );

          const fitFov = Math.min(verticalFov, horizontalFov);
          const distance = (radius + 1.45) / Math.sin(fitFov / 2);

          const target = new THREE.Vector3(0, .35, .5);
          const direction = new THREE.Vector3(.08, .15, 1).normalize();

          camera.position.copy(target).addScaledVector(direction, distance);
          camera.far = Math.max(200, distance + radius * 5);
          camera.lookAt(target);
          camera.updateProjectionMatrix();
        }

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(ui.stage);

        ui.classSelect.replaceChildren();

        for (const classroom of classes) {
          const option = document.createElement("option");
          option.value = classroom.id;
          option.textContent =
            \`\${classroom.name} — \${classroom.students.length} students\`;
          ui.classSelect.appendChild(option);
        }

        ui.classSelect.addEventListener("change", () => {
          selectClass(ui.classSelect.value);
        });

        ui.draw.addEventListener("click", beginDraw);

ui.reset.addEventListener("click", () => {
          if (state !== "idle") return;

          if (
            classHistory().length &&
            !window.confirm(
              \`Reset \${ currentClass.name }?All students in this class will be eligible again.\`
            )
          ) {
            return;
          }

          histories.set(currentClass.id, []);
          selectClass(currentClass.id);
        });

        const resetAllBtn = $("#reset-all");
        resetAllBtn.disabled = false;
        resetAllBtn.addEventListener("click", () => {
          if (state !== "idle") return;
          if (!window.confirm("Reset ALL classes? Every student will be eligible again.")) return;
          
          for (const c of classes) {
            histories.set(c.id, []);
          }
          selectClass(currentClass.id);
        });

        let graphicsAvailable = true;

        renderer.domElement.addEventListener("webglcontextlost", event => {
          event.preventDefault();
          graphicsAvailable = false;
          ui.draw.disabled = true;
          ui.reset.disabled = true;
          ui.classSelect.disabled = true;
          ui.error.hidden = false;
          ui.error.textContent =
            "The graphics connection was interrupted. Refresh the page to restart.";
        });

        const step = 1 / 120;
        let lastTime = performance.now();

        document.addEventListener("visibilitychange", () => {
          lastTime = performance.now();
          accumulator = 0;
        });

        function animate(now) {
          requestAnimationFrame(animate);

          if (!graphicsAvailable || document.hidden) {
            lastTime = now;
            return;
          }

          const dt = Math.min((now - lastTime) / 1000, .05);
          lastTime = now;
          accumulator += dt;

          while (accumulator >= step) {
            physics(step);
            accumulator -= step;
          }

          for (const ball of available) {
            ball.mesh.position.copy(ball.position).add(center);
            ball.mesh.quaternion.copy(camera.quaternion);
          }

          if (state === "mixing") {
            phaseTime += dt;

            const progress = Math.min(phaseTime / mixDuration, 1);
            const secondsLeft = Math.max(0, Math.ceil(mixDuration - phaseTime));

            ui.progress.style.width = \`\${progress * 75}%\`;
            ui.draw.textContent = \`Mixing… \${secondsLeft}s\`;

            if (phaseTime >= mixDuration) beginExtraction();

          } else if (state === "extracting") {
            phaseTime += dt;

            const progress = Math.min(phaseTime / extractDuration, 1);
            const eased = progress * progress * (3 - 2 * progress);

            selected.mesh.position.copy(
              extractionCurve.getPointAt(eased)
            );

            selected.mesh.quaternion.copy(camera.quaternion);

            const grow = THREE.MathUtils.smoothstep(progress, .8, 1);
            selected.mesh.scale.setScalar(1 + grow * .65);

            ui.progress.style.width = \`\${75 + progress * 25}%\`;

            if (progress >= 1) finishDraw();
          }

          if (selected && state === "idle") {
            selected.mesh.quaternion.copy(camera.quaternion);
          }

          renderer.render(scene, camera);
        }

let initialClassId = classes[0].id;
        if (targetClass) {
          // Try to match the target class name, ignoring zero-width spaces if necessary
          const matched = classes.find(c => c.name.replace(/\u200B/g, '') === targetClass.replace(/\u200B/g, ''));
          if (matched) {
            initialClassId = matched.id;
          }
        }
        
        selectClass(initialClassId);
        lastTime = performance.now();
        requestAnimationFrame(animate);

      } catch (error) {
        console.error(error);

        ui.draw.disabled = true;
        ui.reset.disabled = true;
        ui.classSelect.disabled = true;
        ui.status.textContent = "The classroom machine could not start.";
        ui.error.hidden = false;
        ui.error.textContent =
          "Unable to start the machine. Check your internet connection and " +
          "WebGL support. Details: " + error.message;
      }
    }
  </script>
</body>
</html>
`;

  return (
    <div className="w-full h-screen flex flex-col bg-[#08111f] relative">
      {/* Back to Home Button */}
      <button
        onClick={() => navigate('/')}
        className="absolute top-6 left-6 z-50 flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors border border-white/20 shadow-lg backdrop-blur-sm"
      >
        <ArrowLeft size={18} />
        <span className="font-bold text-sm">Back to Home</span>
      </button>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-white">
          <p className="animate-pulse">Loading classes from database...</p>
        </div>
      ) : classesData.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white">
          <p>No classes found assigned to your account.</p>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          srcDoc={htmlContent}
          className="w-full h-full border-none"
          title="Lottery Machine"
          sandbox="allow-scripts"
          onLoad={() => {
            if (classesData.length > 0 && iframeRef.current) {
              const queryParams = new URLSearchParams(location.search);
              const targetClass = queryParams.get('class');

              iframeRef.current.contentWindow.postMessage({
                type: 'LOAD_CLASSES',
                payload: classesData,
                targetClass: targetClass
              }, '*');
            }
          }}
        />
      )}
    </div>
  );
}