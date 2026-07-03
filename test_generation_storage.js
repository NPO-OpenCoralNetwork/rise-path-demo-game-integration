import { getPool, PHASE1_USER_ID } from './server/db.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Mock AI output (Simplified Vibe Structure)
const mockAiOutput = {
    title: { jp: "AI生成テストコース", en: "AI Gen Test Course" },
    description: { jp: "これはテストです。", en: "This is a test." },
    ui_template_id: "vibe_coding",
    modules: [
        {
            module_id: "mod1",
            title: "Module 1",
            objective: "Test objective",
            lessons: [
                { lesson_id: "l1", summary: "Lesson 1" }
            ]
        }
    ]
};

async function testStorageFlow() {
    const pool = getPool();
    if (!pool) return;

    console.log("--- Testing AI Generation Storage Flow ---");

    try {
        // 1. Create Parent Record (Curriculum)
        console.log("1. Creating Parent Curriculum...");
        const currRes = await pool.query(
            'insert into curricula (user_id, title, description) values ($1, $2, $3) returning id',
            [PHASE1_USER_ID, 'New Curriculum', 'Draft description']
        );
        const currId = currRes.rows[0].id;
        console.log(`   Parent ID: ${currId}`);

        // 2. Create Child Record (Version) with Mock AI Content
        console.log("2. Creating Curriculum Version with AI Content...");
        // Ensure ui_template_id is explicitly in the JSON
        const finalJson = {
            ...mockAiOutput,
            ui_template_id: mockAiOutput.ui_template_id || 'vibe_coding'
        };
        
        const verRes = await pool.query(
            'insert into curriculum_versions (curriculum_id, version, content_json, status) values ($1, 1, $2, $3) returning id',
            [currId, JSON.stringify(finalJson), 'approved']
        );
        const verId = verRes.rows[0].id;
        console.log(`   Version ID: ${verId}`);

        // 3. Sync Logic (The fix I implemented)
        console.log("3. Syncing Metadata (Title, Link, Counts)...");
        
        // Calculate lessons
        const modules = finalJson.modules || [];
        const lessonCount = modules.reduce((sum, m) => sum + (m.lessons?.length || 0), 0);
        const titleStr = finalJson.title.jp || finalJson.title.en;

        await pool.query(
            'update curricula set title = $1, current_version_id = $2, total_lessons = $3 where id = $4',
            [titleStr, verId, lessonCount, currId]
        );
        console.log("   Sync complete.");

        // 4. Verify Storage
        console.log("4. Verifying DB Content...");
        const checkRes = await pool.query(`
            SELECT c.id, c.title, c.total_lessons, c.current_version_id, v.content_json
            FROM curricula c
            LEFT JOIN curriculum_versions v ON c.current_version_id = v.id
            WHERE c.id = $1
        `, [currId]);
        
        const row = checkRes.rows[0];
        console.log(`   [DB] Title: ${row.title}`);
        console.log(`   [DB] Total Lessons: ${row.total_lessons}`);
        console.log(`   [DB] Version Linked: ${row.current_version_id === verId}`);
        console.log(`   [DB] content_json keys: ${Object.keys(row.content_json).join(', ')}`);
        console.log(`   [DB] ui_template_id in JSON: ${row.content_json.ui_template_id}`);

        // 5. Cleanup
        await pool.query('DELETE FROM curricula WHERE id = $1', [currId]);
        console.log("5. Cleaned up test data.");

    } catch (e) {
        console.error("Test failed:", e);
    } finally {
        await pool.end();
    }
}

testStorageFlow();
