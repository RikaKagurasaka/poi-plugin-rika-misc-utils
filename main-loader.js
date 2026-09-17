'use strict'

// This small entry stays cached in the main process. The implementation must not:
// poi's plugin reload clears only the renderer's require cache.
exports.loadShortcuts = () => {
  const filename = require.resolve('./shortcuts')
  delete require.cache[filename]
  return require(filename)
}
