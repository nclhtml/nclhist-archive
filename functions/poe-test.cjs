"use strict";

const readline = require("node:readline/promises");
const {stdin, stdout} = require("node:process");
const {PDFDocument, StandardFonts, rgb} = require("pdf-lib");

const MODEL = "Gemini-3.1-Pro";
const ENDPOINT = "https://api.poe.com/v1/chat/completions";

const terminal = readline.createInterface({
  input: stdin,
  output: stdout,
});

function removeCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function safeErrorMessage(value, apiKey) {
  return String(value || "No additional information.")
    .split(apiKey)
    .join("[REDACTED]")
    .slice(0, 1500);
}

async function askPoe(apiKey, content) {
  const controller = new AbortController();

  // This is a small connection test, not a long-document job.
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content,
          },
        ],
        stream: false,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    const requestId = response.headers.get("x-request-id");

    console.log(`HTTP status: ${response.status}`);
    if (requestId) {
      console.log(`Request ID: ${requestId}`);
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        `Poe returned HTTP ${response.status}, but the response was not JSON.`
      );
    }

    if (!response.ok) {
      const providerMessage = safeErrorMessage(
        data.error && data.error.message,
        apiKey
      );

      throw new Error(
        `Poe rejected the request: HTTP ${response.status}\n` +
        providerMessage
      );
    }

    const choice = data.choices && data.choices[0];
    const text = choice && choice.message && choice.message.content;

    if (data.model) {
      console.log(`Response model field: ${data.model}`);
    }

    if (choice && choice.finish_reason) {
      console.log(`Finish reason: ${choice.finish_reason}`);
    }

    if (data.usage) {
      console.log("Reported usage:");
      console.log(JSON.stringify(data.usage, null, 2));
    }

    if (choice && choice.finish_reason === "length") {
      throw new Error(
        "The response reached its output limit. " +
        "This is not a successful completed test."
      );
    }

    if (typeof text !== "string" || !text.trim()) {
      throw new Error(
        "Poe responded, but no usable text was returned."
      );
    }

    return text.trim();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(
        "The test timed out after 3 minutes.\n" +
        "Do not immediately repeat it: the provider may already have " +
        "started processing and charged points."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function createVisualTestPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);

  // Page 1: text plus a red check mark drawn as vector lines.
  // The annotation is not written out as a text description.
  const pageOne = document.addPage([500, 500]);

  pageOne.drawText("Page One", {
    x: 50,
    y: 440,
    size: 24,
    font,
    color: rgb(0, 0, 0),
  });

  pageOne.drawLine({
    start: {x: 110, y: 280},
    end: {x: 155, y: 230},
    thickness: 8,
    color: rgb(1, 0, 0),
  });

  pageOne.drawLine({
    start: {x: 155, y: 230},
    end: {x: 270, y: 370},
    thickness: 8,
    color: rgb(1, 0, 0),
  });

  // Page 2: text plus three blue filled squares.
  const pageTwo = document.addPage([500, 500]);

  pageTwo.drawText("Page Two", {
    x: 50,
    y: 440,
    size: 24,
    font,
    color: rgb(0, 0, 0),
  });

  for (const x of [60, 200, 340]) {
    pageTwo.drawRectangle({
      x,
      y: 240,
      width: 70,
      height: 70,
      color: rgb(0, 0, 1),
    });
  }

  return document.save();
}

async function main() {
  const apiKey = String(process.env.POE_TEST_API_KEY || "").trim();

  if (!apiKey) {
    throw new Error(
      "The temporary Poe API key is missing. " +
      "Use the PowerShell command supplied with these instructions."
    );
  }

  if (typeof fetch !== "function") {
    throw new Error(
      "This test needs a recent Node.js runtime. " +
      "Run node --version and send back the version shown."
    );
  }

  console.log("");
  console.log("POE CONNECTION AND VISUAL PDF TEST");
  console.log(`Requested model: ${MODEL}`);
  console.log("No student document will be uploaded.");
  console.log("Each test sends one request and can consume Poe points.");
  console.log("There are no automatic retries.");
  console.log("");

  const firstApproval = await terminal.question(
    "Run the small text test? Type YES and press Enter: "
  );

  if (firstApproval.trim() !== "YES") {
    console.log("Cancelled. No request sent.");
    return;
  }

  console.log("");
  console.log("--- TEST 1: TEXT CONNECTION ---");

  const textReply = await askPoe(
    apiKey,
    'Return exactly this JSON object and nothing else: {"status":"ok"}'
  );

  console.log("Model reply:");
  console.log(textReply);

  let textResult;
  try {
    textResult = JSON.parse(removeCodeFence(textReply));
  } catch {
    throw new Error(
      "The model responded, but it did not return valid JSON for the text test."
    );
  }

  if (!textResult || textResult.status !== "ok") {
    throw new Error(
      "The model responded, but the text-test result was unexpected."
    );
  }

  console.log("");
  console.log("TEST 1 PASSED: Poe API access and a basic JSON reply work.");
  console.log("");

  const secondApproval = await terminal.question(
    "Run the two-page visual PDF test? Type YES and press Enter: "
  );

  if (secondApproval.trim() !== "YES") {
    console.log("Stopped after the text test. No PDF request sent.");
    return;
  }

  console.log("");
  console.log("--- TEST 2: VISUAL PDF ---");

  const pdfBytes = await createVisualTestPdf();
  const base64 = Buffer.from(pdfBytes).toString("base64");

  const pdfReply = await askPoe(apiKey, [
    {
      type: "text",
      text:
        "Inspect every page of the attached PDF visually. " +
        "For each page, identify its actual PDF page position, " +
        "the heading, and all non-text shapes or annotations. " +
        "Describe their colors and counts. " +
        "Do not guess from the headings. " +
        "If you cannot see the visual content, explicitly say so. " +
        "Return only JSON with this structure: " +
        '{"pages":[{"pagePosition":1,"heading":"",' +
        '"visualDescription":""}]}',
    },
    {
      type: "file",
      file: {
        filename: "poe-visual-test.pdf",
        file_data: `data:application/pdf;base64,${base64}`,
      },
    },
  ]);

  console.log("");
  console.log("Model PDF reply:");
  console.log(pdfReply);

  try {
    JSON.parse(removeCodeFence(pdfReply));
    console.log("");
    console.log("The PDF reply is valid JSON.");
  } catch {
    console.log("");
    console.log("WARNING: The PDF reply is not valid JSON.");
  }

  console.log("");
  console.log("EXPECTED VISUAL FINDINGS — compare with the reply above:");
  console.log("PDF page 1: heading Page One; one RED check/tick mark.");
  console.log("PDF page 2: heading Page Two; THREE BLUE filled squares.");
  console.log("");
  console.log(
    "If the model reports only the headings or says it cannot see shapes, " +
    "the visual PDF test has not passed."
  );
  console.log(
    "Even correct findings here do not prove reliability on a " +
    "155-page handwritten student script."
  );
}

main()
  .catch((error) => {
    const key = String(process.env.POE_TEST_API_KEY || "").trim();

    console.error("");
    console.error("TEST STOPPED:");
console.error(
      key ? safeErrorMessage(error.message, key) : error.message
    );

    function printErrorDetails(label, item, depth = 0) {
      if (!item || depth > 4) return;

      const details = {
        name: item.name,
        code: item.code,
        message: item.message,
        syscall: item.syscall,
      };

      const output = JSON.stringify(details, null, 2);

      console.error(label);
      console.error(
        key ? safeErrorMessage(output, key) : output
      );

      if (item.cause) {
        printErrorDetails("Underlying cause:", item.cause, depth + 1);
      }

      if (Array.isArray(item.errors)) {
        item.errors.forEach((child, index) => {
          printErrorDetails(
            `Connection error ${index + 1}:`,
            child,
            depth + 1
          );
        });
      }
    }

    printErrorDetails("Error details:", error);

    process.exitCode = 1;
  })
  .finally(() => {
    delete process.env.POE_TEST_API_KEY;
    terminal.close();
  });