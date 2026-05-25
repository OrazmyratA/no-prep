module.exports = {
  name: 'export',
  run(input = {}) {
    return {
      feature: 'export',
      preparedAt: new Date().toISOString(),
      payload: input.payload ?? null
    };
  }
};
