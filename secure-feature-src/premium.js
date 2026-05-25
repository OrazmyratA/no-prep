module.exports = {
  name: 'premium',
  run(input = {}) {
    return {
      feature: 'premium',
      topicManagement: true,
      action: input.action ?? 'manage-topic'
    };
  }
};
