import Blockly from 'scratch-blocks/dist/vertical';

// 実際にステージで使用されるブロックのみを定義

// ========== 基本アクション（ステージ1-20共通） ==========

Blockly.Blocks['attack_basic'] = {
  init: function() {
    this.jsonInit({
      "message0": "攻撃する",
      "category": "基本アクション",
      "colour": "#e61919",
      "extensions": ["colours_operators", "shape_statement"]
    });
    // 後ろにブロックを接続できないようにする（ステージ8の連続攻撃制限のため）
    this.setNextStatement(false);
  }
};

Blockly.Blocks['heal_magic'] = {
  init: function() {
    this.jsonInit({
      "message0": "回復魔法を使う",
      "category": "基本アクション",
      "colour": "#5de619",
      "extensions": ["colours_operators", "shape_statement"]
    });
  }
};

Blockly.Blocks['wait'] = {
  init: function() {
    this.jsonInit({
      "message0": "待機する",
      "category": "基本アクション",
      "colour": "#AA55FF",
      "extensions": ["colours_operators", "shape_statement"]
    });
  }
};

// ========== 詠唱動作（ステージ3-20） ==========

Blockly.Blocks['wave_left_hand'] = {
  init: function() {
    this.jsonInit({
      "message0": "左手を振る",
      "category": "詠唱動作",
      "colour": "#19e5e6",
      "extensions": ["colours_operators", "shape_statement"],
      "tooltip": "魔法詠唱の一部です。左手→右手=炎、左手→左手=氷、右手→左手=雷、右手→右手=水"
    });
  }
};

Blockly.Blocks['wave_right_hand'] = {
  init: function() {
    this.jsonInit({
      "message0": "右手を振る",
      "category": "詠唱動作",
      "colour": "#19e5e6",
      "extensions": ["colours_operators", "shape_statement"],
      "tooltip": "魔法詠唱の一部です。左手→右手=炎、左手→左手=氷、右手→左手=雷、右手→右手=水"
    });
  }
};

// ========== 魔法システム（ステージ3-20） ==========

Blockly.Blocks['cast_magic'] = {
  init: function() {
    this.jsonInit({
      "message0": "魔法を詠唱する",
      "message1": "%1",
      "args1": [
        {
          "type": "input_statement",
          "name": "INCANTATION"
        }
      ],
      "category": "魔法",
      "colour": "#7f19e6",
      "extensions": ["colours_operators", "shape_hat"],
      "tooltip": "左手・右手の振りパターンで魔法を詠唱します。例：左→右で炎の魔法、左→左で氷の魔法、左→右→左→右→左→右→左→右で麻痺魔法、21回の複雑パターンで閃光魔法（回避不可攻撃）"
    });
  }
};

// 値型の魔法詠唱ブロック（他のブロック内に嵌め込める）
Blockly.Blocks['cast_magic_value'] = {
  init: function() {
    this.jsonInit({
      "message0": "魔法を詠唱する",
      "message1": "%1",
      "args1": [
        {
          "type": "input_statement",
          "name": "INCANTATION"
        }
      ],
      "category": "魔法",
      "colour": "#7f19e6",
      "previousStatement": null,
      "nextStatement": null,
      "tooltip": "他のブロック内に嵌め込める魔法詠唱ブロック。左手・右手の振りパターンで魔法を詠唱します"
    });
  }
};

// ========== 制御構造（ステージ8-20） ==========

Blockly.Blocks['repeat_2x'] = {
  init: function() {
    this.jsonInit({
      "message0": "2回繰り返す %1 %2",
      "args0": [
        {
          "type": "input_dummy"
        },
        {
          "type": "input_statement",
          "name": "STACK"
        }
      ],
      "category": "制御",
      "colour": "#7f19e6",
      "extensions": ["colours_operators", "shape_statement"]
    });
  }
};

Blockly.Blocks['repeat_3x'] = {
  init: function() {
    this.jsonInit({
      "message0": "3回繰り返す %1 %2",
      "args0": [
        {
          "type": "input_dummy"
        },
        {
          "type": "input_statement",
          "name": "STACK"
        }
      ],
      "category": "制御",
      "colour": "#7f19e6",
      "extensions": ["colours_operators", "shape_statement"]
    });
  }
};

Blockly.Blocks['for_loop'] = {
  init: function() {
    this.jsonInit({
      "message0": "回数ループ %1 %2",
      "args0": [
        {
          "type": "input_dummy"
        },
        {
          "type": "input_statement",
          "name": "STACK"
        }
      ],
      "category": "制御",
      "colour": "#7f19e6",
      "extensions": ["colours_operators", "shape_statement"]
    });
  }
};

Blockly.Blocks['while_loop'] = {
  init: function() {
    this.jsonInit({
      "message0": "条件ループ %1 %2",
      "args0": [
        {
          "type": "input_dummy"
        },
        {
          "type": "input_statement",
          "name": "STACK"
        }
      ],
      "category": "制御",
      "colour": "#7f19e6",
      "extensions": ["colours_operators", "shape_statement"]
    });
  }
};

Blockly.Blocks['if_condition'] = {
  init: function() {
    this.appendValueInput("CONDITION1")
        .setCheck("Boolean")
        .appendField("もし");
    this.appendDummyInput()
        .appendField("なら");
    this.appendStatementInput("DO1");
    this.appendValueInput("CONDITION2")
        .setCheck("Boolean")
        .appendField("そうでなければもし");
    this.appendDummyInput()
        .appendField("なら");
    this.appendStatementInput("DO2");
    this.appendDummyInput()
        .appendField("そうでなければ");
    this.appendStatementInput("ELSE");

    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour("#7f19e6");
    this.setTooltip("3つの条件分岐を持つブロック");
    this.setHelpUrl("");
  }
};

// ========== 変数システム（ステージ11-20） ==========

// 文字列比較ブロック（条件分岐用）
Blockly.Blocks['text_equals'] = {
  init: function() {
    this.appendValueInput("A")
        .setCheck(null);
    this.appendValueInput("B")
        .setCheck(null)
        .appendField("と");
    this.appendDummyInput()
        .appendField("が等しい");
    this.setOutput(true, "Boolean");
    this.setColour("#5C81A6");
    this.setTooltip("2つの値が等しいかチェック");
    this.setHelpUrl("");
  }
};

Blockly.Blocks['set_variable'] = {
  init: function() {
    this.jsonInit({
      "message0": "変数を設定する",
      "category": "変数",
      "colour": "#AA55FF",
      "extensions": ["colours_operators", "shape_statement"]
    });
  }
};

Blockly.Blocks['get_variable'] = {
  init: function() {
    this.jsonInit({
      "message0": "変数を取得する",
      "category": "変数",
      "colour": "#AA55FF",
      "output": "Number"
    });
  }
};




// 数値ブロック（インデックス用）
Blockly.Blocks['number'] = {
  init: function() {
    this.appendDummyInput()
        .appendField(new Blockly.FieldNumber(0, 0), "NUM");
    this.setOutput(true, "Number");
    this.setColour("#FF6680");
    this.setTooltip("数値");
    this.setHelpUrl("");
  }
};

// ========== カスタム変数ブロック（動的生成） ==========

// カスタム変数取得
Blockly.Blocks['custom_variable_get'] = {
  init: function() {
    this.appendDummyInput()
        .appendField(new Blockly.FieldDropdown(this.getVariableOptions.bind(this)), "VAR_NAME");
    this.setOutput(true, "String");
    this.setColour("#AA55FF");
    this.setTooltip("カスタム変数の値を取得");
    this.setHelpUrl("");
  },
  getVariableOptions: function() {
    // BattleSceneからシステム変数とカスタム変数を取得
    const options = [['変数名', '変数名']]; // デフォルト
    
    if (window.game && window.game.scene && window.game.scene.scenes[0]) {
      const currentScene = window.game.scene.scenes[0];
      if (currentScene.customVariables) {
        Object.keys(currentScene.customVariables).forEach(varName => {
          options.push([varName, varName]);
        });
      }
    }
    
    // variableEditorから作成した変数も追加
    if (window.variableEditor && window.variableEditor.variables) {
      window.variableEditor.variables.forEach((value, name) => {
        // 重複を避ける
        if (!options.find(opt => opt[1] === name)) {
          options.push([name, name]);
        }
      });
    }
    
    return options.length > 1 ? options : [['変数名', '変数名'], ['敵の技名', '敵の技名']];
  }
};

// カスタム変数設定
Blockly.Blocks['custom_variable_set'] = {
  init: function() {
    this.appendValueInput("VALUE")
        .setCheck(null)
        .appendField(new Blockly.FieldDropdown(this.getVariableOptions.bind(this)), "VAR_NAME")
        .appendField("に");
    this.appendDummyInput()
        .appendField("を設定");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour("#AA55FF");
    this.setTooltip("変数に値を設定");
    this.setHelpUrl("");
  },
  getVariableOptions: function() {
    const options = [['変数名', '変数名']];
    
    if (window.game && window.game.scene && window.game.scene.scenes[0]) {
      const currentScene = window.game.scene.scenes[0];
      if (currentScene.customVariables) {
        Object.keys(currentScene.customVariables).forEach(varName => {
          options.push([varName, varName]);
        });
      }
    }
    
    if (window.variableEditor && window.variableEditor.variables) {
      window.variableEditor.variables.forEach((value, name) => {
        if (!options.find(opt => opt[1] === name)) {
          options.push([name, name]);
        }
      });
    }
    
    return options.length > 1 ? options : [['変数名', '変数名']];
  }
};

// ========== カスタムリストブロック（動的生成） ==========

// カスタムリスト取得
Blockly.Blocks['custom_list_get'] = {
  init: function() {
    this.appendValueInput("INDEX")
        .setCheck("Number")
        .appendField(new Blockly.FieldDropdown(this.getListOptions.bind(this)), "LIST_NAME")
        .appendField("の");
    this.appendDummyInput()
        .appendField("番目");
    this.setOutput(true, "String");
    this.setColour("#FF6680");
    this.setTooltip("リストの要素を取得");
    this.setHelpUrl("");
  },
  getListOptions: function() {
    const options = [['リスト名', 'リスト名']];
    
    if (window.variableEditor && window.variableEditor.lists) {
      window.variableEditor.lists.forEach((value, name) => {
        options.push([name, name]);
      });
    }
    
    return options.length > 1 ? options : [['リスト名', 'リスト名']];
  }
};

// カスタムリスト追加
Blockly.Blocks['custom_list_add'] = {
  init: function() {
    this.appendValueInput("ITEM")
        .setCheck(null)
        .appendField(new Blockly.FieldDropdown(this.getListOptions.bind(this)), "LIST_NAME")
        .appendField("に");
    this.appendDummyInput()
        .appendField("を追加");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour("#FF6680");
    this.setTooltip("リストに要素を追加");
    this.setHelpUrl("");
  },
  getListOptions: function() {
    const options = [['リスト名', 'リスト名']];
    
    if (window.variableEditor && window.variableEditor.lists) {
      window.variableEditor.lists.forEach((value, name) => {
        options.push([name, name]);
      });
    }
    
    return options.length > 1 ? options : [['リスト名', 'リスト名']];
  }
};

// カスタムリスト長さ
Blockly.Blocks['custom_list_length'] = {
  init: function() {
    this.appendDummyInput()
        .appendField(new Blockly.FieldDropdown(this.getListOptions.bind(this)), "LIST_NAME")
        .appendField("の長さ");
    this.setOutput(true, "Number");
    this.setColour("#FF6680");
    this.setTooltip("リストの長さを取得");
    this.setHelpUrl("");
  },
  getListOptions: function() {
    const options = [['リスト名', 'リスト名']];
    
    if (window.variableEditor && window.variableEditor.lists) {
      window.variableEditor.lists.forEach((value, name) => {
        options.push([name, name]);
      });
    }
    
    return options.length > 1 ? options : [['リスト名', 'リスト名']];
  }
};




// 攻撃を変換する
Blockly.Blocks['convert_attack'] = {
  init: function() {
    this.appendValueInput("INPUT")
        .setCheck(null);
    this.appendDummyInput()
        .appendField("を変換する");
    this.setPreviousStatement(true, null);  // 前のブロックに接続可能
    this.setNextStatement(true, null);      // 次のブロックに接続可能
    this.setColour("#5BA58C");
    this.setTooltip("攻撃を吸収して変換します。変数を使うと高経験値！");
    this.setHelpUrl("");
  }
};

// 攻撃を強化する
Blockly.Blocks['enhance_attack'] = {
  init: function() {
    this.appendValueInput("INPUT")
        .setCheck(null);
    this.appendDummyInput()
        .appendField("を強化する");
    this.setPreviousStatement(true, null);  // 前のブロックに接続可能
    this.setNextStatement(true, null);      // 次のブロックに接続可能
    this.setColour("#5BA58C");
    this.setTooltip("変換した攻撃を強化します。変数を使うと高経験値！");
    this.setHelpUrl("");
  }
};

// ========== ステージ固有ブロック ==========

// ステージ4: 氷の盾
Blockly.Blocks['ice_shield'] = {
  init: function() {
    this.jsonInit({
      "message0": "氷の盾を張る",
      "category": "特殊",
      "colour": "#19e5e6",
      "extensions": ["colours_operators", "shape_statement"]
    });
  }
};

Blockly.Blocks['custom_function_placeholder'] = {
  init: function() {
    const LabelCtor = Blockly.FieldLabelSerializable || Blockly.FieldLabel;
    const defaultText = 'Function';
    const dummy = this.appendDummyInput('LABEL');
    if (LabelCtor) {
      const labelField = new LabelCtor(defaultText, 'function-name-label');
      dummy.appendField(labelField, 'FUNCTION_NAME');
    } else {
      dummy.appendField(defaultText);
    }
    this.setColour(210);
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setTooltip('Execute a saved function');
    this.contextMenu = false;
  },
  mutationToDom: function() {
    const container = document.createElement('mutation');
    container.setAttribute('function_name', this.getFunctionName());
    return container;
  },
  domToMutation: function(xmlElement) {
    const fnName = (xmlElement && typeof xmlElement.getAttribute === 'function')
      ? xmlElement.getAttribute('function_name') || ''
      : '';
    this.setFunctionName(fnName);
  },
  setFunctionName: function(name) {
    this.functionName_ = name;
    const field = this.getField && this.getField('FUNCTION_NAME');
    if (field) {
      if (typeof field.setValue === 'function') {
        field.setValue(name || 'Function');
      } else if (typeof field.setText === 'function') {
        field.setText(name || 'Function');
      }
    }
  },
  getFunctionName: function() {
    if (this.functionName_) {
      return this.functionName_;
    }
    if (typeof this.getFieldValue === 'function') {
      return this.getFieldValue('FUNCTION_NAME') || '';
    }
    return '';
  }
};


// ========== JavaScript生成 ==========

if (typeof Blockly !== 'undefined' && Blockly.JavaScript) {
  
  // 基本アクション
  Blockly.JavaScript['attack_basic'] = function(block) {
    return 'attackBasic();\n';
  };

  Blockly.JavaScript['heal_magic'] = function(block) {
    return 'healMagic();\n';
  };

  Blockly.JavaScript['wait'] = function(block) {
    return 'wait();\n';
  };

  // 詠唱動作
  Blockly.JavaScript['wave_left_hand'] = function(block) {
    return 'waveLeftHand();\n';
  };

  Blockly.JavaScript['wave_right_hand'] = function(block) {
    return 'waveRightHand();\n';
  };

  // 魔法システム
  Blockly.JavaScript['cast_magic'] = function(block) {
    var statements = Blockly.JavaScript.statementToCode(block, 'INCANTATION');
    return 'castMagic(function() {\n' + statements + '});\n';
  };

  Blockly.JavaScript['cast_magic_value'] = function(block) {
    var statements = Blockly.JavaScript.statementToCode(block, 'INCANTATION');
    var code = 'castMagicValue(function() {\n' + statements + '})';
    return [code, Blockly.JavaScript.ORDER_FUNCTION_CALL];
  };

  // 制御構造
  Blockly.JavaScript['repeat_2x'] = function(block) {
    var statements = Blockly.JavaScript.statementToCode(block, 'STACK');
    return 'for (var i = 0; i < 2; i++) {\n' + statements + '}\n';
  };

  Blockly.JavaScript['repeat_3x'] = function(block) {
    var statements = Blockly.JavaScript.statementToCode(block, 'STACK');
    return 'for (var i = 0; i < 3; i++) {\n' + statements + '}\n';
  };

  Blockly.JavaScript['for_loop'] = function(block) {
    var statements = Blockly.JavaScript.statementToCode(block, 'STACK');
    return 'forLoop(function() {\n' + statements + '});\n';
  };

  Blockly.JavaScript['while_loop'] = function(block) {
    var statements = Blockly.JavaScript.statementToCode(block, 'STACK');
    return 'whileLoop(function() {\n' + statements + '});\n';
  };

  Blockly.JavaScript['if_condition'] = function(block) {
    var statements = Blockly.JavaScript.statementToCode(block, 'STACK');
    return 'ifCondition(function() {\n' + statements + '});\n';
  };

  // 変数システム
  Blockly.JavaScript['set_variable'] = function(block) {
    return 'setVariable();\n';
  };

  Blockly.JavaScript['get_variable'] = function(block) {
    return ['getVariable()', Blockly.JavaScript.ORDER_FUNCTION_CALL];
  };

  // ステージ固有ブロック
  Blockly.JavaScript['ice_shield'] = function(block) {
    return 'iceShield();\n';
  };

  // Stage 11: 攻撃反射システム（新バージョン）
  Blockly.JavaScript['attack_name'] = function(block) {
    return ['getVariable("attack_name")', Blockly.JavaScript.ORDER_FUNCTION_CALL];
  };

  Blockly.JavaScript['set_attack_name'] = function(block) {
    var varType = block.getFieldValue('VAR_TYPE');
    var value = block.getFieldValue('VALUE');
    return 'setVariable("' + varType + '", "' + value + '");\n';
  };

  Blockly.JavaScript['enemy_attack_name'] = function(block) {
    var attackName = block.getFieldValue('ATTACK_NAME');
    return ['"' + attackName + '"', Blockly.JavaScript.ORDER_ATOMIC];
  };

  Blockly.JavaScript['enemy_last_attack'] = function(block) {
    return ['getEnemyLastAttack()', Blockly.JavaScript.ORDER_FUNCTION_CALL];
  };

  Blockly.JavaScript['convert_attack'] = function(block) {
    var input = Blockly.JavaScript.valueToCode(block, 'INPUT', Blockly.JavaScript.ORDER_ATOMIC) || '""';
    return ['convertAttack(' + input + ')', Blockly.JavaScript.ORDER_FUNCTION_CALL];
  };

  Blockly.JavaScript['custom_function_placeholder'] = function(block) {
    var functionName = block.getFieldValue('FUNCTION_NAME') || '';
    var escapedName = JSON.stringify(functionName);
    return 'executeSavedFunction(' + escapedName + ');\\n';
  };

  Blockly.JavaScript['enhance_attack'] = function(block) {
    var input = Blockly.JavaScript.valueToCode(block, 'INPUT', Blockly.JavaScript.ORDER_ATOMIC) || '""';
    return ['enhanceAttack(' + input + ')', Blockly.JavaScript.ORDER_FUNCTION_CALL];
  };

  // 条件分岐ブロック
  Blockly.JavaScript['if_condition'] = function(block) {
    var condition1 = Blockly.JavaScript.valueToCode(block, 'CONDITION1', Blockly.JavaScript.ORDER_NONE) || 'false';
    var do1 = Blockly.JavaScript.statementToCode(block, 'DO1');
    var condition2 = Blockly.JavaScript.valueToCode(block, 'CONDITION2', Blockly.JavaScript.ORDER_NONE) || 'false';
    var do2 = Blockly.JavaScript.statementToCode(block, 'DO2');
    var doElse = Blockly.JavaScript.statementToCode(block, 'ELSE');
    
    var code = 'if (' + condition1 + ') {\n' + do1 + '} else if (' + condition2 + ') {\n' + do2 + '} else {\n' + doElse + '}\n';
    return code;
  };

  // 文字列比較ブロック
  Blockly.JavaScript['text_equals'] = function(block) {
    var valueA = Blockly.JavaScript.valueToCode(block, 'A', Blockly.JavaScript.ORDER_EQUALITY) || '""';
    var valueB = Blockly.JavaScript.valueToCode(block, 'B', Blockly.JavaScript.ORDER_EQUALITY) || '""';
    var code = '(' + valueA + ' === ' + valueB + ')';
    return [code, Blockly.JavaScript.ORDER_EQUALITY];
  };


  Blockly.JavaScript['number'] = function(block) {
    var number = block.getFieldValue('NUM');
    return [number, Blockly.JavaScript.ORDER_ATOMIC];
  };

  // カスタム変数・リストのJavaScript生成
  Blockly.JavaScript['custom_variable_get'] = function(block) {
    var varName = block.getFieldValue('VAR_NAME');
    return ['getCustomVariable("' + varName + '")', Blockly.JavaScript.ORDER_FUNCTION_CALL];
  };

  Blockly.JavaScript['custom_variable_set'] = function(block) {
    var varName = block.getFieldValue('VAR_NAME');
    var value = Blockly.JavaScript.valueToCode(block, 'VALUE', Blockly.JavaScript.ORDER_ATOMIC) || '""';
    return 'setCustomVariable("' + varName + '", ' + value + ');\n';
  };

  Blockly.JavaScript['custom_list_get'] = function(block) {
    var listName = block.getFieldValue('LIST_NAME');
    var index = Blockly.JavaScript.valueToCode(block, 'INDEX', Blockly.JavaScript.ORDER_ATOMIC) || '0';
    return ['getFromCustomList("' + listName + '", ' + index + ')', Blockly.JavaScript.ORDER_FUNCTION_CALL];
  };

  Blockly.JavaScript['custom_list_add'] = function(block) {
    var listName = block.getFieldValue('LIST_NAME');
    var item = Blockly.JavaScript.valueToCode(block, 'ITEM', Blockly.JavaScript.ORDER_ATOMIC) || '""';
    return 'addToCustomList("' + listName + '", ' + item + ');\n';
  };

  Blockly.JavaScript['custom_list_length'] = function(block) {
    var listName = block.getFieldValue('LIST_NAME');
    return ['getCustomListLength("' + listName + '")', Blockly.JavaScript.ORDER_FUNCTION_CALL];
  };
}



