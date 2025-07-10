const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is Alive');
});

function keepAlive() {
  app.listen(3000, () => {
    console.log('✅ KeepAlive server running on port 3000');
  });
}

module.exports = keepAlive;
