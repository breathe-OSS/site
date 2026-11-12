const OPTIONS = [
  { toggle: 'map-playback-toggle', key: 'breathe_map_playback', className: 'map-playback-on' },
  { toggle: 'map-legend-toggle', key: 'breathe_map_legend', className: 'map-legend-on' },
];

function readOption(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on';
  } catch (e) {
    return false;
  }
}

function writeOption(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch (e) {
    return;
  }
}

export function initMapOptions(onChange: () => void): void {
  OPTIONS.forEach((option) => {
    const on = readOption(option.key);
    document.documentElement.classList.toggle(option.className, on);
    const toggle = document.getElementById(option.toggle) as HTMLInputElement | null;
    if (!toggle) {
      return;
    }
    toggle.checked = on;
    toggle.addEventListener('change', () => {
      writeOption(option.key, toggle.checked);
      document.documentElement.classList.toggle(option.className, toggle.checked);
      onChange();
    });
  });
}
