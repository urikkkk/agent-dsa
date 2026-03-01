import { config } from 'dotenv';
config({ path: '.env.local' });

// Remove CLAUDECODE env var to allow nested SDK usage
delete process.env.CLAUDECODE;

import { query } from '@anthropic-ai/claude-agent-sdk';

async function main() {
  console.log('ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);

  try {
    for await (const message of query({
      prompt: 'Say hello in one word',
      options: {
        model: 'claude-sonnet-4-6',
        maxTurns: 1,
        tools: [],
        systemPrompt: 'You are a test. Just say hello.',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    })) {
      const msg = message as any;
      console.log('Message type:', msg.type, JSON.stringify(message).substring(0, 300));
    }
    console.log('Done!');
  } catch (err) {
    console.error('SDK Error:', err);
  }
}

main();
