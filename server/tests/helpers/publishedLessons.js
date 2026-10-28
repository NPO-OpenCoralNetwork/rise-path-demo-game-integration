/**
 * Every published lesson in content/courses/<course>/lessons/*.lesson.json, read with node:fs,
 * for tests that must hold for all of them (answer stripping, quiz feedback, the lesson index).
 * Not a test file (npm test runs *.test.js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COURSES = path.join(ROOT, 'content/courses');

/** @returns {{ course: string, file: string, lesson: any }[]} */
export function publishedLessons() {
    const out = [];
    for (const course of fs.readdirSync(COURSES).sort()) {
        const dir = path.join(COURSES, course, 'lessons');
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir).sort()) {
            if (!name.endsWith('.lesson.json')) continue;
            const file = path.join(dir, name);
            out.push({ course, file: path.relative(ROOT, file), lesson: JSON.parse(fs.readFileSync(file, 'utf8')) });
        }
    }
    return out;
}

/** Every quiz question of every published lesson, with its block and lesson. */
export function publishedQuestions() {
    const out = [];
    for (const entry of publishedLessons()) {
        for (const section of entry.lesson.sections) {
            for (const block of section.blocks) {
                if (block.type !== 'quiz') continue;
                for (const question of block.questions) out.push({ ...entry, section, block, question });
            }
        }
    }
    return out;
}
