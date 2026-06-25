import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthSession } from '../../hooks/index.js';
import { toast } from '../../utils/toast.js';
import { AuthPageSkeleton } from '../../components/ui/Skeletons/index.js';
import { AuthPageLayout } from '../../components/ui/Auth/AuthPageLayout.jsx';
import { apiFetch } from '../../api/client.js';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthSession();
  const [pageReady, setPageReady] = useState(false);
  const [email, setEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('request'); // 'request' or 'verify'
  const [error, setError] = useState('');
  const otpInputsRef = useRef([]);

  useEffect(() => {
    setPageReady(true);
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  async function handleSendOtp(event) {
    event.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      const payload = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() })
      });
      toast(payload.message || 'OTP sent to your email!');
      setStage('verify');
    } catch (err) {
      setError(err.message || err.payload?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    setError('');
    const fullOtp = otpDigits.join('');
    if (fullOtp.length !== 6) {
      setError('Please enter the full OTP');
      return;
    }
    if (!newPassword) {
      setError('Please enter a new password');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const payload = await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          otp: fullOtp,
          newPassword
        })
      });
      toast(payload.message || 'Password reset successfully!', 'success');
      navigate('/login');
    } catch (err) {
      setError(err.message || err.payload?.error || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  }

  if (!pageReady) {
    return <AuthPageSkeleton />;
  }

  return (
    <AuthPageLayout
      title="Reset Password"
      subtitle=""
      altLabel="Remember your password?"
      altAction="Login"
      altHref="/login"
    >
      {stage === 'request' ? (
        <form className="space-y-4" onSubmit={handleSendOtp}>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Email Address</label>
            <input
              autoComplete="email"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your registered email"
              type="email"
            />
          </div>
          {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Sending OTP...' : 'Send Reset Code'}
          </button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleResetPassword}>
          <div>
            <p className="mb-4 text-sm text-[#9f9f9f]">Enter the 6-digit OTP sent to <strong>{email}</strong> and choose your new password.</p>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {otpDigits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => { otpInputsRef.current[index] = element; }}
                maxLength={1}
                value={digit}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, '').slice(-1);
                  setOtpDigits((current) => {
                    const next = [...current];
                    next[index] = value;
                    return next;
                  });
                  if (value && otpInputsRef.current[index + 1]) {
                    otpInputsRef.current[index + 1].focus();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Backspace' && !otpDigits[index] && otpInputsRef.current[index - 1]) {
                    otpInputsRef.current[index - 1].focus();
                  }
                }}
                className="aspect-square w-full rounded-md border border-white/20 bg-[#ffffff] text-center text-lg font-medium text-black focus:outline-none focus:ring-1 focus:ring-white/40"
                inputMode="numeric"
              />
            ))}
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Enter new password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 flex items-center text-[#6f6f6f] hover:text-white transition-colors"
                onClick={() => setShowPassword(!showPassword)}
              >
                <i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-[15px]`}></i>
              </button>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Confirm New Password</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm new password"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-3 flex items-center text-[#6f6f6f] hover:text-white transition-colors"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                <i className={`fa-regular ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'} text-[15px]`}></i>
              </button>
            </div>
          </div>
          {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Resetting Password...' : 'Reset Password'}
          </button>
          <button
            type="button"
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/10 text-[15px] font-semibold text-white transition-colors hover:bg-white/15"
            onClick={() => setStage('request')}
          >
            Back
          </button>
        </form>
      )}
    </AuthPageLayout>
  );
}
