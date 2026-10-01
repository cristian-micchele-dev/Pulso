import { pdfDeMuestra } from './seed-demo';
import { sniffFileType } from '../shared/infra/files/sniff';

describe('pdfDeMuestra', () => {
  it('produce un PDF que el backend reconoce como tal', () => {
    // El servidor no confia en el nombre ni en el Content-Type: olfatea los
    // primeros bytes. Un archivo de mentira terminado en .pdf seria rechazado
    // por la misma validacion que protege a produccion, y el seed dejaria filas
    // apuntando a basura.
    expect(sniffFileType(pdfDeMuestra('Electrocardiograma'))).toBe('application/pdf');
  });

  it('tiene la estructura minima que un lector espera', () => {
    const pdf = pdfDeMuestra('Radiografia').toString('latin1');

    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('xref');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('la tabla xref apunta a donde empieza cada objeto', () => {
    // Si los desplazamientos no coinciden, el archivo abre en algunos lectores
    // y en otros no. Es el error clasico al armar un PDF a mano.
    const pdf = pdfDeMuestra('Dermatoscopia').toString('latin1');
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));

    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, i) => {
      expect(pdf.slice(offset)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
  });

  it('escapa los parentesis, que en PDF delimitan texto', () => {
    // Un titulo con parentesis sin escapar corta la cadena y rompe el archivo.
    const pdf = pdfDeMuestra('Estudio (control) anual').toString('latin1');

    expect(pdf).toContain('(Estudio control anual)');
  });
});
