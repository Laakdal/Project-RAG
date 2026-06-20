'use client';

import { Suspense } from 'react';
import { Box, Text } from '@radix-ui/themes';
import { useSearchParams } from 'next/navigation';
import { AgentBuilder } from '@/app/(main)/agents/agent-builder/agent-builder';
import { ServiceGate } from '@/app/components/ui/service-gate';

/**
 * Edit an existing agent. Uses query param because `output: 'export'` disallows
 * dynamic `[agentKey]` segments without a fixed `generateStaticParams` list.
 *
 * URL: `/agents/edit?agentKey=<uuid>`
 */
function EditAgentContent() {
  const searchParams = useSearchParams();
  const agentKey = searchParams.get('agentKey')?.trim() || '';

  if (!agentKey) {
    return (
      <Box p="4">
        <Text size="2" color="gray">
          {"Missing agent key. Open an agent from the chat sidebar or use a valid link."}
        </Text>
      </Box>
    );
  }

  return <AgentBuilder agentKey={agentKey} />;
}

function EditPageSuspenseFallback() {
  return (
    <Box p="4">
      <Text size="2" color="gray">
        {"Loading…"}
      </Text>
    </Box>
  );
}

export default function EditAgentPage() {
  return (
    <ServiceGate services={['query']}>
      <Box style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Suspense fallback={<EditPageSuspenseFallback />}>
          <EditAgentContent />
        </Suspense>
      </Box>
    </ServiceGate>
  );
}
