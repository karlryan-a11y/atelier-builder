import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { derivedImageUrl, type DerivedWidth } from '@/lib/derivedImage'

/**
 * The only way a grid tile shows a look or a piece: asks for the small derivative first
 * (lib/derivedImage.ts) and falls back to the original on error, so a look with no variant yet
 * (every draft) shows full size instead of a blank tile. Never use for the canvas or a zoom
 * view; those want the original. scripts/check-tile-images.mjs holds this.
 */
export function TileImage({ src, width, ...rest }: { src: string; width: DerivedWidth } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'width'>) {
  const small = derivedImageUrl(src, width)
  const [useOriginal, setUseOriginal] = useState(false)
  useEffect(() => { setUseOriginal(false) }, [src])
  const current = !useOriginal && small ? small : src
  return (
    <img
      {...rest}
      src={current}
      data-full={current !== src ? src : undefined}
      onError={(e) => {
        if (current !== src) setUseOriginal(true)
        rest.onError?.(e)
      }}
    />
  )
}
