function registerBookDataIpc({
  ipcMain,
  dialog,
  fsp,
  path,
  pathToFileURL,
  getMainWindow,
  readRegistry,
  writeRegistry,
  repairBookRegistryItems,
  findBook,
  validateBookFolder,
  readBookJson,
  validateBookData,
  writeBookJson,
  readBookAnnotations,
  writeBookAnnotations,
  pruneUnusedBookAssets,
  getDirectorySize,
  getCachedSizeBytes,
  hasRemovedBookAssetReferences,
  upsertRegistryItem,
  makeRegistryItem,
  copyFile,
  pathExists,
  updateRegistrySizeByDelta,
  sanitizeName,
  decodeBase64DataUrl,
  extensionForMimeType,
  encodeBookAssetUrl,
  resolveBookAssetPath,
  operationResult,
  operationError,
  constants
}) {
  ipcMain.handle('books:get-registry', async () => {
    try {
      const registry = await readRegistry();
      const repaired = await repairBookRegistryItems(registry);
      if (repaired.changed) {
        await writeRegistry(repaired.items);
      }
      return operationResult(repaired.items);
    } catch (error) {
      console.error('books:get-registry error:', error);
      return operationError('REGISTRY_ERROR', 'Could not load books.');
    }
  });

  ipcMain.handle('books:read', async (_event, input) => {
    try {
      const book = await findBook(String(input?.bookId ?? ''));
      if (!book) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }
      await validateBookFolder(book.folderPath, { label: book.title || 'Book' });
      return operationResult(await readBookJson(book.folderPath));
    } catch (error) {
      console.error('books:read error:', error);
      return operationError('READ_FAILED', 'Could not read this book.');
    }
  });

  ipcMain.handle('books:read-annotations', async (_event, input) => {
    try {
      const book = await findBook(String(input?.bookId ?? ''));
      if (!book) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      return operationResult(await readBookAnnotations(book.folderPath, book.id));
    } catch (error) {
      console.error('books:read-annotations error:', error);
      return operationError('READ_ANNOTATIONS_FAILED', 'Could not read reader annotations.');
    }
  });

  ipcMain.handle('books:save', async (_event, input) => {
    try {
      const registryItem = await findBook(String(input?.bookId ?? ''));
      if (!registryItem) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      const current = await readBookJson(registryItem.folderPath);
      const nextBook = input?.book;
      if (!nextBook || typeof nextBook !== 'object' || !Array.isArray(nextBook.pages)) {
        return operationError('INVALID_BOOK', 'Book data is not valid.');
      }

      const now = new Date().toISOString();
      const book = {
        ...nextBook,
        id: current.id,
        version: current.version || '1.0',
        createdAt: current.createdAt || now,
        updatedAt: now
      };
      await validateBookData(book, registryItem.folderPath, book.title || 'Book');
      await writeBookJson(registryItem.folderPath, book);
      let sizeBytes = getCachedSizeBytes(registryItem);
      if (hasRemovedBookAssetReferences(current, book)) {
        await pruneUnusedBookAssets(book, registryItem.folderPath);
        sizeBytes = await getDirectorySize(registryItem.folderPath);
      }
      if (sizeBytes === null) {
        sizeBytes = await getDirectorySize(registryItem.folderPath);
      }
      const item = await upsertRegistryItem(makeRegistryItem(book, registryItem.folderPath, sizeBytes));
      return operationResult(item);
    } catch (error) {
      console.error('books:save error:', error);
      return operationError('SAVE_FAILED', 'Could not save this book.');
    }
  });

  ipcMain.handle('books:save-annotations', async (_event, input) => {
    try {
      const book = await findBook(String(input?.bookId ?? ''));
      if (!book) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      const annotations = input?.annotations;
      if (!annotations || typeof annotations !== 'object') {
        return operationError('INVALID_ANNOTATIONS', 'Reader annotations are not valid.');
      }

      await writeBookAnnotations(book.folderPath, annotations, book.id);
      return operationResult();
    } catch (error) {
      console.error('books:save-annotations error:', error);
      return operationError('SAVE_ANNOTATIONS_FAILED', 'Could not save reader annotations.');
    }
  });

  ipcMain.handle('books:add-asset', async (_event, input) => {
    try {
      const registryItem = await findBook(String(input?.bookId ?? ''));
      if (!registryItem) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      const kind = String(input?.kind || 'files').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'files';
      const filters = Array.isArray(input?.filters) ? input.filters : [];
      const selected = await dialog.showOpenDialog(getMainWindow(), {
        title: `Choose ${kind} file`,
        filters,
        properties: ['openFile']
      });

      if (selected.canceled || !selected.filePaths?.[0]) {
        return operationError('CANCELLED');
      }

      const sourcePath = selected.filePaths[0];
      const ext = path.extname(sourcePath);
      const safeBaseName = sanitizeName(path.basename(sourcePath, ext), 'asset');
      const fileName = `${safeBaseName}-${Date.now()}${ext}`;
      const relativePath = path.posix.join('assets', kind, fileName);
      const destination = path.join(registryItem.folderPath, 'assets', kind, fileName);
      await copyFile(sourcePath, destination);
      const stat = await fsp.stat(destination);
      await updateRegistrySizeByDelta(registryItem, stat.size);

      return operationResult({
        relativePath,
        fileName: path.basename(sourcePath),
        assetUrl: encodeBookAssetUrl(registryItem.id, relativePath)
      });
    } catch (error) {
      console.error('books:add-asset error:', error);
      return operationError('ASSET_FAILED', error?.message || 'Could not add this asset.');
    }
  });

  ipcMain.handle('books:save-asset-data', async (_event, input) => {
    try {
      const registryItem = await findBook(String(input?.bookId ?? ''));
      if (!registryItem) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      const kind = String(input?.kind || 'images').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'images';
      if (kind !== 'images') {
        return operationError('INVALID_ASSET_KIND', 'This asset type is not supported here.');
      }

      const decoded = decodeBase64DataUrl(input?.dataUrl, {
        allowedMime: (mimeType) => mimeType.startsWith('image/'),
        maxBytes: constants.MAX_INLINE_IMAGE_BYTES,
        invalidCode: 'INVALID_ASSET_DATA',
        invalidMessage: 'Image data is not valid.',
        tooLargeMessage: 'Image data is too large.'
      });
      if (!decoded.ok) {
        return decoded.error;
      }

      const ext = extensionForMimeType(decoded.mimeType, '.png');
      const requestedName = String(input?.fileName || 'image');
      const safeBaseName = sanitizeName(path.basename(requestedName, path.extname(requestedName)), 'image');
      const fileName = `${safeBaseName}-${Date.now()}${ext}`;
      const relativePath = path.posix.join('assets', kind, fileName);
      const destination = path.join(registryItem.folderPath, 'assets', kind, fileName);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(destination, decoded.buffer);
      await updateRegistrySizeByDelta(registryItem, decoded.buffer.length);

      return operationResult({
        relativePath,
        fileName,
        assetUrl: encodeBookAssetUrl(registryItem.id, relativePath)
      });
    } catch (error) {
      console.error('books:save-asset-data error:', error);
      return operationError('ASSET_SAVE_FAILED', error?.message || 'Could not save this asset.');
    }
  });

  ipcMain.handle('books:save-audio-recording', async (_event, input) => {
    try {
      const registryItem = await findBook(String(input?.bookId ?? ''));
      if (!registryItem) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      const decoded = decodeBase64DataUrl(input?.dataUrl, {
        allowedMime: (mimeType) => mimeType.startsWith('audio/') || mimeType === 'application/octet-stream',
        maxBytes: constants.MAX_AUDIO_RECORDING_BYTES,
        invalidCode: 'INVALID_AUDIO',
        invalidMessage: 'Recorded audio is not valid.',
        tooLargeMessage: 'Recorded audio is too large.'
      });
      if (!decoded.ok) {
        return decoded.error;
      }

      const ext = extensionForMimeType(decoded.mimeType, '.wav');
      const fileName = `voice-${Date.now()}${ext}`;
      const relativePath = path.posix.join('assets', 'audio', fileName);
      const destination = path.join(registryItem.folderPath, 'assets', 'audio', fileName);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(destination, decoded.buffer);
      await updateRegistrySizeByDelta(registryItem, decoded.buffer.length);

      return operationResult({
        relativePath,
        fileName,
        assetUrl: encodeBookAssetUrl(registryItem.id, relativePath)
      });
    } catch (error) {
      console.error('books:save-audio-recording error:', error);
      return operationError('RECORDING_FAILED', error?.message || 'Could not save this recording.');
    }
  });

  ipcMain.handle('books:save-topic-snapshot', async (_event, input) => {
    try {
      const registryItem = await findBook(String(input?.bookId ?? ''));
      if (!registryItem) {
        return operationError('BOOK_NOT_FOUND', 'Book not found.');
      }

      const snapshot = input?.snapshot;
      if (!snapshot || typeof snapshot !== 'object') {
        return operationError('INVALID_TOPIC_SNAPSHOT', 'Topic snapshot is not valid.');
      }

      const topicName = sanitizeName(
        String(input?.topicName || snapshot?.topic?.name || input?.elementId || 'Game Topic'),
        'Game Topic'
      );
      const relativePath = path.posix.join('assets', 'games', `${topicName}.json`);
      const destination = path.join(registryItem.folderPath, 'assets', 'games', `${topicName}.json`);
      const previousSize = await pathExists(destination)
        ? (await fsp.stat(destination)).size
        : 0;
      const content = JSON.stringify(snapshot, null, 2);
      const contentBytes = Buffer.byteLength(content, 'utf8');
      if (contentBytes > constants.MAX_TOPIC_SNAPSHOT_BYTES) {
        return operationError('TOPIC_SNAPSHOT_TOO_LARGE', 'This topic is too large to save inside the book.');
      }
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.writeFile(destination, content, 'utf8');
      await updateRegistrySizeByDelta(registryItem, contentBytes - previousSize);

      return operationResult({
        relativePath,
        assetUrl: encodeBookAssetUrl(registryItem.id, relativePath)
      });
    } catch (error) {
      console.error('books:save-topic-snapshot error:', error);
      return operationError('TOPIC_SNAPSHOT_FAILED', error?.message || 'Could not save this topic inside the book.');
    }
  });

  ipcMain.on('books:get-asset-url', (event, bookId, relativePath) => {
    try {
      event.returnValue = resolveBookAssetPath(bookId, relativePath)
        ? encodeBookAssetUrl(bookId, relativePath)
        : '';
    } catch {
      event.returnValue = '';
    }
  });

  ipcMain.on('books:get-asset-file-url', (event, bookId, relativePath) => {
    try {
      const resolved = resolveBookAssetPath(bookId, relativePath);
      event.returnValue = resolved ? pathToFileURL(resolved).toString() : '';
    } catch {
      event.returnValue = '';
    }
  });

  ipcMain.handle('books:get-asset-bytes', async (_event, bookId, relativePath) => {
    try {
      const resolved = resolveBookAssetPath(String(bookId ?? ''), String(relativePath ?? ''));
      if (!resolved) {
        return operationError('ASSET_NOT_FOUND', 'Book asset not found.');
      }
      const bytes = await fsp.readFile(resolved);
      return operationResult({
        base64: bytes.toString('base64'),
        byteLength: bytes.length
      });
    } catch (error) {
      console.error('books:get-asset-bytes error:', error);
      return operationError('ASSET_BYTES_FAILED', error?.message || 'Could not read this book asset.');
    }
  });
}

module.exports = { registerBookDataIpc };
