import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLockedBlocks } from '../../components/features/PSchool/game/levelBlockRestrictions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('P-School run check for locked blocks', () => {
  it('lets every block in the toolbox run at level 20, spells included', () => {
    const toolbox = fs.readFileSync(path.join(ROOT, 'components/features/PSchool/blockly/toolbox.xml'), 'utf8');
    const types = [...toolbox.matchAll(/type="(\w+)"/g)].map(([, type]) => type);
    assert.ok(types.includes('cast_magic') && types.includes('wave_left_hand'), 'the toolbox offers spell blocks');
    assert.deepEqual(getLockedBlocks(types, 20), []);
  });

  it('still locks a block from the level table until its level', () => {
    assert.deepEqual(getLockedBlocks(['attack_basic', 'if_condition', 'if_condition', 'cast_magic'], 1), ['if_condition']);
    assert.deepEqual(getLockedBlocks(['attack_basic', 'if_condition'], 20), []);
  });
});
