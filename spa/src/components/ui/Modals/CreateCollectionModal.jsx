import React, { useState, useEffect, useRef } from 'react';
import { FALLBACK_AVATAR } from '../../../utils/constants.js';
import { ActionButton } from '../ActionButton.jsx';
import { CollectionFormModal } from './CollectionFormModal.jsx';
import { toast } from '../../../utils/toast.js';

export function CreateCollectionModal(props) {
  return <CollectionFormModal {...props} title="Create Collection" submitLabel="Create Collection" />;
}
