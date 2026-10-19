import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// MapSelectionScene extends the global Phaser.Scene; a stub is enough for its pure methods.
globalThis.Phaser = {
  Scene: class {},
  Math: { Clamp: (value, min, max) => Math.min(Math.max(value, min), max) },
};
const { MapSelectionScene, STAGE_COUNT } = await import('../../components/features/PSchool/game/MapSelectionScene.js');

const map = new MapSelectionScene();
const stages = Array.from({ length: STAGE_COUNT }, (_, i) => i + 1);

describe('P-School adventure map', () => {
  it('shows all 20 stages, each with its own name, description and reward', () => {
    assert.equal(STAGE_COUNT, 20);
    const names = new Set();
    for (const stage of stages) {
      const data = map.getStageData(stage);
      assert.notEqual(data.name, `ステージ ${stage}`, `stage ${stage} has a real name, not the fallback`);
      assert.ok(data.description && data.reward, `stage ${stage} has a description and a reward`);
      assert.ok(!names.has(data.name), `stage ${stage} name is unique`);
      names.add(data.name);
    }
  });

  it('opens every stage at the level the map says it needs', () => {
    let previous = 0;
    for (let level = 1; level <= 25; level += 1) {
      const unlocked = map.calculateUnlockedStages(level);
      assert.ok(unlocked >= previous && unlocked <= STAGE_COUNT, `level ${level} unlocks ${unlocked}`);
      previous = unlocked;
    }
    assert.equal(map.calculateUnlockedStages(19), STAGE_COUNT, 'level 19 opens the last stage');
    for (const stage of stages) {
      const level = map.getRequiredLevelForStage(stage);
      assert.ok(map.calculateUnlockedStages(level) >= stage, `stage ${stage} opens at Lv.${level}`);
      if (level > 1) assert.ok(map.calculateUnlockedStages(level - 1) < stage, `stage ${stage} is still locked at Lv.${level - 1}`);
    }
  });

  it('places 20 pins apart from each other and clear of the title, the buttons and the screen edges', () => {
    // The smallest common canvas (1024x768 window minus the 248px sidebar) and a large one
    for (const [width, height] of [[776, 768], [1192, 900], [1672, 1080]]) {
      map.scale = { width, height };
      const pins = map.generateMapBasedStagePositions();
      assert.equal(pins.length, STAGE_COUNT);
      pins.forEach((pin, i) => {
        const at = `stage ${i + 1} at ${width}x${height}`;
        // The flag spans 35px above to 25px below its point; the hover tooltip sits 80px above it
        assert.ok(pin.y - 80 >= 20, `${at}: the tooltip stays on screen`);
        assert.ok(pin.x >= 40 && pin.x <= width - 40 && pin.y + 25 <= height - 40, `${at}: inside the map frame`);
        const underTitle = Math.abs(pin.x - width / 2) < 200 + 25 && pin.y - 35 < 80;
        assert.ok(!underTitle, `${at}: clear of the title`);
        const underBlocksButton = pin.x + 25 > width - 152 && pin.y - 35 < 66;
        assert.ok(!underBlocksButton, `${at}: clear of the block editor button`);
        for (let j = 0; j < i; j += 1) {
          const gap = Math.hypot(pin.x - pins[j].x, pin.y - pins[j].y);
          assert.ok(gap >= 70, `${at}: ${Math.round(gap)}px from stage ${j + 1}`);
        }
      });
    }
  });
});
