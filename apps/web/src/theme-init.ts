// Applies the stored theme before the application renders, so there is no flash of the wrong theme.
const stored = localStorage.getItem('vectora-theme');
const dark =
  stored === 'dark' || (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
