/* ==========================================================================
   Generador del plano de fabricación — STUB de la plantilla pública
   --------------------------------------------------------------------------
   El algoritmo real (patrón plano, tiras de plegado con factor K, capas de
   corte/plegado, unión booleana de cortes, salida DXF) NO forma parte de esta
   plantilla: es propiedad del autor y no se distribuye.

   Se conserva la API para que el flujo completo (configurador -> carrito ->
   checkout -> webhook) funcione de punta a punta:
       generatePlanFile(params)  ->  Blob   (DXF vacío de marcador, sin geometría)
       planFilenameFor(params)   ->  string (nombre de archivo ya saneado)
   ========================================================================== */

function generatePlanFile(params) {
  const p = sanitizePartConfig(params);
  const text = [
    '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', '0', 'ENDSEC',
    '999', 'PLACEHOLDER - manufacturing export is disabled in the public template',
    '0', 'EOF', '',
  ].join('\n');
  void p;
  return new Blob([text], { type: 'application/dxf' });
}

function planFilenameFor(params) {
  const p = sanitizePartConfig(params);
  return Utils.safeFileName(`IWT_${Utils.slug(p.reference)}_${p.material}_${Number(p.thickness)}mm_${Math.round(p.width)}x${Math.round(p.length)}.dxf`);
}
