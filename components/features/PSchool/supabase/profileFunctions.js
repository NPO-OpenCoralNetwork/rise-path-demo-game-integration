import { supabase } from '../lib/supabase.js';

// プロフィール作成関数（詳細なフィードバック付き）
export const createProfile = async (userData) => {
  try {
    // ステップ1: 認証状態確認
    console.log('🔍 認証状態を確認中...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError) {
      console.error('❌ 認証エラー:', authError.message);
      return {
        success: false,
        error: `認証エラー: ${authError.message}`,
        step: 'authentication'
      };
    }
    
    if (!user) {
      console.error('❌ ユーザーが認証されていません');
      return {
        success: false,
        error: 'ユーザーが認証されていません',
        step: 'authentication'
      };
    }

    console.log('✅ 認証済みユーザー確認:', user.email);

    // ステップ2: プロフィール作成
    console.log('📝 プロフィールを作成中...');
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        username: userData.username,
        created_at: new Date().toISOString()
      })
      .select();

    if (error) {
      console.error('❌ プロフィール作成エラー:', error.message);
      
      let errorMessage = 'プロフィール作成に失敗しました';
      if (error.message.includes('duplicate key')) {
        errorMessage = 'このユーザーのプロフィールは既に存在します';
      } else if (error.message.includes('violates row-level security')) {
        errorMessage = 'プロフィール作成の権限がありません';
      }
      
      return {
        success: false,
        error: errorMessage,
        details: error.message,
        step: 'profile_creation'
      };
    }

    console.log('✅ プロフィール作成成功!', data);
    return {
      success: true,
      data: data,
      message: 'プロフィールが正常に作成されました',
      user_id: user.id
    };

  } catch (error) {
    console.error('❌ 予期しないエラー:', error.message);
    return {
      success: false,
      error: '予期しないエラーが発生しました',
      details: error.message,
      step: 'unexpected'
    };
  }
};

// サインアップとプロフィール作成（詳細フィードバック付き）
export const signUpWithProfile = async (email, password, username) => {
  try {
    console.log('🚀 サインアップを開始...');
    
    // Step 1: ユーザー登録
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          email: email
        }
      }
    });

    if (authError) {
      console.error('❌ サインアップエラー:', authError.message);
      return {
        success: false,
        error: `サインアップエラー: ${authError.message}`,
        step: 'signup'
      };
    }

    if (!authData.user) {
      console.error('❌ サインアップに失敗');
      return {
        success: false,
        error: 'サインアップに失敗しました',
        step: 'signup'
      };
    }

    console.log('✅ サインアップ成功:', authData.user.email);
    console.log('📋 ユーザーID:', authData.user.id);
    console.log('📋 セッション状態:', authData.session ? '✅ あり' : '❌ なし');

    // Step 2: セッションを確認
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.warn('⚠️ セッション取得エラー:', sessionError.message);
    }
    
    console.log('🔍 現在のセッション:', sessionData?.session ? '✅ あり' : '❌ なし');
    
    if (sessionData?.session) {
      console.log('🔑 アクセストークン:', sessionData.session.access_token ? '✅ あり' : '❌ なし');
    }

    // Step 3: プロフィール作成
    console.log('👤 プロフィールを作成中...', authData.user.id);
    
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        username
      })
      .select();

    if (profileError) {
      console.error('❌ プロフィール作成エラー:', profileError.message);
      console.error('📊 エラー詳細:', profileError);
      console.error('📊 エラーコード:', profileError.code);
      console.error('📊 エラーヒント:', profileError.hint);
      
      // RLSエラーの場合、詳細情報を表示
      if (profileError.message.includes('row-level security')) {
        console.error('🔒 RLSポリシー違反の詳細:');
        console.error('  - セッション:', sessionData?.session ? 'あり' : 'なし');
        console.error('  - ユーザーID:', authData.user.id);
        console.error('  - 認証状態:', authData.session ? 'あり' : 'なし');
      }
      
      return {
        success: false,
        error: `プロフィール作成エラー: ${profileError.message}`,
        step: 'profile_creation',
        user: authData.user
      };
    }

    console.log('🎉 サインアップとプロフィール作成の両方が成功!');
    return {
      success: true,
      user: authData.user,
      profile: profileData,
      message: 'アカウントとプロフィールが正常に作成されました'
    };

  } catch (error) {
    console.error('❌ 予期しないエラー:', error.message);
    return {
      success: false,
      error: '予期しないエラーが発生しました',
      details: error.message,
      step: 'unexpected'
    };
  }
};