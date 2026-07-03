import { supabase } from '../lib/supabase.js';

// データベースの状態を確認する関数
export async function checkDatabaseSetup() {
  try {
    console.log('=== データベース状態確認開始 ===');
    
    // Supabaseの接続確認
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.error('認証エラー:', authError);
      return { success: false, error: '認証に失敗しました', details: authError };
    }
    
    if (!user) {
      console.log('ユーザーが認証されていません');
      return { success: false, error: 'ユーザーが認証されていません' };
    }
    
    console.log('認証済みユーザー:', user.id);
    
    // プロフィールテーブルの構造確認
    console.log('プロフィールテーブルの確認中...');
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, xp, level, created_at, updated_at')
      .eq('id', user.id)
      .single();
    
    if (profileError) {
      console.error('プロフィール取得エラー:', profileError);
      if (profileError.code === 'PGRST116') {
        return { 
          success: false, 
          error: 'プロフィールが見つかりません。プロフィールを作成してください。',
          needsProfile: true,
          details: profileError 
        };
      }
      return { success: false, error: 'プロフィール確認に失敗しました', details: profileError };
    }
    
    console.log('プロフィールデータ:', profileData);
    
    // xp と level カラムの存在確認
    const hasXp = 'xp' in profileData;
    const hasLevel = 'level' in profileData;
    
    console.log('カラム存在確認:', { hasXp, hasLevel });
    
    if (!hasXp || !hasLevel) {
      return {
        success: false,
        error: 'データベースに必要なカラムが不足しています',
        missingColumns: {
          xp: !hasXp,
          level: !hasLevel
        },
        needsUpdate: true
      };
    }
    
    // バトル記録テーブルの確認（任意）
    console.log('バトル記録テーブルの確認中...');
    try {
      const { data: battleRecords, error: battleError } = await supabase
        .from('battle_records')
        .select('id')
        .limit(1);
      
      if (battleError) {
        console.warn('バトル記録テーブルが存在しないか、アクセスできません:', battleError);
      } else {
        console.log('バトル記録テーブルは正常です');
      }
    } catch (battleCheckError) {
      console.warn('バトル記録テーブルチェック中にエラー:', battleCheckError);
    }
    
    console.log('=== データベース状態確認完了 ===');
    return {
      success: true,
      profile: profileData,
      hasRequiredColumns: true
    };
    
  } catch (error) {
    console.error('データベース確認中にエラー:', error);
    return {
      success: false,
      error: 'データベース確認中にエラーが発生しました',
      details: error
    };
  }
}

// プロフィールに必要なカラムを初期化する関数
export async function initializeProfileColumns(userId) {
  try {
    console.log('プロフィールカラムの初期化開始:', userId);
    
    const { data, error } = await supabase
      .from('profiles')
      .update({
        xp: 0,
        level: 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId)
      .select();
    
    if (error) {
      console.error('プロフィール初期化エラー:', error);
      return { success: false, error: 'プロフィールの初期化に失敗しました', details: error };
    }
    
    console.log('プロフィール初期化成功:', data);
    return { success: true, data };
    
  } catch (error) {
    console.error('プロフィール初期化中にエラー:', error);
    return { success: false, error: 'プロフィール初期化中にエラーが発生しました', details: error };
  }
}
