// Illustrative tokens only. Export your application's config for actual values.
import { Box } from '@cerberus-design/react';
import { css } from 'styled-system/css';

const card = css({
  bgColor: 'page.bg.initial',
  color: 'page.fg.initial',
  p: '4',
  _hover: { bgColor: 'page.bg.initial' },
});

export function Example() {
  return <Box className={card} bgColor="page.bg.initial" p="4">Token demo</Box>;
}

// These should not get token suggestions:
const unrelated = { color: 'ordinary string' };
const native = <div title="ordinary string" />;
