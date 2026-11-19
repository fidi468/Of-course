/**
 * Qalereya / kamera seçilmiş şəkil faylını profil üçün hazırlayır:
 * canvas vasitəsilə 512×512-də kiçildir və JPEG data URL (base64) qaytarır.
 *
 * Data URL birbaşa profiles.avatar_url sütununa yazılır — Supabase Storage
 * bucket-i qurmaq tələb olunmur, <img src> birbaşa göstərir.
 */

const MAX_DIMENSION = 512
const JPEG_QUALITY = 0.85
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

export type AvatarImageResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: 'invalid' | 'tooLarge' | 'processing' }

export function fileToAvatarDataUrl(file: File): Promise<AvatarImageResult> {
  return new Promise(resolve => {
    if (!file.type.startsWith('image/')) {
      resolve({ ok: false, reason: 'invalid' })
      return
    }

    if (file.size > MAX_FILE_BYTES) {
      resolve({ ok: false, reason: 'tooLarge' })
      return
    }

    const objectUrl = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      try {
        // Üfüqi və şaquli ölçünü 512px ilə məhdudlaşdır (proporsional)
        const scale = Math.min(
          1,
          MAX_DIMENSION / Math.max(img.width, img.height)
        )
        const width = Math.max(1, Math.round(img.width * scale))
        const height = Math.max(1, Math.round(img.height * scale))

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(objectUrl)
          resolve({ ok: false, reason: 'processing' })
          return
        }

        ctx.drawImage(img, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)

        URL.revokeObjectURL(objectUrl)

        if (!dataUrl.startsWith('data:image/')) {
          resolve({ ok: false, reason: 'processing' })
          return
        }

        resolve({ ok: true, dataUrl })
      } catch {
        URL.revokeObjectURL(objectUrl)
        resolve({ ok: false, reason: 'processing' })
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve({ ok: false, reason: 'invalid' })
    }

    img.src = objectUrl
  })
}
