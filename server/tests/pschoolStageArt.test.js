import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENEMY_MAX_WIDTH, GROUND, PLAYER_ART, STAGE_ART, stageArt } from '../../components/features/PSchool/game/stageArt.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const exists = (url) => fs.existsSync(path.join(PUBLIC, url));

describe('P-School stage art', () => {
  it('has a background and an enemy image for every stage 1-20, and the files exist', () => {
    for (let stage = 1; stage <= 20; stage += 1) {
      const art = STAGE_ART[stage];
      assert.ok(art, `stage ${stage} has art`);
      assert.ok(exists(art.background), `${art.background} exists`);
      assert.ok(exists(art.enemy), `${art.enemy} exists`);
    }
    assert.ok(exists(PLAYER_ART.path), `${PLAYER_ART.path} exists`);
  });

  it('gives each stage its own texture keys, so a later stage never shows an earlier one', () => {
    const keys = new Set();
    for (let stage = 1; stage <= 20; stage += 1) {
      const { enemyKey, backgroundKey } = stageArt(stage);
      assert.ok(!keys.has(enemyKey) && !keys.has(backgroundKey), `stage ${stage} keys are unique`);
      keys.add(enemyKey).add(backgroundKey);
    }
    assert.ok(!keys.has(PLAYER_ART.key));
    assert.equal(stageArt(99), null, 'unknown stages fall back to the old name-based images');
  });

  it('keeps sizes inside the screen: enemies stand above the log panel and fit beside the hero', () => {
    for (const [stage, art] of Object.entries(STAGE_ART)) {
      const feet = GROUND.enemy - (art.lift ?? 0);
      assert.ok(feet <= 0.8, `stage ${stage} enemy stands above the log panel (starts at 0.82)`);
      assert.ok(feet - art.enemyHeight > 0.15, `stage ${stage} enemy stays below the HP cards`);
    }
    assert.ok(GROUND.player - PLAYER_ART.height > 0.15);
    assert.ok(ENEMY_MAX_WIDTH < 0.5);
  });
});
