module.exports = {
  name: 'ai',
  run(input = {}) {
    const items = Array.isArray(input.items) ? input.items : [];
    return {
      feature: 'ai',
      itemCount: items.length,
      suggestions: items.slice(0, 10).map((item, index) => ({
        index,
        prompt: `Review "${String(item.text ?? '').slice(0, 80)}" for classroom practice.`
      }))
    };
  }
};
