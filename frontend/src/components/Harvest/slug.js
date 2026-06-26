export function slugify(url) {
  return btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function unslug(slug) {
  const padded = slug + '='.repeat((4 - (slug.length % 4)) % 4)
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
}
