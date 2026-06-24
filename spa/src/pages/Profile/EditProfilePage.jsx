import { getToken, emitAuthChange, clearClientDataCaches } from '../../api/client.js';
import { useAuthSession } from '../../hooks/index.js';
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from '../../utils/toast.js';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { UserProfileSkeleton, EditProfileSkeleton } from '../../components/ui/Skeletons/index.js';
import { CollectionPosterCard } from '../../components/ui/Cards/CollectionPosterCard.jsx';
import { ContentCard } from '../../components/ui/Cards/ContentCard.jsx';

import { ActionButton } from '../../components/ui/ActionButton.jsx';
import { ConfirmModal } from '../../components/ui/Modals/ConfirmModal.jsx';


export function EditProfilePage() {
  const navigate = useNavigate();
  const auth = useAuthSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({
    username: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    bio: '',
    instagramHandle: '',
    xHandle: '',
    youtubeHandle: ''
  });
  const [avatarPreview, setAvatarPreview] = useState(FALLBACK_AVATAR);
  const [avatarFile, setAvatarFile] = useState(null);

  useEffect(() => {
    document.title = 'Edit Profile - Soulstash';
  }, []);

  useEffect(() => {
    if (!auth.isLoggedIn) {
      navigate('/login', { replace: true });
      return;
    }

    let cancelled = false;
    fetch('/api/user/profile', {
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
          setDraft({
            username: userObj.username || '',
            firstName: userObj.firstName || '',
            lastName: userObj.lastName || '',
            dateOfBirth: userObj.dateOfBirth || '',
            bio: userObj.bio || '',
            instagramHandle: userObj.instagramHandle || '',
            xHandle: userObj.xHandle || '',
            youtubeHandle: userObj.youtubeHandle || ''
          });
          setAvatarPreview(userObj.avatar || FALLBACK_AVATAR);
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
      if (avatarFile) {
        formData.append('avatar', avatarFile);
      }

      const response = await fetch('/api/user/update-profile', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`
        },
        body: formData
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to update profile');
      }

      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      localStorage.setItem('user', JSON.stringify({ ...currentUser, ...payload }));
      clearClientDataCaches();
      emitAuthChange();
      toast('Profile updated');
      navigate(`/user/${payload.username || auth.username}`);
    } catch (saveError) {
      setError(saveError.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <EditProfileSkeleton />;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <section className="rounded-[28px] bg-[rgba(255,255,255,0.03)] p-5 md:p-7">
        <h1 className="text-2xl font-semibold text-white">Edit Profile</h1>
        <p className="mt-2 text-sm text-[#9f9f9f]">Update your public details and social links without leaving the app.</p>
        <form className="mt-8 space-y-7" onSubmit={handleSave}>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <label className="group relative h-24 w-24 cursor-pointer overflow-hidden rounded-full bg-white/[0.06] ring-1 ring-white/10">
              <img
                src={avatarPreview}
                alt="Profile avatar"
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.src = FALLBACK_AVATAR;
                }}
              />
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.avif,.heic,.heif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setAvatarFile(file);
                  setAvatarPreview(URL.createObjectURL(file));
                }}
              />
            </label>
            <div>
              <h3 className="text-white font-medium">Profile photo</h3>
              <p className="mt-1 text-sm text-[#8f8f8f]">Upload a new photo for your profile.</p>
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
    </div>
  );
}
