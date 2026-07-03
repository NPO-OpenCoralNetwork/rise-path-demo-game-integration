export class Player {
    constructor(scene, ui, level = 1) {
      this.scene = scene;
      this.ui = ui;
      
      // レベル（1〜100）- 数値であることを保証
      const parsedLevel = parseInt(level, 10);
      this.level = isNaN(parsedLevel) ? 1 : Math.min(Math.max(parsedLevel, 1), 100);
      
      // レベルに応じた基本HP
      this.maxHp = this.calculateMaxHP(this.level);
      this.hp = this.maxHp;
      
      // レベルに応じた攻撃力
      this.baseAttackPower = this.calculateAttackPower(this.level);
      // レベルに応じた魔法倍率
      this.magicMultiplier = this.calculateMagicMultiplier(this.level);
      
      this.sprite = null;
      
      console.log(`Player initialized: Level=${this.level}, HP=${this.hp}/${this.maxHp}, Attack=${this.baseAttackPower}`);
    }
    
    // レベルに応じた最大HPを計算
    // レベル1: 50HP → レベル100: 500HP
    calculateMaxHP(level) {
      const baseHP = 50;
      const hpPerLevel = 4.5; // (500 - 50) / 99 ≈ 4.5
      const result = Math.floor(baseHP + (level - 1) * hpPerLevel);
      return isNaN(result) ? 50 : result;
    }
    
    // レベルに応じた攻撃力を計算
    // レベル1: 3 → レベル100: 30
    calculateAttackPower(level) {
      const baseAttack = 3;
      const attackPerLevel = 0.27; // (30 - 3) / 99 ≈ 0.27
      const result = Math.floor(baseAttack + (level - 1) * attackPerLevel);
      return isNaN(result) ? 3 : result;
    }

    // レベルに応じた魔法倍率を計算（Lv1で1.0、以降はレベル毎に+3%、最大3.0倍）
    calculateMagicMultiplier(level) {
      const result = 1 + 0.03 * (level - 1);
      return Math.min(3, Math.max(1, result));
    }
  
    async attack() {
      await this.scene.playAnimation("playerAttack");
      const damage = this.baseAttackPower || 3;
      this.ui.log(`物理攻撃！${damage}ダメージ！`);
      this.scene.dealDamageToEnemy(damage, 'normal'); // 攻撃タイプを指定
      this.ui.updateHP(this.hp, this.scene.enemy.hp);
    }
  
    async castSpell(type, spell) {
    // 日本語→英語変換
    const typeMap = {
      'ライデン': 'RAIDEN',
      '炎': 'FIRE',
      '氷': 'ICE',
      '雷': 'THUNDER',
      '水': 'WATER',
      '回復': 'HEALING'
    };
    if (typeMap[type]) type = typeMap[type];

    // 回復魔法の特別処理
    if (type === 'HEALING') {
      this.ui.log('💚 回復魔法を詠唱中...');
      
      const healPower = 30;
      const maxHp = this.maxHp || 100; // デフォルト最大HP
      const oldHp = this.hp;
      this.hp = Math.min(maxHp, this.hp + healPower);
      
      if (this.scene && typeof this.scene.playAnimation === 'function') {
        await this.scene.playAnimation('healing');
      }
      
      this.ui.log(`✨ HPが${healPower}回復しました！ (HP: ${this.hp}/${maxHp})`);
      this.ui.updateHP(this.hp, this.scene.enemy.hp);
      return;
    }
    // 氷の盾の処理
    if (type === 'ICE') {
      this.ui.log('❄️ 氷の盾を詠唱中...');
      
      // シーンに氷の盾フラグを設定
      if (this.scene) {
        this.scene.iceShieldActive = true;
        if (typeof this.scene.playAnimation === 'function') {
          await this.scene.playAnimation('magic_ice');
        }
        this.ui.log('🛡️ 氷の盾が発動！次の攻撃を無効化します');
      }
      return;
    }
    // 攻撃魔法の処理
    const dmgTable = {
      FIRE: 15,
      ICE: 18,
      THUNDER: 18,
      WATER: 14,
      RAIDEN: 25
    };
    let dmg = dmgTable[type];
    // dmgが未定義ならダメージ0でフォールバック
    if (typeof dmg !== 'number') {
      dmg = 0;
      this.ui.log(`${spell || type}は直接ダメージを与えない特殊魔法です。`);
    } else {
      // レベル補正を適用
      dmg = Math.floor(dmg * this.magicMultiplier);
      if (type === 'RAIDEN') {
        this.ui.log(`⚡💧 ${spell || 'ライデン'}（水雷複合魔法）発動！`);
        this.ui.log(`水と雷の力が融合し、強力な電撃を放つ！ (${dmg}ダメージ)`);
      } else {
        this.ui.log(`${spell || type}の魔法！ (${dmg}ダメージ)`);
      }
    }
    // アニメーション再生（typeで判定）
    if (this.scene && typeof this.scene.playAnimation === 'function') {
      const animationType = type === 'RAIDEN' ? 'magic_thunder' : `magic_${type.toLowerCase()}`;
      await this.scene.playAnimation(animationType);
    }
    // ダメージ処理
    this.scene.dealDamageToEnemy(dmg, 'magic');
    this.ui.updateHP(this.hp, this.scene.enemy.hp);
    }
  
    // HP取得メソッド
    getHP() {
      return this.hp;
    }
      // HP設定メソッド
    setHP(value) {
      this.hp = value;
    }

    // ダメージを受けるメソッド
    takeDamage(amount) {
      const oldHP = this.hp;
      this.hp = Math.max(0, this.hp - amount);
      this.ui.updateHP(this.hp, this.scene.enemy.hp);
      return this.hp !== oldHP;
    }
    
    // 現在のステータスを取得
    getStatus() {
      return {
        level: this.level,
        hp: this.hp,
        maxHp: this.maxHp,
        attackPower: this.baseAttackPower
      };
    }
  }
