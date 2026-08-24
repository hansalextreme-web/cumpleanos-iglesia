const XLSX = require('xlsx');
const fs = require('fs');

const wb = XLSX.readFile('Directorio iglesia Piedra Viva 2026.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, { range: 11 });

const records = data.filter(r => r['NOMBRES']).map(r => {
  let c = r['CUMPLEAÑOS'] || '';
  if (typeof c === 'number') {
    const d = XLSX.SSF.parse_date_code(c);
    c = d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0');
  } else if (c instanceof Date) {
    c = c.toISOString().slice(0, 10);
  } else {
    c = String(c || '');
  }
  
  let t = r['TELEFONOS'] || '';
  t = String(t).replace(/\.0$/, '');
  if (t === 'undefined' || t === 'NaN' || t === 'nan') t = '';
  
  let co = r['CORREO ELECTRONICO'] || '';
  co = String(co).trim();
  if (co === 'undefined' || co === 'NaN' || co === 'nan') co = '';
  
  let pr = r['PROFESION'] || '';
  pr = String(pr).trim();
  if (pr === 'undefined' || pr === 'NaN' || pr === 'nan') pr = '';
  
  let di = r['DIRECCION'] || '';
  di = String(di).trim();
  if (di === 'undefined' || di === 'NaN' || di === 'nan') di = '';
  
  let ap = r['APELLIDOS'] || '';
  ap = String(ap).trim();
  if (ap === 'undefined' || ap === 'NaN' || ap === 'nan') ap = '';
  
  return {
    nombres: String(r['NOMBRES']).trim(),
    apellidos: ap,
    telefono: t,
    direccion: di,
    profesion: pr,
    cumpleanos: c,
    correo: co
  };
});

let output = '';
output += '// directorio.js – Datos precargados del directorio de la iglesia Piedra Viva\n';
output += '// Total de registros: ' + records.length + '\n';
output += 'const directorioIglesia = ' + JSON.stringify(records, null, 2) + ';\n\n';
output += `// Transformar al formato interno que usa la app (nombre, dia, mes, anio…)
function transformarDirectorio(datos) {
  return datos.map(p => {
    const partes = p.cumpleanos ? p.cumpleanos.split("-") : [];
    return {
      nombre: (p.nombres + " " + p.apellidos).trim(),
      dia: partes.length === 3 ? parseInt(partes[2], 10) : 0,
      mes: partes.length === 3 ? parseInt(partes[1], 10) : 0,
      anio: partes.length === 3 ? parseInt(partes[0], 10) : 0,
      telefono: p.telefono || "",
      direccion: p.direccion || "",
      profesion: p.profesion || "",
      correo: p.correo || ""
    };
  });
}

export { directorioIglesia, transformarDirectorio };
`;

fs.writeFileSync('directorio.js', output, 'utf8');
console.log('directorio.js written successfully with', records.length, 'records, using utf8 encoding.');
