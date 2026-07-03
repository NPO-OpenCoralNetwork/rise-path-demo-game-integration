import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import './PSchool.css';

// Import game logic
import { AuthenticationScene } from './game/AuthenticationScene';
import { MainMenuScene } from './game/MainMenuScene';
import { HomeScene } from './game/HomeScene';
import { MapSelectionScene } from './game/MapSelectionScene';
import { LibraryScene } from './game/LibraryScene';
import { ShopScene } from './game/ShopScene';
import { StoryScene } from './game/StoryScene';
import { BattleScene } from './game/BattleScene';
import { BattleScene2 } from './game/BattleScene2';
import { BattleScene3 } from './game/BattleScene3';
import { BattleScene4 } from './game/BattleScene4';
import { BattleScene5 } from './game/BattleScene5';
import { BattleScene6 } from './game/BattleScene6';
import { BattleScene7 } from './game/BattleScene7';
import { BattleScene8 } from './game/BattleScene8';
import { BattleScene9 } from './game/BattleScene9';
import { BattleScene10 } from './game/BattleScene10';
import { BattleScene11 } from './game/BattleScene11';
import { BattleScene12 } from './game/BattleScene12';
import { BattleScene13 } from './game/BattleScene13';
import { BattleScene14 } from './game/BattleScene14';
import { BattleScene15 } from './game/BattleScene15';
import { BattleScene16 } from './game/BattleScene16';
import { BattleScene17 } from './game/BattleScene17';
import { BattleScene18 } from './game/BattleScene18';
import { BattleScene19 } from './game/BattleScene19';
import { BattleScene20 } from './game/BattleScene20';
import { VariableEditor } from './variableEditor';
import { runGameWithCommands } from './game/engine';
import { UI } from './game/ui';
import { BlocklyEditor, BlocklyEditorRef } from './BlocklyEditor';

// Helper function to extract AST (adapted from index.js)
// Note: Ideally this should be shared, but for now we keep a local copy for handleRun logic.
function blockToAST(block: any): any {
  const ast: any = {
    type: block.type,
    fields: {},
    children: [],
    inputs: {},
    mutation: null
  };

  if (block.mutationToDom && typeof block.mutationToDom === 'function') {
    try {
      const mutationDom = block.mutationToDom();
      if (mutationDom && mutationDom.attributes) {
        ast.mutation = {};
        for (let i = 0; i < mutationDom.attributes.length; i++) {
          const attr = mutationDom.attributes[i];
          ast.mutation[attr.name] = attr.value;
        }
      }
    } catch (e) {
      console.warn('Failed to extract mutation:', e);
    }
  }

  const inputList = block.inputList;
  for (const input of inputList) {
    for (const field of input.fieldRow) {
      if (field.name) {
        ast.fields[field.name] = field.getValue();
      }
    }

    const connection = input.connection;
    if (connection && connection.targetBlock()) {
      const connectionType = connection.type;
      const isStatementInput =
        connectionType === 3 || // Blockly.NEXT_STATEMENT (hardcoded to avoid import)
        connectionType === 4 || // Blockly.INPUT_STATEMENT
        input.type === 3 ||
        input.type === 4;

      if (isStatementInput) {
        let currentBlock = connection.targetBlock();
        while (currentBlock) {
          const targetAst = blockToAST(currentBlock);
          if (Array.isArray(targetAst)) {
            targetAst.forEach(child => ast.children.push(child));
          } else {
            ast.children.push(targetAst);
          }
          currentBlock = currentBlock.nextConnection && currentBlock.nextConnection.targetBlock();
        }
      } else {
        const targetBlock = connection.targetBlock();
        const targetAst = blockToAST(targetBlock);
        const normalizedTarget = Array.isArray(targetAst) ? targetAst[0] : targetAst;
        const inputName = input.name || 'INPUT';
        ast.inputs[inputName] = normalizedTarget;
      }
    }
  }
  return ast;
}

function getASTFromWorkspace(workspace: any) {
  const topBlocks = workspace.getTopBlocks(true);
  return Promise.resolve(topBlocks.map((block: any) => blockToAST(block)));
}

const PSchoolView: React.FC = () => {
  const gameRef = useRef<Phaser.Game | null>(null);
  const blocklyEditorRef = useRef<BlocklyEditorRef>(null);
  const [isBlocklyVisible, setIsBlocklyVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBattleMode, setIsBattleMode] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    // --- Initialize Variable Editor ---
    const variableEditor = new VariableEditor();
    (window as any).variableEditor = variableEditor;
    
    // Expose bridge for Phaser to update React state
    (window as any).setBattleMode = (isBattle: boolean) => {
        setIsBattleMode(isBattle);
        // Reset editor visibility on mode change to prevent rendering issues
        setIsBlocklyVisible(false); 
    };

    // --- Initialize Phaser ---
    console.log("Initializing Phaser...");
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.WEBGL,
      parent: 'gameCanvas',
      render: {
        antialias: true,
        pixelArt: false,
        powerPreference: 'default',
        // resolution: window.devicePixelRatio || 1
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: window.innerWidth,
        height: window.innerHeight,
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      scene: [
        HomeScene, // Start with HomeScene
        AuthenticationScene,
        MainMenuScene,
        MapSelectionScene,
        LibraryScene,
        ShopScene,
        StoryScene,
        BattleScene,
        BattleScene2,
        BattleScene3,
        BattleScene4,
        BattleScene5,
        BattleScene6,
        BattleScene7,
        BattleScene8,
        BattleScene9,
        BattleScene10,
        BattleScene11,
        BattleScene12,
        BattleScene13,
        BattleScene14,
        BattleScene15,
        BattleScene16,
        BattleScene17,
        BattleScene18,
        BattleScene19,
        BattleScene20
      ],
      physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0, x: 0 }, // Fix gravity typing
            debug: false
        }
      },
      backgroundColor: '#2c3e50'
    };

    const game = new Phaser.Game(config);
    gameRef.current = game;
    (window as any).game = game;

    // Inject mock data when game is ready
    game.events.once('ready', () => {
        try {
             // Mock user data since auth is handled by parent app
             const mockPlayerData = {
                 userId: 'local_user',
                 email: 'player@example.com',
                 username: 'Player',
                 isGuest: false
             };
             console.log('🚀 Game Ready: Restarting HomeScene with mock data:', mockPlayerData);
             game.scene.start('HomeScene', { playerData: mockPlayerData });
        } catch (e) {
            console.error("Failed to inject data into Home scene", e);
        }
    });

    // Cleanup
    return () => {
      console.log("Cleaning up PSchoolView...");
      if (gameRef.current) {
        gameRef.current.destroy(true);
      }
    };
  }, []);

  const handleRun = async () => {
    console.log("🚀 Run button clicked");
    
    if (isExecuting) {
        console.warn("⚠️ Already executing, ignoring click.");
        return;
    }

    if (!blocklyEditorRef.current) {
        console.error("❌ blocklyEditorRef is null");
        return;
    }

    const workspace = blocklyEditorRef.current.getWorkspace();
    if (!workspace) {
        console.warn("⚠️ Workspace not available via ref");
        // Fallback: check global workspace if ref failed (for debugging)
        if ((window as any).blocklyWorkspace) {
            console.log("🔄 Using fallback global workspace");
        } else {
            return;
        }
    }
    console.log("✅ Workspace found");

    setIsExecuting(true); // Start execution lock

    // Logic from index.js executeCommands
    try {
        const { getAvailableBlocksByLevel } = await import('./game/levelBlockRestrictions.js');
        // Mock getUserLevel for now
        const getUserLevel = async () => 20; 
        const userLevel = await getUserLevel();
        const availableBlocks = getAvailableBlocksByLevel(userLevel);
        const usedBlocks = workspace.getAllBlocks().map((block: any) => block.type);
        const unauthorizedBlocks = usedBlocks.filter((blockType: string) => !availableBlocks.includes(blockType));

        if (unauthorizedBlocks.length > 0) {
             alert(`Level ${userLevel} restricted blocks: ${unauthorizedBlocks.join(', ')}`);
             setIsExecuting(false);
             return;
        }
    } catch (e) {
        console.error("Restriction check failed", e);
    }

    let ast;
    try {
        ast = await getASTFromWorkspace(workspace);
        console.log("✅ AST generated:", ast);
    } catch (e) {
        console.error("❌ AST generation failed:", e);
        setIsExecuting(false);
        return;
    }
    
    // Find active battle scene
    const game = gameRef.current;
    if (!game) {
        console.error("❌ Game instance not found");
        setIsExecuting(false);
        return;
    }

    const scenes = game.scene.getScenes(true); // active only
    console.log("🔎 Active scenes:", scenes.map((s: any) => s.scene.key));

    const battleSceneKeys = ['Stage20Battle', 'Stage19Battle', 'Stage18Battle', 'Stage17Battle', 'Stage16Battle', 'Stage15Battle', 'Stage14Battle', 'Stage13Battle', 'Stage12Battle', 'Stage11Battle', 'Stage10Battle', 'Stage9Battle', 'Stage8Battle', 'Stage7Battle', 'Stage6Battle', 'Stage5Battle', 'Stage4Battle', 'Stage3Battle', 'Stage2Battle', 'Stage1Battle'];
    
    let battleScene: any = null;
    for (const key of battleSceneKeys) {
        battleScene = scenes.find((s: any) => s.scene.key === key);
        if (battleScene) break;
    }

    if (battleScene) {
        console.log(`✅ Battle scene found: ${battleScene.scene.key}`);
        const blockCount = battleScene.getCurrentBlockCount ? battleScene.getCurrentBlockCount() : workspace.getAllBlocks().length;
        if (typeof battleScene.updateBattleStats === 'function') {
            battleScene.updateBattleStats(blockCount);
        }

        try {
            await runGameWithCommands(ast, {
                player: battleScene.player,
                enemy: battleScene.enemy,
                scene: battleScene
            }, battleScene.ui || new UI());
        } catch (error) {
            console.error("Error during game execution:", error);
        } finally {
            setIsExecuting(false); // Release execution lock
        }
    } else {
        console.warn("⚠️ No active battle scene found. Is the game in a battle?");
        setIsExecuting(false);
    }
  };

  const toggleBlockly = () => {
    setIsBlocklyVisible(!isBlocklyVisible);
  };

  const toggleFullscreen = () => {
      setIsFullscreen(!isFullscreen);
      setTimeout(() => {
        blocklyEditorRef.current?.resize();
      }, 100);
  };

  return (
    <div className="p-school-container">
      {/* Game Container */}
      <div id="gameCanvas" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }} />

      {/* Game UI Layer (HP Bars, etc.) */}
      <div id="ui-layer" style={{ display: 'none' }}>
        {/* Player Status Card */}
        <div id="player-hp-card" className="hp-card player">
          <div className="hp-header">
            <span className="hp-name">Player</span>
            <span id="player-hp-value" className="hp-value">50<small>/50</small></span>
          </div>
          <div className="progress-track">
            <div id="player-hp-delay" className="progress-fill-delay" style={{ width: '100%' }}></div>
            <div id="player-hp-bar" className="progress-fill" style={{ width: '100%' }}></div>
          </div>
        </div>

        {/* Enemy Status Card */}
        <div id="enemy-hp-card" className="hp-card enemy">
          <div className="hp-header">
            <span id="enemy-name-display" className="hp-name">Enemy</span>
            <span id="enemy-hp-value" className="hp-value">50<small>/50</small></span>
          </div>
          <div className="progress-track">
            <div id="enemy-hp-delay" className="progress-fill-delay" style={{ width: '100%' }}></div>
            <div id="enemy-hp-bar" className="progress-fill" style={{ width: '100%' }}></div>
          </div>
        </div>
      </div>

      {/* New Blockly Editor Component */}
      <BlocklyEditor
        key={isBattleMode ? 'battle-editor' : 'normal-editor'} // Force re-mount on mode change
        ref={blocklyEditorRef}
        isVisible={isBlocklyVisible}
        onRun={handleRun}
        onClose={toggleBlockly}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        isBattleMode={isBattleMode}
        isExecuting={isExecuting}
      />
    </div>
  );
};

export default PSchoolView;
