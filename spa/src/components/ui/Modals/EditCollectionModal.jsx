import React, { useState, useEffect, useRef } from 'react';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';
import { ActionButton } from '../ActionButton.jsx';
import { CollectionFormModal } from './CollectionFormModal.jsx';

export function EditCollectionModal(props) {
  const isDefaultCollection = ['Watched', 'Watchlist'].includes(props.values?.name);
  return (
    <CollectionFormModal
      {...props}
      title="Edit Collection"
      submitLabel="Save Changes"
      lockName={isDefaultCollection}
      lockPrivate={props.values?.isPublished === true && !isDefaultCollection}
    />
  );
}
