// battleEffects.js - 戦闘エフェクトの部品（光の粒・飛び道具・斬撃・稲妻・魔法陣・数字）
//
// 画像ファイルは使わず、白い小さなテクスチャを最初に一度だけコードで描き、色（tint）を付けて使う。
// 時間はシーンの時計（tween と delayedCall）で進める。シーンが終われば表示物ごと消え、
// 速度の調整（timeScale）にもそろう。待つ処理には、シーンが止まっても先へ進めるよう保険の時間を付ける。
// prefers-reduced-motion のときは、画面の揺れと全画面の閃光を出さず、粒の数を減らす。

export const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 白いテクスチャ（[幅, 高さ, 描き方]）。色はパーティクルやスプライトの tint で付ける。 */
const TEXTURES = {
  // ふんわり光る丸（中心ほど明るい）
  'fx-glow': [64, 64, (g) => {
    for (let i = 0; i < 16; i += 1) {
      g.fillStyle(0xffffff, 0.07);
      g.fillCircle(32, 32, 32 * (1 - i / 16));
    }
  }],
  // 四方に光る星（火花・きらめき）
  'fx-spark': [24, 24, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(0, 12, 12, 10, 12, 14);
    g.fillTriangle(24, 12, 12, 10, 12, 14);
    g.fillTriangle(12, 0, 10, 12, 14, 12);
    g.fillTriangle(12, 24, 10, 12, 14, 12);
    g.fillCircle(12, 12, 2.5);
  }],
  // 細長いひし形（氷のかけら・光の筋）
  'fx-shard': [10, 30, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(5, 0, 10, 15, 0, 15);
    g.fillTriangle(5, 30, 10, 15, 0, 15);
  }],
  // しずく（水・毒）
  'fx-drop': [12, 18, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(6, 12, 6);
    g.fillTriangle(6, 0, 1, 10, 11, 10);
  }],
  // 輪（泡）
  'fx-ring': [32, 32, (g) => {
    g.lineStyle(3, 0xffffff, 1);
    g.strokeCircle(16, 16, 13);
  }],
  // 十字（回復のきらめき）
  'fx-plus': [14, 14, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillRect(5, 0, 4, 14);
    g.fillRect(0, 5, 14, 4);
  }],
  // 小さな四角（デジタルの破片）
  'fx-pixel': [8, 8, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 8, 8);
  }],
  // 角ばった石（地面から飛ぶ岩）
  'fx-rock': [16, 14, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillPoints([{ x: 2, y: 4 }, { x: 7, y: 0 }, { x: 14, y: 2 }, { x: 16, y: 9 }, { x: 10, y: 14 }, { x: 3, y: 12 }, { x: 0, y: 8 }], true);
  }],
};

/** エフェクト用のテクスチャがまだなければ描いて登録する（ゲーム全体で一度だけ）。 */
export function ensureFxTextures(scene) {
  for (const [key, [width, height, draw]] of Object.entries(TEXTURES)) {
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    draw(g);
    g.generateTexture(key, width, height);
    g.destroy();
  }
}

/** シーンの時計で ms 待つ。シーンが止まって時計が進まなくても、少し後には先へ進む。 */
export function wait(scene, ms) {
  return new Promise((resolve) => {
    const timeScale = scene.time?.timeScale || 1;
    const fallback = setTimeout(resolve, ms / timeScale + 400);
    scene.time.delayedCall(ms, () => {
      clearTimeout(fallback);
      resolve();
    });
  });
}

/** tween を Promise で待つ（終わるか止まったら resolve。シーンが止まっても保険の時間で進む）。 */
export function animate(scene, config) {
  return new Promise((resolve) => {
    const timeScale = scene.tweens.timeScale || 1;
    const total = (config.duration ?? 0) * ((config.repeat ?? 0) + 1) * (config.yoyo ? 2 : 1) + (config.delay ?? 0);
    const fallback = setTimeout(resolve, total / timeScale + 400);
    const done = () => {
      clearTimeout(fallback);
      resolve();
    };
    scene.tweens.add({ ...config, onComplete: done, onStop: done });
  });
}

/** 0 から 1 まで進む値で毎フレーム描き直す（斬撃や稲妻の伸び方に使う）。 */
export function progress(scene, { duration, ease = 'Linear', delay = 0, onUpdate }) {
  const state = { p: 0 };
  return animate(scene, {
    targets: state, p: 1, duration, ease, delay,
    onUpdate: () => onUpdate(state.p),
  });
}

/** 表示物を、少し待ってから消して捨てる（待たずに先へ進む）。 */
export function fadeAndDestroy(scene, targets, { duration = 200, delay = 0, scale } = {}) {
  const list = (Array.isArray(targets) ? targets : [targets]).filter((t) => t && t.scene);
  if (!list.length) return;
  scene.tweens.add({
    targets: list,
    alpha: 0,
    ...(scale ? { scaleX: scale, scaleY: scale } : {}),
    duration,
    delay,
    onComplete: () => list.forEach((t) => t.scene && t.destroy()),
  });
}

const range = (value) => (Array.isArray(value) ? { min: value[0], max: value[1] } : value);

/**
 * (x, y) から光の粒をはじけさせる。粒が消えたら発生源も捨てる。
 * speed・angle・lifespan は [最小, 最大]、scale・alpha は [始め, 終わり]、tint は色の候補。
 */
export function burst(scene, x, y, {
  texture = 'fx-spark', count = 16, speed = [120, 320], angle = [0, 360], lifespan = [300, 600],
  scale = [0.6, 0], alpha = [1, 0], tint = [0xffffff], gravityY = 0, blend = 'ADD', rotate = false,
  depth,
} = {}) {
  ensureFxTextures(scene);
  const emitter = scene.add.particles(x, y, texture, {
    emitting: false,
    speed: range(speed),
    angle: range(angle),
    lifespan: range(lifespan),
    scale: { start: scale[0], end: scale[1] },
    alpha: { start: alpha[0], end: alpha[1] },
    tint,
    gravityY,
    blendMode: blend,
    ...(rotate ? { rotate: { min: 0, max: 360 } } : {}),
  });
  if (depth !== undefined) emitter.setDepth(depth);
  emitter.explode(reducedMotion() ? Math.ceil(count / 3) : count);
  const longest = Array.isArray(lifespan) ? lifespan[1] : lifespan;
  scene.time.delayedCall(longest + 100, () => emitter.scene && emitter.destroy());
  return emitter;
}

/** target の後ろに粒を流し続ける（飛び道具の尾）。止めるときは stopTrail を呼ぶ。 */
export function trail(scene, target, {
  texture = 'fx-glow', frequency = 16, lifespan = 320, speed = [10, 40], scale = [0.5, 0],
  alpha = [0.8, 0], tint = [0xffffff], gravityY = 0, blend = 'ADD',
} = {}) {
  ensureFxTextures(scene);
  const emitter = scene.add.particles(0, 0, texture, {
    frequency: reducedMotion() ? frequency * 3 : frequency,
    lifespan,
    speed: range(speed),
    angle: { min: 0, max: 360 },
    scale: { start: scale[0], end: scale[1] },
    alpha: { start: alpha[0], end: alpha[1] },
    tint,
    gravityY,
    blendMode: blend,
  });
  emitter.startFollow(target);
  emitter.lifespanMax = lifespan;
  return emitter;
}

/** 尾を止め、残った粒が消えてから捨てる。 */
export function stopTrail(scene, emitter) {
  if (!emitter || !emitter.scene) return;
  emitter.stop();
  scene.time.delayedCall((emitter.lifespanMax ?? 400) + 100, () => emitter.scene && emitter.destroy());
}

/** 光の玉（中心の白と、まわりの色の光）。飛び道具や溜めの光に使う。 */
export function orb(scene, x, y, { size = 40, color = 0xffffff, core = 0xffffff } = {}) {
  ensureFxTextures(scene);
  const halo = scene.add.image(x, y, 'fx-glow').setTint(color).setBlendMode('ADD').setDisplaySize(size * 2.2, size * 2.2);
  const center = scene.add.image(x, y, 'fx-glow').setTint(core).setBlendMode('ADD').setDisplaySize(size, size);
  return { halo, center, parts: [halo, center] };
}

/** orb を (x, y) に動かす。 */
function moveOrb(o, x, y) {
  o.parts.forEach((part) => part.setPosition(x, y));
}

/**
 * from から to へ、山なりに飛ぶ光の玉。尾を引き、着いたら resolve する。
 * arc は山の高さ（負なら上へふくらむ）。onArrive は着いた瞬間に呼ばれる。
 */
export async function projectile(scene, from, to, {
  size = 36, color = 0xffffff, core = 0xffffff, duration = 420, arc = -80, trailConfig, ease = 'Sine.easeIn', spin = 0,
} = {}) {
  const o = orb(scene, from.x, from.y, { size, color, core });
  const tail = trail(scene, o.center, trailConfig ?? { tint: [color, core], scale: [size / 90, 0], lifespan: 280 });
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + arc };
  const haloScale = o.halo.scaleX;
  await progress(scene, {
    duration, ease,
    onUpdate: (p) => {
      const q = 1 - p;
      const x = q * q * from.x + 2 * q * p * mid.x + p * p * to.x;
      const y = q * q * from.y + 2 * q * p * mid.y + p * p * to.y;
      moveOrb(o, x, y);
      if (spin) o.halo.rotation += spin;
      // 光が揺らめいて見えるよう、大きさを少しだけ毎フレーム変える
      o.halo.setScale(haloScale * (0.94 + Math.random() * 0.12));
    },
  });
  stopTrail(scene, tail);
  o.parts.forEach((part) => part.scene && part.destroy());
}

/**
 * 弧を描く斬撃。中心 (x, y)・半径 radius で、start から sweep（ラジアン）だけ素早く伸び、薄れて消える。
 * 外側に色の光、内側に白い芯を描く。
 */
export async function slashArc(scene, x, y, {
  radius = 80, start = -2.3, sweep = 2.2, color = 0xbfe9ff, width = 10, duration = 110, anticlockwise = false,
} = {}) {
  const g = scene.add.graphics().setBlendMode('ADD');
  const draw = (p, fade = 1) => {
    g.clear();
    const end = start + (anticlockwise ? -sweep : sweep) * p;
    // 太い光 → 細い芯の順に重ねる。先端ほど細く見えるよう、少しずつずらして重ねる
    [[width * 2.2, color, 0.35], [width, color, 0.8], [width * 0.4, 0xffffff, 1]].forEach(([w, c, a]) => {
      g.lineStyle(w, c, a * fade);
      g.beginPath();
      g.arc(x, y, radius, start, end, anticlockwise);
      g.strokePath();
    });
  };
  await progress(scene, { duration, ease: 'Cubic.easeOut', onUpdate: (p) => draw(p) });
  scene.tweens.addCounter({
    from: 1, to: 0, duration: 200,
    onUpdate: (tween) => draw(1, tween.getValue()),
    onComplete: () => g.destroy(),
  });
  return g;
}

/** まっすぐな爪あと（3本の斜めの筋）。敵の攻撃に使う。 */
export async function clawMarks(scene, x, y, { size = 80, color = 0xff4d4d, duration = 120, count = 3, direction = -1 } = {}) {
  const g = scene.add.graphics().setBlendMode('ADD');
  const lines = Array.from({ length: count }, (_, i) => {
    const offset = (i - (count - 1) / 2) * size * 0.28;
    return { x1: x + direction * -size * 0.45 + offset, y1: y - size * 0.55, x2: x + direction * size * 0.4 + offset, y2: y + size * 0.5 };
  });
  const draw = (p, fade = 1) => {
    g.clear();
    lines.forEach((l, i) => {
      const q = Math.max(0, Math.min(1, p * 1.4 - i * 0.15));
      const ex = l.x1 + (l.x2 - l.x1) * q;
      const ey = l.y1 + (l.y2 - l.y1) * q;
      [[size * 0.14, color, 0.4], [size * 0.06, color, 0.9], [size * 0.025, 0xffffff, 1]].forEach(([w, c, a]) => {
        g.lineStyle(w, c, a * fade);
        g.lineBetween(l.x1, l.y1, ex, ey);
      });
    });
  };
  await progress(scene, { duration, onUpdate: (p) => draw(p) });
  scene.tweens.addCounter({
    from: 1, to: 0, duration: 220,
    onUpdate: (tween) => draw(1, tween.getValue()),
    onComplete: () => g.destroy(),
  });
}

/**
 * from から to へ伸びる光線。duration で伸びきり、hold のあいだ揺らめいてから細くなって消える。
 * 伸びきったら resolve する（消えるのは待たない）。
 */
export async function beam(scene, from, to, { color = 0x9fe8ff, width = 18, duration = 160, hold = 220 } = {}) {
  const g = scene.add.graphics().setBlendMode('ADD');
  const draw = (p, thickness = 1) => {
    g.clear();
    const x = from.x + (to.x - from.x) * p;
    const y = from.y + (to.y - from.y) * p;
    [[width * 2.4, color, 0.25], [width, color, 0.75], [width * 0.35, 0xffffff, 1]].forEach(([w, c, a]) => {
      g.lineStyle(Math.max(1, w * thickness), c, a);
      g.lineBetween(from.x, from.y, x, y);
    });
  };
  await progress(scene, { duration, ease: 'Quad.easeOut', onUpdate: (p) => draw(p) });
  scene.tweens.addCounter({
    from: 1, to: 0, duration: hold + 180,
    onUpdate: (tween) => {
      const v = tween.getValue();
      // 初めは太さが揺らめき、終わりにかけて細くなる
      draw(1, v > 0.4 ? 0.85 + Math.random() * 0.3 : v / 0.4);
    },
    onComplete: () => g.destroy(),
  });
}

/** 広がって消える輪（衝撃波）。flatten で横長の楕円にする（地面の衝撃）。 */
export function shockRing(scene, x, y, { radius = 40, color = 0xffffff, width = 6, scale = 2.6, duration = 380, flatten = 1, alpha = 0.9 } = {}) {
  const g = scene.add.graphics({ x, y }).setBlendMode('ADD');
  g.lineStyle(width, color, alpha);
  g.strokeEllipse(0, 0, radius * 2, radius * 2 * flatten);
  g.setScale(0.4);
  scene.tweens.add({
    targets: g, scaleX: scale, scaleY: scale, alpha: 0, duration, ease: 'Cubic.easeOut',
    onComplete: () => g.destroy(),
  });
  return g;
}

/** ふわっと広がる光（爆発の閃き・着弾の光）。 */
export function glowPop(scene, x, y, { size = 120, color = 0xffffff, duration = 300, from = 0.4, to = 1.4, alpha = 1 } = {}) {
  ensureFxTextures(scene);
  const img = scene.add.image(x, y, 'fx-glow').setTint(color).setBlendMode('ADD').setAlpha(alpha);
  img.setDisplaySize(size * from, size * from);
  const base = img.scaleX / from;
  scene.tweens.add({
    targets: img, scaleX: base * to, scaleY: base * to, alpha: 0, duration, ease: 'Quad.easeOut',
    onComplete: () => img.destroy(),
  });
  return img;
}

/**
 * ギザギザの稲妻の点の列（中点をずらして分割する）。roughness は横ずれの大きさ、depth は分割回数。
 * 乱数を渡せるようにして、テストでは決まった形を作れるようにしている。
 */
export function lightningPath(x1, y1, x2, y2, { roughness = 0.25, depth = 5, random = Math.random } = {}) {
  let points = [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  let spread = Math.hypot(x2 - x1, y2 - y1) * roughness;
  for (let level = 0; level < depth; level += 1) {
    const next = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      const offset = (random() - 0.5) * spread;
      next.push({ x: (a.x + b.x) / 2 - (dy / length) * offset, y: (a.y + b.y) / 2 + (dx / length) * offset }, b);
    }
    points = next;
    spread /= 2;
  }
  return points;
}

/** 稲妻を描く（太い光・芯・枝分かれ）。描いた Graphics を返す（消すのは呼び出し側）。 */
export function drawLightning(scene, x1, y1, x2, y2, { color = 0xfff27a, width = 10, branches = 3 } = {}) {
  const g = scene.add.graphics().setBlendMode('ADD');
  const stroke = (points, w) => {
    [[w * 2.6, color, 0.3], [w, color, 0.85], [w * 0.4, 0xffffff, 1]].forEach(([lw, c, a]) => {
      g.lineStyle(lw, c, a);
      g.beginPath();
      g.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((pt) => g.lineTo(pt.x, pt.y));
      g.strokePath();
    });
  };
  const main = lightningPath(x1, y1, x2, y2);
  stroke(main, width);
  for (let i = 0; i < branches; i += 1) {
    const from = main[Math.floor(main.length * (0.25 + Math.random() * 0.5))];
    const length = Math.hypot(x2 - x1, y2 - y1) * (0.18 + Math.random() * 0.2);
    const angle = Math.atan2(y2 - y1, x2 - x1) + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6);
    stroke(lightningPath(from.x, from.y, from.x + Math.cos(angle) * length, from.y + Math.sin(angle) * length, { depth: 3 }), width * 0.45);
  }
  return g;
}

/**
 * 足元の魔法陣（横長の楕円に、回る目盛りと点）。stop() で消える。
 * 回転は毎フレームの描き直しで表す（平たい円をそのまま回すと形が崩れるため）。
 */
export function magicCircle(scene, x, y, { radius = 70, color = 0x8fd3ff, flatten = 0.32, spin = 0.0025 } = {}) {
  const g = scene.add.graphics({ x, y }).setBlendMode('ADD').setAlpha(0);
  let angle = 0;
  const draw = () => {
    g.clear();
    g.lineStyle(3, color, 0.9);
    g.strokeEllipse(0, 0, radius * 2, radius * 2 * flatten);
    g.lineStyle(2, color, 0.6);
    g.strokeEllipse(0, 0, radius * 1.55, radius * 1.55 * flatten);
    for (let i = 0; i < 12; i += 1) {
      const a = angle + (i / 12) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      g.lineStyle(2, color, 0.8);
      g.lineBetween(c * radius * 0.78, s * radius * 0.78 * flatten, c * radius, s * radius * flatten);
      if (i % 3 === 0) {
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(c * radius * 0.88, s * radius * 0.88 * flatten, 3);
      }
    }
  };
  draw();
  const onUpdate = (_, delta) => {
    // シーンが終わって魔法陣が捨てられていたら、描き直しをやめる
    if (!g.scene) {
      scene.events.off('update', onUpdate);
      return;
    }
    angle += spin * delta;
    draw();
  };
  scene.events.on('update', onUpdate);
  scene.tweens.add({ targets: g, alpha: 1, duration: 160 });
  return {
    graphics: g,
    stop: () => {
      scene.events.off('update', onUpdate);
      fadeAndDestroy(scene, g, { duration: 260, scale: 1.25 });
    },
  };
}

/** 画面をゆらす（動きを減らす設定では揺らさない）。 */
export function shake(scene, duration, intensity) {
  if (reducedMotion()) return;
  scene.cameras.main.shake(duration, intensity);
}

/** 画面全体を一瞬光らせる（動きを減らす設定では出さない）。 */
export function flashScreen(scene, duration, r, g, b) {
  if (reducedMotion()) return;
  scene.cameras.main.flash(duration, r, g, b);
}

/** 画面を暗くする幕。戻すときは返り値の lift() を呼ぶ。 */
export function dimScreen(scene, { color = 0x000018, alpha = 0.45, duration = 220 } = {}) {
  const { width, height } = scene.scale;
  const veil = scene.add.rectangle(width / 2, height / 2, width, height, color, 1).setAlpha(0);
  scene.tweens.add({ targets: veil, alpha, duration });
  return { veil, lift: (ms = 320) => fadeAndDestroy(scene, veil, { duration: ms }) };
}

/**
 * ダメージや回復の数字を、キャラクターの頭の上に出す。kind は 'damage' か 'heal'。
 * 少しはねて上がりながら消える（動きを減らす設定では、その場で消えるだけ）。
 */
export function floatingNumber(scene, x, y, value, { kind = 'damage', size = 34 } = {}) {
  const heal = kind === 'heal';
  const text = scene.add.text(x, y, `${heal ? '+' : ''}${value}`, {
    fontFamily: 'Verdana, "メイリオ", sans-serif',
    fontSize: `${Math.round(size)}px`,
    fontStyle: 'bold',
    color: heal ? '#7dff9a' : '#fff1b8',
    stroke: heal ? '#0b4d1c' : '#7a1010',
    strokeThickness: Math.max(4, Math.round(size / 6)),
    shadow: { offsetX: 2, offsetY: 3, color: '#000', blur: 3, fill: true },
  }).setOrigin(0.5).setDepth(1000);
  if (reducedMotion()) {
    scene.tweens.add({ targets: text, alpha: 0, delay: 600, duration: 300, onComplete: () => text.destroy() });
    return text;
  }
  text.setScale(0.4);
  scene.tweens.add({ targets: text, scale: 1.15, duration: 120, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: text, scale: 1, delay: 120, duration: 120 });
  scene.tweens.add({ targets: text, y: y - size * 1.6, duration: 900, ease: 'Cubic.easeOut' });
  scene.tweens.add({ targets: text, alpha: 0, delay: 650, duration: 300, onComplete: () => text.destroy() });
  return text;
}
