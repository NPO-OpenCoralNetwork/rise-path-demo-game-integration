/**
 * remark plugin: bold next to Japanese brackets.
 *
 * CommonMark only opens `**` when the delimiter is "left-flanking". In `相談できる**「設計図」**です`
 * the opening `**` sits between a letter and punctuation (「), so it is not, and the asterisks
 * stay on screen. After parsing, any `**…**` pair still left inside a single text node is such a
 * failed pair; this plugin turns it into a `strong` node. Pairs the parser already handled never
 * reach a text node, so valid markdown is unaffected. Code spans are untouched (they are not
 * `text` nodes).
 */

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
};

const STRONG = /\*\*(?=\S)([\s\S]*?\S)\*\*/g;

/** Splits one text value into text / strong nodes. Returns null when nothing changes. */
export function splitCjkStrong(value: string): MdNode[] | null {
  if (!value.includes('**')) return null;
  const parts: MdNode[] = [];
  let last = 0;
  STRONG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STRONG.exec(value))) {
    if (match.index > last) parts.push({ type: 'text', value: value.slice(last, match.index) });
    parts.push({ type: 'strong', children: [{ type: 'text', value: match[1] }] });
    last = STRONG.lastIndex;
  }
  if (!parts.length) return null;
  if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
  return parts;
}

function visit(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  let changed = false;
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const parts = splitCjkStrong(child.value);
      if (parts) {
        next.push(...parts);
        changed = true;
        continue;
      }
    } else {
      visit(child);
    }
    next.push(child);
  }
  if (changed) node.children = next;
}

export default function remarkCjkEmphasis() {
  return (tree: MdNode) => {
    visit(tree);
  };
}
