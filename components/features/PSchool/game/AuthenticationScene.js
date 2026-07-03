// AuthenticationScene.js - Supabase認証専用ページ（ホーム画面より前に表示）
import { Scene } from 'phaser';
import { supabase } from '../lib/supabase.js';
import { createProfile, signUpWithProfile } from '../supabase/profileFunctions.js';

export class AuthenticationScene extends Scene {
    constructor() {
        console.log('🔧 AuthenticationScene constructor START');
        try {
            super({ key: 'AuthenticationScene' });
            console.log('✅ AuthenticationScene constructor - super() 呼び出し成功');
            this.currentUser = null;
            this.authMode = 'login'; // 'login' or 'signup'
            console.log('✅ AuthenticationScene constructor - 初期化完了');
        } catch (error) {
            console.error('❌ AuthenticationScene constructor エラー:', error);
            throw error;
        }
    }

    init() {
        console.log('🎯 AuthenticationScene.init() メソッドが呼び出されました');
    }

    preload() {
        console.log('📦 AuthenticationScene.preload() メソッドが呼び出されました');
        this.load.image('auth-bg', '/p_school/assets/battle-seen01.jpeg');
        
        this.load.on('filecomplete-image-auth-bg', (key, type, data) => {
            console.log('✅ Background image loaded successfully:', key);
        });

        this.load.on('loaderror', (fileObj) => {
            console.error('❌ Error loading asset:', fileObj.key, fileObj.src);
        });
    }

    async create() {
        console.log('🚀 AuthenticationScene.create() メソッドが呼び出されました');
        console.log('📊 画面サイズ:', this.scale.width, 'x', this.scale.height);
        
        // 実行ボタンを非表示にする
        this.hideRunButton();
        
        // Supabase接続テスト
        try {
            console.log('🔗 Supabase接続をテスト中...');
            await this.testSupabaseConnection();
        } catch (error) {
            console.error('⚠️ Supabase接続テストに失敗しましたが、続行します:', error);
        }
        
        // 背景作成
        console.log('🎨 背景を作成中...');
        this.createBackground();
        
        // UI作成
        console.log('🖼️ UIを作成中...');
        this.createAuthUI();
        
        // エフェクト作成
        console.log('✨ エフェクトを作成中...');
        this.createVisualEffects();
        
        console.log('✅ AuthenticationScene setup complete');
        
        // デバッグ: 表示リストの確認
        console.log('📊 Display List:', this.children.list.map(child => ({
            type: child.type,
            key: child.texture ? child.texture.key : 'no-texture',
            visible: child.visible,
            alpha: child.alpha,
            x: child.x,
            y: child.y,
            depth: child.depth
        })));
        
        console.log('📷 Camera:', {
            x: this.cameras.main.x,
            y: this.cameras.main.y,
            scrollX: this.cameras.main.scrollX,
            scrollY: this.cameras.main.scrollY,
            zoom: this.cameras.main.zoom,
            backgroundColor: this.cameras.main.backgroundColor.rgba
        });

        // 既存ユーザーをチェック（UIを作成してから実行）
        console.log('🔍 既存ユーザーをチェック中...');
        await this.checkExistingUser();
    }

    async testSupabaseConnection() {
        try {
            // Supabaseクライアントが正しく初期化されているかテスト
            if (!supabase) {
                throw new Error('Supabaseクライアントが初期化されていません');
            }

            // 簡単な接続テスト - セッション取得を試行
            console.log('🧪 Supabaseセッション取得テスト...');
            const { data, error } = await Promise.race([
                supabase.auth.getSession(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 5000)
                )
            ]);

            if (error) {
                console.warn('⚠️ セッション取得エラー（正常な場合もあります）:', error.message);
            } else {
                console.log('✅ Supabase接続テスト成功');
            }
        } catch (error) {
            console.error('❌ Supabase接続テスト失敗:', error.message);
            // 接続エラーでもアプリケーションを続行
            this.showMessage('サーバー接続に問題がありますが、ローカル機能は利用できます', 'error');
        }
    }

    async checkExistingUser() {
        try {
            console.log('🔐 Supabase認証状態をチェック中...');
            
            // Supabaseが利用できない場合のフォールバック
            if (!supabase) {
                console.warn('⚠️ Supabaseクライアントが利用できません - ローカルモードで続行');
                return;
            }
            
            // タイムアウト付きでセッション取得
            const sessionPromise = supabase.auth.getSession();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Session fetch timeout')), 10000)
            );
            
            const { data: { session }, error: sessionError } = await Promise.race([
                sessionPromise,
                timeoutPromise
            ]);
            
            if (sessionError) {
                console.error('❌ セッション取得エラー:', sessionError.message);
                // エラーでも続行し、ログインフォームを表示
                console.log('🆕 セッション取得に失敗 - ログインフォームを表示');
                return;
            }
            
            console.log('📝 現在のセッション:', session ? '✅ あり' : '❌ なし');
            
            if (session && session.user) {
                console.log('👤 既存ユーザーが見つかりました:', session.user.id);
                this.currentUser = session.user;
                
                // 少し遅延を入れてからHomeSceneに遷移
                this.time.delayedCall(100, () => {
                    console.log('🏠 HomeSceneに遷移します...');
                    this.cleanupInputs();
                    this.scene.stop('AuthenticationScene');
                    this.scene.start('HomeScene', { 
                        playerData: { 
                            userId: session.user.id,
                            email: session.user.email,
                            username: session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'Player'
                        }
                    });
                });
                return;
            }
            
            console.log('🆕 ログインしていないユーザー - ログインフォームを表示');
            
        } catch (error) {
            console.error('💥 認証チェックエラー:', error.message);
            
            // エラーが発生してもアプリケーションを続行
            if (error.message.includes('timeout') || error.message.includes('Timeout')) {
                console.warn('⏱️ 認証チェックがタイムアウトしました - ログインフォームを表示');
                this.showMessage('サーバー応答が遅れています。手動でログインしてください。', 'error');
            } else if (error.message.includes('connection') || error.message.includes('Connection')) {
                console.warn('🌐 接続エラー - オフラインモードで続行');
                this.showMessage('インターネット接続を確認してください。ゲストモードは利用できます。', 'error');
            } else {
                console.warn('🔧 一般的なエラー - ログインフォームを表示');
                this.showMessage('認証システムに一時的な問題があります。', 'error');
            }
        }
    }

    createBackground() {
        console.log('🎨 背景画像を作成中...');
        
        // 画像が正常に読み込まれているか確認
        if (!this.textures.exists('auth-bg')) {
            console.warn('⚠️ Background image texture "auth-bg" not found! Using fallback color.');
            this.add.rectangle(
                this.scale.width / 2,
                this.scale.height / 2,
                this.scale.width,
                this.scale.height,
                0x0f0f23
            );
            return;
        }

        // 画像背景を表示
        const bg = this.add.image(
            this.scale.width / 2,
            this.scale.height / 2,
            'auth-bg'
        );
        
        // 画像サイズに合わせてスケーリング
        const scaleX = this.scale.width / bg.width;
        const scaleY = this.scale.height / bg.height;
        const scale = Math.max(scaleX, scaleY);
        bg.setScale(scale);
        
        // 背景を暗くするためのオーバーレイ（HTMLフォームを目立たせるため）
        this.add.rectangle(
            this.scale.width / 2,
            this.scale.height / 2,
            this.scale.width,
            this.scale.height,
            0x000000,
            0.5
        );
    }

    createAuthUI() {
        // タイトル (これはPhaser側でかっこよく表示し続ける)
        this.titleText = this.add.text(
            this.scale.width / 2,
            this.scale.height * 0.15,
            'Code of Ruins',
            {
                fontSize: Math.min(this.scale.width * 0.08, 64) + 'px',
                fill: '#f39c12',
                fontFamily: 'Arial',
                fontStyle: 'bold',
                stroke: '#000000',
                strokeThickness: 6
            }
        ).setOrigin(0.5);

        // サブタイトル
        this.subtitleText = this.add.text(
            this.scale.width / 2,
            this.scale.height * 0.23,
            '〜 魔法とコードの遺跡 〜',
            {
                fontSize: Math.min(this.scale.width * 0.03, 24) + 'px',
                fill: '#ecf0f1',
                fontFamily: 'Arial',
                fontStyle: 'italic'
            }
        ).setOrigin(0.5);

        // 注意: 以前ここで呼び出していた createAuthPanel() などの 
        // Phaserベースの入力UI作成は、HTMLフォームと重複するため削除しました。
        
        // 実際のHTML入力フィールドを作成
        this.createHTMLInputs();
        
        // デバッグ用：強制ログアウトボタンのみ残す（画面端なので邪魔にならない）
        this.createForceLogoutButton();
    }

    createAuthPanel() {
        const panelWidth = Math.min(400, this.scale.width * 0.8);
        const panelHeight = Math.min(350, this.scale.height * 0.6);
        const panelX = this.scale.width / 2;
        const panelY = this.scale.height * 0.5;

        // パネル背景
        this.authPanel = this.add.rectangle(
            panelX,
            panelY,
            panelWidth,
            panelHeight,
            0x2c3e50,
            0.9
        ).setStrokeStyle(3, 0x3498db);

        // パネルタイトル
        this.panelTitle = this.add.text(
            panelX,
            panelY - panelHeight * 0.35,
            this.authMode === 'login' ? 'ログイン' : 'アカウント作成',
            {
                fontSize: Math.min(this.scale.width * 0.03, 24) + 'px',
                fill: '#3498db',
                fontFamily: 'Arial',
                fontStyle: 'bold'
            }
        ).setOrigin(0.5);

        // 入力フィールドの説明（実際の入力フィールドはHTMLで作成）
        this.createInputFields(panelX, panelY, panelWidth, panelHeight);

        // 認証ボタン
        this.createAuthButton(panelX, panelY + panelHeight * 0.25, panelWidth);
    }

    createInputFields(panelX, panelY, panelWidth, panelHeight) {
        const fieldWidth = panelWidth * 0.8;
        const fieldHeight = 40;
        const fontSize = Math.min(this.scale.width * 0.02, 16);

        // メールアドレス欄
        this.emailLabel = this.add.text(
            panelX,
            panelY - panelHeight * 0.15,
            'メールアドレス',
            {
                fontSize: fontSize + 'px',
                fill: '#ecf0f1',
                fontFamily: 'Arial'
            }
        ).setOrigin(0.5);

        this.emailField = this.add.rectangle(
            panelX,
            panelY - panelHeight * 0.05,
            fieldWidth,
            fieldHeight,
            0x34495e
        ).setStrokeStyle(2, 0x3498db)
        .setInteractive()
        .on('pointerdown', () => this.focusEmailInput());

        this.emailPlaceholder = this.add.text(
            panelX,
            panelY - panelHeight * 0.05,
            'example@email.com',
            {
                fontSize: (fontSize - 2) + 'px',
                fill: '#7f8c8d',
                fontFamily: 'Arial'
            }
        ).setOrigin(0.5);

        // パスワード欄
        this.passwordLabel = this.add.text(
            panelX,
            panelY + panelHeight * 0.05,
            'パスワード',
            {
                fontSize: fontSize + 'px',
                fill: '#ecf0f1',
                fontFamily: 'Arial'
            }
        ).setOrigin(0.5);

        this.passwordField = this.add.rectangle(
            panelX,
            panelY + panelHeight * 0.15,
            fieldWidth,
            fieldHeight,
            0x34495e
        ).setStrokeStyle(2, 0x3498db)
        .setInteractive()
        .on('pointerdown', () => this.focusPasswordInput());

        this.passwordPlaceholder = this.add.text(
            panelX,
            panelY + panelHeight * 0.15,
            '••••••••',
            {
                fontSize: (fontSize - 2) + 'px',
                fill: '#7f8c8d',
                fontFamily: 'Arial'
            }
        ).setOrigin(0.5);

        // 実際のHTML入力フィールドを作成
        this.createHTMLInputs();
    }

    createHTMLInputs() {
        console.log('📝 HTML入力フィールドを作成中...');
        
        // 既存の認証コンテナがあれば削除
        const existingContainer = document.getElementById('authContainer');
        if (existingContainer) {
            console.log('🗑️ 既存の認証コンテナを削除中...');
            existingContainer.remove();
        }
        
        // メインコンテナを作成
        const container = document.createElement('div');
        container.id = 'authContainer';
        container.className = 'auth-container';
        console.log('📦 認証コンテナを作成しました');
        
        // フォームを作成
        const form = document.createElement('div');
        form.className = 'auth-form';
        console.log('📋 認証フォームを作成しました');
        
        // タイトル
        const title = document.createElement('h2');
        title.textContent = this.authMode === 'login' ? 'ログイン' : 'アカウント作成';
        form.appendChild(title);
        
        // メール入力
        this.emailInput = document.createElement('input');
        this.emailInput.type = 'email';
        this.emailInput.id = 'auth-email-input';
        this.emailInput.placeholder = 'メールアドレス';
        this.emailInput.required = true;
        form.appendChild(this.emailInput);
        console.log('📧 メール入力フィールドを作成しました');
        
        // 入力フィールドにフォーカスしたときにエラーメッセージをクリア
        this.emailInput.addEventListener('focus', () => {
            if (this.messageDiv && this.messageDiv.className.includes('error')) {
                this.messageDiv.style.display = 'none';
            }
            if (this.messageText && this.messageText.style && this.messageText.style.color === '#e74c3c') {
                this.messageText.destroy();
                this.messageText = null;
            }
        });
        
        // パスワード入力
        this.passwordInput = document.createElement('input');
        this.passwordInput.type = 'password';
        this.passwordInput.id = 'auth-password-input';
        this.passwordInput.placeholder = 'パスワード';
        this.passwordInput.required = true;
        form.appendChild(this.passwordInput);
        console.log('🔑 パスワード入力フィールドを作成しました');
        
        // 入力フィールドにフォーカスしたときにエラーメッセージをクリア
        this.passwordInput.addEventListener('focus', () => {
            if (this.messageDiv && this.messageDiv.className.includes('error')) {
                this.messageDiv.style.display = 'none';
            }
            if (this.messageText && this.messageText.style && this.messageText.style.color === '#e74c3c') {
                this.messageText.destroy();
                this.messageText = null;
            }
        });
        
        // メッセージエリア
        this.messageDiv = document.createElement('div');
        this.messageDiv.id = 'authMessage';
        this.messageDiv.className = 'auth-message';
        this.messageDiv.style.display = 'none';
        form.appendChild(this.messageDiv);
        
        // 認証ボタン
        const authBtn = document.createElement('button');
        authBtn.textContent = this.authMode === 'login' ? 'ログイン' : 'アカウント作成';
        authBtn.className = 'primary-btn';
        authBtn.onclick = () => this.handleAuth();
        form.appendChild(authBtn);
        console.log('🔘 認証ボタンを作成しました');
        
        // モード切り替えボタン
        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = this.authMode === 'login' ? 'アカウント作成に切り替え' : 'ログインに切り替え';
        toggleBtn.className = 'secondary-btn';
        toggleBtn.onclick = () => this.toggleAuthMode();
        form.appendChild(toggleBtn);
        
        // ゲストボタン
        const guestBtn = document.createElement('button');
        guestBtn.textContent = 'ゲストとしてプレイ';
        guestBtn.className = 'guest-btn';
        guestBtn.onclick = () => this.handleGuestPlay();
        form.appendChild(guestBtn);
        console.log('👤 ゲストプレイボタンを作成しました');
        
        // Enterキーでログイン実行
        this.passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                console.log('⏎ Enterキーが押されました - 認証処理を開始');
                this.handleAuth();
            }
        });
        
        // フォームをコンテナに追加
        container.appendChild(form);
        
        // ドキュメントに追加
        document.body.appendChild(container);
        
        console.log('✅ HTML認証フォームの作成完了');
        console.log('🌐 認証フォームがDOMに追加されました');
        
        // フォームが実際にDOMに追加されたか確認
        setTimeout(() => {
            const addedContainer = document.getElementById('authContainer');
            if (addedContainer) {
                console.log('✅ 認証フォームがDOMに正常に追加されていることを確認しました');
                console.log('📊 フォームの表示スタイル:', window.getComputedStyle(addedContainer).display);
                console.log('📊 フォームの可視性:', window.getComputedStyle(addedContainer).visibility);
                console.log('📊 フォームのz-index:', window.getComputedStyle(addedContainer).zIndex);
            } else {
                console.error('❌ 認証フォームがDOMに見つかりません！');
            }
        }, 100);
    }

    focusEmailInput() {
        if (this.emailInput) {
            this.emailInput.focus();
        }
    }

    focusPasswordInput() {
        if (this.passwordInput) {
            this.passwordInput.focus();
        }
    }

    createAuthButton(x, y, panelWidth) {
        const buttonWidth = panelWidth * 0.6;
        const buttonHeight = 50;

        this.authButton = this.add.rectangle(
            x,
            y,
            buttonWidth,
            buttonHeight,
            0x3498db
        ).setStrokeStyle(2, 0x2980b9)
        .setInteractive()
        .on('pointerdown', () => this.handleAuth())
        .on('pointerover', () => {
            this.authButton.setFillStyle(0x5dade2);
            this.authButton.setScale(1.05);
        })
        .on('pointerout', () => {
            this.authButton.setFillStyle(0x3498db);
            this.authButton.setScale(1);
        });

        this.authButtonText = this.add.text(
            x,
            y,
            this.authMode === 'login' ? 'ログイン' : 'アカウント作成',
            {
                fontSize: Math.min(this.scale.width * 0.022, 18) + 'px',
                fill: '#ffffff',
                fontFamily: 'Arial',
                fontStyle: 'bold'
            }
        ).setOrigin(0.5);
    }

    createModeToggle() {
        const toggleY = this.scale.height * 0.75;
        
        this.modeToggleText = this.add.text(
            this.scale.width / 2,
            toggleY,
            this.authMode === 'login' ? 'アカウントをお持ちでない方は' : '既にアカウントをお持ちの方は',
            {
                fontSize: Math.min(this.scale.width * 0.018, 14) + 'px',
                fill: '#bdc3c7',
                fontFamily: 'Arial'
            }
        ).setOrigin(0.5);

        this.modeToggleButton = this.add.text(
            this.scale.width / 2,
            toggleY + 30,
            this.authMode === 'login' ? '新規登録' : 'ログイン',
            {
                fontSize: Math.min(this.scale.width * 0.02, 16) + 'px',
                fill: '#3498db',
                fontFamily: 'Arial',
                fontStyle: 'bold'
            }
        ).setOrigin(0.5)
        .setInteractive()
        .on('pointerdown', () => this.toggleAuthMode())
        .on('pointerover', () => {
            this.modeToggleButton.setFill('#5dade2');
            this.modeToggleButton.setScale(1.05);
        })
        .on('pointerout', () => {
            this.modeToggleButton.setFill('#3498db');
            this.modeToggleButton.setScale(1);
        });
    }

    createGuestPlayButton() {
        const guestY = this.scale.height * 0.85;
        
        this.guestButton = this.add.rectangle(
            this.scale.width / 2,
            guestY,
            200,
            40,
            0x95a5a6
        ).setStrokeStyle(2, 0x7f8c8d)
        .setInteractive()
        .on('pointerdown', () => this.handleGuestPlay())
        .on('pointerover', () => {
            this.guestButton.setFillStyle(0xbdc3c7);
            this.guestButton.setScale(1.05);
        })
        .on('pointerout', () => {
            this.guestButton.setFillStyle(0x95a5a6);
            this.guestButton.setScale(1);
        });

        this.guestButtonText = this.add.text(
            this.scale.width / 2,
            guestY,
            'ゲストでプレイ',
            {
                fontSize: Math.min(this.scale.width * 0.018, 14) + 'px',
                fill: '#2c3e50',
                fontFamily: 'Arial',
                fontStyle: 'bold'
            }
        ).setOrigin(0.5);
    }

    createVisualEffects() {
        // 背景の魔法の粒子
        for (let i = 0; i < 20; i++) {
            const particle = this.add.circle(
                Math.random() * this.scale.width,
                Math.random() * this.scale.height,
                Math.random() * 3 + 1,
                0x3498db,
                0.6
            );

            this.tweens.add({
                targets: particle,
                alpha: { from: 0.6, to: 0.1 },
                scale: { from: 1, to: 1.5 },
                duration: 3000 + Math.random() * 2000,
                yoyo: true,
                repeat: -1,
                delay: Math.random() * 2000
            });
        }

        // タイトルの輝きエフェクト
        this.tweens.add({
            targets: this.titleText,
            alpha: { from: 1, to: 0.8 },
            duration: 2000,
            yoyo: true,
            repeat: -1
        });
    }

    async handleAuth() {
        console.log('🔐 認証処理を開始します...');
        
        const email = this.emailInput?.value?.trim();
        const password = this.passwordInput?.value?.trim();

        console.log('📧 入力されたメール:', email ? '✅ あり' : '❌ なし');
        console.log('🔑 入力されたパスワード:', password ? '✅ あり' : '❌ なし');

        if (!email || !password) {
            console.log('❌ バリデーション失敗: メールまたはパスワードが空です');
            this.showMessage('メールアドレスとパスワードを入力してください', 'error');
            return;
        }

        // メールアドレス形式チェック
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            console.log('❌ バリデーション失敗: 無効なメールアドレス形式');
            this.showMessage('有効なメールアドレスを入力してください\n例: user@example.com', 'error');
            return;
        }

        if (password.length < 6) {
            console.log('❌ バリデーション失敗: パスワードが短すぎます');
            this.showMessage('パスワードは6文字以上で入力してください', 'error');
            return;
        }

        console.log('⏳ 認証モード:', this.authMode === 'login' ? 'ログイン' : 'サインアップ');
        this.showLoadingState(true);

        try {
            if (this.authMode === 'login') {
                console.log('🔑 ログイン処理を実行中...');
                
                // Supabaseが利用できない場合のチェック
                if (!supabase) {
                    throw new Error('認証サービスが利用できません。後でもう一度お試しください。');
                }
                
                // タイムアウト付きログイン処理
                const loginPromise = supabase.auth.signInWithPassword({ email, password });
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('ログイン処理がタイムアウトしました')), 15000)
                );
                
                const { data, error } = await Promise.race([loginPromise, timeoutPromise]);

                if (error) {
                    console.error('❌ ログインエラー:', error.message);
                    throw error;
                }

                console.log('✅ ログインに成功しました！ユーザーID:', data.user.id);
                this.showMessage('ログインに成功しました！', 'success');
                
                // ホーム画面へ遷移
                setTimeout(() => {
                    console.log('🏠 ログイン成功 - HomeSceneに遷移します');
                    this.cleanupInputs();
                    this.scene.stop('AuthenticationScene'); // 認証シーンを停止
                    this.scene.start('HomeScene', {
                        playerData: {
                            userId: data.user.id,
                            email: data.user.email,
                            username: data.user.user_metadata?.username || email.split('@')[0]
                        }
                    });
                }, 1000);

            } else {
                console.log('📝 サインアップ処理を実行中...');
                
                // Supabaseが利用できない場合のチェック
                if (!supabase) {
                    throw new Error('認証サービスが利用できません。後でもう一度お試しください。');
                }
                
                // サインアップ処理（プロフィール作成付き）
                const username = email.split('@')[0]; // メールアドレスからユーザー名を生成
                
                // タイムアウト付きサインアップ処理
                const signupPromise = signUpWithProfile(email, password, username);
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('サインアップ処理がタイムアウトしました')), 20000)
                );
                
                const result = await Promise.race([signupPromise, timeoutPromise]);

                if (!result.success) {
                    console.error('❌ サインアップエラー:', result.error);
                    throw new Error(result.error);
                }

                if (!result.user?.email_confirmed_at) {
                    console.log('📧 確認メール送信済み - ユーザーはメール確認が必要です');
                    this.showMessage('確認メールを送信しました。メールを確認してからログインしてください。', 'success');
                    this.toggleAuthMode(); // ログインモードに切り替え
                } else {
                    console.log('✅ サインアップに成功しました！ユーザーID:', result.user.id);
                    this.showMessage('アカウント作成に成功しました！', 'success');
                    
                    // ホーム画面へ遷移
                    setTimeout(() => {
                        console.log('🏠 サインアップ成功 - HomeSceneに遷移します');
                        this.cleanupInputs();
                        this.scene.stop('AuthenticationScene'); // 認証シーンを停止
                        this.scene.start('HomeScene', {
                            playerData: {
                                userId: result.user.id,
                                email: result.user.email,
                                username: username
                            }
                        });
                    }, 1000);
                }
            }

        } catch (error) {
            console.error('💥 認証エラー:', error);
            let message = '認証に失敗しました。';
            
            // より詳細なエラーハンドリング
            if (error.message.includes('Unable to validate email address') || error.message.includes('invalid format')) {
                message = '無効なメールアドレス形式です\n例: user@example.com';
                console.log('❌ 認証失敗: メール形式エラー');
            } else if (error.message.includes('Invalid login credentials')) {
                message = 'メールアドレスまたはパスワードが正しくありません。';
                console.log('❌ 認証失敗: 無効な認証情報');
            } else if (error.message.includes('Email not confirmed')) {
                message = 'メールアドレスが確認されていません。確認メールを確認してください。';
                console.log('❌ 認証失敗: メール未確認');
            } else if (error.message.includes('User already registered')) {
                message = 'このメールアドレスは既に登録されています。ログインしてください。';
                console.log('❌ 認証失敗: ユーザー既存');
            } else if (error.message.includes('タイムアウト')) {
                message = 'サーバーの応答に時間がかかっています。しばらく待ってからもう一度お試しください。';
                console.log('❌ 認証失敗: タイムアウト');
            } else if (error.message.includes('connection') || error.message.includes('Connection')) {
                message = 'インターネット接続を確認してください。';
                console.log('❌ 認証失敗: 接続エラー');
            } else if (error.message.includes('認証サービスが利用できません')) {
                message = error.message;
                console.log('❌ 認証失敗: サービス利用不可');
            } else if (error.message.includes('サインアップエラー')) {
                message = error.message;
                console.log('❌ 認証失敗: サインアップエラー');
            } else if (error.message.includes('プロフィール作成エラー')) {
                message = error.message;
                console.log('❌ 認証失敗: プロフィール作成エラー');
            } else if (error.message.includes('Receiving end does not exist')) {
                message = 'ブラウザ拡張機能との競合が発生しました。ページを再読み込みしてください。';
                console.log('❌ 認証失敗: 拡張機能競合');
            } else {
                console.log('❌ 認証失敗: 不明なエラー -', error.message);
            }
            
            this.showMessage(message, 'error');
        } finally {
            console.log('🔄 認証処理完了 - ローディング状態を解除');
            this.showLoadingState(false);
        }
    }

    toggleAuthMode() {
        this.authMode = this.authMode === 'login' ? 'signup' : 'login';
        
        // Phaser UI更新（もし存在する場合）
        if (this.panelTitle) {
            this.panelTitle.setText(this.authMode === 'login' ? 'ログイン' : 'アカウント作成');
        }
        if (this.authButtonText) {
            this.authButtonText.setText(this.authMode === 'login' ? 'ログイン' : 'サインアップ');
        }
        if (this.modeToggleText) {
            this.modeToggleText.setText(this.authMode === 'login' ? 'アカウントをお持ちでない方は' : '既にアカウントをお持ちの方は');
        }
        if (this.modeToggleButton) {
            this.modeToggleButton.setText(this.authMode === 'login' ? '新規登録' : 'ログイン');
        }

        // HTML UI更新
        const titleElement = document.querySelector('#authContainer h2');
        if (titleElement) {
            titleElement.textContent = this.authMode === 'login' ? 'ログイン' : 'アカウント作成';
        }
        
        const authBtn = document.querySelector('#authContainer .primary-btn');
        if (authBtn) {
            authBtn.textContent = this.authMode === 'login' ? 'ログイン' : 'サインアップ';
        }
        
        const toggleBtn = document.querySelector('#authContainer .secondary-btn');
        if (toggleBtn) {
            toggleBtn.textContent = this.authMode === 'login' ? 'アカウント作成に切り替え' : 'ログインに切り替え';
        }

        // 入力フィールドクリア
        if (this.emailInput) this.emailInput.value = '';
        if (this.passwordInput) this.passwordInput.value = '';
        
        // エラーメッセージもクリア
        if (this.messageDiv) this.messageDiv.style.display = 'none';
        if (this.messageText) {
            this.messageText.destroy();
            this.messageText = null;
        }
    }

    handleGuestPlay() {
        console.log('👤 ゲストプレイが選択されました');
        this.cleanupInputs();
        this.scene.stop('AuthenticationScene'); // 認証シーンを停止
        console.log('🏠 ゲストプレイ - HomeSceneに遷移します');
        this.scene.start('HomeScene', {
            playerData: {
                userId: 'guest_' + Date.now(),
                email: null,
                username: 'ゲスト',
                isGuest: true
            }
        });
    }

    showMessage(text, type = 'info') {
        // HTMLメッセージエリアがある場合はそちらを使用
        if (this.messageDiv) {
            this.messageDiv.textContent = text;
            this.messageDiv.className = `auth-message ${type}`;
            this.messageDiv.style.display = 'block';
            
            // エラーメッセージは自動で消えないようにする（成功メッセージのみ3秒後に消す）
            if (type === 'success') {
                setTimeout(() => {
                    if (this.messageDiv) {
                        this.messageDiv.style.display = 'none';
                    }
                }, 3000);
            }
            return;
        }
        
        // フォールバック：Phaserテキスト
        if (this.messageText) {
            this.messageText.destroy();
        }

        const color = type === 'error' ? '#e74c3c' : type === 'success' ? '#27ae60' : '#3498db';
        
        this.messageText = this.add.text(
            this.scale.width / 2,
            this.scale.height * 0.9,
            text,
            {
                fontSize: Math.min(this.scale.width * 0.018, 14) + 'px',
                fill: color,
                fontFamily: 'Arial',
                wordWrap: { width: this.scale.width * 0.8, useAdvancedWrap: true },
                align: 'center'
            }
        ).setOrigin(0.5);

        // エラーメッセージは自動で消えないようにする（成功メッセージのみ3秒後に消す）
        if (type === 'success') {
            this.time.delayedCall(3000, () => {
                if (this.messageText) {
                    this.messageText.destroy();
                    this.messageText = null;
                }
            });
        }
    }

    showLoadingState(isLoading) {
        if (isLoading) {
            this.authButton.setFillStyle(0x7f8c8d);
            this.authButtonText.setText('処理中...');
            this.authButton.disableInteractive();
        } else {
            this.authButton.setFillStyle(0x3498db);
            this.authButtonText.setText(this.authMode === 'login' ? 'ログイン' : 'アカウント作成');
            this.authButton.setInteractive();
        }
    }

    cleanupInputs() {
        console.log('🧹 HTML入力フィールドをクリーンアップ中...');
        
        // 認証コンテナを削除
        const authContainer = document.getElementById('authContainer');
        if (authContainer) {
            try {
                document.body.removeChild(authContainer);
                console.log('✅ 認証コンテナを削除しました');
            } catch (error) {
                console.error('❌ 認証コンテナ削除エラー:', error);
            }
        }
        
        // 個別の入力フィールドも確認して削除
        const emailInput = document.getElementById('auth-email-input');
        if (emailInput) {
            try {
                emailInput.remove();
                console.log('✅ メール入力フィールドを削除しました');
            } catch (error) {
                console.error('❌ メール入力フィールド削除エラー:', error);
            }
        }
        
        const passwordInput = document.getElementById('auth-password-input');
        if (passwordInput) {
            try {
                passwordInput.remove();
                console.log('✅ パスワード入力フィールドを削除しました');
            } catch (error) {
                console.error('❌ パスワード入力フィールド削除エラー:', error);
            }
        }
        
        // クラスで検索して削除
        const authElements = document.querySelectorAll('.auth-container, .auth-form');
        authElements.forEach(element => {
            try {
                element.remove();
                console.log('✅ 認証要素を削除しました');
            } catch (error) {
                console.error('❌ 認証要素削除エラー:', error);
            }
        });
        
        // プロパティをリセット
        this.emailInput = null;
        this.passwordInput = null;
        this.messageDiv = null;
        
        console.log('🎯 認証フォームのクリーンアップが完了しました');
    }

    shutdown() {
        this.cleanupInputs();
    }

    // リサイズ対応
    resize(gameSize) {
        const width = gameSize.width;
        const height = gameSize.height;
        
        this.scale.resize(width, height);
        
        if (this.background) {
            this.background.setSize(width, height);
            this.background.setPosition(width / 2, height / 2);
        }

        // すべてのUI要素の位置を更新
        if (this.titleText) {
            this.titleText.setPosition(width / 2, height * 0.15);
        }
        
        if (this.subtitleText) {
            this.subtitleText.setPosition(width / 2, height * 0.22);
        }

        // HTML入力フィールドの位置も更新
        if (this.emailInput && this.passwordInput) {
            const gameCanvas = document.querySelector('#gameCanvas canvas') || document.getElementById('gameCanvas');
            const canvasRect = gameCanvas.getBoundingClientRect();
            
            this.emailInput.style.left = (canvasRect.left + width / 2 - 160) + 'px';
            this.emailInput.style.top = (canvasRect.top + height * 0.45) + 'px';
            
            this.passwordInput.style.left = (canvasRect.left + width / 2 - 160) + 'px';
            this.passwordInput.style.top = (canvasRect.top + height * 0.65) + 'px';
        }
    }

    createForceLogoutButton() {
        // デバッグ用の強制ログアウトボタン
        const logoutY = this.scale.height * 0.95;
        
        this.forceLogoutButton = this.add.rectangle(
            this.scale.width * 0.1,
            logoutY,
            120,
            30,
            0xe74c3c
        ).setStrokeStyle(1, 0xc0392b)
        .setInteractive()
        .on('pointerdown', () => this.forceLogout())
        .on('pointerover', () => {
            this.forceLogoutButton.setFillStyle(0xc0392b);
            this.forceLogoutButton.setScale(1.05);
        })
        .on('pointerout', () => {
            this.forceLogoutButton.setFillStyle(0xe74c3c);
            this.forceLogoutButton.setScale(1);
        });

        this.forceLogoutButtonText = this.add.text(
            this.scale.width * 0.1,
            logoutY,
            '強制ログアウト',
            {
                fontSize: '12px',
                fill: '#ffffff',
                fontFamily: 'Arial',
                fontStyle: 'bold'
            }
        ).setOrigin(0.5);
    }

    async forceLogout() {
        try {
            console.log('🚨 強制ログアウトを実行中...');
            
            // Supabaseが利用可能かチェック
            if (supabase) {
                // タイムアウト付きログアウト
                const logoutPromise = supabase.auth.signOut();
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Logout timeout')), 5000)
                );
                
                try {
                    const { error } = await Promise.race([logoutPromise, timeoutPromise]);
                    if (error) {
                        console.error('❌ ログアウトエラー:', error);
                    } else {
                        console.log('✅ ログアウト成功');
                    }
                } catch (logoutError) {
                    console.warn('⚠️ ログアウト処理がタイムアウトしました:', logoutError.message);
                }
            } else {
                console.warn('⚠️ Supabaseクライアントが利用できません - ローカルクリーンアップのみ実行');
            }
            
            // ローカルストレージもクリア
            try {
                localStorage.clear();
                console.log('🧹 ローカルストレージをクリアしました');
            } catch (storageError) {
                console.error('❌ ローカルストレージクリアエラー:', storageError);
            }
            
            this.showMessage('ログアウトしました', 'success');
            
            // 画面をリフレッシュ
            setTimeout(() => {
                console.log('🔄 ページをリロードします...');
                try {
                    location.reload();
                } catch (reloadError) {
                    console.error('❌ ページリロードエラー:', reloadError);
                    // 手動でAuthenticationSceneを再作成
                    this.scene.restart();
                }
            }, 1000);
            
        } catch (error) {
            console.error('💥 強制ログアウトエラー:', error);
            
            let message = 'ログアウトに失敗しました';
            if (error.message.includes('timeout') || error.message.includes('Timeout')) {
                message = 'ログアウト処理がタイムアウトしました。ページを再読み込みしてください。';
            } else if (error.message.includes('connection')) {
                message = 'ネットワークエラーでログアウトできませんでした。ページを再読み込みしてください。';
            }
            
            this.showMessage(message, 'error');
        }
    }

    // 実行ボタンを非表示にするヘルパーメソッド
    hideRunButton() {
        const runButton = document.getElementById('runButton');
        if (runButton) {
            runButton.style.display = 'none';
        }
    }
}
