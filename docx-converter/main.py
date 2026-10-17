import io
import logging
import os
import re
import signal
import subprocess
import tempfile
import time
import zipfile

from pathlib import Path

import firebase_admin
from firebase_admin import auth, firestore

from defusedxml import ElementTree
from flask import Flask, jsonify, make_response, request
from werkzeug.exceptions import RequestEntityTooLarge


PROJECT_ID = "nclhist"
OWNER_EMAIL = "clng@ktls.edu.hk"

MAX_DOCX_BYTES = 20 * 1024 * 1024
MAX_PDF_BYTES = 32 * 1024 * 1024
MAX_EXPANDED_BYTES = 200 * 1024 * 1024
MAX_ZIP_ENTRIES = 6000

firebase_admin.initialize_app(options={"projectId": PROJECT_ID})
db = firestore.client()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_DOCX_BYTES + 1024 * 1024

ALLOWED_ORIGINS = {
    "https://nclhist.netlify.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:4173",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
}


class ConversionError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@app.before_request
def check_origin():
    origin = request.headers.get("Origin", "")

    if origin and origin not in ALLOWED_ORIGINS:
        return jsonify(error="This website origin is not permitted."), 403

    if request.method == "OPTIONS":
        return make_response("", 204)


@app.after_request
def response_headers(response):
    origin = request.headers.get("Origin", "")

    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = (
            "Authorization, Content-Type"
        )
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"

    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"

    return response


def require_admin():
    header = request.headers.get("Authorization", "")

    if not header.startswith("Bearer "):
        raise ConversionError("Please sign in.", 401)

    try:
        claims = auth.verify_id_token(
            header[len("Bearer "):],
            check_revoked=True,
        )
    except Exception:
        raise ConversionError("Your sign-in is invalid or expired.", 401)

    email = str(claims.get("email", "")).lower().strip()

    if claims.get("email_verified") is not True or not email:
        raise ConversionError("A verified administrator login is required.", 403)

    if email != OWNER_EMAIL:
        role = db.collection("user_roles").document(email).get()

        if not role.exists or role.to_dict().get("role") != "admin":
            raise ConversionError("Administrator access is required.", 403)

    return claims["uid"]


def validate_docx(content):
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile:
        raise ConversionError("The file is not a valid DOCX document.")

    with archive:
        entries = archive.infolist()

        if len(entries) > MAX_ZIP_ENTRIES:
            raise ConversionError("The Word document contains too many parts.")

        names = [entry.filename for entry in entries]

        if len(names) != len(set(names)):
            raise ConversionError("The Word document contains duplicate parts.")

        if (
            "[Content_Types].xml" not in names
            or "word/document.xml" not in names
        ):
            raise ConversionError("Select a DOCX Word document, not another ZIP file.")

        expanded = 0

        for entry in entries:
            name = entry.filename
            lower = name.lower()

            if (
                name.startswith("/")
                or "\\" in name
                or ".." in name.split("/")
                or entry.flag_bits & 1
            ):
                raise ConversionError(
                    "Encrypted or unsupported Word document structure."
                )

            expanded += entry.file_size

            if (
                expanded > MAX_EXPANDED_BYTES
                or entry.file_size > 80 * 1024 * 1024
            ):
                raise ConversionError("The expanded Word document is too large.")

            if (
                "vbaproject" in lower
                or lower.startswith("word/embeddings/")
                or lower.endswith((".exe", ".dll", ".com", ".bat", ".js"))
            ):
                raise ConversionError(
                    "Macros and embedded executable/OLE objects are not supported."
                )

        content_types = archive.read("[Content_Types].xml")

        if (
            b"macroenabled" in content_types.lower()
            or b"vbaproject" in content_types.lower()
        ):
            raise ConversionError("Macro-enabled documents are not supported.")

        # Do not let conversion retrieve linked images, templates or data.
        # Ordinary clickable hyperlinks are allowed.
        for name in names:
            if not name.lower().endswith(".rels"):
                continue

            entry = archive.getinfo(name)

            if entry.file_size > 2 * 1024 * 1024:
                raise ConversionError("A document relationship file is too large.")

            try:
                root = ElementTree.fromstring(archive.read(name))
            except Exception:
                raise ConversionError("Invalid Word relationship XML.")

            for relationship in root:
                mode = relationship.attrib.get("TargetMode", "")
                relationship_type = relationship.attrib.get("Type", "")

                if (
                    mode.lower() == "external"
                    and not relationship_type.endswith("/hyperlink")
                ):
                    raise ConversionError(
                        "This document contains an externally linked image, "
                        "template or data resource. Embed that resource in Word "
                        "before uploading."
                    )


def reserve_request(uid):
    reference = db.collection("docx_conversion_private").document(uid)
    transaction = db.transaction()
    now = int(time.time())

    @firestore.transactional
    def reserve(tx):
        snapshot = reference.get(transaction=tx)
        data = snapshot.to_dict() or {}

        start = int(data.get("windowStart", 0))
        count = int(data.get("count", 0))
        previous = int(data.get("lastRequest", 0))

        if now - start >= 3600:
            start = now
            count = 0

        if now - previous < 5:
            raise ConversionError(
                "Wait five seconds before starting another conversion.",
                429,
            )

        if count >= 30:
            raise ConversionError(
                "This account has reached 30 conversions in the current "
                "one-hour window. Try again later.",
                429,
            )

        tx.set(reference, {
            "windowStart": start,
            "lastRequest": now,
            "count": count + 1,
        })

    reserve(transaction)


def convert_file(content):
    with tempfile.TemporaryDirectory(prefix="history-docx-") as temporary:
        root = Path(temporary)
        source = root / "source.docx"
        output = root / "output"
        profile = root / "profile"
        profile_user = profile / "user"

        output.mkdir()
        profile_user.mkdir(parents=True)

        source.write_bytes(content)

        # Separate profile for every request; maximum macro security.
        (profile_user / "registrymodifications.xcu").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<oor:items '
            'xmlns:oor="http://openoffice.org/2001/registry">'
            '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
            '<prop oor:name="MacroSecurityLevel" oor:op="fuse">'
            '<value>3</value>'
            '</prop></item>'
            '</oor:items>',
            encoding="utf-8",
        )

        command = [
            "libreoffice",
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless",
            "--nologo",
            "--nodefault",
            "--nofirststartwizard",
            "--norestore",
            "--convert-to",
            "pdf:writer_pdf_Export",
            "--outdir",
            str(output),
            str(source),
        ]

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )

        try:
            stdout, stderr = process.communicate(timeout=90)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()

            raise ConversionError(
                "Word conversion exceeded 90 seconds. "
                "Try a smaller document or upload a PDF.",
                504,
            )

        converted = output / "source.pdf"

        if process.returncode != 0 or not converted.exists():
            logging.error(
                "LibreOffice conversion failed: returncode=%s stdout=%s stderr=%s",
                process.returncode,
                stdout.decode(errors="replace")[-2000:],
                stderr.decode(errors="replace")[-2000:],
            )

            raise ConversionError(
                "LibreOffice could not convert this document. "
                "It may be protected, damaged or unsupported.",
                422,
            )

        size = converted.stat().st_size

        if size == 0 or size > MAX_PDF_BYTES:
            raise ConversionError(
                "The converted PDF is empty or exceeds 32 MiB.",
                413,
            )

        pdf = converted.read_bytes()

        if not pdf.startswith(b"%PDF-"):
            raise ConversionError("The converter did not produce a valid PDF.", 500)

        return pdf


@app.route("/convert", methods=["POST", "OPTIONS"])
def convert():
    try:
        uid = require_admin()

        uploaded = request.files.get("file")

        if not uploaded:
            raise ConversionError("Select a DOCX file.")

        filename = str(uploaded.filename or "")

        if not re.search(r"[.]docx$", filename, re.IGNORECASE):
            raise ConversionError("Only .docx Word documents are supported.")

        content = uploaded.read(MAX_DOCX_BYTES + 1)

        if not content or len(content) > MAX_DOCX_BYTES:
            raise ConversionError(
                "The DOCX must be non-empty and at most 20 MiB.",
                413,
            )

        validate_docx(content)
        reserve_request(uid)
        pdf = convert_file(content)

        response = make_response(pdf)
        response.headers["Content-Type"] = "application/pdf"
        response.headers["Content-Disposition"] = (
            'attachment; filename="converted.pdf"'
        )

        return response

    except ConversionError as error:
        return jsonify(error=str(error)), error.status
    except Exception:
        logging.exception("DOCX conversion request failed")

        return jsonify(
            error="The conversion service failed. Check its Cloud Run logs."
        ), 500


@app.errorhandler(RequestEntityTooLarge)
def too_large(_error):
    return jsonify(error="The Word upload exceeds 20 MiB."), 413