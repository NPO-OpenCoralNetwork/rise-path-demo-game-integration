import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = path.join(
  process.cwd(),
  'data/curricula/blender/blender_manual_v500_en.html/_images'
);
const STATIC_SRC = path.join(
  process.cwd(),
  'data/curricula/blender/blender_manual_v500_en.html/_static/blender-logo.svg'
);
const DEST = path.join(
  process.cwd(),
  'public/data/curricula/blender/_images'
);
const STATIC_DEST_DIR = path.join(
  process.cwd(),
  'public/data/curricula/blender/_static'
);

const main = async () => {
  await fs.mkdir(DEST, { recursive: true });
  await fs.cp(SRC, DEST, { recursive: true, force: true });
  await fs.mkdir(STATIC_DEST_DIR, { recursive: true });
  await fs.copyFile(STATIC_SRC, path.join(STATIC_DEST_DIR, 'blender-logo.svg'));
  console.log(`Synced Blender images to ${DEST}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
