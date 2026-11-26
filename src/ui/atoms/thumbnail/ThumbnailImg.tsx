import "./ThumbnailImg.css";

interface ThumbnailImgProps {
  src: string;
  alt?: string;
  onError?: () => void;
}

export function ThumbnailImg({ src, alt, onError }: ThumbnailImgProps) {
  return <img className="ThumbnailImg" draggable="false" src={src} alt={alt ?? ""} onError={onError} />;
}
