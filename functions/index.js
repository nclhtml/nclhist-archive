const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
admin.initializeApp();

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