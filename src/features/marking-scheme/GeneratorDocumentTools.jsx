import React, {
  useEffect,
  useRef,
  useState
} from "react";

import { auth } from "../../firebase.js";
import PoeImportPanel from "../../PoeImportPanel.jsx";

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

  const [file, setFile] = useState(null);
  const [draft, setDraft] = useState(null);

  const running = useRef(false);
  const mounted = useRef(false);

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
      throw new Error("The server returned an invalid save-slot list.");
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

      /*
       * Capture one complete snapshot.
       * This includes both languages, sources, answers and settings.
       */
      const document = getDocument();

      await request({
        action: "saveDocument",
        slot,
        title: name,
        expectedVersion: selected.version,
        document
      });

      setMessage(
        `Document saved in slot ${slot}. Later edits are not saved automatically.`
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

      setTitle("");
      setMessage(`Slot ${slot} deleted.`);
      await refreshSlots();
    });
  }

  function receiveDraft(result) {
    try {
      const parsed = JSON.parse(result.text);

      if (
        !parsed.document ||
        !Array.isArray(parsed.document.blocks) ||
        !Array.isArray(parsed.document.paper?.sections)
      ) {
        throw new Error("The PDF draft has an invalid document structure.");
      }

      setDraft(parsed);
      setMessage(
        "PDF draft received. Review the warnings before applying it."
      );
    } catch (error) {
      setDraft(null);
      setMessage(error.message || "Could not read the PDF draft.");
    }
  }

  function applyDraft() {
    if (!draft || blocked) return;

    if (
      !window.confirm(
        "Replace the current editor with this PDF draft?\n\n" +
        "Both languages, sources, questions and answers will be replaced. " +
        "Unsaved changes will be lost.\n\n" +
        "AI extraction can contain mistakes. Review the result afterwards."
      )
    ) {
      return;
    }

    onLoadDocument(draft.document);

    setDraft(null);
    setTitle("");

    setMessage(
      "PDF draft applied. Check all sources, questions, marks and answers. " +
      "It has not been saved to a slot."
    );
  }

  return (
    <section className="msg-panel msg-document-tools">
      <h2>Saved documents and PDF import</h2>

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

      <div role="status" aria-live="polite" className="msg-document-message">
        {message}
      </div>

      <hr />

      <h3>Import an existing PDF</h3>

      <p className="msg-note">
        Select one PDF, up to 20 MiB and 40 pages.
        Your existing Poe backend will reconstruct an editable draft.
        No translation is added. Actual pictures are not imported;
        picture spaces are recreated instead.
      </p>

      <label className="msg-field">
        <span>Question paper, marking scheme, or combined PDF</span>

        <input
          type="file"
          accept=".pdf,application/pdf"
          disabled={blocked}
          onChange={event => {
            setFile(event.target.files?.[0] || null);
            setDraft(null);
          }}
        />
      </label>

      <PoeImportPanel
        mode="generator"
        entries={[
          {
            role: "generator",
            label: "Document-generator PDF",
            file
          }
        ]}
        disabled={disabled || busy}
        onDraft={receiveDraft}
        onInvalidate={() => setDraft(null)}
        onBusyChange={setImporting}
      />

      {draft && (
        <div className="msg-import-draft">
          <h3>PDF draft ready for review</h3>

          {draft.warnings?.length ? (
            <ul className="msg-warning">
              {draft.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="msg-note">
              No warnings were reported. You must still check the
              extraction against the original PDF.
            </p>
          )}

          <p className="msg-note">
            {draft.document.paper.sections.length} main question group(s);
            {" "}{draft.document.blocks.length} question block(s).
          </p>

          <details>
            <summary>Inspect the reconstructed editor data</summary>

            <textarea
              readOnly
              rows={12}
              value={JSON.stringify(draft.document, null, 2)}
            />
          </details>

          <div className="msg-actions">
            <button
              type="button"
              className="msg-primary"
              disabled={blocked}
              onClick={applyDraft}
            >
              Apply PDF draft to editor
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