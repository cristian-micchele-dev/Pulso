/**
 * Un PDF mínimo pero VÁLIDO, armado a mano.
 *
 * Vive acá y no en el seed que lo usa porque armar un PDF correcto es lógica
 * —la tabla `xref` tiene que apuntar a donde empieza cada objeto o el archivo
 * abre en unos lectores y en otros no—, y la lógica se prueba. El seed es un
 * script que se corre a mano; esto no.
 *
 * El backend no confía en el tipo que declara el cliente: olfatea los primeros
 * bytes (`sniffFileType`). Un archivo de mentira con el nombre terminado en
 * `.pdf` sería rechazado, igual que lo sería en producción. Así que la muestra
 * tiene que ser un PDF de verdad, aunque sea el más chico posible.
 */
export function pdfDeMuestra(titulo: string): Buffer {
  const texto = `BT /F1 14 Tf 60 740 Td (${titulo.replace(/[()\\]/g, '')}) Tj ET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${texto.length} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let cuerpo = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(cuerpo.length);
    cuerpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });

  const inicioTabla = cuerpo.length;
  cuerpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) cuerpo += `${String(o).padStart(10, '0')} 00000 n \n`;
  cuerpo += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioTabla}\n%%EOF\n`;

  return Buffer.from(cuerpo, 'latin1');
}
