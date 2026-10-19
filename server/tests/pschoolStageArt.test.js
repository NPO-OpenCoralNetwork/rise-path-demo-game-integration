import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENEMY_MAX_WIDTH, FEET, ORIGINAL_LAYOUT, PLAYER_ART, STAGE_ART, stageArt } from '../../components/features/PSchool/game/stageArt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const exists = (url) => fs.existsSync(path.join(ROOT, 'public', url));

describe('P-School stage art', () => {
  it('keeps stage 1 on its original art and the layout the owner tuned', () => {
    assert.equal(stageArt(1), null, 'stage 1 has no v2 entry');
    const scene = fs.readFileSync(path.join(ROOT, 'components/features/PSchool/game/BattleScene.js'), 'utf8');
    const urls = scene.match(/\/p_school\/assets\/[\w.-]+/g) ?? [];
    assert.equal(urls.length, 2, 'the stage 1 scene names its enemy and background');
    for (const url of [...urls, ORIGINAL_LAYOUT.player.path]) assert.ok(exists(url), `${url} exists`);
    assert.deepEqual(
      { player: { ...ORIGINAL_LAYOUT.player }, enemy: { ...ORIGINAL_LAYOUT.enemy }, alpha: ORIGINAL_LAYOUT.alpha },
      {
        player: { key: 'player', path: '/p_school/assets/main-chara01_transparent.png', height: 350, x: 0.25, y: 0.67 },
        enemy: { width: 133, x: 0.75, y: 0.6 },
        alpha: 0.9,
      },
    );
  });

  it('has a background and an enemy image for every stage 2-20, and the files exist', () => {
    for (let stage = 2; stage <= 20; stage += 1) {
      const art = STAGE_ART[stage];
      assert.ok(art, `stage ${stage} has art`);
      assert.ok(exists(art.background), `${art.background} exists`);
      assert.ok(exists(art.enemy), `${art.enemy} exists`);
    }
    assert.ok(exists(PLAYER_ART.path), `${PLAYER_ART.path} exists`);
  });

  it('gives each stage its own texture keys, so a later stage never shows an earlier one', () => {
    const keys = new Set([ORIGINAL_LAYOUT.player.key, PLAYER_ART.key]);
    for (let stage = 2; stage <= 20; stage += 1) {
      const { enemyKey, backgroundKey } = stageArt(stage);
      assert.ok(!keys.has(enemyKey) && !keys.has(backgroundKey), `stage ${stage} keys are unique`);
      keys.add(enemyKey).add(backgroundKey);
    }
    assert.equal(stageArt(99), null, 'unknown stages fall back to the original layout');
  });

  it('stands everyone on the floor: the hero above the log panel, the enemy a little further back, below the HP cards', () => {
    for (const [stage, art] of Object.entries(STAGE_ART)) {
      const [player, enemy] = art.ground;
      assert.ok(player <= 0.81, `stage ${stage} hero stands above the log panel (it starts at 0.82)`);
      assert.ok(enemy < player && enemy >= 0.7, `stage ${stage} enemy stands on the floor, behind the hero`);
      assert.ok(enemy - art.hover - art.enemyHeight * FEET > 0.15, `stage ${stage} enemy stays below the HP cards`);
      assert.ok(art.enemyX > 0.55 && art.enemyX < 0.85, `stage ${stage} enemy stands on the right`);
      assert.ok(art.focus.every((share) => share >= 0 && share <= 1), `stage ${stage} focus is inside the background`);
    }
    assert.ok(PLAYER_ART.height < 0.4 && ENEMY_MAX_WIDTH < 0.5);
  });
});
