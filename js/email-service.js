/* ==========================================================================
   [YOUR_COMPANY] · Procesado de pedido y envío a Oficina Técnica
   --------------------------------------------------------------------------
   processOrderAndSendEmail(formData, planBlob)
     formData : { ...camposFacturación, order: { id, items, totals, payment } }
     planBlob : Blob | File | Array<{ blob: Blob, filename: string }>
                (el archivo real de fabricación; el copy nunca nombra su
                formato de cara al cliente — ver js/plan-generator.js)
   Proveedor configurable en js/config.js -> EMAIL_CONFIG.provider
     'simulate' | 'emailjs' | 'rest'
   Depende de: js/config.js, js/pricing.js
   ========================================================================== */

async function processOrderAndSendEmail(formData, planBlob) {
  const cfg = EMAIL_CONFIG;
  const attachments = normalizeAttachments(planBlob, formData?.order?.id);
  if (!formData || !formData.email) throw new Error('Faltan los datos de facturación.');
  if (attachments.length === 0) throw new Error('No hay documentación técnica que enviar.');

  const email = buildOrderEmail(formData, attachments);

  let result;
  switch (cfg.provider) {
    case 'emailjs':
      result = await sendViaEmailJS(formData, attachments, email);
      break;
    case 'rest':
      result = await sendViaREST(formData, attachments, email);
      break;
    default:
      result = await simulateSend(formData, attachments, email);
  }

  return {
    ok: true,
    provider: cfg.provider,
    orderId: formData.order?.id,
    sentTo: cfg.officeEmail,
    attachments: attachments.map((a) => ({ filename: a.filename, size: a.blob.size })),
    message: 'Pedido procesado. Tu fabricación ya está en marcha.',
    ...result,
  };
}

/* --------------------------------------------------------------------------
   Normalización de adjuntos
   -------------------------------------------------------------------------- */
function normalizeAttachments(input, orderId = 'pedido') {
  const list = Array.isArray(input) ? input : (input ? [input] : []);
  return list.map((entry, i) => {
    if (entry instanceof Blob) {
      return { blob: entry, filename: entry.name || `${orderId}_plano_${i + 1}.dxf` };
    }
    if (entry && entry.blob instanceof Blob) {
      return { blob: entry.blob, filename: entry.filename || `${orderId}_plano_${i + 1}.dxf` };
    }
    return null;
  }).filter(Boolean);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/* --------------------------------------------------------------------------
   Cuerpo del email (texto plano + HTML). Recorre BILLING_FIELDS, así que
   cualquier campo nuevo aparece automáticamente en el correo.
   -------------------------------------------------------------------------- */
function buildOrderEmail(formData, attachments) {
  const order = formData.order || {};
  const esc = Utils.escapeHTML;

  const billingRows = BILLING_FIELDS.map((f) => [f.label, formData[f.name] ?? '']);
  const billingText = billingRows.map(([k, v]) => `${k}: ${v}`).join('\n');
  const billingHTML = billingRows
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`)
    .join('');

  const items = order.items || [];
  const machineLabel = (it) => it.machine?.label || it.quote?.machine?.label || 'Sin asignar';
  const itemsText = items.map((it, i) => {
    const c = it.config;
    return `${i + 1}. ${c.reference} — ${PRICING.materials[c.material].label} ${c.thickness} mm — `
      + `${c.width}×${c.length} mm — ${c.bends.length} pliegues — ${c.cuts.length} cortes — ${c.quantity} uds — ${machineLabel(it)} — ${Utils.money(it.quote.subtotal)}`
      + (c.notes ? `\n   Notas: ${c.notes}` : '');
  }).join('\n');
  const itemsHTML = items.map((it) => {
    const c = it.config;
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(c.reference)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(PRICING.materials[c.material].short)} ${c.thickness} mm</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${c.width}×${c.length} mm</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${c.bends.length} pliegues · ${c.cuts.length} cortes</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(machineLabel(it))}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${c.quantity}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${Utils.money(it.quote.subtotal)}</td></tr>`;
  }).join('');

  const t = order.totals || {};
  const totalsText = `Subtotal: ${Utils.money(t.subtotal)} | Portes: ${Utils.money(t.shipping)} | `
    + `IVA: ${Utils.money(t.vat)} | TOTAL: ${Utils.money(t.total)}`;
  const paymentText = order.payment
    ? `${order.payment.label}${order.payment.cardLast4 ? ` (•••• ${order.payment.cardLast4})` : ''}`
    : '';

  const subject = `[${COMPANY.name}] Nuevo pedido ${order.id} · ${formData.company || formData.fullName}`;

  const text = [
    `NUEVO PEDIDO ${order.id}`,
    `Fecha: ${new Date(order.createdAt || Date.now()).toLocaleString(PRICING.locale)}`,
    '', '— DATOS DE FACTURACIÓN —', billingText,
    '', '— PIEZAS —', itemsText,
    '', '— TOTALES —', totalsText,
    `Forma de pago: ${paymentText}`,
    '', `Planos adjuntos: ${attachments.map((a) => a.filename).join(', ')}`,
  ].join('\n');

  const html = `
  <div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:680px">
    <h2 style="margin:0 0 4px">Nuevo pedido ${esc(order.id)}</h2>
    <p style="margin:0 0 16px;color:#666">${esc(new Date(order.createdAt || Date.now()).toLocaleString(PRICING.locale))}</p>
    <h3>Datos de facturación</h3><table>${billingHTML}</table>
    <h3>Piezas</h3>
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#f4f4f4"><th align="left" style="padding:6px 8px">Ref.</th><th align="left" style="padding:6px 8px">Material</th>
      <th align="left" style="padding:6px 8px">Desarrollo</th><th align="left" style="padding:6px 8px">Plegado</th>
      <th align="left" style="padding:6px 8px">Línea</th>
      <th align="left" style="padding:6px 8px">Uds</th><th align="right" style="padding:6px 8px">Importe</th></tr>
      ${itemsHTML}
    </table>
    <p style="margin-top:16px">${esc(totalsText)}<br>Forma de pago: <b>${esc(paymentText)}</b></p>
    <p style="color:#666">Planos adjuntos: ${attachments.map((a) => esc(a.filename)).join(', ')}</p>
  </div>`;

  return { subject, text, html, billingText, itemsText, totalsText, paymentText };
}

/* --------------------------------------------------------------------------
   Proveedor 1 · SIMULACIÓN (por defecto)
   -------------------------------------------------------------------------- */
async function simulateSend(formData, attachments, email) {
  await new Promise((r) => setTimeout(r, 1400));
  /* eslint-disable no-console */
  console.groupCollapsed(`%c[IWT] Email simulado → ${EMAIL_CONFIG.officeEmail}`, 'color:#6eacdf;font-weight:bold');
  console.log('Asunto:', email.subject);
  console.log(email.text);
  console.table(attachments.map((a) => ({ archivo: a.filename, bytes: a.blob.size, tipo: a.blob.type })));
  if (EMAIL_CONFIG.sendCustomerConfirmation) console.log('Confirmación al cliente →', formData.email);
  console.groupEnd();
  return { simulated: true };
}

/* --------------------------------------------------------------------------
   Proveedor 2 · EMAILJS  (envío directo desde el navegador)
   Plantilla de Oficina Técnica en EmailJS:
     To Email:  {{to_email}}      Reply To: {{reply_to}}
     Subject:   {{subject}}
     Content:   {{{message_html}}}   (triple llave = HTML sin escapar)
     Attachments -> "Variable Attachment": parámetro plan_attachment_1,
                    plan_attachment_2 ... (tantos como maxAttachments),
                    Content type: application/dxf, Filename: {{plan_filename_1}}
   Todos los campos de facturación viajan también como billing_<name>.
   -------------------------------------------------------------------------- */
async function loadEmailJS() {
  if (window.emailjs) return window.emailjs;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = EMAIL_CONFIG.emailjs.sdkUrl;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar el SDK de EmailJS'));
    document.head.appendChild(s);
  });
  window.emailjs.init({ publicKey: EMAIL_CONFIG.emailjs.publicKey });
  return window.emailjs;
}

async function sendViaEmailJS(formData, attachments, email) {
  const ejs = await loadEmailJS();
  const c = EMAIL_CONFIG.emailjs;
  const order = formData.order || {};

  const base = {
    order_id: order.id,
    subject: email.subject,
    message: email.text,
    message_html: email.html,
    billing_table: email.billingText,
    order_items: email.itemsText,
    order_totals: email.totalsText,
    payment_method: email.paymentText,
    total: Utils.money(order.totals?.total),
    company_name: COMPANY.name,
  };
  BILLING_FIELDS.forEach((f) => { base[`billing_${f.name}`] = formData[f.name] ?? ''; });

  const files = {};
  const limited = attachments.slice(0, c.maxAttachments);
  for (let i = 0; i < limited.length; i++) {
    files[`plan_attachment_${i + 1}`] = await blobToDataURL(limited[i].blob);
    files[`plan_filename_${i + 1}`] = limited[i].filename;
  }
  if (attachments.length > c.maxAttachments) {
    console.warn(`[IWT] EmailJS: solo se adjuntan ${c.maxAttachments} planos. Usa provider 'rest' para más.`);
  }

  // 1) Oficina Técnica (con planos)
  await ejs.send(c.serviceId, c.templateOffice, {
    ...base, ...files,
    to_email: EMAIL_CONFIG.officeEmail,
    to_name: EMAIL_CONFIG.officeName,
    reply_to: formData.email,
  });

  // 2) Confirmación al cliente
  if (EMAIL_CONFIG.sendCustomerConfirmation && c.templateCustomer) {
    await ejs.send(c.serviceId, c.templateCustomer, {
      ...base,
      ...(EMAIL_CONFIG.attachPlansToCustomer ? files : {}),
      to_email: formData.email,
      to_name: formData.fullName,
      reply_to: COMPANY.email,
    });
  }
  return { emailjs: true };
}

/* --------------------------------------------------------------------------
   Proveedor 3 · REST  (tu backend: /server/index.js incluido como ejemplo)
   Envía multipart/form-data:
     order -> JSON { billing, order, email:{subject,text,html}, config }
     plans -> ficheros de fabricación (uno por pieza)
   -------------------------------------------------------------------------- */
async function sendViaREST(formData, attachments, email) {
  const { order, ...billing } = formData;
  const body = new FormData();
  body.append('order', JSON.stringify({
    billing,
    order,
    email,
    officeEmail: EMAIL_CONFIG.officeEmail,
    sendCustomerConfirmation: EMAIL_CONFIG.sendCustomerConfirmation,
    attachPlansToCustomer: EMAIL_CONFIG.attachPlansToCustomer,
  }));
  attachments.forEach((a) => body.append('plans', a.blob, a.filename));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(EMAIL_CONFIG.rest.endpoint, {
      method: 'POST',
      headers: { ...EMAIL_CONFIG.rest.headers },   // NO fijar Content-Type: lo pone el navegador (boundary)
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`El servidor respondió ${res.status}. ${detail.slice(0, 200)}`);
    }
    return { rest: true, server: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
}
