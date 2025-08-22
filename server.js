// Import necessary modules
const mqtt = require("mqtt");
const moment = require("moment-timezone");
const fs = require("fs-extra");
const path = require("path");
const {
    sendBulkMessages,
    initializeWhatsApp,
    sendMessageToGroup,
    sendBulkGroupMessages,
} = require("./whatsapp_send"); // Update with correct path to your WhatsApp script

// MQTT connection details
const host = "mqtt.sunchaser.cloud";
const username = "iotapp";
const password = "iot@0987";

// Topics to subscribe
const topics = [
    "jsm-pub/rabarika_2172-B/STATUS",
    "jsm-pub/rabarika_2172-A/STATUS",
    "jsm-pub/bhojabedi-2240/STATUS",
];

// WhatsApp configuration
const WHATSAPP_CONFIG = {
    // Groups to send messages to
    alertGroups: ["NCU Updates"], // Add your group names here

    // Individual contacts for critical alerts
    emergencyContacts: [],

    // Message preferences
    useGroups: true, // Set to false to use individual contacts only
    sendToEmergencyContacts: false, // Always send to emergency contacts for critical alerts
};

// Project and NCU configuration
const projectConfig = {
    rabarika: {
        "2172-B": {
            totalTCUs: 60,
            expectedTCUs: [], // Will be populated automatically based on received messages
        },
        "2172-A": {
            totalTCUs: 61,
            expectedTCUs: [],
        },
    },
    bhojabedi: {
        2240: {
            totalTCUs: 33,
            expectedTCUs: [
                48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
                64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
                80,
            ],
        },
    },
};

// Track last received times
const lastReceived = {};
const TIMEOUT_MINUTES = 30; // 30 Minutes
const CHECK_INTERVAL = 10; // 10 Minutes
const MQTT_TIMEZONE = "Asia/Kolkata"; // Indian timezone for MQTT messages
const LOG_TIMEZONE = "UTC"; // Timezone for log files

// Create logs directory
const logsDir = path.join(__dirname, "logs");
fs.ensureDirSync(logsDir);

// Initialize tracking structure
function initializeTracking() {
    for (const project in projectConfig) {
        lastReceived[project] = {};
        for (const ncu in projectConfig[project]) {
            lastReceived[project][ncu] = {};
        }
    }
}

// Parse topic to extract project and NCU
function parseTopicInfo(topic) {
    const parts = topic.split("/");
    if (parts.length < 2) return null;

    const fullName = parts[1]; // e.g., rabarika_2172-B or bhojabedi-2240
    if (fullName.includes("_")) {
        const lastUnderscore = fullName.lastIndexOf("_");
        const project = fullName.substring(0, lastUnderscore);
        const ncu = fullName.substring(lastUnderscore + 1);
        return { project, ncu };
    } else if (fullName.includes("-")) {
        const lastDash = fullName.lastIndexOf("-");
        const project = fullName.substring(0, lastDash);
        const ncu = fullName.substring(lastDash + 1);
        return { project, ncu };
    }

    return null;
}

// Parse TCU message
function parseTCUMessage(message) {
    const msgStr = message.toString().trim();
    if (!msgStr.startsWith("#M1,")) return null;

    const parts = msgStr.split(",");
    if (parts.length < 3) return null;

    const tcuNumber = parts[1].trim();
    if (!tcuNumber.match(/^\d+$/)) return null;

    return {
        tcuNumber: parseInt(tcuNumber),
        rawMessage: msgStr,
        timestamp: moment().tz(MQTT_TIMEZONE),
    };
}

// Write to log file
function writeToLog(filename, data) {
    const logFile = path.join(logsDir, filename);
    const timestamp = moment()
        .tz(LOG_TIMEZONE)
        .format("YYYY-MM-DD HH:mm:ss UTC");
    const logEntry = `[${timestamp}] ${data}\n`;

    fs.appendFileSync(logFile, logEntry);
}

// Log TCU communication
function logTCUCommunication(project, ncu, tcuNumber, timestamp) {
    const filename = `${project}_${ncu}_communications.log`;
    const timeStr = timestamp
        .tz(LOG_TIMEZONE)
        .format("YYYY-MM-DD HH:mm:ss UTC");
    const data = `TCU-${tcuNumber} communication received at ${timeStr}`;

    writeToLog(filename, data);
}

// Send WhatsApp notification (supports both groups and individual contacts)
async function sendWhatsAppNotification(message, isEmergency = false) {
    try {
        const promises = [];

        // Send to groups if enabled
        if (
            WHATSAPP_CONFIG.useGroups &&
            WHATSAPP_CONFIG.alertGroups.length > 0
        ) {
            console.log("📱 Sending to WhatsApp groups...");
            promises.push(
                sendBulkGroupMessages(WHATSAPP_CONFIG.alertGroups, message)
            );
        }

        // Send to emergency contacts for critical alerts or if groups are disabled
        if (
            isEmergency ||
            WHATSAPP_CONFIG.sendToEmergencyContacts ||
            !WHATSAPP_CONFIG.useGroups
        ) {
            if (WHATSAPP_CONFIG.emergencyContacts.length > 0) {
                console.log("📱 Sending to emergency contacts...");
                promises.push(
                    sendBulkMessages(WHATSAPP_CONFIG.emergencyContacts, message)
                );
            }
        }

        // Wait for all messages to be sent
        await Promise.all(promises);
        console.log("✅ WhatsApp notifications sent successfully");
    } catch (error) {
        console.error("❌ Error sending WhatsApp notification:", error);
        // Log the error but don't stop the monitoring
        writeToLog(
            "whatsapp_errors.log",
            `Failed to send WhatsApp notification: ${error.message}`
        );
    }
}

// Log inactive TCUs and send message to WhatsApp
async function logInactiveTCUs() {
    if (isWithinInactiveTimeWindow()) {
        console.log(
            "❌ Inactivity checks are paused during the specified time window (7:00 PM to 6:00 AM IST)."
        );
        return; // Do not check for inactive TCUs during the time window
    }

    const now = moment().tz(MQTT_TIMEZONE);
    const inactiveData = {};

    for (const project in lastReceived) {
        for (const ncu in lastReceived[project]) {
            const inactiveTCUs = [];

            // Check expected TCUs (if any are defined)
            if (
                projectConfig[project] &&
                projectConfig[project][ncu] &&
                projectConfig[project][ncu].expectedTCUs
            ) {
                const expectedTCUs =
                    projectConfig[project][ncu].expectedTCUs || [];
                for (const expectedTCU of expectedTCUs) {
                    const lastTime = lastReceived[project][ncu][expectedTCU];
                    if (!lastTime) {
                        inactiveTCUs.push({
                            tcu: expectedTCU,
                            status: "NEVER_RECEIVED",
                            minutesInactive: "∞",
                        });
                    } else {
                        const diffMinutes = now.diff(lastTime, "minutes");
                        if (diffMinutes > TIMEOUT_MINUTES) {
                            inactiveTCUs.push({
                                tcu: expectedTCU,
                                status: "TIMEOUT",
                                minutesInactive: diffMinutes,
                            });
                        }
                    }
                }
            }

            // Check all TCUs that have communicated for timeouts
            for (const tcu in lastReceived[project][ncu]) {
                const tcuNum = parseInt(tcu);
                const lastTime = lastReceived[project][ncu][tcu];
                const diffMinutes = now.diff(lastTime, "minutes");

                if (diffMinutes > TIMEOUT_MINUTES) {
                    const alreadyAdded = inactiveTCUs.some(
                        (item) => item.tcu === tcuNum
                    );
                    if (!alreadyAdded) {
                        inactiveTCUs.push({
                            tcu: tcuNum,
                            status: "TIMEOUT",
                            minutesInactive: diffMinutes,
                        });
                    }
                }
            }

            // If there are inactive TCUs for this NCU, add to the final report
            if (inactiveTCUs.length > 0) {
                inactiveData[`${project}/${ncu}`] = inactiveTCUs;
            }
        }
    }

    if (Object.keys(inactiveData).length > 0) {
        const filename = "inactive_tcus.log";
        const timeStr = now.tz(LOG_TIMEZONE).format("YYYY-MM-DD HH:mm:ss UTC");

        writeToLog(filename, `=== INACTIVE TCU REPORT at ${timeStr} ===`);
        for (const projectNCU in inactiveData) {
            const [project, ncu] = projectNCU.split("/");
            writeToLog(filename, `Project: ${project}, NCU: ${ncu}`);
            inactiveData[projectNCU].forEach((item) => {
                const status =
                    item.status === "NEVER_RECEIVED"
                        ? "NEVER RECEIVED DATA"
                        : `TIMEOUT (${item.minutesInactive} min)`;
                writeToLog(filename, `  └─ TCU-${item.tcu}: ${status}`);
            });
        }
        writeToLog(filename, "=== END REPORT ===\n");

        // Generate and send WhatsApp message
        const inactiveReportMessage =
            generateInactiveReportMessage(inactiveData);
        await sendWhatsAppNotification(inactiveReportMessage, true); // Mark as emergency
    } else {
        console.log("\n✅ All TCUs are active. No inactive TCUs detected.");
    }
}

// Function to generate a readable message from inactive TCU data
function generateInactiveReportMessage(inactiveData) {
    const now = moment().tz(MQTT_TIMEZONE);
    let message = "🚨 *INACTIVE TCU ALERT* 🚨\n\n";
    message += `📅 Time: ${now.format("DD/MM/YYYY HH:mm:ss IST")}\n\n`;

    let totalInactive = 0;

    for (const projectNCU in inactiveData) {
        const [project, ncu] = projectNCU.split("/");
        message += `🏗️ *Project:* ${project.toUpperCase()}\n`;
        message += `🔧 *NCU:* ${ncu}\n`;
        message += `❌ *Inactive TCUs:*\n`;

        inactiveData[projectNCU].forEach((item) => {
            totalInactive++;
            const status =
                item.status === "NEVER_RECEIVED"
                    ? "NEVER RECEIVED"
                    : `${item.minutesInactive} min ago`;
            message += `   • TCU-${item.tcu}: ${status}\n`;
        });
        message += "\n";
    }

    message += `📊 *Total Inactive:* ${totalInactive} TCUs\n`;
    message += `⚠️ *Timeout Limit:* ${TIMEOUT_MINUTES} minutes\n\n`;
    message += `🔄 Next check in ${CHECK_INTERVAL} minutes`;

    return message;
}

// Function to check if current time is within the inactive period (7:00 PM to 6:00 AM IST)
function isWithinInactiveTimeWindow() {
    const now = moment().tz(MQTT_TIMEZONE);
    const currentHour = now.hour(); // Get the current hour in the local time zone (IST)

    // Check if the current time is between 7:00 PM (19:00) and 6:00 AM (06:00)
    return currentHour >= 19 || currentHour < 6;
}

// Initialize tracking
initializeTracking();

// Generate comprehensive status report
function generateStatusReport() {
    const now = moment().tz(MQTT_TIMEZONE);
    const filename = "status_report.log";
    const timeStr = now.tz(LOG_TIMEZONE).format("YYYY-MM-DD HH:mm:ss UTC");

    writeToLog(filename, `=== HOURLY STATUS REPORT at ${timeStr} ===`);

    let totalTCUs = 0;
    let activeTCUs = 0;
    let inactiveTCUs = 0;
    let neverReceivedTCUs = 0;

    for (const project in projectConfig) {
        for (const ncu in projectConfig[project]) {
            const config = projectConfig[project][ncu];
            const projectNCU = `${project}/${ncu}`;

            writeToLog(
                filename,
                `\n📊 Project: ${project.toUpperCase()}, NCU: ${ncu}`
            );
            writeToLog(filename, `   Total Expected TCUs: ${config.totalTCUs}`);

            // Get all TCUs that should be monitored
            const expectedTCUs =
                config.expectedTCUs.length > 0
                    ? config.expectedTCUs
                    : Array.from({ length: config.totalTCUs }, (_, i) => i + 1);

            // Get all TCUs that have ever communicated
            const communicatedTCUs =
                lastReceived[project] && lastReceived[project][ncu]
                    ? Object.keys(lastReceived[project][ncu]).map(Number)
                    : [];

            // Combine and get unique TCUs to check
            const allTCUs = [
                ...new Set([...expectedTCUs, ...communicatedTCUs]),
            ].sort((a, b) => a - b);

            const active = [];
            const inactive = [];
            const neverReceived = [];

            for (const tcuNum of allTCUs) {
                totalTCUs++;
                const lastTime =
                    lastReceived[project] &&
                    lastReceived[project][ncu] &&
                    lastReceived[project][ncu][tcuNum];

                if (!lastTime) {
                    neverReceived.push(tcuNum);
                    neverReceivedTCUs++;
                } else {
                    const diffMinutes = now.diff(lastTime, "minutes");
                    if (diffMinutes <= TIMEOUT_MINUTES) {
                        active.push({
                            tcu: tcuNum,
                            lastSeen: diffMinutes,
                            lastTime: lastTime
                                .tz(LOG_TIMEZONE)
                                .format("HH:mm:ss"),
                        });
                        activeTCUs++;
                    } else {
                        inactive.push({
                            tcu: tcuNum,
                            inactiveFor: diffMinutes,
                            lastTime: lastTime
                                .tz(LOG_TIMEZONE)
                                .format("HH:mm:ss"),
                        });
                        inactiveTCUs++;
                    }
                }
            }

            // Log active TCUs
            if (active.length > 0) {
                writeToLog(filename, `   ✅ ACTIVE TCUs (${active.length}):`);
                active.forEach((item) => {
                    writeToLog(
                        filename,
                        `      TCU-${item.tcu}: Last seen ${item.lastSeen} min ago (${item.lastTime})`
                    );
                });
            }

            // Log inactive TCUs
            if (inactive.length > 0) {
                writeToLog(
                    filename,
                    `   ⚠️ INACTIVE TCUs (${inactive.length}):`
                );
                inactive.forEach((item) => {
                    writeToLog(
                        filename,
                        `      TCU-${item.tcu}: Inactive for ${item.inactiveFor} min (Last: ${item.lastTime})`
                    );
                });
            }

            // Log never received TCUs
            if (neverReceived.length > 0) {
                writeToLog(
                    filename,
                    `   ❌ NEVER RECEIVED (${neverReceived.length}):`
                );
                neverReceived.forEach((tcuNum) => {
                    writeToLog(
                        filename,
                        `      TCU-${tcuNum}: No data received`
                    );
                });
            }

            // Summary for this project/NCU
            const activePercentage =
                allTCUs.length > 0
                    ? ((active.length / allTCUs.length) * 100).toFixed(1)
                    : 0;
            writeToLog(
                filename,
                `   📈 Summary: ${active.length} Active, ${inactive.length} Inactive, ${neverReceived.length} Never Received (${activePercentage}% active)`
            );
        }
    }

    // Overall summary
    writeToLog(filename, `\n📊 OVERALL SUMMARY:`);
    writeToLog(filename, `   Total TCUs Monitored: ${totalTCUs}`);
    writeToLog(filename, `   Active: ${activeTCUs}`);
    writeToLog(filename, `   Inactive: ${inactiveTCUs}`);
    writeToLog(filename, `   Never Received: ${neverReceivedTCUs}`);

    const overallActivePercentage =
        totalTCUs > 0 ? ((activeTCUs / totalTCUs) * 100).toFixed(1) : 0;
    writeToLog(
        filename,
        `   Overall Health: ${overallActivePercentage}% Active`
    );

    // System status
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    writeToLog(filename, `   System Uptime: ${hours}h ${minutes}m`);
    writeToLog(
        filename,
        `   Next Check: ${now
            .clone()
            .add(60, "minutes")
            .tz(LOG_TIMEZONE)
            .format("HH:mm:ss UTC")}`
    );

    writeToLog(filename, "=== END STATUS REPORT ===\n");

    console.log(
        `📊 Status report generated at ${now
            .tz(MQTT_TIMEZONE)
            .format(
                "HH:mm:ss"
            )} - Active: ${activeTCUs}/${totalTCUs} (${overallActivePercentage}%)`
    );
}

// Send daily summary to WhatsApp
async function sendDailySummary() {
    try {
        const now = moment().tz(MQTT_TIMEZONE);
        let totalTCUs = 0;
        let activeTCUs = 0;
        let inactiveTCUs = 0;
        let neverReceivedTCUs = 0;

        for (const project in projectConfig) {
            for (const ncu in projectConfig[project]) {
                const config = projectConfig[project][ncu];

                // Get all TCUs that should be monitored
                const expectedTCUs =
                    config.expectedTCUs.length > 0
                        ? config.expectedTCUs
                        : Array.from(
                              { length: config.totalTCUs },
                              (_, i) => i + 1
                          );

                // Get all TCUs that have ever communicated
                const communicatedTCUs =
                    lastReceived[project] && lastReceived[project][ncu]
                        ? Object.keys(lastReceived[project][ncu]).map(Number)
                        : [];

                // Combine and get unique TCUs to check
                const allTCUs = [
                    ...new Set([...expectedTCUs, ...communicatedTCUs]),
                ];

                for (const tcuNum of allTCUs) {
                    totalTCUs++;
                    const lastTime =
                        lastReceived[project] &&
                        lastReceived[project][ncu] &&
                        lastReceived[project][ncu][tcuNum];

                    if (!lastTime) {
                        neverReceivedTCUs++;
                    } else {
                        const diffMinutes = now.diff(lastTime, "minutes");
                        if (diffMinutes <= TIMEOUT_MINUTES) {
                            activeTCUs++;
                        } else {
                            inactiveTCUs++;
                        }
                    }
                }
            }
        }

        const overallActivePercentage =
            totalTCUs > 0 ? ((activeTCUs / totalTCUs) * 100).toFixed(1) : 0;

        const summaryMessage =
            `📊 *DAILY SYSTEM SUMMARY*\n\n` +
            `📅 Date: ${now.format("DD/MM/YYYY")}\n` +
            `🕐 Time: ${now.format("HH:mm:ss IST")}\n\n` +
            `🏗️ *TCU Status Overview:*\n` +
            `✅ Active: ${activeTCUs}\n` +
            `⚠️ Inactive: ${inactiveTCUs}\n` +
            `❌ Never Received: ${neverReceivedTCUs}\n` +
            `📊 Total Monitored: ${totalTCUs}\n\n` +
            `📈 *Overall Health: ${overallActivePercentage}%*\n\n` +
            `🔧 *System Info:*\n` +
            `⏰ Timeout Limit: ${TIMEOUT_MINUTES} minutes\n` +
            `🔄 Check Interval: ${CHECK_INTERVAL} minutes\n` +
            `⏸️ Night Mode: 7PM - 6AM IST`;

        // Send summary to groups only (not emergency contacts)
        if (
            WHATSAPP_CONFIG.useGroups &&
            WHATSAPP_CONFIG.alertGroups.length > 0
        ) {
            await sendBulkGroupMessages(
                WHATSAPP_CONFIG.alertGroups,
                summaryMessage
            );
            console.log("📱 Daily summary sent to WhatsApp groups");
        }
    } catch (error) {
        console.error("❌ Error sending daily summary:", error);
        writeToLog(
            "whatsapp_errors.log",
            `Failed to send daily summary: ${error.message}`
        );
    }
}

// Main execution function
const main = async () => {
    try {
        console.log("🚀 Starting MQTT Monitor with WhatsApp Integration...");

        // Initialize WhatsApp first
        console.log("📱 Initializing WhatsApp...");
        await initializeWhatsApp();
        console.log("✅ WhatsApp initialized successfully");

        // Send startup notification
        const startupMessage =
            `🟢 *MQTT Monitor Started*\n\n` +
            `📅 ${moment()
                .tz(MQTT_TIMEZONE)
                .format("DD/MM/YYYY HH:mm:ss IST")}\n\n` +
            `🔧 *Configuration:*\n` +
            `• Monitored Projects: ${Object.keys(projectConfig).length}\n` +
            `• MQTT Topics: ${topics.length}\n` +
            `• Timeout: ${TIMEOUT_MINUTES} min\n` +
            `• Check Interval: ${CHECK_INTERVAL} min\n\n` +
            `✅ System is now monitoring TCUs...`;

        await sendWhatsAppNotification(startupMessage);

        // Connect to MQTT after WhatsApp is initialized
        console.log(`🌐 Connecting to MQTT broker: ${host}`);
        const client = mqtt.connect(`mqtt://${host}`, {
            username,
            password,
            keepalive: 60,
            reconnectPeriod: 5000,
        });

        client.on("connect", () => {
            console.log("✅ Connected to MQTT broker");
            client.subscribe(topics, (err) => {
                if (err) {
                    console.error("❌ Subscribe error:", err);
                } else {
                    console.log("📋 Subscribed to topics:", topics);
                    console.log("🔄 Monitoring started...\n");
                }
            });
        });

        client.on("message", (topic, message) => {
            const topicInfo = parseTopicInfo(topic);
            if (!topicInfo) {
                console.warn(`⚠️ Invalid topic format: ${topic}`);
                return;
            }

            const { project, ncu } = topicInfo;
            const tcuData = parseTCUMessage(message);

            if (!tcuData) {
                console.warn(
                    `⚠️ Invalid message format from ${project}/${ncu}:`,
                    message.toString()
                );
                return;
            }

            // Update last received time
            if (!lastReceived[project]) lastReceived[project] = {};
            if (!lastReceived[project][ncu]) lastReceived[project][ncu] = {};

            lastReceived[project][ncu][tcuData.tcuNumber] = tcuData.timestamp;

            // Log the communication
            logTCUCommunication(
                project,
                ncu,
                tcuData.tcuNumber,
                tcuData.timestamp
            );
        });

        // Handle MQTT connection errors
        client.on("error", async (error) => {
            console.error("❌ MQTT connection error:", error);
            const errorMessage =
                `🚨 *MQTT CONNECTION ERROR*\n\n` +
                `⚠️ Error: ${error.message}\n` +
                `📅 Time: ${moment()
                    .tz(MQTT_TIMEZONE)
                    .format("DD/MM/YYYY HH:mm:ss IST")}\n\n` +
                `🔄 System will attempt to reconnect automatically.`;

            await sendWhatsAppNotification(errorMessage, true);
        });

        // Handle MQTT disconnection
        client.on("offline", async () => {
            console.log("🔌 MQTT client went offline");
            const offlineMessage =
                `⚠️ *MQTT CLIENT OFFLINE*\n\n` +
                `📅 Time: ${moment()
                    .tz(MQTT_TIMEZONE)
                    .format("DD/MM/YYYY HH:mm:ss IST")}\n\n` +
                `🔄 Attempting to reconnect...`;

            await sendWhatsAppNotification(offlineMessage, true);
        });

        // Handle MQTT reconnection
        client.on("reconnect", async () => {
            console.log("🔄 MQTT client reconnecting...");
        });

        // Monitor inactive TCUs
        setInterval(() => {
            logInactiveTCUs();
        }, CHECK_INTERVAL * 60 * 1000);

        // Generate status report every hour
        setInterval(() => {
            generateStatusReport();
        }, 60 * 60 * 1000);

        // Send daily summary at 9 AM IST
        setInterval(() => {
            const now = moment().tz(MQTT_TIMEZONE);
            if (now.hour() === 9 && now.minute() === 0) {
                sendDailySummary();
            }
        }, 60 * 1000); // Check every minute

        console.log("✅ MQTT Monitor with WhatsApp integration is running!");
        console.log(
            `📱 WhatsApp notifications configured for groups: ${WHATSAPP_CONFIG.alertGroups.join(
                ", "
            )}`
        );
        console.log(
            `📞 Emergency contacts: ${WHATSAPP_CONFIG.emergencyContacts.length} numbers`
        );
    } catch (error) {
        console.error("❌ Main execution error:", error);

        // Try to send error notification
        try {
            const errorMessage =
                `🚨 *SYSTEM STARTUP ERROR*\n\n` +
                `❌ Error: ${error.message}\n` +
                `📅 Time: ${moment()
                    .tz(MQTT_TIMEZONE)
                    .format("DD/MM/YYYY HH:mm:ss IST")}\n\n` +
                `⚠️ System may not be functioning properly.`;

            await sendWhatsAppNotification(errorMessage, true);
        } catch (notificationError) {
            console.error(
                "❌ Could not send error notification:",
                notificationError
            );
        }
    }
};

main();
