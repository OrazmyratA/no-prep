function registerBookLibraryActionsIpc({
  ipcMain,
  app,
  dialog,
  shell,
  fsp,
  path,
  getMainWindow,
  getBooksRoot,
  createId,
  sanitizeName,
  operationResult,
  operationError,
  sendBookProgress,
  makeBookProgress,
  confirmBookFileOperation,
  ensureEnoughSpace,
  getDirectorySize,
  pathExists,
  copyFile,
  copyFileWithProgress,
  copyDirectoryWithProgress,
  createZipPackageWithProgress,
  extractZipPackage,
  getZipUncompressedSize,
  createBlankBookPage,
  createPdfPages,
  getPdfInfo,
  generateFirstPageCover,
  readRegistry,
  upsertRegistryItem,
  removeRegistryItem,
  findBook,
  makeRegistryItem,
  readBookJson,
  writeBookJson,
  validateBookFolder,
  validateBookData,
  pruneUnusedBookAssets,
  rewriteRelativeAssetPaths,
  constants
}) {
  ipcMain.handle('books:copy', async (_event, input) => {
    const operationId = createId('copy');
    try {
      const source = await findBook(String(input?.bookId ?? ''));
      if (!source) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }
      await validateBookFolder(source.folderPath, { label: source.title || 'Book' });

      const bookId = createId('book');
      const destination = path.join(getBooksRoot(), bookId);
      const totalBytes = await getDirectorySize(source.folderPath);
      await ensureEnoughSpace(destination, totalBytes);
      if (!(await confirmBookFileOperation('Copy book', totalBytes, destination))) {
        return operationError('CANCELLED');
      }
      const operation = {
        operationId,
        type: 'copy',
        phase: 'Copying book',
        transferredBytes: 0,
        totalBytes
      };
      sendBookProgress(operation);
      await copyDirectoryWithProgress(source.folderPath, destination, operation);

      const now = new Date().toISOString();
      const book = await readBookJson(destination);
      book.id = bookId;
      book.title = `${book.title || source.title} (Copy)`;
      book.createdAt = now;
      book.updatedAt = now;
      await writeBookJson(destination, book);

      const sizeBytes = await getDirectorySize(destination);
      const item = await upsertRegistryItem(makeRegistryItem(book, destination, sizeBytes));
      sendBookProgress(null);
      return operationResult(item);
    } catch (error) {
      sendBookProgress(null);
      console.error('books:copy error:', error);
      return operationError('COPY_FAILED', error?.message || 'Could not copy this book.');
    }
  });

  ipcMain.handle('books:combine', async (_event, input) => {
    const operationId = createId('combine');
    try {
      const ids = Array.isArray(input?.bookIds) ? input.bookIds.map(String) : [];
      if (ids.length < 2) {
        return operationError('NOT_ENOUGH_BOOKS', 'Select at least two books to combine.');
      }

      const registry = await readRegistry();
      const selected = ids.map((id) => registry.find((book) => book.id === id)).filter(Boolean);
      if (selected.length < 2) {
        return operationError('BOOK_NOT_FOUND', 'Could not find the selected books.');
      }
      for (const book of selected) {
        await validateBookFolder(book.folderPath, { label: book.title || 'Selected book' });
      }

      const totalBytes = await selected.reduce(async (sumPromise, book) => {
        return (await sumPromise) + await getDirectorySize(book.folderPath);
      }, Promise.resolve(0));

      const now = new Date().toISOString();
      const bookId = createId('book');
      const destination = path.join(getBooksRoot(), bookId);
      const destinationAssets = path.join(destination, 'assets');
      await ensureEnoughSpace(destination, totalBytes);
      if (!(await confirmBookFileOperation('Combine books', totalBytes, destination))) {
        return operationError('CANCELLED');
      }
      await fsp.mkdir(destinationAssets, { recursive: true });

      const operation = {
        operationId,
        type: 'combine',
        phase: 'Combining books',
        transferredBytes: 0,
        totalBytes
      };
      sendBookProgress(operation);

      const combinedPages = [];
      for (const source of selected) {
        const sourceBook = await readBookJson(source.folderPath);
        const sourceAssets = path.join(source.folderPath, 'assets');
        const assetPrefix = source.id;
        if (await pathExists(sourceAssets)) {
          await copyDirectoryWithProgress(sourceAssets, path.join(destinationAssets, assetPrefix), operation);
        }

        const pages = Array.isArray(sourceBook.pages) ? sourceBook.pages : [];
        for (const page of pages) {
          const rewritten = rewriteRelativeAssetPaths(page, assetPrefix);
          if (rewritten.type === 'pdf') {
            const pageSourcePdf = page.sourcePdf || sourceBook.sourcePdf;
            if (pageSourcePdf) {
              rewritten.sourcePdf = rewriteRelativeAssetPaths(pageSourcePdf, assetPrefix);
            }
          }
          combinedPages.push({
            ...rewritten,
            id: createId('page')
          });
        }
      }

      const title = sanitizeName(input?.title, selected.map((book) => book.title).join(' + '));
      const firstCoverSource = selected.find((book) => book.coverPath);
      let cover = '';
      if (firstCoverSource?.coverPath) {
        const sourceCover = path.join(firstCoverSource.folderPath, firstCoverSource.coverPath);
        if (await pathExists(sourceCover)) {
          cover = 'cover.png';
          await copyFile(sourceCover, path.join(destination, cover));
        }
      }
      const combinedBook = {
        version: '1.0',
        id: bookId,
        title,
        cover,
        pages: combinedPages,
        createdAt: now,
        updatedAt: now
      };
      await writeBookJson(destination, combinedBook);
      const sizeBytes = await getDirectorySize(destination);
      const item = await upsertRegistryItem(makeRegistryItem(combinedBook, destination, sizeBytes));
      sendBookProgress(null);
      return operationResult(item);
    } catch (error) {
      sendBookProgress(null);
      console.error('books:combine error:', error);
      return operationError('COMBINE_FAILED', error?.message || 'Could not combine these books.');
    }
  });

  ipcMain.handle('books:delete', async (_event, input) => {
    try {
      const book = await findBook(String(input?.bookId ?? ''));
      if (!book) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      await shell.trashItem(book.folderPath);
      await removeRegistryItem(book.id);
      return operationResult(null);
    } catch (error) {
      console.error('books:delete error:', error);
      return operationError('DELETE_FAILED', error?.message || 'Could not delete this book.');
    }
  });

  ipcMain.handle('books:cleanup-storage', async (_event, input) => {
    try {
      const registryItem = await findBook(String(input?.bookId ?? ''));
      if (!registryItem) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      const book = await readBookJson(registryItem.folderPath);
      await validateBookData(book, registryItem.folderPath, book.title || 'Book');
      await pruneUnusedBookAssets(book, registryItem.folderPath);
      const sizeBytes = await getDirectorySize(registryItem.folderPath);
      const item = await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
      return operationResult(item);
    } catch (error) {
      console.error('books:cleanup-storage error:', error);
      return operationError('CLEANUP_FAILED', 'Could not clean this book storage.');
    }
  });
}

module.exports = { registerBookLibraryActionsIpc };
