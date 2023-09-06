const { join } = require('path');

module.exports = {
  browsers: {
    chromium: {
      channel: 'chrome',
      executablePath: join(__dirname, '.local-chromium', 'chrome-linux', 'chrome'),
    },
  },
};
