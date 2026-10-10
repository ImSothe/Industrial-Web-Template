/* ==========================================================================
   Exportación 3D (STL / GLB) — STUB de la plantilla pública
   --------------------------------------------------------------------------
   La exportación real de la pieza a escala de fabricación (STL en mm, GLB en m)
   NO se distribuye en esta plantilla. El visor 3D sí funciona; la descarga no.
   Se mantiene la API para que checkout y panel de taller no se rompan:
     partToSTL(THREE, cfg)  -> Blob  (marcador sin geometría)
     partToGLB(THREE, cfg)  -> Promise<Blob>  (marcador sin geometría)
   ========================================================================== */

export function partToSTL(_THREE, _cfg) {
  return new Blob(['solid placeholder\nendsolid placeholder\n'], { type: 'model/stl' });
}

export async function partToGLB(_THREE, _cfg) {
  return new Blob([], { type: 'model/gltf-binary' });
}
