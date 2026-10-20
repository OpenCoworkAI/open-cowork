import { logError } from '../utils/logger';
import { ensureImageResizeReporting } from './image-resize-packaging';

ensureImageResizeReporting((error: unknown) => {
  logError('[ImageResize]', error);
});
