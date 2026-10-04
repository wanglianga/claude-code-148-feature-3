// 现场照片选择：本地压缩（最长边 480，jpeg 0.7），最多 3 张，输出 dataUrl 数组
import { useRef } from 'react'

export function PhotoInput({ photos, onChange, max = 3, label = '📷 拍照/上传' }: {
  photos: string[]; onChange: (p: string[]) => void; max?: number; label?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, max - photos.length)
    let acc = [...photos]
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, 480 / Math.max(img.width, img.height))
          canvas.width = img.width * scale; canvas.height = img.height * scale
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
          acc = [...acc, canvas.toDataURL('image/jpeg', 0.7)]
          onChange(acc)
        }
        img.src = String(reader.result)
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }
  return (
    <div>
      <div className="photo-row mb8">
        {photos.map((p, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <img src={p} alt={`照片${i + 1}`} />
            <button type="button" className="btn danger sm" style={{ position: 'absolute', top: -6, right: -6, padding: '1px 7px' }}
              onClick={() => onChange(photos.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
      </div>
      {photos.length < max && (
        <>
          <button type="button" className="btn ghost sm" onClick={() => ref.current?.click()}>{label}（最多 {max} 张）</button>
          <input ref={ref} type="file" accept="image/*" multiple hidden onChange={pick} />
        </>
      )}
    </div>
  )
}
