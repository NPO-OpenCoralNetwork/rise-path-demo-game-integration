// characterMotion.js - 主人公と敵の動き（ボーンを使わず、Phaser の tween だけで作る）
//
// キャラクターは画像1枚なので、伸び縮み・移動・傾き・色で動かす。どの動きも最後は元の位置と形に戻る。
// 1体の動きは順番に実行し（前の動きが終わってから次を始める）、位置がずれていくのを防ぐ。
// 待機中の呼吸（scaleY と y）は、ほかの動きの間だけ止めて元に戻し、終わったら再開する。
// prefers-reduced-motion が有効なときは呼吸を止め、ほかの動きも小さく短くする。

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const isSprite = (target) => Boolean(target && typeof target.setScale === 'function' && target.scene);

/**
 * tween を Promise で待つ。tween が途中で消されても（シーンの終了など）進めるよう、
 * 予定の長さを少し過ぎたら resolve する。
 */
function play(scene, config) {
  return new Promise((resolve) => {
    const timeScale = scene.tweens.timeScale || 1;
    setTimeout(resolve, ((config.duration ?? 0) + (config.delay ?? 0)) / timeScale + 500);
    scene.tweens.add({ ...config, onComplete: resolve, onStop: resolve });
  });
}

/** sprite の動きを前の動きのあとに実行する。 */
function queue(sprite, body) {
  const run = (sprite.motion ?? Promise.resolve()).then(body);
  sprite.motion = run.catch((error) => console.warn('[characterMotion]', error));
  return sprite.motion;
}

/** 指定したキャラクターの動きがすべて終わるのを待つ（最長 2 秒。ゲームを止めないため）。 */
export function settled(...sprites) {
  const all = Promise.all(sprites.map((sprite) => sprite?.motion ?? Promise.resolve()));
  return Promise.race([all, new Promise((resolve) => setTimeout(resolve, 2000))]);
}

/**
 * 足元を固定したまま、ゆっくり呼吸させる。今の大きさと位置が基準になる。
 * float（ピクセル）を指定すると、宙に浮く敵のように呼吸に合わせて上下にも揺れる。
 */
export function startIdle(scene, sprite, { amount = 0.022, duration = 1300, delay = 0, float = 0 } = {}) {
  stopIdle(sprite);
  if (!isSprite(sprite)) return;
  sprite.idleConfig = { amount, duration, float };
  if (reducedMotion()) return;
  sprite.idleBase = { scaleY: sprite.scaleY, y: sprite.y };
  sprite.idleTween = scene.tweens.add({
    targets: sprite,
    scaleY: sprite.scaleY * (1 + amount),
    y: sprite.y - (sprite.displayHeight * amount) / 2 - float,
    duration,
    delay,
    ease: 'Sine.easeInOut',
    yoyo: true,
    repeat: -1,
  });
}

/** 呼吸を止め、基準の大きさと位置に戻す（設定は残るので、動きのあとに再開できる）。 */
export function stopIdle(sprite) {
  if (!sprite?.idleTween) return;
  sprite.idleTween.remove();
  sprite.idleTween = null;
  if (isSprite(sprite) && sprite.idleBase) {
    sprite.scaleY = sprite.idleBase.scaleY;
    sprite.y = sprite.idleBase.y;
  }
}

/** 呼吸をやめる（倒れたとき・勝ったとき）。 */
function endIdle(sprite) {
  stopIdle(sprite);
  if (sprite) sprite.idleConfig = null;
}

/** 呼吸を止めて motion を実行し、終わったら呼吸を再開する。 */
function withoutIdle(scene, sprite, motion) {
  return queue(sprite, async () => {
    if (!isSprite(sprite)) return;
    stopIdle(sprite);
    try {
      await motion();
    } finally {
      if (sprite.idleConfig && isSprite(sprite) && sprite.alpha > 0) startIdle(scene, sprite, sprite.idleConfig);
    }
  });
}

/**
 * ためてから前に踏み込み、元の位置に戻る。direction は 1 で右へ、-1 で左へ。
 * onImpact は踏み込みきった瞬間に呼ばれる（斬撃や相手ののけぞりはここで出す）。
 */
export function lunge(scene, sprite, { direction = 1, distance = 90, onImpact } = {}) {
  if (!isSprite(sprite)) {
    onImpact?.();
    return Promise.resolve();
  }
  return withoutIdle(scene, sprite, async () => {
    const reduced = reducedMotion();
    const { x, angle, scaleX } = sprite;
    const reach = reduced ? distance * 0.3 : distance;
    await play(scene, {
      targets: sprite, x: x - direction * reach * 0.15, angle: angle - direction * 4, scaleX: scaleX * 0.94,
      duration: reduced ? 60 : 120, ease: 'Quad.easeOut',
    });
    await play(scene, {
      targets: sprite, x: x + direction * reach, angle: angle + direction * 6, scaleX: scaleX * 1.05,
      duration: reduced ? 80 : 130, ease: 'Quad.easeIn',
    });
    onImpact?.();
    await play(scene, { targets: sprite, x, angle, scaleX, duration: reduced ? 120 : 220, ease: 'Quad.easeOut' });
  });
}

/** 色を元に戻す（kept が null なら色なし）。 */
export function restoreTint(sprite, kept) {
  if (kept === null || kept === undefined) sprite.clearTint();
  else sprite.setTint(kept);
}

/** 攻撃を受けてのけぞる。白く光ってから tint の色になり、direction の向きへ押される。 */
export function hitReact(scene, sprite, { direction = 1, distance = 22, tint = 0xff5a5a } = {}) {
  if (!isSprite(sprite)) return Promise.resolve();
  return withoutIdle(scene, sprite, async () => {
    const reduced = reducedMotion();
    const { x, angle } = sprite;
    // ステージが付けている色（装甲が壊れた灰色など）は、のけぞりのあとに戻す
    const kept = sprite.isTinted && !sprite.tintFill ? sprite.tintTopLeft : null;
    // 押される間は白く光り、戻る間は tint の色。色の切り替えも同じ流れの中で行う（別のタイマーにしない）
    sprite.setTintFill(0xffffff);
    await play(scene, {
      targets: sprite, x: x + direction * (reduced ? distance * 0.3 : distance), angle: angle + direction * (reduced ? 2 : 7),
      duration: 90, ease: 'Quad.easeOut',
    });
    if (isSprite(sprite)) sprite.setTint(tint);
    await play(scene, { targets: sprite, x, angle, duration: reduced ? 120 : 260, ease: 'Back.easeOut' });
    if (isSprite(sprite)) restoreTint(sprite, kept);
  });
}

/** 攻撃をよける：薄くなって direction の向きへすべり、元の位置に戻る。 */
export function dodge(scene, sprite, { direction = 1, distance = 60 } = {}) {
  if (!isSprite(sprite)) return Promise.resolve();
  return withoutIdle(scene, sprite, async () => {
    const reduced = reducedMotion();
    const { x, alpha } = sprite;
    await play(scene, { targets: sprite, x: x + direction * (reduced ? distance * 0.3 : distance), alpha: alpha * 0.3, duration: 120, ease: 'Quad.easeOut' });
    await play(scene, { targets: sprite, x, alpha, duration: reduced ? 160 : 320, ease: 'Sine.easeInOut' });
  });
}

/** 魔法を唱える：足元に光の輪が広がり、少し浮いて戻る。 */
export function castPose(scene, sprite, { color = 0x8fd3ff } = {}) {
  if (!isSprite(sprite)) return Promise.resolve();
  return withoutIdle(scene, sprite, async () => {
    const reduced = reducedMotion();
    const { y } = sprite;
    const ring = scene.add.ellipse(sprite.x, y + sprite.displayHeight * 0.47, sprite.displayWidth * 0.7, sprite.displayHeight * 0.1, color, 0.45);
    // キャラクターのすぐ後ろに描く（depth を下げると背景より奥になって見えなくなる）
    scene.children.moveBelow(ring, sprite);
    scene.tweens.add({ targets: ring, scaleX: 1.6, scaleY: 1.6, alpha: 0, duration: 600, ease: 'Quad.easeOut', onComplete: () => ring.destroy() });
    await play(scene, { targets: sprite, y: y - sprite.displayHeight * (reduced ? 0.01 : 0.04), duration: 180, ease: 'Quad.easeOut' });
    await play(scene, { targets: sprite, y, duration: 220, ease: 'Quad.easeIn' });
  });
}

/** 倒れる：傾いて沈みながら消える。direction は倒れる向き。 */
export function defeat(scene, sprite, { direction = 1 } = {}) {
  if (!isSprite(sprite)) return Promise.resolve();
  return queue(sprite, async () => {
    if (!isSprite(sprite)) return;
    endIdle(sprite);
    const reduced = reducedMotion();
    await play(scene, { targets: sprite, angle: sprite.angle + direction * 12, x: sprite.x + direction * 18, duration: 200, ease: 'Quad.easeOut' });
    sprite.setTint(0x888888);
    await play(scene, { targets: sprite, y: sprite.y + sprite.displayHeight * 0.06, alpha: 0, duration: reduced ? 200 : 650, ease: 'Quad.easeIn' });
  });
}

/** 勝利：その場で2回はねる。 */
export function victory(scene, sprite) {
  if (!isSprite(sprite)) return Promise.resolve();
  return queue(sprite, async () => {
    if (!isSprite(sprite)) return;
    endIdle(sprite);
    if (reducedMotion()) return;
    const { y } = sprite;
    for (let i = 0; i < 2; i += 1) {
      await play(scene, { targets: sprite, y: y - sprite.displayHeight * 0.08, duration: 170, ease: 'Quad.easeOut' });
      await play(scene, { targets: sprite, y, duration: 170, ease: 'Quad.easeIn' });
    }
  });
}

/** ボス戦などで、シーン側が独自に動かす前に呼吸と順番待ちを止める。 */
export function releaseMotion(sprite) {
  endIdle(sprite);
  if (sprite) sprite.motion = null;
}
