'use strict';

const express = require('express');
const oauthController = require('../controllers/oauth.controller');
const { oauthStartLimiter } = require('../middleware/security');

const router = express.Router();

router.get('/:provider/start', oauthStartLimiter, oauthController.start);
router.get('/:provider/callback', oauthController.callback);

module.exports = router;
