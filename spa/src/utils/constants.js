export const IMAGE_BASE = 'https://image.tmdb.org/t/p';
export const FALLBACK_AVATAR = '/images/avatar.png';
export const FALLBACK_POSTER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='300' viewBox='0 0 200 300'%3E%3Crect width='200' height='300' fill='%23141414'/%3E%3Crect x='0' y='0' width='200' height='8' fill='%23222'/%3E%3Crect x='0' y='292' width='200' height='8' fill='%23222'/%3E%3Ccircle cx='100' cy='140' r='28' fill='none' stroke='%23333' stroke-width='2'/%3E%3Cpolygon points='92,128 92,152 116,140' fill='%23333'/%3E%3Crect x='60' y='185' width='80' height='4' rx='2' fill='%23262626'/%3E%3Crect x='72' y='197' width='56' height='4' rx='2' fill='%23222'/%3E%3C/svg%3E`;
export const HOME_GRID_CLASS = 'grid grid-flow-col auto-cols-[32%] sm:auto-cols-[22%] gap-3 overflow-x-auto snap-x snap-mandatory hide-scrollbar pb-2 md:grid-flow-row md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 md:auto-cols-auto md:pb-0 md:snap-none md:overflow-visible';
export const CREDIT_PAGE_SIZE = 24;
export const HOME_TRENDING_TTL = 60 * 60 * 1000;
export const AUTO_RECOVERY_RETRIES = 3;
export const PUBLISH_MIN_COLLECTION_TITLES = 6;

export const AUTH_POSTER_CACHE_KEY = 'soulstash:auth-posters:v3';

export const FALLBACK_AUTH_POSTERS = [
  { id: 1275779, title: "Disclosure Day", poster_path: "/3o5YPjDGDTcTDL5ftDA9NwN9dLd.jpg" },
  { id: 276161, title: "Teach You a Lesson", poster_path: "/wd14C18cey46iCj9pedMSM4kXE6.jpg" },
  { id: 936075, title: "Michael", poster_path: "/zm0KAbOjlt9eR5y7vDiL2dEOwMl.jpg" },
  { id: 260592, title: "Every Year After", poster_path: "/nZGf0jnSJNXLf8o7iSzzX8qxHX9.jpg" },
  { id: 1083381, title: "Backrooms", poster_path: "/rhGx6E3qRNMgj3i5su2oukNHwIQ.jpg" },
  { id: 124364, title: "FROM", poster_path: "/pRtJagIxpfODzzb0T0NAvZSzErC.jpg" },
  { id: 1339713, title: "Obsession", poster_path: "/bRwnj8WEKBCvmfeUNOukJPwB43K.jpg" },
  { id: 220102, title: "Spider-Noir", poster_path: "/oD8WSVqz84ZRfelkr7JPeJwR9Iv.jpg" },
  { id: 931285, title: "Mortal Kombat II", poster_path: "/hwRdDFIhaEmpRgoki805YvyyjZf.jpg" },
  { id: 292696, title: "The First Jasmine", poster_path: "/ygvVoUa6S88aT3vPMi1WVUt2meo.jpg" },
  { id: 454639, title: "Masters of the Universe", poster_path: "/3YMd9Ogae4rDKLWuAZFuse9xhc5.jpg" },
  { id: 270476, title: "Widow's Bay", poster_path: "/5lcxWLVAEICkFpuAiV1aMy7ZZj3.jpg" },
  { id: 1273221, title: "Scary Movie", poster_path: "/reZ8NInXjMkkaOpUHcI3Pn7iaRN.jpg" },
  { id: 76479, title: "The Boys", poster_path: "/in1R2dDc421JxsoRWaIIAqVI2KE.jpg" },
  { id: 1084244, title: "Toy Story 5", poster_path: "/pxG26JdyuiDvJbSoucknaFiLeZD.jpg" },
  { id: 90521, title: "Love Island USA", poster_path: "/kU2y21cls8WargMaX7KI47URMjD.jpg" },
  { id: 1368337, title: "The Odyssey", poster_path: "/9C9PAnrZcB8x7YHNlBs4PUv0Z7K.jpg" },
  { id: 277439, title: "Cape Fear", poster_path: "/2zOhbDmelY5WidqqdhEaVfOcEMp.jpg" },
  { id: 1275779, title: "Disclosure Day", poster_path: "/3o5YPjDGDTcTDL5ftDA9NwN9dLd.jpg" },
  { id: 276161, title: "Teach You a Lesson", poster_path: "/wd14C18cey46iCj9pedMSM4kXE6.jpg" },
  { id: 936075, title: "Michael", poster_path: "/zm0KAbOjlt9eR5y7vDiL2dEOwMl.jpg" },
  { id: 260592, title: "Every Year After", poster_path: "/nZGf0jnSJNXLf8o7iSzzX8qxHX9.jpg" },
  { id: 1083381, title: "Backrooms", poster_path: "/rhGx6E3qRNMgj3i5su2oukNHwIQ.jpg" },
  { id: 124364, title: "FROM", poster_path: "/pRtJagIxpfODzzb0T0NAvZSzErC.jpg" },
  { id: 1339713, title: "Obsession", poster_path: "/bRwnj8WEKBCvmfeUNOukJPwB43K.jpg" },
  { id: 220102, title: "Spider-Noir", poster_path: "/oD8WSVqz84ZRfelkr7JPeJwR9Iv.jpg" },
  { id: 931285, title: "Mortal Kombat II", poster_path: "/hwRdDFIhaEmpRgoki805YvyyjZf.jpg" },
  { id: 292696, title: "The First Jasmine", poster_path: "/ygvVoUa6S88aT3vPMi1WVUt2meo.jpg" },
  { id: 454639, title: "Masters of the Universe", poster_path: "/3YMd9Ogae4rDKLWuAZFuse9xhc5.jpg" },
  { id: 270476, title: "Widow's Bay", poster_path: "/5lcxWLVAEICkFpuAiV1aMy7ZZj3.jpg" },
  { id: 1273221, title: "Scary Movie", poster_path: "/reZ8NInXjMkkaOpUHcI3Pn7iaRN.jpg" },
  { id: 76479, title: "The Boys", poster_path: "/in1R2dDc421JxsoRWaIIAqVI2KE.jpg" },
  { id: 1084244, title: "Toy Story 5", poster_path: "/pxG26JdyuiDvJbSoucknaFiLeZD.jpg" },
  { id: 90521, title: "Love Island USA", poster_path: "/kU2y21cls8WargMaX7KI47URMjD.jpg" },
  { id: 1368337, title: "The Odyssey", poster_path: "/9C9PAnrZcB8x7YHNlBs4PUv0Z7K.jpg" },
  { id: 277439, title: "Cape Fear", poster_path: "/2zOhbDmelY5WidqqdhEaVfOcEMp.jpg" }
];

export const COLLECTION_NAME_MAX_LENGTH = 25;

export const SESSION_SCRAPED = new Set();
