const KEY = 'eink_admin_password'
export const getPassword = () => localStorage.getItem(KEY) || ''
export const setPassword = (p) => (p ? localStorage.setItem(KEY, p) : localStorage.removeItem(KEY))

async function req(method, url, body) {
  const headers = { Authorization: `Bearer ${getPassword()}` }
  let payload
  if (body instanceof FormData) payload = body
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(url, { method, headers, body: payload })
  if (res.status === 401) {
    setPassword('')
    window.dispatchEvent(new Event('eink-unauthorized'))
    throw new Error('unauthorized')
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
  return res.json()
}

export const api = {
  login: (password) => fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).then((r) => r.ok),
  authConfig: () => fetch('/api/auth/config').then((r) => r.json()),
  me: () => fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }),
  creations: () => req('GET', '/api/creations'),
  creation: (id) => req('GET', `/api/creations/${id}`),
  createCreation: (data) => req('POST', '/api/creations', data),
  saveCreation: (id, data) => req('PUT', `/api/creations/${id}`, data),
  duplicateCreation: (id, data = {}) => req('POST', `/api/creations/${id}/duplicate`, data),
  deleteCreation: (id) => req('DELETE', `/api/creations/${id}`),
  assets: () => req('GET', '/api/assets'),
  uploadAsset: (file) => {
    const f = new FormData()
    f.append('file', file)
    return req('POST', '/api/assets', f)
  },
  deleteAsset: (id) => req('DELETE', `/api/assets/${id}`),
  devices: () => req('GET', '/api/devices'),
  createDevice: (data) => req('POST', '/api/devices', data),
  patchDevice: (id, data) => req('PATCH', `/api/devices/${id}`, data),
  deleteDevice: (id) => req('DELETE', `/api/devices/${id}`),
  settings: () => req('GET', '/api/settings'),
  saveSettings: (data) => req('PUT', '/api/settings', data),
  setCalibration: (on, seconds) => req('POST', '/api/calibration', { on, ...(seconds ? { seconds } : {}) }),
  addSlide: (deviceId, data) => req('POST', `/api/devices/${deviceId}/slides`, data),
  patchSlide: (id, data) => req('PATCH', `/api/slides/${id}`, data),
  deleteSlide: (id) => req('DELETE', `/api/slides/${id}`),
  reorderSlides: (deviceId, ids) => req('PUT', `/api/devices/${deviceId}/slides/order`, { ids }),
}

// Les <img> ne peuvent pas envoyer d'en-tête Authorization : on passe par fetch + blob.
export const fetchBlobUrl = async (url) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getPassword()}` } })
  if (!res.ok) throw new Error(res.statusText)
  return URL.createObjectURL(await res.blob())
}
