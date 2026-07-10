function registerBookStorageIpc({
  ipcMain,
  bookStorage,
  operationResult,
  operationError
}) {
  ipcMain.handle('books:get-storage-location', async () => {
    try {
      return operationResult(await bookStorage.getStorageInfo());
    } catch (error) {
      return operationError('UNKNOWN', error?.message || 'Could not read book storage location.');
    }
  });

  ipcMain.handle('books:choose-storage-location', async () => {
    return bookStorage.chooseStorageLocation();
  });

  ipcMain.handle('books:use-default-storage-location', async () => {
    return bookStorage.useDefaultStorageLocation();
  });

  ipcMain.handle('books:open-storage-location', async () => {
    return bookStorage.openStorageLocation();
  });
}

module.exports = {
  registerBookStorageIpc
};
