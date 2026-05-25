module.exports = {
  name: 'editing',
  run(input = {}) {
    return {
      feature: 'editing',
      allowed: true,
      operation: input.operation ?? 'edit'
    };
  }
};
