// battleAnimations.js - 攻撃・魔法・回復などの演出（BattleScene.playAnimation の中身）
//
// どの演出も「ため → 発動 → 命中 → 余韻」の順に組み立てる。命中の少しあとで resolve し、
// 余韻（粒が消える、煙が上がるなど）は待たずに続ける。呼び出し側は resolve のあとで HP を減らすので、
// ダメージの数字が命中とほぼ同時に出る。
// 大きさはキャラクターの表示の高さから決めるので、ステージ1（元の配置）でも新しい画像のステージでも合う。

import { castPose, dodge, hitReact, lunge, restoreTint } from './characterMotion.js';
import {
  beam, burst, clawMarks, dimScreen, drawLightning, ensureFxTextures, fadeAndDestroy, flashScreen, glowPop,
  magicCircle, orb, progress, projectile, reducedMotion, SceneEndedError, shake, shockRing, slashArc, stopTrail, trail, wait,
} from './battleEffects.js';

const FIRE = [0xff8c1a, 0xffc93a, 0xff4a12];
const ICE = [0x9fe8ff, 0xe8fbff, 0x5fc8ff];
const THUNDER = [0xfff27a, 0xffffff, 0xffd23a];
const WATER = [0x4aa8ff, 0x9fd6ff, 0x2f7bff];
const HEAL = [0x7dff9a, 0xd4ffb0, 0xffffff];
const POISON = [0xb04dff, 0x7dff6a, 0x8a2be2];
const SHADOW = [0x6b2fb3, 0x2a0f4d, 0xb07dff];
const ARCANE = [0xc77dff, 0x7de3ff, 0xf0c8ff];
const WIND = [0x9dffcf, 0xe6fff4, 0x5fe0a8];
const EARTH = [0x7a5a38, 0xa8865a, 0x4e3a24];
const DIGITAL = [0x39ff88, 0x2ad1ff, 0xd6ffe6];

/**
 * 主人公と敵の位置と大きさ（スプライトが読み込めずに図形で代用されていても動くように）。
 * opts.dodge が true なら、敵は攻撃をよける（enemyReact を参照）。
 */
function anchors(scene, opts = {}) {
  const P = scene.playerSprite;
  const E = scene.enemySprite;
  const { width, height } = scene.scale;
  const ph = P?.displayHeight || height * 0.3;
  const pw = P?.displayWidth || ph * 0.7;
  const eh = E?.displayHeight || height * 0.3;
  const ew = E?.displayWidth || eh;
  const px = P?.x ?? width * 0.25;
  const py = P?.y ?? height * 0.67;
  const ex = E?.x ?? width * 0.75;
  const ey = E?.y ?? height * 0.6;
  // 地面の高さは足元の影から取る（宙に浮く敵は、絵の下端より影のほうが下にある）
  const groundOf = (role) => scene.shadows?.find((shadow) => shadow.role === role)?.shape?.y;
  return {
    P, E, ph, pw, eh, ew,
    dodge: Boolean(opts.dodge),
    hero: { x: px, y: py },
    enemy: { x: ex, y: ey },
    // 杖の先（主人公の絵は右手で杖を掲げている）
    hand: { x: px + pw * 0.28, y: py - ph * 0.22 },
    heroFeet: { x: px, y: groundOf('player') ?? py + ph * 0.46 },
    enemyFeet: { x: ex, y: groundOf('enemy') ?? ey + eh * 0.46 },
    // 盾を出す位置（主人公の前）
    guard: { x: px + pw * 0.62, y: py },
    // 敵の口や手（主人公側の端）
    enemyFront: { x: ex - ew * 0.3, y: ey - eh * 0.1 },
    // エフェクトの大きさの基準（新しい画像の主人公の高さ 270px 前後を 1 とする）
    sp: Math.max(0.55, Math.min(1.6, ph / 270)),
    se: Math.max(0.55, Math.min(1.8, eh / 270)),
  };
}

const scaled = (values, s) => values.map((v) => v * s);

/** 魔法を唱える：足元の魔法陣と、杖の先にふくらむ光。唱え終わりに endSpell へ渡す。 */
async function chargeSpell(scene, a, { color, core = 0xffffff, ms = 280 }) {
  const circle = magicCircle(scene, a.heroFeet.x, a.heroFeet.y, { radius: a.pw * 0.75, color });
  castPose(scene, a.P, { color });
  const glow = orb(scene, a.hand.x, a.hand.y, { size: 30 * a.sp, color, core });
  glow.parts.forEach((part) => {
    const full = part.scaleX;
    part.setScale(full * 0.2);
    scene.tweens.add({ targets: part, scaleX: full, scaleY: full, duration: ms, ease: 'Quad.easeOut' });
  });
  // まわりから光の粒が杖の先へ集まる
  burst(scene, a.hand.x, a.hand.y, {
    texture: 'fx-spark', count: 10, speed: [30, 90], lifespan: [300, 500], scale: [0.5 * a.sp, 0], tint: [color, core], gravityY: -60,
  });
  await wait(scene, ms);
  return { circle, glow };
}

/** 唱え終わり：魔法陣と光を消す。 */
function endSpell(scene, charge) {
  charge.circle.stop();
  fadeAndDestroy(scene, charge.glow.parts, { duration: 160 });
}

/** 命中した場所の光と火花（共通）。size はおおよその広がり（px）。 */
function impactFlash(scene, x, y, { colors, size, sparks = 20, ring = true }) {
  glowPop(scene, x, y, { size: size * 1.2, color: colors[0], duration: 320 });
  glowPop(scene, x, y, { size: size * 0.6, color: 0xffffff, duration: 220 });
  if (ring) shockRing(scene, x, y, { radius: size * 0.25, color: colors[0], width: 5 });
  burst(scene, x, y, { count: sparks, speed: scaled([140, 420], size / 160), lifespan: [220, 480], scale: [0.7, 0], tint: [...colors, 0xffffff] });
}

/** 足元から舞い上がる土ぼこり。 */
function dust(scene, x, y, s) {
  burst(scene, x, y, {
    texture: 'fx-glow', count: 8, speed: scaled([40, 110], s), angle: [190, 350], lifespan: [400, 700],
    scale: [0.5 * s, 1.1 * s], alpha: [0.35, 0], tint: [0x8a7a66, 0xb3a58f], blend: 'NORMAL', gravityY: -20,
  });
}

/** 爆発：光・輪・火の粉・煙。 */
function explosion(scene, x, y, s, colors = FIRE) {
  glowPop(scene, x, y, { size: 260 * s, color: colors[0], duration: 420, to: 1.6 });
  glowPop(scene, x, y, { size: 120 * s, color: 0xfff3c4, duration: 260 });
  shockRing(scene, x, y, { radius: 50 * s, color: colors[1], width: 6, duration: 420 });
  burst(scene, x, y, {
    texture: 'fx-glow', count: 26, speed: scaled([120, 380], s), lifespan: [380, 760], scale: [0.55 * s, 0], tint: colors, gravityY: -140,
  });
  burst(scene, x, y, {
    texture: 'fx-spark', count: 14, speed: scaled([220, 520], s), lifespan: [200, 420], scale: [0.6, 0], tint: [0xffffff, colors[1]],
  });
  // 煙は光が引いてから立ちのぼる（最初から出すと爆発の真ん中が黒く抜けて見える）
  scene.time.delayedCall(160, () => burst(scene, x, y - 20 * s, {
    texture: 'fx-glow', count: 9, speed: scaled([30, 90], s), angle: [220, 320], lifespan: [800, 1200],
    scale: [0.5 * s, 1.8 * s], alpha: [0.3, 0], tint: [0x4a4440, 0x6b625a], blend: 'NORMAL', gravityY: -90,
  }));
}

/** 水しぶき（水の魔法と敵の水攻撃で共通）。center は当たった所、feet は足元。 */
function splash(scene, center, feet, h, w, s) {
  glowPop(scene, center.x, center.y, { size: h * 0.9, color: WATER[1], duration: 320 });
  burst(scene, center.x, center.y, {
    texture: 'fx-drop', count: 26, speed: scaled([220, 460], s), angle: [200, 340], lifespan: [500, 850],
    scale: [0.9 * s, 0.4], alpha: [0.95, 0], tint: WATER, gravityY: 1100, blend: 'NORMAL', rotate: true,
  });
  shockRing(scene, feet.x, feet.y, { radius: w * 0.4, color: WATER[1], flatten: 0.3, duration: 520 });
  burst(scene, center.x, center.y + h * 0.2, {
    texture: 'fx-ring', count: 10, speed: [20, 60], angle: [250, 290], lifespan: [700, 1100], scale: [0.3, 0.7], alpha: [0.8, 0], tint: [0xcfeeff], gravityY: -120,
  });
}

/**
 * (x, y) を通る斜めの斬撃（ゆるく曲がった弧）。down が 1 なら左上→右下、-1 なら右上→左下。
 * 弧の中心を斜め上に置くと、(x, y) での向きが斜めになる。length はおおよその長さ。
 */
function diagonalSlash(scene, x, y, { length, down = 1, color, width, duration = 110 }) {
  const r = length;
  const sweep = 1.0;
  const k = Math.SQRT1_2;
  if (down === 1) {
    return slashArc(scene, x + r * k, y - r * k, { radius: r, start: (3 * Math.PI) / 4 + sweep / 2, sweep, anticlockwise: true, color, width, duration });
  }
  return slashArc(scene, x - r * k, y - r * k, { radius: r, start: Math.PI / 4 - sweep / 2, sweep, color, width, duration });
}

/** 主人公が攻撃を受ける（光・のけぞり・揺れ）。 */
function heroHit(scene, a, { colors, tint, size = 140, sparks = 16, distance = 22, shakeMs = 160, shakeAmount = 0.01 }) {
  impactFlash(scene, a.hero.x, a.hero.y, { colors, size: size * a.sp, sparks });
  hitReact(scene, a.P, { direction: -1, distance, tint });
  shake(scene, shakeMs, shakeAmount);
}

/** 敵が攻撃を受ける。よける敵（ステージ9の影など）なら、薄くなって横へすべる。 */
function enemyReact(scene, a, opts) {
  if (a.dodge) return dodge(scene, a.E, { direction: 1, distance: a.ew * 0.2 });
  return hitReact(scene, a.E, opts);
}

/** 敵が少し前に出てから戻る（飛び道具や息を放つ前の動き）。 */
function enemyWindup(scene, a, distance = 0.08) {
  return lunge(scene, a.E, { direction: -1, distance: Math.max(30, (a.enemy.x - a.hero.x) * distance) });
}

/** 敵が飛び道具を撃つ。着いたら resolve。 */
async function enemyShot(scene, a, { colors, core = 0xffffff, size = 40, arc = -50, duration = 360, trailConfig, to = a.hero }) {
  await enemyWindup(scene, a);
  await projectile(scene, a.enemyFront, to, {
    size: size * a.se, color: colors[0], core, duration, arc,
    trailConfig: trailConfig ?? { tint: colors, scale: [(size / 95) * a.se, 0], lifespan: 340, gravityY: -40 },
  });
}

/** 主人公の前に出る氷の盾（縦長の六角形）。 */
function iceWall(scene, a) {
  const h = a.ph * 0.95;
  const w = a.ph * 0.32;
  const g = scene.add.graphics({ x: a.guard.x, y: a.guard.y }).setBlendMode('ADD');
  const pts = [[0, -h / 2], [w / 2, -h / 4], [w / 2, h / 4], [0, h / 2], [-w / 2, h / 4], [-w / 2, -h / 4]].map(([x, y]) => ({ x, y }));
  g.fillStyle(ICE[0], 0.22);
  g.fillPoints(pts, true);
  g.lineStyle(4, ICE[1], 0.95);
  g.strokePoints(pts, true);
  g.lineStyle(2, ICE[2], 0.7);
  g.lineBetween(0, -h / 2, 0, h / 2);
  g.lineBetween(-w / 2, -h / 4, w / 2, h / 4);
  g.lineBetween(-w / 2, h / 4, w / 2, -h / 4);
  return { g, h, w };
}

/** 氷の盾が砕ける。 */
function shatter(scene, wall, s) {
  burst(scene, wall.g.x, wall.g.y, {
    texture: 'fx-shard', count: 22, speed: scaled([160, 420], s), lifespan: [400, 800], scale: [1.1 * s, 0.2], tint: ICE, rotate: true, gravityY: 500,
  });
  glowPop(scene, wall.g.x, wall.g.y, { size: wall.h * 0.9, color: ICE[0], duration: 300 });
  fadeAndDestroy(scene, wall.g, { duration: 120, scale: 1.15 });
}

/** 稲妻を落とす（2回光る）。落ちきったら resolve。 */
async function lightningStrike(scene, { from, to, width }) {
  let bolt = drawLightning(scene, from.x, from.y, to.x, to.y, { width, branches: 3 });
  flashScreen(scene, 90, 255, 255, 200);
  if (!reducedMotion()) {
    await wait(scene, 60);
    bolt.setAlpha(0.15);
    await wait(scene, 40);
    bolt.destroy();
    bolt = drawLightning(scene, from.x, from.y, to.x, to.y, { width: width * 1.2, branches: 4 });
  }
  fadeAndDestroy(scene, bolt, { duration: 220, delay: reducedMotion() ? 200 : 90 });
}

export const BATTLE_ANIMATIONS = {
  /** 主人公の攻撃：踏み込んで斜めの斬撃、火花、敵ののけぞり。 */
  async playerAttack(scene, opts) {
    const a = anchors(scene, opts);
    await lunge(scene, a.P, {
      direction: 1,
      distance: Math.max(60, (a.enemy.x - a.hero.x) * 0.3),
      onImpact: () => {
        const length = Math.max(80, a.eh * 0.9);
        diagonalSlash(scene, a.enemy.x, a.enemy.y, { length, color: 0xbfe9ff, width: 13 * a.se });
        // 少し遅れて細い残像の線
        scene.time.delayedCall(40, () => diagonalSlash(scene, a.enemy.x + 10 * a.se, a.enemy.y - 14 * a.se, { length: length * 0.85, color: 0xffffff, width: 4 * a.se }));
        impactFlash(scene, a.enemy.x, a.enemy.y, { colors: [0xfff3b0, 0xbfe9ff], size: 150 * a.se, sparks: 18 });
        dust(scene, a.enemyFeet.x, a.enemyFeet.y, a.se);
        enemyReact(scene, a, { direction: 1 });
        shake(scene, 110, 0.006);
      },
    });
  },

  /** 主人公の連続攻撃（会心・連携など）：踏み込んで十字に二度斬る。 */
  async playerAttack_combo(scene, opts) {
    const a = anchors(scene, opts);
    await lunge(scene, a.P, {
      direction: 1,
      distance: Math.max(70, (a.enemy.x - a.hero.x) * 0.34),
      onImpact: () => {
        const length = Math.max(80, a.eh * 0.85);
        diagonalSlash(scene, a.enemy.x, a.enemy.y, { length, color: 0xffe28a, width: 10 * a.se });
        scene.time.delayedCall(110, () => {
          diagonalSlash(scene, a.enemy.x, a.enemy.y, { length, down: -1, color: 0xffe28a, width: 10 * a.se });
          impactFlash(scene, a.enemy.x, a.enemy.y, { colors: [0xffd75a, 0xffffff], size: 200 * a.se, sparks: 26 });
          shake(scene, 180, 0.012);
        });
        impactFlash(scene, a.enemy.x, a.enemy.y, { colors: [0xfff3b0, 0xffd75a], size: 140 * a.se, sparks: 14, ring: false });
        dust(scene, a.enemyFeet.x, a.enemyFeet.y, a.se);
        enemyReact(scene, a, { direction: 1, distance: 30, tint: 0xffd75a });
      },
    });
    await wait(scene, 120);
  },

  /** 攻撃が防がれる（装甲・盾）：斬撃が金属に当たって火花を散らし、敵はびくともしない。 */
  async playerAttack_blocked(scene, opts) {
    const a = anchors(scene, opts);
    await lunge(scene, a.P, {
      direction: 1,
      distance: Math.max(60, (a.enemy.x - a.hero.x) * 0.3),
      onImpact: () => {
        const at = { x: a.enemy.x - a.ew * 0.25, y: a.enemy.y };
        diagonalSlash(scene, at.x, at.y, { length: a.eh * 0.45, color: 0xd8e6ff, width: 7 * a.se, duration: 70 });
        // 白い火花が手前へはね返り、金属の音のような輪が広がる
        burst(scene, at.x, at.y, { count: 22, speed: scaled([200, 480], a.se), angle: [120, 240], lifespan: [200, 420], scale: [0.6, 0], tint: [0xffffff, 0xfff1a0, 0xbfe9ff], gravityY: 500 });
        shockRing(scene, at.x, at.y, { radius: a.eh * 0.12, color: 0xffffff, width: 4, scale: 2, duration: 260 });
        glowPop(scene, at.x, at.y, { size: 80 * a.se, color: 0xffffff, duration: 180 });
        shake(scene, 80, 0.004);
      },
    });
    await wait(scene, 100);
  },

  /** 敵の攻撃：踏み込んで爪あと、赤い火花、主人公ののけぞり。 */
  async enemyAttack(scene, opts) {
    const a = anchors(scene, opts);
    await lunge(scene, a.E, {
      direction: -1,
      distance: Math.max(60, (a.enemy.x - a.hero.x) * 0.3),
      onImpact: () => {
        clawMarks(scene, a.hero.x, a.hero.y - a.ph * 0.05, { size: a.ph * 0.55, color: 0xff4d4d, direction: -1 });
        heroHit(scene, a, { colors: [0xff5a4a, 0xffb36b], tint: 0xff4040 });
        dust(scene, a.heroFeet.x, a.heroFeet.y, a.sp);
      },
    });
  },

  /** 敵の剣の攻撃：踏み込んで斜めに斬る。 */
  async enemyAttack_sword(scene, opts) {
    const a = anchors(scene, opts);
    await lunge(scene, a.E, {
      direction: -1,
      distance: Math.max(60, (a.enemy.x - a.hero.x) * 0.32),
      onImpact: () => {
        diagonalSlash(scene, a.hero.x, a.hero.y, { length: a.ph * 0.7, down: -1, color: 0xd8e6ff, width: 9 * a.sp });
        heroHit(scene, a, { colors: [0xd8e6ff, 0xff6b5a], tint: 0xff4040, sparks: 20 });
        dust(scene, a.heroFeet.x, a.heroFeet.y, a.sp);
      },
    });
  },

  /** 炎の魔法：魔法陣と溜め → 火の玉が火の粉を引いて飛ぶ → 爆発と煙。 */
  async magic_fire(scene, opts) {
    const a = anchors(scene, opts);
    const charge = await chargeSpell(scene, a, { color: FIRE[0], core: 0xfff0c0 });
    endSpell(scene, charge);
    await projectile(scene, a.hand, a.enemy, {
      size: 46 * a.sp, color: FIRE[0], core: 0xfff0c0, duration: 430, arc: -0.22 * (a.enemy.x - a.hand.x),
      trailConfig: { tint: FIRE, scale: [0.42 * a.sp, 0], lifespan: 380, gravityY: -70, speed: [10, 50] },
    });
    explosion(scene, a.enemy.x, a.enemy.y, a.se);
    enemyReact(scene, a, { direction: 1, distance: 26, tint: 0xff5a1a });
    shake(scene, 220, 0.012);
    await wait(scene, 160);
  },

  /** 氷の魔法（攻撃）：氷のかけらが次々に飛び、敵が凍りつく。 */
  async magic_ice(scene, opts) {
    const a = anchors(scene, opts);
    const charge = await chargeSpell(scene, a, { color: ICE[0], ms: 240 });
    endSpell(scene, charge);
    const flights = Array.from({ length: 5 }, async (_, i) => {
      await wait(scene, i * 70);
      const from = { x: a.hand.x, y: a.hand.y + (i - 2) * 14 * a.sp };
      const to = { x: a.enemy.x + (Math.random() - 0.5) * a.ew * 0.35, y: a.enemy.y + (Math.random() - 0.5) * a.eh * 0.35 };
      const shard = scene.add.image(from.x, from.y, 'fx-shard').setTint(ICE[i % 3]).setBlendMode('ADD');
      shard.setDisplaySize(12 * a.sp, 38 * a.sp).setRotation(Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2);
      const tail = trail(scene, shard, { tint: ICE, scale: [0.22 * a.sp, 0], lifespan: 220, frequency: 24 });
      await progress(scene, {
        duration: 300, ease: 'Quad.easeIn',
        onUpdate: (p) => shard.setPosition(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p),
      });
      stopTrail(scene, tail);
      shard.destroy();
      burst(scene, to.x, to.y, { count: 6, speed: [80, 200], lifespan: [200, 380], scale: [0.5, 0], tint: ICE });
    });
    await Promise.all(flights);
    // 凍りつく：氷の結晶がはじけ、足元に霜の輪、雪がちらつく
    glowPop(scene, a.enemy.x, a.enemy.y, { size: a.eh * 1.1, color: ICE[0], duration: 420 });
    burst(scene, a.enemy.x, a.enemy.y, {
      texture: 'fx-shard', count: 16, speed: scaled([120, 320], a.se), lifespan: [380, 700], scale: [0.9 * a.se, 0], tint: ICE, rotate: true,
    });
    shockRing(scene, a.enemyFeet.x, a.enemyFeet.y, { radius: a.ew * 0.35, color: ICE[1], flatten: 0.3, duration: 520 });
    burst(scene, a.enemy.x, a.enemy.y - a.eh * 0.4, {
      count: 14, speed: [20, 70], angle: [60, 120], lifespan: [700, 1100], scale: [0.45, 0], tint: [0xffffff, ICE[0]], gravityY: 40,
    });
    enemyReact(scene, a, { direction: 1, distance: 16, tint: 0x8fe3ff });
    shake(scene, 140, 0.006);
    await wait(scene, 140);
  },

  /**
   * 氷の盾（防御）：主人公の前に氷の壁が立ち上がる。
   * 盾で攻撃を防ぐステージ（keepsIceShield）では、防ぐまで薄く残し、shield_block で砕く。
   */
  async ice_shield(scene, opts) {
    const a = anchors(scene, opts);
    const charge = await chargeSpell(scene, a, { color: ICE[0], ms: 220 });
    endSpell(scene, charge);
    const old = scene.iceShieldWall;
    scene.iceShieldWall = null;
    if (old?.g?.scene) {
      // 前の盾のゆらめき（くり返しの tween）を止めてから消す
      scene.tweens.killTweensOf(old.g);
      fadeAndDestroy(scene, old.g, { duration: 160 });
    }
    const wall = iceWall(scene, a);
    wall.g.setScale(1, 0.05);
    burst(scene, a.guard.x, a.guard.y + wall.h / 2, {
      texture: 'fx-shard', count: 12, speed: [60, 180], angle: [240, 300], lifespan: [300, 600], scale: [0.7 * a.sp, 0], tint: ICE, rotate: true,
    });
    await progress(scene, { duration: 260, ease: 'Back.easeOut', onUpdate: (p) => wall.g.setScale(1, 0.05 + 0.95 * p) });
    burst(scene, a.guard.x, a.guard.y, { count: 14, speed: [40, 140], lifespan: [400, 700], scale: [0.5, 0], tint: [0xffffff, ICE[0]] });
    await wait(scene, 360);
    if (scene.keepsIceShield && scene.iceShieldActive) {
      scene.iceShieldWall = wall;
      scene.tweens.add({ targets: wall.g, alpha: { from: 0.55, to: 0.35 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    } else {
      fadeAndDestroy(scene, wall.g, { duration: 360 });
    }
  },

  /** 氷の盾が攻撃を防ぐ（ステージ4）：敵の炎が盾に当たり、盾が砕ける。主人公は無傷。 */
  async shield_block(scene, opts) {
    const a = anchors(scene, opts);
    let wall = scene.iceShieldWall;
    scene.iceShieldWall = null;
    if (wall?.g?.scene) {
      scene.tweens.killTweensOf(wall.g);
    } else {
      wall = iceWall(scene, a);
      wall.g.setAlpha(0);
    }
    scene.tweens.add({ targets: wall.g, alpha: 1, duration: 140 });
    await enemyShot(scene, a, { colors: FIRE, core: 0xfff0c0, to: { x: wall.g.x, y: wall.g.y }, duration: 320, arc: -40 });
    impactFlash(scene, wall.g.x, wall.g.y, { colors: [FIRE[0], ICE[0]], size: 160 * a.sp, sparks: 18 });
    shatter(scene, wall, a.sp);
    shake(scene, 120, 0.006);
    await wait(scene, 200);
  },

  /** 雷の魔法：空が暗くなり、雷雲から稲妻が二度光って落ちる。 */
  async magic_thunder(scene, opts) {
    const a = anchors(scene, opts);
    const veil = dimScreen(scene, { alpha: 0.42 });
    const clouds = [-1, 0, 1].map((k) => {
      const c = scene.add.image(a.enemy.x + k * a.ew * 0.35, 0, 'fx-glow').setTint(0x1c1c33).setAlpha(0);
      c.setDisplaySize(a.ew * 1.1, a.eh * 0.55);
      scene.tweens.add({ targets: c, alpha: 0.9, y: a.eh * 0.12, duration: 300 });
      return c;
    });
    const charge = await chargeSpell(scene, a, { color: THUNDER[0], ms: 300 });
    // 杖から空へ細い稲妻（雷を呼ぶ）
    const call = drawLightning(scene, a.hand.x, a.hand.y, a.hand.x + 20, 0, { width: 3, branches: 1 });
    fadeAndDestroy(scene, call, { duration: 140, delay: 60 });
    endSpell(scene, charge);
    await wait(scene, 120);
    await lightningStrike(scene, { from: { x: a.enemy.x + (Math.random() - 0.5) * 40, y: 0 }, to: a.enemy, width: 11 * a.se });
    impactFlash(scene, a.enemy.x, a.enemy.y, { colors: THUNDER, size: 180 * a.se, sparks: 26 });
    shockRing(scene, a.enemyFeet.x, a.enemyFeet.y, { radius: a.ew * 0.4, color: THUNDER[0], flatten: 0.3, duration: 460 });
    burst(scene, a.enemyFeet.x, a.enemyFeet.y, { count: 12, speed: [200, 420], angle: [200, 340], lifespan: [250, 450], scale: [0.6, 0], tint: THUNDER, gravityY: 600 });
    enemyReact(scene, a, { direction: 1, distance: 20, tint: 0xfff27a });
    shake(scene, 260, 0.016);
    fadeAndDestroy(scene, clouds, { duration: 420, delay: 120 });
    veil.lift(420);
    await wait(scene, 180);
  },

  /** 水の魔法：水の玉がしずくを引いて飛び、水しぶきと泡が上がる。 */
  async magic_water(scene, opts) {
    const a = anchors(scene, opts);
    const charge = await chargeSpell(scene, a, { color: WATER[0], core: 0xe6f6ff });
    endSpell(scene, charge);
    await projectile(scene, a.hand, a.enemy, {
      size: 42 * a.sp, color: WATER[0], core: 0xe6f6ff, duration: 420, arc: -0.18 * (a.enemy.x - a.hand.x), spin: 0.2,
      trailConfig: { texture: 'fx-drop', tint: WATER, scale: [0.9 * a.sp, 0.3], lifespan: 420, gravityY: 520, speed: [10, 60], alpha: [0.9, 0], blend: 'NORMAL' },
    });
    splash(scene, a.enemy, a.enemyFeet, a.eh, a.ew, a.se);
    enemyReact(scene, a, { direction: 1, distance: 22, tint: 0x4aa8ff });
    shake(scene, 160, 0.008);
    await wait(scene, 160);
  },

  /** ライデン（水と雷の合わせ技）：水の渦で敵を包み、そこへ稲妻が落ちて水ごと光る。 */
  async magic_raiden(scene, opts) {
    const a = anchors(scene, opts);
    const veil = dimScreen(scene, { alpha: 0.38 });
    const charge = await chargeSpell(scene, a, { color: WATER[0], core: 0xfff9c4, ms: 300 });
    endSpell(scene, charge);
    await projectile(scene, a.hand, a.enemy, {
      size: 40 * a.sp, color: WATER[0], core: 0xe6f6ff, duration: 380, arc: -0.18 * (a.enemy.x - a.hand.x), spin: 0.25,
      trailConfig: { texture: 'fx-drop', tint: WATER, scale: [0.8 * a.sp, 0.3], lifespan: 380, gravityY: 480, alpha: [0.9, 0], blend: 'NORMAL' },
    });
    // 水の渦（青い輪が敵のまわりで回る）
    const whirl = magicCircle(scene, a.enemy.x, a.enemy.y + a.eh * 0.15, { radius: a.ew * 0.55, color: WATER[1], flatten: 0.45, spin: 0.012 });
    burst(scene, a.enemy.x, a.enemy.y, {
      texture: 'fx-drop', count: 16, speed: scaled([120, 260], a.se), angle: [200, 340], lifespan: [400, 700], scale: [0.8 * a.se, 0.3], tint: WATER, gravityY: 700, blend: 'NORMAL', rotate: true,
    });
    await wait(scene, 220);
    await lightningStrike(scene, { from: { x: a.enemy.x, y: 0 }, to: a.enemy, width: 12 * a.se });
    whirl.stop();
    impactFlash(scene, a.enemy.x, a.enemy.y, { colors: [THUNDER[0], WATER[1], 0xffffff], size: 210 * a.se, sparks: 30 });
    // 水を伝って電気が走る（小さな稲妻を周りへ）
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + Math.random();
      const reach = a.ew * (0.35 + Math.random() * 0.2);
      const spark = drawLightning(scene, a.enemy.x, a.enemy.y, a.enemy.x + Math.cos(angle) * reach, a.enemy.y + Math.sin(angle) * reach * 0.7, { width: 3 * a.se, branches: 0 });
      fadeAndDestroy(scene, spark, { duration: 180, delay: 60 + i * 40 });
    }
    enemyReact(scene, a, { direction: 1, distance: 28, tint: 0xfff27a });
    shake(scene, 300, 0.018);
    veil.lift(420);
    await wait(scene, 200);
  },

  /** 閃光の魔法：杖の光が一気に広がり、敵から光の筋が放たれる。 */
  async magic_flash(scene, opts) {
    const a = anchors(scene, opts);
    const charge = await chargeSpell(scene, a, { color: 0xfff6c8, ms: 320 });
    endSpell(scene, charge);
    flashScreen(scene, 160, 255, 255, 235);
    const rays = scene.add.graphics({ x: a.enemy.x, y: a.enemy.y }).setBlendMode('ADD');
    const count = 12;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const length = a.eh * (0.8 + (i % 2) * 0.35);
      rays.lineStyle(i % 2 ? 4 : 8, 0xfff6c8, 0.85);
      rays.lineBetween(Math.cos(angle) * a.eh * 0.15, Math.sin(angle) * a.eh * 0.15, Math.cos(angle) * length, Math.sin(angle) * length);
    }
    rays.setScale(0.3);
    scene.tweens.add({ targets: rays, scaleX: 1.25, scaleY: 1.25, rotation: 0.35, alpha: 0, duration: 520, ease: 'Cubic.easeOut', onComplete: () => rays.destroy() });
    glowPop(scene, a.enemy.x, a.enemy.y, { size: a.eh * 1.6, color: 0xffffff, duration: 420 });
    burst(scene, a.enemy.x, a.enemy.y, { count: 24, speed: scaled([180, 460], a.se), lifespan: [300, 600], scale: [0.7, 0], tint: [0xffffff, 0xfff1a0] });
    enemyReact(scene, a, { direction: 1, distance: 18, tint: 0xfff6b0 });
    shake(scene, 140, 0.008);
    await wait(scene, 200);
  },

  /** 麻痺の魔法：電気の玉が当たり、光の輪が敵を締めつけ、体に電気が走る。 */
  async magic_paralyze(scene, opts) {
    const a = anchors(scene, opts);
    const charge = await chargeSpell(scene, a, { color: THUNDER[0], core: 0xf0c8ff, ms: 260 });
    endSpell(scene, charge);
    await projectile(scene, a.hand, a.enemy, {
      size: 30 * a.sp, color: THUNDER[2], core: 0xffffff, duration: 320, arc: -40,
      trailConfig: { tint: [THUNDER[0], ARCANE[0]], scale: [0.3 * a.sp, 0], lifespan: 260 },
    });
    glowPop(scene, a.enemy.x, a.enemy.y, { size: a.eh * 0.9, color: THUNDER[0], duration: 300 });
    // 上・中・下の3本の輪が外から締まってくる
    const rings = [-0.25, 0, 0.25].map((k, i) => {
      const g = scene.add.graphics({ x: a.enemy.x, y: a.enemy.y + k * a.eh }).setBlendMode('ADD');
      const w = a.ew * 0.85;
      g.lineStyle(7, THUNDER[0], 0.55);
      g.strokeEllipse(0, 0, w, w * 0.3);
      g.lineStyle(2, 0xffffff, 1);
      g.strokeEllipse(0, 0, w, w * 0.3);
      g.setScale(1.6).setAlpha(0);
      scene.tweens.add({ targets: g, scaleX: 1, scaleY: 1, alpha: 1, duration: 220, delay: i * 70, ease: 'Back.easeIn' });
      return g;
    });
    enemyReact(scene, a, { direction: 1, distance: 10, tint: 0xfff27a });
    // 体に細い電気がぱちぱち走る
    for (let i = 0; i < 6; i += 1) {
      await wait(scene, 70);
      const y = a.enemy.y + (Math.random() - 0.5) * a.eh * 0.6;
      const bolt = drawLightning(scene, a.enemy.x - a.ew * 0.35, y + (Math.random() - 0.5) * 20, a.enemy.x + a.ew * 0.35, y + (Math.random() - 0.5) * 20, { width: 2.5 * a.se, branches: 0 });
      fadeAndDestroy(scene, bolt, { duration: 90 });
    }
    burst(scene, a.enemy.x, a.enemy.y, { count: 14, speed: [80, 220], lifespan: [250, 450], scale: [0.5, 0], tint: [THUNDER[0], ARCANE[0]] });
    fadeAndDestroy(scene, rings, { duration: 320, delay: 120 });
    await wait(scene, 120);
  },

  /** 回復の魔法：緑の魔法陣、光の柱、十字のきらめきが舞い上がる。 */
  async healing(scene, opts) {
    const a = anchors(scene, opts);
    const charge = await chargeSpell(scene, a, { color: HEAL[0], core: 0xf2fff4, ms: 240 });
    const column = scene.add.image(a.hero.x, a.hero.y, 'fx-glow').setTint(HEAL[0]).setBlendMode('ADD').setAlpha(0);
    column.setDisplaySize(a.pw * 0.9, a.ph * 1.5);
    scene.tweens.add({ targets: column, alpha: 0.75, duration: 220, yoyo: true, hold: 260, onComplete: () => column.destroy() });
    for (let i = 0; i < 3; i += 1) {
      burst(scene, a.hero.x + (i - 1) * a.pw * 0.25, a.heroFeet.y - a.ph * 0.05, {
        texture: 'fx-plus', count: 7, speed: [20, 70], angle: [250, 290], lifespan: [700, 1100], scale: [0.9 * a.sp, 0], tint: HEAL, gravityY: -150,
      });
    }
    burst(scene, a.hero.x, a.hero.y, { count: 12, speed: [40, 120], lifespan: [500, 800], scale: [0.5, 0], tint: HEAL, gravityY: -60 });
    shockRing(scene, a.heroFeet.x, a.heroFeet.y, { radius: a.pw * 0.5, color: HEAL[0], flatten: 0.3, duration: 600 });
    if (a.P?.setTint) {
      const kept = a.P.isTinted && !a.P.tintFill ? a.P.tintTopLeft : null;
      a.P.setTint(0xc8ffd2);
      scene.time.delayedCall(520, () => a.P.scene && restoreTint(a.P, kept));
    }
    await wait(scene, 420);
    endSpell(scene, charge);
  },

  /** 敵の毒攻撃：毒の玉を三つ吐き、主人公に毒のしぶきと泡がまとわりつく。 */
  async enemyAttack_poison(scene, opts) {
    const a = anchors(scene, opts);
    await enemyWindup(scene, a);
    const globs = [0, 1, 2].map(async (i) => {
      await wait(scene, i * 90);
      const to = { x: a.hero.x + (i - 1) * a.pw * 0.18, y: a.hero.y - a.ph * 0.1 + (i - 1) * 10 };
      await projectile(scene, a.enemyFront, to, {
        size: 26 * a.se, color: POISON[0], core: 0xe6c8ff, duration: 380, arc: -60 - i * 25,
        trailConfig: { texture: 'fx-drop', tint: POISON, scale: [0.6 * a.se, 0.2], lifespan: 360, gravityY: 400, blend: 'NORMAL', alpha: [0.85, 0] },
      });
      burst(scene, to.x, to.y, { texture: 'fx-drop', count: 8, speed: [120, 260], angle: [200, 340], lifespan: [350, 600], scale: [0.6, 0.2], tint: POISON, gravityY: 900, blend: 'NORMAL' });
    });
    await Promise.all(globs);
    glowPop(scene, a.hero.x, a.hero.y, { size: a.ph * 0.9, color: POISON[0], duration: 360 });
    burst(scene, a.hero.x, a.heroFeet.y - a.ph * 0.2, {
      texture: 'fx-ring', count: 10, speed: [15, 50], angle: [250, 290], lifespan: [700, 1100], scale: [0.25, 0.6], alpha: [0.85, 0], tint: [POISON[0], POISON[1]], gravityY: -110,
    });
    hitReact(scene, a.P, { direction: -1, distance: 16, tint: 0x9900ff });
    shake(scene, 140, 0.008);
    await wait(scene, 120);
  },

  /** 毒がまわる（状態のダメージ）：主人公のまわりに毒の泡がわき、紫に染まる。敵は動かない。 */
  async status_poison(scene, opts) {
    const a = anchors(scene, opts);
    glowPop(scene, a.hero.x, a.hero.y, { size: a.ph * 0.8, color: POISON[0], duration: 420, from: 0.6, to: 1.1, alpha: 0.8 });
    burst(scene, a.hero.x, a.heroFeet.y - a.ph * 0.1, {
      texture: 'fx-ring', count: 14, speed: [20, 60], angle: [240, 300], lifespan: [600, 1000], scale: [0.2, 0.6], alpha: [0.9, 0], tint: [POISON[0], POISON[1]], gravityY: -120,
    });
    burst(scene, a.hero.x, a.hero.y, { texture: 'fx-drop', count: 8, speed: [40, 120], angle: [200, 340], lifespan: [300, 500], scale: [0.5, 0.2], tint: POISON, gravityY: 600, blend: 'NORMAL' });
    hitReact(scene, a.P, { direction: -1, distance: 8, tint: 0xb04dff });
    await wait(scene, 380);
  },

  /** 敵の雷攻撃：主人公の頭上に雷雲がわき、稲妻が落ちる。 */
  async enemyAttack_thunder(scene, opts) {
    const a = anchors(scene, opts);
    await enemyWindup(scene, a, 0.05);
    const cloud = scene.add.image(a.hero.x, 0, 'fx-glow').setTint(0x1c1c33).setAlpha(0);
    cloud.setDisplaySize(a.pw * 2.2, a.ph * 0.5);
    scene.tweens.add({ targets: cloud, alpha: 0.9, y: a.ph * 0.1, duration: 240 });
    await wait(scene, 240);
    await lightningStrike(scene, { from: { x: a.hero.x + (Math.random() - 0.5) * 30, y: 0 }, to: a.hero, width: 10 * a.sp });
    heroHit(scene, a, { colors: THUNDER, tint: 0xfff27a, size: 170, sparks: 22, shakeMs: 240, shakeAmount: 0.014 });
    shockRing(scene, a.heroFeet.x, a.heroFeet.y, { radius: a.pw * 0.5, color: THUNDER[0], flatten: 0.3, duration: 420 });
    fadeAndDestroy(scene, cloud, { duration: 360, delay: 120 });
    await wait(scene, 160);
  },

  /** 敵の炎攻撃：敵が身をかがめ、火の玉が主人公で爆発する。 */
  async enemyAttack_fire(scene, opts) {
    const a = anchors(scene, opts);
    await enemyShot(scene, a, {
      colors: FIRE, core: 0xfff0c0, size: 48,
      trailConfig: { tint: FIRE, scale: [0.42 * a.se, 0], lifespan: 360, gravityY: -70 },
    });
    explosion(scene, a.hero.x, a.hero.y, a.sp);
    hitReact(scene, a.P, { direction: -1, distance: 26, tint: 0xff6600 });
    shake(scene, 240, 0.014);
    await wait(scene, 140);
  },

  /** 敵の水攻撃：水の玉が主人公ではじける。 */
  async enemyAttack_water(scene, opts) {
    const a = anchors(scene, opts);
    await enemyShot(scene, a, {
      colors: WATER, core: 0xe6f6ff, size: 42,
      trailConfig: { texture: 'fx-drop', tint: WATER, scale: [0.8 * a.se, 0.3], lifespan: 380, gravityY: 480, alpha: [0.9, 0], blend: 'NORMAL' },
    });
    splash(scene, a.hero, a.heroFeet, a.ph, a.pw, a.sp);
    hitReact(scene, a.P, { direction: -1, distance: 22, tint: 0x4aa8ff });
    shake(scene, 160, 0.008);
    await wait(scene, 140);
  },

  /** 敵の風攻撃：三日月形の風の刃が三つ飛んでくる。 */
  async enemyAttack_wind(scene, opts) {
    const a = anchors(scene, opts);
    await enemyWindup(scene, a);
    const blades = [0, 1, 2].map(async (i) => {
      await wait(scene, i * 80);
      const from = { x: a.enemyFront.x, y: a.enemyFront.y + (i - 1) * a.eh * 0.18 };
      const to = { x: a.hero.x, y: a.hero.y + (i - 1) * a.ph * 0.15 };
      const r = a.ph * 0.22;
      const g = scene.add.graphics({ x: from.x, y: from.y }).setBlendMode('ADD');
      [[r * 0.22, WIND[0], 0.4], [r * 0.1, WIND[1], 0.95]].forEach(([w, c, alpha]) => {
        g.lineStyle(w, c, alpha);
        g.beginPath();
        g.arc(0, 0, r, Math.PI * 0.6, Math.PI * 1.4);
        g.strokePath();
      });
      const tail = trail(scene, g, { tint: WIND, scale: [0.3 * a.sp, 0], lifespan: 260, alpha: [0.6, 0] });
      await progress(scene, {
        duration: 320, ease: 'Quad.easeIn',
        onUpdate: (p) => g.setPosition(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p),
      });
      stopTrail(scene, tail);
      fadeAndDestroy(scene, g, { duration: 120, scale: 1.4 });
      burst(scene, to.x, to.y, { count: 8, speed: [120, 260], angle: [120, 240], lifespan: [250, 450], scale: [0.5, 0], tint: WIND });
    });
    await Promise.all(blades);
    heroHit(scene, a, { colors: WIND, tint: 0x9dffcf, sparks: 12 });
    burst(scene, a.hero.x, a.hero.y, {
      texture: 'fx-glow', count: 10, speed: [80, 200], angle: [150, 210], lifespan: [400, 700], scale: [0.4 * a.sp, 0.9 * a.sp], alpha: [0.35, 0], tint: [WIND[1]],
    });
    await wait(scene, 120);
  },

  /** 敵の地の攻撃：地面を割る衝撃が走り、主人公の足元から岩が突き上がる。 */
  async enemyAttack_earth(scene, opts) {
    const a = anchors(scene, opts);
    await lunge(scene, a.E, { direction: -1, distance: 30 });
    shake(scene, 420, 0.012);
    // 敵から主人公へ、地面の上を土けむりと小石が走る
    const steps = 5;
    for (let i = 1; i <= steps; i += 1) {
      const x = a.enemyFeet.x + (a.heroFeet.x - a.enemyFeet.x) * (i / steps);
      dust(scene, x, a.heroFeet.y, a.sp);
      burst(scene, x, a.heroFeet.y, {
        texture: 'fx-rock', count: 5, speed: [100, 220], angle: [240, 300], lifespan: [350, 550], scale: [1.3 * a.sp, 0.6], tint: EARTH, gravityY: 900, blend: 'NORMAL', rotate: true,
      });
      await wait(scene, 60);
    }
    shockRing(scene, a.heroFeet.x, a.heroFeet.y, { radius: a.pw * 0.5, color: EARTH[1], flatten: 0.3, duration: 480, alpha: 0.8 });
    burst(scene, a.heroFeet.x, a.heroFeet.y, {
      texture: 'fx-rock', count: 20, speed: scaled([280, 560], a.sp), angle: [240, 300], lifespan: [550, 850], scale: [2.4 * a.sp, 1], tint: EARTH, gravityY: 1200, blend: 'NORMAL', rotate: true,
    });
    heroHit(scene, a, { colors: [EARTH[1], 0xffe0a8], tint: 0xc9a77a, sparks: 10, distance: 18, shakeMs: 200, shakeAmount: 0.016 });
    await wait(scene, 160);
  },

  /** 敵の咆哮：口元から衝撃の輪が何重にも広がり、主人公が押される。 */
  async enemyAttack_roar(scene, opts) {
    const a = anchors(scene, opts);
    await enemyWindup(scene, a, 0.05);
    for (let i = 0; i < 4; i += 1) {
      shockRing(scene, a.enemyFront.x, a.enemyFront.y, { radius: a.eh * 0.2, color: 0xffd0a0, width: 6, scale: 4.2, duration: 600, flatten: 0.8, alpha: 0.75 });
      if (i === 1) shake(scene, 360, 0.014);
      await wait(scene, 90);
    }
    heroHit(scene, a, { colors: [0xffd0a0, 0xff8c5a], tint: 0xffb07a, sparks: 10, distance: 30 });
    dust(scene, a.heroFeet.x, a.heroFeet.y, a.sp);
    await wait(scene, 120);
  },

  /** 敵の魔法攻撃：魔法陣から紫の光弾が飛んでくる。 */
  async enemyAttack_magic(scene, opts) {
    const a = anchors(scene, opts);
    const circle = magicCircle(scene, a.enemyFeet.x, a.enemyFeet.y, { radius: a.ew * 0.5, color: ARCANE[0], spin: 0.005 });
    glowPop(scene, a.enemyFront.x, a.enemyFront.y, { size: 90 * a.se, color: ARCANE[0], duration: 360, from: 0.2, to: 1 });
    await wait(scene, 260);
    circle.stop();
    await projectile(scene, a.enemyFront, a.hero, {
      size: 38 * a.se, color: ARCANE[0], core: ARCANE[2], duration: 380, arc: -60, spin: 0.15,
      trailConfig: { tint: ARCANE, scale: [0.4 * a.se, 0], lifespan: 340, speed: [10, 40] },
    });
    heroHit(scene, a, { colors: ARCANE, tint: 0xc77dff, sparks: 22 });
    shockRing(scene, a.hero.x, a.hero.y, { radius: a.ph * 0.18, color: ARCANE[1], width: 4, scale: 3, duration: 420 });
    await wait(scene, 120);
  },

  /** 敵の光線：敵が光をため、まっすぐな光線が主人公を貫く。 */
  async enemyAttack_beam(scene, opts) {
    const a = anchors(scene, opts);
    const glow = orb(scene, a.enemyFront.x, a.enemyFront.y, { size: 24 * a.se, color: ICE[0], core: 0xffffff });
    glow.parts.forEach((part) => {
      const full = part.scaleX;
      part.setScale(full * 0.2);
      scene.tweens.add({ targets: part, scaleX: full * 1.6, scaleY: full * 1.6, duration: 320, ease: 'Quad.easeIn' });
    });
    await wait(scene, 320);
    await beam(scene, a.enemyFront, a.hero, { color: ICE[0], width: 16 * a.se, duration: 140, hold: 260 });
    fadeAndDestroy(scene, glow.parts, { duration: 300, delay: 200 });
    heroHit(scene, a, { colors: [ICE[0], 0xf0c8ff, 0xffffff], tint: 0x9fe8ff, sparks: 22, distance: 26 });
    await wait(scene, 160);
  },

  /** 敵のデジタル攻撃：緑のコードの破片がノイズのように飛び、主人公の周りで弾ける。 */
  async enemyAttack_digital(scene, opts) {
    const a = anchors(scene, opts);
    await enemyWindup(scene, a, 0.05);
    const volleys = [0, 1, 2, 3].map(async (i) => {
      await wait(scene, i * 60);
      const from = { x: a.enemyFront.x, y: a.enemyFront.y + (Math.random() - 0.5) * a.eh * 0.4 };
      const to = { x: a.hero.x + (Math.random() - 0.5) * a.pw * 0.4, y: a.hero.y + (Math.random() - 0.5) * a.ph * 0.4 };
      const bit = scene.add.image(from.x, from.y, 'fx-pixel').setTint(DIGITAL[i % 2]).setBlendMode('ADD').setScale(2 * a.se);
      const tail = trail(scene, bit, { texture: 'fx-pixel', tint: DIGITAL, scale: [1.2 * a.se, 0], lifespan: 260, speed: [0, 20], frequency: 20 });
      await progress(scene, {
        duration: 300,
        // ノイズらしく、縦の位置は段差のように飛ぶ
        onUpdate: (p) => {
          const step = Math.floor(p * 6) / 6;
          bit.setPosition(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * step + (Math.random() - 0.5) * 6);
        },
      });
      stopTrail(scene, tail);
      bit.destroy();
      burst(scene, to.x, to.y, { texture: 'fx-pixel', count: 10, speed: [100, 260], lifespan: [250, 450], scale: [1.2, 0], tint: DIGITAL });
    });
    await Promise.all(volleys);
    heroHit(scene, a, { colors: DIGITAL, tint: 0x39ff88, sparks: 8 });
    // 画面のノイズ（横長の帯が数本ちらつく）
    const { width } = scene.scale;
    const bars = [0, 1, 2].map(() => scene.add.rectangle(width / 2, a.hero.y + (Math.random() - 0.5) * a.ph, width, 4 + Math.random() * 8, DIGITAL[0], 0.25).setBlendMode('ADD'));
    fadeAndDestroy(scene, bars, { duration: 200, delay: 80 });
    await wait(scene, 140);
  },

  /** 敵の闇の攻撃：敵が影に溶け、闇の玉が主人公を包む。 */
  async enemyAttack_shadow(scene, opts) {
    const a = anchors(scene, opts);
    if (a.E?.setAlpha) scene.tweens.add({ targets: a.E, alpha: 0.35, duration: 180, yoyo: true, hold: 360 });
    const darkOrb = orb(scene, a.enemyFront.x, a.enemyFront.y, { size: 40 * a.se, color: SHADOW[0], core: SHADOW[2] });
    const smoke = trail(scene, darkOrb.center, { tint: [0x1a0833, 0x2a0f4d], scale: [0.6 * a.se, 1.1 * a.se], lifespan: 420, alpha: [0.7, 0], blend: 'NORMAL', speed: [5, 30] });
    await wait(scene, 160);
    await progress(scene, {
      duration: 420, ease: 'Sine.easeInOut',
      onUpdate: (p) => {
        const x = a.enemyFront.x + (a.hero.x - a.enemyFront.x) * p;
        const y = a.enemyFront.y + (a.hero.y - a.enemyFront.y) * p + Math.sin(p * Math.PI * 3) * 18 * a.se;
        darkOrb.parts.forEach((part) => part.setPosition(x, y));
      },
    });
    stopTrail(scene, smoke);
    darkOrb.parts.forEach((part) => part.destroy());
    clawMarks(scene, a.hero.x, a.hero.y, { size: a.ph * 0.6, color: SHADOW[2], direction: -1 });
    burst(scene, a.hero.x, a.hero.y, {
      texture: 'fx-glow', count: 14, speed: [40, 140], lifespan: [500, 900], scale: [0.7 * a.sp, 1.4 * a.sp], alpha: [0.7, 0], tint: [0x12051f, 0x2a0f4d], blend: 'NORMAL',
    });
    glowPop(scene, a.hero.x, a.hero.y, { size: a.ph * 0.9, color: SHADOW[0], duration: 380 });
    hitReact(scene, a.P, { direction: -1, distance: 24, tint: 0x4b0082 });
    shake(scene, 280, 0.014);
    await wait(scene, 160);
  },

  /** ボスの攻撃：赤い気をため、大きく踏み込んで十字に斬る。 */
  async enemyAttack_boss(scene, opts) {
    const a = anchors(scene, opts);
    const veil = dimScreen(scene, { color: 0x1a0000, alpha: 0.35 });
    const circle = magicCircle(scene, a.enemyFeet.x, a.enemyFeet.y, { radius: a.ew * 0.6, color: 0xff2a2a, spin: 0.006 });
    glowPop(scene, a.enemy.x, a.enemy.y, { size: a.eh * 1.3, color: 0xff2a2a, duration: 520, from: 1, to: 1.3, alpha: 0.7 });
    burst(scene, a.enemyFeet.x, a.enemyFeet.y, { texture: 'fx-glow', count: 16, speed: [30, 90], angle: [250, 290], lifespan: [500, 800], scale: [0.5 * a.se, 0], tint: [0xff2a2a, 0x8b0000], gravityY: -200 });
    await wait(scene, 380);
    circle.stop();
    await lunge(scene, a.E, {
      direction: -1,
      distance: Math.max(80, (a.enemy.x - a.hero.x) * 0.38),
      onImpact: () => {
        const length = a.ph * 0.8;
        diagonalSlash(scene, a.hero.x, a.hero.y, { length, down: -1, color: 0xff3030, width: 11 * a.sp });
        scene.time.delayedCall(90, () => diagonalSlash(scene, a.hero.x, a.hero.y, { length, color: 0xff3030, width: 11 * a.sp }));
        heroHit(scene, a, { colors: [0xff3030, 0xffb36b], tint: 0xff0000, size: 200, sparks: 26, distance: 34, shakeMs: 340, shakeAmount: 0.022 });
        shockRing(scene, a.heroFeet.x, a.heroFeet.y, { radius: a.pw * 0.6, color: 0xff3030, flatten: 0.3, duration: 480 });
        flashScreen(scene, 100, 255, 60, 60);
      },
    });
    veil.lift(360);
  },
};

/** 魔法の名前（英語の種類名・日本語）から演出の種類を選ぶ。見つからなければ fallback。 */
const SPELL_ANIMATIONS = {
  FIRE: 'magic_fire', 炎: 'magic_fire', 火: 'magic_fire', 炎の魔法: 'magic_fire',
  ICE: 'magic_ice', 氷: 'magic_ice', 氷の魔法: 'magic_ice',
  THUNDER: 'magic_thunder', 雷: 'magic_thunder', 雷の魔法: 'magic_thunder',
  WATER: 'magic_water', 水: 'magic_water', 水の魔法: 'magic_water',
  RAIDEN: 'magic_raiden', ライデン: 'magic_raiden',
  HEALING: 'healing', 回復: 'healing', 回復魔法: 'healing',
  FLASH: 'magic_flash', 閃光: 'magic_flash', 閃光魔法: 'magic_flash',
  PARALYZE: 'magic_paralyze', 麻痺: 'magic_paralyze', 麻痺魔法: 'magic_paralyze',
};

export function spellAnimation(spell, fallback = 'magic_fire') {
  return SPELL_ANIMATIONS[spell] ?? fallback;
}

/** 演出を再生する。登録のない種類は短く待つだけ（ゲームの進行は止めない）。 */
export async function playBattleAnimation(scene, type) {
  const run = BATTLE_ANIMATIONS[type];
  if (!run) {
    console.log(`未知のアニメーションタイプ: ${type}`);
    await wait(scene, 300);
    return false;
  }
  ensureFxTextures(scene);
  // よける敵（ステージ9の影など）は、シーンがその攻撃をよけるかを答える
  const dodges = typeof scene.enemyDodges === 'function' && Boolean(scene.enemyDodges(type));
  try {
    await run(scene, { dodge: dodges });
  } catch (error) {
    // 画面を離れたら、残りの演出は出さずに終える
    if (error instanceof SceneEndedError) return false;
    // 演出の失敗で戦闘を止めない
    console.warn(`[battleAnimations] ${type}`, error);
  }
  return true;
}
