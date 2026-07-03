import Blockly from 'scratch-blocks/dist/vertical';

export class VariableEditor {
  constructor() {
    this.variables = new Map();
    this.lists = new Map();
    this.functions = new Map();
    this.functionPreviews = new Map();
    
    this.registerFunctionBlocks();
    
    this.editorElement = document.getElementById('variable-editor');
    this.setupEventListeners();
    this.loadFromLocalStorage();
  }
  
  registerFunctionBlocks() {
    if (!Blockly || Blockly.Blocks['custom_function_placeholder']) {
      return;
    }
    
    const LabelField = Blockly.FieldLabelSerializable || Blockly.FieldLabel;
    
        Blockly.Blocks['custom_function_placeholder'] = {
      init: function() {
        const labelField = new LabelField('関数', 'function-name-label');
        this.appendDummyInput('LABEL')
          .appendField('▶')
          .appendField(labelField, 'FUNCTION_NAME');
        this.setColour(210);
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setTooltip('保存した関数を実行します');
        this.contextMenu = false;
      },
      mutationToDom: function() {
        const container = document.createElement('mutation');
        container.setAttribute('function_name', this.getFunctionName());
        return container;
      },
      domToMutation: function(xmlElement) {
        const fnName = xmlElement.getAttribute('function_name') || '';
        this.setFunctionName(fnName);
      },
      setFunctionName: function(name) {
        this.functionName_ = name;
        const field = this.getField('FUNCTION_NAME');
        if (field) {
          if (field.setValue) {
            field.setValue(name || '関数');
          } else if (field.setText) {
            field.setText(name || '関数');
          }
        }
      },
      getFunctionName: function() {
        const fieldValue = this.getFieldValue ? this.getFieldValue('FUNCTION_NAME') : null;
        return this.functionName_ || fieldValue || '';
      }
    };
    
    if (Blockly.JavaScript) {
      Blockly.JavaScript['custom_function_placeholder'] = () => '';
    }
    if (Blockly.Python) {
      Blockly.Python['custom_function_placeholder'] = () => '';
    }
  }
  
  setupEventListeners() {
    // エディターの開閉
    const toggleBtn = document.getElementById('variable-editor-toggle');
    const closeBtn = document.getElementById('close-variable-editor');
    
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggle());
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    // タブ切り替え
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        this.switchTab(tabName);
      });
    });
    
    // 変数作成
    const createVarBtn = document.getElementById('create-variable-btn');
    if (createVarBtn) {
      createVarBtn.addEventListener('click', () => this.createVariable());
    }
    
    // リスト作成
    const createListBtn = document.getElementById('create-list-btn');
    if (createListBtn) {
      createListBtn.addEventListener('click', () => this.createList());
    }
    
    // 関数作成
    const createFunctionBtn = document.getElementById('create-function-btn');
    if (createFunctionBtn) {
      createFunctionBtn.addEventListener('click', () => this.createFunction());
    }
  }
  
  toggle() {
    this.editorElement.classList.toggle('hidden');
  }
  
  open() {
    this.editorElement.classList.remove('hidden');
  }
  
  close() {
    this.editorElement.classList.add('hidden');
  }
  
  switchTab(tabName) {
    // タブボタンのアクティブ状態を更新
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active');
      }
    });
    
    // タブコンテンツの表示を更新
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
  }
  
  createVariable() {
    const nameInput = document.getElementById('new-variable-name');
    const name = nameInput.value.trim();
    
    if (!name) {
      alert('変数名を入力してください');
      return;
    }
    
    if (this.variables.has(name)) {
      alert('この変数名は既に存在します');
      return;
    }
    
    this.variables.set(name, {
      name: name,
      type: 'variable',
      value: null,
      createdAt: new Date().toISOString()
    });
    
    nameInput.value = '';
    this.updateVariablesList();
    this.saveToLocalStorage();
    this.updateBlocklyToolbox();
    
    console.log(`Variable created: ${name}`);
  }
  
  createList() {
    const nameInput = document.getElementById('new-list-name');
    const name = nameInput.value.trim();
    
    if (!name) {
      alert('リスト名を入力してください');
      return;
    }
    
    if (this.lists.has(name)) {
      alert('このリスト名は既に存在します');
      return;
    }
    
    this.lists.set(name, {
      name: name,
      type: 'list',
      items: [],
      createdAt: new Date().toISOString()
    });
    
    nameInput.value = '';
    this.updateListsList();
    this.saveToLocalStorage();
    this.updateBlocklyToolbox();
    
    console.log(`List created: ${name}`);
  }
  
  createFunction() {
    const nameInput = document.getElementById('new-function-name');
    const name = nameInput.value.trim();
    
    if (!name) {
      alert('関数名を入力してください');
      return;
    }
    
    if (this.functions.has(name)) {
      alert('この関数名は既に存在します');
      return;
    }
    
    this.functions.set(name, {
      name: name,
      type: 'function',
      parameters: [],
      blocksXml: null,
      blocksAst: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    nameInput.value = '';
    this.updateFunctionsList();
    this.saveToLocalStorage();
    this.updateBlocklyToolbox();
    
    console.log(`Function created: ${name}`);
  }
  
  deleteVariable(name) {
    if (confirm(`変数「${name}」を削除しますか?`)) {
      this.variables.delete(name);
      this.updateVariablesList();
      this.saveToLocalStorage();
      this.updateBlocklyToolbox();
    }
  }
  
  deleteList(name) {
    if (confirm(`リスト「${name}」を削除しますか?`)) {
      this.lists.delete(name);
      this.updateListsList();
      this.saveToLocalStorage();
      this.updateBlocklyToolbox();
    }
  }
  
  deleteFunction(name) {
    if (confirm(`関数「${name}」を削除しますか?`)) {
      this.functions.delete(name);
      this.updateFunctionsList();
      this.saveToLocalStorage();
      this.updateBlocklyToolbox();
    }
  }
  
  disposeFunctionPreviews() {
    this.functionPreviews.forEach(preview => {
      try {
        if (preview && preview.workspace && typeof preview.workspace.dispose === 'function') {
          preview.workspace.dispose();
        }
      } catch (error) {
        console.warn('Failed to dispose preview workspace:', error);
      }
      if (preview && preview.container) {
        preview.container.innerHTML = '';
      }
    });
    this.functionPreviews.clear();
  }
  
  disposeFunctionPreview(name) {
    const preview = this.functionPreviews.get(name);
    if (preview) {
      try {
        if (preview.workspace && typeof preview.workspace.dispose === 'function') {
          preview.workspace.dispose();
        }
      } catch (error) {
        console.warn('Failed to dispose preview workspace:', error);
      }
      if (preview.container) {
        preview.container.innerHTML = '';
      }
      this.functionPreviews.delete(name);
    }
  }
  
  normalizeAst(ast) {
    if (!ast) {
      return [];
    }
    if (Array.isArray(ast)) {
      return ast.reduce((result, item) => result.concat(this.normalizeAst(item)), []);
    }
    return [ast];
  }
  
  editFunction(name) {
    const func = this.functions.get(name);
    if (!func) {
      alert('選択された関数が見つかりません');
      return;
    }
    
    const newNameInput = prompt('関数名を編集', func.name || name);
    if (newNameInput === null) {
      return;
    }
    
    const newName = newNameInput.trim();
    if (!newName) {
      alert('関数名を空にはできません');
      return;
    }
    
    if (newName !== name && this.functions.has(newName)) {
      alert('同じ名前の関数が既に存在します');
      return;
    }
    
    const currentParams = Array.isArray(func.parameters) ? func.parameters : [];
    const paramsInput = prompt('引数名をカンマ区切りで入力（例: x, y）', currentParams.join(', '));
    let parameters = currentParams;
    if (paramsInput !== null) {
      parameters = paramsInput
        .split(',')
        .map(param => param.trim())
        .filter(param => param.length > 0);
    }
    
    const updatedFunction = {
      ...func,
      name: newName,
      parameters,
      updatedAt: new Date().toISOString()
    };
    
    if (newName !== name) {
      this.functions.delete(name);
    }
    this.functions.set(newName, updatedFunction);
    
    this.updateFunctionsList();
    this.saveToLocalStorage();
    this.updateBlocklyToolbox();
    
    console.log(`Function updated: ${newName}`, updatedFunction);
  }
  
  saveFunctionLogic(name) {
    const func = this.functions.get(name);
    if (!func) {
      alert('Selected function not found');
      return;
    }

    if (!window.workspace || !Blockly) {
      alert('Blocklyワークスペースが見つかりませんでした');
      return;
    }

    let selectedBlock = null;
    if (window.workspace && typeof window.workspace.getSelected === 'function') {
      selectedBlock = window.workspace.getSelected();
    }
    if (!selectedBlock && typeof Blockly !== 'undefined' && Blockly.selected) {
      selectedBlock = Blockly.selected;
    }
    if (!selectedBlock) {
      alert('Select a block to save');
      return;
    }

    const rootBlock = selectedBlock.getRootBlock ? selectedBlock.getRootBlock() : selectedBlock;
    const blockDom = Blockly.Xml.blockToDom(rootBlock, true);
    const wrapper = document.createElement('xml');
    wrapper.appendChild(blockDom);
    const serializer = new XMLSerializer();
    const xmlString = serializer.serializeToString(wrapper);

    let astClone = [];
    if (typeof window.blockToAST === 'function') {
      try {
        const astRaw = window.blockToAST(rootBlock);
        const normalized = this.normalizeAst(astRaw);
        astClone = JSON.parse(JSON.stringify(normalized));
      } catch (error) {
        console.warn('Failed to convert function logic to AST:', error);
      }
    }

    const updatedFunction = {
      ...func,
      blocksXml: xmlString,
      blocksAst: astClone,
      updatedAt: new Date().toISOString()
    };

    this.functions.set(name, updatedFunction);
    this.updateFunctionsList();
    this.saveToLocalStorage();
    this.updateBlocklyToolbox();

    console.log(`Function logic saved for: ${name}`);
  }

  insertFunctionLogic(name) {
    if (!window.workspace || !Blockly) {
      alert('Blocklyワークスペースが見つかりませんでした');
      return;
    }

    const metrics = typeof window.workspace.getMetrics === 'function'
      ? window.workspace.getMetrics()
      : null;
    const position = metrics
      ? {
          x: metrics.viewLeft + metrics.viewWidth / 2,
          y: metrics.viewTop + metrics.viewHeight / 2
        }
      : null;

    const inserted = this.appendFunctionLogic(name, window.workspace, position);
    if (!inserted || inserted.length === 0) {
      alert('この関数には保存されたロジックがありません');
    } else {
      console.log(`Function logic inserted for: ${name}`);
    }
  }

  updateVariablesList() {
    const listElement = document.getElementById('variables-list');
    listElement.innerHTML = '';
    
    if (this.variables.size === 0) {
      listElement.innerHTML = '<p style="color: #999;">螟画焚縺ｯ縺ｾ縺縺ゅｊ縺ｾ縺帙ｓ</p>';
      return;
    }
    
    this.variables.forEach((variable, name) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'item';
      itemDiv.innerHTML = `
        <span class="item-name">東 ${name}</span>
        <div class="item-actions">
          <button class="delete-btn" data-name="${name}">削除</button>
        </div>
      `;
      
      itemDiv.querySelector('.delete-btn').addEventListener('click', (e) => {
        this.deleteVariable(e.target.dataset.name);
      });
      
      listElement.appendChild(itemDiv);
    });
  }
  
  updateListsList() {
    const listElement = document.getElementById('lists-list');
    listElement.innerHTML = '';
    
    if (this.lists.size === 0) {
      listElement.innerHTML = '<p style="color: #999;">リストの中身がありません</p>';
      return;
    }
    
    this.lists.forEach((list, name) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'item';
      itemDiv.innerHTML = `
        <span class="item-name">搭 ${name}</span>
        <div class="item-actions">
          <button class="delete-btn" data-name="${name}">削除</button>
        </div>
      `;
      
      itemDiv.querySelector('.delete-btn').addEventListener('click', (e) => {
        this.deleteList(e.target.dataset.name);
      });
      
      listElement.appendChild(itemDiv);
    });
  }
  
  updateFunctionsList() {
    const listElement = document.getElementById('functions-list');
    this.disposeFunctionPreviews();
    listElement.innerHTML = '';
    
    if (this.functions.size === 0) {
      listElement.innerHTML = '<p style="color: #999;">関数はまだありません</p>';
      return;
    }
    
    this.functions.forEach((func, name) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'item';
      const parameterLabel = Array.isArray(func.parameters) && func.parameters.length > 0
        ? `（引数: ${func.parameters.join(', ')}）`
        : '';
      const logicStatus = func.blocksXml ? '' : '';
      itemDiv.innerHTML = `
        <span class="item-name"> ${name}${parameterLabel} ${logicStatus}</span>
        <div class="item-actions">
          <button class="save-logic-btn" data-name="${name}">ロジック保存</button>
          <button class="view-logic-btn" data-name="${name}" title="保存したロジックの内容を表示します">内容を表示</button>
          <button class="insert-logic-btn" data-name="${name}" title="保存したロジックをBlocklyワークスペースに挿入します">ワークスペースに挿入</button>
          <button class="edit-btn" data-name="${name}">編集</button>
          <button class="delete-btn" data-name="${name}">削除</button>
        </div>
      `;
      
      const previewContainer = document.createElement('div');
      previewContainer.className = 'function-preview-container';
      previewContainer.style.display = 'none';
      previewContainer.style.marginTop = '8px';
      itemDiv.appendChild(previewContainer);
      
      itemDiv.querySelector('.delete-btn').addEventListener('click', (e) => {
        this.deleteFunction(e.target.dataset.name);
      });
      
      itemDiv.querySelector('.edit-btn').addEventListener('click', (e) => {
        this.editFunction(e.target.dataset.name);
      });
      
      itemDiv.querySelector('.save-logic-btn').addEventListener('click', (e) => {
        this.saveFunctionLogic(e.target.dataset.name);
      });
      
      itemDiv.querySelector('.view-logic-btn').addEventListener('click', (e) => {
        this.toggleFunctionPreview(e.target.dataset.name, previewContainer);
      });
      
      itemDiv.querySelector('.insert-logic-btn').addEventListener('click', (e) => {
        this.insertFunctionLogic(e.target.dataset.name);
      });
      
      listElement.appendChild(itemDiv);
    });
  }
  
  toggleFunctionPreview(name, container) {
    const logicXml = this.getFunctionLogic(name);
    const isVisible = container.style.display === 'block';
    if (isVisible) {
      container.style.display = 'none';
      this.disposeFunctionPreview(name);
      return;
    }
    
    container.style.display = 'block';
    container.innerHTML = '';
    
    if (!logicXml) {
      container.innerHTML = '<p style="color: #999;">ロジックが保存されていません</p>';
      return;
    }
    
    const previewWrapper = document.createElement('div');
    previewWrapper.className = 'function-preview-workspace';
    previewWrapper.style.width = '100%';
    previewWrapper.style.height = '240px';
    previewWrapper.style.border = '1px solid rgba(255,255,255,0.2)';
    previewWrapper.style.background = 'rgba(0,0,0,0.15)';
    container.appendChild(previewWrapper);
    
    try {
      const previewWorkspace = Blockly.inject(previewWrapper, {
        readOnly: true,
        scrollbars: true,
        collapse: false,
        disable: false,
        comments: false,
        sounds: false
      });
      
      const xmlDom = Blockly.Xml.textToDom(logicXml);
      let containerDom = xmlDom.documentElement ? xmlDom.documentElement : xmlDom;
      let xmlRoot;
      if (containerDom.nodeName.toLowerCase() === 'xml') {
        xmlRoot = containerDom.cloneNode(true);
      } else {
        xmlRoot = document.createElement('xml');
        xmlRoot.appendChild(containerDom.cloneNode(true));
      }
      
      if (Blockly.Xml.appendDomToWorkspace) {
        Blockly.Xml.appendDomToWorkspace(xmlRoot, previewWorkspace);
      } else {
        Blockly.Xml.domToWorkspace(xmlRoot, previewWorkspace);
      }
      
      if (typeof previewWorkspace.zoomToFit === 'function') {
        previewWorkspace.zoomToFit();
      }
      this.functionPreviews.set(name, { workspace: previewWorkspace, container });
    } catch (error) {
      console.error('Failed to render function preview:', error);
      container.innerHTML = '<p style="color: #f88;">ロジックの読み込みに失敗しました</p>';
    }
  }
  
  updateBlocklyToolbox() {

    if (window.workspace) {
      console.log('Updating Blockly toolbox with custom variables/lists/functions');

      // カスタム変数のリストを更新
      window.customVariables = Array.from(this.variables.keys());
      window.customLists = Array.from(this.lists.keys());
      window.customFunctions = Array.from(this.functions.keys());

      // Blocklyのツールボックスを更新
      try {
        this.regenerateToolbox();
      } catch (e) {
        console.error('Failed to regenerate toolbox:', e);
      }
    }
  }
  
  regenerateToolbox() {
    console.log('🔄 regenerateToolbox() called');
    const workspace = window.workspace;
    if (!workspace) {
      console.error('⚠️ Blockly workspace not found');
      return;
    }
    console.log('・Workspace found:', workspace);
    
    // 元のツールボックスXMLを取得
    let originalToolboxXml = window.originalToolboxXml;
    if (!originalToolboxXml) {
      console.error('⚠️ Original toolbox XML not found in window.originalToolboxXml');
      return;
    }
    console.log('・Original toolbox XML string found, length:', originalToolboxXml.length);
    
    // XMLをパース
    const parser = new DOMParser();
    const toolboxDoc = parser.parseFromString(originalToolboxXml, 'text/xml');
    const toolboxElement = toolboxDoc.documentElement;
    
    console.log('・Parsed toolbox:', toolboxElement);
    console.log('   Number of categories:', toolboxElement.children.length);

    // カスタム変数/リスト/関数の既存カテゴリを取得
    const existingCustomVar = toolboxElement.querySelector('category[name="カスタム変数"]');
    const existingCustomList = toolboxElement.querySelector('category[name="カスタムリスト"]');
    const existingCustomFunction = toolboxElement.querySelector('category[name="カスタム関数"]');
    if (existingCustomVar) {
      existingCustomVar.remove();
      console.log('🔄 Removed existing custom variables category');
    }
    if (existingCustomList) {
      existingCustomList.remove();
      console.log('🔄 Removed existing custom lists category');
    }
    if (existingCustomFunction) {
      existingCustomFunction.remove();
      console.log('🔄 Removed existing custom functions category');
    }

    // カスタム変数を追加
    console.log('🔄 Adding custom variables. Count:', this.variables.size);
    const customVarCategory = toolboxDoc.createElement('category');
    customVarCategory.setAttribute('name', 'カスタム変数');
    customVarCategory.setAttribute('id', 'custom_variables');
    customVarCategory.setAttribute('colour', '#AA55FF');
    customVarCategory.setAttribute('secondaryColour', '#CC77FF');
    customVarCategory.setAttribute('tertiaryColour', '#8833EE');
    
    // 繧ｷ繧ｹ繝・Β螟画焚繧定ｿｽ蜉・・attleScene縺ｮcustomVariables縺九ｉ蜿門ｾ暦ｼ・
    const systemVariables = [];
    if (window.game && window.game.scene && window.game.scene.scenes[0]) {
      const currentScene = window.game.scene.scenes[0];
      if (currentScene.customVariables) {
        Object.keys(currentScene.customVariables).forEach(varName => {
          systemVariables.push(varName);
          console.log('  🔄 System variable found:', varName);
        });
      }
    }

    // カスタムリストを追加
    systemVariables.forEach(varName => {
      console.log('  Adding system variable blocks for:', varName);
      // 螟画焚蜿門ｾ励ヶ繝ｭ繝・け・医す繧ｹ繝・Β螟画焚縺ｯ蜿門ｾ励・縺ｿ・・
      const getBlock = toolboxDoc.createElement('block');
      getBlock.setAttribute('type', 'custom_variable_get');
      
      // mutation繧ｿ繧ｰ繧剃ｽｿ縺｣縺ｦ変数名阪ｒ菫晏ｭ・
      const mutation = toolboxDoc.createElement('mutation');
      mutation.setAttribute('var_name', varName);
      getBlock.appendChild(mutation);
      
      const getField = toolboxDoc.createElement('field');
      getField.setAttribute('name', 'VAR_NAME');
      getField.textContent = varName;
      getBlock.appendChild(getField);
      customVarCategory.appendChild(getBlock);
    });
    
    // 繝・ヵ繧ｩ繝ｫ繝医・繝・Φ繝励Ξ繝ｼ繝医ヶ繝ｭ繝・け繧定ｿｽ蜉・亥､画焚縺・蛟九・蝣ｴ蜷茨ｼ・
    if (this.variables.size === 0 && systemVariables.length === 0) {
      // 螟画焚蜿門ｾ励ヶ繝ｭ繝・け・医ユ繝ｳ繝励Ξ繝ｼ繝茨ｼ・
      const getBlock = toolboxDoc.createElement('block');
      getBlock.setAttribute('type', 'custom_variable_get');
      const getField = toolboxDoc.createElement('field');
      getField.setAttribute('name', 'VAR_NAME');
      getField.textContent = '変数名';
      getBlock.appendChild(getField);
      customVarCategory.appendChild(getBlock);
      
      // 螟画焚險ｭ螳壹ヶ繝ｭ繝・け・医ユ繝ｳ繝励Ξ繝ｼ繝茨ｼ・
      const setBlock = toolboxDoc.createElement('block');
      setBlock.setAttribute('type', 'custom_variable_set');
      const setField = toolboxDoc.createElement('field');
      setField.setAttribute('name', 'VAR_NAME');
      setField.textContent = '変数名';
      setBlock.appendChild(setField);
      
      // VALUE縺ｫshadow block・医ユ繧ｭ繧ｹ繝亥・蜉幢ｼ峨ｒ霑ｽ蜉
      const valueInput = toolboxDoc.createElement('value');
      valueInput.setAttribute('name', 'VALUE');
      const textShadow = toolboxDoc.createElement('shadow');
      textShadow.setAttribute('type', 'text');
      const textField = toolboxDoc.createElement('field');
      textField.setAttribute('name', 'TEXT');
      textField.textContent = '';
      textShadow.appendChild(textField);
      valueInput.appendChild(textShadow);
      setBlock.appendChild(valueInput);
      
      customVarCategory.appendChild(setBlock);
    }
    
    // 菴懈・貂医∩縺ｮ螟画焚繝悶Ο繝・け繧定ｿｽ蜉
    this.variables.forEach((variable, name) => {
      console.log('  Adding variable blocks for:', name);
      // 螟画焚蜿門ｾ励ヶ繝ｭ繝・け
      const getBlock = toolboxDoc.createElement('block');
      getBlock.setAttribute('type', 'custom_variable_get');
      
      // mutation繧ｿ繧ｰ繧剃ｽｿ縺｣縺ｦ変数名阪ｒ菫晏ｭ・
      const getMutation = toolboxDoc.createElement('mutation');
      getMutation.setAttribute('var_name', name);
      getBlock.appendChild(getMutation);
      
      const getField = toolboxDoc.createElement('field');
      getField.setAttribute('name', 'VAR_NAME');
      getField.textContent = name;
      getBlock.appendChild(getField);
      customVarCategory.appendChild(getBlock);
      
      // 螟画焚險ｭ螳壹ヶ繝ｭ繝・け
      const setBlock = toolboxDoc.createElement('block');
      setBlock.setAttribute('type', 'custom_variable_set');
      
      // mutation繧ｿ繧ｰ繧剃ｽｿ縺｣縺ｦ変数名阪ｒ菫晏ｭ・
      const setMutation = toolboxDoc.createElement('mutation');
      setMutation.setAttribute('var_name', name);
      setBlock.appendChild(setMutation);
      
      const setField = toolboxDoc.createElement('field');
      setField.setAttribute('name', 'VAR_NAME');
      setField.textContent = name;
      setBlock.appendChild(setField);
      
      // VALUE縺ｫshadow block・医ユ繧ｭ繧ｹ繝亥・蜉幢ｼ峨ｒ霑ｽ蜉
      const valueInput = toolboxDoc.createElement('value');
      valueInput.setAttribute('name', 'VALUE');
      const textShadow = toolboxDoc.createElement('shadow');
      textShadow.setAttribute('type', 'text');
      const textField = toolboxDoc.createElement('field');
      textField.setAttribute('name', 'TEXT');
      textField.textContent = '';
      textShadow.appendChild(textField);
      valueInput.appendChild(textShadow);
      setBlock.appendChild(valueInput);
      
      customVarCategory.appendChild(setBlock);
    });
    
    toolboxElement.appendChild(customVarCategory);
    
    // 繧ｫ繧ｹ繧ｿ繝繝ｪ繧ｹ繝医き繝・ざ繝ｪ繧剃ｽ懈・・亥ｸｸ縺ｫ陦ｨ遉ｺ・・
    console.log('逃 Adding custom lists. Count:', this.lists.size);
    const customListCategory = toolboxDoc.createElement('category');
    customListCategory.setAttribute('name', 'リスト');
    customListCategory.setAttribute('id', 'custom_lists');
    customListCategory.setAttribute('colour', '#FF6680');
    customListCategory.setAttribute('secondaryColour', '#FF8899');
    customListCategory.setAttribute('tertiaryColour', '#EE5570');
    
    // 繝・ヵ繧ｩ繝ｫ繝医・繝・Φ繝励Ξ繝ｼ繝医ヶ繝ｭ繝・け繧定ｿｽ蜉・医Μ繧ｹ繝医′0蛟九・蝣ｴ蜷茨ｼ・
    if (this.lists.size === 0) {
      // 繝ｪ繧ｹ繝亥叙蠕励ヶ繝ｭ繝・け・医ユ繝ｳ繝励Ξ繝ｼ繝茨ｼ・
      const getBlock = toolboxDoc.createElement('block');
      getBlock.setAttribute('type', 'custom_list_get');
      const getField = toolboxDoc.createElement('field');
      getField.setAttribute('name', 'LIST_NAME');
      getField.textContent = '繝ｪ繧ｹ繝亥錐';
      getBlock.appendChild(getField);
      
      // INDEX縺ｫshadow block・域焚蛟､蜈･蜉幢ｼ峨ｒ霑ｽ蜉
      const indexValue = toolboxDoc.createElement('value');
      indexValue.setAttribute('name', 'INDEX');
      const shadowBlock = toolboxDoc.createElement('shadow');
      shadowBlock.setAttribute('type', 'math_number');
      const numField = toolboxDoc.createElement('field');
      numField.setAttribute('name', 'NUM');
      numField.textContent = '0';
      shadowBlock.appendChild(numField);
      indexValue.appendChild(shadowBlock);
      getBlock.appendChild(indexValue);
      
      customListCategory.appendChild(getBlock);
      
      // 繝ｪ繧ｹ繝郁ｿｽ蜉繝悶Ο繝・け・医ユ繝ｳ繝励Ξ繝ｼ繝茨ｼ・
      const addBlock = toolboxDoc.createElement('block');
      addBlock.setAttribute('type', 'custom_list_add');
      const addField = toolboxDoc.createElement('field');
      addField.setAttribute('name', 'LIST_NAME');
      addField.textContent = '繝ｪ繧ｹ繝亥錐';
      addBlock.appendChild(addField);
      
      // ITEM縺ｫshadow block・医ユ繧ｭ繧ｹ繝亥・蜉幢ｼ峨ｒ霑ｽ蜉
      const itemValue = toolboxDoc.createElement('value');
      itemValue.setAttribute('name', 'ITEM');
      const itemShadow = toolboxDoc.createElement('shadow');
      itemShadow.setAttribute('type', 'text');
      const itemField = toolboxDoc.createElement('field');
      itemField.setAttribute('name', 'TEXT');
      itemField.textContent = '';
      itemShadow.appendChild(itemField);
      itemValue.appendChild(itemShadow);
      addBlock.appendChild(itemValue);
      
      customListCategory.appendChild(addBlock);
      
      // 繝ｪ繧ｹ繝磯聞縺輔ヶ繝ｭ繝・け・医ユ繝ｳ繝励Ξ繝ｼ繝茨ｼ・
      const lengthBlock = toolboxDoc.createElement('block');
      lengthBlock.setAttribute('type', 'custom_list_length');
      const lengthField = toolboxDoc.createElement('field');
      lengthField.setAttribute('name', 'LIST_NAME');
      lengthField.textContent = '繝ｪ繧ｹ繝亥錐';
      lengthBlock.appendChild(lengthField);
      customListCategory.appendChild(lengthBlock);
    }
    
    // 菴懈・貂医∩縺ｮ繝ｪ繧ｹ繝医ヶ繝ｭ繝・け繧定ｿｽ蜉
    this.lists.forEach((list, name) => {
      console.log('  Adding list blocks for:', name);
      // 繝ｪ繧ｹ繝亥叙蠕励ヶ繝ｭ繝・け
      const getBlock = toolboxDoc.createElement('block');
      getBlock.setAttribute('type', 'custom_list_get');
      
      // mutation繧ｿ繧ｰ繧剃ｽｿ縺｣縺ｦ繝ｪ繧ｹ繝亥錐繧剃ｿ晏ｭ・
      const getMutation = toolboxDoc.createElement('mutation');
      getMutation.setAttribute('list_name', name);
      getBlock.appendChild(getMutation);
      
      const getField = toolboxDoc.createElement('field');
      getField.setAttribute('name', 'LIST_NAME');
      getField.textContent = name;
      getBlock.appendChild(getField);
      
      // INDEX縺ｫshadow block・域焚蛟､蜈･蜉幢ｼ峨ｒ霑ｽ蜉
      const indexValue = toolboxDoc.createElement('value');
      indexValue.setAttribute('name', 'INDEX');
      const shadowBlock = toolboxDoc.createElement('shadow');
      shadowBlock.setAttribute('type', 'math_number');
      const numField = toolboxDoc.createElement('field');
      numField.setAttribute('name', 'NUM');
      numField.textContent = '0';
      shadowBlock.appendChild(numField);
      indexValue.appendChild(shadowBlock);
      getBlock.appendChild(indexValue);
      
      customListCategory.appendChild(getBlock);
      
      // 繝ｪ繧ｹ繝郁ｿｽ蜉繝悶Ο繝・け
      const addBlock = toolboxDoc.createElement('block');
      addBlock.setAttribute('type', 'custom_list_add');
      
      // mutation繧ｿ繧ｰ繧剃ｽｿ縺｣縺ｦ繝ｪ繧ｹ繝亥錐繧剃ｿ晏ｭ・
      const addMutation = toolboxDoc.createElement('mutation');
      addMutation.setAttribute('list_name', name);
      addBlock.appendChild(addMutation);
      
      const addField = toolboxDoc.createElement('field');
      addField.setAttribute('name', 'LIST_NAME');
      addField.textContent = name;
      addBlock.appendChild(addField);
      
      // ITEM縺ｫshadow block・医ユ繧ｭ繧ｹ繝亥・蜉幢ｼ峨ｒ霑ｽ蜉
      const itemValue = toolboxDoc.createElement('value');
      itemValue.setAttribute('name', 'ITEM');
      const itemShadow = toolboxDoc.createElement('shadow');
      itemShadow.setAttribute('type', 'text');
      const itemField = toolboxDoc.createElement('field');
      itemField.setAttribute('name', 'TEXT');
      itemField.textContent = '';
      itemShadow.appendChild(itemField);
      itemValue.appendChild(itemShadow);
      addBlock.appendChild(itemValue);
      
      customListCategory.appendChild(addBlock);
      
      // 繝ｪ繧ｹ繝磯聞縺輔ヶ繝ｭ繝・け
      const lengthBlock = toolboxDoc.createElement('block');
      lengthBlock.setAttribute('type', 'custom_list_length');
      
      // mutation繧ｿ繧ｰ繧剃ｽｿ縺｣縺ｦ繝ｪ繧ｹ繝亥錐繧剃ｿ晏ｭ・
      const lengthMutation = toolboxDoc.createElement('mutation');
      lengthMutation.setAttribute('list_name', name);
      lengthBlock.appendChild(lengthMutation);
      
      const lengthField = toolboxDoc.createElement('field');
      lengthField.setAttribute('name', 'LIST_NAME');
      lengthField.textContent = name;
      lengthBlock.appendChild(lengthField);
      customListCategory.appendChild(lengthBlock);
    });
    
    toolboxElement.appendChild(customListCategory);
    
    console.log('逃 Adding custom functions. Count:', this.functions.size);
    const customFunctionCategory = toolboxDoc.createElement('category');
    customFunctionCategory.setAttribute('name', '髢｢謨ｰ');
    customFunctionCategory.setAttribute('id', 'custom_functions');
    customFunctionCategory.setAttribute('colour', '#4B86FF');
    customFunctionCategory.setAttribute('secondaryColour', '#6C9CFF');
    customFunctionCategory.setAttribute('tertiaryColour', '#2E61C9');
    
    if (this.functions.size === 0) {
      const infoLabel = toolboxDoc.createElement('label');
      infoLabel.setAttribute('text', '菫晏ｭ俶ｸ医∩縺ｮ髢｢謨ｰ縺ｯ縺ゅｊ縺ｾ縺帙ｓ');
      infoLabel.setAttribute('web-class', 'boldtext');
      customFunctionCategory.appendChild(infoLabel);
    }
    
    this.functions.forEach((func, name) => {
      const block = toolboxDoc.createElement('block');
      block.setAttribute('type', 'custom_function_placeholder');
      
      const mutation = toolboxDoc.createElement('mutation');
      mutation.setAttribute('function_name', name);
      block.appendChild(mutation);
      
      const field = toolboxDoc.createElement('field');
      field.setAttribute('name', 'FUNCTION_NAME');
      field.textContent = name;
      block.appendChild(field);
      
      customFunctionCategory.appendChild(block);
    });
    
    toolboxElement.appendChild(customFunctionCategory);
    
    console.log('塘 Serializing toolbox to XML string...');
    // DOM隕∫ｴ繧湛ML譁・ｭ怜・縺ｫ螟画鋤
    const serializer = new XMLSerializer();
    const xmlString = serializer.serializeToString(toolboxElement);
    console.log('塘 XML String (first 500 chars):', xmlString.substring(0, 500));
    console.log('塘 XML String length:', xmlString.length);
    console.log('塘 Total categories:', toolboxElement.children.length);
    
    // 繝・・繝ｫ繝懊ャ繧ｯ繧ｹ繧呈峩譁ｰ・・ML譁・ｭ怜・縺ｨ縺励※貂｡縺呻ｼ・
    console.log('売 Calling workspace.updateToolbox()...');
    try {
      workspace.updateToolbox(xmlString);
      console.log('・Toolbox updated successfully!');
    } catch (error) {
      console.error('笶・Error updating toolbox:', error);
    }
  }
  
  getFunctionLogic(name) {
    const func = this.functions.get(name);
    return func && func.blocksXml ? func.blocksXml : null;
  }

  getFunctionAst(name) {
    const func = this.functions.get(name);
    if (!func || !func.blocksAst) {
      return null;
    }
    try {
      return JSON.parse(JSON.stringify(func.blocksAst));
    } catch (error) {
      console.warn('Failed to clone function AST:', error);
      return null;
    }
  }

  appendFunctionLogic(name, workspace, position = null) {
    const logicXml = this.getFunctionLogic(name);
    if (!logicXml || !workspace || !Blockly) {
      return null;
    }
    
    let xmlDom;
    try {
      xmlDom = Blockly.Xml.textToDom(logicXml);
    } catch (error) {
      console.error('Failed to parse saved function XML:', error);
      return null;
    }
    
    let containerDom = xmlDom.documentElement ? xmlDom.documentElement : xmlDom;
    let xmlRoot;
    if (containerDom.nodeName.toLowerCase() === 'xml') {
      xmlRoot = containerDom.cloneNode(true);
    } else {
      xmlRoot = document.createElement('xml');
      xmlRoot.appendChild(containerDom.cloneNode(true));
    }
    
    const beforeIds = new Set(workspace.getAllBlocks(false).map(block => block.id));
    if (Blockly.Xml.appendDomToWorkspace) {
      Blockly.Xml.appendDomToWorkspace(xmlRoot, workspace);
    } else {
      Blockly.Xml.domToWorkspace(xmlRoot, workspace);
    }
    
    const newBlocks = workspace.getAllBlocks(false).filter(block => !beforeIds.has(block.id));
    if (position && newBlocks.length > 0) {
      const rootBlocks = newBlocks.filter(block => !block.getParent());
      if (rootBlocks.length > 0) {
        const currentXY = rootBlocks[0].getRelativeToSurfaceXY();
        const dx = position.x - currentXY.x;
        const dy = position.y - currentXY.y;
        rootBlocks.forEach(root => root.moveBy(dx, dy));
      }
    }
    
    return newBlocks;
  }
  
  saveToLocalStorage() {
    const data = {
      variables: Array.from(this.variables.entries()),
      lists: Array.from(this.lists.entries()),
      functions: Array.from(this.functions.entries())
    };
    localStorage.setItem('customBlocks', JSON.stringify(data));
  }
  
  loadFromLocalStorage() {
    const saved = localStorage.getItem('customBlocks');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        this.variables = new Map(data.variables || []);
        this.lists = new Map(data.lists || []);
        const functionEntries = (data.functions || []).map(([key, value]) => {
          if (value && value.blocks && !value.blocksXml) {
            value.blocksXml = value.blocks;
          }
          if (value) {
            value.blocksAst = this.normalizeAst(value.blocksAst || null);
          }
          return [key, value];
        });
        this.functions = new Map(functionEntries);
        
        this.updateVariablesList();
        this.updateListsList();
        this.updateFunctionsList();
        this.updateBlocklyToolbox();
      } catch (e) {
        console.error('Failed to load custom blocks from localStorage:', e);
      }
    }
  }
  
  // 菴懈・貂医∩縺ｮ螟画焚/繝ｪ繧ｹ繝・髢｢謨ｰ繧貞叙蠕励☆繧九Γ繧ｽ繝・ラ
  getVariables() {
    return Array.from(this.variables.keys());
  }
  
  getLists() {
    return Array.from(this.lists.keys());
  }
  
  getFunctions() {
    return Array.from(this.functions.keys());
  }
}




