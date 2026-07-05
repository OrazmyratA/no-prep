function operationResult(result) {
  return { ok: true, result };
}

function operationError(error, message) {
  return { ok: false, error, message };
}

module.exports = {
  operationResult,
  operationError
};
