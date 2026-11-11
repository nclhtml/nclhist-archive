import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DECISION_NAMES,
  HISTORICAL_SUMMARY,
  optionsFor,
  optionFor,
  responseFor,
  endingFor,
} from "./gameData.js";

const WORKSHEET_CSS = `
@page {
  size:A4 portrait;
  margin:15mm 18mm;
}

* {
  box-sizing:border-box;
}

html,body {
  margin:0;
  padding:0;
  background:#e5e5e5;
  color:#000;
}

body {
  font:10pt/1.3 "Times New Roman",Times,serif;
}

.print-controls {
  max-width:210mm;
  margin:15px auto;
  padding:14px 18px;
  background:#fff;
  font:14px/1.5 Arial,sans-serif;
}

.print-controls button {
  padding:10px 16px;
  font:inherit;
  cursor:pointer;
}

.print-controls p {
  margin:8px 0 0;
}

.worksheet-page {
  width:210mm;
  padding:15mm 18mm;
  margin:12px auto;
  background:#fff;
}

.worksheet-heading {
  text-align:center;
  font-weight:bold;
  font-size:11pt;
  line-height:1.5;
  margin:0 0 7mm;
}

.worksheet-heading div + div {
  margin-top:1.5mm;
}

.student-fields {
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:4mm;
  white-space:nowrap;
  font-size:9.5pt;
  margin:0 0 7mm;
}

.section-heading {
  font-weight:bold;
  font-size:10.5pt;
  margin:0 0 3mm;
}

.route {
  margin:0 0 3mm;
  font-size:9.5pt;
}

table {
  width:100%;
  border-collapse:collapse;
  table-layout:fixed;
}

th,td {
  border:1px solid #000;
  padding:2mm;
  text-align:left;
  vertical-align:top;
  overflow-wrap:break-word;
}

th {
  font-weight:normal;
}

.decision-table {
  font-size:9pt;
  line-height:1.25;
}

.decision-table tr {
  break-inside:avoid;
  page-break-inside:avoid;
}

.decision-table strong {
  display:block;
  margin-bottom:1mm;
}

.ending-box {
  border:1px solid #000;
  padding:2.5mm 3mm;
  margin:4mm 0;
  font-size:9pt;
  line-height:1.3;
}

.ending-box ul {
  padding-left:4mm;
  margin:2mm 0 0;
}

.ending-box li + li {
  margin-top:1mm;
}

.historical-reference {
  margin-top:4mm;
  font-size:8.5pt;
  line-height:1.3;
}

.historical-reference p {
  margin:1mm 0 0;
}

.page-footer {
  margin-top:4mm;
  text-align:right;
  font-size:8.5pt;
}

.reflection-title {
  text-align:center;
  margin:0 0 5mm;
  font-size:11.5pt;
  line-height:1.3;
}

.question-title {
  margin:4mm 0 2mm;
  font-size:10pt;
  line-height:1.3;
}

.prompt {
  font-size:9.5pt;
  line-height:1.3;
  margin:0 0 3mm;
}

.evaluation-table {
  font-size:9.5pt;
  line-height:1.3;
  margin:2mm 0 3mm;
}

.evaluation-table tbody td {
  height:29mm;
}

.judgement {
  margin:0 0 2mm;
  font-size:9.5pt;
  line-height:1.3;
}

.write-line {
  height:6.5mm;
  border-bottom:1px solid #888;
}

.question-group {
  break-inside:avoid;
  page-break-inside:avoid;
}

@media print {
  html,body {
    background:#fff;
    width:auto;
    height:auto;
  }

  .print-controls {
    display:none !important;
  }

  .worksheet-page {
    width:auto;
    padding:0;
    margin:0;
    break-after:page;
    page-break-after:always;
  }

  .worksheet-page:last-child {
    break-after:auto;
    page-break-after:auto;
  }

  .worksheet-page,
  .worksheet-page * {
    color:#000 !important;
    box-shadow:none !important;
    text-shadow:none !important;
  }
}
`;

function routeCode(answers) {
  return answers.map((id, index) => {
    const position = optionsFor(index + 1, answers)
      .findIndex(option => option.id === id);

    return `${index + 1}${String.fromCharCode(65 + position)}`;
  }).join(" – ");
}

function WritingLines({ count }) {
  return Array.from({ length: count }, (_, index) => (
    <div className="write-line" key={index} />
  ));
}

function ReflectionWorksheet({ answers }) {
  const ending = endingFor(answers);
  const route = routeCode(answers);

  return (
    <>
      <section className="worksheet-page">
        <div className="worksheet-heading">
          <div>Kowloon True Light School</div>
          <div>S3 History</div>
          <div>The Shandong Problem in Paris Peace Conference</div>
        </div>

        <div className="student-fields">
          <span>Name: __________________</span>
          <span>Class: ________(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</span>
          <span>Date: __________________</span>
        </div>

        <h2 className="section-heading">
          My decision-making journey
        </h2>

        <p className="route">
          Role: Wellington Koo &nbsp; | &nbsp; Route: {route}
        </p>

        <table className="decision-table">
          <colgroup>
            <col style={{ width: "19%" }} />
            <col style={{ width: "46%" }} />
            <col style={{ width: "35%" }} />
          </colgroup>

          <thead>
            <tr>
              <th>Decision</th>
              <th>What I chose</th>
              <th>What happened next</th>
            </tr>
          </thead>

          <tbody>
            {answers.map((answer, index) => {
              const number = index + 1;
              const option = optionFor(number, answer, answers);
              const response = responseFor(number, answers);

              return (
                <tr key={number}>
                  <td>
                    {number}. {DECISION_NAMES[index]}
                  </td>

                  <td>
                    <strong>{option.label}</strong>
                    {option.text}
                  </td>

                  <td>{response.record}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="ending-box">
          <strong>My ending: {ending.title}</strong>

          <ul>
            {ending.facts.map(fact => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>

        <div className="historical-reference">
          <strong>Historical reference</strong>
          <p>{HISTORICAL_SUMMARY}</p>
        </div>

        <div className="page-footer">
          Decision record · 1 / 2
        </div>
      </section>

      <section className="worksheet-page">
        <h2 className="reflection-title">
          Reflection — Through the eyes of Wellington Koo
        </h2>

        <div className="question-group">
          <h3 className="question-title">
            1. Was your ending a good ending for China?
          </h3>

          <p className="prompt">
            Use your decision record and closing report. Consider China’s
            right to govern Shandong, its people’s interests and its
            ability to continue seeking the return of the disputed rights.
            If no problem was fully solved, explain what was protected
            or partly achieved.
          </p>

          <table className="evaluation-table">
            <thead>
              <tr>
                <th>
                  Problems solved, Chinese interests protected,
                  or partial gains
                </th>

                <th>
                  Problems that remained, or new risks created
                </th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td />
                <td />
              </tr>
            </tbody>
          </table>

          <p className="judgement">
            <strong>Your judgement:</strong>{" "}
            How far was this a good ending? Explain which result matters
            most. {ending.question}
          </p>

          <WritingLines count={4} />
        </div>

        <div className="question-group">
          <h3 className="question-title">
            2. As Wellington Koo, what was the most difficult part
            of the conference?
          </h3>

          <p className="prompt">
            Choose one moment. What did you hope would happen?
            How did another delegation respond? Explain what surprised
            or troubled you, and why this made your task difficult.
          </p>

          <WritingLines count={5} />
        </div>

        <div className="question-group">
          <h3 className="question-title">
            3. Looking back, would you keep or change one of your own
            decisions?
          </h3>

          <p className="prompt">
            Identify the decision. If changing it, choose another option
            that was available at that point. Explain how your choice
            would help defend China’s interests and what difficulty
            would still remain because of another country’s concerns.
            Use Source B or C, or your class knowledge.
          </p>

          <WritingLines count={5} />
        </div>

        <div className="page-footer">
          Reflection · {route} · 2 / 2
        </div>
      </section>
    </>
  );
}

export function buildReflectionDocument(answers) {
  const content = renderToStaticMarkup(
    <ReflectionWorksheet answers={answers} />
  );

  return (
    '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Wellington Koo — China at the Peace Table</title>' +
    `<style>${WORKSHEET_CSS}</style>` +
    '</head><body>' +
    '<div class="print-controls">' +
    '<button type="button" id="print-worksheet">Print / save as PDF</button>' +
    '<p>A4 portrait. Use 100% scale. Turn off browser headers and footers ' +
    'where your browser provides that option. Check that the preview has two pages.</p>' +
    '</div>' +
    content +
    '<script>' +
    'document.getElementById("print-worksheet").addEventListener("click",function(){window.print();});' +
    '</script>' +
    '</body></html>'
  );
}

export function openReflectionDocument(answers) {
  /*
   * Open synchronously from a tap so Safari does not treat it as
   * an unsolicited pop-up.
   */
  const tab = window.open("", "_blank");

  if (!tab) return false;

  try {
    tab.opener = null;
    tab.document.open();
    tab.document.write(buildReflectionDocument(answers));
    tab.document.close();
    return true;
  } catch {
    tab.close();
    return false;
  }
}

export function downloadReflectionDocument(answers) {
  const blob = new Blob(
    [buildReflectionDocument(answers)],
    { type: "text/html;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download =
    "Shandong-reflection-" +
    routeCode(answers).replaceAll(" – ", "-") +
    ".html";

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}