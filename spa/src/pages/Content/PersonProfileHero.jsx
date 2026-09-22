import React from 'react';
import { getToken } from '../../api/client.js';
import { FALLBACK_AVATAR } from '../../utils/constants.js';
import { imageUrl } from '../../utils/formatters.js';
import { toast } from '../../utils/toast.js';

export function PersonProfileHero({ person, bioExpanded, onToggleBiography, isFavorite, onAddFavorite, onRemoveFavorite }) {
  function toggleFavorite() {
    if (!getToken()) {
      toast('Please login first', 'success');
      return;
    }
    isFavorite ? onRemoveFavorite(person.id) : onAddFavorite({
      id: person.id,
      name: person.name,
      profile_path: person.profile_path || '',
      known_for_department: person.known_for_department || ''
    });
  }

  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,15,15,0.98),rgba(10,10,10,0.95))] p-6 md:p-8 lg:p-10 overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,113,86,0.18),transparent_24%),radial-gradient(circle_at_left_center,rgba(143,68,240,0.18),transparent_30%)]" />
      <div className="relative z-10 space-y-6">
        <div className="flex items-start gap-4 sm:gap-6 md:gap-8">
          <div className="flex-shrink-0 w-[120px] sm:w-[170px] md:w-[220px] max-w-[42vw]">
            <div className="person-avatar self-start aspect-[2/3] overflow-hidden rounded-[24px] border border-white/10">
              <img src={imageUrl(person.profile_path, 'w500')} alt={person.name} className="w-full h-full object-cover" onError={(event) => { event.currentTarget.src = FALLBACK_AVATAR; }} />
            </div>
          </div>
          <div className="min-w-0 flex-1 self-start">
            <div className="flex items-start gap-3">
              <h1 className="text-2xl sm:text-3xl md:text-5xl font-semibold text-white leading-tight text-left">{person.name}</h1>
              <button type="button" className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[#cfcfcf] transition-colors hover:text-[#f7c948]" onClick={toggleFavorite} aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
                <i className={`${isFavorite ? 'fas' : 'far'} fa-star text-[15px] ${isFavorite ? 'text-[#f7c948]' : ''}`} />
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm md:text-base">
              <PersonFact label="Known For" value={person.known_for_department || 'Acting'} />
              <PersonFact label="Birthday" value={person.birthday || 'Unknown'} />
              <PersonFact label="Popularity" value={person.popularity ? person.popularity.toFixed(1) : 'N/A'} />
              <PersonFact label="Place of Birth" value={person.place_of_birth || 'Unknown'} />
            </div>
          </div>
        </div>
        <div className="max-w-4xl">
          <p className={`text-[#d0d0d0] text-sm md:text-base leading-7 ${bioExpanded ? '' : 'line-clamp-3'}`}>{person.biography || 'Biography not available yet.'}</p>
          {person.biography ? <button type="button" className="mt-3 text-sm font-medium text-white/80 transition-colors hover:text-white" onClick={onToggleBiography}>{bioExpanded ? 'Show less' : 'Read more'}</button> : null}
        </div>
      </div>
    </section>
  );
}

function PersonFact({ label, value }) {
  return <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span className="text-[#9a9a9a]">{label}</span><span className="text-[#E2E2E2] font-medium break-words">{value}</span></div>;
}
