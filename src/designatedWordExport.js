import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

import {
    Document,
    Packer,
    Paragraph,
    ImageRun,
    SectionType,
    HorizontalPositionRelativeFrom,
    VerticalPositionRelativeFrom,
    TextWrappingType
} from 'docx';

import JSZip from 'jszip';

import { auth } from './firebase.js';
import { loadAccessibleArchives } from './archiveAccessClient.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_PAGES_PER_PDF = 60;
const MAX_ZIP_PAGES = 240;
const MAX_IMAGE_BYTES = 240 * 1024 * 1024;
const MAX_PIXELS_PER_PAGE = 24000000;

export function safeExportName(value) {
    return String(value || 'Untitled')
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
        .replace(/[. ]+$/g, '')
        .slice(0, 100) || 'Untitled';
}

export function saveExportBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = name;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function readPdf(url) {
    let response;

    if (url.startsWith('/archive-pdf?')) {
        const user = auth.currentUser;

        if (!user) throw new Error('Please sign in again.');

        const source = new URLSearchParams(
            url.slice(url.indexOf('?') + 1)
        );

        const parameters = new URLSearchParams({
            bucket: source.get('bucket') || '',
            path: source.get('path') || ''
        });

        const token = await user.getIdToken();

        response = await fetch(
            'https://us-central1-nclhist.cloudfunctions.net/' +
            `archiveVersionPdf?${parameters.toString()}`,
            {
                headers: { Authorization: `Bearer ${token}` }
            }
        );
    } else {
        response = await fetch(url);
    }

    if (!response.ok) {
        throw new Error(`PDF request failed (${response.status}).`);
    }

    const blob = await response.blob();

    if (!blob.size || blob.size > MAX_PDF_BYTES) {
        throw new Error('PDF must be non-empty and at most 32 MiB for Word export.');
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());

    const signature = new TextDecoder().decode(bytes.slice(0, 1024));

    if (!signature.includes('%PDF-')) {
        throw new Error('The attachment did not return a PDF.');
    }

    return bytes;
}

function canvasPng(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Could not encode a PDF page as PNG.'));
        }, 'image/png');
    });
}

export async function makeAppearanceDocx(
    url,
    onProgress = () => { },
    budget = { pages: 0, bytes: 0 }
) {
    const bytes = await readPdf(url);

    const task = pdfjs.getDocument({
        data: bytes,
        isEvalSupported: false,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@3.4.120/cmaps/',
        cMapPacked: true,
        standardFontDataUrl:
            'https://unpkg.com/pdfjs-dist@3.4.120/standard_fonts/'
    });

    let pdf;

    try {
        pdf = await task.promise;

        if (pdf.numPages > MAX_PAGES_PER_PDF) {
            throw new Error(
                `This PDF has ${pdf.numPages} pages. ` +
                `The current Word-export limit is ${MAX_PAGES_PER_PDF} pages per PDF.`
            );
        }

        if (budget.pages + pdf.numPages > MAX_ZIP_PAGES) {
            throw new Error(
                `This export exceeds the ${MAX_ZIP_PAGES}-page safety limit.`
            );
        }

        budget.pages += pdf.numPages;

        const sections = [];

        for (let number = 1; number <= pdf.numPages; number++) {
            onProgress(`Rendering PDF page ${number} / ${pdf.numPages}`);

            const page = await pdf.getPage(number);
            const base = page.getViewport({ scale: 1 });

            // Word's supported paper-size range is narrower than arbitrary PDF.
            // Reject oversize pages rather than silently rescaling the document.
            if (
                base.width > 1584 ||
                base.height > 1584 ||
                base.width < 36 ||
                base.height < 36
            ) {
                throw new Error(
                    `Page ${number} has a page size outside this Word export's supported range.`
                );
            }

            const desiredScale = 300 / 72;

            const scale = Math.min(
                desiredScale,
                Math.sqrt(
                    MAX_PIXELS_PER_PAGE / (base.width * base.height)
                )
            );

            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');

            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);

            try {
                const context = canvas.getContext('2d', { alpha: false });

                if (!context) {
                    throw new Error('This browser could not create a PDF rendering canvas.');
                }

                await page.render({
                    canvasContext: context,
                    viewport,
                    background: 'rgb(255,255,255)'
                }).promise;

                const png = await canvasPng(canvas);

                budget.bytes += png.size;

                if (budget.bytes > MAX_IMAGE_BYTES) {
                    throw new Error(
                        'The rendered images exceed the export memory safety limit. ' +
                        'Export fewer documents at a time.'
                    );
                }

                const imageData = new Uint8Array(await png.arrayBuffer());

                const image = new ImageRun({
                    type: 'png',
                    data: imageData,
                    transformation: {
                        width: base.width * 96 / 72,
                        height: base.height * 96 / 72
                    },
                    floating: {
                        horizontalPosition: {
                            relative: HorizontalPositionRelativeFrom.PAGE,
                            offset: 0
                        },
                        verticalPosition: {
                            relative: VerticalPositionRelativeFrom.PAGE,
                            offset: 0
                        },
                        wrap: { type: TextWrappingType.NONE },
                        allowOverlap: true,
                        behindDocument: true,
                        lockAnchor: true,
                        layoutInCell: false,
                        margins: {
                            top: 0,
                            bottom: 0,
                            left: 0,
                            right: 0
                        }
                    }
                });

                sections.push({
                    properties: {
                        type: SectionType.NEXT_PAGE,
                        page: {
                            size: {
                                width: Math.round(base.width * 20),
                                height: Math.round(base.height * 20)
                            },
                            margin: {
                                top: 0,
                                bottom: 0,
                                left: 0,
                                right: 0,
                                header: 0,
                                footer: 0,
                                gutter: 0
                            }
                        }
                    },
                    children: [
                        new Paragraph({
                            children: [image],
                            spacing: {
                                before: 0,
                                after: 0
                            }
                        })
                    ]
                });
            } finally {
                canvas.width = 1;
                canvas.height = 1;
                page.cleanup();
            }

            // Let the browser repaint the progress message.
            await new Promise(resolve => window.setTimeout(resolve, 0));
        }

        onProgress('Assembling Word document...');

        return await Packer.toBlob(new Document({
            title: 'PDF appearance-preserving export',
            description:
                'Image-based Word document. Each PDF page is preserved as a page image.',
            sections
        }));
    } finally {
        if (pdf) await pdf.destroy();
        else await task.destroy();
    }
}

export async function downloadAppearanceDocx(url, name, onProgress) {
    const blob = await makeAppearanceDocx(url, onProgress);

    saveExportBlob(blob, `${safeExportName(name)}.docx`);
}

export function resolveDesignatedLink(archives, link) {
    const parent = archives.find(item => item.id === link);

    if (parent) return { parent, child: null };

    for (const archive of archives) {
        const child = (archive.subQuestions || []).find(
            item => `${archive.id}_${item.id}` === link
        );

        if (child) return { parent: archive, child };
    }

    return null;
}

export async function downloadDesignatedCategoryZip({
    snapshot,
    bucket,
    label,
    email,
    onProgress = () => { }
}) {
    const archives = await loadAccessibleArchives({
        effectiveEmail: email
    });

    const zip = new JSZip();
    const assignment = zip.folder('Assignment');
    const quiz = zip.folder('Quiz');

    assignment.folder('CMI');
    assignment.folder('EMI');

    const reports = [];
    const budget = { pages: 0, bytes: 0 };

    const number = value => String(value).padStart(3, '0');

    const addDocument = async (folder, item, language) => {
        const resolved = resolveDesignatedLink(
            archives,
            item.linkedDocId
        );

        const languageName = language === 'zh' ? 'Chinese' : 'English';

        if (!resolved) {
            const reason = `${item.name}: no available linked archive document.`;

            folder.file(`MISSING-${languageName}.txt`, reason);
            reports.push(reason);
            return;
        }

        const url = language === 'zh'
            ? resolved.parent.fileUrlChi
            : resolved.parent.fileUrl;

        if (!url) {
            const reason =
                `${item.name}: ${languageName} PDF is not attached.`;

            folder.file(`MISSING-${languageName}.txt`, reason);
            reports.push(reason);
            return;
        }

        if (resolved.child) {
            folder.file(
                'QUESTION-PART-LINK.txt',
                `Linked part: ${resolved.child.label}\n` +
                'The Word file contains the parent question-set PDF. ' +
                'It is not a newly extracted PDF of only that part.'
            );
        }

        onProgress(`Converting ${item.name} — ${languageName}`);

        // A failed conversion aborts the ZIP rather than silently producing
        // an archive that looks complete but is missing a converted document.
        const blob = await makeAppearanceDocx(
            url,
            message => onProgress(`${item.name}: ${message}`),
            budget
        );

        folder.file(
            `${languageName}.docx`,
            new Uint8Array(await blob.arrayBuffer())
        );
    };

    for (const [category, root] of [
        ['Assignments', assignment],
        ['Quizzes', quiz]
    ]) {
        const common = snapshot.common
            .filter(item =>
                item.bucket === bucket &&
                item.category === category
            )
            .sort((a, b) =>
                Number(a.order) - Number(b.order) ||
                a.id.localeCompare(b.id)
            );

        let quizIndex = 0;

        for (let index = 0; index < common.length; index++) {
            const item = common[index];

            const folder = root.folder(
                `${number(category === 'Quizzes' ? ++quizIndex : index + 1)}` +
                ` - ${safeExportName(item.name)}`
            );

            const copies = (snapshot.boundCopies || []).filter(
                record => record.commonId === item.id
            );

            if (!copies.length) {
                await addDocument(folder, item, 'zh');
                await addDocument(folder, item, 'en');
                continue;
            }

            // Bound class assessments may use different documents from the
            // common reference. Export their actual links and retained names.
            for (const className of snapshot.classes) {
                const copy = copies.find(
                    record => record.className === className
                );

                if (!copy) continue;

                const language = snapshot.languages[className];

                const languageLabel = language === 'zh'
                    ? 'CMI'
                    : language === 'en'
                        ? 'EMI'
                        : 'Language not selected';

                const copyFolder = folder.folder(
                    `${languageLabel} - ${safeExportName(className)} - ` +
                    safeExportName(copy.name)
                );

                if (!['zh', 'en'].includes(language)) {
                    const reason =
                        `${className}: the designated PDF language has not been selected.`;

                    copyFolder.file('MISSING-LANGUAGE-SETTING.txt', reason);
                    reports.push(reason);
                    continue;
                }

                await addDocument(copyFolder, copy, language);
            }
        }

        for (const className of snapshot.classes) {
            const language = snapshot.languages[className];
            const role = language === 'zh'
                ? 'CMI'
                : language === 'en'
                    ? 'EMI'
                    : safeExportName(className);

            const sameLanguageClasses = snapshot.classes.filter(
                name => snapshot.languages[name] === language
            );

            const classFolder = sameLanguageClasses.length > 1
                ? `${role} - ${safeExportName(className)}`
                : role;

            const incoming = snapshot.records
                .filter(item =>
                    item.bucket === bucket &&
                    item.category === category &&
                    item.className === className
                )
                .sort((a, b) =>
                    a.order - b.order || a.key.localeCompare(b.key)
                );

            for (let index = 0; index < incoming.length; index++) {
                const item = incoming[index];

                const folder = category === 'Assignments'
                    ? root.folder(classFolder).folder(
                        `${number(index + 1)} - ${safeExportName(item.name)}`
                    )
                    : root.folder(
                        `${number(++quizIndex)} - ${role} - ` +
                        safeExportName(item.name)
                    );

                if (!['zh', 'en'].includes(language)) {
                    const reason =
                        `${className}: the designated PDF language has not been selected.`;

                    folder.file('MISSING-LANGUAGE-SETTING.txt', reason);
                    reports.push(reason);
                    continue;
                }

                await addDocument(folder, item, language);
            }
        }
    }

    zip.file(
        'EXPORT-README.txt',
        'Word files are image-based, appearance-preserving PDF exports.\n' +
        'Question text is not editable Word text.\n' +
        'PNG page images are rendered at up to 300 DPI.\n' +
        'Number prefixes preserve the website ordering.\n\n' +
        (reports.length
            ? 'Missing attachments/settings:\n' + reports.join('\n')
            : 'No missing attachments were detected.')
    );

    onProgress('Building ZIP...');

    const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'STORE'
    });

    saveExportBlob(
        blob,
        `${safeExportName(snapshot.level + ' - ' + label)}.zip`
    );

    return reports;
}