import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import Blockly from 'scratch-blocks/dist/vertical';
import { Play, Maximize2, Minimize2, X, Code } from 'lucide-react';
import './PSchool.css';
import './blockly/blocks'; // Import block definitions

// Import toolbox XML
import toolboxXmlString from './blockly/toolbox.xml?raw';

// Helper types
export interface BlocklyEditorRef {
  getWorkspace: () => any;
  resize: () => void;
}

interface BlocklyEditorProps {
  isVisible: boolean;
  onRun: () => void;
  onClose: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  isBattleMode?: boolean;
  isExecuting?: boolean;
}

// ... (Helper function blockToAST remains unchanged, keeping it for brevity) ...
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
        connectionType === Blockly.NEXT_STATEMENT ||
        connectionType === Blockly.INPUT_STATEMENT ||
        input.type === Blockly.NEXT_STATEMENT ||
        input.type === Blockly.INPUT_STATEMENT;

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

export const BlocklyEditor = forwardRef<BlocklyEditorRef, BlocklyEditorProps>((props, ref) => {
  const workspaceRef = useRef<any>(null);
  const editorDivRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  
  useImperativeHandle(ref, () => ({
    getWorkspace: () => workspaceRef.current,
    resize: () => {
      if (workspaceRef.current) {
        Blockly.svgResize(workspaceRef.current);
      }
    }
  }));

  // Expose AST function globally for compatibility if needed, or prefer using ref
  useEffect(() => {
    (window as any).blockToAST = blockToAST;
  }, []);

  useEffect(() => {
    console.log("Initializing Blockly Editor...");
    
    // Ensure the div is ready
    if (!editorDivRef.current) {
        console.error("❌ editorDivRef is null during initialization");
        return;
    }

    // Prevent double injection
    if (workspaceRef.current) {
        console.log("♻️ Workspace already exists, skipping injection");
        return;
    }

    // Clear any existing content
    editorDivRef.current.innerHTML = '';

    let toolbox;
    try {
      const parser = new DOMParser();
      toolbox = parser.parseFromString(toolboxXmlString, "text/xml").documentElement;
      (window as any).originalToolboxXml = toolboxXmlString;
    } catch (e) {
      console.error("Toolbox parse error", e);
      toolbox = `<xml xmlns="https://developers.google.com/blockly/xml" id="toolbox"></xml>`;
    }

    // Inject into the DOM element directly using ref
    console.log("💉 Injecting Blockly...");
    const workspace = Blockly.inject(editorDivRef.current, {
      toolbox: toolbox,
      media: "https://unpkg.com/scratch-blocks@1.1.210/media/",
      scrollbars: true,
      horizontalLayout: false,
      sounds: true,
      trashcan: true,
      zoom: {
        controls: true,
        wheel: true,
        startScale: 1.0,
        maxScale: 3,
        minScale: 0.3,
        scaleSpeed: 1.1
      },
      grid: {
        spacing: 20,
        length: 3,
        colour: 'rgba(204, 204, 204, 0.3)',
        snap: true
      }
    });

    console.log("✅ Blockly workspace created", workspace);
    workspaceRef.current = workspace;
    (window as any).blocklyWorkspace = workspace;
    (window as any).workspace = workspace;

    // Apply transparency settings
    const applyTransparency = () => {
        const workspaceElement = document.querySelector('.blocklyWorkspace') as HTMLElement;
        if (workspaceElement) {
          workspaceElement.style.background = 'rgba(255, 255, 255, 0.1)';
          workspaceElement.style.backdropFilter = 'blur(5px)';
        }
        const mainBackground = document.querySelector('.blocklyMainBackground') as any;
        if (mainBackground) {
            mainBackground.style.fill = 'rgba(255, 255, 255, 0.05)';
            mainBackground.style.fillOpacity = '0.05';
        }
    };
    setTimeout(applyTransparency, 500);

    // Initialize Variable Editor
    setTimeout(() => {
        if ((window as any).variableEditor && workspace) {
            (window as any).variableEditor.regenerateToolbox();
        }
    }, 1000);
    
    // Force resize initially
    setTimeout(() => {
        Blockly.svgResize(workspace);
    }, 100);

    return () => {
      if (workspaceRef.current) {
        workspaceRef.current.dispose();
        workspaceRef.current = null;
      }
    };
  }, []);

  // Resize Logic
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const blocklyPanel = document.getElementById('blocklyPanel');
      if (blocklyPanel) {
          const rect = blocklyPanel.getBoundingClientRect();
          let newWidth = e.clientX - rect.left;
          
          if (newWidth < 50) newWidth = 50;
          if (newWidth > 400) newWidth = 400; 
          
          document.documentElement.style.setProperty('--toolbox-width', `${newWidth}px`);
          
          if (workspaceRef.current) {
             Blockly.svgResize(workspaceRef.current);
          }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleMouseDown = (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
  };

  // Re-layout on visibility change
  useEffect(() => {
    if (props.isVisible && workspaceRef.current) {
        setTimeout(() => {
            Blockly.svgResize(workspaceRef.current);
        }, 200);
    }
  }, [props.isVisible, props.isFullscreen]);

  return (
    <>
      <div 
        id="blocklyPanel" 
        className={`blockly-panel ${props.isVisible ? '' : 'hidden'} ${props.isFullscreen ? 'fullscreen' : ''}`}
      >
          {/* Header */}
          <div className="blockly-editor-header">
            <div className="editor-title">
              <Code size={18} />
              <span>コードエディタ</span>
            </div>
            
            <div className="editor-controls">
              {/* Run Button (Integrated) */}
              <button 
                className="icon-button run" 
                onClick={props.onRun}
                title={props.isExecuting ? "実行中..." : "プログラムを実行 (Ctrl+Enter)"}
                disabled={props.isExecuting}
                style={{ opacity: props.isExecuting ? 0.6 : 1, cursor: props.isExecuting ? 'not-allowed' : 'pointer' }}
              >
                <Play size={16} fill="currentColor" />
                {props.isExecuting ? "実行中..." : "実行"}
              </button>

              {/* Fullscreen Toggle */}
              <button 
                className="icon-button"
                onClick={props.onToggleFullscreen}
                title={props.isFullscreen ? "元のサイズに戻す" : "全画面表示"}
              >
                 {props.isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>

              {/* Close Button */}
              <button 
                className="icon-button" 
                onClick={props.onClose}
                title="閉じる"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Workspace Container */}
          <div className="blockly-workspace-container">
            <div 
                ref={editorDivRef} 
                id="blocklyDiv" 
                style={{ width: '100%', height: '100%', position: 'absolute' }} 
            />
            
            {/* Resize Handle */}
            <div 
              className="toolbox-resize-handle"
              onMouseDown={handleMouseDown}
              style={{
                  position: 'absolute',
                  left: `var(--toolbox-width)`,
                  top: 0,
                  bottom: 0,
                  width: '10px',
                  cursor: 'col-resize',
                  zIndex: 1000,
                  marginLeft: '-5px'
              }}
            />
          </div>
      </div>
      
      {/* Floating Buttons (Only shown when editor is hidden) */}
      {!props.isVisible && (
        <>
          <button 
            className="toggle-button p-school-btn" 
            onClick={props.onClose} // Re-opens editor
          >
            📝 ブロック
          </button>
          
          {props.isBattleMode && (
            <button 
              className="floating-run-btn" 
              onClick={props.onRun}
              title={props.isExecuting ? "実行中..." : "プログラムを実行"}
              disabled={props.isExecuting}
              style={{ opacity: props.isExecuting ? 0.6 : 1, cursor: props.isExecuting ? 'not-allowed' : 'pointer' }}
            >
              <Play size={20} fill="currentColor" />
              {props.isExecuting ? "実行中..." : "実行"}
            </button>
          )}
        </>
      )}
    </>
  );
});