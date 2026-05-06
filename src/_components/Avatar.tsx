import { backendUrl, SessionLayout } from "config";

import { useAvatarContext } from "./AvatarProvider";

type UserType = SessionLayout | { name: string; avatar?: string; avatarFallback?: string };
type TextSize = `text-${'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl' | '8xl' | '9xl'}`;

const resolveAvatarUrl = (avatar: string) =>
  avatar.startsWith('http') ? avatar : `${backendUrl}/uploads/${avatar}`;

//? Stable identity key per avatar (file name + ?v= cache buster).
//? Used to share success/fail state across all <Avatar> instances rendering
//? the same image, so the first onError fans out to every other Avatar.
const getAvatarStatusKey = (avatar: string | undefined, fallbackName: string): string => {
  if (!avatar) return `fallback:${fallbackName}`;

  const url = resolveAvatarUrl(avatar);
  const [path, query = ''] = url.split('?');
  const fileName = path.split('/').pop() ?? path;
  const id = fileName.replace(/\.[^/.]+$/, '') || fileName;
  const refresh = new URLSearchParams(query).get('v') ?? '';

  return `${id}|${refresh}`;
};

interface AvatarProps {
  user: UserType;
  textSize?: TextSize;
}

export default function Avatar({ user, textSize = 'text-lg' }: AvatarProps) {
  const { avatarStatuses, setAvatarStatus } = useAvatarContext();
  const statusKey = getAvatarStatusKey(user.avatar, user.name);
  const status = avatarStatuses[statusKey];
  const showFallback = !user.avatar || status === 'fallback';

  if (showFallback) {
    return (
      <div
        className={`rounded-full aspect-square text-white flex items-center justify-center w-full h-full select-none ${textSize}`}
        style={{ backgroundColor: user.avatarFallback ?? '#9ca3af' }}
      >
        {user.name ? user.name[0].toUpperCase() : null}
      </div>
    );
  }

  return (
    <img
      key={statusKey}
      className="rounded-full w-full h-full select-none object-cover aspect-square"
      src={resolveAvatarUrl(user.avatar ?? '')}
      alt={user.name}
      onError={() => { setAvatarStatus(statusKey, 'fallback'); }}
      onLoad={() => { setAvatarStatus(statusKey, 'avatar'); }}
    />
  );
}
