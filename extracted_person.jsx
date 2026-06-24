function PersonCreditsFilterControls({
  contentType,
  setContentType,
  quickFilter,
  setQuickFilter,
  collectionFilter,
  setCollectionFilter,
  sortBy,
  setSortBy,
  collectionOptions,
  resetKey,
  collectionsLoading = false
}) {
  const collectionTriggerRef = useRef(null);
  const collectionDropdownRef = useRef(null);
  const [collectionMenuOpen, setCollectionMenuOpen] = useState(false);
  const [collectionMenuStyle, setCollectionMenuStyle] = useState({});
  const sortTriggerRef = useRef(null);
  const sortDropdownRef = useRef(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuStyle, setSortMenuStyle] = useState({});

  const sortOptions = [
    { value: 'rating-desc', label: 'Rating high' },
    { value: 'rating-asc', label: 'Rating low' },
    { value: 'year-desc', label: 'Year new' },
    { value: 'year-asc', label: 'Year old' }
  ];

  const activeCollectionLabel =
    collectionOptions.find((option) => option.value === collectionFilter)?.label || 'All';

  const activeSortLabel =
    sortOptions.find((option) => option.value === sortBy)?.label || 'Rating high';

  