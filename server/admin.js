// Herramienta de administración del almacenamiento (solo terminal, nunca expuesta en la web).
//   npm run admin -- stats
//   npm run admin -- list <uid>
//   npm run admin -- purge --uid <uid> --yes
//   npm run admin -- purge --all --yes
import { STORAGE_ROOT } from "./config.js";
import { assertVolumeMounted, listUsers, listUserFiles, purgeUser, purgeAll } from "./storage.js";

const [command, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

try {
  assertVolumeMounted();
  if (command === "stats") {
    const users = await listUsers();
    console.log(`Raíz: ${STORAGE_ROOT}`);
    console.log(`Usuarios: ${users.length} · Archivos: ${users.reduce((n, u) => n + u.files, 0)} · Total: ${mb(users.reduce((n, u) => n + u.bytes, 0))}`);
    users.forEach((u) => console.log(`  ${u.uid}  ${u.files} archivos  ${mb(u.bytes)}`));
  } else if (command === "list") {
    const uid = args[0];
    (await listUserFiles(uid)).forEach((f) => console.log(`  ${f.name}  ${mb(f.bytes)}`));
  } else if (command === "purge") {
    if (!flag("--yes")) throw new Error("La purga es irreversible: añade --yes para confirmar.");
    if (flag("--all")) {
      await purgeAll();
      console.log("Purgado todo el almacenamiento de usuarios.");
    } else if (option("--uid")) {
      await purgeUser(option("--uid"));
      console.log(`Purgada la carpeta de ${option("--uid")}.`);
    } else {
      throw new Error("Indica --uid <uid> o --all.");
    }
  } else {
    console.log("Uso: npm run admin -- stats | list <uid> | purge --uid <uid> --yes | purge --all --yes");
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
