/* Genera el hash scrypt para EMPLOYEE_PASSWORD_HASH:  npm run hash-password -- "tu clave de más de 12 caracteres" */
const { hashPassword } = require('./security');

try {
  console.log(hashPassword(process.argv[2] || ''));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
