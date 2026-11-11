import fs from "node:fs";
import path from "node:path";

const input = path.resolve(
  "source-material/peace-table-original.html"
);

const output = path.resolve(
  "src/features/peace-table"
);

if (!fs.existsSync(input)) {
  throw new Error(
    "Missing source-material/peace-table-original.html. " +
    "Save the complete original game HTML there first."
  );
}

const html = fs.readFileSync(input, "utf8");

function between(start, end) {
  const startAt = html.indexOf(start);

  if (startAt < 0) {
    throw new Error(
      `Could not find this starting block in the original HTML:\n${start}`
    );
  }

  const endAt = html.indexOf(end, startAt + start.length);

  if (endAt < 0) {
    throw new Error(
      `Could not find this ending block in the original HTML:\n${end}`
    );
  }

  return html.slice(startAt, endAt);
}

const people = between(
  "const PEOPLE = {",
  "\nlet embedded"
);

const actsAndBrief = between(
  "const ACTS={",
  "/* Definitions are separate"
);

const glossary = between(
  "const GLOSSARY=[",
  "\nconst GLOSSARY_BY_ID="
);

let logic = between(
  "function commercialRoute(a)",
  "\nfunction rebuild()"
);

logic = logic
  .replace(
    "function optionFor(number,id,a=answers)",
    "function optionFor(number,id,a=[])"
  )
  .replace(
    "function responseFor(number,a)",
    "function baseResponseFor(number,a)"
  )
  .replace(
    "function endingFor(a)",
    "function baseEndingFor(a)"
  )
  .replace(
    "function buildStory(a)",
    "function baseBuildStory(a)"
  );

for (const required of [
  "function baseResponseFor(number,a)",
  "function baseEndingFor(a)",
  "function baseBuildStory(a)",
  "function optionFor(number,id,a=[])",
]) {
  if (!logic.includes(required)) {
    throw new Error(
      `The original game does not match the expected version:\n${required}`
    );
  }
}

const historicalSummary = between(
  "const HISTORICAL_SUMMARY=",
  "\nfunction historical()"
);

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/i);

if (!styleMatch) {
  throw new Error("The original HTML does not contain its stylesheet.");
}

// The game is rendered inside a React-owned shadow root.
// :host supplies the original theme without changing the website theme.
const css = styleMatch[1].replaceAll(":root", ":host");

const backdrops = {};

for (const name of ["study", "hall", "memory", "chamber"]) {
  const marker = `id="bg-${name}"`;
  const markerAt = html.indexOf(marker);

  if (markerAt < 0) {
    throw new Error(`Missing scenery: ${name}`);
  }

  const svgAt = html.indexOf("<svg", markerAt);
  const svgEnd = html.indexOf("</svg>", svgAt);

  if (svgAt < 0 || svgEnd < 0) {
    throw new Error(`Incomplete SVG scenery: ${name}`);
  }

  backdrops[name] = html.slice(svgAt, svgEnd + "</svg>".length);
}

fs.mkdirSync(output, { recursive: true });

const dataModule = `
/*
 * Generated from source-material/peace-table-original.html.
 * Re-run: node scripts/import-peace-table.mjs
 */

import {
  buildDetailedEnding,
  enhanceResponse,
  enhanceScene,
} from "./report.js";

${people}

${actsAndBrief}

${glossary}

${logic}

${historicalSummary}

function responseFor(number, answers) {
  return enhanceResponse(
    number,
    answers,
    baseResponseFor(number, answers)
  );
}

function endingFor(answers) {
  return buildDetailedEnding(
    answers,
    baseEndingFor(answers)
  );
}

function buildStory(answers) {
  return baseBuildStory(answers).flatMap(node =>
    enhanceScene(node, answers)
  );
}

export {
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
};
`;

fs.writeFileSync(
  path.join(output, "gameData.js"),
  dataModule.trimStart()
);

fs.writeFileSync(
  path.join(output, "presentation.js"),
  [
    "/* Generated presentation assets. */",
    `export const GAME_CSS = ${JSON.stringify(css)};`,
    `export const BACKDROPS = ${JSON.stringify(backdrops, null, 2)};`,
    "",
  ].join("\n")
);

console.log(
  "Created gameData.js and presentation.js in src/features/peace-table."
);

// This import also checks that the extracted game logic can run.
// Create report.js before running this script.
const data = await import(
  new URL("../src/features/peace-table/gameData.js", import.meta.url)
);

const routes = [];

function visit(prefix) {
  if (prefix.length === 4) {
    routes.push(prefix);
    return;
  }

  for (const option of data.optionsFor(prefix.length + 1, prefix)) {
    if (!option.locked) {
      visit([...prefix, option.id]);
    }
  }
}

visit([]);

const counts = {};

for (const answers of routes) {
  const story = data.buildStory(answers);
  const end = data.endingFor(answers);

  if (story.at(-1)?.kind !== "end") {
    throw new Error(`Incomplete story: ${answers.join("/")}`);
  }

  if (
    !end.title ||
    !end.narrative ||
    !Array.isArray(end.facts) ||
    !end.question
  ) {
    throw new Error(`Incomplete ending: ${answers.join("/")}`);
  }

  for (const sceneID of [
    "closing-america",
    "closing-economic",
    "closing-preparation",
  ]) {
    const matches = story.filter(node => node.id === sceneID);

    if (matches.length !== 1 || !matches[0].text) {
      throw new Error(
        `Missing or duplicated closing scene ${sceneID}: ` +
        answers.join("/")
      );
    }
  }

  counts[end.key] = (counts[end.key] || 0) + 1;
}

if (routes.length !== 63) {
  throw new Error(
    `Expected 63 valid routes; found ${routes.length}.`
  );
}

console.log(
  "Validated 63 playable routes, each with three closing conversations."
);

console.table(counts);