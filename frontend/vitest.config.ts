import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
    ],
    passWithNoTests: true,
  },
  resolve: {
    // Mirror the tsconfig path aliases. The more-specific @/chat, @/knowledge-base
    // and @/workspace entries MUST come before the catch-all @ so they win.
    alias: {
      '@/chat': path.resolve(__dirname, 'app/(main)/chat'),
      '@/knowledge-base': path.resolve(__dirname, 'app/(main)/knowledge-base'),
      '@/workspace': path.resolve(__dirname, 'app/(main)/workspace'),
      '@': path.resolve(__dirname, '.'),
    },
  },
});
