export const sep = '/'

export function basename(path: string): string {
  const parts = path.split(sep)
  return parts[parts.length - 1]
}

export function join(...paths: string[]): string {
  return paths
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/\/+$/, '')
      } else {
        return part.replace(/^\/+/, '').replace(/\/+$/, '')
      }
    })
    .filter((part) => part.length > 0)
    .join(sep)
}

export function relative(from: string, to: string): string {
  const fromParts = from.split(sep).filter((p) => p.length > 0)
  const toParts = to.split(sep).filter((p) => p.length > 0)

  let i = 0
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
    i++
  }

  const up = fromParts.slice(i).map(() => '..')
  const down = toParts.slice(i)

  return [...up, ...down].join(sep)
}
