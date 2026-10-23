import { getToken, emitAuthChange, API_BASE_URL } from '../../api/client.js';
import { useAuthSession } from '../../hooks/useAuthSession.js';
import { useQueryClient } from '@tanstack/react-query';
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from '../../utils/toast.js';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { UserProfileSkeleton, EditProfileSkeleton } from '../../components/ui/Skeletons/index.js';
import { CollectionPosterCard } from '../../components/ui/Cards/CollectionPosterCard.jsx';


import { ActionButton } from '../../components/ui/ActionButton.jsx';
import { ConfirmModal } from '../../components/ui/Modals/ConfirmModal.jsx';
import { AvatarSearchModal } from '../../components/ui/Modals/AvatarSearchModal.jsx';


export function EditProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuthSession();
  const userFromSession = auth.user || {};
  const [loading, setLoading] = useState(!userFromSession.username);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(() => ({
    username: userFromSession.username || '',
    firstName: userFromSession.firstName || '',
    lastName: userFromSession.lastName || '',
    dateOfBirth: userFromSession.dateOfBirth || '',
    bio: userFromSession.bio || '',
    instagramHandle: userFromSession.instagramHandle || '',
    xHandle: userFromSession.xHandle || '',
    youtubeHandle: userFromSession.youtubeHandle || ''
  }));
  const [avatarPreview, setAvatarPreview] = useState(userFromSession.avatar || FALLBACK_AVATAR);
  const [avatarUrl, setAvatarUrl] = useState(userFromSession.avatar || '');
  const [avatarSearchOpen, setAvatarSearchOpen] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    document.title = 'Edit Profile - Soulstash';
  }, []);

  useEffect(() => {
    if (!auth.isLoggedIn) {
      navigate('/login', { replace: true });
      return;
    }

    let cancelled = false;
    fetch(`${API_BASE_URL}/api/user/profile`, {
      headers: {
        Authorization: `Bearer ${getToken()}`
      }
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load profile');
        }
        if (!cancelled) {
          const userObj = payload.user || payload;
          setDraft((prev) => ({
            username: userObj.username || prev.username,
            firstName: userObj.firstName || prev.firstName,
            lastName: userObj.lastName || prev.lastName,
            dateOfBirth: userObj.dateOfBirth || prev.dateOfBirth,
            bio: userObj.bio || prev.bio,
            instagramHandle: userObj.instagramHandle || prev.instagramHandle,
            xHandle: userObj.xHandle || prev.xHandle,
            youtubeHandle: userObj.youtubeHandle || prev.youtubeHandle
          }));
          if (userObj.avatar) {
            setAvatarPreview(userObj.avatar);
            setAvatarUrl((curr) => curr || userObj.avatar);
          }
        }
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError.message || 'Failed to load profile');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [auth.isLoggedIn, navigate]);

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const formData = new FormData();
      Object.entries(draft).forEach(([key, value]) => {
        if (key !== 'username') formData.append(key, value || '');
      });
      if (avatarUrl) {
        formData.append('avatarUrl', avatarUrl);
      }

      const response = await fetch(`${API_BASE_URL}/api/user/update-profile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`
        },
        body: formData
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update profile');
      }

      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const updatedUser = {
        ...currentUser,
        ...data,
        ...(avatarUrl ? { avatar: avatarUrl } : {})
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));

      toast('Profile updated successfully');
      emitAuthChange();
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['profile-session'] });
      queryClient.invalidateQueries({ queryKey: ['user'] });
      
      // Delay navigation slightly so user sees the success toast
      setTimeout(() => {
        navigate(`/user/${draft.username}`);
      }, 500);
    } catch (err) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  const handleFormKeyDown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!formRef.current) return;
      const focusables = Array.from(
        formRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')
      );
      if (!focusables.length) return;
      
      const currentIndex = focusables.indexOf(document.activeElement);
      if (currentIndex === -1) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      let nextIndex;
      if (e.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % focusables.length;
      } else {
        nextIndex = (currentIndex - 1 + focusables.length) % focusables.length;
      }
      
      const nextEl = focusables[nextIndex];
      nextEl.focus();
      nextEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  if (loading) {
    return <EditProfileSkeleton />;
  }

  return (
    <div className="min-h-screen bg-transparent pb-16 pt-4 sm:pt-6 md:pt-8">
      <section className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] pb-5">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">Edit Profile</h1>
            <p className="mt-1 text-xs sm:text-sm text-[#9f9f9f]">Update your public details and social links without leaving the app.</p>
          </div>
          <button
            type="submit"
            form="edit-profile-form"
            disabled={saving}
            className="shrink-0 rounded-full bg-white px-5 py-2 sm:px-6 sm:py-2.5 text-xs sm:text-sm font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:opacity-60 shadow-md flex items-center gap-2 cursor-pointer"
          >
            {saving && <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-black border-t-transparent" />}
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
        <form 
          id="edit-profile-form"
          ref={formRef}
          onSubmit={handleSave} 
          className="mt-6 space-y-7" 
          data-tv-ignore="true"
          onKeyDown={handleFormKeyDown}
        >
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="relative">
              <button
                type="button"
                onClick={() => setAvatarSearchOpen(true)}
                className="group relative h-24 w-24 cursor-pointer overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/10 hover:ring-white/30 focus:outline-none focus:ring-2 focus:ring-[#64FFDA] transition-all"
                title="Change profile photo"
              >
                <img
                  src={avatarPreview}
                  alt="Profile avatar"
                  className="h-full w-full object-cover object-top"
                  onError={(event) => {
                    event.currentTarget.src = FALLBACK_AVATAR;
                  }}
                />
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <i className="fas fa-pencil-alt text-white text-lg"></i>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setAvatarSearchOpen(true)}
                className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#1F1F1F] border border-white/20 text-white/90 shadow-md hover:bg-white/20 transition-colors cursor-pointer"
                title="Change profile photo"
              >
                <i className="fas fa-pencil-alt text-xs"></i>
              </button>
            </div>
            <div>
              <h3 className="text-white font-medium">Profile photo</h3>
              <p className="mt-1 text-sm text-[#8f8f8f]">Search for a character to set as your avatar.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {[
              ['First name', 'firstName', false],
              ['Last name', 'lastName', false],
              ['Username', 'username', true],
              ['Date of birth', 'dateOfBirth', false]
            ].map(([label, key, disabled]) => (
              <div key={key}>
                <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">{label}</label>
                <input
                  value={draft[key]}
                  disabled={disabled}
                  onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  className={`h-11 w-full rounded-2xl px-4 text-white outline-none ${disabled ? 'bg-[#252525] text-white/60' : 'bg-[#1F1F1F]'} border border-[#252833]`}
                />
              </div>
            ))}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">Bio</label>
            <textarea
              rows={4}
              value={draft.bio}
              onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
              className="w-full rounded-2xl border border-[#252833] bg-[#1F1F1F] px-4 py-3 text-white outline-none"
              placeholder="Tell us about yourself"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {[
              ['Instagram', 'instagramHandle'],
              ['X / Twitter', 'xHandle'],
              ['YouTube', 'youtubeHandle']
            ].map(([label, key]) => (
              <div key={key}>
                <label className="mb-2 block text-sm font-medium text-[#d7d7d7]">{label}</label>
                <input
                  value={draft[key]}
                  onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  className="h-11 w-full rounded-2xl border border-[#252833] bg-[#1F1F1F] px-4 text-white outline-none"
                />
              </div>
            ))}
          </div>

          {error ? <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div> : null}

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-[#e5e5e5] disabled:opacity-60">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </section>
      
      <AvatarSearchModal 
        open={avatarSearchOpen} 
        onClose={() => setAvatarSearchOpen(false)} 
        onSelect={(url) => {
          setAvatarUrl(url);
          setAvatarPreview(url);
          setAvatarSearchOpen(false);
        }}
      />
    </div>
  );
}
