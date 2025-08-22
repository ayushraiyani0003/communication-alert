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

// Get all available groups
const getAllGroups = async () => {
    try {
        if (!whatsappClient || !sessionState.isReady) {
            throw new Error("WhatsApp client is not ready");
        }

        const chats = await whatsappClient.getChats();
        const groups = chats.filter((chat) => chat.isGroup);

        console.log("📋 Available Groups:");
        console.log("====================");
        groups.forEach((group, index) => {
            console.log(
                `${index + 1}. Name: "${group.name}" | ID: ${
                    group.id._serialized
                }`
            );
        });

        return groups;
    } catch (error) {
        console.error("❌ Error getting groups:", error);
        return [];
    }
};

// Find group by name
const findGroupByName = async (groupName) => {
    try {
        if (!whatsappClient || !sessionState.isReady) {
            throw new Error("WhatsApp client is not ready");
        }

        const chats = await whatsappClient.getChats();
        const group = chats.find(
            (chat) =>
                chat.isGroup &&
                chat.name.toLowerCase().includes(groupName.toLowerCase())
        );

        if (group) {
            console.log(
                `✅ Found group: "${group.name}" | ID: ${group.id._serialized}`
            );
            return group;
        } else {
            console.log(
                `❌ Group with name containing "${groupName}" not found`
            );
            return null;
        }
    } catch (error) {
        console.error("❌ Error finding group:", error);
        return null;
    }
};

// Send message to a group by name
const sendMessageToGroup = async (groupName, message) => {
    try {
        if (!whatsappClient || !sessionState.isReady) {
            throw new Error("WhatsApp client is not ready");
        }

        // Find the group
        const group = await findGroupByName(groupName);
        if (!group) {
            throw new Error(`Group "${groupName}" not found`);
        }

        console.log(`📤 Sending message to group: "${group.name}"`);

        // Send the message
        await whatsappClient.sendMessage(group.id._serialized, message);
        console.log(`✅ Message sent successfully to group: "${group.name}"`);

        return {
            success: true,
            groupName: group.name,
            groupId: group.id._serialized,
        };
    } catch (error) {
        console.error(
            `❌ Failed to send message to group "${groupName}":`,
            error.message
        );
        return { success: false, groupName, error: error.message };
    }
};

// Send message to a group by ID
const sendMessageToGroupById = async (groupId, message) => {
    try {
        if (!whatsappClient || !sessionState.isReady) {
            throw new Error("WhatsApp client is not ready");
        }

        console.log(`📤 Sending message to group ID: ${groupId}`);

        // Send the message
        await whatsappClient.sendMessage(groupId, message);
        console.log(`✅ Message sent successfully to group ID: ${groupId}`);

        return { success: true, groupId };
    } catch (error) {
        console.error(
            `❌ Failed to send message to group ID "${groupId}":`,
            error.message
        );
        return { success: false, groupId, error: error.message };
    }
};

// Send messages to multiple groups
const sendBulkGroupMessages = async (groups, message) => {
    try {
        if (!whatsappClient || !sessionState.isReady) {
            console.error(
                "❌ WhatsApp client is not connected. Please initialize first."
            );
            return;
        }

        if (!groups || groups.length === 0) {
            console.error("❌ No groups provided");
            return;
        }

        console.log(
            `📋 Starting bulk message sending to ${groups.length} groups...`
        );
        console.log(`⏱️  Delay between messages: 10 seconds\n`);

        const results = [];

        for (let i = 0; i < groups.length; i++) {
            const groupName = groups[i];

            console.log(
                `\n📍 Processing group ${i + 1}/${
                    groups.length
                }: "${groupName}"`
            );

            const result = await sendMessageToGroup(groupName, message);
            results.push(result);

            // Wait 10 seconds before next message (except for the last message)
            if (i < groups.length - 1) {
                console.log("⏳ Waiting 10 seconds before next message...");
                await new Promise((resolve) => setTimeout(resolve, 10000));
            }
        }

        // Summary
        console.log("\n📊 BULK GROUP MESSAGING SUMMARY:");
        console.log("==================================");
        const successful = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        console.log(`✅ Successful: ${successful}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`📱 Total: ${results.length}`);

        if (failed > 0) {
            console.log("\n❌ Failed groups:");
            results
                .filter((r) => !r.success)
                .forEach((r) => {
                    console.log(`   "${r.groupName}": ${r.error}`);
                });
        }

        return results;
    } catch (error) {
        console.error("❌ Error in bulk group messaging:", error);
    }
};

// Send message to a single contact (keeping original function)
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

// Main function to send bulk messages to contacts (keeping original function)
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

        // Wait a moment for connection to stabilize
        console.log("⏳ Waiting for connection to stabilize...");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Get all available groups (optional - to see what groups are available)
        await getAllGroups();

        // Example 1: Send message to a specific group by name
        // const groupMessage =
        //     "Hello everyone! This is a test message from the bot.";
        // await sendMessageToGroup("NCU Updates", groupMessage);

        // Example 2: Send message to multiple groups
        // const groupNames = ["NCU Updates", "another group", "test group"];
        // await sendBulkGroupMessages(groupNames, "Same message for all groups!");

        // Example 3: Send message to group by exact ID (if you know the group ID)
        // await sendMessageToGroupById("120363123456789012@g.us", "Message by group ID");
    } catch (error) {
        console.error("❌ Main execution error:", error);
    }
};

// Export functions for use in other files
module.exports = {
    initializeWhatsApp,
    sendBulkMessages,
    sendMessageToContact,
    sendMessageToGroup,
    sendMessageToGroupById,
    sendBulkGroupMessages,
    getAllGroups,
    findGroupByName,
    whatsappClient,
    sessionState,
};

// Run if this file is executed directly
if (require.main === module) {
    main();
}
