import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BATTLE_ANIMATIONS, playBattleAnimation, spellAnimation } from '../../components/features/PSchool/game/battleAnimations.js';
import { lightningPath } from '../../components/features/PSchool/game/battleEffects.js';

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../components/features/PSchool/game');

/**
 * A stand-in for a Phaser display object: every method returns the object so calls chain,
 * and any property the code sets is kept. destroy() clears `scene`, as Phaser does.
 */
function fakeObject(created, props = {}) {
  const state = { x: 0, y: 0, scaleX: 1, scaleY: 1, alpha: 1, angle: 0, rotation: 0, displayWidth: 0, displayHeight: 0, scene: {}, ...props };
  const proxy = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      // Data the code reads before it sets it (promise checks, the motion queue, the idle state)
      if (['then', 'motion', 'idleTween', 'idleConfig', 'idleBase', 'destroyed'].includes(key)) return undefined;
      if (key === 'destroy') return () => { target.scene = undefined; target.destroyed = true; return proxy; };
      return () => proxy;
    },
  });
  created.push(proxy);
  return proxy;
}

/** A scene whose tweens and timers finish on the next turn of the event loop. */
function fakeScene() {
  const created = [];
  const listeners = new Map();
  const later = (fn) => setImmediate(fn);
  const make = (props) => fakeObject(created, props);
  const textures = new Set();
  const scene = {
    created,
    scale: { width: 1440, height: 900 },
    playerSprite: make({ x: 360, y: 600, displayWidth: 190, displayHeight: 280 }),
    enemySprite: make({ x: 1060, y: 560, displayWidth: 380, displayHeight: 340 }),
    textures: { exists: (key) => textures.has(key) },
    make: { graphics: () => make({ generateTexture: (key) => textures.add(key) }) },
    add: {
      graphics: () => make(),
      image: () => make(),
      rectangle: () => make(),
      ellipse: () => make(),
      text: () => make(),
      particles: () => make(),
    },
    children: { moveBelow: () => {} },
    cameras: { main: { shake: () => {}, flash: () => {} } },
    events: {
      on: (name, fn) => listeners.set(fn, name),
      off: (name, fn) => listeners.delete(fn),
      once: () => {},
    },
    listenerCount: () => listeners.size,
    time: { timeScale: 1, delayedCall: (ms, fn) => later(fn) },
    tweens: {
      timeScale: 1,
      add: (config) => {
        const targets = [config.targets].flat();
        later(() => {
          for (const [key, value] of Object.entries(config)) {
            if (typeof value === 'number' && !['duration', 'delay', 'repeat', 'hold'].includes(key)) {
              targets.forEach((t) => { t[key] = value; });
            }
          }
          config.onUpdate?.();
          config.onComplete?.();
        });
      },
      addCounter: (config) => later(() => {
        config.onUpdate?.({ getValue: () => config.to });
        config.onComplete?.();
      }),
      killTweensOf: () => {},
    },
  };
  return scene;
}

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(' '));
afterEach(() => { warnings.length = 0; });

describe('P-School battle animations', () => {
  it('has an animation for every type the battle code asks for', () => {
    const asked = new Set();
    for (const file of fs.readdirSync(GAME).filter((name) => name.endsWith('.js'))) {
      const source = fs.readFileSync(path.join(GAME, file), 'utf8');
      for (const [, type] of source.matchAll(/playAnimation\(\s*['"`]([\w-]+)['"`]/g)) asked.add(type);
      // Lookup tables that feed playAnimation (spell name → animation type)
      for (const [, type] of source.matchAll(/['"](magic_\w+|enemyAttack(?:_\w+)?|playerAttack(?:_\w+)?|healing|ice_shield|shield_block)['"]/g)) asked.add(type);
    }
    assert.ok(asked.size >= 10, `found ${asked.size} types`);
    for (const type of asked) assert.ok(BATTLE_ANIMATIONS[type], `${type} has an animation`);
  });

  it('maps spell names in English and Japanese to an animation', () => {
    assert.equal(spellAnimation('FIRE'), 'magic_fire');
    assert.equal(spellAnimation('ライデン'), 'magic_raiden');
    assert.equal(spellAnimation('回復'), 'healing');
    assert.equal(spellAnimation('UNKNOWN', 'magic_flash'), 'magic_flash');
    for (const type of ['FIRE', 'ICE', 'THUNDER', 'WATER', 'RAIDEN', 'HEALING', 'FLASH'].map((s) => spellAnimation(s))) {
      assert.ok(BATTLE_ANIMATIONS[type], `${type} exists`);
    }
  });

  it('plays every animation to the end, cleans up its effects and stops its update listeners', async () => {
    for (const type of Object.keys(BATTLE_ANIMATIONS)) {
      const scene = fakeScene();
      assert.equal(await playBattleAnimation(scene, type), true, type);
      assert.deepEqual(warnings, [], `${type} ran without errors`);
      // Let the trailing fades and particle clean-ups run
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(scene.listenerCount(), 0, `${type} leaves no update listener behind`);
      const effects = scene.created.slice(2);
      const kept = effects.filter((object) => !object.destroyed);
      // The textures' throwaway graphics are destroyed too; the only thing allowed to stay is the ice shield
      // on a stage that keeps it, which this scene does not.
      assert.equal(kept.length, 0, `${type} destroys all ${effects.length} effect objects (${kept.length} left)`);
    }
  });

  it('plays every animation with reduced motion too, without shaking or flashing the screen', async () => {
    globalThis.window = { matchMedia: () => ({ matches: true }) };
    try {
      for (const type of Object.keys(BATTLE_ANIMATIONS)) {
        const scene = fakeScene();
        let cameraFx = 0;
        scene.cameras.main = { shake: () => { cameraFx += 1; }, flash: () => { cameraFx += 1; } };
        assert.equal(await playBattleAnimation(scene, type), true, type);
        assert.deepEqual(warnings, [], `${type} ran without errors`);
        assert.equal(cameraFx, 0, `${type} does not shake or flash`);
      }
    } finally {
      delete globalThis.window;
    }
  });

  it('keeps the ice shield up on a stage that blocks with it, then shatters it', async () => {
    const scene = fakeScene();
    scene.keepsIceShield = true;
    scene.iceShieldActive = true;
    await playBattleAnimation(scene, 'ice_shield');
    assert.ok(scene.iceShieldWall?.g && !scene.iceShieldWall.g.destroyed, 'the wall stays after the cast');
    const wall = scene.iceShieldWall.g;
    await playBattleAnimation(scene, 'shield_block');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(scene.iceShieldWall, null);
    assert.ok(wall.destroyed, 'the block shatters the same wall');
  });

  it('waits a little and moves on when the type is unknown', async () => {
    const scene = fakeScene();
    const log = console.log;
    console.log = () => {};
    try {
      assert.equal(await playBattleAnimation(scene, 'no_such_animation'), false);
    } finally {
      console.log = log;
    }
  });

  it('draws a jagged lightning path that starts and ends where it is told', () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const points = lightningPath(100, 0, 140, 400, { depth: 5, random });
    assert.equal(points.length, 2 ** 5 + 1);
    assert.deepEqual(points[0], { x: 100, y: 0 });
    assert.deepEqual(points.at(-1), { x: 140, y: 400 });
    const offsets = points.map((p) => Math.abs(p.x - (100 + (40 * p.y) / 400)));
    assert.ok(Math.max(...offsets) > 5, 'the bolt zigzags');
    assert.ok(Math.max(...offsets) < 400 * 0.25, 'but stays near the straight line');
  });
});

process.on('exit', () => { console.warn = originalWarn; });
