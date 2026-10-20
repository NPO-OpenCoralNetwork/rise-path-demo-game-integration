import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HEAL_POWER, Player } from '../../components/features/PSchool/game/player.js';

/** A player in a stand-in battle that records the heal animation, the log and the HP display. */
function setup(hp) {
  const seen = { animations: [], logs: [], shown: [] };
  const scene = {
    enemy: { hp: 40 },
    playAnimation: async (type) => { seen.animations.push({ type, hpDuring: player.hp }); return true; },
  };
  const ui = { log: (text) => seen.logs.push(text), updateHP: (p, e) => seen.shown.push([p, e]) };
  const log = console.log;
  console.log = () => {};
  const player = new Player(scene, ui, 1);
  console.log = log;
  player.hp = hp;
  return { player, seen };
}

describe('P-School healing', () => {
  it('heals after the heal animation and shows the new HP', async () => {
    const { player, seen } = setup(10);
    await player.heal(HEAL_POWER);
    assert.equal(player.hp, 10 + HEAL_POWER);
    assert.deepEqual(seen.animations, [{ type: 'healing', hpDuring: 10 }], 'HP rises after the light, with the number');
    assert.deepEqual(seen.shown, [[10 + HEAL_POWER, 40]]);
  });

  it('never heals past the maximum HP', async () => {
    const { player } = setup(45);
    await player.heal(HEAL_POWER);
    assert.equal(player.hp, player.maxHp);
  });

  it('casts the healing spell (left, right, left) as the same heal, by its English or Japanese name', async () => {
    for (const name of ['HEALING', '回復']) {
      const { player, seen } = setup(20);
      await player.castSpell(name);
      assert.equal(player.hp, 20 + HEAL_POWER, name);
      assert.equal(seen.logs[0], '💚 回復魔法を詠唱中...');
      assert.deepEqual(seen.animations.map((a) => a.type), ['healing']);
    }
  });
});
