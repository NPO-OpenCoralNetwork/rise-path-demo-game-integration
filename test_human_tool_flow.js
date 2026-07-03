
import fetch from 'node-fetch';
import fs from 'fs/promises';

const loadEnv = async () => {
  try {
    const raw = await fs.readFile('.env.local', 'utf8');
    raw.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2 && !line.trim().startsWith('#')) {
        const key = parts[0].trim().replace(/^export\s+/, '');
        const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    });
  } catch (e) {}
};

const BASE_URL = 'http://localhost:3006';

async function testHumanToolFlow() {
  await loadEnv();
  console.log("\n🚀 Testing Human-as-a-Tool Flow...");

  // 1. Initial Chat
  console.log("\n🔹 Step 1: User says 'Hello'");
  const res1 = await fetch(`${BASE_URL}/api/v2/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: "Hello" })
  });
  const data1 = await res1.json();
  console.log("   AI Question:", data1.message);
  
  const sessionId = data1.session_id;
  const curriculumId = data1.curriculum_id;

  // 2. Reply to Question (Tool Injection)
  console.log("\n🔹 Step 2: User replies 'Python beginners'");
  const res2 = await fetch(`${BASE_URL}/api/v2/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: "Python beginners", session_id: sessionId })
  });
  const data2 = await res2.json();
  console.log("   AI Response:", data2.message);
  console.log("   Pending Approval:", data2.pending_approval);

  if (data2.pending_approval !== 'requirements') {
      throw new Error("Expected requirements draft after answer");
  }

  // 3. Approve
  console.log("\n🔹 Step 3: User approves requirements");
  const res3 = await fetch(`${BASE_URL}/api/v2/ai/curricula/${curriculumId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: 'requirements', decision: 'approved', session_id: sessionId })
  });
  const data3 = await res3.json();
  console.log("   Next Stage:", data3.pending_approval);

  console.log("\n✅ Human-as-a-Tool Flow PASSED!");
}

testHumanToolFlow().catch(e => {
    console.error("❌ Test Failed:", e);
    process.exit(1);
});
