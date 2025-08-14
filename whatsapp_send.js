const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

// Create WhatsApp Client
let whatsappClient = null;
let sessionState = {
    status: "disconnected",
    isReady: false,
};

// Initialize WhatsApp Client
const initializeWhatsApp = () => {
    return new Promise((resolve, reject) => {
        whatsappClient = new Client({
            authStrategy: new LocalAuth({ clientId: "whatsapp-bulk-sender" }),
            puppeteer: {
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--no-first-run",
                    "--no-zygote",
                    "--single-process",
                    "--disable-gpu",
                ],
            },
        });

        // Handle QR Code generation
        whatsappClient.on("qr", async (qr) => {
            try {
                console.log("Generating QR Code...");

                // Generate QR code as PNG and save to root folder
                const qrCodeDataURL = await require("qrcode").toDataURL(qr);
                const base64Data = qrCodeDataURL.replace(
                    /^data:image\/png;base64,/,
                    ""
                );

                // Save QR code image to root folder
                const qrCodePath = path.join(__dirname, "whatsapp_qr.png");
                fs.writeFileSync(qrCodePath, base64Data, "base64");

                console.log("✅ QR Code saved as whatsapp_qr.png");
                console.log(
                    "📱 Please scan the QR code with your WhatsApp mobile app"
                );
                console.log("⏳ Waiting for WhatsApp connection...");

                sessionState.status = "waiting_for_scan";
            } catch (error) {
                console.error("❌ QR Code generation error:", error);
                reject(error);
            }
        });

        // Client ready event
        whatsappClient.on("ready", () => {
            sessionState.status = "connected";
            sessionState.isReady = true;
            console.log("✅ WhatsApp Client is ready and connected!");
            resolve();
        });

        // Handle authentication success
        whatsappClient.on("authenticated", () => {
            console.log("✅ WhatsApp authenticated successfully");
        });

        // Handle disconnection
        whatsappClient.on("disconnected", (reason) => {
            sessionState.status = "disconnected";
            sessionState.isReady = false;
            console.log("❌ WhatsApp disconnected:", reason);
        });

        // Handle authentication failure
        whatsappClient.on("auth_failure", (msg) => {
            console.error("❌ Authentication failed:", msg);
            reject(new Error("Authentication failed"));
        });

        // Initialize the client
        console.log("🚀 Initializing WhatsApp client...");
        whatsappClient.initialize().catch(reject);
    });
};

// Send message to a single contact
const sendMessageToContact = async (phoneNumber, message) => {
    try {
        if (!whatsappClient || !sessionState.isReady) {
            throw new Error("WhatsApp client is not ready");
        }

        // Clean and validate phone number (assuming Indian numbers)
        const cleanNumber = phoneNumber.toString().replace(/\D/g, "");

        if (cleanNumber.length < 10) {
            throw new Error(`Invalid phone number: ${phoneNumber}`);
        }

        // Format for WhatsApp (Indian format: 91xxxxxxxxxx@c.us)
        let formattedNumber = cleanNumber;
        if (cleanNumber.length === 10) {
            formattedNumber = `91${cleanNumber}`;
        }

        const chatId = `${formattedNumber}@c.us`;

        console.log(`📤 Sending message to: +${formattedNumber}`);

        // Send the message
        await whatsappClient.sendMessage(chatId, message);
        console.log(`✅ Message sent successfully to +${formattedNumber}`);

        return { success: true, number: formattedNumber };
    } catch (error) {
        console.error(
            `❌ Failed to send message to ${phoneNumber}:`,
            error.message
        );
        return { success: false, number: phoneNumber, error: error.message };
    }
};

// Main function to send bulk messages
const sendBulkMessages = async (contacts, customMessage = null) => {
    try {
        if (!whatsappClient || !sessionState.isReady) {
            console.error(
                "❌ WhatsApp client is not connected. Please initialize first."
            );
            return;
        }

        if (!contacts || contacts.length === 0) {
            console.error("❌ No contacts provided");
            return;
        }

        console.log(
            `📋 Starting bulk message sending to ${contacts.length} contacts...`
        );
        console.log(`⏱️  Delay between messages: 20 seconds\n`);

        const results = [];

        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const messageToSend =
                customMessage || contact.message || "Hello from WhatsApp!";

            console.log(`\n📍 Processing contact ${i + 1}/${contacts.length}`);

            const result = await sendMessageToContact(
                contact.phoneNo,
                messageToSend
            );
            results.push(result);

            // Wait 20 seconds before next message (except for the last message)
            if (i < contacts.length - 1) {
                console.log("⏳ Waiting 20 seconds before next message...");
                await new Promise((resolve) => setTimeout(resolve, 20000));
            }
        }

        // Summary
        console.log("\n📊 BULK MESSAGING SUMMARY:");
        console.log("================================");
        const successful = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        console.log(`✅ Successful: ${successful}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`📱 Total: ${results.length}`);

        if (failed > 0) {
            console.log("\n❌ Failed numbers:");
            results
                .filter((r) => !r.success)
                .forEach((r) => {
                    console.log(`   ${r.number}: ${r.error}`);
                });
        }
    } catch (error) {
        console.error("❌ Error in bulk messaging:", error);
    }
};

// Main execution function
const main = async () => {
    try {
        // Initialize WhatsApp
        await initializeWhatsApp();

        // Example contacts array
        // const contacts = [
        //     {
        //         phoneNo: "9876543210",
        //         message: "Hello! This is a test message.",
        //     },
        //     { phoneNo: "9123456789", message: "Hi there! How are you today?" },
        //     {
        //         phoneNo: "9988776655",
        //         message: "Custom message for this contact",
        //     },
        // ];

        // Send bulk messages
        // await sendBulkMessages(contacts);

        // Example contacts array
        const contacts = [{ phoneNo: "9712856834" }, { phoneNo: "9099792917" }];

        // Optional: Send same message to all contacts
        await sendBulkMessages(contacts, "Same message for everyone!");
    } catch (error) {
        console.error("❌ Main execution error:", error);
    }
};

// Export functions for use in other files
module.exports = {
    initializeWhatsApp,
    sendBulkMessages,
    sendMessageToContact,
};

// Run if this file is executed directly
// if (require.main === module) {
//     main();
// }
