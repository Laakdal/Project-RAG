'use client';

import React from 'react';
import { Box, Flex } from '@radix-ui/themes';

function SkeletonLine({ width }: { width: string }) {
  return (
    <Box
      style={{
        height: 12,
        width,
        borderRadius: 'var(--radius-1)',
        backgroundColor: 'var(--slate-a3)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }}
    />
  );
}

/** Skeleton row with title only (matches ChatRow with showDate={false}) */
function SkeletonItemTitleOnly({ titleWidth }: { titleWidth: string }) {
  return (
    <Flex direction="column" style={{ padding: '6px var(--space-2)' }}>
      <SkeletonLine width={titleWidth} />
    </Flex>
  );
}

/** Skeleton for time-grouped recent chats — grouped sections with title-only rows */
export function TimeGroupedSkeleton() {
  return (
    <Flex direction="column" gap="2">
      {/* Group 1 */}
      <Flex direction="column">
        <Flex align="center" style={{ height: 32, padding: '0 var(--space-2)' }}>
          <SkeletonLine width="60px" />
        </Flex>
        <Flex direction="column" gap="1">
          <SkeletonItemTitleOnly titleWidth="85%" />
          <SkeletonItemTitleOnly titleWidth="70%" />
        </Flex>
      </Flex>

      {/* Group 2 */}
      <Flex direction="column">
        <Flex align="center" style={{ height: 32, padding: '0 var(--space-2)' }}>
          <SkeletonLine width="100px" />
        </Flex>
        <Flex direction="column" gap="1">
          <SkeletonItemTitleOnly titleWidth="90%" />
          <SkeletonItemTitleOnly titleWidth="75%" />
          <SkeletonItemTitleOnly titleWidth="80%" />
        </Flex>
      </Flex>
    </Flex>
  );
}
