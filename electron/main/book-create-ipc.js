function registerBookCreateIpc({
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
  ipcMain.handle('books:create-empty', async (_event, input) => {
    try {
      const now = new Date().toISOString();
      const bookId = createId('book');
      const title = sanitizeName(input?.title, 'Untitled Book');
      const bookFolder = path.join(getBooksRoot(), bookId);
      await fsp.mkdir(path.join(bookFolder, 'assets'), { recursive: true });

      const book = {
        version: '1.0',
        id: bookId,
        title,
        pages: [createBlankBookPage()],
        workbooks: [],
        workbookLinks: {},
        createdAt: now,
        updatedAt: now
      };
      await writeBookJson(bookFolder, book);
      const sizeBytes = await getDirectorySize(bookFolder);
      const item = await upsertRegistryItem(makeRegistryItem(book, bookFolder, sizeBytes));
      return operationResult(item);
    } catch (error) {
      console.error('books:create-empty error:', error);
      return operationError('CREATE_FAILED', error?.message || 'Could not create this book.');
    }
  });

  ipcMain.handle('books:create-from-pdf', async (_event, input) => {
    const operationId = createId('create');
    try {
      sendBookProgress(makeBookProgress(operationId, 'create', 'Choose PDF'));
      const selected = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Choose PDF',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        properties: ['openFile']
      });

      if (selected.canceled || !selected.filePaths?.[0]) {
        sendBookProgress(null);
        return operationError('CANCELLED');
      }

      const sourcePdf = selected.filePaths[0];
      sendBookProgress(makeBookProgress(operationId, 'create', 'Checking PDF'));
      const pdfInfo = await getPdfInfo(sourcePdf);
      if (pdfInfo.encrypted) {
        sendBookProgress(null);
        return operationError('PROTECTED_PDF', 'This PDF is protected. Please use an unlocked PDF.');
      }

      const now = new Date().toISOString();
      const bookId = createId('book');
      const title = sanitizeName(input?.title, path.basename(sourcePdf, path.extname(sourcePdf)));
      const bookFolder = path.join(getBooksRoot(), bookId);
      const assetsFolder = path.join(bookFolder, 'assets');
      const pdfDestination = path.join(assetsFolder, 'source.pdf');
      const sourceStat = await fsp.stat(sourcePdf);
      sendBookProgress(makeBookProgress(operationId, 'create', 'Checking disk space', 0, sourceStat.size));
      await ensureEnoughSpace(bookFolder, sourceStat.size);
      sendBookProgress(makeBookProgress(operationId, 'create', 'Waiting for confirmation', 0, sourceStat.size));
      if (!(await confirmBookFileOperation('Create book from PDF', sourceStat.size, bookFolder))) {
        sendBookProgress(null);
        return operationError('CANCELLED');
      }

      const operation = {
        operationId,
        type: 'create',
        phase: 'Copying PDF',
        transferredBytes: 0,
        totalBytes: sourceStat.size
      };
      sendBookProgress(operation);
      await fsp.mkdir(assetsFolder, { recursive: true });
      await copyFileWithProgress(sourcePdf, pdfDestination, operation);
      const cover = await generateFirstPageCover(pdfDestination, bookFolder);

      const pages = createPdfPages(pdfInfo.pageCount, 'assets/source.pdf');

      const book = {
        version: '1.0',
        id: bookId,
        title,
        sourcePdf: 'assets/source.pdf',
        cover,
        pages,
        createdAt: now,
        updatedAt: now
      };
      await writeBookJson(bookFolder, book);
      const sizeBytes = await getDirectorySize(bookFolder);
      const item = await upsertRegistryItem(makeRegistryItem(book, bookFolder, sizeBytes));
      sendBookProgress(null);
      return operationResult(item);
    } catch (error) {
      sendBookProgress(null);
      console.error('books:create-from-pdf error:', error);
      return operationError('CREATE_FAILED', error?.message || 'Could not create this book.');
    }
  });

  ipcMain.handle('books:replace-main-pdf', async (_event, input) => {
    const operationId = createId('create');
    try {
      const registryItem = await findBook(String(input?.bookId ?? ''));
      if (!registryItem) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      sendBookProgress(makeBookProgress(operationId, 'create', 'Choose student book PDF'));
      const selected = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Choose student book PDF',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        properties: ['openFile']
      });

      if (selected.canceled || !selected.filePaths?.[0]) {
        sendBookProgress(null);
        return operationError('CANCELLED');
      }

      const sourcePdf = selected.filePaths[0];
      sendBookProgress(makeBookProgress(operationId, 'create', 'Checking student book PDF'));
      const pdfInfo = await getPdfInfo(sourcePdf);
      if (pdfInfo.encrypted) {
        sendBookProgress(null);
        return operationError('PROTECTED_PDF', 'This PDF is protected. Please use an unlocked PDF.');
      }

      const sourceStat = await fsp.stat(sourcePdf);
      sendBookProgress(makeBookProgress(operationId, 'create', 'Checking disk space', 0, sourceStat.size));
      await ensureEnoughSpace(registryItem.folderPath, sourceStat.size);
      sendBookProgress(makeBookProgress(operationId, 'create', 'Waiting for confirmation', 0, sourceStat.size));
      if (!(await confirmBookFileOperation('Add student book PDF', sourceStat.size, registryItem.folderPath))) {
        sendBookProgress(null);
        return operationError('CANCELLED');
      }

      const now = new Date().toISOString();
      const book = await readBookJson(registryItem.folderPath);
      const relativePdfPath = 'assets/source.pdf';
      const destination = path.join(registryItem.folderPath, relativePdfPath);
      const operation = {
        operationId,
        type: 'create',
        phase: 'Copying student book PDF',
        transferredBytes: 0,
        totalBytes: sourceStat.size
      };
      sendBookProgress(operation);
      await copyFileWithProgress(sourcePdf, destination, operation);

      book.title = book.title && book.title !== 'Untitled Book'
        ? book.title
        : sanitizeName(path.basename(sourcePdf, path.extname(sourcePdf)), 'Student Book');
      book.sourcePdf = relativePdfPath;
      book.cover = await generateFirstPageCover(destination, registryItem.folderPath);
      book.pages = createPdfPages(pdfInfo.pageCount, relativePdfPath);
      book.workbookLinks = {};
      book.updatedAt = now;
      await validateBookData(book, registryItem.folderPath, book.title || 'Book');
      await writeBookJson(registryItem.folderPath, book);
      const sizeBytes = await getDirectorySize(registryItem.folderPath);
      await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
      sendBookProgress(null);
      return operationResult(book);
    } catch (error) {
      sendBookProgress(null);
      console.error('books:replace-main-pdf error:', error);
      return operationError('PDF_REPLACE_FAILED', error?.message || 'Could not add this student book PDF.');
    }
  });

  ipcMain.handle('books:add-workbook-from-pdf', async (_event, input) => {
    const operationId = createId('create');
    try {
      const registryItem = await findBook(String(input?.bookId ?? ''));
      if (!registryItem) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      sendBookProgress(makeBookProgress(operationId, 'create', 'Choose workbook PDF'));
      const selected = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Choose workbook PDF',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        properties: ['openFile']
      });

      if (selected.canceled || !selected.filePaths?.[0]) {
        sendBookProgress(null);
        return operationError('CANCELLED');
      }

      const sourcePdf = selected.filePaths[0];
      sendBookProgress(makeBookProgress(operationId, 'create', 'Checking workbook PDF'));
      const pdfInfo = await getPdfInfo(sourcePdf);
      if (pdfInfo.encrypted) {
        sendBookProgress(null);
        return operationError('PROTECTED_PDF', 'This PDF is protected. Please use an unlocked PDF.');
      }

      const sourceStat = await fsp.stat(sourcePdf);
      sendBookProgress(makeBookProgress(operationId, 'create', 'Checking disk space', 0, sourceStat.size));
      await ensureEnoughSpace(registryItem.folderPath, sourceStat.size);
      sendBookProgress(makeBookProgress(operationId, 'create', 'Waiting for confirmation', 0, sourceStat.size));
      if (!(await confirmBookFileOperation('Add workbook PDF', sourceStat.size, registryItem.folderPath))) {
        sendBookProgress(null);
        return operationError('CANCELLED');
      }

      const now = new Date().toISOString();
      const book = await readBookJson(registryItem.folderPath);
      const workbookId = createId('workbook');
      const title = sanitizeName(path.basename(sourcePdf, path.extname(sourcePdf)), 'Workbook');
      const relativePdfPath = path.posix.join('assets', 'workbooks', workbookId, 'source.pdf');
      const destination = path.join(registryItem.folderPath, relativePdfPath);
      const operation = {
        operationId,
        type: 'create',
        phase: 'Copying workbook PDF',
        transferredBytes: 0,
        totalBytes: sourceStat.size
      };
      sendBookProgress(operation);
      await copyFileWithProgress(sourcePdf, destination, operation);

      const workbook = {
        id: workbookId,
        title,
        sourcePdf: relativePdfPath,
        pages: createPdfPages(pdfInfo.pageCount, relativePdfPath, 'workbook-page'),
        createdAt: now,
        updatedAt: now
      };

      book.workbooks = Array.isArray(book.workbooks) ? book.workbooks : [];
      book.workbooks.push(workbook);
      book.workbookLinks = book.workbookLinks && typeof book.workbookLinks === 'object' ? book.workbookLinks : {};
      book.updatedAt = now;
      await validateBookData(book, registryItem.folderPath, book.title || 'Book');
      await writeBookJson(registryItem.folderPath, book);
      const sizeBytes = await getDirectorySize(registryItem.folderPath);
      await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
      sendBookProgress(null);
      return operationResult(book);
    } catch (error) {
      sendBookProgress(null);
      console.error('books:add-workbook-from-pdf error:', error);
      return operationError('WORKBOOK_CREATE_FAILED', error?.message || 'Could not add this workbook.');
    }
  });

  ipcMain.handle('books:replace-workbook-pdf', async (_event, input) => {
    const operationId = createId('create');
    try {
      const registryItem = await findBook(String(input?.bookId ?? ''));
      if (!registryItem) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      sendBookProgress(makeBookProgress(operationId, 'create', 'Choose workbook PDF'));
      const selected = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Choose workbook PDF',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        properties: ['openFile']
      });

      if (selected.canceled || !selected.filePaths?.[0]) {
        sendBookProgress(null);
        return operationError('CANCELLED');
      }

      const sourcePdf = selected.filePaths[0];
      sendBookProgress(makeBookProgress(operationId, 'create', 'Checking workbook PDF'));
      const pdfInfo = await getPdfInfo(sourcePdf);
      if (pdfInfo.encrypted) {
        sendBookProgress(null);
        return operationError('PROTECTED_PDF', 'This PDF is protected. Please use an unlocked PDF.');
      }

      const sourceStat = await fsp.stat(sourcePdf);
      sendBookProgress(makeBookProgress(operationId, 'create', 'Checking disk space', 0, sourceStat.size));
      await ensureEnoughSpace(registryItem.folderPath, sourceStat.size);
      sendBookProgress(makeBookProgress(operationId, 'create', 'Waiting for confirmation', 0, sourceStat.size));
      if (!(await confirmBookFileOperation('Replace workbook PDF', sourceStat.size, registryItem.folderPath))) {
        sendBookProgress(null);
        return operationError('CANCELLED');
      }

      const now = new Date().toISOString();
      const book = await readBookJson(registryItem.folderPath);
      book.workbooks = Array.isArray(book.workbooks) ? book.workbooks : [];
      let workbook = book.workbooks.find((item) => item.id === String(input?.workbookId ?? ''));
      if (!workbook) {
        workbook = {
          id: createId('workbook'),
          title: 'Workbook',
          createdAt: now,
          updatedAt: now,
          pages: []
        };
        book.workbooks = [workbook, ...book.workbooks];
      }

      const relativePdfPath = path.posix.join('assets', 'workbooks', workbook.id, 'source.pdf');
      const destination = path.join(registryItem.folderPath, relativePdfPath);
      const operation = {
        operationId,
        type: 'create',
        phase: 'Copying workbook PDF',
        transferredBytes: 0,
        totalBytes: sourceStat.size
      };
      sendBookProgress(operation);
      await copyFileWithProgress(sourcePdf, destination, operation);

      workbook.title = sanitizeName(path.basename(sourcePdf, path.extname(sourcePdf)), 'Workbook');
      workbook.sourcePdf = relativePdfPath;
      workbook.pages = createPdfPages(pdfInfo.pageCount, relativePdfPath, 'workbook-page');
      workbook.updatedAt = now;
      book.workbookLinks = {};
      book.updatedAt = now;
      await validateBookData(book, registryItem.folderPath, book.title || 'Book');
      await writeBookJson(registryItem.folderPath, book);
      const sizeBytes = await getDirectorySize(registryItem.folderPath);
      await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
      sendBookProgress(null);
      return operationResult(book);
    } catch (error) {
      sendBookProgress(null);
      console.error('books:replace-workbook-pdf error:', error);
      return operationError('WORKBOOK_REPLACE_FAILED', error?.message || 'Could not replace this workbook PDF.');
    }
  });
}

module.exports = { registerBookCreateIpc };
