// Import necessary modules
const mqtt = require("mqtt");
const moment = require("moment-timezone");
const fs = require("fs-extra");
const path = require("path");
const { sendBulkMessages, initializeWhatsApp } = require("./whatsapp_send"); // Update with correct path to your WhatsApp script

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

// Log inactive TCUs and send message to WhatsApp
async function logInactiveTCUs() {
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

        // Send inactive TCU details to a specific phone number
        const inactiveReportMessage =
            generateInactiveReportMessage(inactiveData);
        const contacts = [{ phoneNo: "7600006306" }, { phoneNo: "7575068682" }]; // Replace with recipient's phone number
        await sendBulkMessages(contacts, inactiveReportMessage); // Send message
    } else {
        console.log("\n✅ All TCUs are active. No inactive TCUs detected.");
    }
}

// Function to generate a readable message from inactive TCU data
function generateInactiveReportMessage(inactiveData) {
    let message = "⚠️ Inactive TCU Report ⚠️\n\n";
    for (const projectNCU in inactiveData) {
        const [project, ncu] = projectNCU.split("/");
        message += `Project: ${project}, NCU: ${ncu}\n`;
        inactiveData[projectNCU].forEach((item) => {
            const status =
                item.status === "NEVER_RECEIVED"
                    ? "NEVER RECEIVED DATA"
                    : `TIMEOUT (${item.minutesInactive} min)`;
            message += `  TCPU-${item.tcu}: ${status}\n`;
        });
        message += "\n";
    }
    return message;
}

// Initialize tracking
initializeTracking();

// Main execution function
const main = async () => {
    try {
        // Initialize WhatsApp first
        await initializeWhatsApp();

        // Connect to MQTT after WhatsApp is initialized
        console.log(`Connecting to MQTT broker: ${host}`);
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

        // Monitor inactive TCUs and generate reports
        setInterval(() => {
            logInactiveTCUs();
        }, CHECK_INTERVAL * 60 * 1000);

        // Generate status report every hour
        setInterval(() => {
            generateStatusReport();
        }, 60 * 60 * 1000);
    } catch (error) {
        console.error("❌ Main execution error:", error);
    }
};

main();
