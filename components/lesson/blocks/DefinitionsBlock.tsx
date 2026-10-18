import React from 'react';
import type { BlockProps } from './registry';
import { MdText, Txt } from '../Md';

/** Term / description pairs as a <dl> grid. Terms wrap only at phrase boundaries. */
export default function DefinitionsBlock({ block }: BlockProps<'definitions'>) {
  return (
    <dl className="rp-defs">
      {block.items.map((item, i) => (
        <React.Fragment key={i}>
          <dt><Txt value={item.term} /></dt>
          <dd><MdText value={item.md} inline /></dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
