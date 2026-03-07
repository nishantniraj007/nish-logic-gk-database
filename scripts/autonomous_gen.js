const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');

// --- Configuration ---
// Crucial: Use Flash-Lite limits
const API_KEY = process.env.GEMINI_API_KEY;
const MAX_DAILY_LIMIT = 500;
const DELAY_MS = 8000; // 8 seconds heavily respects Flash-Lite rate limits.
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIRS = ['history', 'geography', 'polity'];
const CHUNKS_PER_VAR = 11; // Level 7 to Level 17 (Masters)
const HASH_FILE = path.join(ROOT_DIR, 'data', 'hash_set.json');

// --- Setup System ---
DATA_DIRS.forEach(dir => {
    if (!fs.existsSync(path.join(ROOT_DIR, dir))) fs.mkdirSync(path.join(ROOT_DIR, dir), { recursive: true });
});
if (!fs.existsSync(path.join(ROOT_DIR, 'data'))) fs.mkdirSync(path.join(ROOT_DIR, 'data'), { recursive: true });

let usedHashes = new Set();
if (fs.existsSync(HASH_FILE)) {
    usedHashes = new Set(JSON.parse(fs.readFileSync(HASH_FILE)));
}

function generateHash(str) {
    return crypto.createHash('sha256').update(str.toLowerCase().trim()).digest('hex');
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchQuestions(subject, level) {
    if (!API_KEY) throw new Error("GEMINI_API_KEY missing");

    // Fallback safely to flash 8b experimental if required, else use standard flash. 
    // Usually, you call gemini-2.5-flash-lite if available in SDK, else flash.
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Update this string if a lite specific endpoint is available in the library version used.

    let gradeContext = level <= 12 ? `Class ${level} NCERT text book level` : `Graduation/UPSC standard level`;

    const prompt = `
        Act as an expert Indian exam creator. Generate exactly 10 highly accurate Multiple Choice Questions (MCQs) for the subject ${subject.toUpperCase()}.
        Difficulty Target: ${gradeContext}.
        
        Rules:
        1. No complex code or markdown. Just the raw JSON Array.
        2. Ensure the facts are 100% accurate as per standard curriculum.
        3. Do not repeat very common questions. Dig deep into the book chapters.

        Format strictly as JSON Array:
        [
          {
            "question": "...",
            "options": ["A", "B", "C", "D"],
            "correct_answer": "A",
            "explanation": "Detailed explanation here...",
            "category": "${subject}"
          }
        ]
    `;

    const result = await model.generateContent(prompt);
    let resp = result.response.text().trim();
    resp = resp.replace(/^```[a-z]*\n?/gm, '').replace(/```$/g, '').trim();
    return JSON.parse(resp);
}

async function main() {
    console.log(`=== NISH-LOGIC-GK-DATABASE: 500/Day Autonomous Engine ===`);
    let totalGeneratedToday = 0;

    // We aim for 500 questions.
    // 500 / 10 per call = 50 API Calls.
    // Distributed among History, Geo, Polity across 11 levels.

    outerLoop:
    while (totalGeneratedToday < MAX_DAILY_LIMIT) {
        let savedInLoop = 0;
        for (const subject of DATA_DIRS) {
            // 7 = Class 7, 17 = Masters
            for (let level = 7; level <= 17; level++) {
                if (totalGeneratedToday >= MAX_DAILY_LIMIT) break outerLoop;

                console.log(`Fetching 10 for ${subject.toUpperCase()} Level ${level}...`);
                try {
                    const batch = await fetchQuestions(subject, level);

                    const filePath = path.join(ROOT_DIR, subject, `level_${level}.json`);
                    let existingData = [];
                    if (fs.existsSync(filePath)) {
                        existingData = JSON.parse(fs.readFileSync(filePath));
                    }

                    let newlyAdded = 0;
                    for (const q of batch) {
                        const h = generateHash(q.question);
                        if (!usedHashes.has(h)) {
                            usedHashes.add(h);
                            existingData.push(q);
                            newlyAdded++;
                            totalGeneratedToday++;
                            if (totalGeneratedToday >= MAX_DAILY_LIMIT) break;
                        }
                    }

                    if (newlyAdded > 0) {
                        fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
                        fs.writeFileSync(HASH_FILE, JSON.stringify(Array.from(usedHashes)));
                    }

                    savedInLoop += newlyAdded;
                    console.log(`Saved ${newlyAdded} unique. Daily Count: ${totalGeneratedToday}/${MAX_DAILY_LIMIT}`);
                    await delay(DELAY_MS);

                } catch (e) {
                    console.error(`Error on ${subject} Level ${level}:`, e.message);
                    await delay(DELAY_MS * 2); // longer backoff on crash
                }
            }
        }

        // Failsafe: if we run through the whole loop and hit 0, break to avoid infinite loop
        if (savedInLoop === 0) {
            console.log("No new unique questions generated in this pass. Stopping to avoid infinite loop.");
            break outerLoop;
        }
    }

    console.log(`\n=== NIGHTLY RUN COMPLETE: Added ${totalGeneratedToday} Questions ===`);
}

main();
