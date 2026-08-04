// Only the symbols page.tsx actually consumes. Everything else in these
// subtrees is imported directly from its source module, so re-exporting it
// here just created a second, unused path.
export { ChatInputWrapper } from './chat-panel';
export { MessageList } from './message-area';
