const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireCsrfToken } = require('../middleware/csrf');
const { avatarUpload } = require('../middleware/upload');
const { authLimiter } = require('../middleware/security');
const pageController = require('../controllers/page.controller');

router.get('/', pageController.home);
router.get('/terms', pageController.terms);
router.get('/privacy', pageController.privacy);
router.get('/dashboard', requireAuth, pageController.dashboard);
router.get('/requests', requireAuth, pageController.requestsInbox);
router.get('/report', requireAuth, pageController.reportHub);
router.get('/settings', requireAuth, pageController.settings);
router.post(
  '/settings',
  requireAuth,
  authLimiter,
  (req, res, next) => {
    avatarUpload.single('profileImage')(req, res, (err) => {
      if (err) {
        req.uploadError = err;
      }
      return next();
    });
  },
  requireCsrfToken,
  pageController.postSettings
);

module.exports = router;
