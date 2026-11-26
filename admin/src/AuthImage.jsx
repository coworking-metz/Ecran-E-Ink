import { useEffect, useState } from 'react'
import { fetchBlobUrl } from './api.js'

export default function AuthImage({ src, alt = '', ...rest }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let revoked = false
    let created
    fetchBlobUrl(src).then((u) => {
      created = u
      if (revoked) URL.revokeObjectURL(u)
      else setUrl(u)
    }).catch(() => setUrl(null))
    return () => { revoked = true; if (created) URL.revokeObjectURL(created) }
  }, [src])
  return url ? <img src={url} alt={alt} {...rest} /> : null
}
