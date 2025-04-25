// Arquivo: utils/dateUtils.js
exports.splitDateRange = function* (start, end, deltaDays = 30) {
  let current = new Date(start);
  const until = new Date(end);

  while (current < until) {
    const next = new Date(Math.min(new Date(current).setDate(current.getDate() + deltaDays), until));
    yield [current.toISOString().split('T')[0], next.toISOString().split('T')[0]];
    current = new Date(next);
  }
};

exports.formatDate = (date) => new Date(date).toISOString().split('T')[0];
