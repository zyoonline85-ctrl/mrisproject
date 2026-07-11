const { AsyncLocalStorage } = require("node:async_hooks");

const storage = new AsyncLocalStorage();

function runActivityRequest(action) {
  return storage.run({ activityWritten: false }, action);
}

function markActivityWritten() {
  const context = storage.getStore();
  if (context) context.activityWritten = true;
}

function wasActivityWritten() {
  return storage.getStore()?.activityWritten === true;
}

module.exports = { markActivityWritten, runActivityRequest, wasActivityWritten };
