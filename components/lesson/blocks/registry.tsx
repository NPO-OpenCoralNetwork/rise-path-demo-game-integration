import React from 'react';
import type { Block, Section } from '../../../shared/lesson/schema.js';
import MarkdownBlock from './MarkdownBlock';
import CalloutBlock from './CalloutBlock';
import ListBlock from './ListBlock';
import DefinitionsBlock from './DefinitionsBlock';
import TableBlock from './TableBlock';
import CodeBlock from './CodeBlock';
import PromptBlock from './PromptBlock';
import DiagramBlock from './DiagramBlock';
import ImageBlock from './ImageBlock';
import QuizCheckBlock from './QuizCheckBlock';
import FlashcardsBlock from './FlashcardsBlock';
import StepsBlock from './StepsBlock';
import ChecklistBlock from './ChecklistBlock';
import SummaryBlock from './SummaryBlock';
import AskTutorBlock from './AskTutorBlock';
import UnknownBlock from './UnknownBlock';

/**
 * risepath.lesson/v1 block type → renderer. The mapped type makes TypeScript fail when a type in
 * shared/lesson/schema.js has no renderer. One file per block so WP-05 can upgrade blocks
 * independently; register new types here.
 */

export type BlockType = Block['type'];
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;
export type BlockProps<T extends BlockType = BlockType> = {
  block: BlockOf<T>;
  section: Section;
};

type Registry = { [T in BlockType]: React.ComponentType<BlockProps<T>> };

export const blockRegistry: Registry = {
  markdown: MarkdownBlock,
  callout: CalloutBlock,
  list: ListBlock,
  definitions: DefinitionsBlock,
  table: TableBlock,
  code: CodeBlock,
  prompt: PromptBlock,
  diagram: DiagramBlock,
  image: ImageBlock,
  quiz: QuizCheckBlock,
  flashcards: FlashcardsBlock,
  steps: StepsBlock,
  checklist: ChecklistBlock,
  summary: SummaryBlock,
  askTutor: AskTutorBlock,
};

export function isKnownBlockType(type: unknown): type is BlockType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(blockRegistry, type);
}

/**
 * Renders one block inside its frame. The frame carries the anchor id (`#b-<id>`) and the
 * `data-rp-block` hook that progress tracking observes.
 */
export const BlockView = React.memo(function BlockView({ block, section }: { block: Block; section: Section }) {
  const type: unknown = (block as { type?: unknown }).type;
  const Renderer = isKnownBlockType(type)
    ? (blockRegistry[type] as React.ComponentType<BlockProps>)
    : null;
  return (
    <div
      id={`b-${block.id}`}
      className="rp-block"
      data-rp-block={block.id}
      data-block-type={typeof type === 'string' ? type : 'unknown'}
    >
      {Renderer ? <Renderer block={block} section={section} /> : <UnknownBlock block={block} />}
    </div>
  );
});
