const express = require('express');

function keepAlive() {
  const app = express();
  app.get('/', (req, res) => {
    res.send('Bot is Alive');
  });

  const port = process.env.PORT || 5000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`âœ… Keepalive server running on port ${port}`);
  });
}

module.exports = keepAlive;
