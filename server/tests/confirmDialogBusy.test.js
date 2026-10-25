// ConfirmDialog (components/safety/ConfirmDialog.tsx) while its action runs (`busy`), and the
// Privacy page's delete section that uses it (LessonProgressDeleteSection.tsx):
// - both buttons are aria-disabled, not disabled (a disabled focused button drops focus to the
//   page), the confirm button does nothing, Cancel does not close and Esc (the dialog's cancel
//   event) is refused: the action cannot be called back, so nothing may look as if it was;
// - the delete section's trigger stays enabled while deleting, so the dialog can return focus to
//   it however it closes (Chromium force-closes on a repeated Esc);
// - its copy says what stays by scope (Phase 5, owner decision O2): signed in, the history, the XP
//   record, badges, learning days (the streak, from the server's days) and the lessons started over
//   are kept; on this device only (guests) the history. The streak no longer gets shorter.
// There is no DOM here: the components are bundled with esbuild (as in agentChatError.test.js)
// against a React stub whose jsx() returns { type, props } and whose hooks record what they
// return, and the element trees are checked directly.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const REACT_STUB = `
  export const hooks = { states: [] };
  let overrides = [];
  let index = 0;
  export function render(component, props, stateOverrides = []) {
    overrides = stateOverrides;
    index = 0;
    hooks.states = [];
    return component(props);
  }
  export function useState(initial) {
    const i = index++;
    const value = i in overrides ? overrides[i] : typeof initial === 'function' ? initial() : initial;
    hooks.states.push(value);
    return [value, () => {}];
  }
  export const useRef = (value) => ({ current: value ?? null });
  export const useId = () => 'id';
  export const useEffect = () => {};
  export const useLayoutEffect = () => {};
  export const useCallback = (fn) => fn;
  export const useMemo = (fn) => fn();
  export const forwardRef = (fn) => fn;
  export const createContext = () => ({});
  export const useContext = () => null;
  export default { useState, useRef, useId, useEffect, useLayoutEffect, useCallback, useMemo, forwardRef, createContext, useContext };
`;
const JSX_STUB = `
  export const jsx = (type, props) => ({ type, props });
  export const jsxs = jsx;
  export const Fragment = 'Fragment';
`;
const STUBS = {
  react: REACT_STUB,
  'react/jsx-runtime': JSX_STUB,
  'lucide-react': "export const Trash2 = 'Trash2';",
  language: "export const useLanguage = () => ({ language: globalThis.__language ?? 'en' });",
  button: "export const Button = 'Button';",
  dialog: "export const ConfirmDialog = 'ConfirmDialog';",
  sync: `
    export const deleteLessonProgress = async () => ({ ok: true, scope: 'account' });
    export const useProgressSyncState = () => ({ status: 'on', userId: 'syncUser' in globalThis ? globalThis.syncUser : 'u1' });
  `,
};

/** `section`: the delete section with its imports stubbed; otherwise ConfirmDialog itself. */
async function load(entry, { section = false } = {}) {
  const plugin = {
    name: 'stubs',
    setup(b) {
      const stub = (filter, name) => b.onResolve({ filter }, () => ({ path: name, namespace: 'stub' }));
      stub(/^react$/, 'react');
      stub(/^react\/jsx-runtime$/, 'react/jsx-runtime');
      stub(/^lucide-react$/, 'lucide-react');
      if (section) {
        stub(/LanguageContext$/, 'language');
        stub(/\/ui\/Button$/, 'button');
        stub(/\/safety\/ConfirmDialog$/, 'dialog');
        stub(/\/lesson\/progressSyncClient$/, 'sync');
      }
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
    },
  };
  const result = await build({
    stdin: { contents: `${entry}\nexport * as React from 'react';`, resolveDir: ROOT, loader: 'tsx' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    plugins: [plugin],
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

/** Every element in a tree (props.children may be one element, text or an array). */
function elements(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
  } else if (node && typeof node === 'object' && 'type' in node) {
    out.push(node);
    elements(node.props?.children, out);
  }
  return out;
}
const textOf = (node) => elements(node).flatMap((el) => [el.props?.children].flat()).filter((c) => typeof c === 'string').join(' ');

describe('ConfirmDialog while busy', () => {
  let mod;
  before(async () => {
    mod = await load("export { ConfirmDialog } from './components/safety/ConfirmDialog';");
  });

  function dialog(busy) {
    const calls = { confirm: 0, close: 0, closeEvent: 0, prevented: 0 };
    const tree = mod.React.render(mod.ConfirmDialog, {
      open: true,
      title: 'Delete?',
      body: 'Cannot be undone.',
      confirmLabel: busy ? 'Deleting…' : 'Delete',
      cancelLabel: 'Cancel',
      busy,
      onConfirm: () => {
        calls.confirm += 1;
      },
      onClose: () => {
        calls.closeEvent += 1;
      },
    });
    tree.props.ref.current = {
      close: () => {
        calls.close += 1;
      },
    };
    const [cancel, confirm] = elements(tree).filter((el) => el.type === 'button');
    const cancelEvent = {
      preventDefault: () => {
        calls.prevented += 1;
      },
    };
    return { tree, cancel, confirm, calls, cancelEvent };
  }

  it('keeps both buttons focusable but aria-disabled; confirm and Cancel do nothing, Esc is refused', () => {
    const d = dialog(true);
    assert.equal(d.tree.type, 'dialog');
    assert.equal(d.confirm.props.disabled, undefined);
    assert.equal(d.confirm.props['aria-disabled'], true);
    assert.equal(d.cancel.props.disabled, undefined);
    assert.equal(d.cancel.props['aria-disabled'], true);
    d.confirm.props.onClick?.();
    d.cancel.props.onClick();
    d.tree.props.onCancel(d.cancelEvent);
    assert.deepEqual(d.calls, { confirm: 0, close: 0, closeEvent: 0, prevented: 1 });
    // They still look disabled.
    assert.match(d.confirm.props.className, /aria-disabled:opacity-50/);
    assert.match(d.cancel.props.className, /aria-disabled:opacity-50/);
  });

  it('when not busy: confirm runs, Cancel closes, Esc closes', () => {
    const d = dialog(false);
    assert.equal(d.confirm.props['aria-disabled'], undefined);
    assert.equal(d.cancel.props['aria-disabled'], undefined);
    d.confirm.props.onClick();
    d.cancel.props.onClick();
    d.tree.props.onCancel?.(d.cancelEvent);
    assert.deepEqual(d.calls, { confirm: 1, close: 1, closeEvent: 0, prevented: 0 });
  });
});

describe('LessonProgressDeleteSection', () => {
  let mod;
  before(async () => {
    mod = await load("export { default as Section } from './components/features/settings/LessonProgressDeleteSection';", { section: true });
  });

  it('keeps its trigger enabled while deleting, so the dialog can return focus to it', () => {
    // useState order: confirmOpen, busy, notice.
    const tree = mod.React.render(mod.Section, {}, [true, true]);
    assert.deepEqual(mod.React.hooks.states.slice(0, 2), [true, true]);
    const trigger = elements(tree).find((el) => el.type === 'Button');
    const dialog = elements(tree).find((el) => el.type === 'ConfirmDialog');
    assert.ok(trigger && dialog);
    assert.notEqual(trigger.props.disabled, true);
    assert.equal(dialog.props.busy, true);
    assert.equal(dialog.props.open, true);
    assert.equal(dialog.props.returnFocusRef, trigger.props.ref);
  });

  it('says what stays by scope: signed in, XP, badges, learning days and restarted lessons stay (O2); the streak no longer gets shorter', () => {
    const kept = {
      en: 'Not deleted: your learning history (lessons you started and finished), the record of the XP you earned (which lessons and stages you started or finished, and when), your badges, the days you learned (your streak), which lessons you started over and when, and records that AI apps saved with the learner-state tools.',
      jp: '学習の履歴（レッスンを始めた・終えた記録）、XP の記録（どのレッスンやステージを始めた・終えたか、いつか）とバッジ、学んだ日の記録（連続記録）、やり直したレッスンとその日時、AI アプリが学習状況ツール（learner-state）で保存した記録は消えません。',
    };
    const device = {
      en: 'Not deleted: your learning history (lessons you started and finished).',
      jp: '学習の履歴（レッスンを始めた・終えた記録）は消えません。',
    };
    for (const language of ['en', 'jp']) {
      globalThis.__language = language;
      try {
        const account = textOf(mod.React.render(mod.Section, {}));
        assert.ok(account.includes(kept[language]), `${language}: the signed-in kept line`);
        assert.ok(!account.includes(device[language]), `${language}: not the device line`);
        assert.doesNotMatch(account, /streak can get shorter|短くなることがあります/);
        globalThis.syncUser = null;
        const guest = textOf(mod.React.render(mod.Section, {}));
        assert.ok(guest.includes(device[language]), `${language}: the device kept line`);
        assert.doesNotMatch(guest, /XP|badges|バッジ|連続記録|learner-state|started over|やり直した/, `${language}: guests have none of these`);
      } finally {
        delete globalThis.__language;
        delete globalThis.syncUser;
      }
    }
  });
});
