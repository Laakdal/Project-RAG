// Axios instance with interceptors
export { apiClient, default } from './axios-instance';

// SWR fetchers
export { axiosFetcher } from './fetcher';

// Streaming utilities (native fetch for SSE)
export { streamRequest, createStreamController, streamSSERequest } from './streaming';
export type { StreamingOptions, SSEEvent, SSEStreamingOptions } from './streaming';

// Error handling
export {
  processError,
  ErrorType,
  isProcessedError,
  isRequestCancelledError,
  isSearchNoAccessibleDocumentsNotFound,
} from './api-error';
export type { ProcessedError } from './api-error';
