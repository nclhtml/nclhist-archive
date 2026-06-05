const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
admin.initializeApp();

const { PDFDocument, rgb, degrees, StandardFonts } = require("pdf-lib");
const fetch = require("node-fetch");

const db = admin.firestore();

// This runs every 5 minutes automatically
exports.checkTierUnlocksAndEmail = functions.pubsub.schedule("every 5 minutes").onRun(async () => {
    try {
        // 1. Get current time in Hong Kong timezone (YYYY-MM-DDTHH:mm)
        const hkTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
        const nowStr = new Date(hkTime.getTime() - (hkTime.getTimezoneOffset() * 60000)).toISOString().substring(0, 16);

        // 2. Fetch the system settings
        const configRef = db.collection("system_settings").doc("config");
        const configSnap = await configRef.get();

        if (!configSnap.exists) return null;
        const configData = configSnap.data();
        const tierAccess = configData.tierAccess || {};

        let updatesToSave = {}; // To track which tiers we mark as 'emailSent: true'

        // 3. Loop through roles and tiers
        for (const role in tierAccess) {
            for (const tierId in tierAccess[role]) {
                const rule = tierAccess[role][tierId];

                // Check if date is set, date has passed, and email hasn't been sent yet
                if (rule.date && rule.date <= nowStr && !rule.emailSent && !rule.immediate) {

                    // --- NEW: Fetch ALL assessments to find linked documents ---
                    const assessmentsSnap = await db.collection("assessments").get();
                    const linkedDocIds = new Set();
                    assessmentsSnap.forEach(doc => {
                        const data = doc.data();
                        // Split by '_' to ensure we block the parent document even if only a sub-question is linked
                        if (data.linkedDocId) linkedDocIds.add(data.linkedDocId.split('_')[0]);
                        if (data.sectionsConfig) {
                            data.sectionsConfig.forEach(sec => {
                                if (sec.linkedDocId) linkedDocIds.add(sec.linkedDocId.split('_')[0]);
                            });
                        }
                    });

                    // Fetch ALL archives, filter for unlocked cumulative tiers, and exclude linked docs
                    const archivesSnap = await db.collection("archives").get();
                    let extraPracticesHtml = "<ul>";
                    let addedCount = 0;
                    const unlockedTierNum = parseInt(tierId, 10);

                    archivesSnap.forEach(archiveDoc => {
                        const archiveData = archiveDoc.data();
                        const archiveTierNum = parseInt(archiveData.tier || '10', 10);

                        // Extra Practice = Tier < 10, unlocked by current tier, and NOT linked to any dashboard assessment
                        if (archiveTierNum <= unlockedTierNum && archiveTierNum < 10) {
                            if (!linkedDocIds.has(archiveDoc.id)) {
                                extraPracticesHtml += `<li>${archiveData.year} ${archiveData.origin} - <strong>${archiveData.title}</strong></li>`;
                                addedCount++;
                            }
                        }
                    });
                    extraPracticesHtml += "</ul>";

                    if (addedCount === 0) {
                        extraPracticesHtml = "<p><em>There are no new updates on extra practices at this moment.</em></p>";
                    }
                    // --- END NEW ---

                    // 4. Fetch all users belonging to this role
                    const usersSnap = await db.collection("user_roles").where("role", "==", role).get();

                    if (!usersSnap.empty) {
                        const batch = db.batch(); // Process database writes in bulk

                        // 5. Queue an email for each user
                        usersSnap.forEach((userDoc) => {
                            const userEmail = userDoc.data().email;

                            // Create a new document in the 'mail' collection
                            const mailRef = db.collection("mail").doc();
                            batch.set(mailRef, {
                                to: userEmail,
                                message: {
                                    subject: `Notification: Revision Materials Updated (Tier ${tierId})`,
                                    html: `
                                        <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                                            <p>Dear Student,</p>
                                            <p>Please be advised that your <strong>student dashboard and revision materials</strong> in the History Archive have been updated.</p>
                                            
                                            <p><strong>Newly Added Extra Practices:</strong></p>
                                            ${extraPracticesHtml}
                                            <p><em>(Note: You can find these in the search engine labelled as [Extra Practice]).</em></p>

                                            <p>Please log in to the platform using your current email account at your earliest convenience to review the latest past papers and practice questions to aid in your studies:</p>
                                            <p><a href="https://nclhist.netlify.app" style="color: #2563eb; font-weight: bold;">https://nclhist.netlify.app</a></p>
                                            
                                            <p>We wish you the absolute best of luck with your upcoming Uniform Tests/Examinations.</p>
                                            <br>
                                            <p>Best regards,</p>
                                            <p><strong>The History Archive Team</strong></p>
                                        </div>
                                    `
                                }
                            });
                        });

                        await batch.commit(); // Execute all email drops
                    }

                    // 6. Queue the update to mark this tier's email as sent
                    updatesToSave[`tierAccess.${role}.${tierId}.emailSent`] = true;
                }
            }
        }

        // 7. Update the config document so we don't send these emails again
        if (Object.keys(updatesToSave).length > 0) {
            await configRef.update(updatesToSave);
            console.log("Successfully sent emails and updated config:", updatesToSave);
        }

        return null;
    } catch (error) {
        console.error("Error in checkTierUnlocksAndEmail:", error);
        return null;
    }
});

// --- ADD THIS NEW FUNCTION AT THE BOTTOM ---
exports.getWatermarkedPdf = functions.https.onRequest(async (req, res) => {
    // Enable CORS for your React app
    res.set('Access-Control-Allow-Origin', '*');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Access-Control-Max-Age', '3600');
        return res.status(204).send('');
    }

    try {
        const { fileUrl, email } = req.query;
        if (!fileUrl) return res.status(400).send('Missing fileUrl');

        // 1. Fetch the raw PDF from Firebase Storage URL
        if (!fileUrl) return res.status(400).send('Missing fileUrl');

        // 1. Fetch the raw PDF from Firebase Storage URL
        const pdfResponse = await fetch(fileUrl);
        if (!pdfResponse.ok) throw new Error('Failed to fetch PDF');
        const pdfBuffer = await pdfResponse.arrayBuffer();
        // 2. Load into pdf-lib
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const pages = pdfDoc.getPages();

        // --- NEW: Embed font to measure text width ---
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const watermarkText = `Downloaded by: ${email || 'Viewer'}`;
        const textSize = 35;

        // Measure the exact width and height of the text
        const textWidth = helveticaFont.widthOfTextAtSize(watermarkText, textSize);
        const textHeight = helveticaFont.heightAtSize(textSize);

        // 3. Draw Watermark perfectly centered on every page
        pages.forEach(page => {
            const { width, height } = page.getSize();

            // Math to perfectly center rotated text
            const angleInRadians = 45 * (Math.PI / 180);
            const startX = (width / 2) - ((textWidth / 2) * Math.cos(angleInRadians)) + ((textHeight / 2) * Math.sin(angleInRadians));
            const startY = (height / 2) - ((textWidth / 2) * Math.sin(angleInRadians)) - ((textHeight / 2) * Math.cos(angleInRadians));

            page.drawText(watermarkText, {
                x: startX,
                y: startY,
                size: textSize,
                font: helveticaFont,
                color: rgb(0.7, 0.7, 0.7),
                opacity: 0.4,
                rotate: degrees(45),
            });
        });

        // 4. Send the watermarked PDF back to the client
        const watermarkedBytes = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="watermarked_document.pdf"');
        res.send(Buffer.from(watermarkedBytes));

    } catch (error) {
        console.error("Watermarking error:", error);
        res.status(500).send('Error generating watermarked PDF');
    }
});