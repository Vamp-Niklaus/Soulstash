import { saveAuthSession } from '../../api/client.js';
import { AuthPageSkeleton } from '../../components/ui/Skeletons/index.js';
import { useAuthSession, useSessionState } from '../../hooks/index.js';
import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { toast } from '../../utils/toast.js';
import { FALLBACK_AUTH_POSTERS } from '../../utils/constants.js';

import { AuthPageLayout } from '../../components/ui/Auth/AuthPageLayout.jsx';

export function RegisterPage() {
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthSession();
  const [pageReady, setPageReady] = useState(false);
  const [firstName, setFirstName] = useSessionState('auth:register:firstName', '');
  const [lastName, setLastName] = useSessionState('auth:register:lastName', '');
  const [username, setUsername] = useSessionState('auth:register:username', '');
  const [email, setEmail] = useSessionState('auth:register:email', '');
  const [password, setPassword] = useSessionState('auth:register:password', '');
  const [confirmPassword, setConfirmPassword] = useSessionState('auth:register:confirmPassword', '');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [usernameState, setUsernameState] = useState({ checking: false, available: null, message: '' });
  const [otpStage, setOtpStage] = useSessionState('auth:register:otpStage', false);
  const [otpDigits, setOtpDigits] = useSessionState('auth:register:otpDigits', ['', '', '', '', '', '']);
  const [otpError, setOtpError] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [emailOwnership, setEmailOwnership] = useSessionState('auth:register:emailOwnership', false);
  const [termsAgreement, setTermsAgreement] = useSessionState('auth:register:termsAgreement', false);
  const [resendCountdown, setResendCountdown] = useSessionState('auth:register:resendCountdown', 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const usernameCheckTimerRef = useRef(null);
  const otpInputsRef = useRef([]);

  useEffect(() => {
    setPageReady(true);
  }, []);

  function openRegisterPolicy(path) {
    navigate(path, {
      state: {
        from: '/register',
        preserveRegisterState: true
      }
    });
  }

  useEffect(() => {
    if (isLoggedIn) {
      navigate('/', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  useEffect(() => {
    const trimmed = username.trim();
    if (usernameCheckTimerRef.current) {
      window.clearTimeout(usernameCheckTimerRef.current);
    }

    if (trimmed.length < 3) {
      setUsernameState({ checking: false, available: null, message: '' });
      return undefined;
    }

    setUsernameState((current) => ({ ...current, checking: true, message: '' }));
    usernameCheckTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/auth/check-username?username=${encodeURIComponent(trimmed)}`);
        const payload = await response.json().catch(() => ({}));
        setUsernameState({
          checking: false,
          available: Boolean(payload.available),
          message: payload.message || ''
        });
      } catch {
        setUsernameState({ checking: false, available: null, message: '' });
      }
    }, 500);

    return () => {
      if (usernameCheckTimerRef.current) {
        window.clearTimeout(usernameCheckTimerRef.current);
      }
    };
  }, [username]);

  useEffect(() => {
    if (!resendCountdown) return undefined;
    const timer = window.setInterval(() => {
      setResendCountdown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCountdown]);

  function passwordStrength(passwordValue) {
    let strength = 0;
    if (passwordValue.length >= 8) strength++;
    if (/[a-z]/.test(passwordValue) && /[A-Z]/.test(passwordValue)) strength++;
    if (/[0-9]/.test(passwordValue)) strength++;
    if (/[^a-zA-Z0-9]/.test(passwordValue)) strength++;
    return strength;
  }

  async function requestOtp() {
    setOtpSending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim(),
          fullName: `${firstName.trim()} ${lastName.trim()}`.trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to send OTP');
      }
      setOtpStage(true);
      setOtpError('');
      setResendCountdown(30);
      if (payload.otp) {
        toast(`Dev OTP: ${payload.otp}`, 'info');
      } else {
        toast(payload.message || 'OTP sent successfully');
      }
    } catch (submitError) {
      setError(submitError.message || 'Failed to send OTP');
    } finally {
      setOtpSending(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!firstName.trim() || !lastName.trim() || !username.trim() || !email.trim() || !password || !confirmPassword) {
      setError('Please fill in all fields');
      return;
    }
    if (usernameState.available === false) {
      setError('Username is already taken');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (!termsAgreement) {
      setError('Please agree to the Terms of Service and Privacy Policy');
      return;
    }

    setLoading(true);
    try {
      await requestOtp();
    } catch (submitError) {
      setError(submitError.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setOtpError('');
    const otp = otpDigits.join('');
    if (otp.length !== 6) {
      setOtpError('Please enter the full OTP');
      return;
    }
    if (!emailOwnership || !termsAgreement) {
      setOtpError('Please complete both confirmations');
      return;
    }

    setVerifyLoading(true);
    try {
      const response = await fetch('/api/auth/verify-otp-and-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          username: username.trim(),
          password,
          otp,
          fullName: `${firstName.trim()} ${lastName.trim()}`.trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'OTP verification failed');
      }

      saveAuthSession(payload.token, payload.user);
      sessionStorage.removeItem('auth:register:firstName');
      sessionStorage.removeItem('auth:register:lastName');
      sessionStorage.removeItem('auth:register:username');
      sessionStorage.removeItem('auth:register:email');
      sessionStorage.removeItem('auth:register:password');
      sessionStorage.removeItem('auth:register:confirmPassword');
      sessionStorage.removeItem('auth:register:otpStage');
      sessionStorage.removeItem('auth:register:otpDigits');
      sessionStorage.removeItem('auth:register:emailOwnership');
      sessionStorage.removeItem('auth:register:termsAgreement');
      sessionStorage.removeItem('auth:register:resendCountdown');
      if (window.CollectionStore?.invalidate) window.CollectionStore.invalidate();
      if (window.CollectionStore?.syncCollections) window.CollectionStore.syncCollections().catch(() => {});
      toast(payload.message || 'Account created successfully!');
      navigate('/', { replace: true });
    } catch (verifyError) {
      setOtpError(verifyError.message || 'OTP verification failed');
    } finally {
      setVerifyLoading(false);
    }
  }

  if (!pageReady) {
    return <AuthPageSkeleton />;
  }

  return (
    <AuthPageLayout
      title="Create Account"
      subtitle=""
      altLabel="Already have an account?"
      altAction="Login"
      altHref="/login"
    >
      {!otpStage ? (
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">First Name</label>
            <input
              autoComplete="given-name"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="First name"
            />
          </div>
          <div className="flex-1">
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Last Name</label>
            <input
              autoComplete="family-name"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder="Last name"
            />
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Username</label>
          <div className="relative">
            <input
              autoComplete="username"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Choose a username"
            />
            <div className="absolute inset-y-0 right-3 flex items-center">
              {usernameState.checking ? <span className="inline-block h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin"></span> : null}
              {!usernameState.checking && usernameState.available === true ? <span className="text-[#22c55e] text-lg">{"\u2713"}</span> : null}
              {!usernameState.checking && usernameState.available === false ? <span className="text-[#ef4444] text-lg">{"\u2717"}</span> : null}
            </div>
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Email</label>
          <input
            autoComplete="email"
            className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] px-4 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your email"
            type="email"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Create a password"
            />
            <button
              type="button"
              className="absolute inset-y-0 right-3 flex items-center text-[#6f6f6f] hover:text-white transition-colors"
              onClick={() => setShowPassword(!showPassword)}
            >
              <i className={`fa-regular ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-[15px]`}></i>
            </button>
          </div>
          {password ? (
            <div className="mt-2">
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    passwordStrength(password) <= 1 ? 'bg-[#ef4444] w-1/3' : passwordStrength(password) === 2 ? 'bg-[#f59e0b] w-2/3' : 'bg-[#22c55e] w-full'
                  }`}
                ></div>
              </div>
            </div>
          ) : null}
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Confirm Password</label>
          <div className="relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              autoComplete="new-password"
              className="h-11 w-full rounded-2xl border border-white/10 bg-[#181818] pl-4 pr-11 text-white outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-white/20"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
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
        <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-6 text-[#d3d3d3]">
          <input
            type="checkbox"
            checked={termsAgreement}
            onChange={(event) => setTermsAgreement(event.target.checked)}
            className="mt-1"
          />
          <span>
            I agree to the{' '}
            <button
              type="button"
              className="font-medium text-white hover:underline"
              onClick={() => openRegisterPolicy('/terms-of-service')}
            >
              Terms of Service
            </button>{' '}
            and{' '}
            <button
              type="button"
              className="font-medium text-white hover:underline"
              onClick={() => openRegisterPolicy('/privacy-policy')}
            >
              Privacy Policy
            </button>
            .
          </span>
        </label>
        {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}
        <button
          type="submit"
          disabled={loading || usernameState.available === false || usernameState.checking || !termsAgreement}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading || otpSending ? 'Sending OTP...' : 'Create Account'}
        </button>
      </form>
      ) : (
      <form className="space-y-4" onSubmit={handleVerifyOtp}>
        <div>
          <h3 className="text-xl font-semibold text-white text-center">Verify OTP</h3>
          <p className="mt-2 text-center text-sm text-[#9f9f9f]">Enter the OTP sent to {email}</p>
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
        <label className="flex items-start gap-2 text-sm text-white">
          <input type="checkbox" checked={emailOwnership} onChange={(event) => setEmailOwnership(event.target.checked)} className="mt-1" />
          <span>I confirm this email belongs to me and I have permission to use it for registration.</span>
        </label>
        {otpError ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{otpError}</div> : null}
        <button
          type="button"
          disabled={resendCountdown > 0}
          className="w-full text-sm text-white/80 hover:underline disabled:no-underline disabled:text-white/35"
          onClick={async () => {
            await requestOtp();
          }}
        >
          {resendCountdown > 0 ? `Resend OTP in ${resendCountdown}s` : 'Resend OTP'}
        </button>
        <button
          type="submit"
          disabled={verifyLoading}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-gradient-to-r from-[#B048FF] to-[#8F44F0] text-[15px] font-semibold text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {verifyLoading ? 'Verifying OTP...' : 'Verify OTP'}
        </button>
        <button
          type="button"
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-white/10 text-[15px] font-semibold text-white transition-colors hover:bg-white/15"
          onClick={() => {
            setOtpStage(false);
            setOtpDigits(['', '', '', '', '', '']);
            setOtpError('');
          }}
        >
          Back
        </button>
      </form>
      )}
    </AuthPageLayout>
  );
}
