interface Props {
	name: string,
	size?: string,
	weight?: string,
  customClasses?: string,
  onClick?: () => void
}

export default function Icon({ name, size, weight, customClasses, onClick }: Props) {
  if (!name) return null

  return (
    <span
      style={{ fontSize: size ?? '20px', fontWeight: weight ?? 'lighter' }}
      className={`material-icons select-none ${customClasses ?? ''}`}
      onClick={onClick}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {name}
    </span>
  )
}