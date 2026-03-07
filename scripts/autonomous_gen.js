const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
const MAX_DAILY_LIMIT = 600; // Total (500 GK + 100 CA)
const CA_DAILY_TARGET = 100; // 100 Current Affairs
const GK_DAILY_TARGET = 500; // 500 Static GK
const CA_TOTAL_GOAL = 10000;
const GK_TOTAL_GOAL = 100000;

const DELAY_MS = 10000; // 10 seconds delay
const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIRS = ['history', 'geography', 'polity', 'current_affairs'];
const HASH_FILE = path.join(ROOT_DIR, 'data', 'hash_set.json');

// --- Syllabus/Index Map (Simplified for Prompts) ---
const syllabusIndex = {
    history: {
        7: "Mughal Empire, Delhi Sultanate, New Kings and Kingdoms",
        8: "British Rule, 1857 Revolt, Colonialism and the City",
        9: "French Revolution, Nazism, Colonialism and Forest Society",
        10: "Nationalism in Europe, Nationalism in India, Making of Global World",
        11: "Early Societies, Empires across Three Continents, Nomadic Empires",
        12: "Harappan Civilisation, Kings Farmers Towns, Kinship Caste Class",
        13: "Ancient Indian Political Thought (IGNOU/UPSC)",
        14: "Medieval Socio-Economic Formations (UPSC)",
        15: "Modern World Revolutions (UPSC/SSC)",
        16: "Indian National Movement In-Depth (UPSC)",
        17: "Historiography and Advanced World History (Masters)"
    },
    geography: {
        7: "Environment, Inside our Earth, Our changing Earth",
        8: "Resources, Agriculture, Industries, Human Resources",
        9: "India size/location, Physical features of India, Drainage",
        10: "Resources and Development, Water Resources, Agriculture",
        11: "Fundamentals of Physical Geography, India Physical Environment",
        12: "Fundamentals of Human Geography, People and Economy (India)",
        13: "Geomorphology and Climatology (IGNOU/UPSC)",
        14: "Oceanography and Biogeography (UPSC)",
        15: "Regional Planning and Development (UPSC)",
        16: "Environment and Economic Geography (SSC/UPSC)",
        17: "Advanced Cartography and Geospace analysis (Masters)"
    },
    polity: {
        7: "On Equality, Role of Government in Health, How State Govt Works",
        8: "Indian Constitution, Secularism, Why do we need Parliament",
        9: "What is Democracy, Constitutional Design, Electoral Politics",
        10: "Power Sharing, Federalism, Democracy and Diversity",
        11: "Indian Constitution at Work, Political Theory",
        12: "Contemporary World Politics, Politics in India since Independence",
        13: "Public Administration Principles (IGNOU/UPSC)",
        14: "International Relations Foundations (UPSC)",
        15: "Indian Governance and Constitution Depth (SSC/UPSC)",
        16: "Comparative Politics and Local Self-Govt (UPSC)",
        17: "Political Theory and Global Governance (Masters)"
    }
};

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

async function fetchQuestions(subject, level, isCA = false) {
    if (!API_KEY) throw new Error("GEMINI_API_KEY missing");

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    let prompt = "";
    if (isCA) {
        prompt = `
            Act as an expert exam creator for UPSC/SSC. Generate exactly 10 high-quality MCQs based ONLY on Current Affairs from the PAST 6 MONTHS.
            Focus on: National international events, Sports, Appointments, Awards, Infrastructure, Science & Tech.
            
            Rules:
            1. Return raw JSON Array. No markdown.
            2. Factually verified and recent (last 180 days).
        `;
    } else {
        const topic = syllabusIndex[subject][level] || "General subject matter";
        prompt = `
            Act as an expert Indian exam creator. Generate exactly 10 highly accurate MCQs for ${subject.toUpperCase()} level ${level}.
            Syllabus Focus: ${topic}.
            
            Rules:
            1. No markdown. Return raw JSON Array.
            2. Depth: Level 7-12 (NCERT Standard), Level 13-17 (IGNOU/UPSC Graduation Standard).
            3. Dig deep into specific historical/geographic/political facts.
        `;
    }

    prompt += `
        Format strictly as JSON Array:
        [
          {
            "question": "...",
            "options": ["A", "B", "C", "D"],
            "correct_answer": "correct option content",
            "explanation": "Detailed explanation here...",
            "category": "${isCA ? 'Current Affairs' : subject}"
          }
        ]
    `;

    const result = await model.generateContent(prompt);
    let resp = result.response.text().trim();
    resp = resp.replace(/^```[a-z]*\n?/gm, '').replace(/```$/g, '').trim();
    return JSON.parse(resp);
}

async function main() {
    console.log(`=== NISH-LOGIC-GK-DATABASE: 500 Daily Goal ===`);
    let totalAdded = 0;
    let caAdded = 0;
    let gkAdded = 0;

    // 1. Current Affairs Phase (Target 100)
    console.log(`\nPhase 1: Generating Current Affairs (Past 6 Months)...`);
    while (caAdded < CA_DAILY_TARGET) {
        try {
            const batch = await fetchQuestions('current_affairs', 0, true);
            const filePath = path.join(ROOT_DIR, 'current_affairs', 'latest.json');
            let data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : [];

            let batchCount = 0;
            for (const q of batch) {
                const h = generateHash(q.question);
                if (!usedHashes.has(h)) {
                    usedHashes.add(h);
                    data.push(q);
                    caAdded++;
                    totalAdded++;
                    batchCount++;
                }
            }
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            fs.writeFileSync(HASH_FILE, JSON.stringify(Array.from(usedHashes)));
            console.log(`Saved ${batchCount} unique CA. Count: ${caAdded}/${CA_DAILY_TARGET}`);
            await delay(DELAY_MS);
        } catch (e) {
            console.error("CA Fetch Error:", e.message);
            await delay(DELAY_MS * 2);
        }
    }

    // 2. Static GK Phase (Target 400)
    console.log(`\nPhase 2: Generating Syllabus-Guided GK (NCERT/IGNOU/UPSC)...`);
    const subjects = ['history', 'geography', 'polity'];

    outer:
    while (gkAdded < GK_DAILY_TARGET) {
        for (const sub of subjects) {
            for (let lvl = 17; lvl >= 7; lvl--) { // Top-down as requested (Masters down to 7)
                if (gkAdded >= GK_DAILY_TARGET) break outer;

                console.log(`Fetching 10 for ${sub.toUpperCase()} Level ${lvl}...`);
                try {
                    const batch = await fetchQuestions(sub, lvl);
                    const filePath = path.join(ROOT_DIR, sub, `level_${lvl}.json`);
                    let data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath)) : [];

                    let batchAdded = 0;
                    for (const q of batch) {
                        const h = generateHash(q.question);
                        if (!usedHashes.has(h)) {
                            usedHashes.add(h);
                            data.push(q);
                            gkAdded++;
                            totalAdded++;
                            batchAdded++;
                        }
                    }
                    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                    fs.writeFileSync(HASH_FILE, JSON.stringify(Array.from(usedHashes)));
                    console.log(`Stored ${batchAdded} unique. GK Progress: ${gkAdded}/${GK_DAILY_TARGET}`);
                    await delay(DELAY_MS);
                } catch (e) {
                    console.error(`${sub} L${lvl} Error:`, e.message);
                    await delay(DELAY_MS * 2);
                }
            }
        }
    }

    console.log(`\n=== NIGHTLY COMPLETE: Added ${totalAdded} New Questions ===`);
}

main();
