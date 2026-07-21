export function SceneArtwork({ svg }: Readonly<{ svg: string }>) {
  return <div className="scene-artwork" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
