function registerBookTransferIpc({
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
  ipcMain.handle('books:import-folder', async () => {
    const operationId = createId('import');
    try {
      const selected = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Import Book Folder',
        properties: ['openDirectory']
      });

      if (selected.canceled || !selected.filePaths?.[0]) {
        return operationError('CANCELLED');
      }

      const sourceFolder = selected.filePaths[0];
      await validateBookFolder(sourceFolder, { label: 'Selected folder' });

      const bookId = createId('book');
      const destinationFolder = path.join(getBooksRoot(), bookId);
      const totalBytes = await getDirectorySize(sourceFolder);
      await ensureEnoughSpace(destinationFolder, totalBytes);
      if (!(await confirmBookFileOperation('Import book', totalBytes, destinationFolder))) {
        return operationError('CANCELLED');
      }

      const operation = {
        operationId,
        type: 'import',
        phase: 'Copying book',
        transferredBytes: 0,
        totalBytes
      };
      sendBookProgress(operation);
      await copyDirectoryWithProgress(sourceFolder, destinationFolder, operation);

      const now = new Date().toISOString();
      const book = await readBookJson(destinationFolder);
      book.id = bookId;
      book.title = book.title || sanitizeName(path.basename(sourceFolder), 'Imported Book');
      book.createdAt = book.createdAt || now;
      book.updatedAt = now;
      if (!book.cover && book.sourcePdf && await pathExists(path.join(destinationFolder, book.sourcePdf))) {
        book.cover = await generateFirstPageCover(path.join(destinationFolder, book.sourcePdf), destinationFolder);
      }
      await writeBookJson(destinationFolder, book);

      const sizeBytes = await getDirectorySize(destinationFolder);
      const item = await upsertRegistryItem(makeRegistryItem(book, destinationFolder, sizeBytes));
      sendBookProgress(null);
      return operationResult(item);
    } catch (error) {
      sendBookProgress(null);
      console.error('books:import-folder error:', error);
      return operationError('IMPORT_FAILED', error?.message || 'Could not import this book.');
    }
  });

  ipcMain.handle('books:import-smart', async () => {
    const operationId = createId('smart-import');
    let tempFolder = '';
    try {
      const selected = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Import No-Prep Content',
        filters: [
          { name: 'No-Prep Books', extensions: ['noprepbook', 'zip', 'json'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (selected.canceled || !selected.filePaths?.[0]) {
        return operationError('CANCELLED');
      }

      const selectedPath = selected.filePaths[0];
      const selectedStat = await fsp.stat(selectedPath);
      const selectedExtension = path.extname(selectedPath).toLowerCase();
      const sourcePath = selectedExtension === '.json' && path.basename(selectedPath).toLowerCase() === constants.BOOK_JSON_FILE
        ? path.dirname(selectedPath)
        : selectedPath;
      const sourceStat = selectedExtension === '.json' && path.basename(selectedPath).toLowerCase() === constants.BOOK_JSON_FILE
        ? await fsp.stat(sourcePath)
        : selectedStat;

      if (sourceStat.isDirectory()) {
        await validateBookFolder(sourcePath, { label: 'Selected folder' });

        const bookId = createId('book');
        const destinationFolder = path.join(getBooksRoot(), bookId);
        const totalBytes = await getDirectorySize(sourcePath);
        await ensureEnoughSpace(destinationFolder, totalBytes);
        if (!(await confirmBookFileOperation('Import book', totalBytes, destinationFolder))) {
          return operationError('CANCELLED');
        }

        const operation = {
          operationId,
          type: 'import',
          phase: 'Copying book',
          transferredBytes: 0,
          totalBytes
        };
        sendBookProgress(operation);
        await copyDirectoryWithProgress(sourcePath, destinationFolder, operation);

        const now = new Date().toISOString();
        const book = await readBookJson(destinationFolder);
        book.id = bookId;
        book.title = book.title || sanitizeName(path.basename(sourcePath), 'Imported Book');
        book.createdAt = book.createdAt || now;
        book.updatedAt = now;
        if (!book.cover && book.sourcePdf && await pathExists(path.join(destinationFolder, book.sourcePdf))) {
          book.cover = await generateFirstPageCover(path.join(destinationFolder, book.sourcePdf), destinationFolder);
        }
        await writeBookJson(destinationFolder, book);

        const sizeBytes = await getDirectorySize(destinationFolder);
        const item = await upsertRegistryItem(makeRegistryItem(book, destinationFolder, sizeBytes));
        sendBookProgress(null);
        return operationResult(item);
      }

      const extension = path.extname(sourcePath).toLowerCase();
      if (extension !== constants.BOOK_PACKAGE_EXTENSION && extension !== '.zip') {
        return operationError('UNSUPPORTED_IMPORT', 'Choose a book folder, .noprepbook, or .zip package.');
      }

      const packageStat = sourceStat;
      const packageContentBytes = await getZipUncompressedSize(sourcePath);
      const totalBytes = Math.max(packageStat.size, packageContentBytes);
      const bookId = createId('book');
      tempFolder = path.join(getBooksRoot(), `${bookId}-importing`);
      const destinationFolder = path.join(getBooksRoot(), bookId);

      await ensureEnoughSpace(destinationFolder, totalBytes);
      if (!(await confirmBookFileOperation('Import book package', totalBytes, destinationFolder))) {
        return operationError('CANCELLED');
      }

      const operation = {
        operationId,
        type: 'import',
        phase: 'Extracting book package',
        transferredBytes: 0,
        totalBytes
      };
      sendBookProgress(operation);
      await extractZipPackage(sourcePath, tempFolder, operation);
      await validateBookFolder(tempFolder, { label: 'Imported package' });

      const now = new Date().toISOString();
      const book = await readBookJson(tempFolder);
      book.id = bookId;
      book.title = book.title || sanitizeName(path.basename(sourcePath, path.extname(sourcePath)), 'Imported Book');
      book.createdAt = book.createdAt || now;
      book.updatedAt = now;
      if (!book.cover && book.sourcePdf && await pathExists(path.join(tempFolder, book.sourcePdf))) {
        book.cover = await generateFirstPageCover(path.join(tempFolder, book.sourcePdf), tempFolder);
      }
      await writeBookJson(tempFolder, book);

      if (await pathExists(destinationFolder)) {
        await fsp.rm(destinationFolder, { recursive: true, force: true });
      }
      await fsp.rename(tempFolder, destinationFolder);
      tempFolder = '';

      const sizeBytes = await getDirectorySize(destinationFolder);
      const item = await upsertRegistryItem(makeRegistryItem(book, destinationFolder, sizeBytes));
      sendBookProgress(null);
      return operationResult(item);
    } catch (error) {
      sendBookProgress(null);
      if (tempFolder) {
        await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
      }
      console.error('books:import-smart error:', error);
      return operationError('IMPORT_FAILED', error?.message || 'Could not import this book.');
    }
  });

  ipcMain.handle('books:export-to-desktop', async (_event, input) => {
    const operationId = createId('export');
    try {
      const book = await findBook(String(input?.bookId ?? ''));
      if (!book) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }
      const validated = await validateBookFolder(book.folderPath, { label: book.title || 'Book' });
      await pruneUnusedBookAssets(validated.book, book.folderPath);
      await writeBookJson(book.folderPath, validated.book);

      const desktopRoot = path.join(app.getPath('desktop'), 'No-Prep Books');
      await fsp.mkdir(desktopRoot, { recursive: true });
      const baseName = sanitizeName(book.title, 'Book');
      let destination = path.join(desktopRoot, baseName);
      let copyIndex = 1;
      while (await pathExists(destination)) {
        copyIndex++;
        destination = path.join(desktopRoot, `${baseName} (Copy ${copyIndex})`);
      }

      const totalBytes = await getDirectorySize(book.folderPath);
      await ensureEnoughSpace(destination, totalBytes);
      if (!(await confirmBookFileOperation('Export book to Desktop', totalBytes, destination))) {
        return operationError('CANCELLED');
      }
      const operation = {
        operationId,
        type: 'export',
        phase: 'Copying to Desktop',
        transferredBytes: 0,
        totalBytes
      };
      sendBookProgress(operation);
      await copyDirectoryWithProgress(book.folderPath, destination, operation);
      sendBookProgress(null);
      return operationResult({ destination });
    } catch (error) {
      sendBookProgress(null);
      console.error('books:export-to-desktop error:', error);
      return operationError('EXPORT_FAILED', error?.message || 'Could not export this book.');
    }
  });

  ipcMain.handle('books:export-package-to-desktop', async (_event, input) => {
    const operationId = createId('package-export');
    try {
      const book = await findBook(String(input?.bookId ?? ''));
      if (!book) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }
      const validated = await validateBookFolder(book.folderPath, { label: book.title || 'Book' });
      await pruneUnusedBookAssets(validated.book, book.folderPath);
      await writeBookJson(book.folderPath, validated.book);

      const desktopRoot = path.join(app.getPath('desktop'), 'No-Prep Books');
      await fsp.mkdir(desktopRoot, { recursive: true });
      const baseName = sanitizeName(book.title, 'Book');
      let destination = path.join(desktopRoot, `${baseName}${constants.BOOK_PACKAGE_EXTENSION}`);
      let copyIndex = 1;
      while (await pathExists(destination)) {
        copyIndex++;
        destination = path.join(desktopRoot, `${baseName} (Package ${copyIndex})${constants.BOOK_PACKAGE_EXTENSION}`);
      }

      const totalBytes = await getDirectorySize(book.folderPath);
      await ensureEnoughSpace(destination, totalBytes + 64 * 1024 * 1024);
      if (!(await confirmBookFileOperation('Export book package', totalBytes, destination))) {
        return operationError('CANCELLED');
      }

      const operation = {
        operationId,
        type: 'export',
        phase: 'Creating book package',
        transferredBytes: 0,
        totalBytes
      };
      sendBookProgress(operation);
      await createZipPackageWithProgress(book.folderPath, destination, operation);
      sendBookProgress(null);
      return operationResult({ destination });
    } catch (error) {
      sendBookProgress(null);
      console.error('books:export-package-to-desktop error:', error);
      return operationError('PACKAGE_EXPORT_FAILED', error?.message || 'Could not export this book package.');
    }
  });

  ipcMain.handle('books:import-package', async () => {
    const operationId = createId('package-import');
    let tempFolder = '';
    try {
      const selected = await dialog.showOpenDialog(getMainWindow(), {
        title: 'Import Book Package',
        filters: [
          { name: 'No-Prep Book Packages', extensions: ['noprepbook', 'zip'] }
        ],
        properties: ['openFile']
      });

      if (selected.canceled || !selected.filePaths?.[0]) {
        return operationError('CANCELLED');
      }

      const packagePath = selected.filePaths[0];
      const packageStat = await fsp.stat(packagePath);
      const packageContentBytes = await getZipUncompressedSize(packagePath);
      const totalBytes = Math.max(packageStat.size, packageContentBytes);
      const bookId = createId('book');
      tempFolder = path.join(getBooksRoot(), `${bookId}-importing`);
      const destinationFolder = path.join(getBooksRoot(), bookId);

      await ensureEnoughSpace(destinationFolder, totalBytes);
      if (!(await confirmBookFileOperation('Import book package', totalBytes, destinationFolder))) {
        return operationError('CANCELLED');
      }

      const operation = {
        operationId,
        type: 'import',
        phase: 'Extracting book package',
        transferredBytes: 0,
        totalBytes
      };
      sendBookProgress(operation);
      await extractZipPackage(packagePath, tempFolder, operation);
      await validateBookFolder(tempFolder, { label: 'Imported package' });

      const now = new Date().toISOString();
      const book = await readBookJson(tempFolder);
      book.id = bookId;
      book.title = book.title || sanitizeName(path.basename(packagePath, path.extname(packagePath)), 'Imported Book');
      book.createdAt = book.createdAt || now;
      book.updatedAt = now;
      if (!book.cover && book.sourcePdf && await pathExists(path.join(tempFolder, book.sourcePdf))) {
        book.cover = await generateFirstPageCover(path.join(tempFolder, book.sourcePdf), tempFolder);
      }
      await writeBookJson(tempFolder, book);

      if (await pathExists(destinationFolder)) {
        await fsp.rm(destinationFolder, { recursive: true, force: true });
      }
      await fsp.rename(tempFolder, destinationFolder);
      tempFolder = '';

      const sizeBytes = await getDirectorySize(destinationFolder);
      const item = await upsertRegistryItem(makeRegistryItem(book, destinationFolder, sizeBytes));
      sendBookProgress(null);
      return operationResult(item);
    } catch (error) {
      sendBookProgress(null);
      if (tempFolder) {
        await fsp.rm(tempFolder, { recursive: true, force: true }).catch(() => {});
      }
      console.error('books:import-package error:', error);
      return operationError('PACKAGE_IMPORT_FAILED', error?.message || 'Could not import this book package.');
    }
  });
}

module.exports = { registerBookTransferIpc };
