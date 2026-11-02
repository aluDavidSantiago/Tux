// Tux · panel de administración: pruebas multimedia, publicaciones reportadas, planes, usuarios y
// cuentas (desactivar / eliminar con borrado físico en el HDD), notificaciones y servidor multimedia.
// La interfaz solo se muestra a admins, pero los permisos reales los imponen las reglas de
// Firestore (admins/{uid}) y el servidor del HDD.
import { CATEGORIES, millis } from "../../src/activities.js";
import { signInWithGoogle, signInWithEmail, logOut, watchSession, authErrorMessage } from "../../src/auth.js";
import {
  isAdminUser, listProofs, listActivities, listUsers, listSentNotifications,
  adminRemoveProofMedia, adminDeleteProof, adminDeleteActivity, sendNotification,
  listReports, adminDismissReports, adminDeleteReportedProof,
  listDisabledUsers, adminDisableUser, adminEnableUser, adminDeleteAccount
} from "../../src/admin.js";
import { reportLabel } from "../../src/reports.js";
import {
  resolveMediaUrl, mediaThumbUrl, isEquirectangular, checkMediaServer, startMediaSession, stopMediaSession, onMediaAccessChange
} from "../../src/media.js";
import {
  DEFAULT_MEDIA_SERVER, mediaServerUrl, mediaServerSource, normalizeServerUrl, publishMediaServerUrl
} from "../../src/mediaConfig.js";
import { NOTIFICATION_KINDS } from "../../src/notifications.js";
import { $, h, svgUse, tuxLogo, timeAgo, toast, setLoading, initModals, confirmDialog } from "../js/ui.js";
import { initViewer, openViewer } from "../js/viewer.js";

const NOTIFY_TEMPLATES = {
  "360": {
    kind: "360",
    title: "Cómo subir tus fotos y vídeos 360°",
    body: "Para que tu prueba se vea en la Galería VR, súbela en formato equirectangular (proporción 2:1). " +
      "En Insta360 Studio o la app de Insta360 usa «Exportar» → «Foto/Vídeo 360°» (no «reencuadrado» ni «plano»). " +
      "Los archivos exportados así (por ejemplo 6080×3040 o 5760×2880) se abren automáticamente en el visor inmersivo."
  },
  removed: {
    kind: "warning",
    title: "Hemos retirado una de tus pruebas",
    body: "Una de tus pruebas multimedia no cumplía el formato y la hemos retirado. Tu plan vuelve a estar «En curso»: " +
      "puedes subir una nueva prueba desde Mis planes cuando quieras."
  }
};

const state = {
  user: null,
  tab: "proofs",
  proofFilter: "all",
  proofs: [],
  activities: [],
  users: [],
  sent: [],
  storageOk: null,
  tunnelUrl: "",
  reports: [],
  disabled: new Map(),   // uid → disabledUsers/{uid}
  userQuery: "",
  userFilter: "all",
  notifyTo: "all"
};

const main = $("#admin-main");
initModals();
initViewer();

const userName = (uid) => state.users.find((u) => u.id === uid)?.nickname || uid.slice(0, 8);
const fmtDate = (ts) => (millis(ts) ? new Date(millis(ts)).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }) : "—");

/* ---------- Acceso ---------- */
function renderGate(message) {
  const error = h("p", { class: "form-error", role: "alert" });
  const form = h("form", { class: "form", novalidate: true },
    h("label", { class: "field" }, h("span", { text: "Email" }), h("input", { type: "email", name: "email", autocomplete: "email", required: true })),
    h("label", { class: "field" }, h("span", { text: "Contraseña" }), h("input", { type: "password", name: "password", autocomplete: "current-password", required: true })),
    error,
    h("button", { class: "primary-btn", type: "submit" }, "Entrar")
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await signInWithEmail(form.email.value, form.password.value);
    } catch (err) {
      error.textContent = authErrorMessage(err);
    }
  });
  main.replaceChildren(h("section", { class: "admin-gate" },
    tuxLogo("gate-mark"),
    h("h1", { text: "Panel de administración" }),
    h("p", { class: "gate-sub", text: message || "Inicia sesión con una cuenta de administrador." }),
    h("button", {
      class: "google-btn", type: "button",
      onclick: async () => {
        try {
          await signInWithGoogle();
        } catch (err) {
          error.textContent = authErrorMessage(err);
        }
      }
    }, "Continuar con Google"),
    h("div", { class: "divider" }, h("span", { text: "o con tu email" })),
    form
  ));
}

function renderRestricted(user) {
  main.replaceChildren(h("section", { class: "admin-gate" },
    h("div", { class: "confirm-icon danger" }, svgUse("i-shield")),
    h("h1", { text: "Acceso restringido" }),
    h("p", { class: "gate-sub", text: "Esta cuenta no es administradora de Tux." }),
    h("div", { class: "gate-steps" },
      h("p", { text: "Para darte de alta como admin:" }),
      h("ol", {},
        h("li", { text: "Abre la consola de Firebase → Firestore Database." }),
        h("li", {}, "Crea la colección ", h("code", { text: "admins" }), " (si no existe)."),
        h("li", {}, "Añade un documento cuyo ID sea tu UID y un campo ", h("code", { text: "role = \"admin\"" }), "."),
        h("li", { text: "Recarga esta página." })
      ),
      h("div", { class: "uid-row" },
        h("span", {}, h("small", { text: "Tu UID" }), h("code", { text: user.uid })),
        h("button", { class: "icon-action", type: "button", "aria-label": "Copiar UID", onclick: () => navigator.clipboard.writeText(user.uid).then(() => toast("UID copiado")) }, svgUse("i-copy"))
      )
    ),
    h("button", { class: "ghost-btn", type: "button", onclick: () => logOut() }, "Cambiar de cuenta")
  ));
}

function renderUserChip() {
  const box = $("#admin-user");
  if (!state.user) return box.replaceChildren();
  box.replaceChildren(
    h("span", { class: "admin-user-name", text: state.user.email || state.user.displayName || "Admin" }),
    h("button", { class: "icon-action", type: "button", "aria-label": "Cerrar sesión", onclick: () => logOut() }, svgUse("i-logout"))
  );
}

watchSession(async (user) => {
  state.user = user;
  renderUserChip();
  if (!user) {
    stopMediaSession();
    return renderGate();
  }
  main.replaceChildren(h("div", { class: "admin-loading" }, tuxLogo("loading-mark")));
  if (!(await isAdminUser(user.uid))) return renderRestricted(user);
  startMediaSession(user);
  await loadAll();
});

// Las miniaturas del HDD necesitan el ticket de lectura: se repinta cuando llega.
onMediaAccessChange(() => state.proofs.length && render());

/* ---------- Datos ---------- */
async function loadAll() {
  try {
    const [proofs, activities, users, sent, storage, local, reports, disabled] = await Promise.all([
      listProofs(), listActivities(), listUsers(), listSentNotifications().catch(() => []), checkMediaServer(),
      // En el propio Mac mini: el servidor local anuncia la URL del túnel activo.
      mediaServerUrl() === DEFAULT_MEDIA_SERVER ? null : checkMediaServer(DEFAULT_MEDIA_SERVER),
      listReports().catch(() => []), listDisabledUsers().catch(() => [])
    ]);
    const tunnelUrl = normalizeServerUrl(local?.publicUrl || storage.publicUrl);
    Object.assign(state, {
      proofs, activities, users, sent, storageOk: storage.ok, tunnelUrl, reports,
      disabled: new Map(disabled.map((d) => [d.id, d]))
    });
    render();
  } catch (err) {
    console.error(err);
    main.replaceChildren(h("p", { class: "list-empty", text: `No se pudieron cargar los datos: ${err.message}` }));
  }
}

/* ---------- Estructura ---------- */
const TABS = [
  { id: "proofs", label: "Pruebas multimedia" },
  { id: "reports", label: "Reportadas" },
  { id: "plans", label: "Planes" },
  { id: "users", label: "Usuarios y cuentas" },
  { id: "notify", label: "Notificaciones" },
  { id: "server", label: "Servidor multimedia" }
];

function statCard(value, label, accent = false) {
  return h("div", { class: `admin-stat${accent ? " accent" : ""}` }, h("b", { text: value }), h("span", { text: label }));
}

function render() {
  const p360 = state.proofs.filter((p) => p.is360).length;
  const views = {
    proofs: renderProofs, reports: renderReports, plans: renderPlans, users: renderUsers, notify: renderNotify, server: renderServer
  };
  const pendingReports = new Set(state.reports.map((r) => r.proofId)).size;
  main.replaceChildren(
    h("section", { class: "admin-stats" },
      statCard(state.users.length, "Usuarios"),
      statCard(state.activities.length, "Planes publicados"),
      statCard(state.proofs.length, "Pruebas"),
      statCard(p360, "Pruebas 360°", true),
      statCard(pendingReports, "Publicaciones reportadas", pendingReports > 0),
      h("div", { class: `admin-stat storage ${state.storageOk ? "ok" : "off"}` },
        h("b", { text: state.storageOk ? "HDD conectado" : "HDD no disponible" }),
        h("span", { text: "Servidor de almacenamiento" }))
    ),
    h("nav", { class: "tab-chips admin-tabs", role: "tablist" },
      TABS.map((t) => h("button", {
        type: "button", role: "tab", class: `tab-chip${t.id === state.tab ? " is-active" : ""}`,
        onclick: () => { state.tab = t.id; render(); }
      }, t.label, t.id === "reports" && pendingReports > 0 && h("span", { class: "tab-count", text: pendingReports }))),
      h("button", { class: "tab-chip refresh", type: "button", "aria-label": "Recargar", onclick: loadAll }, svgUse("i-refresh"))
    ),
    views[state.tab]()
  );
}

/* ---------- Pruebas multimedia ---------- */
const PROOF_FILTERS = [
  { id: "all", label: "Todas", test: () => true },
  { id: "360", label: "360°", test: (p) => p.is360 },
  { id: "flat", label: "Planas", test: (p) => !p.is360 },
  { id: "video", label: "Vídeo", test: (p) => p.type === "video" },
  { id: "suspect", label: "A revisar", test: (p) => proofWarning(p) }
];

// Incoherencias entre la marca 360° y la proporción real del archivo.
function proofWarning(p) {
  const equi = isEquirectangular(p.width, p.height);
  if (!p.is360 && equi) return "Parece 360° (2:1) pero está marcada como plana";
  if (p.is360 && p.width && !equi) return "Marcada como 360° pero no es 2:1";
  return "";
}

async function guarded(button, action, success) {
  setLoading(button, true);
  try {
    await action();
    toast(success);
    await loadAll();
  } catch (err) {
    console.error(err);
    toast(err.message || "La operación ha fallado.");
    setLoading(button, false);
  }
}

function proofCard(p) {
  const warning = proofWarning(p);
  const thumb = mediaThumbUrl(p) || resolveMediaUrl(p.url);
  const view = () => openViewer({
    url: resolveMediaUrl(p.url), type: p.type, is360: p.is360, title: p.activityTitle,
    sub: `@${p.authorName} · ${p.width}×${p.height}`
  });
  return h("article", { class: "admin-card" },
    h("button", { class: "admin-thumb", type: "button", "aria-label": "Previsualizar", onclick: view },
      thumb ? h("img", { src: thumb, alt: "", loading: "lazy" }) : h("span", { class: "thumb-empty" }, svgUse("i-image-off")),
      h("span", { class: "thumb-badges" },
        p.is360 && h("span", { class: "badge-360" }, svgUse("i-orbit"), "360°"),
        p.type === "video" && h("span", { class: "badge-360" }, "Vídeo")
      )
    ),
    h("div", { class: "admin-card-body" },
      h("b", { text: p.activityTitle }),
      h("small", { text: `@${p.authorName} · ${timeAgo(p.createdAt)} · ${p.width}×${p.height}` }),
      p.caption && h("p", { class: "admin-caption", text: `“${p.caption}”` }),
      warning && h("span", { class: "admin-warning", text: warning })
    ),
    h("div", { class: "admin-actions" },
      h("button", { class: "ghost-btn small", type: "button", onclick: view }, svgUse("i-eye"), "Ver"),
      h("button", {
        class: "ghost-btn small", type: "button",
        onclick: async (e) => {
          const btn = e.currentTarget;
          const ok = await confirmDialog({
            title: "Quitar solo la prueba",
            message: `Se borrará el archivo del HDD y el registro. El plan de @${p.authorName} volverá a «En curso».`,
            confirmLabel: "Quitar prueba", icon: "i-image-off"
          });
          if (ok) guarded(btn, () => adminRemoveProofMedia(p, state.user), "Prueba retirada");
        }
      }, svgUse("i-image-off"), "Quitar prueba"),
      h("button", {
        class: "ghost-btn small danger", type: "button",
        onclick: async (e) => {
          const btn = e.currentTarget;
          const ok = await confirmDialog({
            title: "Eliminar publicación",
            message: "Se borrará el archivo físico del HDD, el registro de la prueba y su entrada en el historial del usuario.",
            confirmLabel: "Eliminar"
          });
          if (ok) guarded(btn, () => adminDeleteProof(p, state.user), "Publicación eliminada");
        }
      }, svgUse("i-trash"), "Eliminar"),
      h("button", {
        class: "icon-action", type: "button", "aria-label": "Notificar al autor",
        onclick: () => prefillNotify(p.uid, warning ? "360" : "removed")
      }, svgUse("i-bell"))
    )
  );
}

function renderProofs() {
  const filter = PROOF_FILTERS.find((f) => f.id === state.proofFilter);
  const items = state.proofs.filter(filter.test);
  return h("section", {},
    h("div", { class: "chips admin-filters" }, PROOF_FILTERS.map((f) => h("button", {
      class: `chip${f.id === state.proofFilter ? " is-active" : ""}`, type: "button",
      onclick: () => { state.proofFilter = f.id; render(); }
    }, f.label, h("small", { text: String(state.proofs.filter(f.test).length) })))),
    items.length
      ? h("div", { class: "admin-grid" }, items.map(proofCard))
      : h("p", { class: "list-empty", text: "No hay pruebas con este filtro." })
  );
}

/* ---------- Planes ---------- */
function renderPlans() {
  if (!state.activities.length) return h("p", { class: "list-empty", text: "No hay planes publicados." });
  return h("div", { class: "admin-table" },
    h("div", { class: "admin-tr head" }, ["Plan", "Autor", "Vibe", "Apuntados", "Comentarios", "Fecha", ""].map((t) => h("span", { text: t }))),
    state.activities.map((a) => h("div", { class: "admin-tr" },
      h("span", { class: "cell-title" }, h("b", { text: a.title }), a.seed && h("span", { class: "reason-chip", text: "prueba" })),
      h("span", { "data-label": "Autor", text: `@${a.authorName || userName(a.authorId)}` }),
      h("span", { "data-label": "Vibe", text: CATEGORIES[a.category]?.label || a.category }),
      h("span", { "data-label": "Apuntados", text: String(a.likeCount || 0) }),
      h("span", { "data-label": "Comentarios", text: String(a.commentCount || 0) }),
      h("span", { "data-label": "Fecha", text: fmtDate(a.createdAt) }),
      h("span", { class: "cell-actions" },
        h("a", { class: "icon-action", href: `../#plan=${a.id}`, target: "_blank", rel: "noopener", "aria-label": "Abrir en Tux" }, svgUse("i-external")),
        h("button", {
          class: "ghost-btn small danger", type: "button",
          onclick: async (e) => {
            const btn = e.currentTarget;
            const ok = await confirmDialog({
              title: "Eliminar publicación",
              message: `"${a.title}" desaparecerá del feed para todos los usuarios.`,
              confirmLabel: "Eliminar"
            });
            if (ok) guarded(btn, () => adminDeleteActivity(a.id), "Plan eliminado");
          }
        }, svgUse("i-trash"), "Eliminar")
      )
    ))
  );
}

/* ---------- Usuarios ---------- */
const USER_FILTERS = [
  { id: "all", label: "Todas", test: () => true },
  { id: "active", label: "Activas", test: (u) => !state.disabled.has(u.id) },
  { id: "disabled", label: "Desactivadas", test: (u) => state.disabled.has(u.id) }
];

function renderUsers() {
  const proofsBy = (uid) => state.proofs.filter((p) => p.uid === uid).length;
  const plansBy = (uid) => state.activities.filter((a) => a.authorId === uid).length;
  const needle = state.userQuery.trim().toLowerCase();
  const filter = USER_FILTERS.find((f) => f.id === state.userFilter);
  const users = [...state.users]
    .filter((u) => !needle || (u.nickname || "").toLowerCase().includes(needle) || u.id.toLowerCase().includes(needle))
    .filter(filter.test)
    .sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
  // Cuentas eliminadas: ya no tienen users/{uid}, pero su bloqueo sigue en disabledUsers.
  const deleted = [...state.disabled.values()].filter((d) => d.deleted && !state.users.some((u) => u.id === d.id));

  const search = h("input", {
    type: "search", class: "admin-select", placeholder: "Buscar por nickname o UID", value: state.userQuery,
    oninput: (e) => {
      state.userQuery = e.target.value;
      const caret = e.target.selectionStart;
      render();
      const again = $(".admin-users-search input");
      again?.focus();
      again?.setSelectionRange(caret, caret);
    }
  });

  return h("section", {},
    h("div", { class: "admin-users-search" }, search,
      h("div", { class: "chips admin-filters" }, USER_FILTERS.map((f) => h("button", {
        class: `chip${f.id === state.userFilter ? " is-active" : ""}`, type: "button",
        onclick: () => { state.userFilter = f.id; render(); }
      }, f.label, h("small", { text: String(state.users.filter(f.test).length) }))))),
    h("p", { class: "form-hint", text: "Desactivar bloquea la cuenta (no puede publicar, chatear ni ver archivos del HDD) y es reversible. Eliminar borra su carpeta del HDD, sus publicaciones, seguidores, chats y perfil; la cuenta de acceso queda bloqueada." }),
    users.length
      ? h("div", { class: "admin-table users" },
          h("div", { class: "admin-tr head" }, ["Usuario", "UID", "Registro", "Pruebas", "Planes", ""].map((t) => h("span", { text: t }))),
          users.map((u) => userRow(u, proofsBy(u.id), plansBy(u.id))))
      : h("p", { class: "list-empty", text: "Ningún usuario coincide." }),
    deleted.length > 0 && h("h3", { class: "admin-subtitle", text: `Cuentas eliminadas (${deleted.length})` }),
    deleted.length > 0 && h("div", { class: "admin-table users" }, deleted.map((d) => h("div", { class: "admin-tr" },
      h("span", { class: "cell-title" }, h("b", { text: d.nickname || "—" }), h("span", { class: "status-chip off", text: "Eliminada" })),
      h("span", { "data-label": "UID", class: "cell-uid" }, h("code", { text: d.id })),
      h("span", { "data-label": "Fecha", text: fmtDate(d.createdAt) }),
      h("span", {}), h("span", {}),
      h("span", { class: "cell-actions" },
        h("button", {
          class: "ghost-btn small", type: "button", title: "Permite volver a registrarse con la misma cuenta",
          onclick: (e) => guarded(e.currentTarget, () => adminEnableUser(d.id), "Bloqueo retirado")
        }, "Desbloquear acceso"))
    )))
  );
}

function userRow(u, proofs, plans) {
  const off = state.disabled.get(u.id);
  const self = u.id === state.user.uid;
  return h("div", { class: `admin-tr${off ? " is-disabled" : ""}` },
    h("span", { class: "cell-title" },
      h("span", { class: "avatar mini", dataset: { color: u.avatarColor || "orange" } }, tuxLogo("avatar-tux")),
      h("b", { text: u.nickname || "—" }),
      off && h("span", { class: "status-chip off", text: "Desactivada" })),
    h("span", { "data-label": "UID", class: "cell-uid" },
      h("code", { text: u.id }),
      h("button", { class: "icon-action", type: "button", "aria-label": "Copiar UID", onclick: () => navigator.clipboard.writeText(u.id).then(() => toast("UID copiado")) }, svgUse("i-copy"))),
    h("span", { "data-label": "Registro", text: fmtDate(u.createdAt) }),
    h("span", { "data-label": "Pruebas", text: String(proofs) }),
    h("span", { "data-label": "Planes", text: String(plans) }),
    h("span", { class: "cell-actions" },
      h("button", { class: "ghost-btn small", type: "button", onclick: () => prefillNotify(u.id) }, svgUse("i-bell"), "Notificar"),
      !self && (off
        ? h("button", {
            class: "ghost-btn small", type: "button",
            onclick: (e) => guarded(e.currentTarget, () => adminEnableUser(u.id), `@${u.nickname} reactivado`)
          }, svgUse("i-refresh"), "Reactivar")
        : h("button", {
            class: "ghost-btn small", type: "button",
            onclick: async (e) => {
              const btn = e.currentTarget;
              const ok = await confirmDialog({
                title: "Desactivar cuenta",
                message: `@${u.nickname || u.id} no podrá publicar, comentar, chatear ni ver archivos del HDD. Su contenido se conserva y puedes reactivarla.`,
                confirmLabel: "Desactivar", icon: "i-shield"
              });
              if (ok) guarded(btn, () => adminDisableUser(u, state.user, { reason: "Desactivada por un admin" }), "Cuenta desactivada");
            }
          }, svgUse("i-shield"), "Desactivar")),
      !self && h("button", {
        class: "ghost-btn small danger", type: "button",
        onclick: async (e) => {
          const btn = e.currentTarget;
          const ok = await confirmDialog({
            title: "Eliminar cuenta",
            message: `Se borrará la carpeta entera de @${u.nickname || u.id} en el HDD (${proofs} pruebas y su foto), sus planes, seguidores, chats, reportes y su perfil. No se puede deshacer.`,
            confirmLabel: "Eliminar definitivamente"
          });
          if (!ok) return;
          guarded(btn, () => adminDeleteAccount(u, state.user, (step) => toast(step)),
            "Cuenta eliminada · carpeta del HDD y datos borrados");
        }
      }, svgUse("i-trash"), "Eliminar"))
  );
}

/* ---------- Publicaciones reportadas ---------- */
function renderReports() {
  if (!state.reports.length) {
    return h("p", { class: "list-empty", text: "No hay publicaciones reportadas. 🎉" });
  }
  // Agrupadas por publicación, las más reportadas primero.
  const groups = new Map();
  state.reports.forEach((r) => {
    if (!groups.has(r.proofId)) groups.set(r.proofId, []);
    groups.get(r.proofId).push(r);
  });
  const items = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  return h("div", { class: "admin-grid" }, items.map(([proofId, reports]) => reportCard(proofId, reports)));
}

function reportCard(proofId, reports) {
  const proof = state.proofs.find((p) => p.id === proofId);
  const reasons = [...new Set(reports.map((r) => r.reason))];
  const author = state.users.find((u) => u.id === reports[0].proofUid);
  const notes = reports.filter((r) => r.note).map((r) => r.note);
  const dismiss = (btn) => guarded(btn, () => adminDismissReports(proofId), "Reportes descartados");
  if (!proof) {
    return h("article", { class: "admin-card" },
      h("div", { class: "admin-card-body" },
        h("b", { text: reports[0].activityTitle || "Publicación" }),
        h("small", { text: "La publicación ya no existe." })),
      h("div", { class: "admin-actions" },
        h("button", { class: "ghost-btn small", type: "button", onclick: (e) => dismiss(e.currentTarget) }, "Limpiar reportes")));
  }
  const card = proofCard(proof);
  card.classList.add("is-reported");
  const body = $(".admin-card-body", card);
  body.append(
    h("span", { class: "admin-warning", text: `${reports.length} ${reports.length === 1 ? "reporte" : "reportes"} · @${author?.nickname || proof.authorName}` }),
    h("div", { class: "report-reasons" }, reasons.map((r) => h("span", { class: "reason-chip", text: reportLabel(r) }))),
    ...notes.slice(0, 3).map((n) => h("p", { class: "admin-caption", text: `“${n}”` }))
  );
  $(".admin-actions", card).replaceChildren(
    h("button", { class: "ghost-btn small", type: "button", onclick: () => $(".admin-thumb", card).click() }, svgUse("i-eye"), "Ver"),
    h("button", { class: "ghost-btn small", type: "button", onclick: (e) => dismiss(e.currentTarget) }, svgUse("i-x"), "Descartar"),
    h("button", {
      class: "ghost-btn small danger", type: "button",
      onclick: async (e) => {
        const btn = e.currentTarget;
        const ok = await confirmDialog({
          title: "Eliminar publicación reportada",
          message: `Se borrarán el archivo del HDD (y su miniatura), la publicación, la entrada del historial de @${proof.authorName} y sus ${reports.length} reportes.`,
          confirmLabel: "Eliminar en cascada"
        });
        if (ok) guarded(btn, () => adminDeleteReportedProof(proof, state.user), "Publicación eliminada");
      }
    }, svgUse("i-trash"), "Eliminar en cascada")
  );
  return card;
}

/* ---------- Notificaciones ---------- */
let notifyDraft = { kind: "info", title: "", body: "" };

function prefillNotify(uid, template) {
  state.notifyTo = uid;
  if (template) notifyDraft = { ...NOTIFY_TEMPLATES[template] };
  state.tab = "notify";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderNotify() {
  const form = h("form", { class: "form admin-notify", novalidate: true });
  const toSelect = h("select", { name: "to", class: "admin-select" },
    h("option", { value: "all", text: `Todos los usuarios (${state.users.length})` }),
    state.users.map((u) => h("option", { value: u.id, text: `${u.nickname || "—"} · ${u.id.slice(0, 8)}…` }))
  );
  toSelect.value = state.notifyTo;
  const kindSelect = h("select", { name: "kind", class: "admin-select" },
    Object.entries(NOTIFICATION_KINDS).map(([value, k]) => h("option", { value, text: `${k.emoji} ${k.label}` })));
  kindSelect.value = notifyDraft.kind;
  const title = h("input", { type: "text", name: "title", maxlength: "80", required: true, value: notifyDraft.title });
  const body = h("textarea", { name: "body", maxlength: "1000", rows: "5", required: true });
  body.value = notifyDraft.body;
  const error = h("p", { class: "form-error", role: "alert" });
  const submit = h("button", { class: "primary-btn", type: "submit" }, svgUse("i-send"), "Enviar notificación");

  const useTemplate = (key) => {
    notifyDraft = { ...NOTIFY_TEMPLATES[key] };
    kindSelect.value = notifyDraft.kind;
    title.value = notifyDraft.title;
    body.value = notifyDraft.body;
  };

  form.append(
    h("div", { class: "admin-templates" },
      h("span", { text: "Plantillas:" }),
      h("button", { class: "chip", type: "button", onclick: () => useTemplate("360") }, "🌐 Formato 360° equirectangular"),
      h("button", { class: "chip", type: "button", onclick: () => useTemplate("removed") }, "⚠️ Prueba retirada")
    ),
    h("label", { class: "field" }, h("span", { text: "Destinatario" }), toSelect),
    h("label", { class: "field" }, h("span", { text: "Tipo" }), kindSelect),
    h("label", { class: "field" }, h("span", { text: "Título" }), title),
    h("label", { class: "field" }, h("span", { text: "Mensaje" }), body),
    error,
    submit
  );
  form.addEventListener("input", () => {
    notifyDraft = { kind: kindSelect.value, title: title.value, body: body.value };
    state.notifyTo = toSelect.value;
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!title.value.trim() || !body.value.trim()) return (error.textContent = "Completa el título y el mensaje.");
    const toUids = toSelect.value === "all" ? state.users.map((u) => u.id) : [toSelect.value];
    if (toSelect.value === "all") {
      const ok = await confirmDialog({
        title: "Enviar a todos", message: `Se enviará a ${toUids.length} usuarios.`,
        confirmLabel: "Enviar", danger: false, icon: "i-bell"
      });
      if (!ok) return;
    }
    setLoading(submit, true);
    try {
      const sent = await sendNotification({
        toUids, title: title.value, body: body.value, kind: kindSelect.value,
        fromName: "Equipo Tux"
      });
      notifyDraft = { kind: "info", title: "", body: "" };
      toast(`Notificación enviada a ${sent} usuario${sent === 1 ? "" : "s"}`);
      await loadAll();
    } catch (err) {
      console.error(err);
      error.textContent = err.message || "No se pudo enviar.";
      setLoading(submit, false);
    }
  });

  const sentList = state.sent.length
    ? h("ul", { class: "notification-list" }, state.sent.map((n) => {
        const kind = NOTIFICATION_KINDS[n.kind] || NOTIFICATION_KINDS.info;
        return h("li", { class: "notification" },
          h("span", { class: "notification-icon", text: kind.emoji }),
          h("div", { class: "notification-body" },
            h("div", { class: "notification-head" }, h("b", { text: n.title }), h("time", { text: timeAgo(n.createdAt) })),
            h("small", { text: `Para ${userName(n.toUid)} · ${n.read ? "Leída" : "Sin leer"}` })
          ));
      }))
    : h("p", { class: "list-empty", text: "Aún no se han enviado notificaciones." });

  return h("div", { class: "admin-columns" },
    h("section", { class: "settings-card" }, h("h3", { text: "Enviar notificación" }), form),
    h("section", { class: "settings-card" }, h("h3", { text: "Enviadas recientemente" }), sentList)
  );
}

/* ---------- Servidor multimedia (túnel HTTPS) ---------- */
// Publica en Firestore config/media la URL con la que todos los clientes llegan al HDD.
function renderServer() {
  const sources = {
    config: "publicada en Firestore (config/media)",
    override: "fijada solo en este navegador (?media=)",
    default: "por defecto: solo funciona en el propio Mac mini"
  };
  const input = h("input", {
    type: "url", inputmode: "url", maxlength: "200", placeholder: "https://media.tudominio.com",
    value: mediaServerSource() === "config" ? mediaServerUrl() : state.tunnelUrl
  });
  const error = h("p", { class: "form-error", role: "alert" });
  const submit = h("button", { class: "primary-btn", type: "submit" }, svgUse("i-send"), "Publicar URL");
  const form = h("form", { class: "form admin-notify", novalidate: true },
    h("label", { class: "field" }, h("span", { text: "URL pública del servidor multimedia" }), input),
    h("p", { class: "form-hint", text: "Todos los móviles y navegadores usarán esta URL para subir y ver pruebas. Debe ser https (túnel de Cloudflare)." }),
    state.tunnelUrl && h("button", {
      class: "ghost-btn small", type: "button",
      onclick: () => { input.value = state.tunnelUrl; }
    }, svgUse("i-refresh"), `Usar URL del túnel (${state.tunnelUrl.replace("https://", "")})`),
    error,
    submit
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = normalizeServerUrl(input.value);
    if (!url) return (error.textContent = "Introduce una URL https:// sin ruta (o http://localhost:8787).");
    error.textContent = "";
    setLoading(submit, true);
    try {
      const health = await checkMediaServer(url);
      if (!health.ok && !(await confirmDialog({
        title: "El servidor no responde",
        message: `${url} no responde ahora mismo (${health.message}). ¿Publicarla igualmente?`,
        confirmLabel: "Publicar", danger: false, icon: "i-send"
      }))) return;
      await publishMediaServerUrl(url, state.user);
      toast("URL publicada · los clientes la usarán al instante");
      setTimeout(loadAll, 600);
    } catch (err) {
      console.error(err);
      error.textContent = err.message || "No se pudo publicar.";
    } finally {
      setLoading(submit, false);
    }
  });

  return h("section", { class: "admin-section" },
    h("div", { class: "admin-card admin-server" },
      h("div", { class: "admin-card-body" },
        h("b", { text: mediaServerUrl() }),
        h("small", { text: `Servidor activo · ${sources[mediaServerSource()]}` }),
        h("small", { text: state.storageOk ? "✓ Responde y el HDD está montado" : "✗ No responde o el HDD no está montado" }),
        state.tunnelUrl && h("small", { text: `Túnel detectado: ${state.tunnelUrl}` })
      )
    ),
    form,
    h("p", { class: "form-hint", text: "En el Mac mini: «npm run tunnel:install» en server/ deja el túnel como servicio. Guía completa en server/tunnel/README.md." })
  );
}
