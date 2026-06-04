const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
admin.initializeApp();

const { PDFDocument, rgb, degrees } = require("pdf-lib");
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
                                            <p>Please be advised that the revision materials in the History Archive have been updated. <strong>Tier ${tierId}</strong> resources are now unlocked and fully accessible for your cohort (${role}).</p>
                                            <p>You may log in to the platform at your earliest convenience to review the latest past papers and practice questions to aid in your studies.</p>
                                            <p>We wish you the absolute best of luck with your upcoming Unit Tests and Examinations.</p>
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
        res.set('Access-Control-Allow-Headers', 'Content-Type');
        res.set('Access-Control-Max-Age', '3600');
        return res.status(204).send('');
    }

    try {
        const { fileUrl, email } = req.query;
        if (!fileUrl) return res.status(400).send('Missing fileUrl');

        // 1. Fetch the raw PDF from Firebase Storage URL
        const pdfResponse = await fetch(fileUrl);
        if (!pdfResponse.ok) throw new Error('Failed to fetch PDF');
        const pdfBuffer = await pdfResponse.arrayBuffer();

        // 2. Load into pdf-lib
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const pages = pdfDoc.getPages();

        // 3. Draw Watermark on every page
        const watermarkText = `Downloaded by: ${email || 'Viewer'}`;
        pages.forEach(page => {
            const { width, height } = page.getSize();
            page.drawText(watermarkText, {
                x: width / 4,
                y: height / 2,
                size: 35,
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