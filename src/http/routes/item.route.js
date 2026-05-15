const express = require('express');
const router = express.Router();
const { requireAuth, requireAuthJson, requireAdmin } = require('../middleware/auth');
const { requireCsrfToken } = require('../middleware/csrf');
const itemController = require('../controllers/item.controller');
const {
  reportLimiter,
  threadMessageLimiter,
  threadPollLimiter,
  contactFlowLimiter,
} = require('../middleware/security');
const { reportImagesUpload, threadMessageUpload } = require('../middleware/upload');

router.get('/', itemController.browse);
router.get('/report', requireAuth, itemController.reportGet);
router.post(
  '/report',
  requireAuth,
  reportLimiter,
  (req, res, next) => {
    reportImagesUpload.array('photos', 8)(req, res, (err) => {
      if (err) {
        req.uploadError = err;
      }
      next();
    });
  },
  requireCsrfToken,
  itemController.reportPost
);
router.get('/:id/edit', requireAuth, requireAdmin, itemController.editGet);
router.post('/:id/edit', requireAuth, requireAdmin, itemController.editPost);
router.post('/:id/delete', requireAuth, requireAdmin, itemController.deletePost);
router.post('/:id/toggle-status', requireAuth, requireAdmin, itemController.toggleStatusPost);
router.post(
  '/:id/contact-request',
  requireAuth,
  contactFlowLimiter,
  itemController.createContactRequest
);
router.post(
  '/:id/contact-request/:requestId/approve',
  requireAuth,
  contactFlowLimiter,
  itemController.approveContactRequest
);
router.post(
  '/:id/contact-request/:requestId/reject',
  requireAuth,
  contactFlowLimiter,
  itemController.rejectContactRequest
);
router.post(
  '/:id/contact-request/:requestId/cancel',
  requireAuth,
  contactFlowLimiter,
  itemController.cancelContactRequest
);
router.get(
  '/:id/contact/:requestId/bootstrap',
  requireAuthJson,
  itemController.contactThreadBootstrapGet
);
router.get(
  '/:id/contact/:requestId/poll',
  requireAuthJson,
  threadPollLimiter,
  itemController.contactThreadPollGet
);
router.get('/:id/contact/:requestId', requireAuth, itemController.contactThreadGet);
router.post(
  '/:id/contact/:requestId/message',
  requireAuth,
  threadMessageLimiter,
  (req, res, next) => {
    threadMessageUpload.single('attachment')(req, res, (err) => {
      if (err) {
        req.uploadError = err;
      }
      next();
    });
  },
  requireCsrfToken,
  itemController.contactThreadMessagePost
);
router.post(
  '/:id/contact/:requestId/close',
  requireAuth,
  contactFlowLimiter,
  itemController.contactThreadClosePost
);
router.post(
  '/:id/contact/:requestId/reopen',
  requireAuth,
  contactFlowLimiter,
  itemController.contactThreadReopenPost
);
router.post(
  '/:id/claim-as-owner',
  requireAuth,
  contactFlowLimiter,
  itemController.claimAsOwnerPost
);
router.get('/:id', itemController.detail);

module.exports = router;
