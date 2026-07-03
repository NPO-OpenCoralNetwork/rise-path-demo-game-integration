import { bm25Search, loadImageIndex, DEFAULT_INDEX_PATH } from './blender_image_search_utils.js';

const main = async () => {
  const query = process.argv.slice(2).join(' ').trim();
  if (!query) {
    console.log('Usage: node scripts/search_blender_images.js <query>');
    process.exit(1);
  }

  const records = await loadImageIndex(DEFAULT_INDEX_PATH);
  const results = bm25Search(records, query, 5);

  if (!results.length) {
    console.log('No matches found.');
    return;
  }

  for (const { record, score } of results) {
    console.log(`\nScore: ${score}`);
    console.log(`Image: ${record.image}`);
    console.log(`File: ${record.file}`);
    console.log(`Heading: ${record.headingPath || '-'}`);
    console.log(`Caption: ${record.caption || '-'}`);
    if (record.contextBefore || record.contextAfter) {
      console.log(`Context: ${(record.contextBefore || '').slice(0, 80)} ${(record.contextAfter || '').slice(0, 80)}`.trim());
    }
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
