const MAP = {
  '@capacitor/core': './capacitor-core.mjs',
  '@capacitor/filesystem': './capacitor-filesystem.mjs',
};
export async function resolve(spec, ctx, next) {
  if (MAP[spec]) return { url: new URL(MAP[spec], import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
