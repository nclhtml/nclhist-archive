import React, {
  useEffect,
  useRef,
  useState
} from "react";

import { auth } from "../../firebase.js";
import PoeImportPanel from "../../PoeImportPanel.jsx";

import {
  GENERATOR_MANUAL_PROMPT,
  downloadPreparedFile,
  parseGeneratorDraft,
  prepareGeneratorFile
} from "./generatorImportHelpers.js";

function sizeLabel(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

export default function GeneratorDocumentTools({
  callApi,
  getDocument,
  onLoadDocument,
  disabled = false
}) {
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(1);
  const [title, setTitle] = useState("");

  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");

  const [pdfFile, setPdfFile] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [prepared, setPrepared] = useState(null);

  const [draft, setDraft] = useState(null);
  const [pastedResult, setPastedResult] = useState("");

  const running = useRef(false);
  const mounted = useRef(false);
  const promptRef = useRef(null);
  const pdfInputRef = useRef(null);

  const blocked = disabled || busy || importing;
  const selected = slots.find(item => item.slot === slot);

  useEffect(() => {
    mounted.current = true;

    refreshSlots().catch(error => {
      if (mounted.current) {
        setMessage(
          error.message || "Could not load save slots."
        );
      }
    });

    return () => {
      mounted.current = false;
    };
  }, [callApi]);

  async function request(payload) {
    const uid = auth.currentUser?.uid;

    if (!uid) {
      throw new Error("Sign in again before continuing.");
    }

    const response = await callApi(payload);

    if (auth.currentUser?.uid !== uid) {
      throw new Error(
        "The signed-in account changed. Refresh this page."
      );
    }

    return response.data;
  }

  async function refreshSlots() {
    const result = await request({
      action: "listDocuments"
    });

    if (!Array.isArray(result?.slots)) {
      throw new Error(
        "The server returned an invalid save-slot list."
      );
    }

    if (mounted.current) {
      setSlots(result.slots);
    }
  }

  async function run(task) {
    if (running.current || blocked) return;

    running.current = true;
    setBusy(true);
    setMessage("");

    try {
      await task();
    } catch (error) {
      if (mounted.current) {
        setMessage(error.message || "The operation failed.");
      }
    } finally {
      running.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  function chooseSlot(value) {
    const nextSlot = Number(value);
    const saved = slots.find(item => item.slot === nextSlot);

    setSlot(nextSlot);
    setTitle(saved?.title || "");
    setMessage("");
  }

  function save() {
    run(async () => {
      if (!selected) {
        throw new Error("Refresh the save slots first.");
      }

      const name = title.trim();

      if (!name) {
        throw new Error("Enter a document name.");
      }

      if (
        selected.occupied &&
        !window.confirm(
          `Overwrite slot ${slot}: "${selected.title}"?\n\n` +
          "The previous saved document in this slot will be replaced."
        )
      ) {
        return;
      }

      const document = getDocument();

      await request({
        action: "saveDocument",
        slot,
        title: name,
        expectedVersion: selected.version,
        document
      });

      if (!mounted.current) return;

      setMessage(
        `Document saved in slot ${slot}. ` +
        "Later edits are not saved automatically."
      );

      await refreshSlots();
    });
  }

  function load() {
    run(async () => {
      if (!selected?.occupied) {
        throw new Error("This save slot is empty.");
      }

      const result = await request({
        action: "loadDocument",
        slot
      });

      if (!mounted.current) return;

      if (
        !window.confirm(
          `Load "${result.title}" from slot ${slot}?\n\n` +
          "This replaces the current editor, including both languages, " +
          "sources, questions and answers. Unsaved changes will be lost."
        )
      ) {
        return;
      }

      onLoadDocument(result.document);

      setTitle(result.title);
      setDraft(null);
      setMessage(`Loaded "${result.title}".`);
    });
  }

  function remove() {
    run(async () => {
      if (!selected?.occupied) {
        throw new Error("This save slot is empty.");
      }

      if (
        !window.confirm(
          `Delete "${selected.title}" from slot ${slot}?\n\n` +
          "This deletes the saved copy, not the current editor."
        )
      ) {
        return;
      }

      await request({
        action: "deleteDocument",
        slot,
        expectedVersion: selected.version
      });

      if (!mounted.current) return;

      setTitle("");
      setMessage(`Slot ${slot} deleted.`);

      await refreshSlots();
    });
  }

  /*
   * A changed source selection invalidates the prepared file
   * and any draft made from the previous selection.
   */
  function invalidateSources() {
    setPrepared(null);
    setDraft(null);
    setMessage("");
  }

  function changePdf(event) {
    const nextFile = event.target.files?.[0] || null;

    setPdfFile(nextFile);
    invalidateSources();
  }

  function removePdf() {
    setPdfFile(null);

    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }

    invalidateSources();
  }

  function addPhotos(event) {
    const incoming = Array.from(event.target.files || []);

    /*
     * Reset the picker so the same file can be selected again
     * after it has been removed.
     */
    event.target.value = "";

    if (!incoming.length) return;

    const supported = incoming.every(file =>
      /\.(jpe?g|png|webp)$/i.test(file.name)
    );

    if (!supported) {
      setMessage(
        "Use JPG, JPEG, PNG or WebP photos. " +
        "Convert HEIC/HEIF files to JPG or PNG first."
      );
      return;
    }

    const next = [...photos, ...incoming];

    if (next.length > 40) {
      setMessage(
        "Select at most 40 photos. " +
        "The PDF pages plus photos must also total at most 40."
      );
      return;
    }

    setPhotos(next);
    invalidateSources();
  }

  function removePhoto(index) {
    setPhotos(previous =>
      previous.filter((_, photoIndex) => photoIndex !== index)
    );

    invalidateSources();
  }

  function movePhoto(index, direction) {
    const target = index + direction;

    if (
      target < 0 ||
      target >= photos.length ||
      blocked
    ) {
      return;
    }

    setPhotos(previous => {
      const next = [...previous];

      [next[index], next[target]] = [
        next[target],
        next[index]
      ];

      return next;
    });

    invalidateSources();
  }

  function prepareFiles() {
    run(async () => {
      setPrepared(null);
      setDraft(null);

      const result = await prepareGeneratorFile(
        pdfFile,
        photos,
        progress => {
          if (mounted.current) {
            setMessage(progress);
          }
        }
      );

      if (!mounted.current) return;

      setPrepared(result);

      setMessage(
        `Prepared ${result.pageCount} page(s): ` +
        `${result.originalPages} original PDF page(s) and ` +
        `${result.photoCount} photo page(s). ` +
        "Nothing has been uploaded yet."
      );
    });
  }

  function receiveDraft(result) {
    try {
      const parsed = parseGeneratorDraft(result.text);

      setDraft(parsed);

      setMessage(
        "AI draft received and its structure checked. " +
        "Review the warnings and compare it with the originals " +
        "before applying it."
      );
    } catch (error) {
      setDraft(null);

      setMessage(
        error.message || "Could not read the AI draft."
      );
    }
  }

  function checkPastedResult() {
    if (blocked) return;

    receiveDraft({
      text: pastedResult
    });
  }

  async function copyPrompt() {
    if (blocked) return;

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable.");
      }

      await navigator.clipboard.writeText(
        GENERATOR_MANUAL_PROMPT
      );

      if (mounted.current) {
        setMessage(
          "Prompt copied. Paste it into your chosen AI chat, " +
          "attach the original PDF/photos there, and request " +
          "the complete JSON result."
        );
      }
    } catch {
      /*
       * The prompt remains visible and selectable even if
       * clipboard access is blocked by the browser.
       */
      promptRef.current?.focus();
      promptRef.current?.select();

      if (mounted.current) {
        setMessage(
          "Automatic copying was blocked. The prompt is selected " +
          "below. Press Ctrl+C, or Command+C on a Mac."
        );
      }
    }
  }

  function applyDraft() {
    if (!draft || blocked) return;

    if (
      !window.confirm(
        "Replace the current editor with this AI draft?\n\n" +
        "Both languages, sources, questions and answers will be replaced. " +
        "Unsaved changes will be lost.\n\n" +
        "AI extraction can contain mistakes. Review the result afterwards."
      )
    ) {
      return;
    }

    try {
      onLoadDocument(draft.document);

      setDraft(null);
      setTitle("");

      setMessage(
        "AI draft applied. Check all sources, questions, marks " +
        "and answers. It has not been saved to a slot."
      );
    } catch (error) {
      setMessage(
        error.message || "Could not apply the AI draft."
      );
    }
  }

  return (
    <section className="msg-panel msg-document-tools">
      <h2>Saved documents and AI import</h2>

      <p className="msg-note">
        Ten save slots belong to your signed-in administrator account.
        Each slot includes both languages, sources, questions, answers
        and worksheet settings. Saving is manual.
      </p>

      <div className="msg-document-controls">
        <label className="msg-field">
          <span>Save slot</span>

          <select
            value={slot}
            disabled={blocked || !slots.length}
            onChange={event => chooseSlot(event.target.value)}
          >
            {slots.length ? slots.map(item => (
              <option key={item.slot} value={item.slot}>
                {item.slot}. {item.occupied ? item.title : "Empty"}
              </option>
            )) : (
              <option value={1}>Loading slots…</option>
            )}
          </select>
        </label>

        <label className="msg-field">
          <span>Document name</span>

          <input
            type="text"
            maxLength={120}
            value={title}
            disabled={blocked}
            placeholder="For example: S4 Quiz 4"
            onChange={event => setTitle(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="msg-primary"
          disabled={blocked || !selected}
          onClick={save}
        >
          {selected?.occupied ? "Overwrite slot" : "Save to slot"}
        </button>

        <button
          type="button"
          disabled={blocked || !selected?.occupied}
          onClick={load}
        >
          Load
        </button>

        <button
          type="button"
          className="msg-danger"
          disabled={blocked || !selected?.occupied}
          onClick={remove}
        >
          Delete save
        </button>

        <button
          type="button"
          disabled={blocked}
          onClick={() => run(refreshSlots)}
        >
          Refresh slots
        </button>
      </div>

      {selected?.updatedAt && (
        <p className="msg-note">
          Last saved: {new Date(selected.updatedAt).toLocaleString()}
        </p>
      )}

      <div
        role="status"
        aria-live="polite"
        className="msg-document-message"
        style={{ whiteSpace: "pre-wrap" }}
      >
        {message}
      </div>

      <hr />

      <h3>Import a PDF, photos, or both</h3>

      <p className="msg-note">
        Select an optional PDF and/or multiple JPG, PNG or WebP photos.
        For the automatic backend route, the PDF pages come first,
        followed by one page per photo in the order shown below.
        The finished file must be at most 20 MiB and 40 pages.
      </p>

      <p className="msg-warning">
        Automatic import still sends a PDF to your existing backend.
        Photos are placed onto PDF pages, so image recognition is not
        guaranteed. To send original photos directly to an AI, use the
        manual copy-and-paste method below.
      </p>

      <label className="msg-field">
        <span>Optional original PDF</span>

        <input
          ref={pdfInputRef}
          type="file"
          accept=".pdf,application/pdf"
          disabled={blocked}
          onChange={changePdf}
        />
      </label>

      {pdfFile && (
        <div className="msg-actions">
          <span>
            {pdfFile.name} — {sizeLabel(pdfFile.size)}
          </span>

          <button
            type="button"
            disabled={blocked}
            onClick={removePdf}
          >
            Remove PDF
          </button>
        </div>
      )}

      <label className="msg-field">
        <span>Add photos — you can select more than one</span>

        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          multiple
          disabled={blocked}
          onChange={addPhotos}
        />
      </label>

      <p className="msg-note">
        You can use the photo picker again to add more photos.
        HEIC/HEIF files must first be converted to JPG or PNG.
        Choose clear, upright photos with readable text.
      </p>

      {photos.length > 0 && (
        <div>
          <h4>Photo order</h4>

          <ol>
            {photos.map((photo, index) => (
              <li
                key={`${index}-${photo.name}-${photo.lastModified}`}
                style={{ marginBottom: "0.75rem" }}
              >
                <div style={{ overflowWrap: "anywhere" }}>
                  {photo.name} — {sizeLabel(photo.size)}
                </div>

                <div className="msg-actions">
                  <button
                    type="button"
                    disabled={blocked || index === 0}
                    onClick={() => movePhoto(index, -1)}
                    aria-label={`Move photo ${index + 1} up`}
                  >
                    ↑ Up
                  </button>

                  <button
                    type="button"
                    disabled={
                      blocked || index === photos.length - 1
                    }
                    onClick={() => movePhoto(index, 1)}
                    aria-label={`Move photo ${index + 1} down`}
                  >
                    ↓ Down
                  </button>

                  <button
                    type="button"
                    className="msg-danger"
                    disabled={blocked}
                    onClick={() => removePhoto(index)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <button
            type="button"
            disabled={blocked}
            onClick={() => {
              setPhotos([]);
              invalidateSources();
            }}
          >
            Remove all photos
          </button>
        </div>
      )}

      <div
        className="msg-actions"
        style={{ marginTop: "1rem" }}
      >
        <button
          type="button"
          className="msg-primary"
          disabled={blocked || (!pdfFile && !photos.length)}
          onClick={prepareFiles}
        >
          Prepare files for automatic import
        </button>

        {prepared && (
          <button
            type="button"
            disabled={blocked}
            onClick={() => downloadPreparedFile(prepared.file)}
          >
            Download prepared PDF
          </button>
        )}
      </div>

      {prepared ? (
        <p className="msg-note">
          Ready: {prepared.pageCount} page(s),{" "}
          {sizeLabel(prepared.file.size)}.
          Preparation happened in your browser.
          Uploading starts only when you confirm generation below.
        </p>
      ) : (
        <p className="msg-note">
          Select your files and click “Prepare files for automatic
          import” before using the Poe backend.
          You do not need to prepare files for the manual method.
        </p>
      )}

      <PoeImportPanel
        mode="generator"
        entries={[
          {
            role: "generator",
            label: "Prepared PDF, including any photo pages",
            file: prepared?.file || null
          }
        ]}
        disabled={disabled || busy || !prepared}
        onDraft={receiveDraft}
        onInvalidate={() => setDraft(null)}
        onBusyChange={setImporting}
      />

      <hr />

      <h3>Manual alternative: copy prompt and paste result</h3>

      <p className="msg-note">
        This method does not call your Poe backend.
        Use it if the backend fails, or if you want to attach the
        original photos directly to your chosen AI.
        Only send files you are authorized to share.
      </p>

      <ol className="msg-note">
        <li>
          Click “Copy import prompt”.
        </li>

        <li>
          Open your chosen AI chat and paste the prompt.
        </li>

        <li>
          Attach your original PDF and/or original photos there.
          Selecting files on this page does not attach them to
          another website.
        </li>

        <li>
          Ask the AI to return the complete JSON result.
        </li>

        <li>
          Copy that result into the result box below and click
          “Check pasted result”.
        </li>

        <li>
          Review the draft, then apply it to the editor.
          Save to a slot separately if you want to keep it.
        </li>
      </ol>

      <div className="msg-actions">
        <button
          type="button"
          className="msg-primary"
          disabled={blocked}
          onClick={copyPrompt}
        >
          Copy import prompt
        </button>
      </div>

      <label className="msg-field">
        <span>
          Import prompt — you can also select and copy it manually
        </span>

        <textarea
          ref={promptRef}
          readOnly
          rows={8}
          value={GENERATOR_MANUAL_PROMPT}
          style={{
            width: "100%",
            fontFamily: "monospace"
          }}
        />
      </label>

      <label className="msg-field">
        <span>Paste the complete AI JSON result here</span>

        <textarea
          rows={12}
          value={pastedResult}
          disabled={blocked}
          placeholder={'{"warnings":[],"document":{...}}'}
          onChange={event => {
            setPastedResult(event.target.value);
            setDraft(null);
          }}
          style={{
            width: "100%",
            fontFamily: "monospace"
          }}
        />
      </label>

      <div className="msg-actions">
        <button
          type="button"
          className="msg-primary"
          disabled={blocked || !pastedResult.trim()}
          onClick={checkPastedResult}
        >
          Check pasted result
        </button>

        <button
          type="button"
          disabled={blocked || !pastedResult}
          onClick={() => {
            setPastedResult("");
            setDraft(null);
            setMessage("");
          }}
        >
          Clear pasted result
        </button>
      </div>

      {draft && (
        <div className="msg-import-draft">
          <h3>AI draft ready for review</h3>

          {draft.warnings.length ? (
            <ul className="msg-warning">
              {draft.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="msg-note">
              No warnings were reported. You must still compare
              the extraction with the original PDF/photos.
            </p>
          )}

          <p className="msg-note">
            {draft.document.paper.sections.length} main question
            group(s);{" "}
            {draft.document.blocks.length} question block(s).
          </p>

          <p className="msg-warning">
            Pictures are not stored in the editor document.
            Picture placeholders may be reconstructed, but the
            original pictures must be added to Word separately.
          </p>

          {draft.inspectedFiles.length > 0 && (
            <details>
              <summary>AI-reported attachment inspection</summary>

              <p className="msg-note">
                This is the AI&apos;s own report, not independent
                proof that every attachment was read correctly.
              </p>

              <textarea
                readOnly
                rows={6}
                value={JSON.stringify(
                  draft.inspectedFiles,
                  null,
                  2
                )}
                style={{
                  width: "100%",
                  fontFamily: "monospace"
                }}
              />
            </details>
          )}

          <details>
            <summary>Inspect reconstructed editor data</summary>

            <textarea
              readOnly
              rows={12}
              value={JSON.stringify(
                draft.document,
                null,
                2
              )}
              style={{
                width: "100%",
                fontFamily: "monospace"
              }}
            />
          </details>

          <div className="msg-actions">
            <button
              type="button"
              className="msg-primary"
              disabled={blocked}
              onClick={applyDraft}
            >
              Apply AI draft to editor
            </button>

            <button
              type="button"
              disabled={blocked}
              onClick={() => setDraft(null)}
            >
              Discard draft
            </button>
          </div>
        </div>
      )}
    </section>
  );
}