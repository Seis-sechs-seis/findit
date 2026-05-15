const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const {
  authLimiter,
  registerLimiter,
  otpLimiter,
  resetRequestLimiter,
  resetConfirmLimiter,
} = require('../middleware/security');

router.get('/login', authController.showLogin);
router.post('/login', authLimiter, authController.postLogin);
router.get('/register', authController.showRegister);
router.post('/register', authLimiter, registerLimiter, authController.postRegister);
router.get('/verify-email', authController.showVerifyEmail);
router.post('/verify-email', otpLimiter, authController.postVerifyEmail);
router.post('/verify-email/resend', otpLimiter, authController.postResendOtp);
router.get('/forgot-password', authController.showForgotPassword);
router.post('/forgot-password', resetRequestLimiter, authController.postForgotPassword);
router.get('/reset-password/:token', authController.showResetPassword);
router.post('/reset-password/:token', resetConfirmLimiter, authController.postResetPassword);
router.post('/logout', authController.postLogout);

module.exports = router;
