const router = require('express').Router();
const db = require('../db');

router.post('/stripe', async (req, res) => {
  res.json({ received: true });
});

module.exports = router;