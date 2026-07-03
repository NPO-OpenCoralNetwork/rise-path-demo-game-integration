
// --- 新しい設計に基づく全面リファクタリング ---
import Phaser from "phaser";
import { BattleScene } from "./battle";

// ステージ10「初級ボス戦」用のバトルシーン
// これまでの魔法（閃光魔法、麻痺魔法、回復魔法、属性魔法）をすべて駆使して戦う
export class BattleScene10 extends BattleScene {
  constructor() {
    super({ key: "Stage10Battle" });
    this.settings = {
      background: 'castle',
      enemy: 'ダークナイト',
      stageNumber: 10
    };

    // ダークナイトのフェーズ情報
    this.knightPhase = {
      current: 1,
      maxPhases: 3,
      stance: 'defensive',
      magicShield: true,           // 閃光魔法でしか破れないシールド
      physicalShield: true,        // 物理攻撃を無効化するシールド
      physicalShieldHP: 8,         // 物理シールド耐久
      physicalShieldMaxHP: 8,
      weakElement: 'FIRE',         // 現在の弱点属性
      chargeAttackPreparing: false, // チャージ攻撃準備中（麻痺で止める）
      chargeAttackTurns: 0,
      phase_change_triggered: [false, false],
      enraged: false               // 激怒状態（HP低下時）
    };

    // 麻痺システムの初期化
    this.paralyzeTurns = 0;
    this.isEnemyParalyzed = false;
    
    // バトル状態
    this.battleEnded = false;
    this.bossDefeated = false;
    this.turnCount = 0;
  }

  create() {
    super.create();
    
    // ステージ10の設定（強化版ダークナイト）
    this.setupStageCommon({
      backgroundColor: 0x1a0d1a,
      enemyTint: 0x4a0e4e,
      enemyHp: 200,  // ボスなので高HP
      startMessage: `ステージ10「初級ボス戦」が始まりました！${this.settings.enemy}と対決します！`,
      availableBlocks: [
        'attack_basic',      // 基本攻撃
        'cast_fire',         // 炎魔法
        'cast_ice',          // 氷魔法
        'cast_thunder',      // 雷魔法
        'cast_flash',        // 閃光魔法（シールド破壊）
        'cast_paralyze',     // 麻痺魔法（チャージ攻撃阻止）
        'heal_magic',        // 回復魔法
        'repeat_3x',         // 繰り返し
        'if_enemy_charging', // 条件分岐：敵がチャージ中
        'if_hp_low',         // 条件分岐：HP低下
        'wait'
      ]
    });
    
    // ボス戦専用UI
    this.createBossUI();
    // 物理シールド耐久を初期化して表示
    this.knightPhase.physicalShieldHP = this.knightPhase.physicalShieldMaxHP;
    this.updatePhysicalShieldText();
    this.createDarkAura();
    
    // 戦闘開始メッセージ
    this.showBattleIntro();
  }

  createBossUI() {
    // ボス情報パネル
    const panelX = 10;
    const panelY = 100;
    
    // 背景パネル
    const panel = this.add.graphics();
    panel.fillStyle(0x000000, 0.7);
    panel.fillRoundedRect(panelX, panelY, 180, 140, 8);
    panel.lineStyle(2, 0xff69b4);
    panel.strokeRoundedRect(panelX, panelY, 180, 140, 8);
    
    // フェーズ表示
    this.phaseText = this.add.text(panelX + 10, panelY + 10, '⚔️ フェーズ: 1/3', {
      fontSize: '14px',
      fill: '#ff69b4',
      fontStyle: 'bold'
    });
    
    // 弱点表示
    this.weaknessText = this.add.text(panelX + 10, panelY + 35, '🔥 弱点: 炎', {
      fontSize: '14px',
      fill: '#ff6600'
    });
    
    // シールド状態
    this.shieldText = this.add.text(panelX + 10, panelY + 60, '🛡️ 魔法シールド: 有効', {
      fontSize: '14px',
      fill: '#00aaff'
    });
    
    // 物理シールド状態
    this.physicalShieldText = this.add.text(panelX + 10, panelY + 85, `🗡️ 物理シールド: 有効 (${this.knightPhase.physicalShieldHP}/${this.knightPhase.physicalShieldMaxHP})`, {
      fontSize: '14px',
      fill: '#aaaaaa'
    });
    
    // チャージ攻撃警告
    this.chargeText = this.add.text(panelX + 10, panelY + 110, '', {
      fontSize: '14px',
      fill: '#ff4500',
      fontStyle: 'bold'
    });
    
    // ヒントテキスト（画面下部）
    this.hintText = this.add.text(this.scale.width / 2, this.scale.height * 0.75, '', {
      fontSize: '16px',
      fill: '#ffff00',
      fontStyle: 'bold',
      align: 'center'
    }).setOrigin(0.5);
  }

  createDarkAura() {
    // ダークオーラエフェクト
    this.auraParticles = [];
    for (let i = 0; i < 12; i++) {
      const particle = this.add.graphics();
      particle.fillStyle(0x4a0e4e, 0.6);
      particle.fillCircle(0, 0, 4 + Math.random() * 4);
      
      const startX = this.scale.width * 0.7 + (Math.random() - 0.5) * 100;
      const startY = this.scale.height * 0.4 + (Math.random() - 0.5) * 80;
      particle.setPosition(startX, startY);
      
      this.tweens.add({
        targets: particle,
        y: startY - 100,
        alpha: 0,
        duration: 2000 + Math.random() * 1000,
        repeat: -1,
        delay: i * 200,
        onRepeat: () => {
          particle.setPosition(startX, startY);
          particle.setAlpha(0.6);
        }
      });
      
      this.auraParticles.push(particle);
    }
  }

  showBattleIntro() {
    this.time.delayedCall(500, () => {
      this.addLog("═══════════════════════════════════");
      this.addLog("⚔️ ダークナイト出現！");
      this.addLog("═══════════════════════════════════");
    });
    
    this.time.delayedCall(1500, () => {
      this.addLog("📖 ボス攻略のヒント:");
      this.addLog("1️⃣ 閃光魔法でシールドを破壊せよ！");
      this.addLog("2️⃣ 弱点属性で大ダメージを与えよ！");
      this.addLog("3️⃣ チャージ攻撃は麻痺魔法で阻止！");
      this.addLog("4️⃣ 回復魔法でHPを維持せよ！");
    });
    
    this.time.delayedCall(3000, () => {
      this.updateHint("💡 まずは閃光魔法でシールドを破壊しよう！");
    });
  }

  updateHint(message) {
    this.hintText.setText(message);
    this.tweens.add({
      targets: this.hintText,
      alpha: { from: 0, to: 1 },
      duration: 500
    });
    
    // 5秒後にフェードアウト
    this.time.delayedCall(5000, () => {
      this.tweens.add({
        targets: this.hintText,
        alpha: 0,
        duration: 500
      });
    });
  }

  // ====================================
  // 攻撃処理
  // ====================================

  // 通常攻撃（物理シールドに阻まれる）
  dealDamageToEnemy(damage, attackType = 'normal') {
    if (this.battleEnded) return;

    // 物理攻撃の場合
    if (attackType === 'normal' || attackType === 'physical') {
      if (this.knightPhase.physicalShield) {
        // 物理シールドの耐久を減少（1ヒットにつき1減らす）
        this.knightPhase.physicalShieldHP = Math.max(0, this.knightPhase.physicalShieldHP - 1);
        this.addLog(`🛡️ 物理シールドに阻まれた！耐久: ${this.knightPhase.physicalShieldHP}/${this.knightPhase.physicalShieldMaxHP}`);
        this.updateHint("💡 閃光魔法で一気に破壊するか、物理攻撃を重ねよう！");
        this.updatePhysicalShieldText();

        if (this.knightPhase.physicalShieldHP <= 0) {
          this.knightPhase.physicalShield = false;
          this.addLog("💥 物理シールドが破壊された！");
          this.updatePhysicalShieldText();
          this.physicalShieldText.setFill('#ff0000');
          this.cameras.main.shake(250, 0.01);
          this.cameras.main.flash(200, 255, 120, 120);
        }
        return;
      }
    }
    
    // 魔法攻撃の場合
    if (attackType === 'magic') {
      if (this.knightPhase.magicShield) {
        // シールドがある場合はダメージ大幅軽減
        const reducedDamage = Math.floor(damage * 0.2);
        this.addLog(`🛡️ 魔法シールドがダメージを軽減！（${damage} → ${reducedDamage}）`);
        damage = reducedDamage;
        
        if (reducedDamage <= 0) {
          this.addLog("💡 閃光魔法でシールドを破壊せよ！");
          return;
        }
      }
    }

    // ダメージ適用
    const currentHP = this.enemy.getHP();
    const newHP = Math.max(0, currentHP - damage);
    console.log(`[Stage10] Enemy HP: ${currentHP} -> ${newHP} (damage: ${damage}, type: ${attackType})`);
    this.enemy.setHP(newHP);
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    
    this.addLog(`💥 ${damage}ダメージ！`);
    
    // フェーズ変化チェック
    this.checkPhaseChange();

    if (this.enemy.getHP() <= 0) {
      this.handleBossDefeat();
    }
  }

  // 属性魔法の処理
  playerCastSpell(spell) {
    if (this.battleEnded) return;

    // 基本ダメージ設定
    const baseDamage = {
      'FIRE': 20,
      'ICE': 18,
      'THUNDER': 22,
      'WATER': 15
    }[spell] || 15;

    let damage = baseDamage;
    let effectiveness = 1.0;

    // シールドチェック
    if (this.knightPhase.magicShield) {
      effectiveness *= 0.2;
      this.addLog("🛡️ 魔法シールドがダメージを軽減！");
      this.updateHint("💡 閃光魔法でシールドを破壊しよう！");
    } else {
      // 弱点属性チェック（シールドがない場合のみ有効）
      if (spell === this.knightPhase.weakElement) {
        effectiveness = 2.0;
        this.addLog(`⚡ 弱点を突いた！${spell}魔法が超効果的！`);
        this.cameras.main.flash(200, 255, 255, 0);
      }
    }

    const finalDamage = Math.floor(damage * effectiveness);
    
    // エフェクト再生
    const effectMap = {
      'FIRE': 'magic_fire',
      'ICE': 'magic_ice',
      'THUNDER': 'magic_thunder',
      'WATER': 'magic_water'
    };
    
    if (effectMap[spell]) {
      this.playAnimation(effectMap[spell]);
    }
    
    // ダメージ適用
    const currentHP = this.enemy.getHP();
    const newHP = Math.max(0, currentHP - finalDamage);
    console.log(`[Stage10] Spell ${spell}: HP ${currentHP} -> ${newHP} (damage: ${finalDamage})`);
    this.enemy.setHP(newHP);
    
    this.addLog(`${this.getSpellEmoji(spell)} ${spell}の魔法！${finalDamage}ダメージ！`);
    this.checkPhaseChange();
    this.updateHP(this.player.getHP(), this.enemy.getHP());

    if (this.enemy.getHP() <= 0) {
      this.handleBossDefeat();
      return;
    }
  }

  getSpellEmoji(spell) {
    return {
      'FIRE': '🔥',
      'ICE': '❄️',
      'THUNDER': '⚡',
      'WATER': '💧'
    }[spell] || '✨';
  }

  // 閃光魔法（シールド破壊 - 最重要魔法）
  async applyFlashEffect() {
    if (this.battleEnded) return;

    this.addLog("⚡✨ 閃光魔法発動！");
    
    // 閃光エフェクト
    await this.playFlashAnimation();
    this.cameras.main.flash(500, 255, 255, 255);

    // シールド破壊効果
    let shieldBroken = false;
    
    if (this.knightPhase.magicShield) {
      this.addLog("💥 魔法シールドが破壊された！");
      this.knightPhase.magicShield = false;
      this.shieldText.setText('🛡️ 魔法シールド: 破壊');
      this.shieldText.setFill('#ff0000');
      shieldBroken = true;
    }
    
    if (this.knightPhase.physicalShield) {
      this.addLog("💥 物理シールドも破壊された！");
      this.knightPhase.physicalShield = false;
      this.knightPhase.physicalShieldHP = 0;
      this.updatePhysicalShieldText();
      this.physicalShieldText.setFill('#ff0000');
      shieldBroken = true;
    }
    
    if (shieldBroken) {
      this.addLog("🎯 今こそ攻撃のチャンス！弱点属性で攻めよ！");
      this.updateHint(`💡 弱点は${this.getWeaknessName()}！集中攻撃だ！`);
    }
    
    // 閃光魔法自体のダメージ
    const flashDamage = 25;
    const newHP = Math.max(0, this.enemy.getHP() - flashDamage);
    this.enemy.setHP(newHP);
    
    this.addLog(`⚡ 閃光魔法で${flashDamage}ダメージ！（シールド無視）`);
    this.checkPhaseChange();
    this.updateHP(this.player.getHP(), this.enemy.getHP());

    if (this.enemy.getHP() <= 0) {
      this.handleBossDefeat();
    }
  }

  getWeaknessName() {
    return {
      'FIRE': '🔥炎',
      'ICE': '❄️氷',
      'THUNDER': '⚡雷'
    }[this.knightPhase.weakElement] || '不明';
  }

  updatePhysicalShieldText() {
    if (!this.physicalShieldText) return;
    const hp = this.knightPhase.physicalShieldHP;
    const maxHp = this.knightPhase.physicalShieldMaxHP;
    const state = this.knightPhase.physicalShield ? '有効' : '破壊';
    this.physicalShieldText.setText(`🗡️ 物理シールド: ${state} (${hp}/${maxHp})`);
  }

  // 麻痺魔法（チャージ攻撃阻止 - 重要）
  applyParalyzeEffect() {
    if (this.battleEnded) return;

    this.addLog("⚡💫 麻痺魔法発動！");
    
    // 麻痺効果
    this.paralyzeTurns = 2;
    this.isEnemyParalyzed = true;
    
    this.addLog("ダークナイトは麻痺状態になった！（2ターン）");
    
    // チャージ攻撃をキャンセル
    if (this.knightPhase.chargeAttackPreparing) {
      this.addLog("🎉 チャージ攻撃が麻痺でキャンセルされた！");
      this.knightPhase.chargeAttackPreparing = false;
      this.knightPhase.chargeAttackTurns = 0;
      this.chargeText.setText('');
      this.cameras.main.flash(300, 0, 255, 0);
      this.updateHint("💡 ナイス！今のうちに攻撃だ！");
    }
    
    // 麻痺エフェクト
    if (this.enemySprite) {
      this.tweens.add({
        targets: this.enemySprite,
        alpha: 0.5,
        duration: 200,
        yoyo: true,
        repeat: 3
      });
    }
  }

  // 麻痺ターン減少
  decreaseParalyzeEffect() {
    if (this.paralyzeTurns > 0) {
      this.paralyzeTurns--;
      if (this.paralyzeTurns === 0) {
        this.isEnemyParalyzed = false;
        this.addLog("ダークナイトの麻痺が解けた！");
      } else {
        this.addLog(`麻痺残り: ${this.paralyzeTurns}ターン`);
      }
    }
  }

  // ====================================
  // フェーズ管理
  // ====================================

  checkPhaseChange() {
    const currentHP = this.enemy.getHP();
    const maxHP = this.enemy.maxHp || 200;
    const hpPercent = (currentHP / maxHP) * 100;
    
    // フェーズ2への変化（HP 60%以下）
    if (hpPercent <= 60 && !this.knightPhase.phase_change_triggered[0]) {
      this.triggerPhaseChange(2);
      this.knightPhase.phase_change_triggered[0] = true;
    }
    // フェーズ3への変化（HP 30%以下）
    else if (hpPercent <= 30 && !this.knightPhase.phase_change_triggered[1]) {
      this.triggerPhaseChange(3);
      this.knightPhase.phase_change_triggered[1] = true;
    }
  }

  triggerPhaseChange(newPhase) {
    this.knightPhase.current = newPhase;
    this.cameras.main.flash(800, 100, 0, 100);
    
    // シールド再生成
    this.knightPhase.magicShield = true;
    this.knightPhase.physicalShield = true;
    this.knightPhase.physicalShieldHP = this.knightPhase.physicalShieldMaxHP;
    this.shieldText.setText('🛡️ 魔法シールド: 有効');
    this.shieldText.setFill('#00aaff');
    this.updatePhysicalShieldText();
    this.physicalShieldText.setFill('#aaaaaa');
    
    switch (newPhase) {
      case 2:
        this.addLog("═══════════════════════════════════");
        this.addLog("⚔️ フェーズ2移行！ダークナイト強化！");
        this.addLog("═══════════════════════════════════");
        this.addLog("🛡️ シールドが再生成された！");
        this.addLog("⚠️ チャージ攻撃を使い始めた！麻痺魔法で阻止せよ！");
        
        this.knightPhase.stance = 'offensive';
        this.knightPhase.weakElement = 'WATER';
        
        this.phaseText.setText('⚔️ フェーズ: 2/3');
        this.weaknessText.setText('💧 弱点: 水');
        this.weaknessText.setFill('#00bfff');
        
        this.updateHint("💡 シールド再生！閃光魔法で再度破壊せよ！");
        this.createPhaseChangeEffect(0x0066ff);
        break;
        
      case 3:
        this.addLog("═══════════════════════════════════");
        this.addLog("🔥 フェーズ3移行！最終形態！");
        this.addLog("═══════════════════════════════════");
        this.addLog("🛡️ 最強シールドが展開された！");
        this.addLog("💀 連続チャージ攻撃！全力で阻止せよ！");
        this.addLog("💚 回復魔法でHPを維持しながら戦え！");
        
        this.knightPhase.stance = 'berserker';
        this.knightPhase.weakElement = 'THUNDER';
        this.knightPhase.enraged = true;
        
        this.phaseText.setText('⚔️ フェーズ: 3/3');
        this.weaknessText.setText('⚡ 弱点: 雷');
        this.weaknessText.setFill('#ffff00');
        
        this.updateHint("💡 最終形態！すべての魔法を駆使せよ！");
        this.createPhaseChangeEffect(0xff0000);
        this.createBerserkerEffect();
        break;
    }
  }

  createPhaseChangeEffect(color) {
    const flash = this.add.graphics();
    flash.fillStyle(color, 0.5);
    flash.fillRect(0, 0, this.scale.width, this.scale.height);
    
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 1000,
      onComplete: () => flash.destroy()
    });
  }

  createBerserkerEffect() {
    // バーサーカー状態の赤いオーラ
    const berserkerAura = this.add.graphics();
    
    this.time.addEvent({
      delay: 100,
      callback: () => {
        if (this.battleEnded) return;
        berserkerAura.clear();
        berserkerAura.fillStyle(0xff0000, 0.2 + Math.random() * 0.2);
        berserkerAura.fillCircle(
          this.scale.width * 0.7 + (Math.random() - 0.5) * 20,
          this.scale.height * 0.35 + (Math.random() - 0.5) * 20,
          60 + Math.random() * 20
        );
      },
      loop: true
    });
  }

  // ====================================
  // 敵のターン
  // ====================================

  async enemyTurn() {
    if (this.battleEnded) return;

    this.turnCount++;
    
    // 麻痺状態チェック
    if (this.paralyzeTurns > 0) {
      this.addLog("💫 ダークナイトは麻痺で動けない！");
      this.decreaseParalyzeEffect();
      
      // チャージ攻撃がキャンセルされた
      if (this.knightPhase.chargeAttackPreparing) {
        this.addLog("🎉 チャージ攻撃が麻痺でキャンセルされた！");
        this.knightPhase.chargeAttackPreparing = false;
        this.knightPhase.chargeAttackTurns = 0;
        this.chargeText.setText('');
      }
      return;
    }

    // チャージ攻撃システム（フェーズ2以降）
    if (this.knightPhase.current >= 2) {
      // チャージ攻撃の処理
      if (this.knightPhase.chargeAttackPreparing) {
        this.knightPhase.chargeAttackTurns--;
        
        if (this.knightPhase.chargeAttackTurns > 0) {
          this.addLog(`⚠️ 破滅の剣チャージ中...あと${this.knightPhase.chargeAttackTurns}ターン！`);
          this.chargeText.setText(`💀 破滅の剣: ${this.knightPhase.chargeAttackTurns}ターン`);
          this.updateHint("⚠️ 麻痺魔法（cast_paralyze）で阻止せよ！");
          this.cameras.main.shake(100, 0.01);
          return;
        } else {
          // 即死攻撃発動
          this.addLog("💀💀💀 破滅の剣！即死攻撃！💀💀💀");
          this.addLog("麻痺魔法で阻止するべきだった...");
          this.knightPhase.chargeAttackPreparing = false;
          this.chargeText.setText('');
          this.cameras.main.shake(500, 0.05);
          this.gameOver(false);
          return;
        }
      }
      
      // 新たなチャージ攻撃開始（確率）
      const chargeChance = this.knightPhase.current === 2 ? 0.4 : 0.6;
      if (!this.knightPhase.chargeAttackPreparing && Math.random() < chargeChance) {
        this.knightPhase.chargeAttackPreparing = true;
        this.knightPhase.chargeAttackTurns = this.knightPhase.current === 2 ? 2 : 1;
        
        this.addLog("⚠️⚠️⚠️ ダークナイトが破滅の剣を構えた！⚠️⚠️⚠️");
        this.addLog(`💀 ${this.knightPhase.chargeAttackTurns}ターン後に即死攻撃発動！`);
        this.addLog("💡 麻痺魔法（cast_paralyze）で阻止せよ！");
        
        this.chargeText.setText(`💀 破滅の剣: ${this.knightPhase.chargeAttackTurns}ターン`);
        this.chargeText.setFill('#ff0000');
        
        this.updateHint("⚠️ 危険！麻痺魔法で即死攻撃を阻止せよ！");
        this.cameras.main.shake(200, 0.02);
        return;
      }
    }

    // 通常攻撃
    await this.playAnimation('enemyAttack_boss');
    
    // フェーズに応じたダメージ
    const baseDamage = {
      1: 15,
      2: 25,
      3: 35
    }[this.knightPhase.current];
    
    const damageVariation = Math.floor(Math.random() * 10) - 5;
    const damage = baseDamage + damageVariation;
    
    // 攻撃名
    const attacks = {
      1: ['闇の剣撃', '魔力放射', 'シャドウスラッシュ'],
      2: ['連続斬撃', '闇の波動', 'ダークブレード'],
      3: ['狂戦士の一撃', '絶望の咆哮', '滅びの剣']
    }[this.knightPhase.current];
    
    const attack = attacks[Math.floor(Math.random() * attacks.length)];
    this.addLog(`⚔️ ダークナイトの${attack}！`);
    
    // ダメージ適用
    const newPlayerHP = Math.max(0, this.player.getHP() - damage);
    this.player.setHP(newPlayerHP);
    
    this.updateHP(this.player.getHP(), this.enemy.getHP());
    this.addLog(`💔 プレイヤーは${damage}ダメージを受けた！`);
    
    // HP警告
    const hpPercent = (this.player.getHP() / this.player.maxHp) * 100;
    if (hpPercent <= 30 && hpPercent > 0) {
      this.addLog("⚠️ HPが危険！回復魔法を使え！");
      this.updateHint("💚 回復魔法（heal_magic）でHPを回復！");
    }

    if (this.player.getHP() <= 0) {
      this.gameOver(false);
    }
  }

  // ====================================
  // 勝敗処理
  // ====================================

  handleBossDefeat() {
    this.battleEnded = true;
    this.bossDefeated = true;
    
    this.addLog("═══════════════════════════════════");
    this.addLog("🎉🎉🎉 ダークナイト撃破！🎉🎉🎉");
    this.addLog("═══════════════════════════════════");
    this.addLog("✨ すべての魔法を駆使した見事な戦いだった！");
    this.addLog("");
    this.addLog("📖 習得した魔法:");
    this.addLog("  ⚡ 閃光魔法 - シールド破壊");
    this.addLog("  💫 麻痺魔法 - 敵の行動阻止");
    this.addLog("  💚 回復魔法 - HP回復");
    this.addLog("  🔥❄️⚡ 属性魔法 - 弱点攻撃");
    this.addLog("");
    this.addLog("🏆 初級ボスクリア！中級編へ進め！");
    
    // 勝利エフェクト
    this.cameras.main.flash(1500, 255, 215, 0);
    
    // 敵スプライトを消す
    if (this.enemySprite) {
      this.tweens.add({
        targets: this.enemySprite,
        alpha: 0,
        scale: 0,
        duration: 1000,
        ease: 'Power2'
      });
    }
    
    // 次のステージへ
    this.time.delayedCall(5000, () => {
      this.scene.start('MapSelectionScene');
    });
  }

  gameOver(victory) {
    if (victory) {
      this.handleBossDefeat();
    } else {
      this.battleEnded = true;
      super.handleDefeat();
    }
  }

  // ====================================
  // ユーティリティ
  // ====================================

  // 敵がチャージ中かどうか（条件ブロック用）
  isEnemyCharging() {
    return this.knightPhase.chargeAttackPreparing;
  }

  // プレイヤーのHP割合（条件ブロック用）
  getPlayerHPPercent() {
    return (this.player.getHP() / this.player.maxHp) * 100;
  }

  // シールドが有効かどうか（条件ブロック用）
  isShieldActive() {
    return this.knightPhase.magicShield || this.knightPhase.physicalShield;
  }
}
