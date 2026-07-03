/**
 * Script to delete curricula with empty content from the database
 */

import pg from 'pg';
const { Pool } = pg;

// Load environment variables
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load .env.local
try {
    const envContent = await fs.readFile(path.join(projectRoot, '.env.local'), 'utf8');
    envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0 && !process.env[key]) {
            process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
        }
    });
} catch (e) {
    // Ignore if .env.local doesn't exist
}

const connectionString = process.env.DATABASE_URL_PHASE1;
if (!connectionString) {
    console.error('DATABASE_URL_PHASE1 is not set.');
    process.exit(1);
}

const pool = new Pool({ connectionString });

async function cleanup() {
    console.log('🔍 Finding empty curricula...\n');

    try {
        // Find all curricula and check their content
        const result = await pool.query(`
            SELECT c.id, c.title, v.content_json
            FROM curricula c
            LEFT JOIN curriculum_versions v ON c.current_version_id = v.id
            ORDER BY c.created_at DESC
        `);

        const emptyIds = [];
        const validIds = [];

        for (const row of result.rows) {
            const content = row.content_json || {};
            const hasModules = content.modules && Array.isArray(content.modules) && content.modules.length > 0;
            const hasChapters = content.chapters && Array.isArray(content.chapters) && content.chapters.length > 0;

            if (!hasModules && !hasChapters) {
                emptyIds.push({ id: row.id, title: row.title });
                console.log(`❌ Empty: "${row.title}" (${row.id})`);
            } else {
                validIds.push({ id: row.id, title: row.title });
                console.log(`✅ Valid: "${row.title}" (modules: ${content.modules?.length || 0})`);
            }
        }

        console.log('\n---');
        console.log(`Total: ${result.rows.length}`);
        console.log(`Valid: ${validIds.length}`);
        console.log(`Empty (to delete): ${emptyIds.length}`);

        if (emptyIds.length === 0) {
            console.log('\n✨ No empty curricula to delete.');
            return;
        }

        console.log('\n🗑️  Deleting empty curricula...\n');

        for (const item of emptyIds) {
            // 1. First, set current_version_id to NULL to break the FK reference
            await pool.query('UPDATE curricula SET current_version_id = NULL WHERE id = $1', [item.id]);

            // 2. Delete related curriculum_versions
            await pool.query('DELETE FROM curriculum_versions WHERE curriculum_id = $1', [item.id]);

            // 3. Delete the curriculum itself
            await pool.query('DELETE FROM curricula WHERE id = $1', [item.id]);
            console.log(`   Deleted: "${item.title}"`);
        }

        console.log(`\n✅ Deleted ${emptyIds.length} empty curricula.`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await pool.end();
    }
}

cleanup();
