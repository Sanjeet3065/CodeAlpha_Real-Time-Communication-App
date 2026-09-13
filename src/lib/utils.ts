export function generateMeetingCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments: string[] = [];
  for (let s = 0; s < 3; s++) {
    let seg = '';
    for (let i = 0; i < 4; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(seg);
  }
  return segments.join('-');
}

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function formatTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function getInitials(name: string): string {
  if (!name) return 'U';
  const clean = name.trim();
  // Split on whitespace or separators (dots, underscores, hyphens)
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    // First letter of first name and first letter of surname / last name
    const firstInitial = parts[0][0];
    const lastInitial = parts[parts.length - 1][0];
    return (firstInitial + lastInitial).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export function getAvatarColor(seed: string): string {
  const gradients = [
    'bg-gradient-to-tr from-violet-600 to-indigo-600 text-white',
    'bg-gradient-to-tr from-blue-600 to-cyan-500 text-white',
    'bg-gradient-to-tr from-emerald-600 to-teal-500 text-white',
    'bg-gradient-to-tr from-rose-600 to-pink-500 text-white',
    'bg-gradient-to-tr from-amber-500 to-orange-600 text-white',
    'bg-gradient-to-tr from-purple-600 to-pink-600 text-white',
    'bg-gradient-to-tr from-indigo-600 to-blue-500 text-white',
    'bg-gradient-to-tr from-teal-500 to-emerald-700 text-white',
  ];
  let hash = 0;
  for (let i = 0; i < (seed || 'U').length; i++) {
    hash = (seed || 'U').charCodeAt(i) + (((hash << 5) - hash));
  }
  return gradients[Math.abs(hash) % gradients.length];
}

