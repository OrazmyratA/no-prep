const { registerBookCreateIpc } = require('./book-create-ipc');
const { registerBookTransferIpc } = require('./book-transfer-ipc');
const { registerBookLibraryActionsIpc } = require('./book-library-actions-ipc');

function registerBookManagementIpc(deps) {
  registerBookCreateIpc(deps);
  registerBookTransferIpc(deps);
  registerBookLibraryActionsIpc(deps);
}

module.exports = { registerBookManagementIpc };
