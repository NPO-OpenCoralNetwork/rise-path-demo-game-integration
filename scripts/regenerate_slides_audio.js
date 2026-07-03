import fs from 'fs';
import path from 'path';
import { generateAudioContent } from './kokoro_tts_node.js';

const OUTPUT_DIR = 'public/audio/slides/m1-l1';
const TEXTS = [
    "変数は箱ではなくラベルです。値を直接持たず、メモリ上のオブジェクトを指します。複数の名前が同じオブジェクトを参照できます。",
    "すべてのオブジェクトにはIDがあります。リストなどの可変オブジェクトは変更してもIDが同じですが、不変オブジェクトは変更時に新しいIDになります。",
    "代入は参照をコピーするだけでデータは複製されません。浅いコピーは copy やスライス、ネスト構造は deepcopy が必要です。",
    "可変型（リストなど）はその場で変化し、不変型（文字列など）は新しいオブジェクトになります。これがデータの流れ方を左右します。",
    "参照数が0になるとメモリが解放されます。循環参照はガーベジコレクタが回収します。"
];

async function main() {
    if (!process.env.KOKORO_TTS_URL) {
        console.error("Error: KOKORO_TTS_URL is not set. Start the Kokoro sidecar (deploy/kokoro-tts).");
        process.exit(1);
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    console.log(`Starting TTS generation for ${TEXTS.length} slides...`);

    for (let i = 0; i < TEXTS.length; i++) {
        const text = TEXTS[i];
        const filename = `${String(i + 1).padStart(2, '0')}.mp3`;
        const filepath = path.join(OUTPUT_DIR, filename);

        console.log(`[${i + 1}/${TEXTS.length}] Generating: ${filename}`);
        console.log(`   Text: "${text.substring(0, 30)}..."`);

        try {
            // generateAudioContent returns a base64 string (without prefix)
            const base64Audio = await generateAudioContent(text);
            const buffer = Buffer.from(base64Audio, 'base64');
            fs.writeFileSync(filepath, buffer);
            console.log(`   Saved to ${filepath} (${buffer.length} bytes)`);
        } catch (error) {
            console.error(`   Failed to generate ${filename}:`, error.message);
        }
    }

    console.log("Done.");
}

main();
