/* ==========================================================================
   [YOUR_COMPANY] · Puente de exportación 3D para checkout.html (módulo ES)
   --------------------------------------------------------------------------
   checkout.js es un script clásico; Three.js solo se puede importar desde un
   módulo. Este puente expone window.IwtPartExport.stl(cfg) -> Blob
   (STL binario en mm, generado en memoria con el mismo motor que los
   visores) y avisa con el evento 'iwt:part-export-ready'.
   ========================================================================== */
import * as THREE from 'three';
import { partToSTL } from './part-export.js';

window.IwtPartExport = {
  stl: (cfg) => partToSTL(THREE, cfg),
};
window.dispatchEvent(new CustomEvent('iwt:part-export-ready'));
