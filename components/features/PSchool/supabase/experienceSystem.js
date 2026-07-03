import { supabase } from '../lib/supabase.js';

// 経験値計算関数
export function calculateExperience(baseExp, blockCount, executionCount, targetBlockCount = 3, targetExecutionCount = 1) {
  // 基準値からの効率性を計算
  const blockEfficiency = Math.max(0, (targetBlockCount - blockCount + 1) / targetBlockCount);
  const executionEfficiency = Math.max(0, (targetExecutionCount - executionCount + 1) / targetExecutionCount);
  
  // 効率性ボーナス（最大2倍まで）
  const efficiencyMultiplier = 1 + (blockEfficiency * 0.5) + (executionEfficiency * 0.5);
  
  // 最終経験値を計算
  const finalExp = Math.floor(baseExp * efficiencyMultiplier);
  
  console.log('経験値計算:', {
    baseExp,
    blockCount,
    executionCount,
    blockEfficiency: (blockEfficiency * 100).toFixed(1) + '%',
    executionEfficiency: (executionEfficiency * 100).toFixed(1) + '%',
    efficiencyMultiplier: efficiencyMultiplier.toFixed(2),
    finalExp
  });
  
  return {
    experience: finalExp,
    blockCount,
    executionCount,
    efficiencyMultiplier,
    details: {
      blockEfficiency,
      executionEfficiency
    }
  };
}

// レベル計算関数（累積経験値からレベルを計算）
export function calculateLevel(totalExp) {
  // レベル1: 0-99 EXP
  // レベル2: 100-299 EXP  (200 EXP必要)
  // レベル3: 300-599 EXP  (300 EXP必要)
  // レベル4: 600-999 EXP  (400 EXP必要)
  // 以降、レベルが上がるたびに100ずつ必要経験値が増加
  
  let level = 1;
  let expNeeded = 100;
  let currentExp = totalExp;
  
  while (currentExp >= expNeeded) {
    currentExp -= expNeeded;
    level++;
    expNeeded += 100; // 次のレベルに必要な経験値を増加
  }
  
  return {
    level,
    currentExp,
    expNeeded,
    totalExp
  };
}

// プレイヤーの経験値を更新する
export async function updatePlayerExperience(userId, expGained, stageNumber, performance) {
  try {
    console.log('=== updatePlayerExperience 開始 ===');
    console.log('パラメータ:', { userId, expGained, stageNumber, performance });
    
    // Supabaseクライアントの確認
    if (!supabase) {
      throw new Error('Supabaseクライアントが初期化されていません');
    }
    
    // 現在のプロフィール取得
    console.log('プロフィールを取得中...');
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('xp, level')
      .eq('id', userId)
      .single();
    
    if (fetchError) {
      console.error('プロフィール取得エラーの詳細:', fetchError);
      return {
        success: false,
        error: `プロフィールの取得に失敗しました: ${fetchError.message}`,
        details: fetchError
      };
    }
    
    if (!profile) {
      console.error('プロフィールが見つかりません:', userId);
      return {
        success: false,
        error: 'プロフィールが見つかりません',
        details: { userId }
      };
    }
    
    console.log('取得したプロフィール:', profile);
    
    const currentExp = profile.xp || 0;
    const newTotalExp = currentExp + expGained;
    
    // 新しいレベルを計算
    const levelData = calculateLevel(newTotalExp);
    console.log('レベル計算結果:', levelData);
    
    // プロフィールテーブルの構造を確認（テスト用）
    console.log('プロフィールテーブルの更新を試行中...');
    
    // 経験値とレベルを更新
    const { data: updateData, error: updateError } = await supabase
      .from('profiles')
      .update({
        xp: newTotalExp,
        level: levelData.level,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select();
    
    if (updateError) {
      console.error('プロフィール更新エラーの詳細:', updateError);
      
      // エラーメッセージをより詳細に分析
      let errorMessage = '経験値の更新に失敗しました';
      if (updateError.code) {
        errorMessage += ` (コード: ${updateError.code})`;
      }
      if (updateError.message) {
        errorMessage += `: ${updateError.message}`;
      }
      
      return {
        success: false,
        error: errorMessage,
        details: updateError
      };
    }
    
    console.log('プロフィール更新成功:', updateData);
    
    // バトル記録も保存（エラーが発生しても続行）
    try {
      console.log('バトル記録を保存中...');
      const { error: recordError } = await supabase
        .from('battle_records')
        .insert({
          user_id: userId,
          stage_number: stageNumber,
          experience_gained: expGained,
          block_count: performance.blockCount,
          execution_count: performance.executionCount,
          efficiency_multiplier: performance.efficiencyMultiplier
        });
      
      if (recordError) {
        console.warn('バトル記録保存エラー (続行):', recordError);
      } else {
        console.log('バトル記録保存成功');
      }
    } catch (recordSaveError) {
      console.warn('バトル記録保存で例外発生 (続行):', recordSaveError);
    }
    
    const result = {
      success: true,
      experience: {
        gained: expGained,
        total: newTotalExp,
        previous: currentExp
      },
      level: {
        current: levelData.level,
        previous: profile.level || 1,
        levelUp: levelData.level > (profile.level || 1),
        currentExp: levelData.currentExp,
        expNeeded: levelData.expNeeded
      },
      performance
    };
    
    console.log('=== updatePlayerExperience 成功 ===');
    console.log('結果:', result);
    return result;
    
  } catch (error) {
    console.error('=== updatePlayerExperience で予期しないエラー ===');
    console.error('エラー詳細:', error);
    console.error('スタックトレース:', error.stack);
    
    return {
      success: false,
      error: `経験値更新処理中にエラーが発生しました: ${error.message}`,
      details: error
    };
  }
}

// プレイヤーの現在の経験値とレベル情報を取得
export async function getPlayerStats(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('xp, level, username')
      .eq('id', userId)
      .single();
    
    if (error) {
      console.error('プレイヤー情報取得エラー:', error);
      return {
        success: false,
        error: 'プレイヤー情報の取得に失敗しました',
        details: error
      };
    }
    
    const totalExp = data.xp || 0;
    const levelData = calculateLevel(totalExp);
    
    return {
      success: true,
      username: data.username,
      experience: totalExp,
      level: levelData.level,
      currentExp: levelData.currentExp,
      expNeeded: levelData.expNeeded
    };
    
  } catch (error) {
    console.error('プレイヤー情報取得処理エラー:', error);
    return {
      success: false,
      error: 'プレイヤー情報取得処理中にエラーが発生しました',
      details: error
    };
  }
}
