// Axios instance with interceptors
export { apiClient, default } from './axios-instance';

// SWR fetchers
export { axiosFetcher } from './fetcher';


// Error handling
export {
  processError,
  ErrorType,
  isProcessedError,
  isRequestCancelledError,
  isSearchNoAccessibleDocumentsNotFound,
} from './api-error';
export type { ProcessedError } from './api-error';
