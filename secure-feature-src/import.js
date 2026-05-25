module.exports = {
  name: 'import',
  run(input = {}) {
    return {
      feature: 'import',
      accepted: Boolean(input.payload),
      checkedAt: new Date().toISOString()
    };
  }
};
