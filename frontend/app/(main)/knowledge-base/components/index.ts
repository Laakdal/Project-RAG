// kb components (mode-aware for collections/all-records)
export { Header } from './header';
export { FilterBar } from './filter-bar';
export { SearchBar } from './search-bar';
export { KbDataTable } from './kb-data-table';

// Action components
export { SelectionActionBar } from './selection-action-bar';

// Dialog / overlay components
export {
  MoveFolderSidebar,
  CreateFolderDialog,
  UploadDataSidebar,
  ReplaceFileDialog,
  DeleteConfirmationDialog,
  BulkDeleteConfirmationDialog,
  FolderDetailsSidebar,
  ReindexScopeDialog,
} from './dialogs';
export type { MoveFolderSidebarProps } from './dialogs';
export type { CreateFolderDialogProps } from './dialogs';
export type { UploadDataSidebarProps, UploadFileItem } from './dialogs';
